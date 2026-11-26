const router = require('express').Router();
const crypto = require('crypto');
const axios = require('axios');
const auth = require('../middleware/auth');
const { User } = require('../models/User');
const ActivationPayment = require('../models/ActivationPayment');
const G = require('../config/game');

const rand = () => crypto.randomInt(0, 1_000_000) / 1_000_000;

function pickPrize() {
  const entries = Object.entries(G.WEIGHTS);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [amt, w] of entries) {
    if ((r -= w) <= 0) return Number(amt);
  }
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
  username: u.username,
  phone: u.phone,
  branch: u.branch,
  spinsUsed: u.spinsUsed,
  spinsLeft: u.prize ? 0 : Math.max(0, G.MAX_SPINS - u.spinsUsed),
  prize: u.prize,
  voucherCode: u.voucherCode,
  claimed: !!u.claimedAt,
  redeemed: !!u.redeemedAt,
  claimedAt: u.claimedAt,
  redeemedAt: u.redeemedAt,
  cardActivated: !!u.cardActivated,
  activationPhone: u.activationPhone || null,
});

// Public: wheel layout + places left
router.get('/config', async (req, res) => {
  try {
    const taken = await User.countDocuments();
    res.json({
      segments: G.SEGMENTS,
      maxSpins: G.MAX_SPINS,
      target: G.TARGET_USERS,
      taken,
      slotsLeft: Math.max(0, G.TARGET_USERS - taken),
    });
  } catch (e) {
    res.status(500).json({ message: 'Could not load settings.' });
  }
});

// Public: latest claimed vouchers for live popups
router.get('/recent', async (req, res) => {
  try {
    const rows = await User.find({ voucherCode: { $ne: null } })
      .sort({ claimedAt: -1 })
      .limit(15)
      .select('username phone prize');
    res.json(
      rows.map((u) => {
        const first = u.username.split(' ')[0];
        return {
          name: first.charAt(0).toUpperCase() + first.slice(1).toLowerCase(),
          phone: u.phone.slice(0, 4) + '*****' + u.phone.slice(-3),
          amount: u.prize,
        };
      })
    );
  } catch (e) {
    res.json([]);
  }
});

router.get('/me', auth, (req, res) => res.json(state(req.user)));

