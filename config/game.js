// ---------- ALL GAME RULES LIVE HERE ----------
const MAX_USERS = 5000;          // first 5000 applicants only
const MAX_SPINS = 3;             // tries per customer
const GUARANTEE_LAST_SPIN = true; // 3rd spin always lands a voucher (thank-you project, not gambling)
const P_ZERO = 0.38;             // chance a spin lands on a "Try again" slice

// Replace with the real branch names
const BRANCHES = [
  'Main Branch - Town Centre',
  'Branch 2 - Near School Gate',
  'Branch 3 - Market Road',
  'Branch 4 - Estate Plaza',
  'Branch 5 - Highway Stage',
  'Branch 6 - Shopping Mall',
];

// 18 slices, clockwise from the top. 0 = Try again. 5 zeros, evenly spaced.
const SEGMENTS = [1450, 3240, 0, 5500, 2300, 0, 4670, 1800, 6580, 0, 2870, 3800, 0, 6000, 4200, 2600, 0, 5100];

// Relative weight of each voucher value (bigger = more common). Big ones are rare.
const WEIGHTS = {
  1450: 22, 1800: 20, 2300: 16, 2600: 14, 2870: 12, 3240: 10, 3800: 8,
  4200: 6, 4670: 4, 5100: 3, 5500: 2, 6000: 1.5, 6580: 1,
};

const DEMO_PHONE = '0712345678'; // bypass/demo number (PIN 1234)
const DEMO_PIN = '1234';

module.exports = { MAX_USERS, MAX_SPINS, GUARANTEE_LAST_SPIN, P_ZERO, BRANCHES, SEGMENTS, WEIGHTS, DEMO_PHONE, DEMO_PIN };
