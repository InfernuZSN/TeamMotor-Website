const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

console.log('================================================================');
console.log('           TEAMMOTOR SYSTEM AUDIT & FEATURE TEST SUITE          ');
console.log('================================================================');

// 1. Setup DOM / Browser mocks for Node environment
global.window = {
  location: { protocol: 'file:', pathname: '/public/pos.html', search: '' },
  localStorage: {
    _data: {},
    getItem(k) { return this._data[k] || null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; },
    clear() { this._data = {}; }
  },
  sessionStorage: {
    _data: {},
    getItem(k) { return this._data[k] || null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; },
    clear() { this._data = {}; }
  },
  TEAMMOTOR_MODE: 'local'
};
global.localStorage = global.window.localStorage;
global.sessionStorage = global.window.sessionStorage;
global.location = global.window.location;
global.document = {
  createElement() {
    return {
      innerHTML: '',
      textContent: '',
      appendChild() {},
      style: {}
    };
  }
};

// Load mock-data.js, local-api.js, store.js, analytics.js, receipt.js into global context
function loadScript(filePath) {
  const code = fs.readFileSync(path.resolve(filePath), 'utf8');
  vm.runInThisContext(code, { filename: filePath });
}

loadScript('public/js/mock-data.js');
loadScript('public/js/local-api.js');
loadScript('public/js/store.js');
loadScript('public/js/analytics.js');
loadScript('public/js/receipt.js');

const results = {
  passed: 0,
  failed: 0,
  inconsistencies: []
};

function test(name, fn) {
  try {
    fn();
    results.passed++;
    console.log(`[PASS] ${name}`);
  } catch (err) {
    results.failed++;
    console.error(`[FAIL] ${name}: ${err.message}`);
  }
}

function recordInconsistency(category, description, files) {
  results.inconsistencies.push({ category, description, files });
}

// ============================================================================
// PHASE 1: AUTHENTICATION & LOGIN WORKFLOW
// ============================================================================
console.log('\n--- TESTING AUTHENTICATION ---');

test('Admin Login succeeds with ronnie.manalo / Admin@12345', () => {
  const res = LocalApi.handle('POST', '/auth/login', { username: 'ronnie.manalo', password: 'Admin@12345' });
  assert.ok(res.token && res.token.startsWith('local:'));
  assert.strictEqual(res.user.role, 'Admin');
  assert.strictEqual(res.user.username, 'ronnie.manalo');
});

test('Staff Login succeeds with juan.delacruz / Staff@12345', () => {
  const res = LocalApi.handle('POST', '/auth/login', { username: 'juan.delacruz', password: 'Staff@12345' });
  assert.ok(res.token && res.token.startsWith('local:'));
  assert.strictEqual(res.user.role, 'Staff');
});

test('Login with wrong password throws 401', () => {
  assert.throws(() => {
    LocalApi.handle('POST', '/auth/login', { username: 'ronnie.manalo', password: 'WrongPassword' });
  }, /Invalid username or password/);
});

test('Login with empty fields throws 400', () => {
  assert.throws(() => {
    LocalApi.handle('POST', '/auth/login', { username: '', password: '' });
  }, /Username and password are required/);
});

// Admin token for following tests
const adminLogin = LocalApi.handle('POST', '/auth/login', { username: 'ronnie.manalo', password: 'Admin@12345' });
const adminToken = adminLogin.token;

const staffLogin = LocalApi.handle('POST', '/auth/login', { username: 'juan.delacruz', password: 'Staff@12345' });
const staffToken = staffLogin.token;

test('GET /auth/me returns current user profile', () => {
  const me = LocalApi.handle('GET', '/auth/me', {}, adminToken);
  assert.strictEqual(me.user.username, 'ronnie.manalo');
  assert.strictEqual(me.user.role, 'Admin');
});

// ============================================================================
// PHASE 2: BOOTSTRAP & DATA HYDRATION
// ============================================================================
console.log('\n--- TESTING BOOTSTRAP & DATA HYDRATION ---');

