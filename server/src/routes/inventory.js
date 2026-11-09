const router = require('express').Router();
const { Product, InventoryTransaction, Supplier } = require('../models');
const { adminOnly } = require('../middleware/auth');
const { wrap, bad, notFound } = require('../utils/errors');
const { audit } = require('../utils/audit');
const { changeStock } = require('../services/inventory');
const { refreshNotifications } = require('../services/notifications');

const STOCK_OUT_REASONS = ['Damaged', 'Returned', 'Expired', 'Lost', 'Internal Use', 'Other'];

router.get('/transactions', wrap(async (req, res) => {
  const filter = {};
  if (req.query.productId) filter.productId = req.query.productId;
  if (req.query.type) filter.type = req.query.type;
  res.json(await InventoryTransaction.find(filter).sort({ date: -1, id: -1 }).limit(Math.min(parseInt(req.query.limit, 10) || 3000, 5000)).lean());
}));

function parseQty(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 100000) throw bad('Quantity must be a whole number of at least 1.');
  return n;
}
function parseDate(v) {                                   // backdating is allowed for deliveries, never into the future
  if (!v) return undefined;
  const d = new Date(v);
  if (isNaN(d)) throw bad('Invalid date.');
  if (d.getTime() > Date.now() + 5 * 60000) throw bad('Date cannot be in the future.');
  return d.toISOString();
}

router.post('/stock-in', wrap(async (req, res) => {
  const qty = parseQty(req.body.quantity);
  if (req.body.supplierId && !(await Supplier.findOne({ id: req.body.supplierId }))) throw bad('Unknown supplier.');
  const r = await changeStock({
    productId: req.body.productId, delta: qty, type: 'Stock In', user: req.user.name,
    supplierId: req.body.supplierId, reference: req.body.reference, notes: req.body.notes, date: parseDate(req.body.date)
  });

  const prodUpdates = { lastUpdated: new Date().toISOString() };
  if (req.body.costPrice !== undefined && req.body.costPrice !== null && req.body.costPrice !== '') {
    const cp = Number(req.body.costPrice);
    if (!isNaN(cp) && cp >= 0) prodUpdates.costPrice = cp;
  }
  if (req.body.expirationDate !== undefined && req.body.expirationDate !== '') {
    prodUpdates.expirationDate = req.body.expirationDate || null;
  }
  if (req.body.storageLocation !== undefined && req.body.storageLocation !== '') {
    prodUpdates.storageLocation = String(req.body.storageLocation).trim();
  }
  if (Object.keys(prodUpdates).length > 1) {
    r.product = await Product.findOneAndUpdate({ id: req.body.productId }, { $set: prodUpdates }, { new: true });
  }

  if (req.body.supplierId) await Supplier.updateOne({ id: req.body.supplierId }, { $set: { lastDelivery: (parseDate(req.body.date) || new Date().toISOString()).slice(0, 10) } });
  await audit(req, 'stock.in', 'product', r.product.id, { productId: r.product.id, productName: r.product.name, qty, from: r.txn.previousStock, to: r.txn.newStock, reference: req.body.reference || null, notes: req.body.notes || null, supplierId: req.body.supplierId || null });
  refreshNotifications().catch(() => {});
  res.status(201).json({ product: r.product, transaction: r.txn });
}));

router.post('/stock-out', wrap(async (req, res) => {
  const qty = parseQty(req.body.quantity);
  if (!STOCK_OUT_REASONS.includes(req.body.reason)) throw bad('Choose a valid reason for Stock Out.');
  const r = await changeStock({
    productId: req.body.productId, delta: -qty, type: 'Stock Out', user: req.user.name,
    reason: req.body.reason, notes: req.body.notes, date: parseDate(req.body.date)
  });
  await audit(req, 'stock.out', 'product', r.product.id, { productId: r.product.id, productName: r.product.name, qty, reason: req.body.reason, notes: req.body.notes || null, from: r.txn.previousStock, to: r.txn.newStock });
  refreshNotifications().catch(() => {});
  res.status(201).json({ product: r.product, transaction: r.txn });
}));

/* Authorized stock adjustment (Admin only): set the on-hand quantity to a counted value, with a mandatory reason. */
router.post('/adjust', adminOnly, wrap(async (req, res) => {
  const newQty = Number(req.body.newQuantity);
  if (!Number.isInteger(newQty) || newQty < 0) throw bad('New quantity must be a whole number, 0 or more.');
  const reason = String(req.body.reason || '').trim();
  if (reason.length < 3) throw bad('A reason is required for every stock adjustment.');
  const p = await Product.findOne({ id: req.body.productId });
  if (!p) throw notFound('Product not found.');
  const delta = newQty - p.stock;
  if (delta === 0) throw bad('The new quantity equals the current stock — nothing to adjust.');
  const r = await changeStock({ productId: p.id, delta, type: 'Adjustment', user: req.user.name, reference: 'Manual adjustment', reason, notes: 'Adjusted ' + p.stock + ' \u2192 ' + newQty + '. ' + reason });
  await audit(req, 'stock.adjust', 'product', p.id, { productId: p.id, productName: p.name, qty: Math.abs(delta), from: r.txn.previousStock, to: r.txn.newStock, delta, reason });
  refreshNotifications().catch(() => {});
  res.status(201).json({ product: r.product, transaction: r.txn });
}));

module.exports = router;
