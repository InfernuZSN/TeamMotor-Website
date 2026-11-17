const BUSINESS_TZ = 'Asia/Manila';
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());

/* Format any Date or ISO timestamp as 'YYYY-MM-DD' in Asia/Manila business timezone. */
function manilaDate(input) {
  const d = input instanceof Date ? input : (input !== undefined && input !== null ? new Date(input) : new Date());
  if (isNaN(d.getTime())) return String(input || '').slice(0, 10);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(d);
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  return `${map.year}-${map.month}-${map.day}`;
}

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
/* Shop-local "today" in Asia/Manila timezone. */
const today = () => manilaDate(new Date());

module.exports = { ymd, addMonths, addDays, calculateWarrantyExpiry, today, manilaDate, BUSINESS_TZ };
