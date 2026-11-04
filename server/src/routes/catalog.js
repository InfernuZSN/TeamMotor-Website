/* categories + suppliers + brands + motorcycle brands (Manage Filters) + products */
const express = require('express');
const { Category, Supplier, Brand, MotorcycleBrand, Product, InventoryTransaction } = require('../models');
const { adminOnly } = require('../middleware/auth');
const { wrap, bad, notFound, conflict } = require('../utils/errors');
const { nextId, nextSeq } = require('../utils/counters');
const { audit, diff } = require('../utils/audit');
const { changeStock } = require('../services/inventory');
const { refreshNotifications } = require('../services/notifications');
const { UNIVERSAL_FIT } = require('../services/filters');

const categories = express.Router();
const suppliers = express.Router();
const brands = express.Router();
const motoBrands = express.Router();
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
suppliers.delete('/:id', adminOnly, wrap(async (req, res) => {
  const s = await Supplier.findOne({ id: req.params.id });
  if (!s) throw notFound('Supplier not found.');
  const used = await Product.countDocuments({ supplier: s.id });
  if (used) throw conflict('"' + s.name + '" is still linked to ' + used + ' product(s) (archived ones count). Change their supplier first.');
  await s.deleteOne();
  await audit(req, 'supplier.delete', 'supplier', s.id, { name: s.name });
  res.json({ ok: true });
}));

/* ---------------- brands (Manage Filters → Manage Brands) ----------------
   Products keep the brand NAME in products.brand, so a rename is applied to every product that uses it, and a brand
   can only be deleted once no product (archived ones included) uses it. */
const escRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sameName = name => new RegExp('^' + escRe(name) + '$', 'i');
function cleanName(v, label, max) {
  const name = String(v || '').trim().replace(/\s+/g, ' ');
  if (!name) throw bad(label + ' is required.');
  if (name.length > max) throw bad(label + ' must be ' + max + ' characters or fewer.');
  return name;
}

brands.get('/', wrap(async (req, res) => res.json(await Brand.find({}).sort({ name: 1 }))));
brands.post('/', adminOnly, wrap(async (req, res) => {
  const name = cleanName(req.body.name, 'Brand name', 30);
  if (await Brand.findOne({ name: sameName(name) })) throw conflict('The brand "' + name + '" already exists.');
  const b = await Brand.create({ id: await nextId('BRD', 3), name });
  await audit(req, 'brand.create', 'brand', b.id, { name });
  res.status(201).json(b);
}));
brands.put('/:id', adminOnly, wrap(async (req, res) => {
  const b = await Brand.findOne({ id: req.params.id });
  if (!b) throw notFound('Brand not found.');
  const name = cleanName(req.body.name, 'Brand name', 30);
  const dup = await Brand.findOne({ name: sameName(name), id: { $ne: b.id } });
  if (dup) throw conflict('The brand "' + name + '" already exists.');
  const oldName = b.name;
  b.name = name;
  await b.save();
  const r = oldName === name ? { modifiedCount: 0 } : await Product.updateMany({ brand: oldName }, { $set: { brand: name, lastUpdated: new Date().toISOString() } });
  await audit(req, 'brand.update', 'brand', b.id, { name, changes: { name: { from: oldName, to: name } }, productsUpdated: r.modifiedCount || 0 });
  res.json(b);
}));
brands.delete('/:id', adminOnly, wrap(async (req, res) => {
  const b = await Brand.findOne({ id: req.params.id });
  if (!b) throw notFound('Brand not found.');
  const used = await Product.countDocuments({ brand: b.name });
  if (used) throw conflict('"' + b.name + '" is still used by ' + used + ' product(s) (archived ones count). Change their brand first.');
  await b.deleteOne();
  await audit(req, 'brand.delete', 'brand', b.id, { name: b.name });
  res.json({ ok: true });
}));

/* ---------------- motorcycle brands + models (Manage Filters → Manage Motorcycle Compatibility) ----------------
   A product's compatibility entry is "<make> <model>". A make or model still used by a product cannot be removed. */
const compatUsers = entries => Product.countDocuments({ compatibility: { $in: entries } });

