require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');

const app = express();
app.set('trust proxy', 1);
app.use(helmet());
const origins = (process.env.CLIENT_ORIGIN || '*').split(',').map((s) => s.trim());
app.use(cors({ origin: origins.includes('*') ? true : origins }));
app.use(express.json({ limit: '10kb' }));

app.get('/', (req, res) => res.json({ ok: true, service: 'Christmas Giveaway API' }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/game', require('./routes/game'));

const PORT = process.env.PORT || 5000;
mongoose.connect(process.env.MONGODB_URI)
  .then(() => app.listen(PORT, () => console.log(`API running on port ${PORT}`)))
  .catch((e) => { console.error('MongoDB connection failed:', e.message); process.exit(1); });
