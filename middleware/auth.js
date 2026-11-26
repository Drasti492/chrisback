const jwt = require('jsonwebtoken');
const { User } = require('../models/User');

module.exports = async function auth(req, res, next) {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.status(401).json({ message: 'Please log in.' });
    const { id } = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(id);
    if (!user) return res.status(401).json({ message: 'Account not found. Please log in again.' });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ message: 'Session expired. Please log in again.' });
  }
};
