const router = require('express').Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const { User } = require('../models');
const { signToken, authenticate } = require('../middleware/auth');
const { wrap, bad, HttpError } = require('../utils/errors');
const { audit } = require('../utils/audit');
const { sendPasswordResetOtpEmail } = require('../services/mailer');

const PW_RE = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const hashOtp = (otp) => crypto.createHash('sha256').update(String(otp)).digest('hex');

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

/* ---------- Forgot Password (6-digit Email OTP flow) ---------- */
async function findUserByEmail(rawEmail) {
  const email = String(rawEmail || '').trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email)) throw bad('Please enter a valid email address.');
  const user = await User.findOne({
    $or: [
      { email },
      { email: new RegExp('^' + email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') }
    ]
  }).select('+passwordHash +tokenVersion +resetOtpHash +resetOtpExpiresAt +resetOtpAttempts +resetOtpVerified');
  return { email, user };
}

router.post('/forgot-password', loginLimiter, wrap(async (req, res) => {
  const { email, user } = await findUserByEmail(req.body && req.body.email);
  if (!user) {
    await audit(req, 'auth.login_failed', 'user', null, { email, action: 'forgot_password', reason: 'email_not_found' });
    throw new HttpError(404, 'No TeamMotor account is registered with that email address.');
  }
  if (user.status !== 'Active') {
    await audit(req, 'auth.login_blocked', 'user', user.id, { username: user.username, email, action: 'forgot_password', reason: 'inactive' });
    throw new HttpError(403, 'This account is inactive. Please contact an administrator.');
  }

  const otp = String(crypto.randomInt(100000, 1000000));
  user.resetOtpHash = hashOtp(otp);
  user.resetOtpExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
  user.resetOtpAttempts = 0;
  user.resetOtpVerified = false;
  await user.save();

  await sendPasswordResetOtpEmail({
    to: user.email,
    name: user.name,
    username: user.username,
    otp
  });

  await audit(req, 'auth.forgot_password_otp_sent', 'user', user.id, { username: user.username, email: user.email });
  res.json({ ok: true, message: 'A 6-digit verification code has been sent to your email.' });
}));

router.post('/verify-otp', loginLimiter, wrap(async (req, res) => {
  const { email, user } = await findUserByEmail(req.body && req.body.email);
  const otp = String((req.body && req.body.otp) || '').trim();
  if (!/^\d{6}$/.test(otp)) throw bad('Please enter a valid 6-digit verification code.');

  if (!user || !user.resetOtpHash || !user.resetOtpExpiresAt) {
    throw bad('Your verification code has expired or was not requested. Please request a new code.');
  }
  if (user.status !== 'Active') {
    throw new HttpError(403, 'This account is inactive. Please contact an administrator.');
  }
  if (Date.now() > new Date(user.resetOtpExpiresAt).getTime()) {
    user.resetOtpHash = null;
    user.resetOtpExpiresAt = null;
    user.resetOtpAttempts = 0;
    user.resetOtpVerified = false;
    await user.save();
    throw bad('Your verification code has expired. Please request a new 6-digit code.');
  }

  if ((user.resetOtpAttempts || 0) >= 5) {
    user.resetOtpHash = null;
    user.resetOtpExpiresAt = null;
    user.resetOtpAttempts = 0;
    user.resetOtpVerified = false;
    await user.save();
    throw new HttpError(429, 'Too many incorrect attempts. Please request a new 6-digit code.');
  }

  const candidateHash = hashOtp(otp);
  const match = candidateHash.length === user.resetOtpHash.length &&
    crypto.timingSafeEqual(Buffer.from(candidateHash, 'utf8'), Buffer.from(user.resetOtpHash, 'utf8'));

  if (!match) {
    user.resetOtpAttempts = (user.resetOtpAttempts || 0) + 1;
    const remaining = 5 - user.resetOtpAttempts;
    if (remaining <= 0) {
      user.resetOtpHash = null;
      user.resetOtpExpiresAt = null;
      user.resetOtpAttempts = 0;
      user.resetOtpVerified = false;
      await user.save();
      throw new HttpError(429, 'Too many incorrect attempts. Please request a new 6-digit code.');
    }
    await user.save();
    throw bad(`Incorrect 6-digit code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`);
  }

  user.resetOtpVerified = true;
  user.resetOtpExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // give 10 minutes to complete new password step
  await user.save();

  res.json({ ok: true, verified: true, username: user.username, name: user.name });
}));

router.post('/reset-password', loginLimiter, wrap(async (req, res) => {
  const { email, user } = await findUserByEmail(req.body && req.body.email);
  const otp = String((req.body && req.body.otp) || '').trim();
  const newPassword = String((req.body && req.body.newPassword) || '');
  const confirmPassword = String((req.body && req.body.confirmPassword) || '');

  if (!/^\d{6}$/.test(otp)) throw bad('Invalid verification session. Please verify your 6-digit code again.');
  if (!newPassword || !confirmPassword) throw bad('Please enter and confirm your new password.');
  if (newPassword !== confirmPassword) throw bad('Passwords do not match. Please re-enter the exact same password in both fields.');
  if (!PW_RE.test(newPassword)) {
    throw bad('Password must be at least 8 characters and include a letter and a number.');
  }

  if (!user || !user.resetOtpHash || !user.resetOtpExpiresAt || !user.resetOtpVerified) {
    throw bad('Your password reset session has expired or was not verified. Please request a new code.');
  }
  if (user.status !== 'Active') {
    throw new HttpError(403, 'This account is inactive. Please contact an administrator.');
  }
  if (Date.now() > new Date(user.resetOtpExpiresAt).getTime()) {
    user.resetOtpHash = null;
    user.resetOtpExpiresAt = null;
    user.resetOtpAttempts = 0;
    user.resetOtpVerified = false;
    await user.save();
    throw bad('Your verification session has expired. Please request a new 6-digit code.');
  }

  const candidateHash = hashOtp(otp);
  const match = candidateHash.length === user.resetOtpHash.length &&
    crypto.timingSafeEqual(Buffer.from(candidateHash, 'utf8'), Buffer.from(user.resetOtpHash, 'utf8'));
  if (!match) {
    throw bad('Verification code mismatch. Please start the password reset process again.');
  }

  user.passwordHash = await bcrypt.hash(newPassword, 10);
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  user.resetOtpHash = null;
  user.resetOtpExpiresAt = null;
  user.resetOtpAttempts = 0;
  user.resetOtpVerified = false;
  await user.save();

  req.user = { id: user.id, username: user.username, name: user.name, role: user.role };
  await audit(req, 'user.password_change', 'user', user.id, {
    targetUserId: user.id,
    targetUsername: user.username,
    changedBy: 'forgot_password_otp'
  });

  res.json({
    ok: true,
    username: user.username,
    message: 'Password reset successful! You can now log in with your new password.'
  });
}));

module.exports = router;
