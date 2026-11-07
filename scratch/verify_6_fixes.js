const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); console.log('✓ ' + name); passed++; }
  catch (e) { console.log('✗ ' + name + ' -> ' + e.message); failed++; }
}

// 1. formatPHP centavo precision (behavioural)
check('Fix 1: Utils.formatPHP keeps centavos and matches Receipt.peso', () => {
  const ctx = { window: {}, document: { addEventListener() {} }, console, Date, Math, Number, String, Array, Object, JSON, RegExp, Set, Map };
  vm.runInNewContext(read('public/js/mock-data.js') + '; this.Utils = Utils;', ctx);
  const f = ctx.Utils.formatPHP;
  assert.strictEqual(f(450), '₱450');
  assert.strictEqual(f(427.5), '₱427.50');
  assert.strictEqual(f(381.7), '₱381.70');
  assert.strictEqual(f(12345.678), '₱12,345.68');
  assert.strictEqual(f(427.4999999999), '₱427.50');      // float noise rounds cleanly
  assert.strictEqual(f(428.0000000001), '₱428');
  assert.strictEqual(f(null), '₱0');
  assert.strictEqual(f('abc'), '₱0');
  const peso = n => '\u20B1' + (Number(n) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  assert.strictEqual(f(427.5), peso(427.5));               // same text as the printed receipt
});

// 2. step="0.01" on cost and price
check('Fix 2: #pCost and #pPrice accept centavos (step="0.01")', () => {
  const html = read('public/inventory.html');
  assert.match(html, /id="pCost"[^>]*step="0\.01"/);
  assert.match(html, /id="pPrice"[^>]*step="0\.01"/);
  assert.match(read('public/js/inventory.js'), /costPrice: parseFloat\(/);   // value is not truncated on save
});

// 3. supplier view edit button hidden for staff
check('Fix 3: #supplierViewToEdit hidden for Staff in openSupplierView()', () => {
  const js = read('public/js/inventory.js');
  const fn = js.slice(js.indexOf('function openSupplierView'), js.indexOf("openModal('supplierViewOverlay')") + 40);
  assert.match(fn, /supplierViewToEdit\.style\.display = isAdmin \? '' : 'none'/);
});

// 4. dead count group removed
check('Fix 4: audit GROUPS no longer contains "count"', () => {
  const line = read('public/js/audit.js').split('\n').find(l => l.includes('const GROUPS'));
  assert.ok(line && !/'count'/.test(line), line);
  assert.match(line, /'stock'/);
});

// 5. movement tables reactive
check('Fix 5: Sales movement tables recompute from live Store on store:refreshed', () => {
  const js = read('public/js/sales.js');
  assert.match(js, /function updateMovementTables\(\)/);
  assert.match(js, /window\.addEventListener\('store:refreshed', updateMovementTables\)/);
  const fn = js.slice(js.indexOf('function updateMovementTables'));
  assert.match(fn, /Store\.get\('sales'/);
  assert.match(fn, /Store\.get\('products'/);
  assert.match(read('public/js/store.js'), /dispatchEvent\(new CustomEvent\('store:refreshed'\)\)/);
});

// 5b. behavioural: void a sale in a fake store -> movement table changes after refresh event
check('Fix 5 (behaviour): voiding a sale + store:refreshed updates fast-moving table', () => {
  const els = {}, listeners = {};
  const el = id => els[id] || (els[id] = { id, innerHTML: '', textContent: '', value: '', className: '', style: {}, dataset: {}, classList: { add() {}, remove() {}, contains() { return false; } }, addEventListener() {}, querySelectorAll() { return []; } });
  let storeData = {
    products: [{ id: 'A', name: 'Alpha', category: 'c', stock: 10, reorderLevel: 2, sellingPrice: 100 }, { id: 'B', name: 'Beta', category: 'c', stock: 10, reorderLevel: 2, sellingPrice: 50 }],
    categories: [{ id: 'c', name: 'Cat' }],
    sales: [
      { id: 'S1', date: new Date().toISOString(), status: 'Completed', total: 500, staff: 'x', paymentMethod: 'Cash', items: [{ productId: 'A', name: 'Alpha', qty: 5, price: 100, subtotal: 500 }] },
      { id: 'S2', date: new Date().toISOString(), status: 'Completed', total: 50, staff: 'x', paymentMethod: 'Cash', items: [{ productId: 'B', name: 'Beta', qty: 1, price: 50, subtotal: 50 }] }
    ]
  };
  const ctx = {
    console, Date, Math, Number, String, Array, Object, JSON, RegExp, Set, Map,
    document: { getElementById: el, querySelectorAll: () => [], addEventListener() {}, createElement: () => ({}) },
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    PAYMENT_METHODS: ['Cash', 'GCash'], LEGACY_PAYMENT_METHODS: []
  };
  ctx.window = { addEventListener: (n, fn) => { (listeners[n] = listeners[n] || []).push(fn); }, location: { search: '' } };
  vm.runInNewContext(read('public/js/mock-data.js') + ';\n' + read('public/js/analytics.js') + ';\nthis.Utils = Utils; this.Analytics = Analytics;', ctx);
  ctx.Store = { get: (k, fb) => (storeData[k] === undefined ? fb : storeData[k]) };
  ctx.Boot = { ready: fn => fn(), dom: fn => fn() };
  ctx.initShell = () => true; ctx.getSession = () => ({ role: 'Admin' }); ctx.icon = () => '';
  ctx.createPager = () => ({ slice: l => l, reset() {} }); ctx.Receipt = { peso: n => String(n) };
  ctx.showToast = () => {};
  vm.runInNewContext(read('public/js/sales.js'), ctx);
  const before = els.fastMovingTbody.innerHTML;
  assert.ok(before.indexOf('Alpha') < before.indexOf('Beta') || before.indexOf('Beta') === -1, 'Alpha should lead before void');
  assert.ok(listeners['store:refreshed'] && listeners['store:refreshed'].length, 'listener registered');
  storeData = Object.assign({}, storeData, { sales: storeData.sales.map(s => s.id === 'S1' ? Object.assign({}, s, { status: 'Voided' }) : s) });
  listeners['store:refreshed'].forEach(fn => fn());
  const after = els.fastMovingTbody.innerHTML;
  assert.notStrictEqual(after, before, 'table re-rendered with new data');
  assert.ok(!/>5<\/td>/.test(after), 'voided units (5) no longer counted');
});

// 6. Escape closes modals globally
check('Fix 6: initShell binds a global Escape handler for .modal-overlay.open', () => {
  const js = read('public/js/app.js');
  assert.match(js, /function bindEscapeToCloseModals\(\)/);
  const shell = js.slice(js.indexOf('function initShell'));
  assert.match(shell.slice(0, 400), /bindEscapeToCloseModals\(\);/);
  assert.match(js, /querySelectorAll\('\.modal-overlay\.open'\)/);
  assert.ok(!/modal-overlay/.test(read('public/pos.html')), 'POS keeps its own .pt-overlay stack');
});

// 6b. behavioural: Escape closes only the top-most overlay and routes through backdrop handler
check('Fix 6 (behaviour): Escape closes top overlay via page backdrop logic', () => {
  let keyHandler = null;
  const mk = id => {
    const o = { id, isConnected: true, handlers: [], cls: new Set(['modal-overlay', 'open']) };
    o.classList = { contains: c => o.cls.has(c), remove: c => o.cls.delete(c), add: c => o.cls.add(c) };
    o.addEventListener = (n, fn) => o.handlers.push(fn);
    o.dispatchEvent = ev => { const e = { target: o }; o.handlers.forEach(fn => fn(e)); return true; };
    return o;
  };
  const a = mk('supplierViewOverlay'), b = mk('supplierModalOverlay');
  let backdropCalls = 0;
  b.addEventListener('click', e => { if (e.target === b) { backdropCalls++; b.classList.remove('open'); } });
  const ctx = {
    console, Math, JSON, String, Number, Object, Array, RegExp, Date,
    MouseEvent: function (t, o) { this.type = t; Object.assign(this, o); },
    localStorage: { getItem() { return null; }, setItem() {} },
    window: { addEventListener() {} },
    document: {
      addEventListener: (n, fn) => { if (n === 'keydown') keyHandler = fn; },
      querySelectorAll: sel => sel === '.modal-overlay.open' ? [a, b].filter(o => o.cls.has('open')) : []
    }
  };
  vm.runInNewContext(read('public/js/app.js') + '; this.bind = bindEscapeToCloseModals;', ctx);
  ctx.bind(); ctx.bind();                                     // idempotent
  assert.ok(keyHandler, 'keydown bound');
  let prevented = false;
  keyHandler({ key: 'Escape', defaultPrevented: false, preventDefault() { prevented = true; } });
  assert.strictEqual(backdropCalls, 1, 'page backdrop handler used');
  assert.ok(!b.cls.has('open'), 'top overlay closed');
  assert.ok(a.cls.has('open'), 'underlying overlay still open');
  assert.ok(prevented);
  keyHandler({ key: 'Escape', defaultPrevented: false, preventDefault() {} });   // no backdrop handler -> fallback
  assert.ok(!a.cls.has('open'), 'fallback removes .open');
  keyHandler({ key: 'Enter', defaultPrevented: false, preventDefault() {} });     // ignored, no throw
});

// Constraint: MongoDB connectivity untouched (no edits to db.js / .env in this pass)
check('Constraint: server/src/db.js still exports connect() unchanged in shape', () => {
  assert.match(read('server/src/db.js'), /connect/);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
