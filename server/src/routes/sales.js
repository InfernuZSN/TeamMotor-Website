const router = require('express').Router();
const { Sale, SaleItem } = require('../models');
const { adminOnly } = require('../middleware/auth');
const { wrap, bad, notFound, conflict } = require('../utils/errors');
const { audit } = require('../utils/audit');
const { createSale, voidSale } = require('../services/sales');
const { withItems } = require('../services/serialize');
const { getSettings, shopSnapshot } = require('../services/settings');

router.get('/', wrap(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.customerId) filter.customerId = req.query.customerId;
  if (req.query.from || req.query.to) { filter.date = {}; if (req.query.from) filter.date.$gte = req.query.from; if (req.query.to) filter.date.$lte = req.query.to; }
  const sales = await Sale.find(filter).sort({ date: -1 }).limit(Math.min(parseInt(req.query.limit, 10) || 5000, 10000));
  res.json(await withItems(sales));
}));

router.get('/:id', wrap(async (req, res) => {
  const sale = await Sale.findOne({ id: req.params.id });
  if (!sale) throw notFound('Sale not found.');
  res.json(await withItems(sale));
}));

router.post('/', wrap(async (req, res) => {
  const result = await createSale(Object.assign({}, req.body, { clientRequestId: req.body.clientRequestId || req.headers['idempotency-key'] }), req.user);
  if (!result.duplicate) {
    await audit(req, 'sale.create', 'sale', result.sale.id, {
      total: result.sale.total, items: result.sale.items.length, paymentMethod: result.sale.paymentMethod,
      subtotal: result.sale.subtotal, discount: result.sale.discount,
      discountMode: result.sale.discount > 0 ? result.sale.discountMode : null, discountValue: result.sale.discount > 0 ? result.sale.discountValue : null,
      reference: result.sale.reference || null,
      customerId: result.sale.customerId, customerName: result.customerName || null
    });
  }
  res.status(result.duplicate ? 200 : 201).json(result);
}));

/* Void / Cancel / Refund — Admin only, reason required. Restores stock and writes reverse transactions. */
router.post('/:id/void', adminOnly, wrap(async (req, res) => {
  if (String((req.body && req.body.reason) || '').trim().length < 3) throw bad('A reason is required to void, cancel or refund a sale.');
  const result = await voidSale(req.params.id, req.body.type || 'Voided', req.body.reason, req.user);
  await audit(req, 'sale.' + result.sale.status.toLowerCase(), 'sale', result.sale.id, {
    type: result.sale.status, reason: String(req.body.reason || '').trim(), total: result.sale.total, paymentMethod: result.sale.paymentMethod,
    itemCount: (result.sale.items || []).reduce((n, i) => n + (i.qty || 0), 0), originalStaff: result.sale.staff || null,
    restocked: result.restocked, restockSkipped: result.restockSkipped || []
  });
  res.json(result);
}));

/* Reprint: returns the ORIGINAL transaction (items, prices, VAT, tender, shop details as they were at sale time)
   and records the reprint — count, timestamp and an audit-trail entry — before the browser prints. */
router.post('/:id/reprint', wrap(async (req, res) => {
  const reprintedAt = new Date().toISOString();
  const sale = await Sale.findOneAndUpdate({ id: req.params.id }, { $inc: { reprintCount: 1 }, $set: { lastReprintAt: reprintedAt } }, { new: true });
  if (!sale) throw notFound('Sale not found.');
  await audit(req, 'sale.reprint', 'sale', sale.id, { reprintNumber: sale.reprintCount, status: sale.status, context: req.body.context || 'sales-page', saleId: sale.id, saleTotal: sale.total, paymentMethod: sale.paymentMethod });
  const full = await withItems(sale);
  if (!full.shop) full.shop = shopSnapshot(await getSettings());     // very old sales without a snapshot
  res.json({ sale: full, reprintedAt, reprintNumber: sale.reprintCount, reprintedBy: req.user.name });
}));

module.exports = router;
