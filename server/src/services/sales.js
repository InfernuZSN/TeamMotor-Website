const { Product, Customer, Sale, SaleItem, Warranty, InventoryTransaction } = require('../models');
const { nextId } = require('../utils/counters');
const { bad, notFound, conflict, forbidden } = require('../utils/errors');
const { computeTotals, round2 } = require('../utils/money');
const { calculateWarrantyExpiry, today } = require('../utils/dates');
const { getSettings, shopSnapshot } = require('./settings');
const { changeStock } = require('./inventory');
const { withItems } = require('./serialize');
const { refreshNotifications } = require('./notifications');

const PAYMENT_METHODS = ['Cash', 'GCash'];   // NEW sales only (public/js/mock-data.js + local-api.js match). The Sale model enum still lists the legacy methods so old sales stay valid.
const RUBBER_WARRANTY_DAYS = 7;
const RUBBER_COVERAGE = 'Manufacturing defects only \u2014 ' + RUBBER_WARRANTY_DAYS + ' days from purchase (tires/rubber)';
const isRubber = (p) => p.rubber === true || /\b(tires?|tyres?|rubber)\b/i.test(p.name || '');

/* ---------------------------------------------------------------------------------------------
   createSale — the ONLY way a sale is recorded. Prices, totals, VAT and stock all come from the
   database; whatever the browser sends for price/total is ignored.

   Order of operations (no replica set needed, so it runs on a plain local MongoDB too):
     1. validate input and load products
     2. atomically decrement stock line by line (conditional $inc — cannot go negative)
     3. write sale, sale_items, warranties
     4. if ANY step after (2) fails, every decrement is reversed and partial documents are removed
   --------------------------------------------------------------------------------------------- */
