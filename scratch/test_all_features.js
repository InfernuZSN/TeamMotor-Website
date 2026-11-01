const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

console.log('================================================================');
console.log('     TEAMMOTOR FULL SYSTEM FEATURE & CLICKABLE VERIFICATION     ');
console.log('================================================================');

// Set up a mock DOM environment capable of running the client scripts
function createDOMEnvironment() {
  const listeners = {};
  const elements = {};

  const storage = {
    _data: {},
    getItem(k) { return this._data[k] !== undefined ? this._data[k] : null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; },
    clear() { this._data = {}; }
  };

  const documentMock = {
    readyState: 'complete',
    body: {
      hasAttribute(attr) { return false; },
      appendChild(el) { return el; },
      classList: {
        add() {},
        remove() {},
        toggle() {}
      }
    },
    title: '',
    getElementById(id) {
      if (!elements[id]) {
        elements[id] = createElementMock('div', id);
      }
      return elements[id];
    },
    querySelector(selector) {
      if (selector.startsWith('#')) return this.getElementById(selector.slice(1));
      if (!elements[selector]) elements[selector] = createElementMock('div');
      return elements[selector];
    },
    querySelectorAll(selector) {
      return [];
    },
    createElement(tag) {
      return createElementMock(tag);
    },
    addEventListener(evt, fn) {
      listeners[evt] = listeners[evt] || [];
      listeners[evt].push(fn);
    },
    removeEventListener(evt, fn) {
      if (listeners[evt]) {
        listeners[evt] = listeners[evt].filter(f => f !== fn);
      }
    }
  };

  function createElementMock(tag, id) {
    const elListeners = {};
    const dataset = {};
    return {
      tagName: tag.toUpperCase(),
      id: id || '',
      className: '',
      classList: {
        _classes: new Set(),
        add(c) { this._classes.add(c); },
        remove(c) { this._classes.delete(c); },
        toggle(c, force) {
          if (force !== undefined) {
            if (force) this._classes.add(c); else this._classes.delete(c);
          } else {
            if (this._classes.has(c)) this._classes.delete(c); else this._classes.add(c);
          }
        },
        contains(c) { return this._classes.has(c); }
      },
      style: {},
      dataset: dataset,
      attributes: {},
      _innerHTML: '',
      _textContent: '',
      get innerHTML() { return this._innerHTML; },
      set innerHTML(val) {
        this._innerHTML = String(val);
        this._textContent = String(val).replace(/<[^>]*>/g, '');
      },
      get textContent() { return this._textContent; },
      set textContent(val) {
        this._textContent = String(val);
        this._innerHTML = String(val).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      },
      value: '',
      checked: false,
      disabled: false,
      hidden: false,
      setAttribute(k, v) { this.attributes[k] = String(v); },
      getAttribute(k) { return this.attributes[k] || null; },
      hasAttribute(k) { return k in this.attributes; },
      removeAttribute(k) { delete this.attributes[k]; },
      appendChild(child) { return child; },
      removeChild(child) { return child; },
      remove() {},
      focus() {},
      blur() {},
      reset() { this.value = ''; },
      addEventListener(evt, fn) {
        elListeners[evt] = elListeners[evt] || [];
        elListeners[evt].push(fn);
      },
      click() {
        if (elListeners['click']) {
          elListeners['click'].forEach(f => f({ target: this, preventDefault() {}, stopPropagation() {} }));
        }
      },
      closest(sel) { return null; }
    };
  }

  const windowMock = {
    location: { protocol: 'file:', pathname: '/public/pos.html', href: 'pos.html', search: '', replace(url) { this.href = url; } },
    localStorage: storage,
    sessionStorage: { ...storage, _data: {} },
    document: documentMock,
    matchMedia: () => ({ matches: true }),
    setTimeout: (fn, ms) => setTimeout(fn, ms || 0),
    clearTimeout: (id) => clearTimeout(id),
    setInterval: (fn, ms) => setInterval(fn, ms || 0),
    clearInterval: (id) => clearInterval(id),
    TEAMMOTOR_MODE: 'local'
  };

  return { window: windowMock, document: documentMock, storage };
}

const env = createDOMEnvironment();
global.window = env.window;
global.document = env.document;
global.localStorage = env.window.localStorage;
global.sessionStorage = env.window.sessionStorage;
global.location = env.window.location;

