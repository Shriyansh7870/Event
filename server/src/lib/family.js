// Every guest of a registration has their own User (own code + QR) linked to the main registrant by primaryId.
import { User } from '../models/index.js';
import { Checkin } from '../models/Checkin.js';
import { generateCode } from './code.js';
import { toPublicUser } from './serialize.js';
import { firstCheckinMap } from './checkins.js';
import { signPass } from '../keys.js';

/** Creates any missing guest passes. Safe to repeat or run concurrently: (primaryId, memberKey) is unique. */
export async function ensureFamily(primary) {
  const members = [
    ...(primary.adults || []).map((m, i) => ({ memberKey: `a${i}`, fullName: m.name, relation: m.relationship })),
    ...(primary.kids || []).map((m, i) => ({ memberKey: `k${i}`, fullName: m.name, relation: 'child' })),
  ];
  for (const { memberKey, ...data } of members) {
    const key = { primaryId: primary._id, memberKey };
    for (let attempt = 0; ; attempt++) {
      if (await User.exists(key)) break;
      try {
        await User.create({ ...key, ...data, primaryName: primary.fullName, code: generateCode(), status: primary.status, source: primary.source, batchId: primary.batchId });
        break;
      } catch (err) {
        if (err?.code !== 11000 || attempt >= 4) throw err; // code collision, or created concurrently: check again
      }
    }
  }
  await User.updateOne({ _id: primary._id }, { $set: { familyReady: true } });
}

/** [{ user, qrToken }] for everyone linked to this main registrant. */
export async function familyPasses(primaryId) {
  const users = await User.find({ primaryId }).sort({ memberKey: 1 }).lean();
  const firsts = await firstCheckinMap(users.map((u) => u._id));
  return Promise.all(users.map(async (u) => ({ user: toPublicUser(u, firsts.get(String(u._id))), qrToken: await signPass(u) })));
}

/** One-time upgrade of registrations made before guests had their own passes. */
export async function backfillFamilies() {
  const todo = await User.find({ familyReady: { $ne: true }, $or: [{ 'adults.0': { $exists: true } }, { 'kids.0': { $exists: true } }] }, { photo: 0 }).lean();
  for (const u of todo) {
    // The old pass admitted the whole family at once: never issue fresh passes to a family that already entered.
    if (await Checkin.exists({ userId: u._id })) continue;
    await ensureFamily(u);
  }
}