test('GET /bootstrap returns all necessary data collections', () => {
  const boot = LocalApi.handle('GET', '/bootstrap', {}, adminToken);
  assert.ok(boot.settings, 'Missing settings');
  assert.ok(Array.isArray(boot.categories) && boot.categories.length > 0, 'Missing categories');
  assert.ok(Array.isArray(boot.products) && boot.products.length > 0, 'Missing products');
  assert.ok(Array.isArray(boot.suppliers) && boot.suppliers.length > 0, 'Missing suppliers');
  assert.ok(Array.isArray(boot.customers) && boot.customers.length > 0, 'Missing customers');
  assert.ok(Array.isArray(boot.sales) && boot.sales.length > 0, 'Missing sales');
  assert.ok(Array.isArray(boot.inventoryTransactions) && boot.inventoryTransactions.length > 0, 'Missing inventoryTransactions');
  assert.ok(Array.isArray(boot.warranties) && boot.warranties.length > 0, 'Missing warranties');
  assert.ok(Array.isArray(boot.notifications), 'Missing notifications');
  assert.ok(boot.expiry, 'Missing expiry report');
  assert.strictEqual(boot.me.username, 'ronnie.manalo');
});

test('Staff bootstrap only sees own shifts and self user', () => {
  const bootStaff = LocalApi.handle('GET', '/bootstrap', {}, staffToken);
  assert.strictEqual(bootStaff.users.length, 1);
  assert.strictEqual(bootStaff.users[0].username, 'juan.delacruz');
});

// ============================================================================
// PHASE 3: POS OPERATIONS & BUSINESS RULES
// ============================================================================
console.log('\n--- TESTING POS OPERATIONS & BUSINESS RULES ---');

test('POS Checkout: successful Cash sale reduces stock and creates sale record', () => {
  const boot = LocalApi.handle('GET', '/bootstrap', {}, adminToken);
  const prod = boot.products.find(p => p.stock >= 5 && !p.expirationDate);
  assert.ok(prod, 'Need product with stock');
  const prevStock = prod.stock;

  const saleRes = LocalApi.handle('POST', '/sales', {
    clientRequestId: 'test-req-001',
    items: [{ productId: prod.id, qty: 2 }],
    paymentMethod: 'Cash',
    amountReceived: 5000,
    discount: 0
  }, adminToken);

  assert.strictEqual(saleRes.sale.items.length, 1);
  assert.strictEqual(saleRes.sale.status, 'Completed');
  assert.strictEqual(saleRes.sale.paymentMethod, 'Cash');
  assert.ok(saleRes.sale.changeAmount >= 0);

  // Check product stock updated
  const bootAfter = LocalApi.handle('GET', '/bootstrap', {}, adminToken);
  const updatedProd = bootAfter.products.find(p => p.id === prod.id);
  assert.strictEqual(updatedProd.stock, prevStock - 2, 'Stock should decrease by 2');
});

test('POS Checkout: Idempotent clientRequestId prevents duplicate sale', () => {
  const saleRes1 = LocalApi.handle('POST', '/sales', {
    clientRequestId: 'test-req-dup',
    items: [{ productId: 'LGT-001', qty: 1 }],
    paymentMethod: 'Cash',
    amountReceived: 2000
  }, adminToken);

  const saleRes2 = LocalApi.handle('POST', '/sales', {
    clientRequestId: 'test-req-dup',
    items: [{ productId: 'LGT-001', qty: 1 }],
    paymentMethod: 'Cash',
    amountReceived: 2000
  }, adminToken);

  assert.strictEqual(saleRes1.sale.id, saleRes2.sale.id);
  assert.strictEqual(saleRes2.duplicate, true);
});

test('POS Checkout: Selling expired product is strictly rejected', () => {
  const boot = LocalApi.handle('GET', '/bootstrap', {}, adminToken);
  const expiredProd = boot.products.find(p => p.expirationDate && String(p.expirationDate).slice(0, 10) < Utils.todayStr());
  assert.ok(expiredProd, 'Expected demo expired product ENG-004');

  assert.throws(() => {
    LocalApi.handle('POST', '/sales', {
      items: [{ productId: expiredProd.id, qty: 1 }],
      paymentMethod: 'Cash',
      amountReceived: 1000
    }, adminToken);
  }, /expired on .* and cannot be sold/);
});

test('POS Checkout: Insufficient stock throws 400', () => {
  assert.throws(() => {
    LocalApi.handle('POST', '/sales', {
      items: [{ productId: 'LGT-001', qty: 500 }],
      paymentMethod: 'Cash',
      amountReceived: 999999
    }, adminToken);
  }, /Not enough stock/);
});