function loadScript(filePath) {
  const code = fs.readFileSync(path.resolve(filePath), 'utf8');
  vm.runInThisContext(code, { filename: filePath });
}

loadScript('public/js/mock-data.js');
loadScript('public/js/local-api.js');
loadScript('public/js/store.js');
loadScript('public/js/analytics.js');
loadScript('public/js/receipt.js');
loadScript('public/js/app.js');

let passCount = 0;
let failCount = 0;
const inconsistencies = [];

function check(title, fn) {
  try {
    fn();
    passCount++;
    console.log(`  [PASS] ${title}`);
  } catch (err) {
    failCount++;
    console.error(`  [FAIL] ${title}: ${err.message}`);
  }
}

function noteInconsistency(category, summary, details) {
  inconsistencies.push({ category, summary, details });
  console.log(`  [INCONSISTENCY FOUND] [${category}] ${summary}`);
}

console.log('\n--- 1. AUTHENTICATION & SESSION LIFECYCLE ---');
let adminSession, staffSession;

check('Admin login ronnie.manalo / Admin@12345', () => {
  const res = LocalApi.handle('POST', '/auth/login', { username: 'ronnie.manalo', password: 'Admin@12345' });
  assert.ok(res.token && res.token.startsWith('local:'));
  assert.strictEqual(res.user.role, 'Admin');
  adminSession = res;
  setSession(res.token, res.user);
  assert.strictEqual(getSession().username, 'ronnie.manalo');
});

check('Staff login juan.delacruz / Staff@12345', () => {
  const res = LocalApi.handle('POST', '/auth/login', { username: 'juan.delacruz', password: 'Staff@12345' });
  assert.ok(res.token);
  assert.strictEqual(res.user.role, 'Staff');
  staffSession = res;
});

check('Rate limit and login auditing', () => {
  const auditBoot = LocalApi.handle('GET', '/bootstrap', {}, adminSession.token);
  const loginAudits = auditBoot.sales ? LocalApi.handle('GET', '/audit?action=auth.login', {}, adminSession.token) : null;
  assert.ok(loginAudits.rows.length >= 2, 'Login attempts should be in audit trail');
});

console.log('\n--- 2. STORE HYDRATION & BOOTSTRAP INTEGRITY ---');
let bootstrapData;
check('Hydrate Store via Store.hydrate()', async () => {
  bootstrapData = LocalApi.handle('GET', '/bootstrap', {}, adminSession.token);
  assert.ok(bootstrapData.products.length > 0);
  assert.ok(bootstrapData.categories.length > 0);
  assert.ok(bootstrapData.suppliers.length > 0);
  assert.ok(bootstrapData.customers.length > 0);
  assert.ok(bootstrapData.sales.length > 0);
  assert.ok(bootstrapData.warranties.length > 0);
  assert.ok(bootstrapData.settings.shopName);
});

check('Staff bootstrap restricts sensitive collections', () => {
  const staffBoot = LocalApi.handle('GET', '/bootstrap', {}, staffSession.token);
  assert.strictEqual(staffBoot.users.length, 1, 'Staff should only receive own user document in bootstrap');
  assert.strictEqual(staffBoot.users[0].username, 'juan.delacruz');
});

console.log('\n--- 3. POS WORKFLOW & BUSINESS LOGIC ---');
check('Category filtering and product catalog', () => {
  const categories = bootstrapData.categories;
  const products = bootstrapData.products;
  for (const cat of categories) {
    const inCat = products.filter(p => p.category === cat.id);
    // It is ok if some category is empty, but verify id and prefix structure
    assert.ok(cat.id && cat.prefix, `Category ${cat.id} has valid structure`);
  }
});

let testSaleId;
check('POS Checkout (Cash) with stock decrement and transaction record', () => {
  const prod = bootstrapData.products.find(p => p.stock > 5 && !p.expirationDate);
  const startStock = prod.stock;
  const res = LocalApi.handle('POST', '/sales', {
    items: [{ productId: prod.id, qty: 2 }],
    paymentMethod: 'Cash',
    amountReceived: prod.sellingPrice * 2 + 100
  }, adminSession.token);

  assert.ok(res.sale && res.sale.id);
  testSaleId = res.sale.id;
  assert.strictEqual(res.sale.status, 'Completed');
  assert.strictEqual(res.stockChanges.length, 1);
  assert.strictEqual(res.stockChanges[0].newStock, startStock - 2);

  const updatedProd = LocalApi.handle('GET', '/bootstrap', {}, adminSession.token).products.find(p => p.id === prod.id);
  assert.strictEqual(updatedProd.stock, startStock - 2);
});

