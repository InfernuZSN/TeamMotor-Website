const router = require('express').Router();
const { Product, InventoryTransaction, Supplier } = require('../models');
const { adminOnly } = require('../middleware/auth');
const { wrap, bad, notFound } = require('../utils/errors');
const { audit } = require('../utils/audit');
const { changeStock, adjustStock, computeActiveBatches, resolveEarliestBatchExpiry } = require('../services/inventory');
const { refreshNotifications, createActivityNotification } = require('../services/notifications');
const { calculateWarrantyExpiry, today, manilaDate } = require('../utils/dates');

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
  if (!v) return new Date().toISOString();
  const now = new Date();
  const vDate = String(v).slice(0, 10);
  if (vDate === today()) {
    return now.toISOString();
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }).formatToParts(now);
    const map = {};
    for (const p of parts) map[p.type] = p.value;
    const timeStr = `${map.hour || '12'}:${map.minute || '00'}:${map.second || '00'}`;
    const d = new Date(`${v}T${timeStr}+08:00`);
    if (!isNaN(d.getTime())) {
      if (d.getTime() > now.getTime() + 5 * 60000) return now.toISOString();
      return d.toISOString();
    }
  }
  const d = new Date(v);
  if (isNaN(d)) throw bad('Invalid date.');
  if (d.getTime() > now.getTime() + 5 * 60000) throw bad('Date cannot be in the future.');
  return d.toISOString();
}

router.post('/stock-in', wrap(async (req, res) => {
  const qty = parseQty(req.body.quantity);
  const parsedDate = parseDate(req.body.date);
  const [existingProd, supplier] = await Promise.all([
    Product.findOne({ id: req.body.productId }).lean(),
    req.body.supplierId ? Supplier.findOne({ id: req.body.supplierId }).select('id').lean() : Promise.resolve(true)
  ]);
  if (!existingProd) throw notFound('Product ' + req.body.productId + ' not found.');
  if (req.body.supplierId && !supplier) throw bad('Unknown supplier.');

  const prodUpdates = { lastUpdated: new Date().toISOString() };
  if (req.body.costPrice !== undefined && req.body.costPrice !== null && req.body.costPrice !== '') {
    const cp = Number(req.body.costPrice);
    if (!Number.isFinite(cp) || cp < 0) throw bad('Cost price must be a non-negative number.');
    prodUpdates.costPrice = cp;
  }

  let batchExp = null;
  if (req.body.expirationDate !== undefined && req.body.expirationDate !== '') {
    const expStr = String(req.body.expirationDate).trim();
    if (expStr && !/^\d{4}-\d{2}-\d{2}$/.test(expStr)) throw bad('Expiration date must be in YYYY-MM-DD format.');
    batchExp = expStr || null;
  } else if (existingProd.shelfLifeDuration > 0) {
    const baseDate = parsedDate ? manilaDate(new Date(parsedDate)) : today();
    batchExp = calculateWarrantyExpiry(baseDate, existingProd.shelfLifeDuration, existingProd.shelfLifeUnit || 'days');
  }
  if (batchExp) {
    if (existingProd.stock > 0 && existingProd.expirationDate && existingProd.expirationDate < batchExp) {
      prodUpdates.expirationDate = existingProd.expirationDate;
    } else {
      prodUpdates.expirationDate = batchExp;
    }
  }

  if (req.body.storageLocation !== undefined && req.body.storageLocation !== '') {
    const loc = String(req.body.storageLocation).trim();
    if (loc.length > 120) throw bad('Storage location must be 120 characters or fewer.');
    prodUpdates.storageLocation = loc;
  }

  const r = await changeStock({
    productId: req.body.productId, delta: qty, type: 'Stock In', user: req.user.name,
    supplierId: req.body.supplierId, reference: req.body.reference, notes: req.body.notes, date: parsedDate,
    expirationDate: batchExp,
    extraSet: prodUpdates
  });

  const postOps = [
    audit(req, 'stock.in', 'product', r.product.id, { productId: r.product.id, productName: r.product.name, qty, from: r.txn.previousStock, to: r.txn.newStock, reference: req.body.reference || null, notes: req.body.notes || null, supplierId: req.body.supplierId || null })
  ];
  if (req.body.supplierId) {
    const deliveryDate = parsedDate ? manilaDate(new Date(parsedDate)) : today();
    postOps.push(Supplier.updateOne({ id: req.body.supplierId }, { $set: { lastDelivery: deliveryDate } }));
  }
  await Promise.all(postOps);
  const notification = await createActivityNotification({
    key: 'event:stock-in:' + r.txn.id,
    type: 'stock-in',
    productId: r.product.id,
    title: 'Stock In',
    message: r.product.name + ': +' + qty + (qty === 1 ? ' unit' : ' units') + ' stocked in (' + r.txn.previousStock + ' \u2192 ' + r.txn.newStock + ') by ' + (req.user.name || 'Staff') + '.',
    link: 'inventory.html'
  }).catch(() => null);
  await refreshNotifications().catch(() => {});
  res.status(201).json({ product: r.product, transaction: r.txn, notification });
}));

