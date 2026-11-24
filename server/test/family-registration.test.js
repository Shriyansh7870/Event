import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateKeyPair, exportJWK } from 'jose';

// Tests always use an isolated in-memory database, never .env database credentials.
process.env.MONGODB_URI = '';
process.env.JWT_SECRET = 'isolated-test-secret-that-is-long-enough';
process.env.NODE_ENV = 'test';
process.env.SEED_DEMO = '0';
const { privateKey } = await generateKeyPair('ES256', { extractable: true });
process.env.QR_PRIVATE_JWK = JSON.stringify(await exportJWK(privateKey));
const { connectDB, disconnectDB } = await import('../src/db.js');
const { initModels, User, Staff } = await import('../src/models/index.js');
const { loadKeys } = await import('../src/keys.js');
const { signStaffToken } = await import('../src/middleware/auth.js');
const { ensureFamily, backfillFamilies } = await import('../src/lib/family.js');
const { createApp } = await import('../src/app.js');

test('family registrations, legacy index migration, lookup, and staff passwords', async () => {
  let server;
  try {
    await connectDB();
    await User.collection.createIndex({ email: 1 }, { unique: true });
    await User.collection.createIndex({ phone: 1 }, { unique: true });
    await initModels();
    assert.equal((await User.collection.indexes()).find((i) => i.key.email)?.sparse, true);
    await loadKeys();
    server = createApp().listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    async function post(path, body, token) {
      const res = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
      return { status: res.status, body: await res.json() };
    }
    const adults = Array.from({ length: 5 }, (_, i) => ({ name: `Adult ${i}`, relationship: 'brother' }));
    const kids = Array.from({ length: 5 }, (_, i) => ({ name: `Child ${i}` }));
    const first = await post('/register', { fullName: 'Family One', phone: '9876543210', adults, kids });
    assert.equal(first.status, 201);
    assert.equal(first.body.user.adults.length, 5);
    assert.equal(first.body.user.kids.length, 5);
    // Every guest has their own QR, linked to the main registrant.
    assert.equal(first.body.members.length, 10);
    assert.equal(new Set([first.body, ...first.body.members].map((p) => p.user.code)).size, 11);
    assert.ok(first.body.members.every((m) => m.user.primaryId === first.body.user.id && m.user.primaryName === 'Family One' && m.qrToken));
    assert.equal(first.body.members[5].user.relation, 'child');
    const main = await User.findById(first.body.user.id).lean();
    await Promise.all([ensureFamily(main), ensureFamily(main)]); // repeating never creates extras
    assert.equal(await User.countDocuments({ primaryId: main._id }), 10);
    assert.equal((await post('/register', { fullName: 'Family Two', phone: '9876543211' })).status, 201);
    assert.equal((await post('/register', { fullName: 'Family Three', phone: '9876543212', adults: [...adults, adults[0]] })).status, 400);
    assert.equal((await post('/register', { fullName: 'Family Three', phone: '9876543212', kids: [...kids, kids[0]] })).status, 400);
    assert.equal((await post('/register', { fullName: 'Family Three', phone: '9876543212', adults: [{ name: 'Someone', relationship: 'invalid' }] })).status, 400);
    assert.equal((await post('/register', { fullName: 'Duplicate Phone', phone: '9876543210' })).status, 409);
    const lookup = await post('/pass/lookup', { fullName: 'family one', phone: '9876543210' });
    assert.equal(lookup.status, 200);
    assert.equal(lookup.body.user.kids.length, 5);
    assert.equal((await post('/pass/lookup', { fullName: 'Wrong Person', phone: '9876543210' })).status, 404);
    assert.equal((await post('/admin/staff', { username: 'denied' })).status, 401);
    const token = await signStaffToken({ _id: '000000000000000000000001', username: 'admin', role: 'admin' });
    const snapshot = await fetch(base + '/sync/snapshot', { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(snapshot.status, 200);
    const snapshotBody = await snapshot.json();
    assert.equal(snapshotBody.users.find((u) => u.phone === '9876543210').adults.length, 5);
    assert.equal(lookup.body.members.length, 10);
    const kid = first.body.members[5].user;
    const inSnapshot = snapshotBody.users.find((u) => u.id === kid.id);
    assert.equal(inSnapshot.primaryId, first.body.user.id);
    // A guest checks in alone; the main registrant and other guests are unaffected.
    const scan = (id, userId) => post('/sync/checkins', { deviceId: 'd1', deviceName: 'Gate 1', checkins: [{ id, userId, scannedAt: Date.now() }] }, token);
    assert.deepEqual((await scan('s1', kid.id)).body.duplicates, []);
    assert.equal((await scan('s2', kid.id)).body.duplicates.length, 1);
    assert.deepEqual((await scan('s3', first.body.user.id)).body.duplicates, []);
    const call = async (path, init = {}) => { const r = await fetch(base + path, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } }); return { status: r.status, body: await r.json() }; };
    assert.equal((await call('/admin/users?search=9876543210')).body.total, 11);
    const wa = (await call(`/admin/users/${kid.id}/whatsapp`)).body;
    assert.equal(wa.to, '919876543210');
    assert.equal(wa.family.length, 11);
    // Cancelling the main registrant cancels guests; a separately cancelled guest stays cancelled.
    const patch = (id, body) => call(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
    await patch(first.body.members[0].user.id, { status: 'cancelled', reason: 'Not coming' });
    await patch(first.body.user.id, { status: 'cancelled', reason: 'Family cancelled' });
    assert.equal(await User.countDocuments({ primaryId: main._id, status: 'cancelled' }), 10);
    assert.equal((await patch(kid.id, { status: 'active' })).status, 409);
    await patch(first.body.user.id, { status: 'active' });
    assert.equal(await User.countDocuments({ primaryId: main._id, status: 'cancelled' }), 1);
    // Older registrations get passes once, unless the family already entered.
    const old = await User.create({ fullName: 'Old Family', phone: '9876500001', code: 'OLD1', kids: [{ name: 'Old Kid' }] });
    const entered = await User.create({ fullName: 'Entered Family', phone: '9876500002', code: 'OLD2', kids: [{ name: 'In Kid' }] });
    await scan('s4', String(entered._id));
    await backfillFamilies(); await backfillFamilies();
    assert.equal(await User.countDocuments({ primaryId: old._id }), 1);
    assert.equal(await User.countDocuments({ primaryId: entered._id }), 0);
    const legacy = await post('/register', { fullName: 'Legacy Person', phone: '9876543213', email: 'legacy@example.com' });
    assert.equal(legacy.status, 201);
    assert.equal((await post('/pass/lookup', { email: 'legacy@example.com', phone: '9876543213' })).status, 200);
    assert.equal((await post('/register', { fullName: 'Other Person', phone: '9876543214', email: 'legacy@example.com' })).status, 409);
    assert.equal((await post('/admin/staff', { username: 'gate-default' }, token)).status, 201);
    assert.equal((await post('/staff/login', { username: 'gate-default', password: 'Test123' })).status, 200);
    const stored = await Staff.findOne({ username: 'gate-default' }).lean();
    assert.notEqual(stored.passwordHash, 'Test123');
    assert.equal((await post('/admin/staff', { username: 'gate-custom', password: 'Custom456' }, token)).status, 201);
    assert.equal((await post('/staff/login', { username: 'gate-custom', password: 'Custom456' })).status, 200);
    assert.equal((await post('/admin/staff', { username: 'gate-short', password: 'bad' }, token)).status, 400);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await disconnectDB();
  }
});
