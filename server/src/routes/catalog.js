/* categories + suppliers + products */
const express = require('express');
const { Category, Supplier, Product, InventoryTransaction } = require('../models');
const { adminOnly } = require('../middleware/auth');
const { wrap, bad, notFound, conflict } = require('../utils/errors');
const { nextId, nextSeq } = require('../utils/counters');
const { audit, diff } = require('../utils/audit');
const { changeStock } = require('../services/inventory');
const { refreshNotifications } = require('../services/notifications');

const categories = express.Router();
const suppliers = express.Router();
const products = express.Router();

/* ---------------- categories ---------------- */
categories.get('/', wrap(async (req, res) => res.json(await Category.find({}).sort({ name: 1 }))));
categories.post('/', adminOnly, wrap(async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) throw bad('Category name is required.');
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  if (await Category.findOne({ id })) throw conflict('That category already exists.');
  const taken = (await Category.find({}).select('prefix')).map(c => c.prefix);
  let prefix = (req.body.prefix || name.replace(/[^A-Za-z]/g, '').slice(0, 3)).toUpperCase().padEnd(3, 'X');
  for (let i = 0; taken.includes(prefix) && i < 26; i++) prefix = prefix.slice(0, 2) + String.fromCharCode(65 + i);
  if (taken.includes(prefix)) throw conflict('Could not derive a unique prefix.');
  const cat = await Category.create({ id, name, prefix });
  await audit(req, 'category.create', 'category', id, { name, prefix });
  res.status(201).json(cat);
}));
categories.put('/:id', adminOnly, wrap(async (req, res) => {
  const cat = await Category.findOne({ id: req.params.id });
  if (!cat) throw notFound('Category not found.');
  const set = {};
  if (req.body.name !== undefined) {
    const name = String(req.body.name || '').trim();
    if (!name) throw bad('Category name is required.');
    set.name = name;
  }
  if (req.body.status !== undefined) {
    if (!['Active', 'Inactive'].includes(req.body.status)) throw bad('Status must be Active or Inactive.');
    set.status = req.body.status;
  }
  if (req.body.prefix !== undefined) {
    const prefix = String(req.body.prefix || '').trim().toUpperCase();
    if (prefix) set.prefix = prefix;
  }
  const catBefore = cat.toObject ? cat.toObject() : cat;
  const updated = await Category.findOneAndUpdate({ id: req.params.id }, { $set: set }, { new: true, runValidators: true });
  await audit(req, 'category.update', 'category', updated.id, { name: updated.name, changes: diff(catBefore, updated, Object.keys(set)) });
  res.json(updated);
}));
categories.delete('/:id', adminOnly, wrap(async (req, res) => {
  const cat = await Category.findOne({ id: req.params.id });
  if (!cat) throw notFound('Category not found.');
  const used = await Product.countDocuments({ category: cat.id });
  if (used) throw conflict('"' + cat.name + '" still has ' + used + ' product(s) (archived ones count). Move them first.');
  await cat.deleteOne();
  await audit(req, 'category.delete', 'category', cat.id, { name: cat.name });
  res.json({ ok: true });
}));

/* ---------------- suppliers ---------------- */
suppliers.get('/', wrap(async (req, res) => res.json(await Supplier.find({}).sort({ id: 1 }))));
suppliers.post('/', adminOnly, wrap(async (req, res) => {
  if (!req.body.name) throw bad('Supplier name is required.');
  const s = await Supplier.create(Object.assign({}, req.body, { id: await nextId('SUP', 3), status: req.body.status || 'Active' }));
  await audit(req, 'supplier.create', 'supplier', s.id, { name: s.name });
  res.status(201).json(s);
}));
suppliers.put('/:id', adminOnly, wrap(async (req, res) => {
  const allowed = ['name', 'contactPerson', 'contactNumber', 'email', 'address', 'status', 'lastDelivery'];
  const set = {}; allowed.forEach(k => { if (req.body[k] !== undefined) set[k] = req.body[k]; });
  const sBefore = await Supplier.findOne({ id: req.params.id });
  const s = await Supplier.findOneAndUpdate({ id: req.params.id }, { $set: set }, { new: true, runValidators: true });
  if (!s) throw notFound('Supplier not found.');
  await audit(req, 'supplier.update', 'supplier', s.id, { name: s.name, changes: diff(sBefore, s, Object.keys(set)) });
  res.json(s);
}));

