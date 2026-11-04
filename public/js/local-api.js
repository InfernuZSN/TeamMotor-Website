/* ==========================================================================
   local-api.js — the TeamMotor API running INSIDE the browser ("Offline mode")
   --------------------------------------------------------------------------
   Used automatically by store.js when the site is opened by double-clicking an .html file (file://) or from any
   static host where no TeamMotor server answers. Same routes, same validation, same VAT/stock/void/count/audit/role
   rules as server/src — but the data is saved in THIS browser (localStorage), so:
     • one browser = one shop database (not shared between computers),
     • there is no real security (anyone with the browser can read its storage),
     • clearing site data erases it.
   Use the Node + MongoDB server (see README) when you need shared, secured, backed-up data.
   ========================================================================== */
const LocalApi = (function () {
  const KEY = 'teammotor:local:db:v1';
  const PAYMENT = ['Cash', 'GCash'];   // new sales only — same list as the server (old Maya / Bank Transfer / Other sales are kept as history)
  let db = null, memOnly = false, lastStored = null;   // lastStored = the saved text this tab last read or wrote

  const E = function (status, msg) { const e = new Error(msg); e.status = status; return e; };
  const bad = function (m) { return E(400, m); };
  const nf = function (m) { return E(404, m || 'Not found'); };
  const conflict = function (m) { return E(409, m); };
  const clone = function (o) { return o === undefined ? undefined : JSON.parse(JSON.stringify(o)); };
  const r2 = function (n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; };
  const nowISO = function () { return new Date().toISOString(); };
  const today = function () { return Utils.todayStr(); };
  const pad = function (n, w) { return String(n).padStart(w, '0'); };

  /* ---- tiny synchronous SHA-256 (demo-grade password hashing; the real server uses bcrypt) ---- */
  function sha256(str) {
    const K = [], H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    let isPrime = function (n) { for (let i = 2; i * i <= n; i++) if (n % i === 0) return false; return true; }, c = 0;
    for (let n = 2; c < 64; n++) if (isPrime(n)) { K[c++] = (Math.pow(n, 1 / 3) * 4294967296) | 0; }
    c = 0; for (let n = 2; c < 8; n++) if (isPrime(n)) { H[c++] = (Math.pow(n, 1 / 2) * 4294967296) | 0; }
    const s = unescape(encodeURIComponent(str)); const bytes = [];
    for (let i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i));
    const bitLen = bytes.length * 8; bytes.push(0x80); while (bytes.length % 64 !== 56) bytes.push(0);
    for (let i = 7; i >= 0; i--) bytes.push(i > 3 ? 0 : (bitLen >>> (i * 8)) & 255);
    const rr = function (v, a) { return (v >>> a) | (v << (32 - a)); };
    for (let off = 0; off < bytes.length; off += 64) {
      const w = [];
      for (let i = 0; i < 16; i++) w[i] = (bytes[off + i * 4] << 24) | (bytes[off + i * 4 + 1] << 16) | (bytes[off + i * 4 + 2] << 8) | bytes[off + i * 4 + 3];
      for (let i = 16; i < 64; i++) {
        const s0 = rr(w[i - 15], 7) ^ rr(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = rr(w[i - 2], 17) ^ rr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      let [a, b, cc, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
        const t2 = ((rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & b) ^ (a & cc) ^ (b & cc))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = cc; cc = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + cc) | 0; H[3] = (H[3] + d) | 0; H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    return H.map(function (x) { return (x >>> 0).toString(16).padStart(8, '0'); }).join('');
  }
  const hashPw = function (pw) { return sha256('teammotor-local:' + pw); };

  /* ---------------- storage ---------------- */
  function save() {
    if (memOnly) return;
    try { const json = JSON.stringify(db); localStorage.setItem(KEY, json); lastStored = json; }
    catch (e) { throw E(507, 'Browser storage is full or blocked. Export what you need, then reset the demo data.'); }
  }
  /* Databases saved by an older version don't have the shop's full category list. Add what's missing and rename the
     old default names (only when the admin hasn't changed them). Existing category ids never change, so products keep
     pointing at the right category. Mirrors server/src/services/categories.js. */
  function ensureDefaultCategories() {
    if (!db || !Array.isArray(db.categories)) return;
    db.counters = db.counters || {};
    let changed = false;
    CATEGORIES.forEach(function (def) {
      const have = db.categories.find(function (c) { return c.id === def.id; });
      if (have) {
        if (LEGACY_CATEGORY_NAMES[def.id] && have.name === LEGACY_CATEGORY_NAMES[def.id] && have.name !== def.name) { have.name = def.name; changed = true; }
        return;
      }
      let prefix = def.prefix;
      if (db.categories.some(function (c) { return c.prefix === prefix; })) prefix = prefix.slice(0, 2) + 'X';
      db.categories.push({ id: def.id, name: def.name, prefix: prefix, status: 'Active' });
      changed = true;
    });
    if (changed) save();
  }
  /* Manage Filters lists (mirrors server/src/services/filters.js):
       • brands — every brand already written on a product is kept on the list, so existing products stay valid;
       • motoBrands — the default motorcycle makes/models, added once (a missing key means "never filled"). */
  function ensureDefaultFilters() {
    if (!db || !Array.isArray(db.products)) return;
    db.counters = db.counters || {};
    let changed = false;
    if (!Array.isArray(db.brands)) { db.brands = []; changed = true; }
    const have = {}; db.brands.forEach(function (b) { have[b.name.toLowerCase()] = true; });
    db.products.map(function (p) { return String(p.brand || '').trim(); }).filter(Boolean).sort(function (a, b) { return a.localeCompare(b); }).forEach(function (name) {
      if (have[name.toLowerCase()]) return;
      db.brands.push({ id: nextId('BRD', 'BRD', 3), name: name });
      have[name.toLowerCase()] = true; changed = true;
    });
    if (!Array.isArray(db.motoBrands)) {
      db.motoBrands = Object.keys(MOTO_BRANDS).map(function (name) { return { id: nextId('MOTO', 'MOTO', 3), name: name, models: MOTO_BRANDS[name].slice() }; });
      changed = true;
    }
    if (changed) { try { save(); } catch (e) { /* storage blocked — kept in memory for this session */ } }
  }
  /* Older saved databases carry the seed placeholder "[email protected]" on customers, which fails email validation and
     blocks editing. Swap it for the fixed seed address (or blank it for non-seed records). Real addresses are never touched. */
  function fixPlaceholderEmails() {
    if (!db || !Array.isArray(db.customers)) return;
    const PLACEHOLDER = '[email protected]';
    let changed = false;
    db.customers.forEach(function (c) {
      if (c.email !== PLACEHOLDER) return;
      const def = CUSTOMERS.find(function (x) { return x.id === c.id; });
      c.email = def && def.email !== PLACEHOLDER ? def.email : '';
      changed = true;
    });
    if (changed) { try { save(); } catch (e) { /* storage blocked — fixed in memory for this session */ } }
  }
  function load() {
    if (db) return;
    try { lastStored = localStorage.getItem(KEY); db = JSON.parse(lastStored || 'null'); } catch (e) { db = null; memOnly = true; }
    if (!db) { db = seed(); try { save(); } catch (e) { memOnly = true; } }
    ensureDefaultCategories();
    ensureDefaultFilters();
    fixPlaceholderEmails();
    if (db && Array.isArray(db.products)) {
      db.products.forEach(function (p, idx) {
        if (!p.sku) p.sku = 'TM-' + p.id;
        if (!p.barcode) p.barcode = '4801234567' + pad(idx + 1, 2);
      });
    }
  }
  function reset() { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } db = null; }

  function nextId(counter, prefix, width) {
    db.counters[counter] = (db.counters[counter] || 0) + 1;
    return prefix + '-' + pad(db.counters[counter], width);
  }
  const maxSuffix = function (ids, re) { return ids.reduce(function (m, id) { const x = String(id).match(re); return x ? Math.max(m, parseInt(x[1], 10)) : m; }, 0); };

  /* ---------------- seed (same fixtures the server seed script uses) ---------------- */
  function seed() {
    const t = today();
    const settings = {
      shopName: 'TeamMotor', tagline: 'MOTORCYCLE PARTS & ACCESSORIES SHOP', addressLines: ['1234 Highway, Brgy. San Isidro', 'Quezon City, Metro Manila'],
      phone: '(02) 8123-4567', tin: 'VAT REG. TIN: 123-456-789-00000', vatEnabled: true, vatRate: 0.12, vatMode: 'inclusive',
      receiptFooter: ['Thank you for your purchase!', 'Ride \u2022 Repair \u2022 Repeat'], expiryWarningMonths: 3
    };
    const shopSnap = { shopName: settings.shopName, tagline: settings.tagline, addressLines: settings.addressLines, phone: settings.phone, tin: settings.tin, receiptFooter: settings.receiptFooter };
    const d = {
      settings: settings, counters: {}, audit: [], notifications: [],
      users: clone(USERS).map(function (u) { u.passwordHash = hashPw(u.role === 'Admin' ? 'Admin@12345' : 'Staff@12345'); return u; }),
      categories: clone(CATEGORIES).filter(function (c) { return c.id !== 'motorcycles'; }),
      suppliers: clone(SUPPLIERS),
      products: clone(PRODUCTS).filter(function (p) { return p.category !== 'motorcycles'; }).map(function (p) { p.expirationDate = null; return p; }),
      customers: clone(CUSTOMERS), inventoryTransactions: clone(INVENTORY_TRANSACTIONS).filter(function (x) { return x.productId.indexOf('MOT-') !== 0; }),
      warranties: clone(WARRANTIES).map(function (w) { w.claims = (w.claims || []).map(function (c, i) { return Object.assign({ id: 'CLM-' + w.id.slice(4) + (i + 1), warrantyId: w.id, status: 'Resolved', staff: c.staff || 'Juan Dela Cruz' }, c); }); return w; }),
      shifts: clone(SHIFTS)
    };
    const oil = d.products.find(function (p) { return p.id === 'ENG-001'; });
    if (oil) oil.expirationDate = Utils.calculateWarrantyExpiry(t, 14, 'months');
    const extras = [
      { id: 'OTH-002', sku: 'TM-OTH-002', barcode: '480123456716', name: 'Brake Fluid DOT 4 (250ml)', brand: 'Bosch', category: 'other-parts', compatibility: ['Universal (All Models)'], compatYears: 'All Years', supplier: 'SUP-002', supplierRef: 'YGP-BF-250', description: 'DOT 4 brake fluid, 250 ml bottle. Shelf-life limited.', costPrice: 120, sellingPrice: 190, stock: 8, reorderLevel: 4, expirationDate: Utils.calculateWarrantyExpiry(t, 52, 'days') },
      { id: 'ENG-004', sku: 'TM-ENG-004', barcode: '480123456717', name: 'Engine Degreaser Spray (400ml)', brand: 'Generic', category: 'engine-parts', compatibility: ['Universal (All Models)'], compatYears: 'All Years', supplier: 'SUP-001', supplierRef: 'ABC-DG-400', description: 'Aerosol degreaser. Past its best-before date \u2014 pull from sale.', costPrice: 95, sellingPrice: 150, stock: 5, reorderLevel: 3, expirationDate: Utils.calculateWarrantyExpiry(t, -20, 'days') }
    ];
    let trx = maxSuffix(d.inventoryTransactions.map(function (x) { return x.id; }), /^TRX-(\d+)$/);
    extras.forEach(function (e) {
      d.products.push(Object.assign({ image: e.category, archived: false, lastUpdated: nowISO() }, e));
      d.inventoryTransactions.push({ id: 'TRX-' + pad(++trx, 4), productId: e.id, productName: e.name, type: 'Stock In', quantity: e.stock, previousStock: 0, newStock: e.stock, date: nowISO(), user: 'Juan Dela Cruz', supplierId: e.supplier, reference: 'Opening count', reason: null, notes: 'Opening stock count' });
    });
    const unameByName = {}; d.users.forEach(function (u) { unameByName[u.name] = u.username; });
    d.sales = clone(SALES).map(function (s) {
      const sub = s.items.reduce(function (n, i) { return n + i.subtotal; }, 0);
      const tt = Utils.computeTotals(sub, 0, settings);
      return Object.assign({}, s, { subtotal: tt.subtotal, discount: 0, vatEnabled: tt.vatEnabled, vatMode: tt.vatMode, vatRate: tt.vatRate, vatableAmount: tt.vatableAmount, vatAmount: tt.vatAmount, total: tt.total, amountReceived: tt.total, changeAmount: 0, status: 'Completed', paymentStatus: 'Paid', staffUsername: unameByName[s.staff] || '', shop: shopSnap, reprintCount: 0, lastReprintAt: null });
    });
    d.counters = {
      SALE: maxSuffix(d.sales.map(function (s) { return s.id; }), /^SALE-(\d+)$/), TRX: trx,
      USR: maxSuffix(d.users.map(function (u) { return u.id; }), /^USR-(\d+)$/), SUP: maxSuffix(d.suppliers.map(function (u) { return u.id; }), /^SUP-(\d+)$/),
      CUST: maxSuffix(d.customers.map(function (u) { return u.id; }), /^CUST-(\d+)$/), WAR: maxSuffix(d.warranties.map(function (u) { return u.id; }), /^WAR-(\d+)$/),
      SHF: maxSuffix(d.shifts.map(function (u) { return u.id; }), /^SHF-(\d+)$/), CLM: 100, NTF: 0, AUD: 0
    };
    CATEGORIES.forEach(function (c) { d.counters['PRD-' + c.prefix] = maxSuffix(d.products.filter(function (p) { return p.category === c.id; }).map(function (p) { return p.id; }), /-(\d+)$/); });
    return d;
  }

  /* ---------------- shared helpers (mirror server/src) ---------------- */
  function audit(user, action, entity, entityId, details) {
    db.audit.unshift({ id: nextId('AUD', 'AUD', 6), at: nowISO(), userId: user && user.id, username: user && user.username, userName: user && user.name, role: user && user.role, action: action, entity: entity || null, entityId: entityId || null, details: details || {}, ip: 'local' });
    if (db.audit.length > 3000) db.audit.length = 3000;
  }
  /* Changed fields only: { field: { from, to } } — never includes passwords/hashes (mirrors server utils/audit.diff). */
  function diff(before, after, keys) {
    const out = {};
    (keys || Object.keys(after || {})).forEach(function (k) {
      if (/password|hash|token/i.test(k)) return;
      const a = before ? before[k] : undefined, b = after ? after[k] : undefined;
      if (JSON.stringify(a === undefined ? null : a) !== JSON.stringify(b === undefined ? null : b)) out[k] = { from: a === undefined ? null : a, to: b === undefined ? null : b };
    });
    return out;
  }
  const SENSITIVE_ACTIONS = ['user.password_change', 'auth.login_failed', 'auth.login_blocked', 'sale.void', 'sale.voided', 'sale.cancelled', 'sale.refunded', 'sale.refund',
    'stock.adjust', 'stock.out', 'user.create', 'user.update', 'user.delete', 'product.archive', 'customer.deactivate', 'settings.update'];
  const splitDiff = function (ch) { const b = {}, a = {}; Object.keys(ch).forEach(function (k) { b[k] = ch[k].from; a[k] = ch[k].to; }); return { before: b, after: a }; };
  const pubUser = function (u) { const c = clone(u); delete c.passwordHash; return c; };
  const needAdmin = function (ctx) { if (ctx.user.role !== 'Admin') throw E(403, 'This action requires Admin access.'); };
  const findProduct = function (id) { return db.products.find(function (p) { return p.id === id; }); };
  const findSale = function (id) { return db.sales.find(function (s) { return s.id === id; }); };

  function changeStock(o) {
    const p = findProduct(o.productId);
    if (!p) throw nf('Product ' + o.productId + ' not found.');
    const delta = Math.trunc(o.delta);
    if (!delta) throw bad('Quantity change cannot be zero.');
    if (delta < 0 && p.stock < -delta) throw bad('Insufficient stock for ' + p.name + ' (only ' + p.stock + ' available).');
    const prev = p.stock;
    p.stock += delta;
    p.lastUpdated = nowISO();
    try {
      const txn = { id: nextId('TRX', 'TRX', 4), productId: p.id, productName: p.name, type: o.type, quantity: delta, previousStock: prev, newStock: p.stock, date: o.date || nowISO(), created_at: nowISO(), user: o.user || '', supplierId: o.supplierId || null, reference: o.reference || null, reason: o.reason || null, notes: o.notes || '' };
      db.inventoryTransactions.unshift(txn);
      return { product: p, txn: txn };
    } catch (err) {
      p.stock = prev;
      throw err;
    }
  }

  const saleCountable = function (s) { return !s.status || s.status === 'Completed'; };
  function customerStats(id) {
    const list = db.sales.filter(function (s) { return s.customerId === id && saleCountable(s); });
    return { totalPurchases: list.length, totalSpent: r2(list.reduce(function (n, s) { return n + s.total; }, 0)), lastPurchase: list.length ? list.map(function (s) { return s.date; }).sort().pop() : null };
  }
  const decorateCustomer = function (c) { return Object.assign(clone(c), customerStats(c.id)); };
  function warrantyOut(w) { const c = clone(w); c.claims = c.claims || []; c.status = Utils.getWarrantyStatus(c); return c; }

  function expiryReport() {
    const months = db.settings.expiryWarningMonths || 3, t = today(), cutoff = Utils.calculateWarrantyExpiry(t, months, 'months');
    const out = { today: t, cutoff: cutoff, warningMonths: months, expired: [], expiring: [] };
    db.products.filter(function (p) { return !p.archived && p.stock > 0 && p.expirationDate; }).sort(function (a, b) { return a.expirationDate < b.expirationDate ? -1 : 1; }).forEach(function (p) {
      const exp = String(p.expirationDate).slice(0, 10), row = Object.assign(clone(p), { daysLeft: Math.round((new Date(exp) - new Date(t)) / 86400000) });
      if (exp < t) out.expired.push(row); else if (exp <= cutoff) out.expiring.push(row);
    });
    return out;
  }

  function refreshNotifications() {
    const s = db.settings, t = today(), cutoff = Utils.calculateWarrantyExpiry(t, s.expiryWarningMonths || 3, 'months'), want = {};
    const fmt = function (d) { return new Date(d + 'T00:00:00').toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }); };
    db.products.filter(function (p) { return !p.archived; }).forEach(function (p) {
      const add = function (type, title, message) { want[type + ':' + p.id] = { type: type, productId: p.id, title: title, message: message, link: 'inventory.html' }; };
      if (p.stock <= 0) add('out-of-stock', 'Out of Stock', p.name + ' is now out of stock.');
      else if (p.stock <= p.reorderLevel) add('low-stock', 'Low Stock', p.name + ' has ' + p.stock + (p.stock === 1 ? ' unit' : ' units') + ' remaining.');
      else if (p.stock <= p.reorderLevel * 1.5) add('restock-reminder', 'Restock Reminder', p.name + ' is approaching its reorder level.');
      if (p.expirationDate && p.stock > 0) {
        const exp = String(p.expirationDate).slice(0, 10);
        if (exp < t) add('expired', 'Product Expired', p.name + ' expired on ' + fmt(exp) + ' (' + p.stock + ' in stock). Remove it from sale.');
        else if (exp <= cutoff) add('expiring-soon', 'Expiring Soon', p.name + ' expires on ' + fmt(exp) + ' (' + p.stock + ' in stock).');
      }
    });
    db.warranties.forEach(function (w) {
      if (Utils.getWarrantyStatus(w) !== 'Expiring Soon') return;
      const c = db.customers.find(function (x) { return x.id === w.customerId; }), p = findProduct(w.productId);
      want['warranty-expiring:' + w.id] = { type: 'warranty-expiring', warrantyId: w.id, title: 'Warranty Expiring Soon', link: 'warranty.html', message: (p ? p.name : (w.productName || 'An item')) + ' (' + (c ? c.name : 'Walk-in Customer') + ') expires ' + fmt(w.warrantyExpiration.slice(0, 10)) + '.' };
    });

    // Recent sales events (voided / refunded / cancelled within 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    (db.sales || []).filter(function (s) { return ['Voided', 'Cancelled', 'Refunded'].indexOf(s.status) !== -1 && s.date >= sevenDaysAgo; }).slice(0, 10).forEach(function (s) {
      want['sale-event:' + s.id] = {
        type: 'sale-event', title: 'Sale ' + s.status, link: 'sales.html',
        message: 'Sale ' + s.id + ' was ' + s.status.toLowerCase() + ' by ' + (s.voidInfo && s.voidInfo.by ? s.voidInfo.by : 'Admin') + '. Reason: ' + (s.voidInfo && s.voidInfo.reason ? s.voidInfo.reason : 'Reversed') + '.'
      };
    });
    const old = {}; db.notifications.forEach(function (n) { old[n.key] = n; });
    db.notifications = Object.keys(want).map(function (key) {
      const cur = old[key];
      if (cur) { cur.message = want[key].message; return cur; }
      return Object.assign({ id: nextId('NTF', 'NTF', 4), key: key, date: nowISO(), read: false }, want[key]);
    }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  }

  /* ---------------- business operations ---------------- */
  function createSale(input, user) {
    if (input.clientRequestId) { const dup = db.sales.find(function (s) { return s.clientRequestId === input.clientRequestId; }); if (dup) return { sale: clone(dup), duplicate: true, stockChanges: [], warrantiesCreated: 0 }; }
    if (!Array.isArray(input.items) || !input.items.length) throw bad('Add at least one item before checkout.');
    if (PAYMENT.indexOf(input.paymentMethod) === -1) throw bad('Unsupported payment method.');
    const wanted = {}, order = [];
    input.items.forEach(function (l) {
      const q = Number(l.qty);
      if (!l.productId || !Number.isInteger(q) || q < 1 || q > 10000) throw bad('Each item needs a valid product and a whole-number quantity of at least 1.');
      if (!(l.productId in wanted)) { wanted[l.productId] = 0; order.push(l.productId); }
      wanted[l.productId] += q;
    });
    const t = today();
    order.forEach(function (pid) {
      const p = findProduct(pid);
      if (!p || p.archived) throw bad('Product ' + pid + ' is not available for sale.');
      if (p.expirationDate && String(p.expirationDate).slice(0, 10) < t) throw bad(p.name + ' expired on ' + String(p.expirationDate).slice(0, 10) + ' and cannot be sold.');
      if (wanted[pid] > p.stock) throw bad('Not enough stock for ' + p.name + ' (' + p.stock + ' available, ' + wanted[pid] + ' requested).');
    });
    let customer = null;
    if (input.customerId) {
      customer = db.customers.find(function (c) { return c.id === input.customerId; });
      if (!customer) throw bad('Selected customer does not exist.');
      if (customer.status !== 'Active') throw bad('Customer ' + customer.name + ' is inactive. Reactivate the customer first.');
    }
    const lines = order.map(function (pid) { const p = findProduct(pid); return { productId: pid, name: p.name, qty: wanted[pid], price: p.sellingPrice, costPrice: p.costPrice || 0, subtotal: r2(wanted[pid] * p.sellingPrice) }; });
    const subtotal = r2(lines.reduce(function (n, l) { return n + l.subtotal; }, 0)), discount = r2(Number(input.discount) || 0);
    if (discount < 0) throw bad('Discount cannot be negative.');
    if (discount > subtotal) throw bad('Discount cannot be more than the subtotal.');
    if (discount > 0 && (!user || user.role !== 'Admin')) throw E(403, 'Only an Admin can apply a discount. Ask an Admin to ring up this sale.');
    const discountMode = discount > 0 ? (['percent', 'amount'].indexOf(input.discountMode) !== -1 ? input.discountMode : 'amount') : null;
    const discountValue = discount > 0 ? r2(Number(input.discountValue) || discount) : 0;
    const tot = Utils.computeTotals(subtotal, discount, db.settings);
    let received = tot.total, change = 0;
    if (input.paymentMethod === 'Cash') {
      received = r2(Number(input.amountReceived) || 0);
      if (received < tot.total) throw bad('Cash received (' + received.toFixed(2) + ') is less than the total due (' + tot.total.toFixed(2) + ').');
      change = r2(received - tot.total);
    }
    const now = nowISO(), id = nextId('SALE', 'SALE', 4), changes = [];
    lines.forEach(function (l) {
      const r = changeStock({ productId: l.productId, delta: -l.qty, type: 'Sale', user: user.name, reference: id, reason: 'Sold', notes: 'Sold via POS (' + id + ')', date: now });
      changes.push({ productId: l.productId, name: r.product.name, previousStock: r.txn.previousStock, newStock: r.txn.newStock });
    });
    const s = db.settings;
    const sale = { id: id, date: now, items: lines, subtotal: tot.subtotal, discount: tot.discount, discountMode: discountMode, discountValue: discountValue, vatEnabled: tot.vatEnabled, vatMode: tot.vatMode, vatRate: tot.vatRate, vatableAmount: tot.vatableAmount, vatAmount: tot.vatAmount, total: tot.total,
      paymentMethod: input.paymentMethod, amountReceived: received, changeAmount: change, reference: input.reference ? String(input.reference).trim().slice(0, 80) : null, status: 'Completed', paymentStatus: 'Paid',
      staff: user.name, staffUsername: user.username, customerId: customer ? customer.id : null,
      shop: { shopName: s.shopName, tagline: s.tagline, addressLines: s.addressLines, phone: s.phone, tin: s.tin, receiptFooter: s.receiptFooter }, reprintCount: 0, lastReprintAt: null, clientRequestId: input.clientRequestId || undefined };
    db.sales.unshift(sale);
    let made = 0;
    lines.forEach(function (l) {
      const p = findProduct(l.productId), has = p.warrantyDuration && Number(p.warrantyDuration) > 0, rubber = p.rubber === true || /\b(tires?|tyres?|rubber)\b/i.test(p.name || '');
      if (!has && !rubber) return;
      const dur = has ? Number(p.warrantyDuration) : 7, unit = has ? (p.warrantyUnit || 'months') : 'days', start = now.slice(0, 10);
      db.warranties.unshift({ id: nextId('WAR', 'WAR', 3), customerId: customer ? customer.id : null, saleId: id, productId: p.id, productName: p.name, purchaseDate: start, warrantyStart: start,
        warrantyExpiration: Utils.calculateWarrantyExpiry(start, dur, unit), coverage: p.warrantyType || (rubber ? 'Manufacturing defects only \u2014 7 days from purchase (tires/rubber)' : 'Standard parts warranty'), status: 'Active', claims: [] });
      made++;
    });
    audit(user, 'sale.create', 'sale', id, { total: sale.total, items: lines.length, paymentMethod: sale.paymentMethod, subtotal: sale.subtotal, discount: sale.discount, discountMode: sale.discount > 0 ? discountMode : null, discountValue: sale.discount > 0 ? discountValue : null, reference: sale.reference || null, customerId: sale.customerId, customerName: customer ? customer.name : null });
    refreshNotifications();
    return { sale: clone(sale), stockChanges: changes, warrantiesCreated: made, duplicate: false };
  }

  function voidSale(id, type, reason, user) {
    if (['Voided', 'Cancelled', 'Refunded'].indexOf(type) === -1) throw bad('Type must be Voided, Cancelled or Refunded.');
    const why = String(reason || '').trim();
    if (why.length < 3) throw bad('A reason is required.');
    const sale = findSale(id);
    if (!sale) throw nf('Sale ' + id + ' not found.');
    if (sale.status !== 'Completed') throw conflict('Sale ' + id + ' is already ' + sale.status + '.');
    const now = nowISO();

    // Recoverable reversals: check existing 'Void Restock' transactions so retries NEVER restock lines twice
    const existingTxns = db.inventoryTransactions.filter(function (t) { return t.reference === id && t.type === 'Void Restock'; });
    const alreadyRestocked = {};
    existingTxns.forEach(function (t) { alreadyRestocked[t.productId] = true; });

    const restocked = [];
    const failed = [];
    const restockSkipped = [];   // lines whose product was retired from the catalog — nothing to put back on a shelf
    (sale.items || []).forEach(function (it) {
      if (alreadyRestocked[it.productId]) {
        const p = findProduct(it.productId);
        restocked.push({ productId: it.productId, name: it.name, qty: it.qty, newStock: p ? p.stock : 0, alreadyDone: true });
        return;
      }
      const prod = findProduct(it.productId);
      if (!prod) {
        // Retired / removed product: skip the restock (warning goes into the audit entry) instead of blocking the void.
        restockSkipped.push({ productId: it.productId, name: it.name, qty: it.qty, reason: 'Restock skipped for retired product: ' + it.productId });
        return;
      }
      try {
        const r = changeStock({ productId: it.productId, delta: it.qty, type: 'Void Restock', user: user.name, reference: id, reason: type, notes: type + ' sale ' + id + ': ' + why.slice(0, 120), date: now });
        restocked.push({ productId: it.productId, name: it.name, qty: it.qty, newStock: r.txn.newStock });
      } catch (err) {
        failed.push({ productId: it.productId, name: it.name, error: err.message });
      }
    });

    // Do NOT mark the sale fully voided or refunded if stock restoration only partially succeeds
    if (failed.length > 0) {
      throw conflict('Stock restoration failed for ' + failed.map(function (f) { return f.name || f.productId; }).join(', ') + '. Sale was NOT marked ' + type + '. Please resolve product issues and retry.');
    }

    sale.status = type;
    sale.voidInfo = { type: type, reason: why.slice(0, 300), by: user.name, byUsername: user.username, at: now };
    db.warranties.forEach(function (w) { if (w.saleId === id) w.status = 'Voided'; });
    audit(user, 'sale.' + type.toLowerCase(), 'sale', id, { type: type, reason: why, total: sale.total, paymentMethod: sale.paymentMethod, itemCount: (sale.items || []).reduce(function (n, i) { return n + (i.qty || 0); }, 0), originalStaff: sale.staff || null, restocked: restocked, restockSkipped: restockSkipped });
    refreshNotifications();
    return { sale: clone(sale), restocked: restocked, restockSkipped: restockSkipped };
  }

  const PRODUCT_FIELDS = ['name', 'brand', 'category', 'compatibility', 'compatYears', 'supplier', 'supplierRef', 'sku', 'barcode', 'description', 'costPrice', 'sellingPrice', 'reorderLevel', 'warrantyDuration', 'warrantyUnit', 'warrantyType', 'warrantyDays', 'rubber', 'expirationDate', 'image', 'storageLocation'];
  function cleanProduct(b) {
    const o = {}; PRODUCT_FIELDS.forEach(function (k) { if (b[k] !== undefined) o[k] = b[k]; });
    if (o.expirationDate !== undefined) { if (!o.expirationDate) o.expirationDate = null; else if (!/^\d{4}-\d{2}-\d{2}$/.test(o.expirationDate)) throw bad('Expiration date must be YYYY-MM-DD.'); }
    ['costPrice', 'sellingPrice', 'reorderLevel'].forEach(function (k) { if (o[k] !== undefined && (!isFinite(Number(o[k])) || Number(o[k]) < 0)) throw bad(k + ' must be a non-negative number.'); });
    return o;
  }
  /* Manage Filters helpers (mirror server/src/routes/catalog.js) */
  const sortByName = function (list) { return clone(list).sort(function (a, b) { return a.name.localeCompare(b.name); }); };
  function cleanName(v, label, max) {
    const name = String(v || '').trim().replace(/\s+/g, ' ');
    if (!name) throw bad(label + ' is required.');
    if (name.length > max) throw bad(label + ' must be ' + max + ' characters or fewer.');
    return name;
  }
  const sameName = function (a, b) { return String(a).toLowerCase() === String(b).toLowerCase(); };
  const compatUsers = function (entries) { return db.products.filter(function (p) { return (p.compatibility || []).some(function (c) { return entries.indexOf(c) !== -1; }); }).length; };
  /* Brand + compatibility must come from the Manage Filters lists; values a product already has are accepted on edit. */
  function checkFilterValues(d, before) {
    if (d.brand !== undefined) {
      d.brand = String(d.brand || '').trim();
      if (d.brand && !(before && before.brand === d.brand)) {
        const b = (db.brands || []).find(function (x) { return sameName(x.name, d.brand); });
        if (!b) throw bad('Unknown brand "' + d.brand + '". Add it under Manage Filters \u2192 Manage Brands first.');
        d.brand = b.name;
      }
    }
    if (d.compatibility !== undefined) {
      if (!Array.isArray(d.compatibility)) throw bad('Compatibility must be a list.');
      const had = before ? before.compatibility || [] : [];
      const allowed = {}; (db.motoBrands || []).forEach(function (mb) { mb.models.forEach(function (m) { const full = mb.name + ' ' + m; allowed[full.toLowerCase()] = full; }); });
      const unknown = d.compatibility.filter(function (c) { return c !== UNIVERSAL_FIT && had.indexOf(c) === -1 && !allowed[c.toLowerCase()]; });
      if (unknown.length) throw bad('Unknown motorcycle model(s): ' + unknown.join(', ') + '. Add them under Manage Filters \u2192 Manage Motorcycle Compatibility first.');
      d.compatibility = d.compatibility.map(function (c) { return allowed[c.toLowerCase()] || c; });
    }
  }

  const PW_RE = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
  const checkPw = function (pw) { if (!PW_RE.test(String(pw || ''))) throw bad('Password must be at least 8 characters and include a letter and a number.'); };
  const PHONE_RE = /^[0-9+()\-\s]{7,20}$/, EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const normPhone = function (s) { return String(s || '').replace(/[^0-9+]/g, ''); };
  function cleanCustomer(b) {
    const name = String(b.name || '').trim(), phone = String(b.contactNumber || '').trim();
    if (!name) throw bad('Customer name is required.');
    if (!phone) throw bad('Phone number is required.');
    if (!PHONE_RE.test(phone)) throw bad('Enter a valid phone number.');
    if (b.email && !EMAIL_RE.test(String(b.email).trim())) throw bad('Enter a valid email address.');
    return { name: name, contactNumber: phone, email: String(b.email || '').trim(), address: String(b.address || '').trim(), notes: String(b.notes || '').trim().slice(0, 500) };
  }
  function phoneFree(phone, exceptId) {
    const dup = db.customers.find(function (c) { return c.status === 'Active' && c.id !== exceptId && normPhone(c.contactNumber) === normPhone(phone); });
    if (dup) throw conflict('That phone number already belongs to ' + dup.name + ' (' + dup.id + ').');
  }
  const parseQty = function (v) { const n = Number(v); if (!Number.isInteger(n) || n < 1 || n > 100000) throw bad('Quantity must be a whole number of at least 1.'); return n; };
  const parseDate = function (v) { if (!v) return undefined; const d = new Date(v); if (isNaN(d)) throw bad('Invalid date.'); if (d.getTime() > Date.now() + 300000) throw bad('Date cannot be in the future.'); return d.toISOString(); };

  /* ---------------- router ---------------- */
  const routes = [];
  const R = function (method, re, fn) { routes.push({ method: method, re: new RegExp('^' + re + '$'), fn: fn }); };

  R('POST', '/auth/login', function (c) {
    const ident = String(c.body.username || '').trim().toLowerCase(), pw = String(c.body.password || '');
    if (!ident || !pw) throw bad('Username and password are required.');
    const u = db.users.find(function (x) { return x.username.toLowerCase() === ident || (x.email || '').toLowerCase() === ident; });
    if (!u || u.passwordHash !== hashPw(pw)) { audit(null, 'auth.login_failed', 'user', u ? u.id : null, { username: ident }); save(); throw E(401, 'Invalid username or password.'); }
    if (u.status !== 'Active') { audit(null, 'auth.login_blocked', 'user', u.id, { username: u.username, reason: 'inactive' }); save(); throw E(403, 'This account is inactive. Please contact an administrator.'); }
    audit(u, 'auth.login', 'user', u.id, { username: u.username }); save();
    return { token: 'local:' + u.id, user: pubUser(u) };
  });
  R('GET', '/auth/google/config', function () {
    return { clientId: window.GOOGLE_CLIENT_ID || '' };
  });
  R('POST', '/auth/google', function (c) {
    const email = String(c.body.email || '').trim().toLowerCase();
    if (!email) throw bad('Google email is required.');
    const u = db.users.find(function (x) { return (x.email || '').toLowerCase() === email; });
    if (!u) {
      audit(null, 'auth.login_failed', 'user', null, { email: email, provider: 'google' }); save();
      throw E(404, 'No TeamMotor account found for Google email "' + email + '". Please contact the shop administrator.');
    }
    if (u.status !== 'Active') {
      audit(null, 'auth.login_blocked', 'user', u.id, { username: u.username, email: email, reason: 'inactive', provider: 'google' }); save();
      throw E(403, 'This account is inactive. Please contact an administrator.');
    }
    audit(u, 'auth.login', 'user', u.id, { username: u.username, email: u.email, provider: 'google' }); save();
    return { token: 'local:' + u.id, user: pubUser(u) };
  });
  R('GET', '/auth/me', function (c) { return { user: pubUser(c.full) }; });
  R('POST', '/auth/logout', function (c) { audit(c.user, 'auth.logout', 'user', c.user.id, { username: c.user.username }); return { ok: true }; });

  R('GET', '/bootstrap', function (c) {
    refreshNotifications();
    const admin = c.user.role === 'Admin';
    return {
      me: pubUser(c.full), settings: db.settings, categories: db.categories, suppliers: db.suppliers, brands: sortByName(db.brands || []), motoBrands: sortByName(db.motoBrands || []), products: db.products,
      customers: db.customers.map(decorateCustomer), sales: db.sales.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }).slice(0, 5000),
      inventoryTransactions: db.inventoryTransactions.slice(0, 3000), warranties: db.warranties.map(warrantyOut), notifications: db.notifications,
      users: admin ? db.users.map(pubUser) : [pubUser(c.full)], expiry: expiryReport(),
      shifts: admin ? db.shifts : db.shifts.filter(function (s) { return s.username === c.user.username; }), serverTime: nowISO()
    };
  });

  /* products / categories / suppliers */
  R('GET', '/products', function () {
    return clone(db.products.slice().sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; }));
  });
  R('GET', '/products/lookup/([^/]+)', function (c) {
    const code = decodeURIComponent(c.m[1]).trim();
    const p = db.products.find(function (x) { return !x.archived && (x.barcode === code || x.sku === code || x.id === code.toUpperCase()); });
    if (!p) throw nf('No product matches "' + code + '".');
    return clone(p);
  });
  R('POST', '/products', function (c) {
    const d = cleanProduct(c.body);
    if (!d.name || !d.category) throw bad('Name and category are required.');
    if (d.sellingPrice === undefined) throw bad('Selling price is required.');
    const cat = db.categories.find(function (x) { return x.id === d.category; }); if (!cat) throw bad('Unknown category.');
    checkFilterValues(d, null);
    const stock = Math.max(0, parseInt(c.body.stock, 10) || 0);
    const existingMax = maxSuffix(db.products.filter(function (p) { return p.id && p.id.indexOf(cat.prefix + '-') === 0; }).map(function (p) { return p.id; }), /-(\d+)$/);
    db.counters['PRD-' + cat.prefix] = Math.max(db.counters['PRD-' + cat.prefix] || 0, existingMax) + 1;
    const id = cat.prefix + '-' + pad(db.counters['PRD-' + cat.prefix], 3);
    if (!d.sku) d.sku = 'TM-' + id;
    if (!d.barcode) d.barcode = '4801234567' + pad(db.products.length + 1, 2);
    const p = Object.assign({ brand: '', compatibility: [], compatYears: 'All Years', supplier: '', supplierRef: '', sku: d.sku, barcode: d.barcode, description: '', costPrice: 0, reorderLevel: 0, warrantyDuration: null, warrantyUnit: null, warrantyType: null, warrantyDays: null, rubber: false, expirationDate: null, image: cat.id }, d, { id: id, stock: 0, archived: false, lastUpdated: nowISO() });
    db.products.push(p);
    if (stock > 0) changeStock({ productId: id, delta: stock, type: 'Stock In', user: c.user.name, supplierId: p.supplier, reference: 'Initial stock', notes: 'Initial stock on product creation' });
    audit(c.user, 'product.create', 'product', id, { name: p.name, category: p.category, initialStock: stock, sellingPrice: p.sellingPrice, costPrice: p.costPrice }); refreshNotifications();
    return clone(p);
  });
  R('PUT', '/products/([^/]+)', function (c) {
    needAdmin(c); const p = findProduct(c.m[1]); if (!p) throw nf('Product not found.');
    const d = cleanProduct(c.body), changes = {};
    checkFilterValues(d, p);
    Object.keys(d).forEach(function (k) { if (k !== 'image' && JSON.stringify(p[k]) !== JSON.stringify(d[k])) changes[k] = { from: p[k], to: d[k] }; });
    Object.assign(p, d, { lastUpdated: nowISO() });
    audit(c.user, 'product.update', 'product', p.id, { name: p.name, changes: changes }); refreshNotifications();
    return clone(p);
  });
  R('POST', '/products/([^/]+)/archive', function (c) {
    needAdmin(c); const p = findProduct(c.m[1]); if (!p) throw nf('Product not found.');
    p.archived = c.body.archived !== false; p.lastUpdated = nowISO();
    audit(c.user, p.archived ? 'product.archive' : 'product.unarchive', 'product', p.id, { name: p.name }); refreshNotifications();
    return clone(p);
  });
  R('POST', '/categories', function (c) {
    needAdmin(c); const name = String(c.body.name || '').trim(); if (!name) throw bad('Category name is required.');
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    if (db.categories.some(function (x) { return x.id === id; })) throw conflict('That category already exists.');
    const taken = db.categories.map(function (x) { return x.prefix; });
    let prefix = (c.body.prefix || name.replace(/[^A-Za-z]/g, '').slice(0, 3)).toUpperCase().padEnd(3, 'X');
    for (let i = 0; taken.indexOf(prefix) !== -1 && i < 26; i++) prefix = prefix.slice(0, 2) + String.fromCharCode(65 + i);
    if (taken.indexOf(prefix) !== -1) throw conflict('Could not derive a unique prefix.');
    const cat = { id: id, name: name, prefix: prefix, status: 'Active' }; db.categories.push(cat);
    audit(c.user, 'category.create', 'category', id, { name: name, prefix: prefix }); return clone(cat);
  });
  R('PUT', '/categories/([^/]+)', function (c) {
    needAdmin(c);
    const cat = db.categories.find(function (x) { return x.id === c.m[1]; });
    if (!cat) throw nf('Category not found.');
    const catBefore = clone(cat);
    if (c.body.name !== undefined) {
      const name = String(c.body.name || '').trim();
      if (!name) throw bad('Category name is required.');
      cat.name = name;
    }
    if (c.body.status !== undefined) {
      if (['Active', 'Inactive'].indexOf(c.body.status) === -1) throw bad('Status must be Active or Inactive.');
      cat.status = c.body.status;
    }
    if (c.body.prefix !== undefined) {
      const prefix = String(c.body.prefix || '').trim().toUpperCase();
      if (prefix) cat.prefix = prefix;
    }
    audit(c.user, 'category.update', 'category', cat.id, { name: cat.name, changes: diff(catBefore, cat, ['name', 'status', 'prefix']) });
    return clone(cat);
  });
  R('DELETE', '/categories/([^/]+)', function (c) {
    needAdmin(c); const cat = db.categories.find(function (x) { return x.id === c.m[1]; }); if (!cat) throw nf('Category not found.');
    const used = db.products.filter(function (p) { return p.category === cat.id; }).length;
    if (used) throw conflict('"' + cat.name + '" still has ' + used + ' product(s) (archived ones count). Move them first.');
    db.categories = db.categories.filter(function (x) { return x.id !== cat.id; });
    audit(c.user, 'category.delete', 'category', cat.id, { name: cat.name }); return { ok: true };
  });
  R('POST', '/suppliers', function (c) {
    needAdmin(c); if (!c.body.name) throw bad('Supplier name is required.');
    const s = { id: nextId('SUP', 'SUP', 3), name: c.body.name, contactPerson: c.body.contactPerson || '', contactNumber: c.body.contactNumber || '', email: c.body.email || '', address: c.body.address || '', lastDelivery: c.body.lastDelivery || '', status: c.body.status || 'Active' };
    db.suppliers.push(s); audit(c.user, 'supplier.create', 'supplier', s.id, { name: s.name }); return clone(s);
  });
  R('PUT', '/suppliers/([^/]+)', function (c) {
    needAdmin(c); const s = db.suppliers.find(function (x) { return x.id === c.m[1]; }); if (!s) throw nf('Supplier not found.');
    const sBefore = clone(s), sKeys = [];
    ['name', 'contactPerson', 'contactNumber', 'email', 'address', 'status', 'lastDelivery'].forEach(function (k) { if (c.body[k] !== undefined) { s[k] = c.body[k]; sKeys.push(k); } });
    audit(c.user, 'supplier.update', 'supplier', s.id, { name: s.name, changes: diff(sBefore, s, sKeys) }); return clone(s);
  });
  R('DELETE', '/suppliers/([^/]+)', function (c) {
    needAdmin(c); const id = decodeURIComponent(c.m[1]);
    const s = db.suppliers.find(function (x) { return x.id === id; }); if (!s) throw nf('Supplier not found.');
    const used = db.products.filter(function (p) { return p.supplier === s.id; }).length;
    if (used) throw conflict('"' + s.name + '" is still linked to ' + used + ' product(s) (archived ones count). Change their supplier first.');
    db.suppliers = db.suppliers.filter(function (x) { return x.id !== s.id; });
    audit(c.user, 'supplier.delete', 'supplier', s.id, { name: s.name }); return { ok: true };
  });

  /* brands (Manage Filters → Manage Brands) — mirrors server/src/routes/catalog.js */
  R('GET', '/brands', function () { return sortByName(db.brands || []); });
  R('POST', '/brands', function (c) {
    needAdmin(c); const name = cleanName(c.body.name, 'Brand name', 30);
    if (db.brands.some(function (b) { return sameName(b.name, name); })) throw conflict('The brand "' + name + '" already exists.');
    const b = { id: nextId('BRD', 'BRD', 3), name: name }; db.brands.push(b);
    audit(c.user, 'brand.create', 'brand', b.id, { name: name }); return clone(b);
  });
  R('PUT', '/brands/([^/]+)', function (c) {
    needAdmin(c); const id = decodeURIComponent(c.m[1]);
    const b = db.brands.find(function (x) { return x.id === id; }); if (!b) throw nf('Brand not found.');
    const name = cleanName(c.body.name, 'Brand name', 30);
    if (db.brands.some(function (x) { return x.id !== b.id && sameName(x.name, name); })) throw conflict('The brand "' + name + '" already exists.');
    const oldName = b.name; let n = 0;
    b.name = name;
    if (oldName !== name) db.products.forEach(function (p) { if (p.brand === oldName) { p.brand = name; p.lastUpdated = nowISO(); n++; } });
    audit(c.user, 'brand.update', 'brand', b.id, { name: name, changes: { name: { from: oldName, to: name } }, productsUpdated: n }); return clone(b);
  });
  R('DELETE', '/brands/([^/]+)', function (c) {
    needAdmin(c); const id = decodeURIComponent(c.m[1]);
    const b = db.brands.find(function (x) { return x.id === id; }); if (!b) throw nf('Brand not found.');
    const used = db.products.filter(function (p) { return p.brand === b.name; }).length;
    if (used) throw conflict('"' + b.name + '" is still used by ' + used + ' product(s) (archived ones count). Change their brand first.');
    db.brands = db.brands.filter(function (x) { return x.id !== b.id; });
    audit(c.user, 'brand.delete', 'brand', b.id, { name: b.name }); return { ok: true };
  });

  /* motorcycle brands + models (Manage Filters → Manage Motorcycle Compatibility) */
  const findMoto = function (c) { const id = decodeURIComponent(c.m[1]); const mb = db.motoBrands.find(function (x) { return x.id === id; }); if (!mb) throw nf('Motorcycle brand not found.'); return mb; };
  R('GET', '/moto-brands', function () { return sortByName(db.motoBrands || []); });
  R('POST', '/moto-brands', function (c) {
    needAdmin(c); const name = cleanName(c.body.name, 'Motorcycle brand', 30);
    if (db.motoBrands.some(function (x) { return sameName(x.name, name); })) throw conflict('The motorcycle brand "' + name + '" already exists.');
    const models = [];
    (Array.isArray(c.body.models) ? c.body.models : []).forEach(function (m) { const model = cleanName(m, 'Model name', 30); if (!models.some(function (x) { return sameName(x, model); })) models.push(model); });
    if (!models.length) throw bad('At least one initial model is required when adding a motorcycle brand.');
    const mb = { id: nextId('MOTO', 'MOTO', 3), name: name, models: models }; db.motoBrands.push(mb);
    audit(c.user, 'moto.create', 'motorcycle_brand', mb.id, { name: name, models: models }); return clone(mb);
  });
  R('DELETE', '/moto-brands/([^/]+)', function (c) {
    needAdmin(c); const mb = findMoto(c);
    const used = compatUsers(mb.models.map(function (m) { return mb.name + ' ' + m; }));
    if (used) throw conflict('"' + mb.name + '" models are still used by ' + used + ' product(s) (archived ones count). Remove them from those products first.');
    db.motoBrands = db.motoBrands.filter(function (x) { return x.id !== mb.id; });
    audit(c.user, 'moto.delete', 'motorcycle_brand', mb.id, { name: mb.name, models: mb.models }); return { ok: true };
  });
  R('POST', '/moto-brands/([^/]+)/models', function (c) {
    needAdmin(c); const mb = findMoto(c); const model = cleanName(c.body.model, 'Model name', 30);
    if (mb.models.some(function (m) { return sameName(m, model); })) throw conflict(mb.name + ' ' + model + ' is already on the list.');
    mb.models.push(model);
    audit(c.user, 'moto.model_add', 'motorcycle_brand', mb.id, { name: mb.name, model: model }); return clone(mb);
  });
  R('DELETE', '/moto-brands/([^/]+)/models/([^/]+)', function (c) {
    needAdmin(c); const mb = findMoto(c); const model = decodeURIComponent(c.m[2]);
    if (mb.models.indexOf(model) === -1) throw nf('Model not found.');
    const used = compatUsers([mb.name + ' ' + model]);
    if (used) throw conflict(mb.name + ' ' + model + ' is still used by ' + used + ' product(s) (archived ones count). Remove it from those products first.');
    mb.models = mb.models.filter(function (m) { return m !== model; });
    audit(c.user, 'moto.model_remove', 'motorcycle_brand', mb.id, { name: mb.name, model: model }); return clone(mb);
  });

  /* inventory */
  R('POST', '/inventory/stock-in', function (c) {
    const qty = parseQty(c.body.quantity);
    if (c.body.supplierId && !db.suppliers.some(function (s) { return s.id === c.body.supplierId; })) throw bad('Unknown supplier.');
    const date = parseDate(c.body.date);
    const r = changeStock({ productId: c.body.productId, delta: qty, type: 'Stock In', user: c.user.name, supplierId: c.body.supplierId, reference: c.body.reference, notes: c.body.notes, date: date });
    if (c.body.supplierId) db.suppliers.find(function (s) { return s.id === c.body.supplierId; }).lastDelivery = (date || nowISO()).slice(0, 10);
    if (c.body.costPrice !== undefined && c.body.costPrice !== null && c.body.costPrice !== '') {
      const cp = Number(c.body.costPrice);
      if (!isNaN(cp) && cp >= 0) r.product.costPrice = cp;
    }
    if (c.body.expirationDate !== undefined && c.body.expirationDate !== '') {
      r.product.expirationDate = c.body.expirationDate || null;
    }
    if (c.body.storageLocation !== undefined && c.body.storageLocation !== '') {
      r.product.storageLocation = String(c.body.storageLocation).trim();
    }
    audit(c.user, 'stock.in', 'product', r.product.id, { productId: r.product.id, productName: r.product.name, qty: qty, from: r.txn.previousStock, to: r.txn.newStock, reference: c.body.reference || null, notes: c.body.notes || null, supplierId: c.body.supplierId || null }); refreshNotifications();
    return { product: clone(r.product), transaction: clone(r.txn) };
  });
  R('POST', '/inventory/stock-out', function (c) {
    const qty = parseQty(c.body.quantity);
    if (['Damaged', 'Returned', 'Expired', 'Lost', 'Internal Use', 'Other'].indexOf(c.body.reason) === -1) throw bad('Choose a valid reason for Stock Out.');
    const r = changeStock({ productId: c.body.productId, delta: -qty, type: 'Stock Out', user: c.user.name, reason: c.body.reason, notes: c.body.notes, date: parseDate(c.body.date) });
    audit(c.user, 'stock.out', 'product', r.product.id, { productId: r.product.id, productName: r.product.name, qty: qty, reason: c.body.reason, notes: c.body.notes || null, from: r.txn.previousStock, to: r.txn.newStock }); refreshNotifications();
    return { product: clone(r.product), transaction: clone(r.txn) };
  });
  R('POST', '/inventory/adjust', function (c) {
    needAdmin(c); const nq = Number(c.body.newQuantity);
    if (!Number.isInteger(nq) || nq < 0) throw bad('New quantity must be a whole number, 0 or more.');
    const reason = String(c.body.reason || '').trim(); if (reason.length < 3) throw bad('A reason is required for every stock adjustment.');
    const p = findProduct(c.body.productId); if (!p) throw nf('Product not found.');
    const delta = nq - p.stock; if (delta === 0) throw bad('The new quantity equals the current stock \u2014 nothing to adjust.');
    const r = changeStock({ productId: p.id, delta: delta, type: 'Adjustment', user: c.user.name, reference: 'Manual adjustment', reason: reason, notes: 'Adjusted ' + (p.stock - delta) + ' \u2192 ' + nq + '. ' + reason });
    audit(c.user, 'stock.adjust', 'product', p.id, { productId: p.id, productName: p.name, qty: Math.abs(delta), from: r.txn.previousStock, to: r.txn.newStock, delta: delta, reason: reason }); refreshNotifications();
    return { product: clone(r.product), transaction: clone(r.txn) };
  });
  R('GET', '/inventory/transactions', function (c) {
    const q = c.query || {};
    let rows = db.inventoryTransactions.slice();
    if (q.productId) rows = rows.filter(function (t) { return t.productId === q.productId; });
    if (q.type) rows = rows.filter(function (t) { return t.type === q.type; });
    rows.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : (a.id < b.id ? 1 : -1); });
    const limit = Math.min(parseInt(q.limit, 10) || 3000, 5000);
    return clone(rows.slice(0, limit));
  });

  /* sales */
  R('GET', '/sales', function (c) {
    const q = c.query || {};
    let rows = db.sales.slice();
    if (q.status) rows = rows.filter(function (s) { return s.status === q.status; });
    if (q.customerId) rows = rows.filter(function (s) { return s.customerId === q.customerId; });
    if (q.from) rows = rows.filter(function (s) { return s.date >= q.from; });
    if (q.to) rows = rows.filter(function (s) { return s.date <= q.to; });
    rows.sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    const limit = Math.min(parseInt(q.limit, 10) || 5000, 10000);
    return clone(rows.slice(0, limit));
  });
  R('GET', '/sales/([^/]+)', function (c) {
    const s = findSale(c.m[1]); if (!s) throw nf('Sale not found.');
    return clone(s);
  });
  R('POST', '/sales', function (c) { return createSale(c.body, c.user); });
  R('POST', '/sales/([^/]+)/void', function (c) { needAdmin(c); return voidSale(c.m[1], c.body.type || 'Voided', c.body.reason, c.user); });
  R('POST', '/sales/([^/]+)/reprint', function (c) {
    const s = findSale(c.m[1]); if (!s) throw nf('Sale not found.');
    s.reprintCount = (s.reprintCount || 0) + 1; s.lastReprintAt = nowISO();
    audit(c.user, 'sale.reprint', 'sale', s.id, { reprintNumber: s.reprintCount, status: s.status, context: c.body.context || 'sales-page', saleId: s.id, saleTotal: s.total, paymentMethod: s.paymentMethod });
    const out = clone(s); if (!out.shop) { const st = db.settings; out.shop = { shopName: st.shopName, tagline: st.tagline, addressLines: st.addressLines, phone: st.phone, tin: st.tin, receiptFooter: st.receiptFooter }; }
    return { sale: out, reprintedAt: s.lastReprintAt, reprintNumber: s.reprintCount, reprintedBy: c.user.name };
  });

  /* customers */
  R('GET', '/customers', function (c) {
    const q = c.query || {};
    let list = db.customers;
    if (q.status && ['Active', 'Inactive'].indexOf(q.status) !== -1) list = list.filter(function (cu) { return cu.status === q.status; });
    return list.map(decorateCustomer);
  });
  R('GET', '/customers/([^/]+)', function (c) {
    const cu = db.customers.find(function (x) { return x.id === c.m[1]; }); if (!cu) throw nf('Customer not found.');
    return { customer: decorateCustomer(cu), sales: clone(db.sales.filter(function (s) { return s.customerId === cu.id; })), warranties: db.warranties.filter(function (w) { return w.customerId === cu.id; }).map(warrantyOut) };
  });
  R('POST', '/customers', function (c) {
    const d = cleanCustomer(c.body); phoneFree(d.contactNumber);
    const cu = Object.assign(d, { id: nextId('CUST', 'CUST', 3), status: 'Active', dateRegistered: today() });
    db.customers.push(cu); audit(c.user, 'customer.create', 'customer', cu.id, { name: cu.name, source: c.body.source || 'customers-page' }); return decorateCustomer(cu);
  });
  R('PUT', '/customers/([^/]+)', function (c) {
    const cu = db.customers.find(function (x) { return x.id === c.m[1]; }); if (!cu) throw nf('Customer not found.');
    const d = cleanCustomer(c.body); if (normPhone(d.contactNumber) !== normPhone(cu.contactNumber)) phoneFree(d.contactNumber, cu.id);
    const cuBefore = {}; Object.keys(d).forEach(function (k) { cuBefore[k] = cu[k]; });
    Object.assign(cu, d); audit(c.user, 'customer.update', 'customer', cu.id, Object.assign({ name: cu.name }, splitDiff(diff(cuBefore, cu, Object.keys(d))))); return decorateCustomer(cu);
  });
  R('DELETE', '/customers/([^/]+)', function (c) {
    needAdmin(c); const cu = db.customers.find(function (x) { return x.id === c.m[1]; }); if (!cu) throw nf('Customer not found.');
    cu.status = 'Inactive'; audit(c.user, 'customer.deactivate', 'customer', cu.id, { name: cu.name }); return decorateCustomer(cu);
  });
  R('POST', '/customers/([^/]+)/reactivate', function (c) {
    needAdmin(c); const cu = db.customers.find(function (x) { return x.id === c.m[1]; }); if (!cu) throw nf('Customer not found.');
    phoneFree(cu.contactNumber, cu.id); cu.status = 'Active'; audit(c.user, 'customer.reactivate', 'customer', cu.id, { name: cu.name }); return decorateCustomer(cu);
  });

  /* warranties */
  R('GET', '/warranties', function () { return db.warranties.map(warrantyOut); });
  R('POST', '/warranties/([^/]+)/claims', function (c) {
    const w = db.warranties.find(function (x) { return x.id === c.m[1]; }); if (!w) throw nf('Warranty not found.');
    if (w.status === 'Voided') throw conflict('This warranty belongs to a voided sale.');
    const desc = String(c.body.description || '').trim(), res = String(c.body.resolution || '').trim();
    if (!desc || !res) throw bad('Defect description and action taken are both required.');
    const status = ['Pending', 'Approved', 'Resolved', 'Rejected'].indexOf(c.body.status) !== -1 ? c.body.status : 'Approved';
    const claim = { id: nextId('CLM', 'CLM', 3), warrantyId: w.id, date: c.body.date || today(), description: desc, resolution: res, status: status, staff: c.user.name };
    (w.claims = w.claims || []).push(claim); audit(c.user, 'warranty.claim', 'warranty', w.id, { claimId: claim.id, status: status, productName: w.productName || null, saleId: w.saleId || null, description: desc.slice(0, 200), resolution: res.slice(0, 200) }); refreshNotifications();
    return clone(claim);
  });

  /* notifications */
  R('GET', '/notifications', function () { refreshNotifications(); return clone(db.notifications); });
  R('POST', '/notifications/read-all', function () { db.notifications.forEach(function (n) { n.read = true; }); return { ok: true }; });
  R('POST', '/notifications/([^/]+)/read', function (c) { const n = db.notifications.find(function (x) { return x.id === c.m[1]; }); if (n) n.read = true; return { ok: true }; });

  /* audit / settings / reports */
  R('GET', '/audit', function (c) {
    needAdmin(c); const q = c.query; let rows = db.audit;
    if (q.action) rows = rows.filter(function (a) { return a.action.indexOf(q.action) === 0; });
    if (q.sensitive === '1' || q.sensitive === 'true') rows = rows.filter(function (a) { return SENSITIVE_ACTIONS.indexOf(a.action) !== -1; });
    if (q.user) rows = rows.filter(function (a) { return a.username === String(q.user).toLowerCase(); });
    if (q.from) rows = rows.filter(function (a) { return a.at >= new Date(q.from).toISOString(); });
    if (q.to) rows = rows.filter(function (a) { return a.at <= new Date(q.to + 'T23:59:59.999').toISOString(); });
    if (q.search) { const s = String(q.search).toLowerCase(); rows = rows.filter(function (a) { return [a.entityId, a.action, a.userName, a.username].join(' ').toLowerCase().indexOf(s) !== -1; }); }
    const limit = Math.min(parseInt(q.limit, 10) || 100, 500), page = Math.max(parseInt(q.page, 10) || 1, 1);
    return clone({ rows: rows.slice((page - 1) * limit, page * limit), total: rows.length, page: page, pages: Math.max(1, Math.ceil(rows.length / limit)) });
  });
  R('GET', '/settings', function () { return clone(db.settings); });
  R('PUT', '/settings', function (c) {
    needAdmin(c); const b = c.body;
    if (b.shopName !== undefined && !String(b.shopName).trim()) throw bad('Shop name cannot be empty.');
    if (b.vatRate !== undefined) { const r = Number(b.vatRate); if (!isFinite(r) || r < 0 || r > 1) throw bad('VAT rate must be between 0% and 100%.'); b.vatRate = r; }
    if (b.vatMode !== undefined && ['inclusive', 'exclusive'].indexOf(b.vatMode) === -1) throw bad('VAT mode must be inclusive or exclusive.');
    const changed = {};
    ['shopName', 'tagline', 'addressLines', 'phone', 'tin', 'vatEnabled', 'vatRate', 'vatMode', 'receiptFooter', 'expiryWarningMonths'].forEach(function (k) {
      if (b[k] !== undefined && JSON.stringify(b[k]) !== JSON.stringify(db.settings[k])) { changed[k] = { from: db.settings[k], to: b[k] }; db.settings[k] = b[k]; }
    });
    audit(c.user, 'settings.update', 'settings', 'shop', { changed: changed }); refreshNotifications(); return clone(db.settings);
  });
  R('GET', '/reports/expiry', function () { return expiryReport(); });

  /* users, profile, shifts */
  R('GET', '/users', function (c) { needAdmin(c); return db.users.map(pubUser); });
  R('POST', '/users', function (c) {
    needAdmin(c); const b = c.body; if (!b.name || !b.username) throw bad('Name and username are required.');
    if (['Admin', 'Staff'].indexOf(b.role) === -1) throw bad('Role must be Admin or Staff.'); checkPw(b.password);
    const un = String(b.username).trim().toLowerCase(); if (db.users.some(function (u) { return u.username.toLowerCase() === un; })) throw conflict('Duplicate value: username already exists.');
    const em = String(b.email || '').trim().toLowerCase(); if (em && db.users.some(function (u) { return (u.email || '').toLowerCase() === em; })) throw conflict('Duplicate value: email already exists.');
    const u = { id: nextId('USR', 'USR', 3), name: String(b.name).trim(), username: un, email: em, role: b.role, status: 'Active', contactNumber: b.contactNumber || '', birthDate: b.birthDate || '', dateAdded: today(), photo: '', passwordHash: hashPw(b.password) };
    db.users.push(u); audit(c.user, 'user.create', 'user', u.id, { username: u.username, name: u.name, role: u.role }); return pubUser(u);
  });
  R('PUT', '/users/me/profile', function (c) {
    const u = c.full, b = c.body, PF = ['name', 'email', 'contactNumber', 'birthDate'], pBefore = {}; PF.forEach(function (k) { pBefore[k] = u[k]; });
    const photoBefore = u.photo || '';
    if (b.email && db.users.some(function (x) { return x.id !== u.id && (x.email || '').toLowerCase() === String(b.email).trim().toLowerCase(); })) throw conflict('Duplicate value: email already exists.');
    ['name', 'email', 'contactNumber', 'birthDate'].forEach(function (k) { if (b[k] !== undefined) u[k] = k === 'email' ? String(b[k]).trim().toLowerCase() : String(b[k]).trim(); });
    if (b.photo !== undefined) { if (b.photo && !/^data:image\/[a-z+.-]+;base64,[A-Za-z0-9+/=]+$/.test(b.photo)) throw bad('Photo must be an image data URL.'); u.photo = b.photo || ''; }
    const pd = Object.assign({ targetUsername: u.username }, splitDiff(diff(pBefore, u, PF))); if ((u.photo || '') !== photoBefore) pd.photoChanged = true;
    audit(c.user, 'user.profile_update', 'user', u.id, pd); save(); return pubUser(u);
  });
  R('PUT', '/users/me/password', function (c) {
    const u = c.full; if (u.passwordHash !== hashPw(String(c.body.currentPassword || ''))) throw bad('Current password is incorrect.');
    checkPw(c.body.newPassword); u.passwordHash = hashPw(c.body.newPassword); audit(c.user, 'user.password_change', 'user', u.id, { targetUserId: u.id, targetUsername: u.username, changedBy: 'self' });
    save(); return { ok: true, token: 'local:' + u.id };
  });
  R('PUT', '/users/([^/]+)', function (c) {
    needAdmin(c); const u = db.users.find(function (x) { return x.id === c.m[1]; }); if (!u) throw nf('User not found.');
    const b = c.body, UF = ['name', 'username', 'email', 'contactNumber', 'birthDate', 'role', 'status'], beforeDoc = {}; UF.forEach(function (k) { beforeDoc[k] = u[k]; });
    if (u.id === c.user.id && ((b.role && b.role !== u.role) || (b.status && b.status !== 'Active'))) throw E(403, 'You cannot change your own role or deactivate yourself.');
    if (b.email && db.users.some(function (x) { return x.id !== u.id && (x.email || '').toLowerCase() === String(b.email).trim().toLowerCase(); })) throw conflict('Duplicate value: email already exists.');
    ['name', 'email', 'contactNumber', 'birthDate'].forEach(function (k) { if (b[k] !== undefined) u[k] = k === 'email' ? String(b[k]).trim().toLowerCase() : String(b[k]).trim(); });
    if (b.username) { const un = String(b.username).trim().toLowerCase(); if (db.users.some(function (x) { return x.id !== u.id && x.username.toLowerCase() === un; })) throw conflict('Duplicate value: username already exists.'); u.username = un; }
    if (b.role) { if (['Admin', 'Staff'].indexOf(b.role) === -1) throw bad('Invalid role.'); u.role = b.role; }
    if (b.status) { if (['Active', 'Inactive'].indexOf(b.status) === -1) throw bad('Invalid status.'); u.status = b.status; }
    if (b.password) { checkPw(b.password); u.passwordHash = hashPw(b.password); }
    audit(c.user, 'user.update', 'user', u.id, Object.assign({ targetUsername: u.username, targetName: u.name }, splitDiff(diff(beforeDoc, u, UF)), { passwordReset: !!b.password }));
    if (b.password) audit(c.user, 'user.password_change', 'user', u.id, { targetUserId: u.id, targetUsername: u.username, changedBy: 'admin' });
    save(); return pubUser(u);
  });
  R('DELETE', '/users/([^/]+)', function (c) {
    needAdmin(c);
    const u = db.users.find(function (x) { return x.id === c.m[1]; });
    if (!u) throw nf('User not found.');
    if (u.id === c.user.id) throw E(403, 'You cannot delete your own account.');
    db.users = db.users.filter(function (x) { return x.id !== u.id; });
    audit(c.user, 'user.delete', 'user', u.id, { username: u.username, name: u.name, role: u.role });
    save(); return { ok: true };
  });
  R('GET', '/users/shifts/all', function (c) {
    needAdmin(c);
    return clone((db.shifts || []).slice().sort(function (a, b) { return new Date(b.clockIn) - new Date(a.clockIn); }).slice(0, 1000));
  });
  R('GET', '/users/shifts/mine', function (c) {
    return clone((db.shifts || []).filter(function (s) { return s.username === c.user.username; }).sort(function (a, b) { return new Date(b.clockIn) - new Date(a.clockIn); }).slice(0, 200));
  });
  R('POST', '/users/shifts/clock-in', function (c) {
    const open = db.shifts.find(function (s) { return s.username === c.user.username && !s.clockOut; }); if (open) return clone(open);
    const sh = { id: nextId('SHF', 'SHF', 4), username: c.user.username, name: c.user.name, clockIn: nowISO(), clockOut: null };
    db.shifts.unshift(sh); audit(c.user, 'shift.clock_in', 'shift', sh.id, { staffName: c.user.name }); return clone(sh);
  });
  R('POST', '/users/shifts/clock-out', function (c) {
    const sh = db.shifts.find(function (s) { return s.username === c.user.username && !s.clockOut; }); if (!sh) throw bad('You are not clocked in.');
    sh.clockOut = nowISO(); audit(c.user, 'shift.clock_out', 'shift', sh.id, { staffName: c.user.name }); return clone(sh);
  });

  /* ---------------- entry point used by store.js ---------------- */
  /* Several tabs can be open at once (POS in one, Dashboard in another). If another tab saved a newer copy, adopt it
     before answering, so this tab never shows stale numbers and never overwrites the other tab's sale on its next save. */
  function syncFromStorage() {
    if (memOnly || !db) return;
    let stored = null;
    try { stored = localStorage.getItem(KEY); } catch (e) { return; }
    if (stored && stored !== lastStored) {
      try { db = JSON.parse(stored); lastStored = stored; } catch (e) { /* keep what we have */ }
    }
  }
  function handle(method, fullPath, body, token) {
    load();
    syncFromStorage();
    const qi = fullPath.indexOf('?'), path = qi === -1 ? fullPath : fullPath.slice(0, qi), query = {};
    if (qi !== -1) new URLSearchParams(fullPath.slice(qi + 1)).forEach(function (v, k) { query[k] = v; });
    let user = null, full = null;
    const isPublicAuth = path === '/auth/login' || path === '/auth/google' || path === '/auth/google/config';
    if (!isPublicAuth) {
      const uid = String(token || '').indexOf('local:') === 0 ? String(token).slice(6) : null;
      full = db.users.find(function (u) { return u.id === uid; });
      if (!full || full.status !== 'Active') throw E(401, 'Authentication required.');
      user = { id: full.id, username: full.username, name: full.name, role: full.role };
    }
    for (let i = 0; i < routes.length; i++) {
      const rt = routes[i];
      if (rt.method !== method) continue;
      const m = path.match(rt.re); if (!m) continue;
      const snapshot = method === 'GET' ? null : JSON.stringify(db);   // writes are all-or-nothing, like a database transaction
      try {
        const out = rt.fn({ user: user, full: full, m: m, query: query, body: clone(body) || {} });
        save(); return clone(out);
      } catch (e) { if (snapshot) db = JSON.parse(snapshot); throw e; }
    }
    throw nf('Not found: ' + method + ' ' + path);
  }

  return { handle: handle, reset: reset };
})();
