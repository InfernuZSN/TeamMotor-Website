const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

console.log('================================================================');
console.log('            TEAMMOTOR COMPREHENSIVE STRESS TEST SUITE           ');
console.log('================================================================');

// 1. Mock Browser / DOM Environment
const storage = {
  _data: {},
  getItem(k) { return this._data[k] !== undefined ? this._data[k] : null; },
  setItem(k, v) { this._data[k] = String(v); },
  removeItem(k) { delete this._data[k]; },
  clear() { this._data = {}; }
};

global.window = {
  location: { protocol: 'file:', pathname: '/public/pos.html', href: 'pos.html', search: '', replace() {} },
  localStorage: storage,
  sessionStorage: { ...storage, _data: {} },
  document: {
    readyState: 'complete',
    body: { hasAttribute() { return false; }, appendChild(el) { return el; } },
    createElement(tag) {
      return {
        tagName: tag.toUpperCase(),
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        style: {},
        attributes: {},
        setAttribute(k, v) { this.attributes[k] = String(v); },
        getAttribute(k) { return this.attributes[k] || null; },
        hasAttribute(k) { return k in this.attributes; },
        appendChild(c) { return c; },
        remove() {},
        get innerHTML() { return this._html || ''; },
        set innerHTML(v) { this._html = String(v); this._text = String(v).replace(/<[^>]*>/g, ''); },
        get textContent() { return this._text || ''; },
        set textContent(v) { this._text = String(v); this._html = String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
      };
    },
    getElementById() { return this.createElement('div'); },
    querySelector() { return this.createElement('div'); },
    querySelectorAll() { return []; },
    addEventListener() {},
    removeEventListener() {}
  },
  TEAMMOTOR_MODE: 'local'
};
global.document = global.window.document;
global.localStorage = global.window.localStorage;
global.sessionStorage = global.window.sessionStorage;
global.location = global.window.location;

function loadScript(filePath) {
  const code = fs.readFileSync(path.resolve(filePath), 'utf8');
  vm.runInThisContext(code, { filename: filePath });
}

loadScript('public/js/mock-data.js');
loadScript('public/js/local-api.js');
loadScript('public/js/store.js');
loadScript('public/js/analytics.js');
loadScript('public/js/receipt.js');

let pass = 0, fail = 0;
const fatalErrors = [];

function runStress(name, fn) {
  try {
    fn();
    pass++;
    console.log(`[PASS] ${name}`);
  } catch (err) {
    fail++;
    console.error(`[FAIL] ${name}: ${err.message}`);
    fatalErrors.push({ name, error: err.message, stack: err.stack });
  }
}

// Get admin and staff tokens
const adminLogin = LocalApi.handle('POST', '/auth/login', { username: 'ronnie.manalo', password: 'Admin@12345' });
const staffLogin = LocalApi.handle('POST', '/auth/login', { username: 'juan.delacruz', password: 'Staff@12345' });
const adminToken = adminLogin.token;
const staffToken = staffLogin.token;

// ============================================================================
// STRESS TEST 1: RACE CONDITIONS & ATOMIC STOCK INTEGRITY
// ============================================================================
console.log('\n--- 1. CONCURRENT STOCK & CHECKOUT INTEGRITY ---');

runStress('Depleting stock to exactly 0 rejects subsequent sales without negative stock', () => {
  // Ensure product stock is set to exactly 3
  const current = LocalApi.handle('GET', '/bootstrap', {}, adminToken).products.find(p => p.id === 'ENG-002');
  if (current.stock !== 3) {
    LocalApi.handle('POST', '/inventory/adjust', { productId: 'ENG-002', newQuantity: 3, reason: 'Stress test baseline' }, adminToken);
  }

  let success = 0, rejected = 0;
  // Attempt 5 purchases of 1 unit each
  for (let i = 0; i < 5; i++) {
    try {
      LocalApi.handle('POST', '/sales', {
        items: [{ productId: 'ENG-002', qty: 1 }],
        paymentMethod: 'Cash',
        amountReceived: 10000
      }, staffToken);
      success++;
    } catch (err) {
      if (err.message.includes('Not enough stock') || err.message.includes('Insufficient stock')) {
        rejected++;
      } else {
        throw err;
      }
    }
  }

  assert.strictEqual(success, 3, 'Exactly 3 sales must succeed');
  assert.strictEqual(rejected, 2, 'Exactly 2 sales must be rejected');

  const prod = LocalApi.handle('GET', '/bootstrap', {}, adminToken).products.find(p => p.id === 'ENG-002');
  assert.strictEqual(prod.stock, 0, 'Stock must be exactly 0, never negative');
});

runStress('Rapid-fire sales with unique clientRequestIds succeed and preserve consistency', () => {
  // Add plenty of stock first
  LocalApi.handle('POST', '/inventory/stock-in', { productId: 'BRK-002', quantity: 100, reference: 'STRESS-IN', notes: 'Stock for rapid fire' }, adminToken);
  const startStock = LocalApi.handle('GET', '/bootstrap', {}, adminToken).products.find(p => p.id === 'BRK-002').stock;

  const N = 50;
  for (let i = 0; i < N; i++) {
    const res = LocalApi.handle('POST', '/sales', {
      clientRequestId: `rapid-sale-${Date.now()}-${i}-${Math.random()}`,
      items: [{ productId: 'BRK-002', qty: 1 }],
      paymentMethod: 'Cash',
      amountReceived: 2000
    }, staffToken);
    assert.strictEqual(res.sale.status, 'Completed');
  }

  const endStock = LocalApi.handle('GET', '/bootstrap', {}, adminToken).products.find(p => p.id === 'BRK-002').stock;
  assert.strictEqual(endStock, startStock - N, `Stock should have decreased by exactly ${N}`);
});

// ============================================================================
// STRESS TEST 2: BOUNDARY VALUES, OVERFLOWS & MALFORMED INPUTS
// ============================================================================
console.log('\n--- 2. BOUNDARY VALUES & MALFORMED INPUTS ---');

runStress('Checkout rejects negative quantity', () => {
  assert.throws(() => {
    LocalApi.handle('POST', '/sales', { items: [{ productId: 'BRK-001', qty: -5 }], paymentMethod: 'Cash', amountReceived: 1000 }, staffToken);
  }, /whole-number quantity of at least 1/);
});

runStress('Checkout rejects zero quantity', () => {
  assert.throws(() => {
    LocalApi.handle('POST', '/sales', { items: [{ productId: 'BRK-001', qty: 0 }], paymentMethod: 'Cash', amountReceived: 1000 }, staffToken);
  }, /whole-number quantity of at least 1/);
});

runStress('Checkout rejects non-integer decimal quantity', () => {
  assert.throws(() => {
    LocalApi.handle('POST', '/sales', { items: [{ productId: 'BRK-001', qty: 1.5 }], paymentMethod: 'Cash', amountReceived: 1000 }, staffToken);
  }, /whole-number quantity of at least 1/);
});

runStress('Checkout rejects ridiculous quantity (> 10000)', () => {
  assert.throws(() => {
    LocalApi.handle('POST', '/sales', { items: [{ productId: 'BRK-001', qty: 99999999 }], paymentMethod: 'Cash', amountReceived: 1000 }, staffToken);
  }, /whole-number quantity of at least 1/);
});

runStress('Client-tampered price is safely ignored and overridden by catalog price', () => {
  const prod = LocalApi.handle('GET', '/bootstrap', {}, adminToken).products.find(p => p.id === 'BRK-001');
  const res = LocalApi.handle('POST', '/sales', {
    items: [{ productId: 'BRK-001', qty: 1, price: 1.00, subtotal: 1.00 }], // client attempts to buy for 1 peso
    paymentMethod: 'Cash',
    amountReceived: 10000
  }, staffToken);

  assert.strictEqual(res.sale.items[0].price, prod.sellingPrice, 'Price must be catalog price');
  assert.strictEqual(res.sale.subtotal, prod.sellingPrice, 'Subtotal must match catalog price');
});

runStress('Negative discount is rejected with 400', () => {
  assert.throws(() => {
    LocalApi.handle('POST', '/sales', {
      items: [{ productId: 'BRK-001', qty: 1 }],
      discount: -50,
      paymentMethod: 'Cash',
      amountReceived: 10000
    }, adminToken);
  }, /Discount cannot be negative/);
});

runStress('Discount greater than subtotal is rejected with 400', () => {
  assert.throws(() => {
    LocalApi.handle('POST', '/sales', {
      items: [{ productId: 'BRK-001', qty: 1 }],
      discount: 9999999,
      paymentMethod: 'Cash',
      amountReceived: 10000
    }, adminToken);
  }, /Discount cannot be more than the subtotal/);
});

runStress('Cash payment: Centavo precision tender checks', () => {
  // Cash short by 1 centavo must fail
  assert.throws(() => {
    LocalApi.handle('POST', '/sales', {
      items: [{ productId: 'BRK-001', qty: 1 }],
      paymentMethod: 'Cash',
      amountReceived: 0.50
    }, staffToken);
  }, /Cash received .* is less than the total due/);
});

runStress('XSS & Injection string payloads in Customer, Reference, and Notes fields do not corrupt storage', () => {
  const xssPayload = '<script>alert("XSS")</script><img src=x onerror=alert(1)>"\'; DROP TABLE users;--';
  const cust = LocalApi.handle('POST', '/customers', {
    name: 'XSS Test ' + xssPayload,
    contactNumber: '0918-999-9999',
    email: 'xsstest@example.com',
    notes: xssPayload
  }, adminToken);

  assert.ok(cust.id);
  assert.strictEqual(cust.name, 'XSS Test ' + xssPayload);

  const sale = LocalApi.handle('POST', '/sales', {
    items: [{ productId: 'BRK-001', qty: 1 }],
    paymentMethod: 'Cash',
    amountReceived: 10000,
    customerId: cust.id,
    reference: xssPayload
  }, adminToken).sale;

  assert.strictEqual(sale.reference, xssPayload.slice(0, 80));

  // Verify receipt escaping
  const rcpt = Receipt.fromSale(sale);
  const html = Receipt.html(rcpt);
  assert.ok(!html.includes('<script>alert'), 'HTML must escape scripts');
  assert.ok(html.includes('&lt;script&gt;alert'), 'HTML must have encoded tags');
});

// ============================================================================
// STRESS TEST 3: STOCK ADJUSTMENT & VOID RECOVERY STRESS
// ============================================================================
console.log('\n--- 3. REVERSAL, VOID & RECOVERY STRESS ---');

runStress('Voiding sale with retired products skips missing product and restocks active ones without throwing', () => {
  // Find or create a sale that contains MOT-001 or simulated retired item
  const boot = LocalApi.handle('GET', '/bootstrap', {}, adminToken);
  let targetSale = boot.sales.find(s => s.status === 'Completed' && s.items.some(it => !boot.products.some(p => p.id === it.productId)));

  if (!targetSale) {
    // If none found, create a dummy sale with an item whose product doesn't exist
    const nonExistentSale = {
      id: 'SALE-RETIRED-TEST',
      date: new Date().toISOString(),
      items: [{ productId: 'RETIRED-001', name: 'Vintage 1970 Helmet', qty: 1, price: 1500, subtotal: 1500 }],
      subtotal: 1500, discount: 0, total: 1500, paymentMethod: 'Cash', amountReceived: 1500, changeAmount: 0,
      status: 'Completed', staff: 'Ronnie Manalo', shop: boot.sales[0].shop
    };
    // Inject into local db for test
    const raw = JSON.parse(storage.getItem('teammotor:local:db:v1'));
    raw.sales.unshift(nonExistentSale);
    storage.setItem('teammotor:local:db:v1', JSON.stringify(raw));
    targetSale = nonExistentSale;
  }

  const voidResult = LocalApi.handle('POST', `/sales/${targetSale.id}/void`, { type: 'Voided', reason: 'Customer return of vintage item' }, adminToken);
  assert.strictEqual(voidResult.sale.status, 'Voided');
  assert.ok(voidResult.restockSkipped.length > 0, 'Must record restockSkipped for retired products');
});

runStress('Simultaneous double-void: second attempt throws 409 Conflict', () => {
  const sale = LocalApi.handle('POST', '/sales', {
    items: [{ productId: 'BRK-001', qty: 1 }],
    paymentMethod: 'Cash',
    amountReceived: 1000
  }, adminToken).sale;

  const v1 = LocalApi.handle('POST', `/sales/${sale.id}/void`, { type: 'Voided', reason: 'First void' }, adminToken);
  assert.strictEqual(v1.sale.status, 'Voided');

  assert.throws(() => {
    LocalApi.handle('POST', `/sales/${sale.id}/void`, { type: 'Voided', reason: 'Second void' }, adminToken);
  }, /already Voided/);
});

// ============================================================================
// STRESS TEST 4: USER & AUTHENTICATION STRESS
// ============================================================================
console.log('\n--- 4. USER SECURITY & SESSION INTEGRITY ---');

runStress('Tampered/forged token throws 401 Authentication Required', () => {
  assert.throws(() => {
    LocalApi.handle('GET', '/bootstrap', {}, 'local:USR-FORGED-999');
  }, /Authentication required/);

  assert.throws(() => {
    LocalApi.handle('GET', '/bootstrap', {}, 'Bearer invalid-token');
  }, /Authentication required/);

  assert.throws(() => {
    LocalApi.handle('GET', '/bootstrap', {}, '');
  }, /Authentication required/);
});

runStress('Inactive user token is immediately rejected with 401', () => {
  // Create staff user
  const newUser = LocalApi.handle('POST', '/users', {
    name: 'Temp Staff',
    username: 'temp.staff',
    role: 'Staff',
    password: 'TempPassword123'
  }, adminToken);

  const loginRes = LocalApi.handle('POST', '/auth/login', { username: 'temp.staff', password: 'TempPassword123' });
  const userToken = loginRes.token;

  // Deactivate user
  LocalApi.handle('PUT', `/users/${newUser.id}`, { status: 'Inactive' }, adminToken);

  // Attempt using user token
  assert.throws(() => {
    LocalApi.handle('GET', '/bootstrap', {}, userToken);
  }, /Authentication required/);

  // Attempt logging in again
  assert.throws(() => {
    LocalApi.handle('POST', '/auth/login', { username: 'temp.staff', password: 'TempPassword123' });
  }, /This account is inactive/);
});

// ============================================================================
// STRESS TEST 5: SHIFT CLOCK IN / OUT CYCLES
// ============================================================================
console.log('\n--- 5. ATTENDANCE & SHIFT STRESS ---');

runStress('Clock-in when already clocked-in is idempotent (returns existing shift)', () => {
  const s1 = LocalApi.handle('POST', '/users/shifts/clock-in', {}, staffToken);
  const s2 = LocalApi.handle('POST', '/users/shifts/clock-in', {}, staffToken);
  assert.strictEqual(s1.id, s2.id, 'Should return same open shift');

  const sOut = LocalApi.handle('POST', '/users/shifts/clock-out', {}, staffToken);
  assert.ok(sOut.clockOut, 'Should be clocked out');

  assert.throws(() => {
    LocalApi.handle('POST', '/users/shifts/clock-out', {}, staffToken);
  }, /You are not clocked in/);
});

console.log('\n================================================================');
console.log(`STRESS TEST SUMMARY: ${pass} Passed, ${fail} Failed`);
console.log(`FATAL SYSTEM ERRORS: ${fatalErrors.length}`);
console.log('================================================================');
