const mongoose = require('mongoose');

const spinSchema = new mongoose.Schema({ amount: Number, at: { type: Date, default: Date.now } }, { _id: false });

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, trim: true, maxlength: 30 },
  phone: { type: String, required: true, unique: true, index: true },
  branch: { type: String, required: true },
  pinHash: { type: String, required: true },
  isDemo: { type: Boolean, default: false },
  spinsUsed: { type: Number, default: 0 },
  spins: [spinSchema],
  prize: { type: Number, default: null },       // null = not won yet
  voucherCode: { type: String, default: null, index: true },
  claimedAt: { type: Date, default: null },
  redeemedAt: { type: Date, default: null },
  redeemedBy: { type: String, default: null },
}, { timestamps: true });

const counterSchema = new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } });

module.exports = {
  User: mongoose.model('User', userSchema),
  Counter: mongoose.model('Counter', counterSchema),
};