motoBrands.get('/', wrap(async (req, res) => res.json(await MotorcycleBrand.find({}).sort({ name: 1 }))));
motoBrands.post('/', adminOnly, wrap(async (req, res) => {
  const name = cleanName(req.body.name, 'Motorcycle brand', 30);
  if (await MotorcycleBrand.findOne({ name: sameName(name) })) throw conflict('The motorcycle brand "' + name + '" already exists.');
  const models = [];
  (Array.isArray(req.body.models) ? req.body.models : []).forEach(m => {
    const model = cleanName(m, 'Model name', 30);
    if (!models.some(x => x.toLowerCase() === model.toLowerCase())) models.push(model);
  });
  if (!models.length) throw bad('At least one initial model is required when adding a motorcycle brand.');
  const mb = await MotorcycleBrand.create({ id: await nextId('MOTO', 3), name, models });
  await audit(req, 'moto.create', 'motorcycle_brand', mb.id, { name, models });
  res.status(201).json(mb);
}));
motoBrands.delete('/:id', adminOnly, wrap(async (req, res) => {
  const mb = await MotorcycleBrand.findOne({ id: req.params.id });
  if (!mb) throw notFound('Motorcycle brand not found.');
  const used = mb.models.length ? await compatUsers(mb.models.map(m => mb.name + ' ' + m)) : 0;
  if (used) throw conflict('"' + mb.name + '" models are still used by ' + used + ' product(s) (archived ones count). Remove them from those products first.');
  await mb.deleteOne();
  await audit(req, 'moto.delete', 'motorcycle_brand', mb.id, { name: mb.name, models: mb.models });
  res.json({ ok: true });
}));
motoBrands.post('/:id/models', adminOnly, wrap(async (req, res) => {
  const mb = await MotorcycleBrand.findOne({ id: req.params.id });
  if (!mb) throw notFound('Motorcycle brand not found.');
  const model = cleanName(req.body.model, 'Model name', 30);
  if (mb.models.some(m => m.toLowerCase() === model.toLowerCase())) throw conflict(mb.name + ' ' + model + ' is already on the list.');
  const updated = await MotorcycleBrand.findOneAndUpdate({ id: mb.id }, { $push: { models: model } }, { new: true });
  await audit(req, 'moto.model_add', 'motorcycle_brand', mb.id, { name: mb.name, model });
  res.status(201).json(updated);
}));
motoBrands.delete('/:id/models/:model', adminOnly, wrap(async (req, res) => {
  const mb = await MotorcycleBrand.findOne({ id: req.params.id });
  if (!mb) throw notFound('Motorcycle brand not found.');
  const model = req.params.model;
  if (!mb.models.includes(model)) throw notFound('Model not found.');
  const used = await compatUsers([mb.name + ' ' + model]);
  if (used) throw conflict(mb.name + ' ' + model + ' is still used by ' + used + ' product(s) (archived ones count). Remove it from those products first.');
  const updated = await MotorcycleBrand.findOneAndUpdate({ id: mb.id }, { $pull: { models: model } }, { new: true });
  await audit(req, 'moto.model_remove', 'motorcycle_brand', mb.id, { name: mb.name, model });
  res.json(updated);
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

/* Brand and motorcycle compatibility must come from the Manage Filters lists. Values a product ALREADY has are
   accepted unchanged on edit, so saving an older product never fails because of something it was created with. */
async function checkFilterValues(data, before) {
  if (data.brand !== undefined) {
    data.brand = String(data.brand || '').trim();
    if (data.brand && !(before && before.brand === data.brand)) {
      const match = await Brand.findOne({ name: sameName(data.brand) });
      if (!match) {
        throw bad('Unknown brand "' + data.brand + '". Add it under Manage Filters → Manage Brands first.');
      }
      data.brand = match.name;
    }
  }
  if (data.compatibility !== undefined) {
    if (!Array.isArray(data.compatibility)) throw bad('Compatibility must be a list.');
    const had = new Set((before ? before.compatibility || [] : []).map(x => x.toLowerCase()));
    const fresh = data.compatibility.filter(c => c !== UNIVERSAL_FIT && !had.has(c.toLowerCase()));
    if (fresh.length) {
      const allowed = new Map();
      (await MotorcycleBrand.find({})).forEach(mb => mb.models.forEach(m => {
        const full = mb.name + ' ' + m;
        allowed.set(full.toLowerCase(), full);
      }));
      const unknown = fresh.filter(c => !allowed.has(c.toLowerCase()));
      if (unknown.length) throw bad('Unknown motorcycle model(s): ' + unknown.join(', ') + '. Add them under Manage Filters → Manage Motorcycle Compatibility first.');
      data.compatibility = data.compatibility.map(c => allowed.get(c.toLowerCase()) || c);
    }
  }
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
  await checkFilterValues(data, null);
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
  await checkFilterValues(data, before);
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

module.exports = { categories, suppliers, brands, motoBrands, products };