test('POS Discount: Admin can apply discount, Staff is forbidden (403)', () => {
  // Staff attempt -> 403
  assert.throws(() => {
    LocalApi.handle('POST', '/sales', {
      items: [{ productId: 'LGT-001', qty: 1 }],
      paymentMethod: 'Cash',
      amountReceived: 2000,
      discount: 50
    }, staffToken);
  }, /Only an Admin can apply a discount/);

  // Admin attempt -> succeeds
  const res = LocalApi.handle('POST', '/sales', {
    items: [{ productId: 'LGT-001', qty: 1 }],
    paymentMethod: 'Cash',
    amountReceived: 2000,
    discount: 50,
    discountMode: 'amount',
    discountValue: 50
  }, adminToken);
  assert.strictEqual(res.sale.discount, 50);
});

test('POS Checkout: Non-cash payments reject invalid method and accept GCash', () => {
  // Invalid method (e.g. Maya for new sales)
  assert.throws(() => {
    LocalApi.handle('POST', '/sales', {
      items: [{ productId: 'LGT-001', qty: 1 }],
      paymentMethod: 'Maya'
    }, adminToken);
  }, /Unsupported payment method/);

  // Valid method GCash
  const res = LocalApi.handle('POST', '/sales', {
    items: [{ productId: 'LGT-001', qty: 1 }],
    paymentMethod: 'GCash',
    reference: 'GCASH-REF-123456'
  }, adminToken);
  assert.strictEqual(res.sale.paymentMethod, 'GCash');
  assert.strictEqual(res.sale.reference, 'GCASH-REF-123456');
});

test('POS Checkout: Automatically creates warranty for warranted product', () => {
  const boot = LocalApi.handle('GET', '/bootstrap', {}, adminToken);
  const warrantedProd = boot.products.find(p => (p.warrantyDuration || p.warrantyDays || p.rubber) && p.stock > 0);
  assert.ok(warrantedProd, 'Need product with warranty');

  const res = LocalApi.handle('POST', '/sales', {
    items: [{ productId: warrantedProd.id, qty: 1 }],
    paymentMethod: 'Cash',
    amountReceived: 10000
  }, adminToken);

  assert.ok(res.warrantiesCreated >= 1, 'Warranty should be created');

  const bootAfter = LocalApi.handle('GET', '/bootstrap', {}, adminToken);
  const w = bootAfter.warranties.find(x => x.saleId === res.sale.id);
  assert.ok(w, 'Warranty record must exist');
  assert.strictEqual(w.productId, warrantedProd.id);
  assert.ok(w.status === 'Active' || w.status === 'Expiring Soon', 'Status must be active or expiring soon');
});

// ============================================================================
// PHASE 4: VOID / CANCEL / REFUND & REPRINT
// ============================================================================
console.log('\n--- TESTING VOID / REFUND & REPRINT ---');

test('Void sale: Staff is forbidden (403), Admin succeeds, stock restored, warranty voided', () => {
  // 1. Create a sale
  const saleRes = LocalApi.handle('POST', '/sales', {
    items: [{ productId: 'LGT-001', qty: 2 }],
    paymentMethod: 'Cash',
    amountReceived: 2000
  }, adminToken);
  const saleId = saleRes.sale.id;

  const stockBeforeVoid = LocalApi.handle('GET', '/bootstrap', {}, adminToken).products.find(p => p.id === 'LGT-001').stock;

  // 2. Staff tries to void -> fails
  assert.throws(() => {
    LocalApi.handle('POST', `/sales/${saleId}/void`, { type: 'Voided', reason: 'Customer error' }, staffToken);
  }, /requires Admin access/);

  // 3. Admin voids without reason -> fails
  assert.throws(() => {
    LocalApi.handle('POST', `/sales/${saleId}/void`, { type: 'Voided', reason: '' }, adminToken);
  }, /A reason is required/);

  // 4. Admin voids with reason -> succeeds
  const voidRes = LocalApi.handle('POST', `/sales/${saleId}/void`, { type: 'Voided', reason: 'Wrong part purchased' }, adminToken);
  assert.strictEqual(voidRes.sale.status, 'Voided');

  // Stock restored by 2
  const stockAfterVoid = LocalApi.handle('GET', '/bootstrap', {}, adminToken).products.find(p => p.id === 'LGT-001').stock;
  assert.strictEqual(stockAfterVoid, stockBeforeVoid + 2, 'Stock must be incremented by 2');

  // Second void attempt fails with 409 conflict
  assert.throws(() => {
    LocalApi.handle('POST', `/sales/${saleId}/void`, { type: 'Voided', reason: 'Try again' }, adminToken);
  }, /already Voided/);
});