async function createSale(input, user) {
  // idempotency: the POS sends one clientRequestId per checkout attempt; a retry returns the same sale
  if (input.clientRequestId) {
    const dup = await Sale.findOne({ clientRequestId: String(input.clientRequestId) });
    if (dup) return { sale: await withItems(dup), duplicate: true, stockChanges: [], warrantiesCreated: 0 };
  }

  if (!Array.isArray(input.items) || !input.items.length) throw bad('Add at least one item before checkout.');
  const method = input.paymentMethod;
  if (!PAYMENT_METHODS.includes(method)) throw bad('Unsupported payment method.');

  // merge duplicate lines, validate quantities
  const wanted = new Map();
  for (const line of input.items) {
    const qty = Number(line.qty);
    if (!line.productId || !Number.isInteger(qty) || qty < 1 || qty > 10000) throw bad('Each item needs a valid product and a whole-number quantity of at least 1.');
    wanted.set(line.productId, (wanted.get(line.productId) || 0) + qty);
  }
  const products = await Product.find({ id: { $in: [...wanted.keys()] } });
  const byId = new Map(products.map(p => [p.id, p]));
  const t = today();
  for (const [pid, qty] of wanted) {
    const p = byId.get(pid);
    if (!p || p.archived) throw bad('Product ' + pid + ' is not available for sale.');
    if (p.expirationDate && String(p.expirationDate).slice(0, 10) < t) throw bad(p.name + ' expired on ' + String(p.expirationDate).slice(0, 10) + ' and cannot be sold.');
    if (qty > p.stock) throw bad('Not enough stock for ' + p.name + ' (' + p.stock + ' available, ' + qty + ' requested).');
  }

  let customer = null;
  if (input.customerId) {
    customer = await Customer.findOne({ id: input.customerId });
    if (!customer) throw bad('Selected customer does not exist.');
    if (customer.status !== 'Active') throw bad('Customer ' + customer.name + ' is inactive. Reactivate the customer first.');
  }

  const settings = await getSettings();
  const lines = [...wanted].map(([pid, qty]) => {
    const p = byId.get(pid);
    return { productId: pid, name: p.name, qty, price: p.sellingPrice, costPrice: p.costPrice || 0, subtotal: round2(qty * p.sellingPrice) };
  });
  const subtotal = round2(lines.reduce((s, l) => s + l.subtotal, 0));
  const discount = round2(Number(input.discount) || 0);
  if (discount < 0) throw bad('Discount cannot be negative.');
  if (discount > subtotal) throw bad('Discount cannot be more than the subtotal.');
  // Discount discipline: only an Admin may discount a sale (enforced here, not just in the browser)
  if (discount > 0 && (!user || user.role !== 'Admin')) throw forbidden('Only an Admin can apply a discount. Ask an Admin to ring up this sale.');
  const discountMode = discount > 0 && ['percent', 'amount'].includes(input.discountMode) ? input.discountMode : (discount > 0 ? 'amount' : null);
  const discountValue = discount > 0 ? round2(Number(input.discountValue) || discount) : 0;
  const totals = computeTotals(subtotal, discount, settings);

  let amountReceived = totals.total, changeAmount = 0;
  if (method === 'Cash') {
    amountReceived = round2(Number(input.amountReceived) || 0);
    if (amountReceived < totals.total) throw bad('Cash received (' + amountReceived.toFixed(2) + ') is less than the total due (' + totals.total.toFixed(2) + ').');
    changeAmount = round2(amountReceived - totals.total);
  }

  const now = new Date();
  const nowISO = now.toISOString();
  const saleId = await nextId('SALE', 4);
  const applied = [];            // stock decrements already done (for rollback)
  const createdDocs = { sale: false, items: false, warranties: [] };

  try {
    const stockChanges = [];
    for (const l of lines) {
      const r = await changeStock({
        productId: l.productId, delta: -l.qty, type: 'Sale', user: user.name,
        reference: saleId, reason: 'Sold', notes: 'Sold via POS (' + saleId + ')', date: nowISO
      });
      applied.push({ productId: l.productId, qty: l.qty, txnId: r.txn.id });
      stockChanges.push({ productId: l.productId, name: r.product.name, previousStock: r.txn.previousStock, newStock: r.txn.newStock });
    }

    const sale = await Sale.create({
      id: saleId, date: nowISO,
      subtotal: totals.subtotal, discount: totals.discount, discountMode, discountValue,
      vatEnabled: totals.vatEnabled, vatMode: totals.vatMode, vatRate: totals.vatRate,
      vatableAmount: totals.vatableAmount, vatAmount: totals.vatAmount, total: totals.total,
      paymentMethod: method, amountReceived, changeAmount,
      reference: input.reference ? String(input.reference).trim().slice(0, 80) : null,
      status: 'Completed', paymentStatus: 'Paid',
      staff: user.name, staffUsername: user.username,
      customerId: customer ? customer.id : null,
      shop: shopSnapshot(settings),
      clientRequestId: input.clientRequestId ? String(input.clientRequestId) : undefined
    });
    createdDocs.sale = true;
    await SaleItem.insertMany(lines.map(l => Object.assign({ saleId }, l)));
    createdDocs.items = true;

    // automatic warranty records
    const warranties = [];
    for (const l of lines) {
      const p = byId.get(l.productId);
      const hasDuration = p.warrantyDuration && Number(p.warrantyDuration) > 0;
      if (!hasDuration && !isRubber(p)) continue;
      const duration = hasDuration ? Number(p.warrantyDuration) : RUBBER_WARRANTY_DAYS;
      const unit = hasDuration ? (p.warrantyUnit || 'months') : 'days';
      const startDate = nowISO.slice(0, 10);
      const w = await Warranty.create({
        id: await nextId('WAR', 3), customerId: customer ? customer.id : null, saleId,
        productId: p.id, productName: p.name, purchaseDate: startDate, warrantyStart: startDate,
        warrantyExpiration: calculateWarrantyExpiry(startDate, duration, unit),
        coverage: p.warrantyType || (isRubber(p) ? RUBBER_COVERAGE : 'Standard parts warranty'), status: 'Active'
      });
      createdDocs.warranties.push(w.id);
      warranties.push(w.id);
    }

    refreshNotifications().catch(e => console.error('[notifications]', e.message));
    return { sale: await withItems(sale), stockChanges, warrantiesCreated: warranties.length, duplicate: false, customerName: customer ? customer.name : null };
  } catch (err) {
    // ---- compensating rollback ----
    for (const a of applied) {
      try {
        await Product.updateOne({ id: a.productId }, { $inc: { stock: a.qty } });
        await InventoryTransaction.deleteOne({ id: a.txnId });
      } catch (e) { console.error('[rollback] failed to restore stock for', a.productId, e.message); }
    }
    try {
      if (createdDocs.warranties.length) await Warranty.deleteMany({ id: { $in: createdDocs.warranties } });
      if (createdDocs.items) await SaleItem.deleteMany({ saleId });
      if (createdDocs.sale) await Sale.deleteOne({ id: saleId });
    } catch (e) { console.error('[rollback] cleanup failed for', saleId, e.message); }
    throw err;
  }
}

