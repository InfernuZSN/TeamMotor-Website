/* ==========================================================================
   store.js — Shared Utils + Pure API Client + Smart Cache & Page Bootstrapper
   ----------------------------------------------------------------------
   All data lives in MongoDB behind the Express API (/api/*).
   - Utils: shared formatting, date, status, VAT, and CSV helpers used across pages
   - Api: pure REST client talking directly to /api/* with JWT auth
   - Store: in-memory + sessionStorage smart TTL cache (zero double-render stutter)
   - Boot: page lifecycle runner once authenticated & hydrated
   ========================================================================== */

/* ---------- Shared Constants ---------- */
const UNIVERSAL_FIT = 'Universal (All Models)';
const PAYMENT_METHODS = ['Cash', 'GCash'];
const LEGACY_PAYMENT_METHODS = ['Maya', 'Other'];
const ALL_PAYMENT_METHODS = PAYMENT_METHODS.concat(LEGACY_PAYMENT_METHODS);

const RUBBER_WARRANTY_DAYS = 7;
const RUBBER_WARRANTY_COVERAGE = 'Manufacturing defects only \u2014 ' + RUBBER_WARRANTY_DAYS + ' days from purchase (tires/rubber)';

const CATEGORIES = [
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

const LEGACY_CATEGORY_NAMES = {
  lights: 'Lights',
  electrical: 'Electrical',
  brakes: 'Brakes',
  accessories: 'Accessories',
  'engine-parts': 'Engine Parts',
  'other-parts': 'Other Parts'
};

const MOTO_BRANDS = {
  Yamaha: ['NMAX', 'Aerox', 'Mio i125', 'Sniper 155'],
  Honda: ['Click 125i', 'Click 160', 'Beat', 'ADV 160'],
  Suzuki: ['Burgman Street', 'Raider R150', 'Skydrive']
};

/* ---------- Utils: small helpers shared by every page ---------- */
const Utils = {
  formatPHP(amount) {
    const n = Math.round(((Number(amount) || 0) + Number.EPSILON) * 100) / 100;
    const digits = Number.isInteger(n) ? 0 : 2;
    return '₱' + n.toLocaleString('en-PH', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  },
  formatCardPHP(amount) {
    const n = Number(amount) || 0;
    const abs = Math.abs(n);
    if (abs < 10000000) {
      return Utils.formatPHP(n);
    }
    const SCALES = [
      { val: 1e33, suffix: 'Dc' },
      { val: 1e30, suffix: 'No' },
      { val: 1e27, suffix: 'Oc' },
      { val: 1e24, suffix: 'Sp' },
      { val: 1e21, suffix: 'Sx' },
      { val: 1e18, suffix: 'Q' },
      { val: 1e15, suffix: 'P' },
      { val: 1e12, suffix: 'T' },
      { val: 1e9,  suffix: 'B' },
      { val: 1e6,  suffix: 'M' }
    ];
    let matched = null;
    for (let i = 0; i < SCALES.length; i++) {
      if (abs >= SCALES[i].val) {
        matched = SCALES[i];
        break;
      }
    }
    let formatted;
    if (matched) {
      const scaled = abs / matched.val;
      formatted = (scaled >= 100 ? scaled.toFixed(0) : scaled.toFixed(1).replace(/\.0$/, '')) + matched.suffix;
    } else {
      formatted = abs.toExponential(1).replace('+', '');
    }
    return (n < 0 ? '₱-' : '₱') + formatted;
  },
  formatMoneyHtml(amount) {
    const n = Number(amount) || 0;
    const full = Utils.formatPHP(n);
    if (Math.abs(n) < 10000000) {
      return full;
    }
    const abbr = Utils.formatCardPHP(n);
    return '<span class="abbr-money" data-tooltip="' + Utils.escapeHtml(full) + '" title="' + Utils.escapeHtml(full) + '">' + abbr + '</span>';
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
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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
  demoNow() {
    return new Date();
  },
  hasProductWarranty(product) {
    if (!product) return false;
    return (Number(product.warrantyDuration) > 0) || (Number(product.warrantyDays) > 0);
  },
  isRubberItem(product) {
    return false;
  },
  warrantyDaysFor(product) {
    if (!product) return null;
    if (Number(product.warrantyDuration) > 0) {
      const unit = String(product.warrantyUnit || 'months').toLowerCase();
      const mult = unit.startsWith('day') ? 1 : unit.startsWith('year') ? 365 : 30;
      return Number(product.warrantyDuration) * mult;
    }
    return Number(product.warrantyDays) > 0 ? Number(product.warrantyDays) : null;
  },
  addDaysISO(iso, days) {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + days));
    return dt.toISOString().slice(0, 10);
  },
  productImage(p) {
    if (!p) return '';
    if (/^data:image\//.test(p.image || '')) return p.image;
    if (/^data:image\//.test(p.thumbnail || '')) return p.thumbnail;
    return '';
  },
  productThumbnail(p) {
    if (!p) return '';
    if (/^data:image\//.test(p.thumbnail || '')) return p.thumbnail;
    if (/^data:image\//.test(p.image || '')) return p.image;
    return '';
  },
  showThumbPopover(targetEl) {
    if (!targetEl || !targetEl.dataset) return;
    const prodId = targetEl.dataset.prodThumbId;
    if (!prodId) return;
    const product = Store.get('products', []).find(p => p.id === prodId);
    if (!product) return;

    const brand = product.brand ? product.brand : '\u2014';
    const thumbSrc = Utils.productThumbnail(product) || Utils.productImage(product);

    let popover = document.getElementById('prodThumbPopover');
    if (!popover) {
      popover = document.createElement('div');
      popover.id = 'prodThumbPopover';
      popover.className = 'prod-thumb-popover';
      document.body.appendChild(popover);
    }

    popover.innerHTML =
      '<div class="popover-media thumb-' + product.category + '">' +
        (thumbSrc
          ? '<img src="' + thumbSrc + '" alt="' + Utils.escapeHtml(product.name) + '">'
          : '<div class="popover-fallback"><svg viewBox="0 0 24 24" style="stroke:currentColor;fill:none;">' + Utils.categoryIcon(product.category) + '</svg><span>' + Utils.escapeHtml(brand) + '</span><span style="font-size:.65rem;color:var(--steel);">(No custom photo)</span></div>') +
      '</div>' +
      '<div class="popover-title" title="' + Utils.escapeHtml(product.name) + '">' + Utils.escapeHtml(product.name) + '</div>' +
      '<div class="popover-sub">' + Utils.escapeHtml(product.id) + ' &bull; ' + Utils.escapeHtml(brand) + '</div>';

    const rect = targetEl.getBoundingClientRect();
    const popoverWidth = 190;
    const popoverHeight = 180;
    const padding = 12;

    let left = rect.right + 10;
    if (left + popoverWidth > window.innerWidth - padding) {
      left = rect.left - popoverWidth - 10;
    }
    if (left < padding) left = padding;

    let top = rect.top + (rect.height / 2) - 60;
    if (top < padding) top = padding;
    if (top + popoverHeight > window.innerHeight - padding) {
      top = window.innerHeight - popoverHeight - padding;
    }

    popover.style.left = Math.round(left) + 'px';
    popover.style.top = Math.round(top) + 'px';
    popover.classList.add('is-visible');
  },
  hideThumbPopover() {
    const popover = document.getElementById('prodThumbPopover');
    if (popover) popover.classList.remove('is-visible');
  },
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
  calculateWarrantyExpiry(startDateStr, duration, unit) {
    if (!startDateStr || !duration) return startDateStr;
    const parts = startDateStr.slice(0, 10).split('-').map(Number);
    const year = parts[0];
    const month = parts[1] - 1;
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
    if (todayStr > expStr) return 'Expired';
    const expDate = new Date(expStr);
    const todayDate = new Date(todayStr);
    const diffDays = Math.round((expDate - todayDate) / (1000 * 60 * 60 * 24));
    let soonDays = 30;
    const startStr = (w.warrantyStart || w.purchaseDate || '').slice(0, 10);
    if (startStr && startStr <= expStr) {
      const totalDays = Math.round((expDate - new Date(startStr)) / (1000 * 60 * 60 * 24));
      if (totalDays > 0 && totalDays <= 30) {
        soonDays = Math.max(1, Math.floor(totalDays * 0.3));
      }
    }
    if (diffDays <= soonDays && diffDays >= 0) return 'Expiring Soon';
    return 'Active';
  },
  isCountable(sale) {
    return !sale.status || sale.status === 'Completed';
  },
  saleStatusBadge(status) {
    const s = status || 'Completed';
    const cls = s === 'Completed' ? 'badge-ok' : (s === 'Refunded' ? 'badge-warn' : 'badge-danger');
    return '<span class="badge ' + cls + '">' + s + '</span>';
  },
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
  productExpiryDetail(product, months) {
    const exp = product && product.expirationDate ? String(product.expirationDate).slice(0, 10) : '';
    if (!exp) return '';
    const formatted = Utils.formatDate(exp + 'T00:00:00');
    const t = Utils.todayStr();
    const daysLeft = Math.round((new Date(exp + 'T00:00:00') - new Date(t + 'T00:00:00')) / 86400000);
    const st = Utils.expiryStatus(product, months);
    let badge = '';
    let note = '';
    if (daysLeft < 0) {
      const ago = Math.abs(daysLeft);
      badge = ' <span class="badge badge-danger">Expired</span>';
      note = ' <span class="text-muted" style="font-size:.8rem;font-weight:500;">(' + ago + (ago === 1 ? ' day' : ' days') + ' ago)</span>';
    } else if (daysLeft === 0) {
      badge = ' <span class="badge badge-danger">Expires Today</span>';
    } else if (st === 'Expiring Soon') {
      badge = ' <span class="badge badge-warn">Expiring Soon</span>';
      note = ' <span class="text-muted" style="font-size:.8rem;font-weight:500;">(' + daysLeft + (daysLeft === 1 ? ' day' : ' days') + ' left)</span>';
    } else {
      badge = ' <span class="badge badge-ok">Valid</span>';
      note = ' <span class="text-muted" style="font-size:.8rem;font-weight:500;">(' + daysLeft + (daysLeft === 1 ? ' day' : ' days') + ' left)</span>';
    }
    return formatted + badge + note;
  },
  txnBatchExpiry(txn, product) {
    if (!txn) return null;
    if (txn.expirationDate) return String(txn.expirationDate).slice(0, 10);
    if (txn.type === 'Stock In' && product) {
      if (Number(product.shelfLifeDuration) > 0) {
        const baseDate = txn.date ? String(txn.date).slice(0, 10) : Utils.todayStr();
        return Utils.calculateWarrantyExpiry(baseDate, product.shelfLifeDuration, product.shelfLifeUnit || 'days');
      }
      if (product.expirationDate && (txn.reference === 'Initial stock' || /initial stock/i.test(txn.notes || ''))) {
        return String(product.expirationDate).slice(0, 10);
      }
    }
    return null;
  },
  batchExpiryHtml(expDateStr, months) {
    if (!expDateStr) return '\u2014';
    const exp = String(expDateStr).slice(0, 10);
    const formatted = Utils.formatDate(exp + 'T00:00:00');
    const t = Utils.todayStr();
    const daysLeft = Math.round((new Date(exp + 'T00:00:00') - new Date(t + 'T00:00:00')) / 86400000);
    const st = Utils.expiryStatus({ expirationDate: exp }, months);
    let badge = '';
    if (daysLeft < 0) {
      badge = '<span class="badge badge-danger">Expired</span>';
    } else if (daysLeft === 0) {
      badge = '<span class="badge badge-danger">Expires Today</span>';
    } else if (st === 'Expiring Soon') {
      badge = '<span class="badge badge-warn">Expiring Soon</span>';
    } else {
      badge = '<span class="badge badge-ok">Valid</span>';
    }
    return '<div class="batch-exp-cell"><span class="batch-exp-date">' + formatted + '</span> ' + badge + '</div>';
  },
  computeProductBatches(product, transactions) {
    if (!product) return [];
    const compareFefo = function (a, b) {
      if (a.expirationDate && b.expirationDate) {
        const cmp = String(a.expirationDate).localeCompare(String(b.expirationDate));
        if (cmp !== 0) return cmp;
      } else if (a.expirationDate) {
        return -1;
      } else if (b.expirationDate) {
        return 1;
      }
      return new Date(a.date) - new Date(b.date);
    };
    const ordered = (transactions || [])
      .filter(function (t) { return t && t.productId === product.id; })
      .slice()
      .sort(function (a, b) {
        const dt = new Date(a.date) - new Date(b.date);
        if (dt !== 0) return dt;
        return String(a.id || '').localeCompare(String(b.id || ''));
      });
    if (!ordered.length) {
      if (product.stock > 0 && product.expirationDate) {
        return [{
          txnId: 'initial',
          date: product.lastUpdated || Utils.todayStr(),
          expirationDate: String(product.expirationDate).slice(0, 10),
          initialQty: product.stock,
          remainingQty: product.stock
        }];
      }
      return [];
    }
    const batches = [];
    ordered.forEach(function (t) {
      const exp = Utils.txnBatchExpiry(t, product);
      const qty = Number(t.quantity) || 0;
      if (qty > 0) {
        if (t.type !== 'Stock In') {
          const existing = batches.find(function (b) { return (b.expirationDate || null) === (exp || null); });
          if (existing) {
            existing.remainingQty += qty;
            return;
          }
        }
        batches.push({
          txnId: t.id,
          date: t.date,
          expirationDate: exp || null,
          initialQty: qty,
          remainingQty: qty
        });
      } else if (qty < 0) {
        let toDeduct = Math.abs(qty);
        if (exp) {
          const targeted = batches.filter(function (b) { return b.remainingQty > 0 && b.expirationDate === exp; }).sort(function (a, b) { return new Date(a.date) - new Date(b.date); });
          for (let i = 0; i < targeted.length && toDeduct > 0; i++) {
            const take = Math.min(targeted[i].remainingQty, toDeduct);
            targeted[i].remainingQty -= take;
            toDeduct -= take;
          }
        }
        if (toDeduct > 0) {
          const active = batches.filter(function (b) { return b.remainingQty > 0; }).sort(compareFefo);
          for (let i = 0; i < active.length && toDeduct > 0; i++) {
            const take = Math.min(active[i].remainingQty, toDeduct);
            active[i].remainingQty -= take;
            toDeduct -= take;
          }
        }
      }
    });
    return batches;
  },
  reportError(err) {
    if (typeof showToast === 'function') showToast(err && err.message ? err.message : 'Something went wrong.', 'danger');
    return false;
  },
  async withBusy(btn, fn) {
    if (btn && btn.dataset.busy === '1') return;
    const old = btn ? btn.innerHTML : '';
    if (btn) { btn.dataset.busy = '1'; btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Working...'; }
    try { return await fn(); }
    finally { if (btn) { btn.disabled = false; btn.innerHTML = old; delete btn.dataset.busy; } }
  },
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

/* ---------- Pure API Client ---------- */
const Api = (function () {
  const TOKEN_KEY = 'teammotor:token';
  const USER_KEY = 'teammotor:user';
  const base = (window.TEAMMOTOR_API_BASE || '') + '/api';
  let memToken = null, memUser = null;

  function read(key) { try { return window.localStorage.getItem(key); } catch (e) { return null; } }
  function write(key, val) { try { if (val == null) window.localStorage.removeItem(key); else window.localStorage.setItem(key, val); } catch (e) { /* storage blocked */ } }

  function getToken() { return memToken || read(TOKEN_KEY); }
  function setToken(t) { memToken = t || null; write(TOKEN_KEY, t || null); }
  function getUser() { if (memUser) return memUser; try { return JSON.parse(read(USER_KEY) || 'null'); } catch (e) { return null; } }
  function setUser(u) { memUser = u || null; write(USER_KEY, u ? JSON.stringify(u) : null); }
  function clear() {
    memToken = null; memUser = null;
    write(TOKEN_KEY, null); write(USER_KEY, null);
    try {
      window.sessionStorage.removeItem('teammotor:bootstrap');
      window.sessionStorage.removeItem('teammotor:bootstrap_time');
    } catch (e) {}
  }

  function toLogin(reason) {
    clear();
    if (!/login\.html$/.test(location.pathname)) location.replace('login.html' + (reason ? '?reason=' + reason : ''));
  }

  function detect() { return Promise.resolve('server'); }

  async function request(method, path, body, opts) {
    const headers = { 'Accept': 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const token = getToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    let res;
    try {
      const fetchOpts = { method: method, headers: headers, body: body !== undefined ? JSON.stringify(body) : undefined };
      if (opts && opts.keepalive) fetchOpts.keepalive = true;
      res = await fetch(base + path, fetchOpts);
    } catch (netErr) {
      const e = new Error('Cannot reach the TeamMotor server. Check your internet connection.');
      e.status = 0; e.network = true; throw e;
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* empty body */ }
    if (res.status === 401 && path.indexOf('/auth/login') !== 0) { toLogin('expired'); }
    if (!res.ok) {
      const e = new Error((data && data.error) || ('Request failed (' + res.status + ')'));
      e.status = res.status; e.details = data && data.details; throw e;
    }
    // Automatically invalidate bootstrap session cache on any data mutation (except read-state endpoints)
    if (method !== 'GET' && path.indexOf('/auth/') !== 0 && path.indexOf('/notifications/') !== 0 && typeof Store !== 'undefined' && Store.invalidate) {
      Store.invalidate();
    }
    return data;
  }

  return {
    get: function (p) { return request('GET', p); },
    post: function (p, b, opts) { return request('POST', p, b === undefined ? {} : b, opts); },
    put: function (p, b, opts) { return request('PUT', p, b === undefined ? {} : b, opts); },
    del: function (p, opts) { return request('DELETE', p, undefined, opts); },
    detect: detect,
    mode: function () { return 'server'; },
    getToken: getToken,
    setToken: setToken,
    getUser: getUser,
    setUser: setUser,
    clear: clear,
    toLogin: toLogin
  };
})();

/* ---------- Smart In-Memory + SessionStorage Cache ---------- */
const Store = (function () {
  let data = {};
  let loaded = false;
  let inflight = null;
  const CACHE_KEY = 'teammotor:bootstrap';
  const CACHE_TIME_KEY = 'teammotor:bootstrap_time';
  const CACHE_MAX_AGE = 60 * 1000;        // 60s fresh window — zero network calls on rapid menu switching
  const SWR_MAX_AGE = 30 * 60 * 1000;     // 30m stale-while-revalidate window — instant menu paint + background refresh

  function stripHeavyImages(d) {
    if (!d || typeof d !== 'object') return d;
    const copy = Object.assign({}, d);
    if (Array.isArray(d.products)) {
      copy.products = d.products.map(function (p) {
        return p && /^data:image\//.test(p.image || '') ? Object.assign({}, p, { image: '' }) : p;
      });
    }
    if (d.expiry && typeof d.expiry === 'object') {
      const expCopy = Object.assign({}, d.expiry);
      if (Array.isArray(d.expiry.expired)) {
        expCopy.expired = d.expiry.expired.map(function (p) {
          return p && /^data:image\//.test(p.image || '') ? Object.assign({}, p, { image: '' }) : p;
        });
      }
      if (Array.isArray(d.expiry.expiring)) {
        expCopy.expiring = d.expiry.expiring.map(function (p) {
          return p && /^data:image\//.test(p.image || '') ? Object.assign({}, p, { image: '' }) : p;
        });
      }
      copy.expiry = expCopy;
    }
    return copy;
  }

  function writeCache(d, ts) {
    const stamp = String(ts || Date.now());
    try {
      window.sessionStorage.setItem(CACHE_KEY, JSON.stringify(d));
      window.sessionStorage.setItem(CACHE_TIME_KEY, stamp);
    } catch (e) {
      try {
        window.sessionStorage.setItem(CACHE_KEY, JSON.stringify(stripHeavyImages(d)));
        window.sessionStorage.setItem(CACHE_TIME_KEY, stamp);
      } catch (_) {}
    }
  }

  function sanitizePayload(d) {
    if (!d || typeof d !== 'object') return d;
    if (Array.isArray(d.sales)) {
      d.sales.forEach(function (s) {
        if (s && s.paymentMethod && s.paymentMethod.indexOf('Bank') !== -1) {
          s.paymentMethod = 'GCash';
        }
      });
    }
    return d;
  }

  function payloadChanged(prev, next) {
    try {
      return JSON.stringify(Object.assign({}, prev, { serverTime: null })) !==
        JSON.stringify(Object.assign({}, next, { serverTime: null }));
    } catch (e) {
      return true;
    }
  }

  // Synchronously pre-populate in-memory Store from sessionStorage so immediate shell renders have alert counts & settings
  try {
    const initialStr = window.sessionStorage.getItem(CACHE_KEY);
    if (initialStr) {
      const parsed = JSON.parse(initialStr);
      if (parsed && typeof parsed === 'object') {
        data = sanitizePayload(parsed);
        loaded = true;
        if (parsed.me) Api.setUser(parsed.me);
      }
    }
  } catch (e) {}

  function invalidate() {
    try { window.sessionStorage.removeItem(CACHE_TIME_KEY); } catch (e) {}
  }

  function fetchBootstrap(notifyOnlyIfChanged) {
    if (inflight) return inflight;
    inflight = (async function () {
      try {
        const d = sanitizePayload(await Api.get('/bootstrap'));
        const changed = !loaded || payloadChanged(data, d);
        data = d;
        loaded = true;
        writeCache(d);
        if (d.me) Api.setUser(d.me);
        if (!notifyOnlyIfChanged || changed) {
          try { window.dispatchEvent(new CustomEvent('store:refreshed')); } catch (e) {}
        }
        return d;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  async function hydrate(forceFresh = false) {
    if (!forceFresh) {
      try {
        const cachedTime = parseInt(window.sessionStorage.getItem(CACHE_TIME_KEY) || '0', 10);
        if (!loaded) {
          const cachedStr = window.sessionStorage.getItem(CACHE_KEY);
          if (cachedStr) {
            const d = sanitizePayload(JSON.parse(cachedStr));
            if (d && typeof d === 'object') {
              data = d;
              loaded = true;
              if (d.me) Api.setUser(d.me);
            }
          }
        }
        if (loaded && cachedTime > 0) {
          const age = Date.now() - cachedTime;
          if (age < CACHE_MAX_AGE) {
            return data;
          }
          if (age < SWR_MAX_AGE) {
            fetchBootstrap(true).catch(function () {});
            return data;
          }
        }
      } catch (e) {}
    }

    return fetchBootstrap(false);
  }

  function get(key, fallback) {
    let v = data[key];
    if (key === 'sales' && Array.isArray(v)) {
      v = v.map(function (s) {
        if (s && s.paymentMethod && s.paymentMethod.indexOf('Bank') !== -1) {
          return Object.assign({}, s, { paymentMethod: 'GCash' });
        }
        return s;
      });
    }
    return v === undefined || v === null ? fallback : v;
  }

  function set(key, value) {
    data[key] = value;
    writeCache(data);
    return value;
  }

  function upsertItem(key, item, opts) {
    if (!item) return item;
    if (key === 'sales' && item.paymentMethod && item.paymentMethod.indexOf('Bank') !== -1) {
      item = Object.assign({}, item, { paymentMethod: 'GCash' });
    }
    const idField = (opts && opts.idField) || 'id';
    const prepend = !!(opts && opts.prepend);
    const list = Array.isArray(data[key]) ? data[key].slice() : [];
    const idx = list.findIndex(function (x) { return x && x[idField] === item[idField]; });
    if (idx !== -1) {
      list[idx] = Object.assign({}, list[idx], item);
    } else if (prepend) {
      list.unshift(item);
    } else {
      list.push(item);
    }
    return set(key, list);
  }

  function removeItem(key, id, idField) {
    const field = idField || 'id';
    const list = Array.isArray(data[key]) ? data[key] : [];
    return set(key, list.filter(function (x) { return !x || x[field] !== id; }));
  }

  function syncInBackground() {
    fetchBootstrap(true).catch(function () {});
  }

  return {
    get: get,
    set: set,
    upsertItem: upsertItem,
    removeItem: removeItem,
    syncInBackground: syncInBackground,
    hydrate: hydrate,
    refresh: function () { return hydrate(true); },
    invalidate: invalidate,
    isLoaded: function () { return loaded; }
  };
})();

/* ---------- Page Bootstrapper ---------- */
const Boot = (function () {
  const queue = [];
  let isReady = false;
  let started = false;

  function dom(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }
  function ready(fn) {
    if (isReady) run(fn); else queue.push(fn);
    if (!started) { started = true; dom(start); }
  }
  function run(fn) { try { fn(); } catch (err) { console.error(err); } }

  function showFatal(message) {
    const bar = document.createElement('div');
    bar.setAttribute('role', 'alert');
    bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#b3261e;color:#fff;padding:12px 16px;font:600 14px var(--font-body, system-ui, sans-serif);text-align:center;';
    bar.textContent = message + ' ';
    const retry = document.createElement('button');
    retry.textContent = 'Retry'; retry.style.cssText = 'margin-left:8px;padding:2px 10px;cursor:pointer;';
    retry.onclick = function () { location.reload(); };
    bar.appendChild(retry);
    document.body.appendChild(bar);
  }

  async function start() {
    const isPublic = document.body && document.body.hasAttribute('data-public');
    if (!isPublic) {
      if (!Api.getToken()) { Api.toLogin(); return; }
      try { await Store.hydrate(); }
      catch (err) { if (err.status === 401) return; showFatal(err.message); return; }
    }
    isReady = true;
    while (queue.length) run(queue.shift());
  }
  return { ready: ready, dom: dom };
})();

/* ==========================================================================
   Global Floating Money Tooltip
   Custom pop-up matching Sales Trend 1 Month (.bar-chart.is-dense .bar-value)
   for abbreviated monetary numbers and data-tooltip elements.
   ========================================================================== */
(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (typeof document.addEventListener !== 'function') return;

  let tipEl = null;
  function getTip() {
    if (!tipEl && document.body && typeof document.createElement === 'function') {
      tipEl = document.createElement('div');
      tipEl.className = 'tm-money-tooltip';
      tipEl.setAttribute('role', 'tooltip');
      tipEl.setAttribute('aria-hidden', 'true');
      document.body.appendChild(tipEl);
    }
    return tipEl;
  }

  function positionTip(target) {
    if (!target) return;
    const text = target.getAttribute('data-tooltip') || target.getAttribute('data-full-val') || target.getAttribute('title');
    if (!text) return;

    // Suppress native OS tooltip on target AND any ancestor while hovering so generic OS tooltips can never appear
    let curr = target;
    while (curr && curr !== document.body) {
      if (curr.hasAttribute && curr.hasAttribute('title')) {
        curr.setAttribute('data-full-val', curr.getAttribute('title'));
        curr.removeAttribute('title');
      }
      curr = curr.parentElement;
    }

    const tip = getTip();
    if (!tip) return;
    tip.textContent = text;
    tip.classList.remove('is-visible', 'is-below');

    const rect = target.getBoundingClientRect();
    const scrollX = window.pageXOffset || (document.documentElement && document.documentElement.scrollLeft) || 0;
    const scrollY = window.pageYOffset || (document.documentElement && document.documentElement.scrollTop) || 0;

    // Measure tip
    tip.style.visibility = 'hidden';
    tip.style.display = 'block';
    const tipRect = tip.getBoundingClientRect();

    let left = rect.left + scrollX + (rect.width / 2);
    let top = rect.top + scrollY - tipRect.height - 7;
    let isBelow = false;

    // If near the top of viewport, show below target instead
    if (rect.top - tipRect.height - 7 < 0) {
      top = rect.bottom + scrollY + 7;
      isBelow = true;
    }

    // Clamp horizontal position so tooltip stays within viewport padding (10px)
    const winWidth = window.innerWidth || (document.documentElement && document.documentElement.clientWidth) || 1200;
    const minCenter = scrollX + (tipRect.width / 2) + 10;
    const maxCenter = scrollX + winWidth - (tipRect.width / 2) - 10;
    if (left < minCenter) left = minCenter;
    if (left > maxCenter) left = maxCenter;

    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
    if (isBelow) {
      tip.classList.add('is-below');
    }

    // Position arrow relative to the target center
    const targetCenterX = rect.left + scrollX + (rect.width / 2);
    const arrowOffset = targetCenterX - (left - (tipRect.width / 2));
    tip.style.setProperty('--arrow-left', Math.max(8, Math.min(tipRect.width - 8, arrowOffset)) + 'px');

    tip.style.visibility = '';
    void tip.offsetHeight; // force reflow for smooth transition
    tip.classList.add('is-visible');
  }

  function hideTip(target) {
    if (!target) return;
    let curr = target;
    while (curr && curr !== document.body) {
      if (curr && curr.hasAttribute && curr.hasAttribute('data-full-val')) {
        curr.setAttribute('title', curr.getAttribute('data-full-val'));
      }
      curr = curr ? curr.parentElement : null;
    }
    if (tipEl) {
      tipEl.classList.remove('is-visible');
    }
  }

  document.addEventListener('mouseover', function (e) {
    const thumb = e.target && e.target.closest ? e.target.closest('.cell-thumb[data-prod-thumb-id]') : null;
    if (thumb) {
      Utils.showThumbPopover(thumb);
    }
    const el = e.target && e.target.closest ? e.target.closest('.abbr-money, [data-tooltip], .cell-total') : null;
    if (el) {
      const target = el.classList && el.classList.contains('cell-total') ? (el.querySelector('.abbr-money') || el) : el;
      positionTip(target);
    }
  });

  document.addEventListener('mouseout', function (e) {
    const thumb = e.target && e.target.closest ? e.target.closest('.cell-thumb[data-prod-thumb-id]') : null;
    if (thumb) {
      const related = e.relatedTarget;
      if (!thumb.contains(related)) {
        Utils.hideThumbPopover();
      }
    }
    const el = e.target && e.target.closest ? e.target.closest('.abbr-money, [data-tooltip], .cell-total') : null;
    if (el) {
      const target = el.classList && el.classList.contains('cell-total') ? (el.querySelector('.abbr-money') || el) : el;
      hideTip(target);
    }
  });

  if (typeof window.addEventListener === 'function') {
    window.addEventListener('scroll', function () {
      Utils.hideThumbPopover();
      if (tipEl && tipEl.classList.contains('is-visible')) {
        tipEl.classList.remove('is-visible');
      }
    }, { passive: true });
    window.addEventListener('resize', function () {
      Utils.hideThumbPopover();
    }, { passive: true });
  }
})();
