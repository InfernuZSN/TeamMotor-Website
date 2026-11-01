const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { User, Shift } = require('../models');
const { adminOnly } = require('../middleware/auth');
const { wrap, bad, notFound, forbidden } = require('../utils/errors');
const { nextId } = require('../utils/counters');
const { audit, diff } = require('../utils/audit');

const PW_RE = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
const checkPw = (pw) => { if (!PW_RE.test(String(pw || ''))) throw bad('Password must be at least 8 characters and include a letter and a number.'); };
const PHOTO_RE = /^data:image\/[a-z+.-]+;base64,[A-Za-z0-9+/=]+$/;

/* Admin: list / create / update / deactivate users. */
router.get('/', adminOnly, wrap(async (req, res) => { res.json(await User.find({}).sort({ id: 1 })); }));

router.post('/', adminOnly, wrap(async (req, res) => {
  const b = req.body;
  if (!b.name || !b.username) throw bad('Name and username are required.');
  if (!['Admin', 'Staff'].includes(b.role)) throw bad('Role must be Admin or Staff.');
  checkPw(b.password);
  const user = await User.create({
    id: await nextId('USR', 3), name: String(b.name).trim(), username: String(b.username).trim().toLowerCase(),
    email: b.email || '', role: b.role, status: 'Active', contactNumber: b.contactNumber || '', birthDate: b.birthDate || '',
    dateAdded: new Date().toISOString().slice(0, 10), passwordHash: await bcrypt.hash(b.password, 10)
  });
  await audit(req, 'user.create', 'user', user.id, { username: user.username, name: user.name, role: user.role });
  res.status(201).json(user);
}));

router.put('/:id', adminOnly, wrap(async (req, res) => {
  const user = await User.findOne({ id: req.params.id }).select('+tokenVersion');
  if (!user) throw notFound('User not found.');
  const b = req.body, FIELDS = ['name', 'username', 'email', 'contactNumber', 'birthDate', 'role', 'status'];
  const beforeDoc = {}; FIELDS.forEach(k => { beforeDoc[k] = user[k]; });
  if (user.id === req.user.id && ((b.role && b.role !== user.role) || (b.status && b.status !== 'Active'))) {
    throw forbidden('You cannot change your own role or deactivate yourself.');
  }
  ['name', 'email', 'contactNumber', 'birthDate'].forEach(k => { if (b[k] !== undefined) user[k] = String(b[k]).trim(); });
  if (b.username) user.username = String(b.username).trim().toLowerCase();
  if (b.role) { if (!['Admin', 'Staff'].includes(b.role)) throw bad('Invalid role.'); user.role = b.role; }
  if (b.status) { if (!['Active', 'Inactive'].includes(b.status)) throw bad('Invalid status.'); user.status = b.status; }
  if (b.password) { checkPw(b.password); user.passwordHash = await bcrypt.hash(b.password, 10); user.tokenVersion = (user.tokenVersion || 0) + 1; }
  if (user.role !== beforeDoc.role || user.status !== beforeDoc.status) user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();
  const ch = diff(beforeDoc, user, FIELDS), bf = {}, af = {};
  Object.keys(ch).forEach(k => { bf[k] = ch[k].from; af[k] = ch[k].to; });
  await audit(req, 'user.update', 'user', user.id, { targetUsername: user.username, targetName: user.name, before: bf, after: af, passwordReset: !!b.password });
  if (b.password) await audit(req, 'user.password_change', 'user', user.id, { targetUserId: user.id, targetUsername: user.username, changedBy: 'admin' });
  res.json(user);
}));

router.delete('/:id', adminOnly, wrap(async (req, res) => {
  const user = await User.findOne({ id: req.params.id });
  if (!user) throw notFound('User not found.');
  if (user.id === req.user.id) throw forbidden('You cannot delete your own account.');
  await User.deleteOne({ id: user.id });
  await audit(req, 'user.delete', 'user', user.id, { username: user.username, name: user.name, role: user.role });
  res.json({ ok: true });
}));

/* Self-service profile (any authenticated user, own record only). */
router.put('/me/profile', wrap(async (req, res) => {
  const user = await User.findOne({ id: req.user.id });
  const b = req.body, PF = ['name', 'email', 'contactNumber', 'birthDate'], pBefore = {}; PF.forEach(k => { pBefore[k] = user[k]; });
  const photoBefore = user.photo || '';
  ['name', 'email', 'contactNumber', 'birthDate'].forEach(k => { if (b[k] !== undefined) user[k] = String(b[k]).trim(); });
  if (b.photo !== undefined) {
    if (b.photo && !PHOTO_RE.test(b.photo)) throw bad('Photo must be an image data URL.');
    user.photo = b.photo || '';
  }
  await user.save();
  const pc = diff(pBefore, user, PF), pb = {}, pa = {};
  Object.keys(pc).forEach(k => { pb[k] = pc[k].from; pa[k] = pc[k].to; });
  const pd = { targetUsername: user.username, before: pb, after: pa };
  if ((user.photo || '') !== photoBefore) pd.photoChanged = true;
  await audit(req, 'user.profile_update', 'user', user.id, pd);
  res.json(user);
}));

router.put('/me/password', wrap(async (req, res) => {
  const user = await User.findOne({ id: req.user.id }).select('+passwordHash +tokenVersion');
  if (!(await bcrypt.compare(String(req.body.currentPassword || ''), user.passwordHash))) throw bad('Current password is incorrect.');
  checkPw(req.body.newPassword);
  user.passwordHash = await bcrypt.hash(req.body.newPassword, 10);
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();
  await audit(req, 'user.password_change', 'user', user.id, { targetUserId: user.id, targetUsername: user.username, changedBy: 'self' });
  const { signToken } = require('../middleware/auth');
  res.json({ ok: true, token: signToken(user) });
}));

/* ---- Shifts (clock in/out) ---- */
router.get('/shifts/all', adminOnly, wrap(async (req, res) => { res.json(await Shift.find({}).sort({ clockIn: -1 }).limit(1000)); }));
router.get('/shifts/mine', wrap(async (req, res) => { res.json(await Shift.find({ username: req.user.username }).sort({ clockIn: -1 }).limit(200)); }));
router.post('/shifts/clock-in', wrap(async (req, res) => {
  const open = await Shift.findOne({ username: req.user.username, clockOut: null });
  if (open) return res.json(open);
  const shift = await Shift.create({ id: await nextId('SHF', 4), username: req.user.username, name: req.user.name, clockIn: new Date().toISOString(), clockOut: null });
  await audit(req, 'shift.clock_in', 'shift', shift.id, { staffName: req.user.name });
  res.status(201).json(shift);
}));
router.post('/shifts/clock-out', wrap(async (req, res) => {
  const shift = await Shift.findOneAndUpdate({ username: req.user.username, clockOut: null }, { $set: { clockOut: new Date().toISOString() } }, { new: true });
  if (!shift) throw bad('You are not clocked in.');
  await audit(req, 'shift.clock_out', 'shift', shift.id, { staffName: req.user.name });
  res.json(shift);
}));

module.exports = router;
