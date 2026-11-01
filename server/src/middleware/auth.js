const jwt = require('jsonwebtoken');
const config = require('../config');
const { User } = require('../models');
const { HttpError, wrap } = require('../utils/errors');

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role, tv: user.tokenVersion || 0 }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

/* Verifies the Bearer token, then re-reads the user from MongoDB on EVERY request so a deactivated
   user, a role change, or a password change takes effect immediately (not only when the JWT expires). */
const authenticate = wrap(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new HttpError(401, 'Authentication required.');
  let payload;
  try { payload = jwt.verify(token, config.jwtSecret); }
  catch (e) { throw new HttpError(401, e.name === 'TokenExpiredError' ? 'Session expired. Please log in again.' : 'Invalid session.'); }

  const user = await User.findOne({ id: payload.sub }).select('+tokenVersion');
  if (!user || user.status !== 'Active') throw new HttpError(401, 'This account is inactive or no longer exists.');
  if ((user.tokenVersion || 0) !== (payload.tv || 0)) throw new HttpError(401, 'Session no longer valid. Please log in again.');
  req.user = { id: user.id, username: user.username, name: user.name, role: user.role };
  next();
});

/* Role gate — ALWAYS used server-side; hiding a button in the UI is never the only protection. */
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return next(new HttpError(401, 'Authentication required.'));
  if (!roles.includes(req.user.role)) return next(new HttpError(403, 'This action requires ' + roles.join(' or ') + ' access.'));
  next();
};
const adminOnly = requireRole('Admin');

module.exports = { signToken, authenticate, requireRole, adminOnly };
