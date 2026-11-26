const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { User, Counter } = require('../models/User');
const G = require('../config/game');

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, message: { message: 'Too many attempts. Wait a few minutes and try again.' } });

// Safaricom only: 07xx / 01xx, also accepts +254 / 254
const SAF = /^(?:07(?:[0129]\d|4[0-368]|5[7-9]|6[89])\d{6}|01(?:0[0-2]|1[0-5])\d{6})$/;
function normalizePhone(p) {
  let s = String(p || '').replace(/[\s-]/g, '');
  if (s.startsWith('+254')) s = '0' + s.slice(4);
  else if (s.startsWith('254')) s = '0' + s.slice(3);
  return SAF.test(s) ? s : null;
}
const sign = (u) => jwt.sign({ id: u._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
const publicUser = (u) => ({ username: u.username, phone: u.phone, branch: u.branch, isDemo: u.isDemo });

router.post('/register', limiter, async (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const phone = normalizePhone(req.body.phone);
    const { branch, pin, confirmPin } = req.body;

    if (username.length < 2) return res.status(400).json({ message: 'Enter your name (at least 2 letters).' });
    if (!phone) return res.status(400).json({ message: 'Enter a valid Safaricom number e.g. 0712345678.' });
    if (!G.BRANCHES.includes(branch)) return res.status(400).json({ message: 'Choose the branch you shopped at.' });
    if (!/^\d{4}$/.test(pin || '')) return res.status(400).json({ message: 'PIN must be exactly 4 digits.' });
    if (pin !== confirmPin) return res.status(400).json({ message: 'The two PINs do not match.' });

    const isDemo = phone === G.DEMO_PHONE;
    if (await User.findOne({ phone })) return res.status(409).json({ message: 'This number is already registered. Please log in.' });

    let reserved = false;
    if (!isDemo) {
      try {
        await Counter.findOneAndUpdate({ _id: 'users', seq: { $lt: G.MAX_USERS } }, { $inc: { seq: 1 } }, { upsert: true, new: true });
        reserved = true;
      } catch (e) {
        if (e.code === 11000) return res.status(403).json({ message: 'Sorry, all 5,000 slots have been taken. Thank you for shopping with us!' });
        throw e;
      }
    }
    try {
      const user = await User.create({ username, phone, branch, isDemo, pinHash: await bcrypt.hash(pin, 10) });
      res.status(201).json({ token: sign(user), user: publicUser(user) });
    } catch (e) {
      if (reserved) await Counter.updateOne({ _id: 'users' }, { $inc: { seq: -1 } });
      if (e.code === 11000) return res.status(409).json({ message: 'This number is already registered. Please log in.' });
      throw e;
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
});

router.post('/login', limiter, async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);
    const pin = String(req.body.pin || '');
    if (!phone || !/^\d{4}$/.test(pin)) return res.status(400).json({ message: 'Enter your Safaricom number and 4-digit PIN.' });

    let user = await User.findOne({ phone });
    // Demo number works instantly, even before anyone registered it
    if (!user && phone === G.DEMO_PHONE && pin === G.DEMO_PIN) {
      user = await User.create({ username: 'Demo Guest', phone, branch: G.BRANCHES[0], isDemo: true, pinHash: await bcrypt.hash(G.DEMO_PIN, 10) });
    }
    if (!user || !(await bcrypt.compare(pin, user.pinHash))) return res.status(401).json({ message: 'Wrong number or PIN.' });
    res.json({ token: sign(user), user: publicUser(user) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
});

module.exports = router;
