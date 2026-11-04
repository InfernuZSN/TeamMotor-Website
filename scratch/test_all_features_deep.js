const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

console.log('=== DEEP SYSTEM BEHAVIORAL & PARITY TEST ===');

// Setup mock browser environment
const localStorageMock = {
  _d: {},
  getItem(k) { return this._d[k] !== undefined ? this._d[k] : null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; },
  clear() { this._d = {}; }
};
const sessionStorageMock = {
  _d: {},
  getItem(k) { return this._d[k] !== undefined ? this._d[k] : null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; },
  clear() { this._d = {}; }
};

const mockCode = fs.readFileSync(path.resolve('public/js/mock-data.js'), 'utf8');
const localApiCode = fs.readFileSync(path.resolve('public/js/local-api.js'), 'utf8');

const ctx = {
  window: { localStorage: localStorageMock, sessionStorage: sessionStorageMock, location: { search: '' } },
  document: { addEventListener: () => {}, createElement: () => ({}) },
  localStorage: localStorageMock,
  sessionStorage: sessionStorageMock,
  console, Date, Math, RegExp, Set, Map, Array, Object, String, Number, JSON, setTimeout, clearTimeout, URLSearchParams
};

vm.runInNewContext(mockCode + ';\n' + localApiCode + ';\nthis.LocalApi = LocalApi; this.Utils = Utils;', ctx);
const LocalApi = ctx.LocalApi;
LocalApi.reset();

const issues = [];
function logIssue(category, title, detail, recommendation) {
  issues.push({ category, title, detail, recommendation });
}

