const router = require('express').Router();
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const { User } = require('../models');
const { signToken, authenticate } = require('../middleware/auth');
const { wrap, bad, HttpError } = require('../utils/errors');
const { audit } = require('../utils/audit');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' }
});

// Constant-time-ish: always run a bcrypt compare so response time doesn't reveal whether a user exists.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

router.post('/login', loginLimiter, wrap(async (req, res) => {
  const ident = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!ident || !password) throw bad('Username and password are required.');

  const user = await User.findOne({ $or: [{ username: ident }, { email: ident }] }).select('+passwordHash');
  const ok = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);
  if (!user || !ok) {
    await audit(req, 'auth.login_failed', 'user', user ? user.id : null, { username: ident });
    throw new HttpError(401, 'Invalid username or password.');
  }
  if (user.status !== 'Active') {
    await audit(req, 'auth.login_blocked', 'user', user.id, { username: user.username, reason: 'inactive' });
    throw new HttpError(403, 'This account is inactive. Please contact an administrator.');
  }
  user.lastLoginAt = new Date(); await user.save();
  req.user = { id: user.id, username: user.username, name: user.name, role: user.role };
  await audit(req, 'auth.login', 'user', user.id, { username: user.username });
  res.json({ token: signToken(user), user: user.toJSON() });
}));

async function verifyGoogleToken({ accessToken, idToken }) {
  if (accessToken) {
    let res;
    try {
      res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
    } catch (err) {
      throw new HttpError(502, 'Could not reach Google verification servers.');
    }
    if (!res.ok) throw new HttpError(401, 'Invalid or expired Google authentication token.');
    const info = await res.json();
    if (!info.email) throw new HttpError(400, 'Google account did not provide an email address.');
    if (info.email_verified === false) throw new HttpError(403, 'Google email address is not verified.');
    return {
      email: String(info.email).trim().toLowerCase(),
      name: info.name || '',
      picture: info.picture || '',
      googleId: info.sub
    };
  }
  if (idToken) {
    let res;
    try {
      res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
    } catch (err) {
      throw new HttpError(502, 'Could not reach Google verification servers.');
    }
    if (!res.ok) throw new HttpError(401, 'Invalid or expired Google ID token.');
    const info = await res.json();
    if (config.googleClientId && info.aud !== config.googleClientId) {
      throw new HttpError(401, 'Google token was issued for a different client ID.');
    }
    if (!info.email) throw new HttpError(400, 'Google account did not provide an email address.');
    if (info.email_verified === 'false' || info.email_verified === false) {
      throw new HttpError(403, 'Google email address is not verified.');
    }
    return {
      email: String(info.email).trim().toLowerCase(),
      name: info.name || '',
      picture: info.picture || '',
      googleId: info.sub
    };
  }
  throw bad('Google access token or ID token is required.');
}

router.get('/google/config', (req, res) => {
  res.json({ clientId: config.googleClientId || '' });
});

router.post('/google', loginLimiter, wrap(async (req, res) => {
  const { accessToken, idToken } = req.body || {};
  let email = String(req.body.email || '').trim().toLowerCase();

  if (accessToken || idToken) {
    const googleUser = await verifyGoogleToken({ accessToken, idToken });
    email = googleUser.email;
  }
  if (!email) throw bad('Google email could not be determined.');

  const user = await User.findOne({
    $or: [
      { email: email },
      { email: new RegExp('^' + email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') }
    ]
  }).select('+passwordHash');
  if (!user) {
    await audit(req, 'auth.login_failed', 'user', null, { email, provider: 'google', reason: 'not_found' });
    throw new HttpError(404, `No TeamMotor account found for Google email "${email}". Please set this email in your TeamMotor User Profile first.`);
  }
  if (user.status !== 'Active') {
    await audit(req, 'auth.login_blocked', 'user', user.id, { username: user.username, email, reason: 'inactive', provider: 'google' });
    throw new HttpError(403, 'This account is inactive. Please contact an administrator.');
  }

  user.lastLoginAt = new Date();
  await user.save();

  req.user = { id: user.id, username: user.username, name: user.name, role: user.role };
  await audit(req, 'auth.login', 'user', user.id, { username: user.username, email: user.email, provider: 'google' });
  res.json({ token: signToken(user), user: user.toJSON() });
}));

router.get('/me', authenticate, wrap(async (req, res) => {
  const user = await User.findOne({ id: req.user.id });
  res.json({ user: user.toJSON() });
}));

router.post('/logout', authenticate, wrap(async (req, res) => {
  await audit(req, 'auth.logout', 'user', req.user.id, { username: req.user.username });
  res.json({ ok: true });     // JWT is stateless; the client discards it. Password change/deactivation invalidates tokens server-side.
}));

module.exports = router;