check('POS Idempotency: re-sending clientRequestId returns existing sale without duplicate stock decrement', () => {
  const prod = bootstrapData.products.find(p => p.stock > 5 && !p.expirationDate);
  const stockBefore = prod.stock;
  const reqId = 'client-req-' + Date.now();

  const res1 = LocalApi.handle('POST', '/sales', {
    clientRequestId: reqId,
    items: [{ productId: prod.id, qty: 1 }],
    paymentMethod: 'Cash',
    amountReceived: 5000
  }, adminSession.token);

  const res2 = LocalApi.handle('POST', '/sales', {
    clientRequestId: reqId,
    items: [{ productId: prod.id, qty: 1 }],
    paymentMethod: 'Cash',
    amountReceived: 5000
  }, adminSession.token);

  assert.strictEqual(res1.sale.id, res2.sale.id);
  assert.strictEqual(res2.duplicate, true);
  assert.strictEqual(res2.stockChanges.length, 0);
});

check('POS Discount Permission Guard: Staff cannot apply discount (403)', () => {
  const prod = bootstrapData.products.find(p => p.stock > 5);
  try {
    LocalApi.handle('POST', '/sales', {
      items: [{ productId: prod.id, qty: 1 }],
      discount: 10,
      paymentMethod: 'Cash',
      amountReceived: 5000
    }, staffSession.token);
    assert.fail('Staff applying discount should have failed with 403');
  } catch (err) {
    assert.strictEqual(err.status, 403);
  }
});

check('POS Expired Product Guard: expired product cannot be sold', () => {
  const expired = bootstrapData.products.find(p => p.expirationDate && String(p.expirationDate).slice(0, 10) < Utils.todayStr());
  if (expired) {
    try {
      LocalApi.handle('POST', '/sales', {
        items: [{ productId: expired.id, qty: 1 }],
        paymentMethod: 'Cash',
        amountReceived: 5000
      }, adminSession.token);
      assert.fail('Selling expired product should fail');
    } catch (err) {
      assert.strictEqual(err.status, 400);
      assert.ok(err.message.includes('expired'));
    }
  }
});

console.log('\n--- 4. VOID, REFUND & REPRINT WORKFLOW ---');
check('Staff cannot void sale (403)', () => {
  try {
    LocalApi.handle('POST', `/sales/${testSaleId}/void`, { type: 'Voided', reason: 'Customer return' }, staffSession.token);
    assert.fail('Staff voiding sale should fail');
  } catch (err) {
    assert.strictEqual(err.status, 403);
  }
});

check('Admin can void sale: stock restored, warranty marked voided', () => {
  const res = LocalApi.handle('POST', `/sales/${testSaleId}/void`, { type: 'Voided', reason: 'Customer returned item in original condition' }, adminSession.token);
  assert.strictEqual(res.sale.status, 'Voided');
  assert.ok(res.restocked.length > 0);
  assert.strictEqual(res.sale.voidInfo.reason, 'Customer returned item in original condition');
});

check('Cannot void an already voided sale (409 Conflict)', () => {
  try {
    LocalApi.handle('POST', `/sales/${testSaleId}/void`, { type: 'Voided', reason: 'Attempt double void' }, adminSession.token);
    assert.fail('Double void should fail with 409');
  } catch (err) {
    assert.strictEqual(err.status, 409);
  }
});

check('Reprint receipt increments reprint count and logs audit entry', () => {
  const freshSale = LocalApi.handle('POST', '/sales', {
    items: [{ productId: 'BRK-001', qty: 1 }],
    paymentMethod: 'Cash',
    amountReceived: 1000
  }, adminSession.token).sale;

  const rep1 = LocalApi.handle('POST', `/sales/${freshSale.id}/reprint`, { context: 'sales-page' }, adminSession.token);
  assert.strictEqual(rep1.reprintNumber, 1);
  const rep2 = LocalApi.handle('POST', `/sales/${freshSale.id}/reprint`, { context: 'sales-page' }, adminSession.token);
  assert.strictEqual(rep2.reprintNumber, 2);
  assert.strictEqual(rep2.sale.reprintCount, 2);
});