test('Void seed motorcycle sale: succeeds and skips restock for retired vehicle product', () => {
  const res = LocalApi.handle('POST', '/sales/SALE-MOT-001/void', { type: 'Voided', reason: 'Customer return' }, adminToken);
  assert.strictEqual(res.sale.status, 'Voided');
  assert.ok(res.restockSkipped && res.restockSkipped.length >= 1, 'Should record restockSkipped for retired MOT items');
  console.log('Confirmed: Seed motorcycle void succeeded gracefully with skipped restock for retired MOT-001.');
});

// ============================================================================
// PHASE 5: INVENTORY & STOCK TRANSACTIONS
// ============================================================================
console.log('\n--- TESTING INVENTORY, STOCK IN/OUT/ADJUST ---');

test('Stock In: Increases stock and logs transaction', () => {
  const p = LocalApi.handle('GET', '/bootstrap', {}, adminToken).products.find(x => x.id === 'LGT-001');
  const prevStock = p.stock;

  const res = LocalApi.handle('POST', '/inventory/stock-in', {
    productId: 'LGT-001',
    quantity: 10,
    reference: 'PO-999',
    notes: 'Restock shipment'
  }, staffToken);

  assert.strictEqual(res.product.stock, prevStock + 10);
  assert.strictEqual(res.transaction.type, 'Stock In');
  assert.strictEqual(res.transaction.quantity, 10);
});

test('Stock Out: Decreases stock and enforces valid reasons', () => {
  // Invalid reason
  assert.throws(() => {
    LocalApi.handle('POST', '/inventory/stock-out', {
      productId: 'LGT-001',
      quantity: 1,
      reason: 'UnknownReason'
    }, staffToken);
  }, /Choose a valid reason/);

  // Valid reason
  const p = LocalApi.handle('GET', '/bootstrap', {}, adminToken).products.find(x => x.id === 'LGT-001');
  const prevStock = p.stock;

  const res = LocalApi.handle('POST', '/inventory/stock-out', {
    productId: 'LGT-001',
    quantity: 2,
    reason: 'Damaged',
    notes: 'Cracked during handling'
  }, staffToken);

  assert.strictEqual(res.product.stock, prevStock - 2);
  assert.strictEqual(res.transaction.type, 'Stock Out');
  assert.strictEqual(res.transaction.reason, 'Damaged');
});

test('Stock Adjustment: Staff forbidden (403), Admin succeeds with reason', () => {
  assert.throws(() => {
    LocalApi.handle('POST', '/inventory/adjust', {
      productId: 'LGT-001',
      newQuantity: 50,
      reason: 'Physical count discrepancy'
    }, staffToken);
  }, /requires Admin access/);

  const res = LocalApi.handle('POST', '/inventory/adjust', {
    productId: 'LGT-001',
    newQuantity: 50,
    reason: 'Physical count discrepancy'
  }, adminToken);

  assert.strictEqual(res.product.stock, 50);
  assert.strictEqual(res.transaction.type, 'Adjustment');
});

test('Archive product: Admin only, hides product from active sale', () => {
  const p = LocalApi.handle('GET', '/bootstrap', {}, adminToken).products[0];
  
  LocalApi.handle('POST', `/products/${p.id}/archive`, { archived: true }, adminToken);
  
  const bootAfter = LocalApi.handle('GET', '/bootstrap', {}, adminToken);
  const archived = bootAfter.products.find(x => x.id === p.id);
  assert.strictEqual(archived.archived, true);

  // Attempting to sell archived product fails
  assert.throws(() => {
    LocalApi.handle('POST', '/sales', {
      items: [{ productId: p.id, qty: 1 }],
      paymentMethod: 'Cash',
      amountReceived: 1000
    }, adminToken);
  }, /not available for sale/);

  // Unarchive
  LocalApi.handle('POST', `/products/${p.id}/archive`, { archived: false }, adminToken);
});

// ============================================================================
// PHASE 6: CUSTOMER MANAGEMENT
// ============================================================================
console.log('\n--- TESTING CUSTOMER MANAGEMENT ---');

