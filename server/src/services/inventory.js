const { Product, InventoryTransaction } = require('../models');
const { nextId } = require('../utils/counters');
const { bad, notFound } = require('../utils/errors');

/* Atomically change a product's stock and write the matching inventory_transactions row.

   Decrements use a conditional update ({stock: {$gte: qty}}) so two cashiers selling the last unit at the
   same moment cannot push stock negative — one of them gets a clear "insufficient stock" error.
   This works on a standalone MongoDB; no replica set / multi-document transaction is required.

   opts: { productId, delta (signed int), type, user (display name), reference, reason, notes, supplierId, date } */
async function changeStock(opts) {
  const delta = Math.trunc(opts.delta);
  if (!delta) throw bad('Quantity change cannot be zero.');
  const filter = { id: opts.productId };
  if (delta < 0) filter.stock = { $gte: -delta };
  const now = new Date().toISOString();
  const updated = await Product.findOneAndUpdate(filter, { $inc: { stock: delta }, $set: { lastUpdated: now } }, { new: true });
  if (!updated) {
    const exists = await Product.findOne({ id: opts.productId }).select('name stock');
    if (!exists) throw notFound('Product ' + opts.productId + ' not found.');
    throw bad('Insufficient stock for ' + exists.name + ' (only ' + exists.stock + ' available).');
  }
  try {
    const txn = await InventoryTransaction.create({
      id: await nextId('TRX', 4),
      productId: updated.id, productName: updated.name, type: opts.type,
      quantity: delta, previousStock: updated.stock - delta, newStock: updated.stock,
      date: opts.date || now, created_at: now, user: opts.user || '',
      supplierId: opts.supplierId || null, reference: opts.reference || null,
      reason: opts.reason || null, notes: opts.notes || ''
    });
    return { product: updated, txn };
  } catch (err) {
    try {
      await Product.updateOne({ id: updated.id }, { $inc: { stock: -delta } });
    } catch (rbErr) {
      console.error('[changeStock] rollback failed for', updated.id, rbErr.message);
    }
    throw err;
  }
}

module.exports = { changeStock };
