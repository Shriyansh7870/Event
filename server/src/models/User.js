import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true },
    fullName: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
    email: { type: String, unique: true, sparse: true, lowercase: true, trim: true },
    phone: { type: String, required: [function () { return !this.primaryId; }, 'Phone is required'], unique: true, sparse: true, match: /^\d{10,15}$/ },
    organization: { type: String, trim: true, maxlength: 100, default: '' },
    adults: { type: [{ _id: false, name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 }, relationship: { type: String, required: true, enum: ['wife', 'husband', 'mother', 'father', 'uncle', 'aunt', 'brother', 'sister', 'grandparent', 'other'] } }], default: [], validate: [(v) => v.length <= 5, 'Maximum 5 adults'] },
    kids: { type: [{ _id: false, name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 } }], default: [], validate: [(v) => v.length <= 5, 'Maximum 5 kids'] },
    photo: { type: String, default: null },
    status: { type: String, enum: ['active', 'cancelled'], default: 'active', index: true },
    source: { type: String, enum: ['self', 'bulk'], default: 'self' },
    // Guests only: link to the main registrant. Guests have no phone or email of their own.
    primaryId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    primaryName: String,
    relation: String,
    memberKey: String, // a0..a4 / k0..k4
    familyReady: Boolean, // main registrant: guest passes have been created
    cancellation: { type: { _id: false, viaPrimary: Boolean, reason: String, at: Date, by: String }, default: null },
    whatsapp: { type: { _id: false, sentAt: Date, sentBy: String, messageId: String }, default: null },
    batchId: { type: String, default: null, index: true },
  },
  { timestamps: true, autoIndex: false }
);

userSchema.index({ createdAt: -1 });
userSchema.index({ primaryId: 1, memberKey: 1 }, { unique: true, partialFilterExpression: { memberKey: { $type: 'string' } } });
// Case-insensitive A–Z listing. Queries must use the same collation; the index avoids sorting documents with photos in memory.
export const NAME_COLLATION = { locale: 'en', strength: 2 };
userSchema.index({ fullName: 1, _id: 1 }, { collation: NAME_COLLATION });

export const User = mongoose.model('User', userSchema);
