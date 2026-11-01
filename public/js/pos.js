/* ==========================================================================
   pos.js — powers pos.html (the single-screen POS terminal)
   --------------------------------------------------------------------------
   Everything the cashier does happens on this one screen: tap or scan products into the cart, pick a
   discount, hold / resume orders, then pay in a modal and get the receipt on an overlay.

   What this file does NOT do: any money or stock rule. It sends only product ids + quantities (plus the
   discount amount, payment method and cash received) to POST /api/sales, exactly as before. The server
   (or js/local-api.js in offline mode) re-reads prices, recomputes VAT/total, re-checks stock and expiry,
   decrements stock atomically and writes the audit trail. Void/refund, roles and notifications are untouched.

   Held orders are saved in this browser (localStorage), shared by everyone using this terminal. They do
   not reserve stock; prices and availability are re-checked when an order is resumed.
   ========================================================================== */
Boot.ready(function () {
  'use strict';
  if (!initShell('pos')) return;

  /* ------------------------------------------------------------------ helpers */
  const $ = function (id) { return document.getElementById(id); };
  const esc = function (s) { return Utils.escapeHtml(s); };
  const round2 = function (n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; };
  const peso = function (n) { return '\u20B1' + (Number(n) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  const pesoShort = function (n) { n = Number(n) || 0; return Number.isInteger(n) ? '\u20B1' + n.toLocaleString('en-PH') : peso(n); };
  const isDesktopPointer = function () { return window.matchMedia && window.matchMedia('(pointer: fine)').matches; };
  const svg = function (inner, cls) { return '<svg class="' + (cls || '') + '" viewBox="0 0 24 24" aria-hidden="true">' + inner + '</svg>'; };

  const ICONS = {
    minus: '<line x1="5" y1="12" x2="19" y2="12"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    close: '<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>',
    cart: '<circle cx="9" cy="20" r="1.6"/><circle cx="18" cy="20" r="1.6"/><polyline points="1,3 4,3 6.5,15 18,15 20,7 5.5,7"/>'
  };
  const PAY_ICONS = {
    'Cash': '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/>',
    'GCash': '<rect x="7" y="2" width="10" height="20" rx="2"/><line x1="10" y1="18" x2="14" y2="18"/>'
  };

  /* ------------------------------------------------------------------ category colours
     One colour per category, used on its tab, its tiles and its cart lines. Keyed by category id (ids never change);
     a category an admin adds later falls back to the neutral grey used for "Others". */
  const CAT_STYLE = {
    'lights':       { c: '#f59e0b', ink: '#1c1300' },   // amber
    'bulbs':        { c: '#fde047', ink: '#1c1a00' },   // yellow
    'electrical':   { c: '#38bdf8', ink: '#04202f' },   // sky blue / cyan  (Electronics)
    'engine-parts': { c: '#f97316', ink: '#1f0d00' },   // orange           (Motorcycle Parts)
    'accessories':  { c: '#a855f7', ink: '#ffffff' },   // violet           (Motorcycle Accessories)
    'engine-oils':  { c: '#22c55e', ink: '#04200f' },   // green
    'brakes':       { c: '#ef4444', ink: '#ffffff' },   // red              (Brake Systems)
    'cvt':          { c: '#6366f1', ink: '#ffffff' },   // indigo           (CVT & Transmission)
    'helmets':      { c: '#ec4899', ink: '#ffffff' },   // pink             (Helmets & Accessories)
    'tools':        { c: '#14b8a6', ink: '#032420' },   // teal             (Tools & Fluids)
    'other-parts':  { c: '#94a3b8', ink: '#0b1220' }    // grey             (Others)
  };
  const CAT_ORDER = ['lights', 'bulbs', 'electrical', 'engine-parts', 'accessories', 'engine-oils', 'brakes', 'cvt', 'helmets', 'tools'];   // 'other-parts' always last
  function catStyleOf(id) { return CAT_STYLE[id] || CAT_STYLE['other-parts']; }
  function catVars(id) {
    const s = catStyleOf(id), h = s.c.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    const dark = function (v) { return Math.round(v * 0.5); };       // --txt: the category colour darkened, so labels stay readable on white
    return '--c:' + s.c + ';--rgb:' + r + ' ' + g + ' ' + b + ';--ink:' + s.ink + ';--txt:rgb(' + dark(r) + ',' + dark(g) + ',' + dark(b) + ');';
  }
  /* Shorter labels for the tab strip only (full names stay on tiles, tooltips and screen-reader labels). */
  const TAB_SHORT = { 'engine-parts': 'Moto Parts', 'accessories': 'Accessories', 'engine-oils': 'Oils / Fluids', 'cvt': 'CVT & Trans.', 'helmets': 'Helmets', 'tools': 'Tools' };
  function catRank(id) { if (id === 'other-parts') return 999; const i = CAT_ORDER.indexOf(id); return i === -1 ? 500 : i; }

  /* ------------------------------------------------------------------ state */
  let cart = [];                         // { productId, name, price, qty, category }
  let activeCat = '';                    // '' = All
  let fit = { brand: '', model: '' };    // "Fits my bike" filter
  let disc = { mode: 'none', value: 0 }; // none | percent | amount
  let customerId = '';
  let method = 'Cash';
  let tendered = '';                     // cash typed on the keypad, as text
  let isSubmitting = false;
  let checkoutRequestId = null;          // idempotency key: one per checkout attempt, so a retry / double-tap can never create two sales
  let lastSale = null, printedSaleId = null;
  let lastAddedId = null;
  let scanTimer = null, clearArmTimer = null, rafId = 0;
  let discType = 'amount';

  const settings = function () { return Store.get('settings', { vatEnabled: false, vatRate: 0, vatMode: 'inclusive' }); };
  const session = function () { return getSession() || {}; };
  /* Discount discipline: only an Admin may discount a sale. The server enforces the same rule. */
  const canDiscount = function () { return session().role === 'Admin'; };
  const DISC_DENIED = 'Only an Admin can apply a discount. Ask an Admin to ring up this sale.';
  const allProducts = function () { return Store.get('products', []).filter(function (p) { return !p.archived; }); };
  const findProduct = function (id) { return Store.get('products', []).find(function (p) { return p.id === id; }); };
  const isExpired = function (p) { return !!(p.expirationDate && String(p.expirationDate).slice(0, 10) < Utils.todayStr()); };
  const cartQty = function () { return cart.reduce(function (n, c) { return n + c.qty; }, 0); };

  /* ------------------------------------------------------------------ "Fits my bike" (same rule as Inventory) */
  function matchesFit(p) {
    if (!fit.brand) return true;
    const compat = p.compatibility || [];
    if (compat.includes(UNIVERSAL_FIT)) return true;
    if (fit.model) return compat.includes(fit.brand + ' ' + fit.model);
    return compat.some(function (c) { return c.indexOf(fit.brand + ' ') === 0; });
  }
  function matchesQuery(p, q) {
    return [p.name, p.id, p.brand, p.sku, p.barcode].some(function (f) { return f && String(f).toLowerCase().indexOf(q) !== -1; });
  }
  function searchText() { return $('ptSearch').value.trim().toLowerCase(); }
  /* Typing in the search box looks across every category; otherwise the active tab decides. */
  function visibleProducts() {
    const q = searchText();
    return allProducts().filter(function (p) {
      if (!matchesFit(p)) return false;
      if (q) return matchesQuery(p, q);
      return !activeCat || p.category === activeCat;
    });
  }

  /* ------------------------------------------------------------------ totals (VAT rules live in Utils.computeTotals, mirrored by the server) */
  function totals() {
    const subtotal = round2(cart.reduce(function (s, c) { return s + c.qty * c.price; }, 0));
    let discount = 0;
    if (!canDiscount()) discount = 0;
    else if (disc.mode === 'percent') discount = Math.round(subtotal * disc.value / 100);
    else if (disc.mode === 'amount') discount = disc.value;
    discount = Math.max(0, Math.min(discount, subtotal));
    return Utils.computeTotals(subtotal, discount, settings());
  }
  function vatLabel() {
    const st = settings();
    if (!st.vatEnabled || !st.vatRate) return 'VAT (not applied)';
    return 'VAT ' + (Math.round(st.vatRate * 10000) / 100) + '%' + (st.vatMode === 'exclusive' ? ' (added)' : ' (included)');
  }
  function discLabel() {
    if (disc.mode === 'percent') return disc.value === 12 ? 'PWD/SC 12%' : disc.value + '%';
    if (disc.mode === 'amount') return 'custom';
    return '';
  }

  /* ------------------------------------------------------------------ header */
  function renderHeader() {
    $('ptShopName').textContent = settings().shopName || 'TeamMotor';
    $('ptStaff').textContent = session().name || '\u2014';
    const sales = Store.get('sales', []).filter(Utils.isCountable);
    const today = Analytics.salesToday(sales, Utils.demoNow());
    $('ptTodaySales').textContent = peso(Analytics.sumTotal(today));
    $('ptTodayCount').textContent = today.length + (today.length === 1 ? ' sale' : ' sales');
    const mode = Api.mode();
    const pill = $('ptMode');
    pill.dataset.mode = mode;
    pill.textContent = mode === 'local' ? 'Offline mode \u2014 saved on this device' : 'Online';
  }
  function tickClock() {
    $('ptClock').textContent = Utils.demoNow().toLocaleString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  function renderInvoice() {
    const ids = Store.get('sales', []).map(function (s) { return s.id; });
    $('ptInvoice').textContent = Utils.nextId('SALE', ids, 4);
  }
  function renderCustomers() {
    const all = Store.get('customers', []).filter(function (c) { return c.status !== 'Inactive'; });
    if (customerId && !all.some(function (c) { return c.id === customerId; })) customerId = '';
    const cur = all.find(function (c) { return c.id === customerId; });
    $('custLabel').textContent = cur ? cur.name : 'Walk-in customer';
    $('custBtn').classList.toggle('has-cust', !!cur);
    renderCustomerList();
  }
  function renderCustomerList() {
    const q = $('custSearch').value.trim().toLowerCase();
    const all = Store.get('customers', []).filter(function (c) { return c.status !== 'Inactive'; });
    const rows = all.filter(function (c) { return !q || [c.name, c.id, c.contactNumber].some(function (f) { return f && String(f).toLowerCase().indexOf(q) !== -1; }); }).slice(0, 40);
    const item = function (id, name, sub) {
      return '<button type="button" role="option" class="pt-custitem' + (id === customerId ? ' is-on' : '') + '" data-cust="' + esc(id) + '"><span>' + esc(name) + '</span>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</button>';
    };
    $('custList').innerHTML = (q ? '' : item('', 'Walk-in customer', '')) +
      (rows.length ? rows.map(function (c) { return item(c.id, c.name, c.id + (c.contactNumber ? ' \u00B7 ' + c.contactNumber : '')); }).join('') : '<div class="pt-custnone">No customer matches. Use + to add one.</div>');
  }
  function toggleCustPop(open) {
    const pop = $('custPop'), show = open === undefined ? pop.hidden : open;
    pop.hidden = !show; $('custBtn').setAttribute('aria-expanded', String(show));
    if (show) { $('custSearch').value = ''; renderCustomerList(); setTimeout(function () { $('custSearch').focus(); }, 30); }
  }

  /* ------------------------------------------------------------------ categories (tabs) */
  function renderTabs() {
    const cats = Store.get('categories', []).filter(function (c) { return c.status !== 'Inactive'; })
      .sort(function (a, b) { return catRank(a.id) - catRank(b.id) || a.name.localeCompare(b.name); });
    if (activeCat && !cats.some(function (c) { return c.id === activeCat; })) activeCat = '';
    const fitting = allProducts().filter(matchesFit);
    const counts = {};
    fitting.forEach(function (p) { counts[p.category] = (counts[p.category] || 0) + 1; });
    const tab = function (id, name, cls, n) {
      return '<button type="button" class="pt-tab ' + cls + (activeCat === id ? ' is-on' : '') + '" data-cat="' + esc(id) + '" style="' + (id ? catVars(id) : '') + '" aria-pressed="' + (activeCat === id) + '" title="' + esc(name) + '" aria-label="' + esc(name) + ', ' + n + ' products">' +
        esc(TAB_SHORT[id] || name) + '<small>' + n + '</small></button>';
    };
    $('ptTabs').innerHTML = tab('', 'All', 'pt-tab-all', fitting.length) + cats.map(function (c) { return tab(c.id, c.name, '', counts[c.id] || 0); }).join('');
    const on = $('ptTabs').querySelector('.is-on');
    if (on && on.scrollIntoView) on.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }

  /* ------------------------------------------------------------------ product grid */
  function stockBadge(p, remaining) {
    if (isExpired(p)) return '<span class="pt-badge pt-badge-bad">Expired</span>';
    if (p.stock <= 0) return '<span class="pt-badge pt-badge-bad">Out of stock</span>';
    if (remaining <= 0) return '<span class="pt-badge pt-badge-warn">All in cart</span>';
    if (remaining <= (p.reorderLevel || 0)) return '<span class="pt-badge pt-badge-warn">Low \u00B7 ' + remaining + ' left</span>';
    return '<span class="pt-badge pt-badge-ok">' + remaining + ' left</span>';
  }
  function tileHtml(p, showCat) {
    const line = cart.find(function (c) { return c.productId === p.id; });
    const inCart = line ? line.qty : 0, remaining = p.stock - inCart;
    const disabled = remaining <= 0 || isExpired(p);
    const img = Utils.productImage(p);
    const catName = (Store.get('categories', []).find(function (c) { return c.id === p.category; }) || {}).name || '';
    return '<button type="button" class="pt-tile' + (inCart ? ' has-incart' : '') + (p.id === lastAddedId ? ' just-added' : '') + '" data-add="' + esc(p.id) + '" style="' + catVars(p.category) + '"' + (disabled ? ' disabled' : '') + '>' +
      '<span class="pt-tile-incart" aria-label="' + inCart + ' in cart">' + inCart + '</span>' +
      '<span class="pt-tile-top"><span>' +
        (showCat && catName ? '<span class="pt-tile-cat">' + esc(catName) + '</span>' : '') +
        '<span class="pt-tile-name">' + esc(p.name) + '</span></span>' +
        '<span class="pt-tile-media">' + (img ? '<img src="' + img + '" alt="">' : svg(Utils.categoryIcon(p.category))) + '</span></span>' +
      '<span class="pt-tile-bottom"><span class="pt-tile-price">' + pesoShort(p.sellingPrice) + '</span>' + stockBadge(p, remaining) + '</span>' +
    '</button>';
  }
  function renderGrid() {
    const q = searchText();
    const rows = visibleProducts().sort(function (a, b) {
      const da = a.stock <= 0 || isExpired(a) ? 1 : 0, db = b.stock <= 0 || isExpired(b) ? 1 : 0;
      return da - db || (activeCat && !q ? 0 : catRank(a.category) - catRank(b.category)) || a.name.localeCompare(b.name);   // in All / search, group by category so the colours cluster
    });
    const grid = $('ptGrid');
    if (!rows.length) {
      const why = q ? 'Nothing matches \u201C' + esc($('ptSearch').value.trim()) + '\u201D.' :
        fit.brand ? 'Nothing here fits ' + esc(fit.brand + (fit.model ? ' ' + fit.model : '')) + '.' :
        'No products in this category yet.';
      grid.innerHTML = '<div class="pt-empty"><strong>No products to show</strong>' + why + (fit.brand ? ' Clear \u201CFits my bike\u201D to see everything.' : '') + '</div>';
    } else {
      const showCat = !activeCat || !!q;
      grid.innerHTML = rows.map(function (p) { return tileHtml(p, showCat); }).join('');
    }
    lastAddedId = null;
  }
  function scheduleGrid() { cancelAnimationFrame(rafId); rafId = requestAnimationFrame(renderGrid); }

  /* ------------------------------------------------------------------ cart */
  function renderCart() {
    if (!cart.length) { disc = { mode: 'none', value: 0 }; }
    const t = totals();
    const box = $('ptLines');
    if (!cart.length) {
      box.innerHTML = '<div class="pt-lines-empty">' + svg(ICONS.cart) + '<strong>No items yet</strong>Tap a product or scan a barcode to start.</div>';
    } else {
      box.innerHTML = cart.map(function (c, i) {
        return '<div class="pt-line' + (c.productId === lastAddedId ? ' is-new' : '') + '" data-pid="' + esc(c.productId) + '" style="' + catVars(c.category) + '">' +
          '<div class="pt-line-name">' + esc(c.name) + '</div>' +
          '<button type="button" class="pt-line-remove" data-remove="' + i + '" aria-label="Remove ' + esc(c.name) + '">' + svg(ICONS.close) + '</button>' +
          '<div class="pt-line-each">' + peso(c.price) + ' each</div>' +
          '<div class="pt-step"><button type="button" data-dec="' + i + '" aria-label="One less ' + esc(c.name) + '">' + svg(ICONS.minus) + '</button>' +
            '<output>' + c.qty + '</output>' +
            '<button type="button" data-inc="' + i + '" aria-label="One more ' + esc(c.name) + '">' + svg(ICONS.plus) + '</button></div>' +
          '<div class="pt-line-total">' + peso(c.qty * c.price) + '</div>' +
        '</div>';
      }).join('');
      const fresh = box.querySelector('.is-new');
      if (fresh && fresh.scrollIntoView) fresh.scrollIntoView({ block: 'nearest' });
    }

    $('totSubtotal').textContent = peso(t.subtotal);
    $('totDiscLabel').textContent = t.discount > 0 && discLabel() ? 'Discount (' + discLabel() + ')' : 'Discount';
    $('totDiscount').textContent = (t.discount > 0 ? '\u2212' : '') + peso(t.discount);
    $('totVatLabel').textContent = vatLabel();
    $('totVat').textContent = t.vatEnabled ? peso(t.vatAmount) : '\u2014';
    $('totTotal').textContent = peso(t.total);
    $('payBtnAmount').textContent = peso(t.total);
    $('payBtn').disabled = !cart.length;
    $('holdBtn').disabled = !cart.length;
    $('clearBtn').disabled = !cart.length;
    if (!cart.length) disarmClear();
    $('cartBarCount').textContent = cartQty();
    $('cartBarTotal').textContent = peso(t.total);
    $('cartBar').style.display = '';
    renderDiscChips();
    renderInvoice();
  }

  function renderDiscChips() {
    const presets = [{ v: 0, label: '0%' }, { v: 5, label: '5%' }, { v: 10, label: '10%' }, { v: 12, label: 'PWD/SC 12%' }];
    const html = presets.map(function (p) {
      const on = p.v === 0 ? disc.mode === 'none' : (disc.mode === 'percent' && disc.value === p.v);
      return '<button type="button" data-disc="' + p.v + '" class="' + (on ? 'is-on' : '') + '" aria-pressed="' + on + '">' + p.label + '</button>';
    }).join('');
    const customOn = disc.mode === 'amount' || (disc.mode === 'percent' && [5, 10, 12].indexOf(disc.value) === -1);
    const customText = disc.mode === 'amount' ? '\u20B1' + disc.value : disc.mode === 'percent' && customOn ? disc.value + '%' : 'Custom';
    if (!canDiscount()) {
      $('ptDiscChips').innerHTML = '<span class="text-muted" style="font-size:.78rem;font-weight:600;" role="note">Discounts are Admin-only</span><button type="button" data-disc="custom" aria-disabled="true" title="' + DISC_DENIED + '" style="opacity:.45;">Discount</button>';
      return;
    }
    $('ptDiscChips').innerHTML = html + '<button type="button" data-disc="custom" class="' + (customOn ? 'is-on' : '') + '" aria-pressed="' + customOn + '">' + customText + '</button>';
  }

  function addProduct(p, qty) {
    qty = qty || 1;
    if (isExpired(p)) return { ok: false, msg: p.name + ' is expired and cannot be sold.' };
    if (p.stock <= 0) return { ok: false, msg: p.name + ' is out of stock.' };
    const line = cart.find(function (c) { return c.productId === p.id; });
    const have = line ? line.qty : 0;
    if (have + qty > p.stock) return { ok: false, msg: 'Only ' + p.stock + ' of ' + p.name + ' in stock.' };
    if (line) line.qty += qty;
    else cart.push({ productId: p.id, name: p.name, price: p.sellingPrice, qty: qty, category: p.category });
    lastAddedId = p.id;
    checkoutRequestId = null;               // the order changed, so it is a new checkout attempt
    renderCart();
    renderGrid();
    return { ok: true };
  }
  function changeQty(i, delta) {
    const line = cart[i]; if (!line) return;
    const p = findProduct(line.productId), q = line.qty + delta;
    if (q <= 0) cart.splice(i, 1);
    else if (p && q > p.stock) { showToast('Only ' + p.stock + ' ' + p.name + ' in stock.', 'danger'); return; }
    else line.qty = q;
    checkoutRequestId = null;
    renderCart(); renderGrid();
  }
  function removeLine(i) { cart.splice(i, 1); checkoutRequestId = null; renderCart(); renderGrid(); }

  /* Back to a clean terminal (cart, discount, customer, filters, search). */
  function resetSale() {
    cart = []; disc = { mode: 'none', value: 0 }; customerId = ''; method = 'Cash'; tendered = '';
    checkoutRequestId = null; fit = { brand: '', model: '' }; activeCat = '';
    $('ptSearch').value = ''; $('ptSearchClear').hidden = true; renderCustomers();
    document.body.classList.remove('cart-open');
    renderFit(); renderTabs(); renderGrid(); renderCart();
  }
  function focusSearch() { if (isDesktopPointer()) $('ptSearch').focus(); }

  /* Clear needs a second tap within 3 s: fast, no dialog, hard to hit by accident. */
  function disarmClear() {
    const b = $('clearBtn'); clearTimeout(clearArmTimer);
    b.dataset.armed = '0'; b.querySelector('span').textContent = 'Clear';
  }
  function onClear() {
    if (!cart.length) return;
    const b = $('clearBtn');
    if (b.dataset.armed === '1') { disarmClear(); resetSale(); focusSearch(); return; }
    b.dataset.armed = '1'; b.querySelector('span').textContent = 'Tap again';
    clearArmTimer = setTimeout(disarmClear, 3000);
  }

  /* ------------------------------------------------------------------ search / barcode scan */
  function scanMsg(text, kind) {
    const el = $('ptScanMsg'), wrap = $('ptSearch').closest('.pt-search');
    clearTimeout(scanTimer);
    el.textContent = text || ''; el.className = 'pt-scanmsg' + (kind ? ' is-' + kind : '');
    wrap.classList.remove('is-ok', 'is-bad'); if (kind) wrap.classList.add('is-' + kind);
    if (text) scanTimer = setTimeout(function () { el.textContent = ''; el.className = 'pt-scanmsg'; wrap.classList.remove('is-ok', 'is-bad'); }, 3500);
  }
  function clearSearch() { $('ptSearch').value = ''; $('ptSearchClear').hidden = true; renderGrid(); }

  /* Enter in the search box (scanners send Enter after the code):
     exact barcode / SKU / id / name anywhere in the catalogue -> add it (or +1);
     otherwise, if the typed text narrows the list to a single product -> add that. */
  function onSearchEnter() {
    const raw = $('ptSearch').value.trim(); if (!raw) return;
    const q = raw.toLowerCase(), all = allProducts();
    const eq = function (v) { return v && String(v).toLowerCase() === q; };
    let match = all.find(function (p) { return eq(p.barcode) || eq(p.sku) || eq(p.id); }) || all.find(function (p) { return eq(p.name); });
    if (!match) {
      const vis = visibleProducts();
      if (vis.length === 1) match = vis[0];
      else { scanMsg(vis.length ? vis.length + ' products match \u201C' + raw + '\u201D. Tap the one you want.' : 'No product found for \u201C' + raw + '\u201D.', 'bad'); $('ptSearch').select(); return; }
    }
    const r = addProduct(match);
    if (r.ok) { scanMsg('Added ' + match.name, 'ok'); clearSearch(); }
    else { scanMsg(r.msg, 'bad'); $('ptSearch').select(); }
  }

  /* ------------------------------------------------------------------ Fits my bike */
  function renderFit() {
    const brands = Object.keys(MOTO_BRANDS);
    $('fitBrands').innerHTML = brands.map(function (b) { return '<button type="button" data-brand="' + esc(b) + '" class="' + (fit.brand === b ? 'is-on' : '') + '">' + esc(b) + '</button>'; }).join('');
    const models = fit.brand ? MOTO_BRANDS[fit.brand] || [] : [];
    $('fitModelTitle').hidden = !fit.brand;
    $('fitModels').innerHTML = fit.brand ? '<button type="button" data-model="" class="' + (!fit.model ? 'is-on' : '') + '">All ' + esc(fit.brand) + '</button>' +
      models.map(function (m) { return '<button type="button" data-model="' + esc(m) + '" class="' + (fit.model === m ? 'is-on' : '') + '">' + esc(m) + '</button>'; }).join('') : '';
    $('fitLabel').textContent = fit.brand ? fit.brand + (fit.model ? ' ' + fit.model : '') : 'Fits my bike';
    $('fitBtn').classList.toggle('is-on', !!fit.brand);
  }
  function toggleFitPop(open) {
    const pop = $('fitPop'); const show = open === undefined ? pop.hidden : open;
    pop.hidden = !show; $('fitBtn').setAttribute('aria-expanded', String(show));
  }
  function applyFit() { renderFit(); renderTabs(); renderGrid(); }

  /* ------------------------------------------------------------------ held orders */
  const HELD_KEY = 'tm:pos:held:v1', SEQ_KEY = 'tm:pos:holdSeq:v1';
  let memHeld = [], memSeq = 0;
  function loadHeld() {
    try { const v = JSON.parse(localStorage.getItem(HELD_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return memHeld.slice(); }
  }
  function saveHeld(list) { memHeld = list.slice(); try { localStorage.setItem(HELD_KEY, JSON.stringify(list)); } catch (e) { /* storage blocked: kept in memory for this session */ } }
  function nextHoldNo() {
    let n = memSeq;
    try { n = parseInt(localStorage.getItem(SEQ_KEY) || '0', 10) || memSeq; } catch (e) { /* ignore */ }
    n += 1; memSeq = n;
    try { localStorage.setItem(SEQ_KEY, String(n)); } catch (e) { /* ignore */ }
    return n;
  }
  function renderHeldCount() {
    const n = loadHeld().length, el = $('heldCount');
    el.textContent = n; el.hidden = !n;
  }
  /* Saves the current cart as a held order and empties the terminal. Returns the new hold number (or 0 if the cart was empty). */
  function holdCurrent() {
    if (!cart.length) return 0;
    const list = loadHeld(), no = nextHoldNo();
    list.push({
      id: 'H' + no, no: no, at: new Date().toISOString(), by: session().name || '', customerId: customerId, disc: { mode: disc.mode, value: disc.value },
      lines: cart.map(function (c) { return { productId: c.productId, name: c.name, price: c.price, qty: c.qty, category: c.category }; })
    });
    saveHeld(list);
    resetSale(); renderHeldCount();
    return no;
  }
  function onHold() {
    const no = holdCurrent();
    if (no) { showToast('Sale held as #' + no + '. Open Held orders to resume it.', 'ok'); focusSearch(); }
  }
  function heldTotal(h) {
    const sub = h.lines.reduce(function (s, l) { return s + l.qty * l.price; }, 0);
    let d = h.disc && h.disc.mode === 'percent' ? Math.round(sub * h.disc.value / 100) : h.disc && h.disc.mode === 'amount' ? h.disc.value : 0;
    return Math.max(0, sub - Math.min(d, sub));
  }
  function renderHeldList() {
    const list = loadHeld().slice().reverse(), box = $('heldList');
    if (!list.length) { box.innerHTML = '<div class="pt-held-empty">No held orders. Tap <strong>Hold</strong> on the cart to park a sale while you serve someone else.</div>'; return; }
    box.innerHTML = list.map(function (h) {
      const qty = h.lines.reduce(function (n, l) { return n + l.qty; }, 0);
      const names = h.lines.slice(0, 3).map(function (l) { return l.qty + '\u00D7 ' + esc(l.name); }).join(', ') + (h.lines.length > 3 ? ' +' + (h.lines.length - 3) + ' more' : '');
      return '<div class="pt-held-item" data-hid="' + esc(h.id) + '">' +
        '<div><h3>Held #' + h.no + '</h3><div class="pt-held-meta">' + new Date(h.at).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' }) + ' \u00B7 ' + esc(h.by || 'Staff') + ' \u00B7 ' + qty + (qty === 1 ? ' item' : ' items') + '</div></div>' +
        '<div class="pt-held-total">' + peso(heldTotal(h)) + '</div>' +
        '<div class="pt-held-items">' + names + '</div>' +
        '<div class="pt-held-btns"><button type="button" class="pt-btn pt-btn-lg pt-btn-pay" data-resume="' + esc(h.id) + '">Resume</button>' +
        '<button type="button" class="pt-btn pt-btn-lg pt-btn-danger" data-hdel="' + esc(h.id) + '">Delete</button></div></div>';
    }).join('');
  }
  function resumeHeld(id) {
    if (cart.length) holdCurrent();                       // swap: the sale in progress goes on hold first, nothing is lost
    const list = loadHeld(), h = list.find(function (x) { return x.id === id; });
    if (!h) return;
    const notes = []; let priceChanged = false; const next = [];
    h.lines.forEach(function (l) {
      const p = findProduct(l.productId);
      if (!p || p.archived || isExpired(p) || p.stock <= 0) { notes.push(l.name + ' is no longer available'); return; }
      const qty = Math.min(l.qty, p.stock);
      if (qty < l.qty) notes.push('only ' + p.stock + ' of ' + l.name + ' left');
      if (round2(p.sellingPrice) !== round2(l.price)) priceChanged = true;
      next.push({ productId: p.id, name: p.name, price: p.sellingPrice, qty: qty, category: p.category });
    });
    saveHeld(list.filter(function (x) { return x.id !== id; }));
    cart = next; disc = h.disc && h.disc.mode && canDiscount() ? { mode: h.disc.mode, value: h.disc.value } : { mode: 'none', value: 0 };
    if (h.disc && h.disc.mode && h.disc.mode !== 'none' && !canDiscount()) notes.push('the held discount was removed (Admin only)');
    customerId = h.customerId || ''; checkoutRequestId = null;
    renderCustomers(); renderCart(); renderGrid(); renderHeldCount();
    closeModal('heldOverlay');
    let msg = 'Resumed held #' + h.no + '.';
    if (priceChanged) msg += ' Prices were updated.';
    if (notes.length) msg += ' Note: ' + notes.join('; ') + '.';
    showToast(msg, notes.length || priceChanged ? 'info' : 'ok');
    focusSearch();
  }
  function deleteHeld(id, btn) {
    if (btn.dataset.armed !== '1') { btn.dataset.armed = '1'; btn.textContent = 'Tap to confirm'; setTimeout(function () { if (btn.isConnected) { btn.dataset.armed = '0'; btn.textContent = 'Delete'; } }, 3000); return; }
    saveHeld(loadHeld().filter(function (x) { return x.id !== id; }));
    renderHeldList(); renderHeldCount();
  }

  /* ------------------------------------------------------------------ discount */
  function setPresetDiscount(v) {
    if (!canDiscount()) { showToast(DISC_DENIED, 'danger'); return; }
    disc = v === 0 ? { mode: 'none', value: 0 } : { mode: 'percent', value: v };
    renderCart();
  }
  function discSubtotal() { return round2(cart.reduce(function (s, c) { return s + c.qty * c.price; }, 0)); }
  function readDiscForm() {
    const sub = discSubtotal(), value = parseFloat($('discValue').value) || 0;
    const amount = Math.round(discType === 'percent' ? sub * value / 100 : value);
    return { sub: sub, value: value, amount: amount };
  }
  function updateDiscPreview() {
    const d = readDiscForm(), applied = Math.max(0, Math.min(d.amount, d.sub));
    $('discPreview').textContent = 'Discount ' + peso(applied) + ' \u2192 new total ' + peso(d.sub - applied);
  }
  function openDiscModal() {
    if (!canDiscount()) { showToast(DISC_DENIED, 'danger'); return; }
    if (!cart.length) { showToast('Add items before applying a discount.', 'danger'); return; }
    discType = disc.mode === 'percent' ? 'percent' : 'amount';
    $('discValue').value = disc.mode === 'none' ? '' : disc.value;
    $('discErr').hidden = true;
    setDiscType(discType);
    openModal('discOverlay', 'discValue');
  }
  function setDiscType(t) {
    discType = t;
    document.querySelectorAll('[data-dtype]').forEach(function (b) { b.classList.toggle('is-on', b.dataset.dtype === t); });
    $('discValue').step = t === 'percent' ? '0.5' : '1';
    updateDiscPreview();
  }
  function applyCustomDiscount() {
    const d = readDiscForm(), err = $('discErr');
    const fail = function (m) { err.textContent = m; err.hidden = false; };
    if (d.value < 0) return fail('Discount cannot be negative.');
    if (discType === 'percent' && d.value > 100) return fail('Percent discount cannot be more than 100%.');
    if (d.amount > d.sub) return fail('Discount cannot be more than the subtotal (' + peso(d.sub) + ').');
    disc = d.value === 0 ? { mode: 'none', value: 0 } : discType === 'percent' ? { mode: 'percent', value: d.value } : { mode: 'amount', value: d.amount };
    closeModal('discOverlay'); renderCart();
  }

  /* ------------------------------------------------------------------ modals */
  const openStack = [];
  function syncInert() { document.querySelector('.pt-app').inert = !!openStack.length; }
  function openModal(id, focusId) {
    const el = $(id); el.classList.add('open');
    if (openStack.indexOf(id) === -1) openStack.push(id);
    syncInert();
    const f = focusId && $(focusId); if (f) setTimeout(function () { f.focus(); }, 30);
  }
  function closeModal(id) {
    $(id).classList.remove('open');
    const i = openStack.indexOf(id); if (i !== -1) openStack.splice(i, 1);
    syncInert();
    if (!openStack.length) focusSearch();
  }

  /* ------------------------------------------------------------------ payment */
  function renderPayMethods() {
    $('payMethods').innerHTML = PAYMENT_METHODS.map(function (m) {
      return '<button type="button" class="pt-method' + (m === method ? ' is-on' : '') + '" role="radio" aria-checked="' + (m === method) + '" data-method="' + esc(m) + '">' + svg(PAY_ICONS[m] || PAY_ICONS.Cash) + esc(m) + '</button>';
    }).join('');
    const isCash = method === 'Cash';
    $('cashPanel').hidden = !isCash;
    $('nonCashPanel').hidden = isCash;
    $('extraGcash').hidden = method !== 'GCash';
    $('payRefWrap').hidden = isCash;
    $('payRefLabel').textContent = 'Reference number (optional)';
    renderPayAmounts();
  }
  function fmtTender(s) {
    if (!s) return '\u20B10';
    const parts = s.split('.'), whole = Number(parts[0] || 0).toLocaleString('en-PH');
    return '\u20B1' + whole + (parts.length > 1 ? '.' + parts[1] : '');
  }
  function renderPayAmounts() {
    const t = totals(), isCash = method === 'Cash';
    $('payDue').textContent = peso(t.total);
    $('payDueNote').textContent = (t.discount > 0 ? 'After ' + peso(t.discount) + ' discount \u00B7 ' : '') + cartQty() + (cartQty() === 1 ? ' item' : ' items');
    const btn = $('confirmPayBtn');
    if (isCash) renderQuickSmart();
    renderPreview();
    if (isCash) {
      const received = parseFloat(tendered) || 0, enough = Math.round(received * 100) >= Math.round(t.total * 100);
      $('tenderValue').textContent = fmtTender(tendered);
      const box = $('changeBox');
      if (!received) { box.dataset.state = 'idle'; $('changeLabel').textContent = 'Change'; $('changeValue').textContent = peso(0); }
      else if (enough) { box.dataset.state = 'ok'; $('changeLabel').textContent = 'Change'; $('changeValue').textContent = peso(round2(received - t.total)); }
      else { box.dataset.state = 'short'; $('changeLabel').textContent = 'Still needed'; $('changeValue').textContent = peso(round2(t.total - received)); }
      btn.disabled = !enough || isSubmitting;
      btn.textContent = 'Confirm payment';
    } else {
      $('nonCashText').textContent = 'Customer pays ' + peso(t.total) + ' by ' + method + '.';
      btn.disabled = isSubmitting;
      btn.textContent = 'Confirm ' + method + ' payment';
    }
  }
  function pressKey(k) {
    if (method !== 'Cash') return;
    if (k === 'clear') tendered = '';
    else if (k === 'back') tendered = tendered.slice(0, -1);
    else if (k === '.') { if (tendered.indexOf('.') === -1) tendered = (tendered || '0') + '.'; }
    else {
      const next = (tendered === '0' ? '' : tendered) + k;
      const parts = next.split('.');
      if (parts[0].length > 8 || (parts[1] && parts[1].length > 2)) return;
      tendered = next;
    }
    if (tendered === '.') tendered = '';
    renderPayAmounts();
  }
  /* Exact + up to three "next round amount" suggestions above the total (set the amount), e.g. total 1,074 -> 1,100 / 1,500 / 2,000. */
  function renderQuickSmart() {
    const total = totals().total, set = [];
    [50, 100, 500, 1000].forEach(function (step) {
      const v = Math.ceil(total / step) * step;
      if (v > total && set.indexOf(v) === -1) set.push(v);
    });
    set.sort(function (a, b) { return a - b; });
    $('quickSmart').innerHTML = '<button type="button" data-quick="exact" class="pt-quick-exact">Exact</button>' +
      set.slice(0, 3).map(function (v) { return '<button type="button" data-set="' + v + '">' + pesoShort(v) + '</button>'; }).join('');
  }
  function quickCash(btn) {
    if (btn.dataset.quick === 'exact') tendered = String(totals().total);
    else if (btn.dataset.set) tendered = btn.dataset.set;
    else if (btn.dataset.add) tendered = String(round2((parseFloat(tendered) || 0) + parseInt(btn.dataset.add, 10)));
    else return;
    renderPayAmounts();
  }
  function previewData() {
    const t = totals(), isCash = method === 'Cash', rec = parseFloat(tendered) || 0;
    return {
      no: $('ptInvoice').textContent, date: Utils.demoNow(), cashier: session().name || '',
      items: cart.map(function (c) { return { name: c.name, qty: c.qty, price: c.price, subtotal: round2(c.qty * c.price) }; }),
      subtotal: t.subtotal, discount: t.discount,
      vat: { enabled: t.vatEnabled, rate: t.vatRate, mode: t.vatMode, vatable: t.vatableAmount, amount: t.vatAmount },
      total: t.total, method: method, reference: !isCash && $('payRef').value.trim() ? $('payRef').value.trim() : null,
      isCash: isCash, tendered: isCash ? rec : null, change: isCash ? Math.max(0, round2(rec - t.total)) : null, isPreview: true
    };
  }
  function renderPreview() { if ($('payPreview').open) $('payPreviewPaper').innerHTML = Receipt.html(previewData()); }
  function openPay() {
    if (isSubmitting) return;
    if (!cart.length) { showToast('The cart is empty. Add items first.', 'danger'); return; }
    method = 'Cash'; tendered = ''; $('payRef').value = ''; $('payPreview').open = false;
    renderPayMethods();
    openModal('payOverlay');
  }

  async function completeSale() {
    if (isSubmitting || !cart.length) return;
    if (PAYMENT_METHODS.indexOf(method) === -1) { method = 'Cash'; renderPayMethods(); showToast('Only Cash and GCash are accepted. Please choose a payment method.', 'danger'); return; }
    const t = totals();
    let received = t.total;
    if (method === 'Cash') {
      received = parseFloat(tendered) || 0;
      if (Math.round(received * 100) < Math.round(t.total * 100)) { showToast('Cash received is less than the amount due.', 'danger'); return; }
    }
    isSubmitting = true; renderPayAmounts();
    const btn = $('confirmPayBtn'), label = btn.textContent;
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Processing\u2026';
    if (!checkoutRequestId) checkoutRequestId = 'pos-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    const ref = method === 'Cash' ? '' : $('payRef').value.trim();
    const payload = {
      clientRequestId: checkoutRequestId,
      items: cart.map(function (c) { return { productId: c.productId, qty: c.qty }; }),   // the server re-reads prices, recomputes VAT/total and re-checks stock
      discount: t.discount,
      discountMode: t.discount > 0 ? disc.mode : null,
      discountValue: t.discount > 0 ? disc.value : 0,
      paymentMethod: method,
      amountReceived: method === 'Cash' ? received : t.total,
      customerId: customerId || null,
      reference: ref || null
    };
    try {
      const result = await Api.post('/sales', payload);
      const sale = result.sale;
      lastSale = sale; printedSaleId = null; checkoutRequestId = null;

      cart = []; disc = { mode: 'none', value: 0 }; customerId = ''; tendered = ''; method = 'Cash';
      closeModal('payOverlay');
      showDone(result);
      renderCart(); renderGrid();
      try {                                                    // refresh stock, today's sales, alerts in the background
        await Store.refresh();
        renderHeader(); renderTabs(); renderGrid(); renderCart(); renderCustomers();
        if (window.Notifications) Notifications.render();
        renderSidebar('pos');
      } catch (refreshErr) {
        console.warn('[checkout] Sale saved (' + sale.id + '), but Store.refresh failed:', refreshErr);
        showToast('Sale ' + sale.id + ' saved, but the screen could not refresh. Reload if numbers look off.', 'info');
      }
    } catch (err) {
      showToast(err.message, 'danger');
      if (err.status === 400 || err.status === 409) {          // stock / price / expiry changed on another terminal: fix the cart and let the cashier look again
        checkoutRequestId = null;
        try { await Store.refresh(); } catch (e) { /* ignore */ }
        cart = cart.filter(function (c) { const p = findProduct(c.productId); return p && !p.archived && p.stock > 0 && !isExpired(p); });
        cart.forEach(function (c) { const p = findProduct(c.productId); if (p) { if (c.qty > p.stock) c.qty = p.stock; c.price = p.sellingPrice; } });
        closeModal('payOverlay'); renderHeader(); renderTabs(); renderGrid(); renderCart();
      }
    } finally {
      isSubmitting = false;
      if (btn.isConnected) { btn.disabled = false; btn.textContent = label; }
      renderPayAmounts();
    }
  }

  /* ------------------------------------------------------------------ receipt screen */
  /* Receipt prints by itself as soon as the sale is saved (on by default; the cashier can switch it off on this screen).
     The first print is the original; the Print button afterwards is a logged "Reprint receipt". A retried checkout that the
     server recognised as already recorded (result.duplicate) is not printed again. Browsers show their print dialog unless
     they are started in kiosk-printing mode (see README). */
  const AUTOPRINT_KEY = 'tm:pos:autoprint:v1';
  function autoPrintOn() { try { return localStorage.getItem(AUTOPRINT_KEY) !== '0'; } catch (e) { return true; } }
  function autoPrintReceipt(sale) {
    printedSaleId = sale.id;
    Receipt.print(Receipt.fromSale(sale, null)).then(function () { $('printBtn').textContent = 'Reprint receipt'; })
      .catch(function () { printedSaleId = null; showToast('Could not open the print dialog. Tap Print receipt.', 'danger'); });
  }
  function showDone(result) {
    const sale = result.sale, isCash = sale.paymentMethod === 'Cash';
    $('doneNo').textContent = 'Transaction ' + sale.id;
    $('doneTotal').textContent = peso(sale.total);
    $('donePaidLabel').textContent = isCash ? 'Cash received' : 'Paid by';
    $('donePaid').textContent = isCash ? peso(sale.amountReceived) : sale.paymentMethod + (sale.reference ? ' \u00B7 ' + sale.reference : '');
    $('doneChangeRow').hidden = !isCash;
    $('doneChange').textContent = peso(sale.changeAmount || 0);
    const notes = [];
    if (result.warrantiesCreated) notes.push(result.warrantiesCreated + (result.warrantiesCreated === 1 ? ' warranty record' : ' warranty records') + ' created.');
    if (result.duplicate) notes.push('This sale had already been recorded; nothing was charged twice.');
    $('doneNote').textContent = notes.join(' ');
    const sc = result.stockChanges || [];
    $('doneStockWrap').hidden = !sc.length;
    $('doneStockSummary').textContent = 'Stock updated (' + sc.length + (sc.length === 1 ? ' item' : ' items') + ')';
    $('doneStock').innerHTML = sc.map(function (c) { return '<div><b>' + esc(c.name) + '</b><span>' + c.previousStock + ' \u2192 ' + c.newStock + '</span></div>'; }).join('');
    $('receiptPaper').innerHTML = Receipt.html(Receipt.fromSale(sale, null));
    $('printBtn').textContent = 'Print receipt';
    openModal('doneOverlay', 'newSaleBtn');
    $('autoPrint').checked = autoPrintOn();
    if (autoPrintOn() && !result.duplicate) setTimeout(function () { autoPrintReceipt(sale); }, 200);   // let the receipt screen paint first
  }
  async function onPrint() {
    const sale = lastSale; if (!sale) return;
    await Utils.withBusy($('printBtn'), async function () {
      if (printedSaleId !== sale.id) {                         // first print = the original receipt
        printedSaleId = sale.id;
        await Receipt.print(Receipt.fromSale(sale, null));
        $('printBtn').textContent = 'Reprint receipt';
        return;
      }
      try {                                                    // later prints are duplicates, stamped and written to the audit trail
        await Receipt.reprint(sale.id, 'pos-success-screen');
        showToast('Duplicate receipt logged in the audit trail.', 'ok');
      } catch (err) { showToast(err.message, 'danger'); }
    });
  }
  function onNewSale() {
    closeModal('doneOverlay');
    resetSale();
    focusSearch();
  }

  /* ------------------------------------------------------------------ quick customer */
  function openCustomerModal() {
    ['qcName', 'qcPhone', 'qcEmail'].forEach(function (id) { $(id).value = ''; });
    $('custErr').hidden = true;
    openModal('custOverlay', 'qcName');
  }
  async function saveCustomer() {
    const name = $('qcName').value.trim(), phone = $('qcPhone').value.trim(), email = $('qcEmail').value.trim(), err = $('custErr');
    const fail = function (m) { err.textContent = m; err.hidden = false; };
    if (!name) return fail('Enter the customer\u2019s name.');
    if (!/^[0-9+()\-\s]{7,20}$/.test(phone)) return fail('Enter a valid phone number.');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('Enter a valid email address or leave it blank.');
    await Utils.withBusy($('qcSaveBtn'), async function () {
      try {
        const c = await Api.post('/customers', { name: name, contactNumber: phone, email: email, source: 'pos' });
        await Store.refresh();
        customerId = c.id; renderCustomers();
        closeModal('custOverlay');
        showToast('Customer ' + c.name + ' added and selected.', 'ok');
      } catch (e) { fail(e.message); }
    });
  }

  /* ------------------------------------------------------------------ wiring */
  Boot.dom(function () {
    renderHeader(); tickClock(); setInterval(tickClock, 20000);
    renderCustomers(); renderFit(); renderTabs(); renderGrid(); renderCart(); renderHeldCount();

    // categories + grid
    $('ptTabs').addEventListener('click', function (e) {
      const t = e.target.closest('[data-cat]'); if (!t) return;
      activeCat = t.dataset.cat; clearSearch(); renderTabs(); renderGrid();
    });
    $('ptTabs').addEventListener('wheel', function (e) {       // mouse wheel scrolls the tab strip sideways
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { this.scrollLeft += e.deltaY; e.preventDefault(); }
    }, { passive: false });
    $('ptGrid').addEventListener('click', function (e) {
      const tile = e.target.closest('[data-add]'); if (!tile || tile.disabled) return;
      const p = findProduct(tile.dataset.add); if (!p) return;
      const r = addProduct(p); if (!r.ok) showToast(r.msg, 'danger');
    });

    // search / scan
    const search = $('ptSearch');
    let autoScanTimer = null;
    search.addEventListener('input', function () {
      $('ptSearchClear').hidden = !this.value; scanMsg(''); scheduleGrid();
      /* Some scanners send no Enter. If the box holds exactly a known barcode / SKU and typing then stops, add it. */
      clearTimeout(autoScanTimer);
      const v = this.value.trim().toLowerCase();
      if (v.length >= 8 && allProducts().some(function (p) { return (p.barcode && String(p.barcode).toLowerCase() === v) || (p.sku && String(p.sku).toLowerCase() === v); })) {
        autoScanTimer = setTimeout(onSearchEnter, 180);
      }
    });
    search.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); onSearchEnter(); } });
    $('ptSearchClear').addEventListener('click', function () { clearSearch(); scanMsg(''); search.focus(); });

    // fits my bike
    $('fitBtn').addEventListener('click', function (e) { e.stopPropagation(); toggleFitPop(); });
    $('fitPop').addEventListener('click', function (e) {
      e.stopPropagation();
      const b = e.target.closest('[data-brand]'), m = e.target.closest('[data-model]');
      if (b) { fit = { brand: b.dataset.brand, model: '' }; applyFit(); }
      else if (m) { fit.model = m.dataset.model; applyFit(); toggleFitPop(false); }
    });
    $('fitClear').addEventListener('click', function () { fit = { brand: '', model: '' }; applyFit(); toggleFitPop(false); });
    document.addEventListener('click', function () { toggleFitPop(false); });

    // cart
    $('ptLines').addEventListener('click', function (e) {
      const inc = e.target.closest('[data-inc]'), dec = e.target.closest('[data-dec]'), rem = e.target.closest('[data-remove]');
      if (inc) changeQty(parseInt(inc.dataset.inc, 10), 1);
      else if (dec) changeQty(parseInt(dec.dataset.dec, 10), -1);
      else if (rem) removeLine(parseInt(rem.dataset.remove, 10));
    });
    $('ptDiscChips').addEventListener('click', function (e) {
      const b = e.target.closest('[data-disc]'); if (!b) return;
      if (b.dataset.disc === 'custom') openDiscModal(); else setPresetDiscount(parseInt(b.dataset.disc, 10));
    });
    $('custBtn').addEventListener('click', function (e) { e.stopPropagation(); toggleCustPop(); });
    $('custPop').addEventListener('click', function (e) {
      e.stopPropagation();
      const it = e.target.closest('[data-cust]'); if (!it) return;
      customerId = it.dataset.cust; renderCustomers(); toggleCustPop(false);
    });
    $('custSearch').addEventListener('input', renderCustomerList);
    document.addEventListener('click', function () { toggleCustPop(false); });
    $('quickCustomerBtn').addEventListener('click', openCustomerModal);
    $('holdBtn').addEventListener('click', onHold);
    $('clearBtn').addEventListener('click', onClear);
    $('payBtn').addEventListener('click', openPay);
    $('cartBar').addEventListener('click', function () { document.body.classList.add('cart-open'); });
    $('cartBackBtn').addEventListener('click', function () { document.body.classList.remove('cart-open'); });

    // header
    $('heldBtn').addEventListener('click', function () { renderHeldList(); openModal('heldOverlay'); });
    $('logoutBtn').addEventListener('click', function () {
      if (cart.length) { holdCurrent(); showToast('Open sale saved to Held orders.', 'info'); }   // never lose a customer's order on log out
      logout();
    });
    window.addEventListener('storage', function (e) {            // another tab on this terminal held / resumed something
      if (e.key === HELD_KEY) { renderHeldCount(); if ($('heldOverlay').classList.contains('open')) renderHeldList(); }
    });

    // held orders
    $('heldList').addEventListener('click', function (e) {
      const r = e.target.closest('[data-resume]'), d = e.target.closest('[data-hdel]');
      if (r) resumeHeld(r.dataset.resume); else if (d) deleteHeld(d.dataset.hdel, d);
    });

    // discount modal
    document.querySelectorAll('[data-dtype]').forEach(function (b) { b.addEventListener('click', function () { setDiscType(b.dataset.dtype); }); });
    $('discValue').addEventListener('input', function () { $('discErr').hidden = true; updateDiscPreview(); });
    $('discValue').addEventListener('keydown', function (e) { if (e.key === 'Enter') applyCustomDiscount(); });
    $('discApplyBtn').addEventListener('click', applyCustomDiscount);

    // customer modal
    $('qcSaveBtn').addEventListener('click', saveCustomer);
    $('custForm').addEventListener('keydown', function (e) { if (e.key === 'Enter') saveCustomer(); });

    // payment modal
    $('payMethods').addEventListener('click', function (e) {
      const b = e.target.closest('[data-method]'); if (!b) return;
      method = b.dataset.method; tendered = ''; $('payRef').value = ''; renderPayMethods();
    });
    $('keypad').addEventListener('click', function (e) { const k = e.target.closest('[data-key]'); if (k) pressKey(k.dataset.key); });
    $('quickBtns').addEventListener('click', function (e) { const q = e.target.closest('button'); if (q) quickCash(q); });
    $('payPreview').addEventListener('toggle', renderPreview);
    $('payRef').addEventListener('input', renderPreview);
    $('confirmPayBtn').addEventListener('click', completeSale);

    // receipt screen
    $('printBtn').addEventListener('click', onPrint);
    $('autoPrint').addEventListener('change', function () { try { localStorage.setItem(AUTOPRINT_KEY, this.checked ? '1' : '0'); } catch (e) { /* ignore */ } });
    $('newSaleBtn').addEventListener('click', onNewSale);

    // generic close buttons + click outside (not for payment or the receipt, which must be left deliberately)
    document.querySelectorAll('[data-close]').forEach(function (b) { b.addEventListener('click', function () { closeModal(b.dataset.close); }); });
    ['heldOverlay', 'discOverlay', 'custOverlay'].forEach(function (id) {
      $(id).addEventListener('click', function (e) { if (e.target === this) closeModal(id); });
    });

    /* Keyboard: scanner + physical keyboard friendly.
       - On the sale screen, any printable key sent while nothing is focused goes to the search box (so a scan always lands there).
       - In the payment modal, digits / . / Backspace drive the keypad, Enter confirms.
       - Escape closes the top dialog (not the receipt screen) or the menu. */
    document.addEventListener('keydown', function (e) {
      const t = e.target, tag = t && t.tagName, typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable);
      if (e.key === 'Escape') {
        const top = openStack[openStack.length - 1];
        if (top && top !== 'doneOverlay') { closeModal(top); e.preventDefault(); return; }
        toggleFitPop(false); toggleCustPop(false); closeMobileSidebar(); return;
      }
      const top = openStack[openStack.length - 1];
      if (top === 'payOverlay') {
        if (e.key === 'Enter') { if (!$('confirmPayBtn').disabled) { e.preventDefault(); completeSale(); } return; }
        if (typing || e.ctrlKey || e.metaKey || e.altKey || method !== 'Cash') return;
        if (/^[0-9]$/.test(e.key) || e.key === '.') { pressKey(e.key); e.preventDefault(); }
        else if (e.key === 'Backspace') { pressKey('back'); e.preventDefault(); }
        else if (e.key === 'Delete') { pressKey('clear'); e.preventDefault(); }
        return;
      }
      if (top === 'doneOverlay') return;
      if (openStack.length || typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.length === 1) $('ptSearch').focus();             // the character itself then lands in the box
    });

    focusSearch();
  });
});