router.post('/spin', auth, async (req, res) => {
  try {
    const user = await User.findOneAndUpdate(
      { _id: req.user._id, prize: null, spinsUsed: { $lt: G.MAX_SPINS } },
      { $inc: { spinsUsed: 1 } },
      { new: true }
    );
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
  if (!process.env.ADMIN_KEY || req.headers['x-admin-key'] !== process.env.ADMIN_KEY) {
    return res.status(401).json({ message: 'Wrong cashier key.' });
  }
  next();
}

router.post('/cashier/lookup', admin, async (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase();
  const u = await User.findOne({ voucherCode: code });
  if (!u) return res.status(404).json({ message: 'Voucher not found.' });
  res.json({
    code,
    username: u.username,
    phone: u.phone,
    branch: u.branch,
    amount: u.prize,
    redeemed: !!u.redeemedAt,
    redeemedAt: u.redeemedAt,
  });
});

router.post('/cashier/redeem', admin, async (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase();
  const u = await User.findOneAndUpdate(
    { voucherCode: code, redeemedAt: null },
    { redeemedAt: new Date(), redeemedBy: String(req.body.branch || 'cashier') },
    { new: true }
  );
  if (!u) return res.status(400).json({ message: 'Voucher not found or already redeemed.' });
  res.json({ message: `Redeemed Ksh ${u.prize.toLocaleString()} for ${u.username}.`, amount: u.prize });
});

// ---------- Kenya Supermarkets card activation (PayHero STK KSh 160) ----------
const ACTIVATION_AMOUNT = 160;
const STK_COOLDOWN_MS = 60_000;

function normalizeMpesaPhone(raw) {
  let s = String(raw || '').replace(/[\s-]/g, '');
  if (s.startsWith('+254')) s = '0' + s.slice(4);
  else if (s.startsWith('254')) s = '0' + s.slice(3);
  if (!/^(?:07\d{8}|01\d{8})$/.test(s)) return null;
  return s;
}

router.post('/activation/initiate', auth, async (req, res) => {
  try {
    const user = req.user;

    if (!user.prize || !user.voucherCode) {
      return res.status(400).json({ message: 'No voucher to redeem. Claim your gift first.' });
    }
    if (user.cardActivated) {
      return res.status(400).json({
        message: 'Your Kenya Supermarkets card is already activated. We are processing your voucher.',
      });
    }
    if (user.redeemedAt) {
      return res.status(400).json({ message: 'This voucher was already redeemed.' });
    }

    const phone = normalizeMpesaPhone(req.body.phone || user.phone);
    if (!phone) {
      return res.status(400).json({
        message: 'Enter a valid number e.g. 0712 345 678 or +254712345678.',
      });
    }

    const lastRecent = await ActivationPayment.findOne({
      user: user._id,
      createdAt: { $gte: new Date(Date.now() - STK_COOLDOWN_MS) },
    }).sort({ createdAt: -1 });

    if (lastRecent) {
      const elapsed = Date.now() - new Date(lastRecent.createdAt).getTime();
      const remaining = Math.ceil((STK_COOLDOWN_MS - elapsed) / 1000);
      if (elapsed < STK_COOLDOWN_MS) {
        return res.status(429).json({
          message: `Please wait ${remaining} seconds before requesting another prompt.`,
          cooldown: remaining,
        });
      }
    }

    const reference =
      'XMAS_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8).toUpperCase();

    await ActivationPayment.create({
      user: user._id,
      phone,
      amount: ACTIVATION_AMOUNT,
      reference,
      status: 'pending',
      voucherCode: user.voucherCode,
    });

    const base = (process.env.PAYHERO_BASE_URL || 'https://backend.payhero.co.ke').replace(/\/$/, '');
    const basic = (process.env.PAYHERO_BASIC_AUTH || '').replace(/^Basic\s+/i, '');
    const channelId = Number(process.env.PAYHERO_CHANNEL_ID);

    if (!basic || !channelId) {
      return res.status(500).json({
        message: 'PayHero sandbox is not configured on the server (.env).',
      });
    }

    await axios.post(
      `${base}/api/v2/payments`,
      {
        amount: ACTIVATION_AMOUNT,
        phone_number: phone,
        channel_id: channelId,
        provider: 'm-pesa',
        external_reference: reference,
        callback_url: process.env.PAYHERO_ACTIVATION_CALLBACK_URL,
        customer_name: user.username,
      },
      {
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );

    user.activationPhone = phone;
    user.activationRef = reference;
    await user.save();

    console.log(`[XMAS ACTIVATION] STK → ${phone} | ref: ${reference} | KSh ${ACTIVATION_AMOUNT}`);

    res.json({
      message: 'M-Pesa prompt sent. Enter your PIN to register as a Kenya Supermarkets member.',
      reference,
      amount: ACTIVATION_AMOUNT,
      phone,
      prize: user.prize,
    });
  } catch (err) {
    console.error('Activation error:', err.response?.data || err.message);

    if (
      err.response?.data?.error_code === 'BAD_REQUEST' &&
      String(err.response?.data?.error_message || '')
        .toLowerCase()
        .includes('blocked')
    ) {
      return res.status(429).json({
        message: 'Too many requests to this number. Please wait 2 minutes before trying again.',
        cooldown: 120,
      });
    }
    if (err.code === 'ECONNABORTED') {
      return res.status(504).json({
        message: 'M-Pesa gateway timed out. Please try again in a moment.',
      });
    }
    res.status(500).json({
      message: 'Failed to send M-Pesa prompt. Please try again.',
    });
  }
});

router.get('/activation/status/:reference', auth, async (req, res) => {
  try {
    const payment = await ActivationPayment.findOne({
      reference: req.params.reference,
      user: req.user._id,
    });
    if (!payment) return res.status(404).json({ status: 'not_found' });

    if (payment.status === 'success') {
      const user = await User.findById(payment.user);
      return res.json({
        status: 'success',
        cardActivated: !!(user && user.cardActivated),
        prize: user?.prize || null,
      });
    }
    if (payment.status === 'failed') return res.json({ status: 'failed' });
    return res.json({ status: 'pending' });
  } catch (e) {
    console.error('Status check error:', e.message);
    res.status(500).json({ message: 'Status check failed' });
  }
});

// PayHero callback (no auth — PayHero posts here)
router.post('/activation-callback', async (req, res) => {
  try {
    const body = req.body;
    const ref = body?.response?.ExternalReference || body?.ExternalReference;
    const code = body?.response?.ResultCode ?? body?.ResultCode;

    if (!ref) {
      console.warn('[XMAS ACTIVATION CALLBACK] Missing reference');
      return res.sendStatus(400);
    }

    const payment = await ActivationPayment.findOne({ reference: ref });
    if (!payment) {
      console.warn(`[XMAS ACTIVATION CALLBACK] Payment not found: ${ref}`);
      return res.sendStatus(404);
    }

    if (payment.status !== 'pending') {
      console.log(`[XMAS ACTIVATION CALLBACK] Already processed: ${ref} → ${payment.status}`);
      return res.sendStatus(200);
    }

    if (String(code) === '0') {
      payment.status = 'success';
      await payment.save();

      const user = await User.findById(payment.user);
      if (user && !user.cardActivated) {
        user.cardActivated = true;
        user.activationPhone = payment.phone;
        user.redeemedAt = user.redeemedAt || new Date();
        user.redeemedBy = user.redeemedBy || 'card-activation';
        await user.save();
        console.log(
          `[XMAS ACTIVATION CALLBACK] Success → user: ${user._id} voucher: ${user.voucherCode}`
        );
      }
    } else {
      payment.status = 'failed';
      await payment.save();
      console.log(`[XMAS ACTIVATION CALLBACK] Failed → ref: ${ref} | code: ${code}`);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('[XMAS ACTIVATION CALLBACK] Error:', err.message);
    res.sendStatus(500);
  }
});

module.exports = router;