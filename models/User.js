const mongoose = require('mongoose');

const spinSchema = new mongoose.Schema(
  { amount: Number, at: { type: Date, default: Date.now } },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, trim: true, maxlength: 30 },
    phone: { type: String, required: true, unique: true, index: true },
    amountSpent: { type: Number, required: true, min: 1 }, // KSh spent this year
    pinHash: { type: String, required: true },
    spinsUsed: { type: Number, default: 0 },
    spins: [spinSchema],
    prize: { type: Number, default: null },
    voucherCode: { type: String, default: null, index: true },
    claimedAt: { type: Date, default: null },
    redeemedAt: { type: Date, default: null },
    redeemedBy: { type: String, default: null },
    cardActivated: { type: Boolean, default: false },
    activationPhone: { type: String, default: null },
    activationRef: { type: String, default: null },
  },
  { timestamps: true }
);

module.exports = { User: mongoose.model('User', userSchema) };