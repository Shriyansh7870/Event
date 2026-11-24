import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateKeyPair, exportJWK } from 'jose';

// Isolated database and a stubbed Graph API: never contacts WhatsApp.
Object.assign(process.env, {
  MONGODB_URI: '', JWT_SECRET: 'isolated-test-secret-that-is-long-enough', NODE_ENV: 'test', SEED_DEMO: '0',
  WHATSAPP_TOKEN: 'tok', WHATSAPP_PHONE_NUMBER_ID: '123', WHATSAPP_TEMPLATE: 'pass', WHATSAPP_COUNTRY_CODE: '91',
});
const { privateKey } = await generateKeyPair('ES256', { extractable: true });
process.env.QR_PRIVATE_JWK = JSON.stringify(await exportJWK(privateKey));
const { connectDB, disconnectDB } = await import('../src/db.js');
const { initModels, User } = await import('../src/models/index.js');
const { loadKeys } = await import('../src/keys.js');
const { signStaffToken } = await import('../src/middleware/auth.js');
const { createApp } = await import('../src/app.js');

test('whatsapp sending, full user list and pass links', async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  let fail = false;
  globalThis.fetch = async (url, init) => {
    if (!String(url).startsWith('https://graph.facebook.com/')) return realFetch(url, init);
    calls.push({ url: String(url), init });
    if (fail) return Response.json({ error: { message: 'Template missing' } }, { status: 400 });
    return Response.json(String(url).endsWith('/media') ? { id: 'media1' } : { messages: [{ id: 'wamid.1' }] });
  };
  let server;
  try {
    await connectDB();
    await initModels();
    await loadKeys();
    server = createApp().listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const req = async (path, { token, body, method } = {}) => {
      const r = await fetch(base + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body && JSON.stringify(body) });
      return { status: r.status, body: await r.json() };
    };
    const { body: reg } = await req('/register', { body: { fullName: 'Asha Rao', phone: '9876543210', kids: [{ name: 'Kid One' }] } });
    await User.insertMany(Array.from({ length: 150 }, (_, i) => ({ fullName: `User ${i}`, phone: String(8000000000 + i), code: `C${i}` })));
    const token = await signStaffToken({ _id: '000000000000000000000001', username: 'admin', role: 'admin' });
    const verifier = await signStaffToken({ _id: '000000000000000000000002', username: 'gate', role: 'verifier' });
    const path = `/admin/users/${reg.user.id}/whatsapp`;
    const image = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]).toString('base64');

    const pages = await Promise.all(Array.from({ length: 13 }, (_, i) => req(`/admin/users?page=${i + 1}`, { token })));
    assert.deepEqual([pages[0].body.items.length, pages[12].body.items.length, pages[0].body.total, pages[0].body.pages], [12, 8, 152, 13]);
    assert.equal(new Set(pages.flatMap((r) => r.body.items.map((u) => u.id))).size, 152);
    await User.insertMany([['amit K', 1], ['Zoya', 2], ['7 Star', 3]].map(([fullName, i]) => ({ fullName, phone: String(8100000000 + i), code: `L${i}` })));
    const names = async (qs) => (await req(`/admin/users?${qs}`, { token })).body.items.map((u) => u.fullName);
    assert.deepEqual((await names('')).slice(0, 3), ['7 Star', 'amit K', 'Asha Rao']);
    assert.ok((await User.collection.indexes()).some((i) => i.key.fullName));
    assert.equal((await req('/admin/users?limit=500', { token })).body.items.length, 100);
    assert.equal((await req(path, { body: { image } })).status, 401);
    assert.equal((await req(path, { token: verifier, body: { image } })).status, 403);
    assert.equal((await req(path, { token, body: { image: 'AAAA' } })).status, 400);
    assert.equal(calls.length, 0);

    const info = await req(path, { token });
    assert.equal(info.body.mode, 'api');
    assert.equal(info.body.to, '919876543210');
    assert.equal((await req(path, { token, body: { image } })).status, 200);
    const sent = JSON.parse(calls[1].init.body);
    assert.equal(sent.to, '919876543210');
    assert.equal(sent.template.components[0].parameters[0].image.id, 'media1');
    assert.deepEqual(sent.template.components[1].parameters.map((p) => p.text).slice(0, 5), ['Asha Rao', 'Namma Honda Habba', reg.user.code, '9876543210', '2 (1 adult, 1 child)']);
    assert.ok((await req('/admin/users?search=Asha', { token })).body.items.find((u) => u.id === reg.user.id).whatsappSentAt);

    fail = true;
    const failed = await req(path, { token, body: { image } });
    assert.equal(failed.status, 502);
    assert.match(failed.body.error, /Template missing/);

    const open = await req('/pass/open', { body: { qrToken: reg.qrToken } });
    assert.equal(open.status, 200);
    assert.equal(open.body.user.phone, undefined);
    assert.equal(open.body.user.kids, undefined);
    assert.equal((await req('/pass/open', { body: { qrToken: `${reg.qrToken.slice(0, -8)}AAAAAAAA` } })).status, 404);
    const userPath = `/admin/users/${reg.user.id}`;
    const patch = (body) => req(userPath, { token, method: 'PATCH', body });
    assert.equal((await patch({ status: 'cancelled' })).status, 400);
    assert.equal((await patch({ status: 'cancelled', reason: '   ' })).status, 400);
    assert.equal((await patch({ status: 'cancelled', reason: 'x'.repeat(301) })).status, 400);
    assert.equal((await User.findById(reg.user.id).lean()).status, 'active');
    const cancelled = await patch({ status: 'cancelled', reason: ' Duplicate entry ' });
    assert.deepEqual([cancelled.status, cancelled.body.user.cancelReason, cancelled.body.user.cancelledBy], [200, 'Duplicate entry', 'admin']);
    assert.equal((await patch({ status: 'active' })).body.user.cancelReason, null);
    assert.equal((await req('/pass/open', { body: { qrToken: reg.qrToken } })).body.user.cancelReason, undefined);
    await patch({ status: 'cancelled', reason: 'Again' });
    assert.equal((await req(path, { token, body: { image } })).status, 409);
  } finally {
    globalThis.fetch = realFetch;
    if (server) await new Promise((r) => server.close(r));
    await disconnectDB();
  }
});