async function run() {
  console.log('\n--- 1. Testing Auth & Session Flows ---');
  // 1.1 Login as Admin
  const adminLogin = LocalApi.handle('POST', '/auth/login', { username: 'ronnie.manalo', password: 'Admin@12345' });
  assert(adminLogin.token, 'Admin login failed');
  assert.strictEqual(adminLogin.user.role, 'Admin');

  // 1.2 Login as Staff
  const staffLogin = LocalApi.handle('POST', '/auth/login', { username: 'juan.delacruz', password: 'Staff@12345' });
  assert(staffLogin.token, 'Staff login failed');
  assert.strictEqual(staffLogin.user.role, 'Staff');

  // 1.3 Role enforcement on admin-only routes
  try {
    LocalApi.handle('POST', '/categories', { name: 'Test Cat', prefix: 'TST' }, staffLogin.token);
    logIssue('Security & Permissions', 'Staff can create categories in LocalApi', 'Staff was able to call POST /categories', 'Enforce needAdmin in LocalApi');
  } catch (err) {
    // Expected 403 Forbidden
    assert.strictEqual(err.status, 403);
    console.log('Admin route properly protected from Staff (403)');
  }

  console.log('\n--- 2. Testing POS & Checkout Edge Cases ---');
  // 2.1 Checkout with discount exceeding 100% or negative discount
  try {
    const sale = LocalApi.handle('POST', '/sales', {
      items: [{ productId: 'ENG-001', qty: 1 }],
      paymentMethod: 'Cash',
      amountReceived: 500,
      discount: 99999 // discount higher than subtotal
    }, staffLogin.token);
    logIssue('POS & Sales Logic', 'POS allows discount greater than subtotal', 'Sale succeeded with discount exceeding item subtotal: ' + JSON.stringify(sale), 'Validate discount <= subtotal in backend and frontend');
  } catch (err) {
    console.log('Discount > subtotal properly rejected or capped:', err.message);
  }

  // 2.2 Checkout with 0 or negative quantity
  try {
    LocalApi.handle('POST', '/sales', {
      items: [{ productId: 'ENG-001', qty: 0 }],
      paymentMethod: 'Cash',
      amountReceived: 500
    }, staffLogin.token);
    logIssue('POS & Sales Logic', 'POS allows zero item quantity', 'Sale succeeded with qty 0', 'Validate item qty > 0');
  } catch (err) {
    console.log('Zero quantity properly rejected:', err.message);
  }

  // 2.3 Checkout with insufficient cash tendered
  try {
    LocalApi.handle('POST', '/sales', {
      items: [{ productId: 'ENG-001', qty: 1 }],
      paymentMethod: 'Cash',
      amountReceived: 10 // item is 250+
    }, staffLogin.token);
    logIssue('POS & Sales Logic', 'POS allows cash payment less than total', 'Sale succeeded with insufficient tender', 'Validate amountReceived >= total for cash payments');
  } catch (err) {
    console.log('Insufficient cash properly rejected:', err.message);
  }

  // 2.4 Checkout non-cash payment (reference is optional)
  try {
    LocalApi.handle('POST', '/sales', {
      items: [{ productId: 'ENG-001', qty: 1 }],
      paymentMethod: 'GCash',
      reference: ''
    }, staffLogin.token);
    console.log('GCash checkout with optional reference allowed as expected');
  } catch (err) {
    console.log('GCash checkout error:', err.message);
  }

  console.log('\n--- 3. Testing Inventory Stock Adjustments & Batch / Expiry Tracking ---');
  // 3.1 Stock Out with reason
  const stockOutRes = LocalApi.handle('POST', '/inventory/stock-out', {
    productId: 'ENG-001',
    quantity: 1,
    reason: 'Damaged'
  }, staffLogin.token);
  assert(stockOutRes && stockOutRes.product, 'Stock out failed');
  console.log('Stock Out successful');

  // 3.2 Stock Out with quantity greater than available stock
  try {
    LocalApi.handle('POST', '/inventory/stock-out', {
      productId: 'ENG-001',
      quantity: 999999,
      reason: 'Damaged'
    }, staffLogin.token);
    logIssue('Inventory Logic', 'Allows negative stock through Stock Out', 'Stock-out exceeded available quantity without validation', 'Reject stock out when quantity > available stock');
  } catch (err) {
    console.log('Excessive stock out properly rejected:', err.message);
  }

  console.log('\n--- 4. Testing Warranty Claim Transitions ---');
  const warList = LocalApi.handle('GET', '/warranties', null, adminLogin.token);
  console.log('Total warranties loaded:', warList.length);
  const activeWar = warList.find(w => w.status === 'Active');
  if (activeWar) {
    console.log('Found active warranty:', activeWar.id);
    const claimRes = LocalApi.handle('POST', '/warranties/' + activeWar.id + '/claims', {
      description: 'Brake pads cracked under normal braking',
      status: 'Approved',
      resolution: 'Replaced with new pad set from stock'
    }, adminLogin.token);
    console.log('Claim submitted:', claimRes.id, 'Warranty status now:', claimRes.warranty ? claimRes.warranty.status : 'N/A');
  }

  // Can a Voided warranty have a claim filed?
  const voidedWar = warList.find(w => w.status === 'Voided');
  if (voidedWar) {
    try {
      LocalApi.handle('POST', '/warranties/' + voidedWar.id + '/claims', {
        description: 'Test claim on voided',
        status: 'Pending'
      }, adminLogin.token);
      logIssue('Warranty Workflow', 'Allows claim on Voided warranty', 'Claim submitted on a voided warranty', 'Prevent claims on voided warranties');
    } catch (err) {
      console.log('Claim on voided warranty properly blocked:', err.message);
    }
  }

  console.log('\n--- 5. Testing Customer Purchases & Deactivation ---');
  const custs = LocalApi.handle('GET', '/customers', null, adminLogin.token);
  const activeCust = custs.find(c => c.status === 'Active');
  if (activeCust) {
    LocalApi.handle('DELETE', '/customers/' + activeCust.id, null, adminLogin.token);
    const afterDel = LocalApi.handle('GET', '/customers', null, adminLogin.token);
    const checkCust = afterDel.find(c => c.id === activeCust.id);
    assert.strictEqual(checkCust.status, 'Inactive', 'Customer should be marked Inactive');
    console.log('Customer soft-deactivated successfully:', activeCust.id);

    LocalApi.handle('POST', '/customers/' + activeCust.id + '/reactivate', null, adminLogin.token);
    const afterRe = LocalApi.handle('GET', '/customers', null, adminLogin.token);
    const checkCust2 = afterRe.find(c => c.id === activeCust.id);
    assert.strictEqual(checkCust2.status, 'Active', 'Customer should be reactivated');
    console.log('Customer reactivated successfully:', activeCust.id);
  }

  console.log('\n--- 6. Testing Shift Management ---');
  const staffShifts = LocalApi.handle('GET', '/users/shifts/mine', null, staffLogin.token);
  console.log('Staff shifts count:', staffShifts.length);
  const activeShift = staffShifts.find(s => !s.clockOut);
  if (!activeShift) {
    const clockedIn = LocalApi.handle('POST', '/users/shifts/clock-in', {}, staffLogin.token);
    console.log('Shift clocked in:', clockedIn.id);
    const clockedOut = LocalApi.handle('POST', '/users/shifts/clock-out', {}, staffLogin.token);
    console.log('Shift clocked out:', clockedOut.id);
  }

  console.log('\n--- 7. Testing Sales Voiding & Audit Trail ---');
  const sales = LocalApi.handle('GET', '/sales', null, adminLogin.token);
  const activeSale = sales.find(s => s.status === 'Completed');
  if (activeSale) {
    const voidRes = LocalApi.handle('POST', '/sales/' + activeSale.id + '/void', {
      reason: 'Customer returned items with receipt within 24 hours'
    }, adminLogin.token);
    assert.strictEqual(voidRes.sale.status, 'Voided', 'Sale should be Voided');
    console.log('Sale voided successfully:', activeSale.id);

    // Can staff void a sale?
    try {
      LocalApi.handle('POST', '/sales/' + activeSale.id + '/void', {
        reason: 'Staff void attempt'
      }, staffLogin.token);
      logIssue('Security & Permissions', 'Staff can void sales', 'Staff user was able to void a sale', 'Voiding must be restricted to Admin');
    } catch (err) {
      console.log('Staff void properly blocked (403):', err.status);
    }
  }

  console.log('\n--- 8. Testing User Management & Permissions ---');
  try {
    LocalApi.handle('POST', '/users', {
      username: 'newcashier',
      name: 'New Cashier',
      role: 'Staff',
      password: 'Password123!'
    }, staffLogin.token);
    logIssue('Security & Permissions', 'Staff can create users', 'Staff was able to call POST /users', 'POST /users must be Admin-only');
  } catch (err) {
    console.log('Staff user creation properly blocked:', err.status);
  }

  console.log('\n=== END OF BEHAVIORAL TESTING ===');
  console.log('Issues detected:', issues.length);
  if (issues.length) {
    console.log(JSON.stringify(issues, null, 2));
  }
}

run().catch(console.error);