/* ---------------- products ---------------- */
const PRODUCT_FIELDS = ['name', 'brand', 'category', 'compatibility', 'compatYears', 'supplier', 'supplierRef', 'sku', 'barcode', 'description',
  'costPrice', 'sellingPrice', 'reorderLevel', 'warrantyDuration', 'warrantyUnit', 'warrantyType', 'warrantyDays', 'rubber', 'expirationDate', 'image', 'storageLocation'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function cleanProduct(body) {
  const out = {};
  PRODUCT_FIELDS.forEach(k => { if (body[k] !== undefined) out[k] = body[k]; });
  if (out.expirationDate !== undefined) {
    if (!out.expirationDate) out.expirationDate = null;
    else if (!DATE_RE.test(out.expirationDate)) throw bad('Expiration date must be YYYY-MM-DD.');
  }
  ['costPrice', 'sellingPrice', 'reorderLevel'].forEach(k => {
    if (out[k] !== undefined && (!Number.isFinite(Number(out[k])) || Number(out[k]) < 0)) throw bad(k + ' must be a non-negative number.');
  });
  if (out.image && out.image.length > 600000) throw bad('Product image is too large — resize it first.');
  return out;
}

products.get('/', wrap(async (req, res) => res.json(await Product.find({}).sort({ id: 1 }))));
products.get('/lookup/:code', wrap(async (req, res) => {
  const code = req.params.code.trim();
  const p = await Product.findOne({ archived: { $ne: true }, $or: [{ barcode: code }, { sku: code }, { id: code.toUpperCase() }] });
  if (!p) throw notFound('No product matches "' + code + '".');
  res.json(p);
}));

products.post('/', wrap(async (req, res) => {
  const data = cleanProduct(req.body);
  if (!data.name || !data.category) throw bad('Name and category are required.');
  if (data.sellingPrice === undefined) throw bad('Selling price is required.');
  const cat = await Category.findOne({ id: data.category });
  if (!cat) throw bad('Unknown category.');
  const stock = Math.max(0, parseInt(req.body.stock, 10) || 0);
  const id = cat.prefix + '-' + String(await nextSeq('PRD-' + cat.prefix)).padStart(3, '0');
  if (!data.sku) data.sku = 'TM-' + id;
  if (!data.barcode) {
    const count = await Product.countDocuments({});
    data.barcode = '4801234567' + String(count + 1).padStart(2, '0');
  }
  const product = await Product.create(Object.assign({}, data, { id, stock: 0, archived: false, lastUpdated: new Date().toISOString() }));
  if (stock > 0) {
    await changeStock({ productId: id, delta: stock, type: 'Stock In', user: req.user.name, supplierId: product.supplier, reference: 'Initial stock', notes: 'Initial stock on product creation' });
  }
  await audit(req, 'product.create', 'product', id, { name: product.name, category: product.category, initialStock: stock, sellingPrice: product.sellingPrice, costPrice: product.costPrice });
  refreshNotifications().catch(() => {});
  res.status(201).json(await Product.findOne({ id }));
}));

products.put('/:id', adminOnly, wrap(async (req, res) => {
  const before = await Product.findOne({ id: req.params.id });
  if (!before) throw notFound('Product not found.');
  const data = cleanProduct(req.body);            // stock is NOT editable here — use stock-in/out or an adjustment
  data.lastUpdated = new Date().toISOString();
  const updated = await Product.findOneAndUpdate({ id: req.params.id }, { $set: data }, { new: true, runValidators: true });
  const changes = {};
  Object.keys(data).forEach(k => {
    if (k === 'lastUpdated' || k === 'image') return;
    if (JSON.stringify(before[k]) !== JSON.stringify(updated[k])) changes[k] = { from: before[k], to: updated[k] };
  });
  await audit(req, 'product.update', 'product', updated.id, { name: updated.name, changes });
  refreshNotifications().catch(() => {});
  res.json(updated);
}));

products.post('/:id/archive', adminOnly, wrap(async (req, res) => {
  const archived = req.body.archived !== false;
  const p = await Product.findOneAndUpdate({ id: req.params.id }, { $set: { archived, lastUpdated: new Date().toISOString() } }, { new: true });
  if (!p) throw notFound('Product not found.');
  await audit(req, archived ? 'product.archive' : 'product.unarchive', 'product', p.id, { name: p.name });
  refreshNotifications().catch(() => {});
  res.json(p);
}));

module.exports = { categories, suppliers, products };
