const { Product, Warranty, WarrantyClaim, Customer, Notification, Sale } = require('../models');
const { nextId } = require('../utils/counters');
const { getSettings } = require('./settings');
const { addMonths, today } = require('../utils/dates');
const { warrantyStatus } = require('../utils/warranty');

const fmt = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });

let lastRefreshAt = 0;
let refreshInFlight = null;
const THROTTLE_MS = 60 * 1000;

/* Recompute every live alert from the current data and reconcile the notifications collection:
   new conditions are inserted (unread), unchanged ones keep their read flag + original date,
   conditions that no longer apply are removed. Idempotent — safe to call after any stock/sale change. */
async function refreshNotifications(opts) {
  if (opts && opts.throttled && (Date.now() - lastRefreshAt < THROTTLE_MS)) {
    return;
  }
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const [settings, products, warranties, reversedSales, existing] = await Promise.all([
        getSettings(),
        Product.find({ archived: { $ne: true } }).lean(),
        Warranty.find({ status: { $ne: 'Voided' } }).lean(),
        Sale.find({ status: { $in: ['Voided', 'Cancelled', 'Refunded'] }, date: { $gte: sevenDaysAgo } }).sort({ date: -1 }).limit(10).lean(),
        Notification.find({})
      ]);

      const t = today();
      const cutoff = addMonths(t, settings.expiryWarningMonths || 3);
      const desired = new Map();

      products.forEach(p => {
        const add = (type, title, message) => desired.set(type + ':' + p.id, { type, productId: p.id, title, message, link: 'inventory.html' });
        if (p.stock <= 0) add('out-of-stock', 'Out of Stock', p.name + ' is now out of stock.');
        else if (p.stock <= p.reorderLevel) add('low-stock', 'Low Stock', p.name + ' has ' + p.stock + (p.stock === 1 ? ' unit' : ' units') + ' remaining.');
        else if (p.stock <= p.reorderLevel * 1.5) add('restock-reminder', 'Restock Reminder', p.name + ' is approaching its reorder level.');

        if (p.expirationDate && p.stock > 0) {
          const exp = String(p.expirationDate).slice(0, 10);
          if (exp < t) add('expired', 'Product Expired', p.name + ' expired on ' + fmt(exp) + ' (' + p.stock + ' in stock). Remove it from sale.');
          else if (exp <= cutoff) add('expiring-soon', 'Expiring Soon', p.name + ' expires on ' + fmt(exp) + ' (' + p.stock + ' in stock).');
        }
      });

      if (warranties.length) {
        const [claims, customers] = await Promise.all([
          WarrantyClaim.find({ warrantyId: { $in: warranties.map(w => w.id) } }).lean(),
          Customer.find({ id: { $in: warranties.map(w => w.customerId).filter(Boolean) } }).lean()
        ]);
        warranties.forEach(w => {
          if (warrantyStatus(w, claims.filter(c => c.warrantyId === w.id)) !== 'Expiring Soon') return;
          const c = customers.find(x => x.id === w.customerId);
          const prod = products.find(x => x.id === w.productId);
          desired.set('warranty-expiring:' + w.id, {
            type: 'warranty-expiring', warrantyId: w.id, title: 'Warranty Expiring Soon', link: 'warranty.html',
            message: (prod ? prod.name : (w.productName || 'An item')) + ' (' + (c ? c.name : 'Walk-in Customer') + ') expires ' + fmt(w.warrantyExpiration.slice(0, 10)) + '.'
          });
        });
      }

      reversedSales.forEach(s => {
        desired.set('sale-event:' + s.id, {
          type: 'sale-event', title: 'Sale ' + s.status, link: 'sales.html',
          message: 'Sale ' + s.id + ' was ' + s.status.toLowerCase() + ' by ' + (s.voidInfo && s.voidInfo.by ? s.voidInfo.by : 'Admin') + '. Reason: ' + (s.voidInfo && s.voidInfo.reason ? s.voidInfo.reason : 'Reversed') + '.'
        });
      });

      const existingByKey = new Map(existing.map(n => [n.key, n]));
      const stale = existing.filter(n => !desired.has(n.key)).map(n => n._id);
      if (stale.length) await Notification.deleteMany({ _id: { $in: stale } });

      for (const [key, d] of desired) {
        const cur = existingByKey.get(key);
        if (cur) {
          if (cur.message !== d.message) { cur.message = d.message; await cur.save(); }
        } else {
          try {
            await Notification.create(Object.assign({ id: await nextId('NTF', 4), key, date: new Date().toISOString(), read: false }, d));
          } catch (err) {
            if (err.code !== 11000) throw err;
          }
        }
      }
      lastRefreshAt = Date.now();
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

module.exports = { refreshNotifications };