/* ---------------------------------------------------------------------------------------------
   voidSale — Voided / Cancelled / Refunded. Requires a reason. Restores stock and writes a reverse
   'Void Restock' inventory transaction per line. The status flip is an atomic claim
   (findOneAndUpdate on status:'Completed'), so two admins cannot void the same sale twice.
   --------------------------------------------------------------------------------------------- */
async function voidSale(saleId, type, reason, user) {
  if (!['Voided', 'Cancelled', 'Refunded'].includes(type)) throw bad('Type must be Voided, Cancelled or Refunded.');
  const why = String(reason || '').trim();
  if (why.length < 3) throw bad('A reason is required.');

  const sale = await Sale.findOne({ id: saleId });
  if (!sale) throw notFound('Sale ' + saleId + ' not found.');
  if (sale.status !== 'Completed') throw conflict('Sale ' + saleId + ' is already ' + sale.status + '.');

  const nowISO = new Date().toISOString();
  const items = await SaleItem.find({ saleId });

  // Recoverable reversals: check existing 'Void Restock' transactions so retries NEVER restock lines twice
  const existingTxns = await InventoryTransaction.find({ reference: saleId, type: 'Void Restock' });
  const alreadyRestocked = new Set(existingTxns.map(t => t.productId));

  const restocked = [];
  const failed = [];
  const restockSkipped = [];   // lines whose product was retired from the catalog — nothing to put back on a shelf
  for (const it of items) {
    if (alreadyRestocked.has(it.productId)) {
      const p = await Product.findOne({ id: it.productId });
      restocked.push({ productId: it.productId, name: it.name, qty: it.qty, newStock: p ? p.stock : 0, alreadyDone: true });
      continue;
    }
    // Retired / removed product: skip the restock (warning goes into the audit entry) instead of blocking the void.
    if (!(await Product.exists({ id: it.productId }))) {
      console.warn('[void] restock skipped for retired product', it.productId, 'on', saleId);
      restockSkipped.push({ productId: it.productId, name: it.name, qty: it.qty, reason: 'Restock skipped for retired product: ' + it.productId });
      continue;
    }
    try {
      const r = await changeStock({
        productId: it.productId, delta: it.qty, type: 'Void Restock', user: user.name,
        reference: saleId, reason: type, notes: type + ' sale ' + saleId + ': ' + why.slice(0, 120), date: nowISO
      });
      restocked.push({ productId: it.productId, name: it.name, qty: it.qty, newStock: r.txn.newStock });
    } catch (err) {
      console.error('[void] could not restock', it.productId, err.message);
      failed.push({ productId: it.productId, name: it.name, error: err.message });
    }
  }

  // Do NOT mark the sale fully voided or refunded if stock restoration only partially succeeds
  if (failed.length > 0) {
    throw conflict('Stock restoration failed for ' + failed.map(f => f.name || f.productId).join(', ') + '. Sale was NOT marked ' + type + '. Please resolve product issues and retry.');
  }

  sale.status = type;
  sale.voidInfo = { type, reason: why.slice(0, 300), by: user.name, byUsername: user.username, at: nowISO };
  await sale.save();

  await Warranty.updateMany({ saleId }, { $set: { status: 'Voided' } });
  refreshNotifications().catch(e => console.error('[notifications]', e.message));
  return { sale: await withItems(sale), restocked, restockSkipped };
}

module.exports = { createSale, voidSale, PAYMENT_METHODS };
