const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());

/* 'YYYY-MM-DD' + n months, clamping the day (Jan 31 + 1 month = Feb 28/29). */
function addMonths(dateStr, months) {
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number);
  const total = (m - 1) + months;
  const ty = y + Math.floor(total / 12);
  const tm = ((total % 12) + 12) % 12;
  const dim = new Date(ty, tm + 1, 0).getDate();
  return ty + '-' + pad(tm + 1) + '-' + pad(Math.min(d, dim));
}
function addDays(dateStr, days) {
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
function calculateWarrantyExpiry(startDateStr, duration, unit) {
  const u = String(unit || 'months').toLowerCase();
  if (u.startsWith('day')) return addDays(startDateStr, Number(duration));
  if (u.startsWith('year')) return addMonths(startDateStr, Number(duration) * 12);
  return addMonths(startDateStr, Number(duration));
}
/* Shop-local "today" (server TZ; set TZ=Asia/Manila in the environment for PH deployments). */
const today = () => ymd(new Date());

module.exports = { ymd, addMonths, addDays, calculateWarrantyExpiry, today };