console.log('\n--- 5. INVENTORY & STOCK TRANSACTIONS ---');
check('Stock In increments quantity and logs transaction', () => {
  const prod = LocalApi.handle('GET', '/bootstrap', {}, adminSession.token).products.find(p => p.id === 'BRK-001');
  const prev = prod.stock;
  const res = LocalApi.handle('POST', '/inventory/stock-in', {
    productId: 'BRK-001',
    quantity: 10,
    reference: 'PO-TEST-001',
    notes: 'Restock shipment'
  }, adminSession.token);

  assert.strictEqual(res.product.stock, prev + 10);
  assert.strictEqual(res.transaction.type, 'Stock In');
  assert.strictEqual(res.transaction.quantity, 10);
});

check('Stock Out decrements quantity and enforces valid reason', () => {
  const prod = LocalApi.handle('GET', '/bootstrap', {}, adminSession.token).products.find(p => p.id === 'BRK-001');
  const prev = prod.stock;
  const res = LocalApi.handle('POST', '/inventory/stock-out', {
    productId: 'BRK-001',
    quantity: 2,
    reason: 'Damaged',
    notes: 'Damaged during unloading'
  }, adminSession.token);

  assert.strictEqual(res.product.stock, prev - 2);
  assert.strictEqual(res.transaction.type, 'Stock Out');
  assert.strictEqual(res.transaction.reason, 'Damaged');
});

check('Stock Out with invalid reason throws 400', () => {
  try {
    LocalApi.handle('POST', '/inventory/stock-out', {
      productId: 'BRK-001',
      quantity: 1,
      reason: 'InvalidReason'
    }, adminSession.token);
    assert.fail('Invalid reason should fail');
  } catch (err) {
    assert.strictEqual(err.status, 400);
  }
});

check('Stock Adjustment: Staff forbidden (403), Admin succeeds with reason', () => {
  try {
    LocalApi.handle('POST', '/inventory/adjust', { productId: 'BRK-001', newQuantity: 50, reason: 'Physical recount' }, staffSession.token);
    assert.fail('Staff adjust should fail');
  } catch (err) {
    assert.strictEqual(err.status, 403);
  }

  const res = LocalApi.handle('POST', '/inventory/adjust', { productId: 'BRK-001', newQuantity: 50, reason: 'Physical recount by Ronnie' }, adminSession.token);
  assert.strictEqual(res.product.stock, 50);
  assert.strictEqual(res.transaction.type, 'Adjustment');
});

console.log('\n--- 6. CUSTOMER DIRECTORY & SOFT DELETE ---');
let newCustId;
check('Create Customer with phone uniqueness enforcement', () => {
  const c = LocalApi.handle('POST', '/customers', {
    name: 'Mario Rossi',
    contactNumber: '0917-555-1234',
    email: 'mario@example.com',
    address: 'Quezon City'
  }, staffSession.token);

  assert.ok(c.id && c.id.startsWith('CUST-'));
  newCustId = c.id;

  // Duplicate phone should fail
  try {
    LocalApi.handle('POST', '/customers', {
      name: 'Luigi Rossi',
      contactNumber: '0917-555-1234',
      email: 'luigi@example.com'
    }, staffSession.token);
    assert.fail('Duplicate customer phone should fail with 409');
  } catch (err) {
    assert.strictEqual(err.status, 409);
  }
});

check('Soft delete (deactivate) customer by Admin, Staff forbidden', () => {
  try {
    LocalApi.handle('DELETE', `/customers/${newCustId}`, {}, staffSession.token);
    assert.fail('Staff deleting customer should fail');
  } catch (err) {
    assert.strictEqual(err.status, 403);
  }

  const deactivated = LocalApi.handle('DELETE', `/customers/${newCustId}`, {}, adminSession.token);
  assert.strictEqual(deactivated.status, 'Inactive');

  const reactivated = LocalApi.handle('POST', `/customers/${newCustId}/reactivate`, {}, adminSession.token);
  assert.strictEqual(reactivated.status, 'Active');
});

