import { User } from './User.js';
import { Checkin } from './Checkin.js';
import { Device } from './Device.js';
import { Staff } from './Staff.js';
import { Batch } from './Batch.js';

export { User, Checkin, Device, Staff, Batch };

/** Build indexes before serving traffic (unique indexes back the 409 / idempotency logic). */
export async function initModels() {
  // Older installations have non-sparse unique email/phone indexes.
  // Replace only those, so people without an email (or guests without a phone) can coexist.
  try {
    const indexes = await User.collection.indexes();
    for (const field of ['email', 'phone']) {
      const old = indexes.find((i) => i.key?.[field] === 1 && Object.keys(i.key).length === 1 && i.unique && !i.sparse);
      if (old) await User.collection.dropIndex(old.name);
    }
  } catch (err) {
    if (err.code !== 26) throw err; // Collection does not exist on a fresh database.
  }
  await User.createIndexes();
  await Promise.all([User.init(), Checkin.init(), Device.init(), Staff.init(), Batch.init()]);
}
