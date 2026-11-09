const router = require('express').Router();
const { Customer, Sale, Warranty } = require('../models');
const { adminOnly } = require('../middleware/auth');
const { wrap, bad, notFound, conflict } = require('../utils/errors');
const { nextId } = require('../utils/counters');
const { audit, diff } = require('../utils/audit');
const { withItems, withClaims } = require('../services/serialize');
const { warrantyStatus } = require('../utils/warranty');

const PHONE_RE = /^[0-9+()\-\s]{7,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normPhone = (s) => String(s || '').replace(/[^0-9+]/g, '');

function clean(b, isCreate) {
  const name = String(b.name || '').trim();
  const phone = String(b.contactNumber || '').trim();
  if (!name) throw bad('Customer name is required.');
  if (!phone) throw bad('Phone number is required.');
  if (!PHONE_RE.test(phone)) throw bad('Enter a valid phone number.');
  if (b.email && !EMAIL_RE.test(String(b.email).trim())) throw bad('Enter a valid email address.');
  return { name, contactNumber: phone, email: String(b.email || '').trim(), address: String(b.address || '').trim(), notes: String(b.notes || '').trim().slice(0, 500) };
}
async function assertPhoneFree(phone, exceptId) {
  const norm = normPhone(phone);
  const all = await Customer.find({ status: 'Active', id: { $ne: exceptId || null } }).select('id name contactNumber');
  const dup = all.find(c => normPhone(c.contactNumber) === norm);
  if (dup) throw conflict('That phone number already belongs to ' + dup.name + ' (' + dup.id + ').');
}

/* Per-customer purchase totals from COMPLETED sales only (voided/refunded sales don't count). */
async function statsMap() {
  const rows = await Sale.aggregate([
    { $match: { status: 'Completed', customerId: { $ne: null } } },
    { $group: { _id: '$customerId', totalPurchases: { $sum: 1 }, totalSpent: { $sum: '$total' }, lastPurchase: { $max: '$date' } } }
  ]);
  return new Map(rows.map(r => [r._id, r]));
}
const decorate = (c, stats) => {
  const s = stats.get(c.id) || {};
  return Object.assign({}, c.toJSON ? c.toJSON() : c, { totalPurchases: s.totalPurchases || 0, totalSpent: Math.round((s.totalSpent || 0) * 100) / 100, lastPurchase: s.lastPurchase || null });
};

router.get('/', wrap(async (req, res) => {
  const filter = {};
  if (req.query.status && ['Active', 'Inactive'].includes(req.query.status)) filter.status = req.query.status;
  const [list, stats] = await Promise.all([Customer.find(filter).sort({ id: 1 }).lean(), statsMap()]);
  res.json(list.map(c => decorate(c, stats)));
}));

router.get('/:id', wrap(async (req, res) => {
  const c = await Customer.findOne({ id: req.params.id }).lean();
  if (!c) throw notFound('Customer not found.');
  const [stats, sales, warranties] = await Promise.all([
    statsMap(), Sale.find({ customerId: c.id }).sort({ date: -1 }).limit(500).lean(), Warranty.find({ customerId: c.id }).sort({ warrantyStart: -1 }).lean()
  ]);
  const w = await withClaims(warranties);
  w.forEach(x => { x.status = warrantyStatus(x, x.claims); });
  res.json({ customer: decorate(c, stats), sales: await withItems(sales), warranties: w });
}));

/* Staff may create customers (POS quick-add) and edit them; only Admin can deactivate/reactivate. */
router.post('/', wrap(async (req, res) => {
  const data = clean(req.body, true);
  await assertPhoneFree(data.contactNumber);
  const c = await Customer.create(Object.assign(data, { id: await nextId('CUST', 3), status: 'Active', dateRegistered: new Date().toISOString().slice(0, 10) }));
  await audit(req, 'customer.create', 'customer', c.id, { name: c.name, source: req.body.source || 'customers-page' });
  res.status(201).json(decorate(c, new Map()));
}));

router.put('/:id', wrap(async (req, res) => {
  const c = await Customer.findOne({ id: req.params.id });
  if (!c) throw notFound('Customer not found.');
  const data = clean(req.body);
  if (normPhone(data.contactNumber) !== normPhone(c.contactNumber)) await assertPhoneFree(data.contactNumber, c.id);
  const cBefore = {}; Object.keys(data).forEach(k => { cBefore[k] = c[k]; });
  Object.assign(c, data); await c.save();
  const cch = diff(cBefore, c, Object.keys(data)), cb = {}, ca = {};
  Object.keys(cch).forEach(k => { cb[k] = cch[k].from; ca[k] = cch[k].to; });
  await audit(req, 'customer.update', 'customer', c.id, { name: c.name, before: cb, after: ca });
  res.json(decorate(c, await statsMap()));
}));

/* Soft delete: history, sales and warranties stay linked; the customer just stops appearing in POS. */
router.delete('/:id', adminOnly, wrap(async (req, res) => {
  const c = await Customer.findOneAndUpdate({ id: req.params.id }, { $set: { status: 'Inactive' } }, { new: true });
  if (!c) throw notFound('Customer not found.');
  await audit(req, 'customer.deactivate', 'customer', c.id, { name: c.name });
  res.json(decorate(c, await statsMap()));
}));
router.post('/:id/reactivate', adminOnly, wrap(async (req, res) => {
  const c = await Customer.findOne({ id: req.params.id });
  if (!c) throw notFound('Customer not found.');
  await assertPhoneFree(c.contactNumber, c.id);
  c.status = 'Active'; await c.save();
  await audit(req, 'customer.reactivate', 'customer', c.id, { name: c.name });
  res.json(decorate(c, await statsMap()));
}));

module.exports = router;
