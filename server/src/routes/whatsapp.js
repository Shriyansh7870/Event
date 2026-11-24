// Admin: send an attendee's QR pass on WhatsApp. Mounted inside the admin router (already admin-only).
import { Router } from 'express';
import mongoose from 'mongoose';
import { User } from '../models/index.js';
import { HttpError } from '../lib/errors.js';
import { guestSummary, sendPassTemplate, toWhatsappNumber, whatsappConfigured } from '../lib/whatsapp.js';
import { config } from '../config.js';
import { signPass } from '../keys.js';
import { toPublicUser } from '../lib/serialize.js';

const router = Router();
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function activeUser(id) {
  const user = mongoose.isValidObjectId(id) ? await User.findById(id).lean() : null;
  if (!user) throw new HttpError(404, 'User not found');
  if (user.status !== 'active') throw new HttpError(409, 'This pass is cancelled');
  return user;
}

/** Guests have no phone: their pass goes to the main registrant. */
async function contactPhone(user) {
  if (user.phone) return user.phone;
  const primary = await User.findById(user.primaryId, { phone: 1 }).lean();
  if (!primary?.phone) throw new HttpError(409, 'No mobile number for this pass');
  return primary.phone;
}

/** Everything the send dialog needs. mode "api" = server can send; "manual" = staff send from their own WhatsApp. */
router.get('/users/:id/whatsapp', async (req, res) => {
  const user = await activeUser(req.params.id);
  const phone = await contactPhone(user);
  const familyId = user.primaryId || user._id;
  const family = await User.find({ status: 'active', $or: [{ _id: familyId }, { primaryId: familyId }] }, { fullName: 1, memberKey: 1 }).sort({ memberKey: 1 }).lean();
  res.json({
    phone,
    family: family.map((u) => ({ id: String(u._id), fullName: u.fullName })),
    mode: whatsappConfigured() ? 'api' : 'manual',
    to: toWhatsappNumber(phone),
    guests: guestSummary(user),
    eventName: config.eventName,
    appUrl: config.publicAppUrl,
    user: toPublicUser(user),
    qrToken: await signPass(user),
  });
});

router.post('/users/:id/whatsapp', async (req, res) => {
  if (!whatsappConfigured()) throw new HttpError(503, 'WhatsApp API is not configured on the server');
  const user = await activeUser(req.params.id);
  const png = Buffer.from(typeof req.body?.image === 'string' ? req.body.image : '', 'base64');
  if (!png.subarray(0, 8).equals(PNG_MAGIC)) throw new HttpError(400, 'image must be a base64 PNG', 'image');

  const messageId = await sendPassTemplate(user, await contactPhone(user), png);
  const whatsapp = { sentAt: new Date(), sentBy: req.staff?.username || '', messageId };
  await User.updateOne({ _id: user._id }, { $set: { whatsapp } });
  res.json({ whatsappSentAt: whatsapp.sentAt.toISOString() });
});

export default router;
