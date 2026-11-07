/* ==========================================================================
   mock-data.js
   ----------------------------------------------------------------------
   v2 NOTE: the browser no longer seeds or stores any of this data. Live data comes from the
   Express/MongoDB API (see store.js). This file now serves two purposes only:
     1. the shared `Utils` helpers used by every page, and
     2. the demo fixtures that `server/scripts/seed.js` loads into MongoDB (npm run seed).
   ----------------------------------------------------------------------
   Every "table" the prototype needs, plus small shared helpers (Utils).
   This file only builds DEFAULT_DB — it does not read/write storage.
   store.js decides when DEFAULT_DB gets seeded into localStorage.

   BACKEND NOTE: DEFAULT_DB is shaped exactly like the tables a real
   backend would expose (products, sales, inventoryTransactions,
   suppliers, users, notifications). Swap each array for the response
   of a real endpoint later and the rest of the app does not change.
   ========================================================================== */

/* ---------- Utils: small helpers shared by every page ---------- */
const Utils = {
  formatPHP(amount) {
    // Round to centavos first so float noise (e.g. 427.4999999) never shows; whole pesos stay compact (₱450),
    // amounts with centavos keep both digits (₱427.50) — matching Receipt.peso() on printed receipts.
    const n = Math.round(((Number(amount) || 0) + Number.EPSILON) * 100) / 100;
    const digits = Number.isInteger(n) ? 0 : 2;
    return '₱' + n.toLocaleString('en-PH', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  },
  formatDate(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
  },
  formatDateTime(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }) + ', ' +
      d.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
  },
  formatShortDate(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
  },
  timeAgo(iso) {
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    const days = Math.floor(hrs / 24);
    if (days < 7) return days + 'd ago';
    return Utils.formatShortDate(iso);
  },
  getStockStatus(stock, reorderLevel) {
    if (stock <= 0) return 'Out of Stock';
    if (stock <= reorderLevel) return 'Low Stock';
    return 'In Stock';
  },
  statusClass(status) {
    if (status === 'Out of Stock') return 'badge-danger';
    if (status === 'Low Stock') return 'badge-warn';
    return 'badge-ok';
  },
  escapeHtml(str) {
    if (str == null || str === '') return '';
    const s = String(str);
    if (typeof document !== 'undefined' && document.createElement) {
      const div = document.createElement('div');
      div.textContent = s;
      if (div.innerHTML) return div.innerHTML;
    }
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  },
  pad(num, len) {
    return String(num).padStart(len, '0');
  },
  nextId(prefix, existingIds, padLen) {
    let max = 0;
    existingIds.forEach(id => {
      const m = String(id).match(new RegExp('^' + prefix + '-(\\d+)$'));
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    return prefix + '-' + Utils.pad(max + 1, padLen || 4);
  },
  qs(name) {
    return new URLSearchParams(window.location.search).get(name);
  },
  /* "Now" for every page (POS clock, sale/stock timestamps, dashboard "today"). This used to be pinned to
     Aug 30, 2026 to match the seed data, which made the POS show the wrong date and time; it is now the
     real clock of the device running the app. (Seeded sample sales stay dated Aug 2026.) */
  demoNow() {
    return new Date();
  },
  /* ---- Warranty rules ----
     Rubber items (tires) only carry a short, defect-only warranty:
     RUBBER_WARRANTY_DAYS (7 days) from the purchase date. */
  isRubberItem(product) {
    if (!product) return false;
    if (product.rubber === true) return true;
    return /\b(tires?|tyres?|rubber)\b/i.test(product.name || '');
  },
  warrantyDaysFor(product) {
    return Utils.isRubberItem(product) ? RUBBER_WARRANTY_DAYS : null;
  },
  /* 'YYYY-MM-DD' + n days -> 'YYYY-MM-DD' (no timezone drift) */
  addDaysISO(iso, days) {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + days));
    return dt.toISOString().slice(0, 10);
  },
  /* Uploaded product photo: a resized data URL kept on `product.image`. Returns '' when the product only has
     the old category-key value, so callers fall back to the category icon. */
  productImage(p) {
    return p && /^data:image\//.test(p.image || '') ? p.image : '';
  },
  /* Simple inline icon per category — keeps the prototype working
     without needing real product photography. `image` on a product
     just stores this same category key today; later it becomes a
     real uploaded file URL and this function stops being called. */
  categoryIcon(categoryId) {
    const icons = {
      motorcycles: '<circle cx="5" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><polyline points="5,17 9,9 14,9 18,17"/><line x1="9" y1="9" x2="7.5" y2="5.5"/><line x1="14" y1="9" x2="16" y2="6.5"/>',
      lights: '<circle cx="12" cy="12" r="5"/><line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/><line x1="4" y1="12" x2="2" y2="12"/><line x1="22" y1="12" x2="20" y2="12"/>',
      electrical: '<polygon points="13,2 4,14 11,14 10,22 20,9 13,9"/>',
      brakes: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5"/><line x1="12" y1="4" x2="12" y2="7"/><line x1="12" y1="17" x2="12" y2="20"/><line x1="4" y1="12" x2="7" y2="12"/><line x1="17" y1="12" x2="20" y2="12"/>',
      accessories: '<ellipse cx="12" cy="9" rx="7" ry="5"/><line x1="12" y1="14" x2="12" y2="20"/><line x1="8" y1="20" x2="16" y2="20"/>',
      'engine-parts': '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
      bulbs: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
      'engine-oils': '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
      cvt: '<circle cx="7" cy="12" r="4"/><circle cx="17.5" cy="12" r="2.5"/><line x1="7" y1="8" x2="17.5" y2="9.5"/><line x1="7" y1="16" x2="17.5" y2="14.5"/>',
      helmets: '<path d="M3 15a9 9 0 0 1 18 0v3H3z"/><path d="M3 15h11a3 3 0 0 0 3-3V9"/>',
      tools: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.1L3 17.7 6.3 21l6.3-6.3a4 4 0 0 0 5.1-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>',
      'other-parts': '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><line x1="12" y1="3" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="21"/><line x1="3" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="21" y2="12"/><line x1="5.6" y1="5.6" x2="7" y2="7"/><line x1="17" y1="17" x2="18.4" y2="18.4"/><line x1="18.4" y1="5.6" x2="17" y2="7"/><line x1="7" y1="17" x2="5.6" y2="18.4"/>'
    };
    return icons[categoryId] || icons['other-parts'];
  },
  /* Accurate calendar-based warranty expiration calculation (WAR-03: handles month-end clamping) */
  calculateWarrantyExpiry(startDateStr, duration, unit) {
    if (!startDateStr || !duration) return startDateStr;
    const parts = startDateStr.slice(0, 10).split('-').map(Number);
    const year = parts[0];
    const month = parts[1] - 1; // 0-indexed
    const day = parts[2];
    const d = new Date(year, month, day);

    const normUnit = String(unit || 'months').toLowerCase();
    if (normUnit.startsWith('day')) {
      d.setDate(d.getDate() + Number(duration));
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    } else if (normUnit.startsWith('month')) {
      const targetMonthTotal = month + Number(duration);
      const targetYear = year + Math.floor(targetMonthTotal / 12);
      const normalizedMonth = ((targetMonthTotal % 12) + 12) % 12;
      // Day clamping for month lengths (e.g. Jan 31 + 1 month = Feb 28 or 29)
      const daysInTargetMonth = new Date(targetYear, normalizedMonth + 1, 0).getDate();
      const clampedDay = Math.min(day, daysInTargetMonth);
      return targetYear + '-' + String(normalizedMonth + 1).padStart(2, '0') + '-' + String(clampedDay).padStart(2, '0');
    } else if (normUnit.startsWith('year')) {
      const targetYear = year + Number(duration);
      const daysInTargetMonth = new Date(targetYear, month + 1, 0).getDate();
      const clampedDay = Math.min(day, daysInTargetMonth);
      return targetYear + '-' + String(month + 1).padStart(2, '0') + '-' + String(clampedDay).padStart(2, '0');
    }
    return d.toISOString().slice(0, 10);
  },
  /* Authoritative warranty status recalculated against current date and claims history (WAR-04) */
  getWarrantyStatus(w, refDate) {
    if (!w) return 'Active';
    if (w.status === 'Voided') return 'Voided';
    if (w.claims && w.claims.length > 0 && w.claims.some(c => c.status === 'Resolved' || c.status === 'Approved' || c.status === 'Claimed')) {
      return 'Claimed';
    }
    const today = refDate || Utils.demoNow();
    const todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    const expStr = (w.warrantyExpiration || '').slice(0, 10);
    if (!expStr) return 'Active';
    if (todayStr > expStr) {
      return 'Expired';
    }
    const expDate = new Date(expStr);
    const todayDate = new Date(todayStr);
    const diffDays = Math.round((expDate - todayDate) / (1000 * 60 * 60 * 24));
    if (diffDays <= 30 && diffDays >= 0) {
      return 'Expiring Soon';
    }
    return 'Active';
  },
  /* ---- Sales status: only Completed sales count towards revenue, stats and customer totals ---- */
  isCountable(sale) {
    return !sale.status || sale.status === 'Completed';
  },
  saleStatusBadge(status) {
    const s = status || 'Completed';
    const cls = s === 'Completed' ? 'badge-ok' : (s === 'Refunded' ? 'badge-warn' : 'badge-danger');
    return '<span class="badge ' + cls + '">' + s + '</span>';
  },
  /* ---- VAT. MUST match server/src/utils/money.js (the server recalculates and is authoritative). ----
     settings: { vatEnabled, vatRate (0.12), vatMode: 'inclusive' | 'exclusive' } */
  computeTotals(subtotal, discount, settings) {
    const r2 = function (n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; };
    const sub = r2(subtotal);
    const disc = r2(Math.max(0, Math.min(Number(discount) || 0, sub)));
    const net = r2(sub - disc);
    const rate = settings && settings.vatEnabled ? Number(settings.vatRate) || 0 : 0;
    if (!rate) return { subtotal: sub, discount: disc, vatableAmount: net, vatAmount: 0, total: net, vatRate: 0, vatMode: 'inclusive', vatEnabled: false };
    if (settings.vatMode === 'exclusive') {
      const vat = r2(net * rate);
      return { subtotal: sub, discount: disc, vatableAmount: net, vatAmount: vat, total: r2(net + vat), vatRate: rate, vatMode: 'exclusive', vatEnabled: true };
    }
    const vat = r2(net * rate / (1 + rate));
    return { subtotal: sub, discount: disc, vatableAmount: r2(net - vat), vatAmount: vat, total: net, vatRate: rate, vatMode: 'inclusive', vatEnabled: true };
  },
  /* ---- Expiration: 'YYYY-MM-DD' compare, months from settings (default 3) ---- */
  todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  },
  expiryStatus(product, months) {
    const exp = product && product.expirationDate ? String(product.expirationDate).slice(0, 10) : '';
    if (!exp) return null;
    const t = Utils.todayStr();
    if (exp < t) return 'Expired';
    const cutoff = Utils.calculateWarrantyExpiry(t, months || 3, 'months');
    return exp <= cutoff ? 'Expiring Soon' : null;
  },
  expiryBadge(product, months) {
    const st = Utils.expiryStatus(product, months);
    if (!st) return '';
    return '<span class="badge ' + (st === 'Expired' ? 'badge-danger' : 'badge-warn') + '" title="Expires ' + Utils.formatDate(product.expirationDate + 'T00:00:00') + '">' + st + '</span>';
  },
  /* Shows an API/validation error as a toast and returns false (handy in catch blocks). */
  reportError(err) {
    if (typeof showToast === 'function') showToast(err && err.message ? err.message : 'Something went wrong.', 'danger');
    return false;
  },
  /* Disables a button + shows a spinner while an async action runs (double-click protection). */
  async withBusy(btn, fn) {
    if (btn && btn.dataset.busy === '1') return;
    const old = btn ? btn.innerHTML : '';
    if (btn) { btn.dataset.busy = '1'; btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Working...'; }
    try { return await fn(); }
    finally { if (btn) { btn.disabled = false; btn.innerHTML = old; delete btn.dataset.busy; } }
  },
  /* Safe client-side CSV export with UTF-8 BOM and RFC-4180 escaping (MIG-03) */
  exportToCSV(filename, headers, rows) {
    function esc(val) {
      if (val == null) return '""';
      const s = String(val).replace(/"/g, '""');
      return '"' + s + '"';
    }
    const lines = [headers.map(esc).join(',')];
    rows.forEach(r => lines.push(r.map(esc).join(',')));
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
};

const UNIVERSAL_FIT = 'Universal (All Models)';
const PAYMENT_METHODS = ['Cash', 'GCash'];   // accepted for NEW sales — keep in sync with server/src/services/sales.js and local-api.js
const LEGACY_PAYMENT_METHODS = ['Maya', 'Bank Transfer', 'Other'];   // no longer accepted for new sales; old sales that used them stay visible in history and reports
const ALL_PAYMENT_METHODS = PAYMENT_METHODS.concat(LEGACY_PAYMENT_METHODS);

/* Warranty limit for rubber items (tires): defects only, 7 days from purchase. */
const RUBBER_WARRANTY_DAYS = 7;
const RUBBER_WARRANTY_COVERAGE = 'Manufacturing defects only \u2014 ' + RUBBER_WARRANTY_DAYS + ' days from purchase (tires/rubber)';

/* ---------- Categories ---------- */
const CATEGORIES = [
  /* ids of the first six are unchanged (existing products and data point at them); only their display names were
     updated to the shop's category list. The other five are new. js/pos.js colours the POS tabs/tiles by id. */
  { id: 'lights', name: 'Lights', prefix: 'LGT' },
  { id: 'bulbs', name: 'Bulbs', prefix: 'BLB' },
  { id: 'electrical', name: 'Electronics', prefix: 'ELC' },
  { id: 'engine-parts', name: 'Motorcycle Parts', prefix: 'ENG' },
  { id: 'accessories', name: 'Motorcycle Accessories', prefix: 'ACC' },
  { id: 'engine-oils', name: 'Engine Oils / Fluids', prefix: 'OIL' },
  { id: 'brakes', name: 'Brake Systems', prefix: 'BRK' },
  { id: 'cvt', name: 'CVT & Transmission', prefix: 'CVT' },
  { id: 'helmets', name: 'Helmets & Accessories', prefix: 'HLM' },
  { id: 'tools', name: 'Tools & Fluids', prefix: 'TLS' },
  { id: 'other-parts', name: 'Others', prefix: 'OTH' }
];
/* Display names the first six categories had before the rename. Offline mode and the server use this to rename
   an EXISTING database's categories without touching names an admin customised. */
const LEGACY_CATEGORY_NAMES = { lights: 'Lights', electrical: 'Electrical', brakes: 'Brakes', accessories: 'Accessories', 'engine-parts': 'Engine Parts', 'other-parts': 'Other Parts' };

/* ---------- Motorcycle compatibility ---------- */
const MOTO_BRANDS = {
  Yamaha: ['NMAX', 'Aerox', 'Mio i125', 'Sniper 155'],
  Honda: ['Click 125i', 'Click 160', 'Beat', 'ADV 160'],
  Suzuki: ['Burgman Street', 'Raider R150', 'Skydrive']
};

/* ---------- Suppliers ---------- */
const SUPPLIERS = [
  {
    id: 'SUP-001', name: 'MotoParts Central Trading', contactPerson: 'Ramon Cruz',
    contactNumber: '0917-234-5678', email: 'sales@motopartscentral.example',
    lastDelivery: '2026-08-20', status: 'Active'
  },
  {
    id: 'SUP-002', name: 'Yamaha Genuine Parts Distributor', contactPerson: 'Liza Fernandez',
    contactNumber: '0918-345-6789', email: 'orders@yamahaparts.example',
    lastDelivery: '2026-08-24', status: 'Active'
  },
  {
    id: 'SUP-003', name: 'RoadGear Accessories Supply', contactPerson: 'Mark Villanueva',
    contactNumber: '0919-456-7890', email: 'support@ridegear.example',
    lastDelivery: '2026-08-18', status: 'Active'
  }
];

/* ---------- Products ---------- */
/* `brand` = who makes the PART (manufacturer) — separate from `compatibility`,
   which is which MOTORCYCLE the part fits. `compatYears` is descriptive only
   (shown on the form/detail page) and isn't wired into fitment filtering yet.
   Complete motorcycles are no longer sold through the catalog (the old 'motorcycles'
   category and its three listings were removed); see RETIRED_MOTORCYCLE_UNITS below. */
const PRODUCTS = [
  { id: 'BRK-001', sku: 'TM-BRK-001', name: 'NMAX Brake Pad Set', brand: 'Generic', category: 'brakes', compatibility: ['Yamaha NMAX'], compatYears: '2020-2024', supplier: 'SUP-001', supplierRef: 'ABC-BP-014', description: 'Direct-fit front brake pad set for the Yamaha NMAX, sintered compound for consistent stopping power.', costPrice: 280, sellingPrice: 450, stock: 8, reorderLevel: 10, image: 'brakes', archived: false },
  { id: 'BRK-002', sku: 'TM-BRK-002', name: 'Universal Brake Pad Set', brand: 'Generic', category: 'brakes', compatibility: ['Honda Click 125i', 'Honda Click 160', 'Honda Beat'], compatYears: '2019-2025', supplier: 'SUP-001', supplierRef: 'ABC-BP-022', description: 'Standard replacement brake pad set fitting most Honda Click and Beat variants.', costPrice: 220, sellingPrice: 380, stock: 24, reorderLevel: 10, image: 'brakes', archived: false },
  { id: 'ENG-001', sku: 'TM-ENG-001', name: 'Motul 5100 10W-40 (1L)', brand: 'Motul', category: 'engine-oils', compatibility: [UNIVERSAL_FIT], compatYears: 'All Years', supplier: 'SUP-002', supplierRef: 'YGP-OIL-5100', description: 'Ester-based semi-synthetic engine oil, 1 liter bottle. Safe for wet clutch systems.', costPrice: 340, sellingPrice: 460, stock: 30, reorderLevel: 15, image: 'engine-oils', archived: false },
  { id: 'ENG-002', sku: 'TM-ENG-002', name: 'Yamaha Genuine Air Filter', brand: 'Yamaha Genuine', category: 'engine-parts', compatibility: ['Yamaha NMAX', 'Yamaha Aerox'], compatYears: '2018-2024', supplier: 'SUP-002', supplierRef: 'YGP-AF-118', description: 'OEM-spec air filter element for Yamaha NMAX and Aerox.', costPrice: 260, sellingPrice: 420, stock: 3, reorderLevel: 8, image: 'engine-parts', archived: false },
  { id: 'ENG-003', sku: 'TM-ENG-003', name: 'Chain and Sprocket Set 428H', brand: 'RK Chains', category: 'engine-parts', compatibility: ['Suzuki Raider R150'], compatYears: '2017-2023', supplier: 'SUP-001', supplierRef: 'ABC-CS-428', description: 'Complete drive chain and front/rear sprocket set for the Suzuki Raider R150.', costPrice: 1650, sellingPrice: 2350, stock: 6, reorderLevel: 5, image: 'engine-parts', archived: false },
  { id: 'OTH-001', sku: 'TM-OTH-001', name: 'Motorcycle Tire 90/80-14', brand: 'IRC', category: 'other-parts', compatibility: ['Yamaha NMAX', 'Honda Click 125i', 'Honda Beat'], compatYears: 'All Years', supplier: 'SUP-003', supplierRef: 'RGA-TIRE-9080', description: 'Tubeless scooter tire, common 90/80-14 fitment for front or rear.', costPrice: 1450, sellingPrice: 1950, stock: 12, reorderLevel: 6, image: 'other-parts', rubber: true, warrantyDays: RUBBER_WARRANTY_DAYS, warrantyType: 'Defects only', archived: false },
  { id: 'LGT-001', sku: 'TM-LGT-001', name: 'LED Headlight', brand: 'Generic', category: 'lights', compatibility: ['Yamaha NMAX', 'Honda Click 125i'], compatYears: '2018-2025', supplier: 'SUP-001', supplierRef: 'ABC-LH-201', description: 'Bright white LED headlight bulb upgrade with plug-and-play connector.', costPrice: 620, sellingPrice: 980, stock: 15, reorderLevel: 8, image: 'lights', archived: false },
  { id: 'LGT-002', sku: 'TM-LGT-002', name: 'Signal Light (Turn Signal)', brand: 'Generic', category: 'lights', compatibility: [UNIVERSAL_FIT], compatYears: 'All Years', supplier: 'SUP-001', supplierRef: 'ABC-SL-055', description: 'Amber turn signal lamp, universal mount bracket included.', costPrice: 90, sellingPrice: 180, stock: 40, reorderLevel: 15, image: 'lights', archived: false },
  { id: 'LGT-003', sku: 'TM-LGT-003', name: 'Tail Light Assembly', brand: 'Generic', category: 'lights', compatibility: ['Honda Click 125i'], compatYears: '2019-2024', supplier: 'SUP-001', supplierRef: 'ABC-TL-087', description: 'Complete rear tail light housing with brake and running light.', costPrice: 380, sellingPrice: 620, stock: 9, reorderLevel: 10, image: 'lights', archived: false },
  { id: 'LGT-004', sku: 'TM-LGT-004', name: 'Motorcycle Headlight Bulb H4', brand: 'Philips', category: 'lights', compatibility: [UNIVERSAL_FIT], compatYears: 'All Years', supplier: 'SUP-002', supplierRef: 'YGP-H4-012', description: 'Standard H4 halogen replacement bulb, 12V.', costPrice: 60, sellingPrice: 120, stock: 0, reorderLevel: 20, image: 'lights', archived: false },
  { id: 'ELC-001', sku: 'TM-ELC-001', name: 'Motorcycle Horn (12V Waterproof)', brand: 'Generic', category: 'electrical', compatibility: [UNIVERSAL_FIT], compatYears: 'All Years', supplier: 'SUP-003', supplierRef: 'RGA-HRN-009', description: 'Loud waterproof 12V horn, universal wiring.', costPrice: 140, sellingPrice: 280, stock: 22, reorderLevel: 10, image: 'electrical', archived: false },
  { id: 'ELC-002', sku: 'TM-ELC-002', name: 'USB Fast Charger Port', brand: 'Generic', category: 'electrical', compatibility: [UNIVERSAL_FIT], compatYears: 'All Years', supplier: 'SUP-003', supplierRef: 'RGA-USB-033', description: 'Waterproof handlebar-mount USB charging port for phones and dashcams.', costPrice: 110, sellingPrice: 250, stock: 35, reorderLevel: 12, image: 'electrical', archived: false },
  { id: 'ELC-003', sku: 'TM-ELC-003', name: 'LED Flasher Relay', brand: 'Generic', category: 'electrical', compatibility: [UNIVERSAL_FIT], compatYears: 'All Years', supplier: 'SUP-002', supplierRef: 'YGP-FR-041', description: '2-pin electronic flasher relay for LED signal light conversions.', costPrice: 55, sellingPrice: 130, stock: 4, reorderLevel: 10, image: 'electrical', archived: false },
  { id: 'ELC-004', sku: 'TM-ELC-004', name: 'Handlebar Switch Assembly (Left)', brand: 'Yamaha Genuine', category: 'electrical', compatibility: ['Yamaha Aerox', 'Yamaha NMAX'], compatYears: '2018-2024', supplier: 'SUP-002', supplierRef: 'YGP-SW-076', description: 'Left-side handlebar switch housing — horn, signal, and headlight controls.', costPrice: 250, sellingPrice: 480, stock: 11, reorderLevel: 8, image: 'electrical', archived: false },
  { id: 'ACC-001', sku: 'TM-ACC-001', name: 'Motorcycle Side Mirror (Pair)', brand: 'Generic', category: 'accessories', compatibility: [UNIVERSAL_FIT], compatYears: 'All Years', supplier: 'SUP-003', supplierRef: 'RGA-MIR-019', description: 'Universal-fit left and right side mirror set, standard 10mm thread.', costPrice: 180, sellingPrice: 350, stock: 26, reorderLevel: 10, image: 'accessories', archived: false },
  { id: 'BLB-001', sku: 'TM-BLB-001', name: 'H4 LED Bulb 6000K (Pair)', brand: 'Osram', category: 'bulbs', compatibility: [UNIVERSAL_FIT], compatYears: 'All Years', supplier: 'SUP-001', supplierRef: 'ABC-LB-601', description: 'Plug-and-play H4 LED headlight bulbs, cool white.', costPrice: 180, sellingPrice: 320, stock: 30, reorderLevel: 10, image: 'bulbs', archived: false },
  { id: 'BLB-002', sku: 'TM-BLB-002', name: 'T10 Parking Bulb (Pair)', brand: 'Philips', category: 'bulbs', compatibility: [UNIVERSAL_FIT], compatYears: 'All Years', supplier: 'SUP-002', supplierRef: 'YGP-T10-020', description: 'Small wedge parking / position bulbs.', costPrice: 25, sellingPrice: 60, stock: 60, reorderLevel: 20, image: 'bulbs', archived: false },
  { id: 'BLB-003', sku: 'TM-BLB-003', name: 'Signal Bulb 12V 21W (Single)', brand: 'Philips', category: 'bulbs', compatibility: [UNIVERSAL_FIT], compatYears: 'All Years', supplier: 'SUP-001', supplierRef: 'ABC-SB-021', description: 'Amber/clear turn-signal bulb, BA15S base.', costPrice: 18, sellingPrice: 45, stock: 4, reorderLevel: 12, image: 'bulbs', archived: false },
  { id: 'OIL-002', sku: 'TM-OIL-002', name: 'Petron Sprint 4T 10W-40 (1L)', brand: 'Petron', category: 'engine-oils', compatibility: [UNIVERSAL_FIT], compatYears: 'All Years', supplier: 'SUP-002', supplierRef: 'YGP-OIL-4T', description: 'Mineral 4-stroke engine oil, 1 liter.', costPrice: 230, sellingPrice: 320, stock: 40, reorderLevel: 15, image: 'engine-oils', archived: false },
  { id: 'OIL-003', sku: 'TM-OIL-003', name: 'Gear Oil 80W-90 (120ml)', brand: 'Motul', category: 'engine-oils', compatibility: [UNIVERSAL_FIT], compatYears: 'All Years', supplier: 'SUP-002', supplierRef: 'YGP-GO-120', description: 'Transmission gear oil for scooters.', costPrice: 40, sellingPrice: 75, stock: 50, reorderLevel: 20, image: 'engine-oils', archived: false },
  { id: 'OIL-004', sku: 'TM-OIL-004', name: 'Radiator Coolant (1L)', brand: 'Prestone', category: 'engine-oils', compatibility: [UNIVERSAL_FIT], compatYears: 'All Years', supplier: 'SUP-001', supplierRef: 'ABC-RC-100', description: 'Ready-to-use coolant for liquid-cooled scooters.', costPrice: 110, sellingPrice: 180, stock: 18, reorderLevel: 8, image: 'engine-oils', archived: false },
  { id: 'CVT-001', sku: 'TM-CVT-001', name: 'CVT Drive Belt (NMAX)', brand: 'Yamaha Genuine', category: 'cvt', compatibility: ['Yamaha NMAX'], compatYears: '2018-2024', supplier: 'SUP-002', supplierRef: 'YGP-DB-NMX', description: 'OEM-spec V-belt for the Yamaha NMAX.', costPrice: 780, sellingPrice: 1250, stock: 7, reorderLevel: 5, image: 'cvt', archived: false },
  { id: 'CVT-002', sku: 'TM-CVT-002', name: 'CVT Drive Belt (Click)', brand: 'Honda Genuine', category: 'cvt', compatibility: ['Honda Click 125i', 'Honda Click 160'], compatYears: '2018-2025', supplier: 'SUP-001', supplierRef: 'ABC-DB-CLK', description: 'Replacement drive belt for Honda Click 125i / 160.', costPrice: 650, sellingPrice: 980, stock: 10, reorderLevel: 5, image: 'cvt', archived: false },
  { id: 'CVT-003', sku: 'TM-CVT-003', name: 'Roller Weight Set 12g (6pcs)', brand: 'Generic', category: 'cvt', compatibility: ['Yamaha Mio i125', 'Honda Beat', 'Honda Click 125i'], compatYears: 'All Years', supplier: 'SUP-001', supplierRef: 'ABC-RW-12', description: 'Tuning roller weights, 12 g, set of 6.', costPrice: 160, sellingPrice: 290, stock: 16, reorderLevel: 8, image: 'cvt', archived: false },
  { id: 'HLM-001', sku: 'TM-HLM-001', name: 'Open-Face Helmet (Medium)', brand: 'Spyder', category: 'helmets', compatibility: [UNIVERSAL_FIT], compatYears: 'All Years', supplier: 'SUP-003', supplierRef: 'RGA-HL-OF-M', description: 'Half-shell helmet with sun visor.', costPrice: 650, sellingPrice: 1100, stock: 14, reorderLevel: 5, image: 'helmets', archived: false },
  { id: 'HLM-002', sku: 'TM-HLM-002', name: 'Full-Face Helmet (Large)', brand: 'Spyder', category: 'helmets', compatibility: [UNIVERSAL_FIT], compatYears: 'All Years', supplier: 'SUP-003', supplierRef: 'RGA-HL-FF-L', description: 'Full-face helmet, dual visor, ventilated.', costPrice: 1400, sellingPrice: 2300, stock: 9, reorderLevel: 5, image: 'helmets', archived: false },
  { id: 'HLM-003', sku: 'TM-HLM-003', name: 'Helmet Face Shield (Clear)', brand: 'Generic', category: 'helmets', compatibility: [UNIVERSAL_FIT], compatYears: 'All Years', supplier: 'SUP-003', supplierRef: 'RGA-FS-CLR', description: 'Replacement clear visor.', costPrice: 150, sellingPrice: 280, stock: 20, reorderLevel: 8, image: 'helmets', archived: false },
  { id: 'HLM-004', sku: 'TM-HLM-004', name: 'Riding Gloves (Pair)', brand: 'Generic', category: 'helmets', compatibility: [UNIVERSAL_FIT], compatYears: 'All Years', supplier: 'SUP-003', supplierRef: 'RGA-GL-001', description: 'Touchscreen-friendly riding gloves.', costPrice: 220, sellingPrice: 420, stock: 16, reorderLevel: 6, image: 'helmets', archived: false },
  { id: 'TLS-001', sku: 'TM-TLS-001', name: '8-in-1 Motorcycle Tool Kit', brand: 'Generic', category: 'tools', compatibility: [UNIVERSAL_FIT], compatYears: 'All Years', supplier: 'SUP-003', supplierRef: 'RGA-TK-008', description: 'Compact under-seat tool kit.', costPrice: 280, sellingPrice: 450, stock: 12, reorderLevel: 5, image: 'tools', archived: false },
  { id: 'TLS-002', sku: 'TM-TLS-002', name: 'Tire Pressure Gauge', brand: 'Generic', category: 'tools', compatibility: [UNIVERSAL_FIT], compatYears: 'All Years', supplier: 'SUP-003', supplierRef: 'RGA-TG-010', description: 'Pen-type tire pressure gauge.', costPrice: 120, sellingPrice: 220, stock: 14, reorderLevel: 6, image: 'tools', archived: false },
  { id: 'TLS-003', sku: 'TM-TLS-003', name: 'Chain Lube Spray (400ml)', brand: 'Motul', category: 'tools', compatibility: [UNIVERSAL_FIT], compatYears: 'All Years', supplier: 'SUP-002', supplierRef: 'YGP-CL-400', description: 'Chain lubricant spray.', costPrice: 130, sellingPrice: 240, stock: 25, reorderLevel: 10, image: 'tools', archived: false },
  { id: 'ACC-002', sku: 'TM-ACC-002', name: 'Phone Holder (Handlebar Mount)', brand: 'Generic', category: 'accessories', compatibility: [UNIVERSAL_FIT], compatYears: 'All Years', supplier: 'SUP-003', supplierRef: 'RGA-PH-020', description: 'Adjustable handlebar phone mount.', costPrice: 150, sellingPrice: 320, stock: 22, reorderLevel: 8, image: 'accessories', archived: false },
  { id: 'ACC-003', sku: 'TM-ACC-003', name: 'Seat Cover (Universal)', brand: 'Generic', category: 'accessories', compatibility: [UNIVERSAL_FIT], compatYears: 'All Years', supplier: 'SUP-003', supplierRef: 'RGA-SC-030', description: 'Water-resistant universal seat cover.', costPrice: 160, sellingPrice: 330, stock: 3, reorderLevel: 6, image: 'accessories', archived: false }
];

/* ---------- Users ---------- */
const USERS = [
  { id: 'USR-001', name: 'Ronnie Manalo', username: 'ronnie.manalo', email: 'jerichalmazan14@gmail.com', role: 'Admin', status: 'Active', dateAdded: '2025-01-10', birthDate: '1998-06-14', contactNumber: '+63 917 884 2109' },
  { id: 'USR-002', name: 'Juan Dela Cruz', username: 'juan.delacruz', email: 'juan.delacruz@teammotor.example', role: 'Staff', status: 'Active', dateAdded: '2025-03-15', birthDate: '1996-03-22', contactNumber: '+63 918 345 6789' },
  { id: 'USR-003', name: 'Maria Santos', username: 'maria.santos', email: 'maria.santos@teammotor.example', role: 'Staff', status: 'Active', dateAdded: '2025-06-02', birthDate: '1999-11-05', contactNumber: '+63 919 456 7890' },
  { id: 'USR-004', name: 'Ana Reyes', username: 'ana.reyes', email: 'ana.reyes@teammotor.example', role: 'Staff', status: 'Active', dateAdded: '2026-02-20', birthDate: '2000-08-17', contactNumber: '+63 927 612 3345' },
  { id: 'USR-005', name: 'Carlo Ibarra', username: 'carlo.ibarra', email: 'carlo.ibarra@teammotor.example', role: 'Staff', status: 'Inactive', dateAdded: '2024-11-05', birthDate: '1994-01-30', contactNumber: '+63 935 208 7716' }
];

/* ---------- Deterministic RNG so demo data is stable on every load ---------- */
function makeRng(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return function () {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/* ---------- Sales history (Aug 11 - Aug 30, 2026) ---------- */
function buildSales() {
  const rng = makeRng(20260830);
  const staffPool = ['Juan Dela Cruz', 'Maria Santos', 'Ana Reyes'];
  const paymentPool = ['Cash', 'Cash', 'Cash', 'GCash', 'GCash', 'Bank Transfer'];
  const weights = [
    ['LGT-001', 17], ['BRK-001', 13], ['LGT-002', 10], ['BRK-002', 7],
    ['ELC-002', 6], ['ACC-001', 5], ['ELC-001', 5], ['ENG-001', 4],
    ['LGT-003', 4], ['ENG-002', 3], ['ELC-003', 2], ['LGT-004', 2],
    ['OTH-001', 1], ['ENG-003', 1]
    /* ELC-004 intentionally has no weight entry — a genuine 0-sold slow mover */
  ];
  const totalWeight = weights.reduce((s, w) => s + w[1], 0);
  function pickProduct() {
    let r = rng() * totalWeight;
    for (const [id, w] of weights) {
      if (r < w) return id;
      r -= w;
    }
    return weights[0][0];
  }

  const sales = [];
  let counter = 1;
  for (let day = 11; day <= 30; day++) {
    const salesToday = 1 + Math.floor(rng() * 3);
    for (let n = 0; n < salesToday; n++) {
      const hour = 9 + Math.floor(rng() * 9);
      const minute = Math.floor(rng() * 60);
      const itemCount = 1 + Math.floor(rng() * 2);
      const chosenIds = new Set();
      while (chosenIds.size < itemCount) chosenIds.add(pickProduct());
      const items = Array.from(chosenIds).map(pid => {
        const product = PRODUCTS.find(p => p.id === pid);
        const qty = 1 + Math.floor(rng() * 4);
        return { productId: pid, name: product.name, qty, price: product.sellingPrice, subtotal: qty * product.sellingPrice };
      });
      const total = items.reduce((s, i) => s + i.subtotal, 0);
      const date = new Date(2026, 7, day, hour, minute, 0);
      sales.push({
        id: 'SALE-' + Utils.pad(counter, 4),
        date: date.toISOString(),
        items,
        total,
        paymentMethod: paymentPool[Math.floor(rng() * paymentPool.length)],
        staff: staffPool[Math.floor(rng() * staffPool.length)]
      });
      counter++;
    }
  }
  return sales;
}
const SALES = buildSales();

/* Customer motorcycle-unit purchases — appended to SALES (and used to seed
   Warranty records) so stock, sales totals, and warranty dates all agree. */
const CUSTOMERS = [
  { id: 'CUST-001', name: 'Carlos Mendoza', contactNumber: '0917-511-2234', email: 'carlos.mendoza@mail.example', address: 'Commonwealth Ave, Quezon City', username: 'carlos.mendoza', dateRegistered: '2025-09-18', status: 'Active' },
  { id: 'CUST-002', name: 'Angelica Torres', contactNumber: '0918-622-3345', email: 'angelica.torres@mail.example', address: 'Katipunan Ave, Quezon City', username: 'angelica.torres', dateRegistered: '2026-03-10', status: 'Active' },
  { id: 'CUST-003', name: 'Paolo Ramirez', contactNumber: '0919-733-4456', email: 'paolo.ramirez@mail.example', address: 'Marcos Highway, Marikina City', username: 'paolo.ramirez', dateRegistered: '2024-06-05', status: 'Active' },
  { id: 'CUST-004', name: 'Michael Aquino', contactNumber: '0920-844-5567', email: 'michael.aquino@mail.example', address: 'Aurora Blvd, Quezon City', username: 'michael.aquino', dateRegistered: '2025-01-10', status: 'Active' },
  { id: 'CUST-005', name: 'Jasmine Bautista', contactNumber: '0921-955-6678', email: 'jasmine.bautista@mail.example', address: 'Visayas Ave, Quezon City', username: 'jasmine.bautista', dateRegistered: '2026-07-02', status: 'Active' },
  { id: 'CUST-006', name: 'Bianca Flores', contactNumber: '0922-066-7789', email: 'bianca.flores@mail.example', address: 'Tandang Sora Ave, Quezon City', username: 'bianca.flores', dateRegistered: '2026-08-14', status: 'Active' }
];
/* The three motorcycle units that used to be listed. They are NOT products any more (not in Inventory
   or POS); this only lets the seeded past sales (SALE-MOT-...) keep their names and prices. */
const RETIRED_MOTORCYCLE_UNITS = [
  { id: 'MOT-001', name: 'Honda Click 125i', sellingPrice: 89000 },
  { id: 'MOT-002', name: 'Yamaha NMAX', sellingPrice: 149000 },
  { id: 'MOT-003', name: 'Suzuki Raider R150', sellingPrice: 114000 }
];
const MOTORCYCLE_SALES = [
  { customerId: 'CUST-001', productId: 'MOT-001', date: '2025-09-18T10:15:00', staff: 'Juan Dela Cruz', payment: 'Bank Transfer' },
  { customerId: 'CUST-002', productId: 'MOT-002', date: '2026-03-10T14:40:00', staff: 'Maria Santos', payment: 'Bank Transfer' },
  { customerId: 'CUST-003', productId: 'MOT-003', date: '2024-06-05T11:00:00', staff: 'Juan Dela Cruz', payment: 'Cash' },
  { customerId: 'CUST-004', productId: 'MOT-001', date: '2025-01-10T09:30:00', staff: 'Ana Reyes', payment: 'GCash' }
];
MOTORCYCLE_SALES.forEach((m, i) => {
  const product = PRODUCTS.concat(RETIRED_MOTORCYCLE_UNITS).find(p => p.id === m.productId);
  SALES.push({
    id: 'SALE-MOT-' + Utils.pad(i + 1, 3),
    date: new Date(m.date).toISOString(),
    items: [{ productId: product.id, name: product.name, qty: 1, price: product.sellingPrice, subtotal: product.sellingPrice }],
    total: product.sellingPrice,
    paymentMethod: m.payment,
    staff: m.staff,
    customerId: m.customerId
  });
});

/* ---------- Inventory history, computed backward from current stock
   so the numbers always reconcile (opening stock + all moves = current stock) ---------- */
const MANUAL_INVENTORY_EVENTS = [
  { productId: 'LGT-001', type: 'Stock In', quantity: 20, date: '2026-08-18T09:15:00', user: 'Juan Dela Cruz', supplierId: 'SUP-001', reference: 'PO-1041', notes: 'Restock delivery from MotoParts Central Trading' },
  { productId: 'BRK-001', type: 'Stock In', quantity: 15, date: '2026-08-15T10:00:00', user: 'Maria Santos', supplierId: 'SUP-001', reference: 'PO-1038', notes: 'Restock delivery from MotoParts Central Trading' },
  { productId: 'ACC-001', type: 'Stock In', quantity: 10, date: '2026-08-12T08:30:00', user: 'Maria Santos', supplierId: 'SUP-003', reference: 'PO-1035', notes: 'Restock delivery from RoadGear Accessories Supply' },
  { productId: 'OTH-001', type: 'Stock Out', quantity: 1, date: '2026-08-22T13:40:00', user: 'Ana Reyes', reason: 'Damaged', notes: 'Damaged during handling — written off' },
  { productId: 'ELC-003', type: 'Stock Out', quantity: 2, date: '2026-08-25T11:20:00', user: 'Juan Dela Cruz', reason: 'Returned', notes: 'Defective units returned to supplier' }
];

function buildInventoryTransactions() {
  const transactions = [];
  let counter = 1;
  const openingDate = new Date(2026, 7, 9, 8, 0, 0);

  PRODUCTS.forEach(p => {
    const saleMoves = SALES.flatMap(s => s.items
      .filter(i => i.productId === p.id && s.id.indexOf('SALE-MOT-') !== 0)
      .map(i => ({ date: s.date, type: 'Sale', qty: -i.qty, user: s.staff, reason: 'Sold', notes: 'Sold via POS (' + s.id + ')' })));
    const manualMoves = MANUAL_INVENTORY_EVENTS
      .filter(e => e.productId === p.id)
      .map(e => ({ date: e.date, type: e.type, qty: e.type === 'Stock In' ? e.quantity : -e.quantity, user: e.user, supplierId: e.supplierId, reference: e.reference, reason: e.reason, notes: e.notes }));
    const moves = saleMoves.concat(manualMoves).sort((a, b) => new Date(a.date) - new Date(b.date));
    const netMovement = moves.reduce((sum, m) => sum + m.qty, 0);
    let running = p.stock - netMovement;

    transactions.push({
      id: 'TRX-' + Utils.pad(counter++, 4),
      productId: p.id, productName: p.name, type: 'Stock In',
      quantity: running, previousStock: 0, newStock: running,
      date: openingDate.toISOString(), user: 'Juan Dela Cruz', supplierId: p.supplier, reference: 'Opening count', reason: null, notes: 'Opening stock count'
    });

    moves.forEach(m => {
      const prev = running;
      running += m.qty;
      transactions.push({
        id: 'TRX-' + Utils.pad(counter++, 4),
        productId: p.id, productName: p.name, type: m.type,
        quantity: m.qty, previousStock: prev, newStock: running,
        date: m.date, user: m.user, supplierId: m.supplierId || null, reference: m.reference || null, reason: m.reason || null, notes: m.notes
      });
    });
  });

  return transactions.sort((a, b) => new Date(b.date) - new Date(a.date));
}
const INVENTORY_TRANSACTIONS = buildInventoryTransactions();

/* Derive each product's last-touched date from its own transaction history
   so "Last Updated" reflects real activity instead of a fixed placeholder. */
PRODUCTS.forEach(p => {
  const own = INVENTORY_TRANSACTIONS.filter(t => t.productId === p.id);
  p.lastUpdated = own.length ? own[0].date : new Date(2026, 7, 9, 8, 0, 0).toISOString();
});

/* ---------- Notifications, derived from current stock vs reorder level ---------- */
function buildNotifications() {
  const notifs = [];
  let n = 1;
  PRODUCTS.forEach(p => {
    const status = Utils.getStockStatus(p.stock, p.reorderLevel);
    if (status === 'Out of Stock') {
      notifs.push({ id: 'NTF-' + Utils.pad(n++, 3), type: 'out-of-stock', productId: p.id, title: 'Out of Stock', message: p.name + ' is now out of stock.', date: '2026-08-29T16:20:00', read: false });
    } else if (status === 'Low Stock') {
      notifs.push({ id: 'NTF-' + Utils.pad(n++, 3), type: 'low-stock', productId: p.id, title: 'Low Stock', message: p.name + ' has ' + p.stock + (p.stock === 1 ? ' unit' : ' units') + ' remaining.', date: '2026-08-29T09:00:00', read: false });
    } else if (p.stock <= p.reorderLevel * 1.5) {
      notifs.push({ id: 'NTF-' + Utils.pad(n++, 3), type: 'restock-reminder', productId: p.id, title: 'Restock Reminder', message: p.name + ' is approaching its reorder level.', date: '2026-08-28T09:00:00', read: false });
    }
  });
  return notifs.sort((a, b) => new Date(b.date) - new Date(a.date));
}
const NOTIFICATIONS = buildNotifications();

/* ---------- Customer product interest (views) ---------- */
const PRODUCT_VIEWS = {
  'LGT-001': { today: 24, week: 137, month: 512 },
  'BRK-001': { today: 18, week: 91, month: 340 },
  'LGT-002': { today: 12, week: 68, month: 245 },
  'BRK-002': { today: 9, week: 54, month: 198 },
  'ELC-002': { today: 8, week: 47, month: 176 },
  'ACC-001': { today: 6, week: 39, month: 150 },
  'ELC-001': { today: 5, week: 33, month: 128 },
  'LGT-003': { today: 4, week: 26, month: 97 },
  'ENG-001': { today: 4, week: 24, month: 88 },
  'ENG-002': { today: 3, week: 19, month: 71 },
  'ELC-003': { today: 2, week: 14, month: 55 },
  'LGT-004': { today: 2, week: 12, month: 44 },
  'OTH-001': { today: 1, week: 7, month: 26 },
  'ENG-003': { today: 1, week: 5, month: 19 },
  'ELC-004': { today: 0, week: 2, month: 9 }
};

/* ---------- Assembled default "database" ---------- */
const WARRANTIES = [
  { id: 'WAR-001', customerId: 'CUST-001', productId: 'MOT-001', productName: 'Honda Click 125i', purchaseDate: '2025-09-18', warrantyStart: '2025-09-18', warrantyExpiration: '2026-09-18', coverage: 'Engine and transmission \u2014 1 year or 10,000 km, whichever comes first', status: 'Expiring Soon', claims: [] },
  { id: 'WAR-002', customerId: 'CUST-002', productId: 'MOT-002', productName: 'Yamaha NMAX', purchaseDate: '2026-03-10', warrantyStart: '2026-03-10', warrantyExpiration: '2027-03-10', coverage: 'Engine, transmission, and electrical \u2014 1 year or 10,000 km, whichever comes first', status: 'Active', claims: [] },
  { id: 'WAR-003', customerId: 'CUST-003', productId: 'MOT-003', productName: 'Suzuki Raider R150', purchaseDate: '2024-06-05', warrantyStart: '2024-06-05', warrantyExpiration: '2025-06-05', coverage: 'Engine and transmission \u2014 1 year or 10,000 km, whichever comes first', status: 'Expired', claims: [] },
  { id: 'WAR-004', customerId: 'CUST-004', productId: 'MOT-001', productName: 'Honda Click 125i', purchaseDate: '2025-01-10', warrantyStart: '2025-01-10', warrantyExpiration: '2026-01-10', coverage: 'Engine and transmission \u2014 1 year or 10,000 km, whichever comes first', status: 'Claimed', claims: [
    { date: '2025-08-02', description: 'Unusual engine noise on cold start', resolution: 'Replaced starter clutch under warranty at MotoParts Central Trading service bay.', status: 'Resolved' }
  ] },
  /* Rubber items (tires): defect-only warranty, RUBBER_WARRANTY_DAYS (7) days from purchase */
  { id: 'WAR-005', customerId: 'CUST-005', productId: 'OTH-001', purchaseDate: '2026-08-12', warrantyStart: '2026-08-12', warrantyExpiration: Utils.addDaysISO('2026-08-12', RUBBER_WARRANTY_DAYS), coverage: RUBBER_WARRANTY_COVERAGE, status: 'Expired', claims: [] },
  { id: 'WAR-006', customerId: 'CUST-006', productId: 'OTH-001', purchaseDate: '2026-08-27', warrantyStart: '2026-08-27', warrantyExpiration: Utils.addDaysISO('2026-08-27', RUBBER_WARRANTY_DAYS), coverage: RUBBER_WARRANTY_COVERAGE, status: 'Expiring Soon', claims: [] }
];


/* Sample shift history for Users > Shift History (Admin view of Staff attendance).
   Built relative to today so a fresh or reset demo always shows recent days; real clock-ins made on the
   Profile page are appended to the same `shifts` list. Each record: { id, username, name, clockIn, clockOut }
   with ISO timestamps; clockOut === null means the shift is still ongoing. */
function buildShifts() {
  // [username, display name, days ago each shift started, start hour, start minute]
  const roster = [
    ['juan.delacruz', 'Juan Dela Cruz', [1, 2, 3, 5, 6], 8, 0],
    ['maria.santos',  'Maria Santos',   [1, 2, 4, 5],    9, 0],
    ['ana.reyes',     'Ana Reyes',      [2, 3, 4, 6],    8, 30],
    ['carlo.ibarra',  'Carlo Ibarra',   [41, 42, 44],    8, 0]   // inactive account \u2014 older history only
  ];
  const rows = [];
  roster.forEach(function (r, ri) {
    r[2].forEach(function (daysAgo, di) {
      const start = new Date();
      start.setDate(start.getDate() - daysAgo);
      start.setHours(r[3], r[4] + ((di * 7 + ri * 5) % 18), 0, 0);               // small, repeatable variation in arrival time
      const end = new Date(start.getTime() + (8 * 60 + ((di * 13 + ri * 11) % 55)) * 60000); // shifts run ~8 to 8h55m
      rows.push({ username: r[0], name: r[1], clockIn: start.toISOString(), clockOut: end.toISOString() });
    });
  });
  rows.sort(function (a, b) { return a.clockIn < b.clockIn ? -1 : 1; });
  rows.forEach(function (row, i) { row.id = 'SHF-' + String(i + 1).padStart(4, '0'); });
  return rows;
}
const SHIFTS = buildShifts();

const DEFAULT_DB = {
  categories: CATEGORIES,
  brands: MOTO_BRANDS,
  suppliers: SUPPLIERS,
  products: PRODUCTS,
  users: USERS,
  sales: SALES,
  inventoryTransactions: INVENTORY_TRANSACTIONS,
  notifications: NOTIFICATIONS,
  productViews: PRODUCT_VIEWS,
  customers: CUSTOMERS,
  warranties: WARRANTIES,
  shifts: SHIFTS
};