router.post('/stock-out', wrap(async (req, res) => {
  const qty = parseQty(req.body.quantity);
  if (!STOCK_OUT_REASONS.includes(req.body.reason)) throw bad('Choose a valid reason for Stock Out.');
  const r = await changeStock({
    productId: req.body.productId, delta: -qty, type: 'Stock Out', user: req.user.name,
    reason: req.body.reason, notes: req.body.notes, date: parseDate(req.body.date)
  });
  await audit(req, 'stock.out', 'product', r.product.id, { productId: r.product.id, productName: r.product.name, qty, reason: req.body.reason, notes: req.body.notes || null, from: r.txn.previousStock, to: r.txn.newStock });
  const notification = await createActivityNotification({
    key: 'event:stock-out:' + r.txn.id,
    type: 'stock-out',
    productId: r.product.id,
    title: 'Stock Out',
    message: r.product.name + ': -' + qty + (qty === 1 ? ' unit' : ' units') + ' stocked out (' + r.txn.previousStock + ' \u2192 ' + r.txn.newStock + ', ' + req.body.reason + ') by ' + (req.user.name || 'Staff') + '.',
    link: 'inventory.html'
  }).catch(() => null);
  await refreshNotifications().catch(() => {});
  res.status(201).json({ product: r.product, transaction: r.txn, notification });
}));

/* Authorized stock adjustment (Admin only): set the on-hand quantity to a counted value, with a mandatory reason. */
router.post('/adjust', adminOnly, wrap(async (req, res) => {
  const newQty = Number(req.body.newQuantity);
  if (!Number.isInteger(newQty) || newQty < 0) throw bad('New quantity must be a whole number, 0 or more.');
  const reason = String(req.body.reason || '').trim();
  if (reason.length < 3) throw bad('A reason is required for every stock adjustment.');
  let batchExpirationDate = null;
  if (req.body.batchExpirationDate) {
    const bExp = String(req.body.batchExpirationDate).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bExp)) throw bad('Batch expiration date must be in YYYY-MM-DD format.');
    batchExpirationDate = bExp;
  }
  const r = await adjustStock({
    productId: req.body.productId,
    newQuantity: newQty,
    expectedStock: req.body.expectedStock,
    batchExpirationDate,
    user: req.user.name,
    reference: 'Manual adjustment',
    reason
  });
  await audit(req, 'stock.adjust', 'product', r.product.id, { productId: r.product.id, productName: r.product.name, qty: Math.abs(r.delta), from: r.txn.previousStock, to: r.txn.newStock, delta: r.delta, reason });
  const notification = await createActivityNotification({
    key: 'event:stock-adjust:' + r.txn.id,
    type: 'stock-adjust',
    productId: r.product.id,
    title: 'Stock Adjusted',
    message: r.product.name + ' stock adjusted from ' + r.txn.previousStock + ' to ' + r.txn.newStock + ' (' + (r.delta >= 0 ? '+' + r.delta : r.delta) + ') by ' + (req.user.name || 'Admin') + '. Reason: ' + reason + '.',
    link: 'inventory.html'
  }).catch(() => null);
  await refreshNotifications().catch(() => {});
  res.status(201).json({ product: r.product, transaction: r.txn, notification });
}));

module.exports = router;
