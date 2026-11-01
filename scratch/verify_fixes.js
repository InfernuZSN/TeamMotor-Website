// Focused regression checks for the audit fixes (offline LocalApi). Run with:
// mongosh --nodb --quiet --eval "require(require('path').resolve('scratch/verify_fixes.js'))"
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const mkStore = () => ({ _d: {}, getItem(k) { return k in this._d ? this._d[k] : null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; }, clear() { this._d = {}; } });
global.window = { location: { protocol: 'file:', pathname: '/public/sales.html', search: '' }, localStorage: mkStore(), sessionStorage: mkStore(), TEAMMOTOR_MODE: 'local' };
global.localStorage = window.localStorage; global.sessionStorage = window.sessionStorage; global.location = window.location;
global.document = { createElement() { return { innerHTML: '', textContent: '', appendChild() {}, style: {} }; } };
const load = f => vm.runInThisContext(fs.readFileSync(path.resolve(f), 'utf8'), { filename: f });
load('public/js/mock-data.js'); load('public/js/local-api.js');

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('[PASS] ' + name); } catch (e) { fail++; console.log('[FAIL] ' + name + ': ' + e.message); } };
const H = (...a) => LocalApi.handle(...a);
const admin = H('POST', '/auth/login', { username: 'ronnie.manalo', password: 'Admin@12345' }).token;

// Fix 1
t('Fix 1: seeded customers have valid emails and can be edited', () => {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  ['CUST-001', 'CUST-002', 'CUST-003', 'CUST-004', 'CUST-005', 'CUST-006'].forEach(id => {
    const c = H('GET', '/customers/' + id, {}, admin).customer;
    assert.ok(re.test(c.email), id + ' email invalid: ' + c.email);
    const up = H('PUT', '/customers/' + id, { name: c.name, contactNumber: c.contactNumber, email: c.email, address: c.address + ' ' }, admin);
    assert.ok(up && up.id === id);
  });
});
t('Fix 1: old saved databases with the placeholder are migrated on load', () => {
  const KEY = 'teammotor:local:db:v1';
  const saved = JSON.parse(localStorage.getItem(KEY));
  saved.customers[0].email = '[email protected]';
  saved.customers.push({ id: 'CUST-999', name: 'Walk In', contactNumber: '0917-000-0000', email: '[email protected]', status: 'Active' });
  localStorage.setItem(KEY, JSON.stringify(saved));
  LocalApi.reset(); localStorage.setItem(KEY, JSON.stringify(saved));
  const tok = H('POST', '/auth/login', { username: 'ronnie.manalo', password: 'Admin@12345' }).token;
  const list = H('GET', '/customers', {}, tok);
  assert.strictEqual(list.find(c => c.id === saved.customers[0].id).email, CUSTOMERS.find(c => c.id === saved.customers[0].id).email);
  assert.strictEqual(list.find(c => c.id === 'CUST-999').email, '');
});

// Fix 2
t('Fix 2: voiding a sale with a retired motorcycle succeeds and logs the skipped restock', () => {
  const tok = H('POST', '/auth/login', { username: 'ronnie.manalo', password: 'Admin@12345' }).token;
  const boot = H('GET', '/bootstrap', {}, tok);
  const mot = boot.sales.find(s => s.status === 'Completed' && s.items.some(i => i.productId.indexOf('MOT-') === 0));
  assert.ok(mot, 'a seeded motorcycle sale exists');
  const r = H('POST', '/sales/' + mot.id + '/void', { type: 'Voided', reason: 'Audit fix verification' }, tok);
  assert.strictEqual(r.sale.status, 'Voided');
  assert.ok(r.restockSkipped.length >= 1 && /retired product: MOT-/.test(r.restockSkipped[0].reason));
  const entries = H('GET', '/audit?action=sale.', {}, tok).rows;
  const e = entries.find(a => a.action === 'sale.voided' && a.entityId === mot.id);
  assert.ok(e && e.details.restockSkipped.length >= 1, 'audit entry carries restockSkipped');
});
t('Fix 2: normal sale void still restocks real products', () => {
  const tok = H('POST', '/auth/login', { username: 'ronnie.manalo', password: 'Admin@12345' }).token;
  const boot = H('GET', '/bootstrap', {}, tok);
  const s = boot.sales.find(x => x.status === 'Completed' && x.items.every(i => boot.products.some(p => p.id === i.productId)));
  const before = boot.products.find(p => p.id === s.items[0].productId).stock;
  const r = H('POST', '/sales/' + s.id + '/void', { type: 'Refunded', reason: 'Regression check' }, tok);
  assert.strictEqual(r.restockSkipped.length, 0);
  const after = H('GET', '/bootstrap', {}, tok).products.find(p => p.id === s.items[0].productId).stock;
  assert.ok(after > before);
});

// Fix 4/5/6/7/8 static checks
const read = f => fs.readFileSync(path.resolve(f), 'utf8');
t('Fix 4: profile has Save (submit) + Clear buttons, no "not available" notice', () => {
  const html = read('public/profile.html'), js = read('public/js/profile.js');
  assert.ok(/type="submit"[^>]*id="savePasswordBtn"/.test(html));
  assert.ok(/id="clearPasswordBtn"/.test(html) && !/resetPasswordBtn/.test(html + js));
  assert.ok(!/aren&rsquo;t available yet/.test(html));
  assert.ok(/addEventListener\('submit', changePassword\)/.test(js));
});
t('Fix 5: sales.js no longer parses range chips; sales-trend.js has no capture/stopPropagation', () => {
  assert.ok(!/parseInt\(chip\.dataset\.range/.test(read('public/js/sales.js')));
  const tr = read('public/js/sales-trend.js');
  assert.ok(!/stopPropagation/.test(tr) && !/\}, true\);/.test(tr));
});
t('Fix 6: notification items carry is-read / is-unread and CSS styles both', () => {
  assert.ok(/is-read' : ' is-unread'/.test(read('public/js/notifications.js')));
  const css = read('public/css/style.css');
  assert.ok(/\.notif-item\.is-read/.test(css) && /\.notif-item\.is-unread/.test(css));
});
t('Fix 7: orphan signup.html removed', () => assert.ok(!fs.existsSync(path.resolve('public/signup.html'))));
t('Fix 8: no 80 mm references in settings/README', () => {
  assert.ok(!/80\s?mm/.test(read('public/settings.html')) && !/80\s?mm/.test(read('README.md')));
});
console.log('\n' + pass + ' passed, ' + fail + ' failed');
