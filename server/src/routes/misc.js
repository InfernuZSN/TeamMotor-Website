/* notifications, audit trail, settings, reports, bootstrap */
const express = require('express');
const { Notification, AuditLog, Sale, Product, Category, Supplier, Brand, MotorcycleBrand, Customer, InventoryTransaction, Warranty, User, Shift } = require('../models');
const { adminOnly } = require('../middleware/auth');
const { wrap, bad } = require('../utils/errors');
const { audit } = require('../utils/audit');
const { getSettings, updateSettings } = require('../services/settings');
const { refreshNotifications } = require('../services/notifications');
const { expiryReport } = require('../services/expiry');
const { withItems, withClaims } = require('../services/serialize');
const { warrantyStatus } = require('../utils/warranty');

const notifications = express.Router();
notifications.get('/', wrap(async (req, res) => { await refreshNotifications().catch(e => console.error('[notifications] refresh failed:', e.message)); res.json(await Notification.find({}).sort({ date: -1 })); }));
notifications.post('/read-all', wrap(async (req, res) => { await Notification.updateMany({}, { $set: { read: true } }); res.json({ ok: true }); }));
notifications.post('/:id/read', wrap(async (req, res) => { await Notification.updateOne({ id: req.params.id }, { $set: { read: true } }); res.json({ ok: true }); }));

const SENSITIVE_ACTIONS = ['user.password_change', 'auth.login_failed', 'auth.login_blocked', 'sale.void', 'sale.voided', 'sale.cancelled', 'sale.refunded', 'sale.refund',
  'stock.adjust', 'stock.out', 'user.create', 'user.update', 'user.delete', 'product.archive', 'product.delete', 'customer.deactivate', 'settings.update'];

const auditRouter = express.Router();
auditRouter.get('/', adminOnly, wrap(async (req, res) => {
  const q = req.query, filter = {};
  if (q.action) filter.action = new RegExp('^' + String(q.action).replace(/[^a-z0-9_.]/gi, ''));
  if (q.sensitive === '1' || q.sensitive === 'true') {
    const sens = { $in: SENSITIVE_ACTIONS };
    if (filter.action) { filter.$and = [{ action: filter.action }, { action: sens }]; delete filter.action; } else filter.action = sens;
  }
  if (q.user) filter.username = String(q.user).toLowerCase();
  if (q.from || q.to) { filter.at = {}; if (q.from) filter.at.$gte = new Date(q.from); if (q.to) filter.at.$lte = new Date(q.to + 'T23:59:59.999'); }
  if (q.search) {
    const re = new RegExp(String(q.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ entityId: re }, { action: re }, { userName: re }, { username: re }];
  }
  const limit = Math.min(parseInt(q.limit, 10) || 100, 500), page = Math.max(parseInt(q.page, 10) || 1, 1);
  const [rows, total] = await Promise.all([AuditLog.find(filter).sort({ at: -1 }).skip((page - 1) * limit).limit(limit), AuditLog.countDocuments(filter)]);
  res.json({ rows, total, page, pages: Math.ceil(total / limit) });
}));

const settings = express.Router();
settings.get('/', wrap(async (req, res) => res.json(await getSettings())));
settings.put('/', adminOnly, wrap(async (req, res) => {
  const b = req.body;
  if (b.shopName !== undefined && !String(b.shopName).trim()) throw bad('Shop name cannot be empty.');
  if (b.vatRate !== undefined) {
    const r = Number(b.vatRate);
    if (!Number.isFinite(r) || r < 0 || r > 1) throw bad('VAT rate must be between 0% and 100%.');
    b.vatRate = r;
  }
  if (b.vatMode !== undefined && !['inclusive', 'exclusive'].includes(b.vatMode)) throw bad('VAT mode must be inclusive or exclusive.');
  if (b.addressLines !== undefined && !Array.isArray(b.addressLines)) throw bad('addressLines must be a list.');
  if (b.receiptFooter !== undefined && !Array.isArray(b.receiptFooter)) throw bad('receiptFooter must be a list.');
  const before = await getSettings();
  const after = await updateSettings(b, req.user);
  const changed = {};
  Object.keys(b).forEach(k => { if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) changed[k] = { from: before[k], to: after[k] }; });
  await audit(req, 'settings.update', 'settings', 'shop', { changed });
  refreshNotifications().catch(() => {});
  res.json(after);
}));

const reports = express.Router();
reports.get('/expiry', wrap(async (req, res) => res.json(await expiryReport(await getSettings()))));

/* One call that hydrates a page (the browser keeps it in memory — see public/js/store.js). */
const bootstrap = express.Router();
bootstrap.get('/', wrap(async (req, res) => {
  await refreshNotifications().catch(e => console.error('[notifications] refresh failed:', e.message));
  const isAdmin = req.user.role === 'Admin';
  const settingsDoc = await getSettings();
  const [categories, suppliers, products, customers, sales, txns, warranties, notifs, users, expiry, shifts, brands, motoBrands] = await Promise.all([
    Category.find({}).sort({ name: 1 }).lean(),
    Supplier.find({}).sort({ id: 1 }).lean(),
    Product.find({}).sort({ id: 1 }).lean(),
    Customer.find({}).sort({ id: 1 }).lean(),
    Sale.find({}).sort({ date: -1 }).limit(1000).lean(),
    InventoryTransaction.find({}).sort({ date: -1 }).limit(1000).lean(),
    Warranty.find({}).sort({ warrantyStart: -1, id: -1 }).lean(),
    Notification.find({}).sort({ date: -1 }).lean(),
    isAdmin ? User.find({}).sort({ id: 1 }).lean() : User.find({ id: req.user.id }).lean(),
    expiryReport(settingsDoc),
    isAdmin ? Shift.find({}).sort({ clockIn: -1 }).limit(500).lean() : Shift.find({ username: req.user.username }).sort({ clockIn: -1 }).limit(100).lean(),
    Brand.find({}).sort({ name: 1 }).lean(),
    MotorcycleBrand.find({}).sort({ name: 1 }).lean()
  ]);
  const [salesFull, warrantiesFull] = await Promise.all([withItems(sales), withClaims(warranties)]);
  warrantiesFull.forEach(w => { w.status = warrantyStatus(w, w.claims); });
  const stats = await Sale.aggregate([{ $match: { status: 'Completed', customerId: { $ne: null } } }, { $group: { _id: '$customerId', n: { $sum: 1 }, spent: { $sum: '$total' }, last: { $max: '$date' } } }]);
  const sm = new Map(stats.map(s => [s._id, s]));
  const customersFull = customers.map(c => { const s = sm.get(c.id) || {}; return Object.assign(c.toJSON ? c.toJSON() : c, { totalPurchases: s.n || 0, totalSpent: s.spent || 0, lastPurchase: s.last || null }); });
  res.json({
    me: await User.findOne({ id: req.user.id }).lean(), settings: settingsDoc, categories, suppliers, brands, motoBrands, products, customers: customersFull,
    sales: salesFull, inventoryTransactions: txns, warranties: warrantiesFull, notifications: notifs, users, expiry, shifts,
    serverTime: new Date().toISOString()
  });
}));

module.exports = { notifications, auditRouter, settings, reports, bootstrap };
