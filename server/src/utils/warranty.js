const { today, addDays } = require('./dates');

function hasConfiguredWarranty(product) {
  if (!product) return false;
  return (Number(product.warrantyDuration) > 0) || (Number(product.warrantyDays) > 0);
}

/* Authoritative warranty status (mirrors Utils.getWarrantyStatus in the frontend). */
function warrantyStatus(w, claims) {
  if (w.status === 'Voided') return 'Voided';
  if ((claims || []).some(c => ['Resolved', 'Approved', 'Claimed'].includes(c.status))) return 'Claimed';
  const exp = (w.warrantyExpiration || '').slice(0, 10);
  if (!exp) return 'Active';
  const t = today();
  if (t > exp) return 'Expired';
  let soonDays = 30;
  const start = (w.warrantyStart || w.purchaseDate || '').slice(0, 10);
  if (start && start <= exp) {
    const totalDays = Math.round((new Date(exp) - new Date(start)) / 86400000);
    if (totalDays > 0 && totalDays <= 30) {
      soonDays = Math.max(1, Math.floor(totalDays * 0.3));
    }
  }
  if (exp <= addDays(t, soonDays)) return 'Expiring Soon';
  return 'Active';
}
module.exports = { warrantyStatus, hasConfiguredWarranty };
