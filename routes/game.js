const router = require('express').Router();
const crypto = require('crypto');
const auth = require('../middleware/auth');
const { User } = require('../models/User');
const G = require('../config/game');

const rand = () => crypto.randomInt(0, 1_000_000) / 1_000_000;

function pickPrize() {
  const entries = Object.entries(G.WEIGHTS);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [amt, w] of entries) { if ((r -= w) <= 0) return Number(amt); }
  return Number(entries[0][0]);
}
function sliceFor(amount) {
  const idx = G.SEGMENTS.map((v, i) => (v === amount ? i : -1)).filter((i) => i >= 0);
  return idx[crypto.randomInt(0, idx.length)];
}
function makeCode() {
  const c = () => crypto.randomBytes(2).toString('hex').toUpperCase();
  return `XMAS-${c()}-${c()}`;
}
const state = (u) => ({
  username: u.username, phone: u.phone, branch: u.branch,
  spinsUsed: u.spinsUsed, spinsLeft: u.prize ? 0 : Math.max(0, G.MAX_SPINS - u.spinsUsed),
  prize: u.prize, voucherCode: u.voucherCode, claimed: !!u.claimedAt, redeemed: !!u.redeemedAt,
  claimedAt: u.claimedAt, redeemedAt: u.redeemedAt,
});

// Public: wheel layout + places left. TARGET_USERS is a target, never a limit: sign-ups stay open past it.
router.get('/config', async (req, res) => {
  try {
    const taken = await User.countDocuments();
    res.json({
      segments: G.SEGMENTS, maxSpins: G.MAX_SPINS, target: G.TARGET_USERS,
      taken, slotsLeft: Math.max(0, G.TARGET_USERS - taken),
    });
  } catch (e) { res.status(500).json({ message: 'Could not load settings.' }); }
});

// Public: latest real claimed vouchers (first name + masked number) for the live popups
router.get('/recent', async (req, res) => {
  try {
    const rows = await User.find({ voucherCode: { $ne: null } }).sort({ claimedAt: -1 }).limit(15).select('username phone prize');
    res.json(rows.map((u) => {
      const first = u.username.split(' ')[0];
      return { name: first.charAt(0).toUpperCase() + first.slice(1).toLowerCase(), phone: u.phone.slice(0, 4) + '*****' + u.phone.slice(-3), amount: u.prize };
    }));
  } catch (e) { res.json([]); }
});

router.get('/me', auth, (req, res) => res.json(state(req.user)));

router.post('/spin', auth, async (req, res) => {
  try {
    // Atomic: only proceeds if user still has spins and has not won
    const user = await User.findOneAndUpdate(
      { _id: req.user._id, prize: null, spinsUsed: { $lt: G.MAX_SPINS } },
      { $inc: { spinsUsed: 1 } }, { new: true });
    if (!user) return res.status(400).json({ message: 'You have no spins left.' });

    const lastSpin = user.spinsUsed >= G.MAX_SPINS;
    let amount = 0;
    if ((G.GUARANTEE_LAST_SPIN && lastSpin) || rand() >= G.P_ZERO) amount = pickPrize();

    const update = { $push: { spins: { amount } } };
    if (amount > 0) update.$set = { prize: amount };
    const saved = await User.findByIdAndUpdate(user._id, update, { new: true });

    res.json({ ...state(saved), sliceIndex: sliceFor(amount), amount });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Spin failed. Please try again.' });
  }
});

router.post('/claim', auth, async (req, res) => {
  const u = req.user;
  if (!u.prize) return res.status(400).json({ message: 'No voucher to claim yet. Spin the wheel first.' });
  if (!u.voucherCode) {
    u.voucherCode = makeCode();
    u.claimedAt = new Date();
    await u.save();
  }
  res.json(state(u));
});

// Cashier: look up / redeem a voucher (header x-admin-key)
function admin(req, res, next) {
  if (!process.env.ADMIN_KEY || req.headers['x-admin-key'] !== process.env.ADMIN_KEY) return res.status(401).json({ message: 'Wrong cashier key.' });
  next();
}
router.post('/cashier/lookup', admin, async (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase();
  const u = await User.findOne({ voucherCode: code });
  if (!u) return res.status(404).json({ message: 'Voucher not found.' });
  res.json({ code, username: u.username, phone: u.phone, branch: u.branch, amount: u.prize, redeemed: !!u.redeemedAt, redeemedAt: u.redeemedAt });
});
router.post('/cashier/redeem', admin, async (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase();
  const u = await User.findOneAndUpdate({ voucherCode: code, redeemedAt: null }, { redeemedAt: new Date(), redeemedBy: String(req.body.branch || 'cashier') }, { new: true });
  if (!u) return res.status(400).json({ message: 'Voucher not found or already redeemed.' });
  res.json({ message: `Redeemed Ksh ${u.prize.toLocaleString()} for ${u.username}.`, amount: u.prize });
});

module.exports = router;
