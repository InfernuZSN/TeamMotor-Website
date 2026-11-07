const { Setting } = require('../models');

const DEFAULTS_KEY = 'shop';

async function getSettings() {
  let doc = await Setting.findOne({ key: DEFAULTS_KEY });
  if (!doc) doc = await Setting.create({ key: DEFAULTS_KEY });
  return doc.toJSON();
}

async function updateSettings(patch, user) {
  const allowed = ['shopName', 'tagline', 'addressLines', 'phone', 'tin', 'vatEnabled', 'vatRate', 'vatMode', 'receiptFooter', 'expiryWarningMonths'];
  const set = {};
  allowed.forEach(k => { if (patch[k] !== undefined) set[k] = patch[k]; });
  set.updatedBy = user && user.name; set.updatedAt = new Date().toISOString();
  const doc = await Setting.findOneAndUpdate({ key: DEFAULTS_KEY }, { $set: set }, { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true });
  return doc.toJSON();
}

/* The part of settings that is printed on receipts / snapshotted on each sale. */
const shopSnapshot = (s) => ({
  shopName: s.shopName, tagline: s.tagline, addressLines: s.addressLines, phone: s.phone, tin: s.tin, receiptFooter: s.receiptFooter
});

module.exports = { getSettings, updateSettings, shopSnapshot };
