const { Product } = require('../models');
const { addMonths, today } = require('../utils/dates');

/* Products with an expiration date, split into already-expired and expiring within N months (default 3).
   Archived products and products with no stock on hand are ignored — nothing to act on.
   Accepts optional preloadedProducts array to avoid redundant DB queries during /api/bootstrap. */
async function expiryReport(settings, preloadedProducts) {
  const months = (settings && settings.expiryWarningMonths) || 3;
  const t = today();
  const cutoff = addMonths(t, months);
  const prods = Array.isArray(preloadedProducts)
    ? preloadedProducts
        .filter(p => !p.archived && p.expirationDate && p.stock > 0)
        .sort((a, b) => String(a.expirationDate).localeCompare(String(b.expirationDate)))
    : await Product.find({ archived: { $ne: true }, expirationDate: { $nin: [null, ''] }, stock: { $gt: 0 } }).sort({ expirationDate: 1 }).lean();

  const expired = [], expiring = [];
  prods.forEach(p => {
    const exp = String(p.expirationDate).slice(0, 10);
    const daysLeft = Math.round((new Date(exp) - new Date(t)) / 86400000);
    const row = Object.assign({}, p.toJSON ? p.toJSON() : p, { daysLeft });
    if (exp < t) expired.push(row);
    else if (exp <= cutoff) expiring.push(row);
  });
  return { today: t, cutoff, warningMonths: months, expired, expiring };
}

module.exports = { expiryReport };
