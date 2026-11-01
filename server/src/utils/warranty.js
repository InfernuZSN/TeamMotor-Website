const { today, addDays } = require('./dates');

/* Authoritative warranty status (mirrors Utils.getWarrantyStatus in the frontend). */
function warrantyStatus(w, claims) {
  if (w.status === 'Voided') return 'Voided';
  if ((claims || []).some(c => ['Resolved', 'Approved', 'Claimed'].includes(c.status))) return 'Claimed';
  const exp = (w.warrantyExpiration || '').slice(0, 10);
  if (!exp) return 'Active';
  const t = today();
  if (t > exp) return 'Expired';
  if (exp <= addDays(t, 30)) return 'Expiring Soon';
  return 'Active';
}
module.exports = { warrantyStatus };
