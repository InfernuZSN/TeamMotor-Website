const router = require('express').Router();
const { Warranty, WarrantyClaim, Product } = require('../models');
const { wrap, bad, notFound, conflict } = require('../utils/errors');
const { nextId } = require('../utils/counters');
const { audit } = require('../utils/audit');
const { withClaims } = require('../services/serialize');
const { warrantyStatus, hasConfiguredWarranty } = require('../utils/warranty');
const { refreshNotifications } = require('../services/notifications');
const { today } = require('../utils/dates');

const ALLOWED_CLAIM_STATUSES = ['Pending', 'Approved', 'Resolved', 'Rejected'];

router.get('/', wrap(async (req, res) => {
  const [rawList, products] = await Promise.all([
    Warranty.find({}).sort({ warrantyStart: -1, id: -1 }).lean().then(withClaims),
    Product.find({}).select('id warrantyDuration warrantyDays').lean()
  ]);
  const prodById = new Map(products.map(p => [p.id, p]));
  const bogusIds = [];
  const list = rawList.filter(w => {
    const prod = prodById.get(w.productId);
    if (prod && !hasConfiguredWarranty(prod)) {
      bogusIds.push(w.id);
      return false;
    }
    return true;
  });
  if (bogusIds.length) {
    Warranty.deleteMany({ id: { $in: bogusIds } }).catch(() => {});
  }
  list.forEach(w => { w.status = warrantyStatus(w, w.claims); });
  res.json(list);
}));

router.post('/:id/claims', wrap(async (req, res) => {
  const w = await Warranty.findOne({ id: req.params.id });
  if (!w) throw notFound('Warranty not found.');
  if (w.status === 'Voided') throw conflict('This warranty belongs to a voided sale.');
  const description = String(req.body.description || '').trim(), resolution = String(req.body.resolution || '').trim();
  if (!description || !resolution) throw bad('Defect description and action taken are both required.');
  let status = 'Pending';
  if (req.body.status !== undefined && req.body.status !== null && String(req.body.status).trim() !== '') {
    const rawStatus = String(req.body.status).trim();
    if (!ALLOWED_CLAIM_STATUSES.includes(rawStatus)) {
      throw bad('Invalid warranty claim status. Allowed values: Pending, Approved, Resolved, Rejected.');
    }
    status = rawStatus;
  }
  const claimId = await nextId('CLM', 3);
  const [claim] = await Promise.all([
    WarrantyClaim.create({
      id: claimId, warrantyId: w.id, date: req.body.date || today(),
      description, resolution, status, staff: req.user.name
    }),
    audit(req, 'warranty.claim', 'warranty', w.id, { claimId, status, productName: w.productName || null, saleId: w.saleId || null, description: description.slice(0, 200), resolution: resolution.slice(0, 200) })
  ]);
  refreshNotifications().catch(() => {});
  res.status(201).json(claim);
}));

module.exports = router;