test('Customer Create & Phone Uniqueness', () => {
  const cust = LocalApi.handle('POST', '/customers', {
    name: 'Maria Santos',
    contactNumber: '0917-999-8888',
    email: 'maria@example.com'
  }, staffToken);

  assert.ok(cust.id.startsWith('CUST-'));
  assert.strictEqual(cust.status, 'Active');

  // Duplicate phone throws 409
  assert.throws(() => {
    LocalApi.handle('POST', '/customers', {
      name: 'Duplicate Phone Person',
      contactNumber: '0917-999-8888'
    }, staffToken);
  }, /That phone number already belongs to/);
});

test('Customer Deactivate (Soft Delete) & Reactivate', () => {
  const boot = LocalApi.handle('GET', '/bootstrap', {}, adminToken);
  const c = boot.customers[0];

  // Staff cannot deactivate
  assert.throws(() => {
    LocalApi.handle('DELETE', `/customers/${c.id}`, {}, staffToken);
  }, /requires Admin access/);

  // Admin deactivates
  const deact = LocalApi.handle('DELETE', `/customers/${c.id}`, {}, adminToken);
  assert.strictEqual(deact.status, 'Inactive');

  // Reactivate
  const react = LocalApi.handle('POST', `/customers/${c.id}/reactivate`, {}, adminToken);
  assert.strictEqual(react.status, 'Active');
});

// ============================================================================
// PHASE 7: WARRANTY CLAIMS
// ============================================================================
console.log('\n--- TESTING WARRANTY CLAIMS ---');

test('Warranty Claim filing: Records claim and updates status to Claimed', () => {
  const boot = LocalApi.handle('GET', '/bootstrap', {}, adminToken);
  const w = boot.warranties.find(x => x.status === 'Active' && x.claims.length === 0);
  assert.ok(w, 'Need active warranty without claims');

  const claim = LocalApi.handle('POST', `/warranties/${w.id}/claims`, {
    description: 'Flickering LED chip',
    resolution: 'Replaced headlight unit under warranty',
    status: 'Resolved'
  }, staffToken);

  assert.ok(claim.id.startsWith('CLM-'));
  assert.strictEqual(claim.status, 'Resolved');

  const bootAfter = LocalApi.handle('GET', '/bootstrap', {}, adminToken);
  const wAfter = bootAfter.warranties.find(x => x.id === w.id);
  assert.strictEqual(wAfter.status, 'Claimed');
});

// ============================================================================
// PHASE 8: SETTINGS & RECEIPT
// ============================================================================
console.log('\n--- TESTING SETTINGS & RECEIPT ---');

test('Settings Update: Admin only, validates VAT rate', () => {
  assert.throws(() => {
    LocalApi.handle('PUT', '/settings', { shopName: 'Hacked' }, staffToken);
  }, /requires Admin access/);

  assert.throws(() => {
    LocalApi.handle('PUT', '/settings', { vatRate: 1.5 }, adminToken);
  }, /VAT rate must be between 0% and 100%/);

  const updated = LocalApi.handle('PUT', '/settings', { shopName: 'TeamMotor MotoShop' }, adminToken);
  assert.strictEqual(updated.shopName, 'TeamMotor MotoShop');
});

test('Receipt Generation: produces valid HTML with 58mm thermal layout', () => {
  const boot = LocalApi.handle('GET', '/bootstrap', {}, adminToken);
  const sale = boot.sales[0];
  const rcptData = Receipt.fromSale(sale);
  const html = Receipt.html(rcptData);

  assert.ok(html.includes('SALES RECEIPT'));
  assert.ok(html.includes(sale.id));
  assert.ok(html.includes('rcpt'));
});

// ============================================================================
// PHASE 9: SHIFTS & ATTENDANCE
// ============================================================================
console.log('\n--- TESTING SHIFTS & ATTENDANCE ---');

test('Staff Shift Clock-In and Clock-Out', () => {
  // Clock in
  const shiftIn = LocalApi.handle('POST', '/users/shifts/clock-in', {}, staffToken);
  assert.ok(shiftIn.id.startsWith('SHF-'));
  assert.strictEqual(shiftIn.username, 'juan.delacruz');
  assert.strictEqual(shiftIn.clockOut, null);

  // Clock out
  const shiftOut = LocalApi.handle('POST', '/users/shifts/clock-out', {}, staffToken);
  assert.ok(shiftOut.clockOut !== null);
});

// Summary
console.log('\n================================================================');
console.log(`TEST RESULTS: ${results.passed} Passed, ${results.failed} Failed`);
console.log('================================================================');
