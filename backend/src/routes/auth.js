const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { User } = require('../models');
const { cityLocation } = require('../lib/geo');
const { HttpError, signToken, authenticate, str } = require('../middleware');

const router = express.Router();
const SELF_REGISTER_ROLES = ['Company', 'Buyer', 'Recycler'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.use(rateLimit({
  windowMs: 15 * 60 * 1000, limit: 100, standardHeaders: 'draft-7', legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
}));

function applyCity(user, city) {
  const loc = cityLocation(city);
  if (city && !loc) throw new HttpError(400, 'Unknown city - pick one from the list');
  if (loc) {
    user.city = loc.city;
    user.location = { lat: loc.lat, lng: loc.lng };
  }
}

router.post('/register', async (req, res) => {
  const { password, role } = req.body || {};
  const name = str(req.body?.name, { name: 'Name', max: 80, required: true });
  const email = str(req.body?.email, { name: 'Email', max: 120, required: true }).toLowerCase();
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Enter a valid email address');
  if (typeof password !== 'string' || password.length < 8) {
    throw new HttpError(400, 'Password must be at least 8 characters');
  }
  if (!SELF_REGISTER_ROLES.includes(role)) {
    throw new HttpError(400, 'Role must be Company, Buyer or Recycler');
  }
  const user = new User({
    name, email, role,
    organization: str(req.body?.organization, { name: 'Organization', max: 120 }),
    passwordHash: await bcrypt.hash(password, 10),
  });
  applyCity(user, req.body?.city);
  await user.save();
  res.status(201).json({ token: signToken(user), user });
});

router.post('/login', async (req, res) => {
  const email = String(req.body?.email || '').toLowerCase().trim();
  const user = await User.findOne({ email }).select('+passwordHash');
  const ok = user && await bcrypt.compare(String(req.body?.password || ''), user.passwordHash);
  if (!ok) throw new HttpError(401, 'Wrong email or password');
  if (user.suspended) throw new HttpError(403, 'This account is suspended');
  res.json({ token: signToken(user), user });
});

router.get('/me', authenticate, (req, res) => res.json({ user: req.user }));

router.patch('/me', authenticate, async (req, res) => {
  const u = req.user;
  if (req.body?.name !== undefined) u.name = str(req.body.name, { name: 'Name', max: 80, required: true });
  if (req.body?.organization !== undefined) u.organization = str(req.body.organization, { name: 'Organization', max: 120 });
  if (req.body?.city !== undefined) applyCity(u, req.body.city);
  await u.save();
  res.json({ user: u });
});

module.exports = router;
