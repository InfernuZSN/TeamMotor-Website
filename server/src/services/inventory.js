const { Product, InventoryTransaction } = require('../models');
const { nextId } = require('../utils/counters');
const { bad, notFound, conflict } = require('../utils/errors');

/* Atomically change a product's stock and write the matching inventory_transactions row.

   Decrements use a conditional update ({stock: {$gte: qty}}) so two cashiers selling the last unit at the
   same moment cannot push stock negative — one of them gets a clear "insufficient stock" error.
   Supports an optional Mongoose `session` when running inside a replica-set transaction, and falls back
   safely on standalone MongoDB instances.

   opts: { productId, delta (signed int), type, user (display name), reference, reason, notes, supplierId, date, session } */
async function changeStock(opts) {
  const delta = Math.trunc(opts.delta);
  if (!delta) throw bad('Quantity change cannot be zero.');
  const filter = { id: opts.productId };
  if (delta < 0) filter.stock = { $gte: -delta };
  const now = new Date().toISOString();
  const setFields = Object.assign({ lastUpdated: now }, opts.extraSet || {});
  const updateOpts = { new: true };
  if (opts.session) updateOpts.session = opts.session;
  const updated = await Product.findOneAndUpdate(filter, { $inc: { stock: delta }, $set: setFields }, updateOpts);
  if (!updated) {
    const existsQuery = Product.findOne({ id: opts.productId }).select('name stock');
    if (opts.session) existsQuery.session(opts.session);
    const exists = await existsQuery;
    if (!exists) throw notFound('Product ' + opts.productId + ' not found.');
    throw bad('Insufficient stock for ' + exists.name + ' (only ' + exists.stock + ' available).');
  }
  try {
    const txnDoc = {
      id: await nextId('TRX', 4, undefined, opts.session),
      productId: updated.id, productName: updated.name, type: opts.type,
      quantity: delta, previousStock: updated.stock - delta, newStock: updated.stock,
      date: opts.date || now, created_at: now, user: opts.user || '',
      supplierId: opts.supplierId || null, reference: opts.reference || null,
      reason: opts.reason || null, notes: opts.notes || ''
    };
    const txn = opts.session
      ? (await InventoryTransaction.create([txnDoc], { session: opts.session }))[0]
      : await InventoryTransaction.create(txnDoc);
    return { product: updated, txn };
  } catch (err) {
    if (!opts.session) {
      try {
        await Product.updateOne({ id: updated.id }, { $inc: { stock: -delta } });
      } catch (rbErr) {
        console.error('[changeStock] rollback failed for', updated.id, rbErr.message);
      }
    }
    throw err;
  }
}

/* Atomically set a product's stock to a counted quantity using compare-and-set on expectedStock (when provided)
   or an atomic findOneAndUpdate so concurrent sales cannot cause a stale delta calculation. */
async function adjustStock(opts) {
  const newQty = Math.trunc(Number(opts.newQuantity));
  if (!Number.isInteger(newQty) || newQty < 0) throw bad('New quantity must be a whole number, 0 or more.');
  const filter = { id: opts.productId };
  if (opts.expectedStock !== undefined && opts.expectedStock !== null && opts.expectedStock !== '') {
    const exp = Math.trunc(Number(opts.expectedStock));
    if (Number.isInteger(exp) && exp >= 0) filter.stock = exp;
  }
  const now = new Date().toISOString();
  const before = await Product.findOneAndUpdate(
    filter,
    { $set: { stock: newQty, lastUpdated: now } },
    { new: false }
  );
  if (!before) {
    const exists = await Product.findOne({ id: opts.productId }).select('name stock');
    if (!exists) throw notFound('Product ' + opts.productId + ' not found.');
    throw conflict('Stock for ' + exists.name + ' changed concurrently (currently ' + exists.stock + '). Please refresh and recount before adjusting.');
  }
  const delta = newQty - before.stock;
  if (delta === 0) {
    throw bad('The new quantity equals the current stock — nothing to adjust.');
  }
  const updated = Object.assign(before.toJSON ? before.toJSON() : Object.assign({}, before), { stock: newQty, lastUpdated: now });
  try {
    const txn = await InventoryTransaction.create({
      id: await nextId('TRX', 4),
      productId: before.id, productName: before.name, type: 'Adjustment',
      quantity: delta, previousStock: before.stock, newStock: newQty,
      date: opts.date || now, created_at: now, user: opts.user || '',
      supplierId: null, reference: opts.reference || 'Manual adjustment',
      reason: opts.reason || null,
      notes: 'Adjusted ' + before.stock + ' \u2192 ' + newQty + '. ' + (opts.reason || '')
    });
    return { product: updated, txn, delta };
  } catch (err) {
    try {
      await Product.updateOne({ id: before.id, stock: newQty }, { $set: { stock: before.stock } });
    } catch (rbErr) {
      console.error('[adjustStock] rollback failed for', before.id, rbErr.message);
    }
    throw err;
  }
}

module.exports = { changeStock, adjustStock };
