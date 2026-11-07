const { SaleItem, Warranty, WarrantyClaim } = require('../models');

/* Attach sale_items to sales as `items` — the shape the frontend already expects. */
async function withItems(sales) {
  const list = Array.isArray(sales) ? sales : [sales];
  const ids = list.map(s => s.id);
  const items = await SaleItem.find({ saleId: { $in: ids } }).lean();
  const bySale = {};
  items.forEach(i => { (bySale[i.saleId] = bySale[i.saleId] || []).push({ productId: i.productId, name: i.name, qty: i.qty, price: i.price, costPrice: i.costPrice, subtotal: i.subtotal }); });
  const out = list.map(s => Object.assign({}, s.toJSON ? s.toJSON() : s, { items: bySale[s.id] || [] }));
  return Array.isArray(sales) ? out : out[0];
}

/* Attach warranty_claims to warranties as `claims`. */
async function withClaims(warranties) {
  const list = Array.isArray(warranties) ? warranties : [warranties];
  const claims = await WarrantyClaim.find({ warrantyId: { $in: list.map(w => w.id) } }).sort({ date: 1 }).lean();
  const byW = {};
  claims.forEach(c => { delete c._id; (byW[c.warrantyId] = byW[c.warrantyId] || []).push(c); });
  const out = list.map(w => Object.assign({}, w.toJSON ? w.toJSON() : w, { claims: byW[w.id] || [] }));
  return Array.isArray(warranties) ? out : out[0];
}

module.exports = { withItems, withClaims };
