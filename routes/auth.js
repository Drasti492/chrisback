const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { User } = require('../models/User');
const G = require('../config/game');

// Only failed attempts count, so a whole school sharing one Wi-Fi is never locked out
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, skipSuccessfulRequests: true, message: { message: 'Too many attempts. Wait a few minutes and try again.' } });

// Kenyan mobile: 07xxxxxxxx or 01xxxxxxxx (also accepts +254 / 254). Known non-Safaricom ranges 073x, 077x, 078x are refused.
const SAF = /^(?:07(?![378])\d{8}|01\d{8})$/;
function normalizePhone(p) {
  let s = String(p || '').replace(/[\s-]/g, '');
  if (s.startsWith('+254')) s = '0' + s.slice(4);
  else if (s.startsWith('254')) s = '0' + s.slice(3);
  return SAF.test(s) ? s : null;
}
const sign = (u) => jwt.sign({ id: u._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
const publicUser = (u) => ({ username: u.username, phone: u.phone, branch: u.branch });

router.post('/register', limiter, async (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const branch = String(req.body.branch || '').trim().replace(/\s+/g, ' ');
    const phone = normalizePhone(req.body.phone);
    const pin = String(req.body.pin || '');
    const confirmPin = String(req.body.confirmPin || '');

    if (username.length < 2 || username.length > 30) return res.status(400).json({ message: 'Enter your name (2 to 30 letters).' });
    if (!phone) return res.status(400).json({ message: 'Enter a valid Safaricom number e.g. 0722 000 000.' });
    if (phone === G.BLOCKED_PHONE) return res.status(400).json({ message: 'Please use your own Safaricom number.' });
    if (branch.length < 2 || branch.length > 60) return res.status(400).json({ message: 'Type the name of the supermarket you shopped at.' });
    if (!/^\d{4}$/.test(pin)) return res.status(400).json({ message: 'PIN must be exactly 4 digits.' });
    if (pin === G.BLOCKED_PIN) return res.status(400).json({ message: 'Choose a PIN other than 1234.' });
    if (pin !== confirmPin) return res.status(400).json({ message: 'The two PINs do not match.' });

    if (await User.findOne({ phone })) return res.status(409).json({ message: 'This number is already registered. Please sign in.' });
    try {
      const user = await User.create({ username, phone, branch, pinHash: await bcrypt.hash(pin, 10) });
      res.status(201).json({ token: sign(user), user: publicUser(user) });
    } catch (e) {
      if (e.code === 11000) return res.status(409).json({ message: 'This number is already registered. Please sign in.' });
      throw e;
    }
  } catch (e) {
    console.error('register error:', e);
    res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
});

router.post('/login', limiter, async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);
    const pin = String(req.body.pin || '');
    if (!phone || !/^\d{4}$/.test(pin)) return res.status(400).json({ message: 'Enter your Safaricom number and 4-digit PIN.' });

    const user = await User.findOne({ phone });
    if (!user) return res.status(404).json({ message: 'No account with this number. Please sign up first.' });
    if (!(await bcrypt.compare(pin, user.pinHash))) return res.status(401).json({ message: 'Wrong PIN. Try again.' });
    res.json({ token: sign(user), user: publicUser(user) });
  } catch (e) {
    console.error('login error:', e);
    res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
});

module.exports = router;