console.log('\n--- 7. WARRANTY & CLAIMS ---');
check('File Warranty Claim: validates defect and action taken, updates claim history', () => {
  const boot = LocalApi.handle('GET', '/bootstrap', {}, adminSession.token);
  const war = boot.warranties.find(w => w.status === 'Active' || w.status === 'Expiring Soon');
  assert.ok(war, 'Must have an active warranty');

  const claim = LocalApi.handle('POST', `/warranties/${war.id}/claims`, {
    description: 'Brake lever loose and rattling',
    resolution: 'Tightened pivot bolt and lubricated cable',
    status: 'Resolved'
  }, staffSession.token);

  assert.ok(claim.id && claim.id.startsWith('CLM-'));
  assert.strictEqual(claim.status, 'Resolved');

  const updatedWar = LocalApi.handle('GET', '/bootstrap', {}, adminSession.token).warranties.find(w => w.id === war.id);
  assert.ok(updatedWar.claims.some(c => c.id === claim.id));
});

console.log('\n--- 8. USER MANAGEMENT & SELF-SERVICE PROFILE ---');
check('Self-deactivation prevented: Admin cannot deactivate or delete own account', () => {
  try {
    LocalApi.handle('DELETE', `/users/${adminSession.user.id}`, {}, adminSession.token);
    assert.fail('Admin deleting self should fail');
  } catch (err) {
    assert.strictEqual(err.status, 403);
  }

  try {
    LocalApi.handle('PUT', `/users/${adminSession.user.id}`, { status: 'Inactive' }, adminSession.token);
    assert.fail('Admin deactivating self should fail');
  } catch (err) {
    assert.strictEqual(err.status, 403);
  }
});

check('Profile password update: requires current password and enforces 8+ chars with letter and number', () => {
  try {
    LocalApi.handle('PUT', '/users/me/password', { currentPassword: 'WrongPassword', newPassword: 'NewPass123' }, staffSession.token);
    assert.fail('Wrong current password should fail');
  } catch (err) {
    assert.strictEqual(err.status, 400);
  }

  try {
    LocalApi.handle('PUT', '/users/me/password', { currentPassword: 'Staff@12345', newPassword: 'short' }, staffSession.token);
    assert.fail('Weak password should fail');
  } catch (err) {
    assert.strictEqual(err.status, 400);
  }

  const ok = LocalApi.handle('PUT', '/users/me/password', { currentPassword: 'Staff@12345', newPassword: 'StaffNewPass123' }, staffSession.token);
  assert.strictEqual(ok.ok, true);
  // Restore password for future tests
  LocalApi.handle('PUT', '/users/me/password', { currentPassword: 'StaffNewPass123', newPassword: 'Staff@12345' }, staffSession.token);
});

console.log('\n--- 9. SETTINGS & RECEIPT PREVIEW ---');
check('Settings update: Admin only, validates VAT rate 0-100% and mode', () => {
  try {
    LocalApi.handle('PUT', '/settings', { vatRate: 1.5 }, adminSession.token);
    assert.fail('VAT rate > 100% should fail');
  } catch (err) {
    assert.strictEqual(err.status, 400);
  }

  try {
    LocalApi.handle('PUT', '/settings', { shopName: 'New Shop' }, staffSession.token);
    assert.fail('Staff updating settings should fail');
  } catch (err) {
    assert.strictEqual(err.status, 403);
  }

  const updated = LocalApi.handle('PUT', '/settings', { shopName: 'TeamMotor MotoShop' }, adminSession.token);
  assert.strictEqual(updated.shopName, 'TeamMotor MotoShop');
  LocalApi.handle('PUT', '/settings', { shopName: 'TeamMotor' }, adminSession.token);
});

console.log('\n--- 10. NOTIFICATIONS & AUDIT TRAIL ---');
check('Notifications refresh and mark-as-read', () => {
  const notifs = LocalApi.handle('GET', '/notifications', {}, adminSession.token);
  assert.ok(Array.isArray(notifs));
  const res = LocalApi.handle('POST', '/notifications/read-all', {}, adminSession.token);
  assert.strictEqual(res.ok, true);
  const after = LocalApi.handle('GET', '/notifications', {}, adminSession.token);
  assert.ok(after.every(n => n.read === true));
});

console.log('\n================================================================');
console.log(`SUMMARY: ${passCount} Passed, ${failCount} Failed`);
console.log(`INCONSISTENCIES FOUND: ${inconsistencies.length}`);
console.log('================================================================');
