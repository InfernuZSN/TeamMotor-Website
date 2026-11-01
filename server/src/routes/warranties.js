const router = require('express').Router();
const { Warranty, WarrantyClaim } = require('../models');
const { wrap, bad, notFound, conflict } = require('../utils/errors');
const { nextId } = require('../utils/counters');
const { audit } = require('../utils/audit');
const { withClaims } = require('../services/serialize');
const { warrantyStatus } = require('../utils/warranty');
const { refreshNotifications } = require('../services/notifications');

router.get('/', wrap(async (req, res) => {
  const list = await withClaims(await Warranty.find({}).sort({ warrantyStart: -1, id: -1 }));
  list.forEach(w => { w.status = warrantyStatus(w, w.claims); });
  res.json(list);
}));

router.post('/:id/claims', wrap(async (req, res) => {
  const w = await Warranty.findOne({ id: req.params.id });
  if (!w) throw notFound('Warranty not found.');
  if (w.status === 'Voided') throw conflict('This warranty belongs to a voided sale.');
  const description = String(req.body.description || '').trim(), resolution = String(req.body.resolution || '').trim();
  if (!description || !resolution) throw bad('Defect description and action taken are both required.');
  const status = ['Pending', 'Approved', 'Resolved', 'Rejected'].includes(req.body.status) ? req.body.status : 'Approved';
  const claim = await WarrantyClaim.create({
    id: await nextId('CLM', 3), warrantyId: w.id, date: req.body.date || new Date().toISOString().slice(0, 10),
    description, resolution, status, staff: req.user.name
  });
  await audit(req, 'warranty.claim', 'warranty', w.id, { claimId: claim.id, status, productName: w.productName || null, saleId: w.saleId || null, description: description.slice(0, 200), resolution: resolution.slice(0, 200) });
  refreshNotifications().catch(() => {});
  res.status(201).json(claim);
}));

module.exports = router;
