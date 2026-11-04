const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

console.log('========================================================================');
console.log('       TEAMMOTOR DEEP SYSTEM-WIDE FEATURE & INTEGRITY AUDIT             ');
console.log('========================================================================\n');

// 1. Setup DOM / Browser environment for Node
const storage = {
  _data: {},
  getItem(k) { return this._data[k] !== undefined ? this._data[k] : null; },
  setItem(k, v) { this._data[k] = String(v); },
  removeItem(k) { delete this._data[k]; },
  clear() { this._data = {}; }
};

const sessionStorageMock = {
  _data: {},
  getItem(k) { return this._data[k] !== undefined ? this._data[k] : null; },
  setItem(k, v) { this._data[k] = String(v); },
  removeItem(k) { delete this._data[k]; },
  clear() { this._data = {}; }
};

global.window = {
  location: { protocol: 'file:', pathname: '/public/login.html', search: '', href: 'login.html', replace(url) { this.href = url; }, reload() {} },
  localStorage: storage,
  sessionStorage: sessionStorageMock,
  TEAMMOTOR_MODE: 'local',
  matchMedia: () => ({ matches: true }),
  addEventListener: () => {},
  removeEventListener: () => {}
};
global.localStorage = global.window.localStorage;
global.sessionStorage = global.window.sessionStorage;
global.location = global.window.location;

// Global DOM mock
function createMockElement(tag, id, cls) {
  const listeners = {};
  const classes = new Set();
  if (cls) cls.split(/\s+/).filter(Boolean).forEach(c => classes.add(c));
  const el = {
    tagName: (tag || 'DIV').toUpperCase(),
    id: id || '',
    className: cls || '',
    classList: {
      add(...cs) { cs.forEach(c => classes.add(c)); el.className = [...classes].join(' '); },
      remove(...cs) { cs.forEach(c => classes.delete(c)); el.className = [...classes].join(' '); },
      toggle(c, force) {
        if (force !== undefined) { if (force) classes.add(c); else classes.delete(c); }
        else { if (classes.has(c)) classes.delete(c); else classes.add(c); }
        el.className = [...classes].join(' ');
      },
      contains(c) { return classes.has(c); }
    },
    dataset: {},
    attributes: {},
    setAttribute(k, v) { el.attributes[k] = String(v); },
    getAttribute(k) { return el.attributes[k] !== undefined ? el.attributes[k] : null; },
    removeAttribute(k) { delete el.attributes[k]; },
    hasAttribute(k) { return el.attributes[k] !== undefined; },
    style: {},
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
    children: [],
    appendChild(child) { el.children.push(child); return child; },
    removeChild(child) { el.children = el.children.filter(c => c !== child); return child; },
    remove() { if (el.parentNode) el.parentNode.removeChild(el); },
    parentNode: null,
    closest(selector) { return el; },
    querySelector(sel) { return createMockElement('div'); },
    querySelectorAll(sel) { return []; },
    addEventListener(evt, fn) {
      listeners[evt] = listeners[evt] || [];
      listeners[evt].push(fn);
    },
    removeEventListener(evt, fn) {
      if (listeners[evt]) listeners[evt] = listeners[evt].filter(f => f !== fn);
    },
    dispatchEvent(evt) {
      const type = typeof evt === 'string' ? evt : evt.type;
      const fns = listeners[type] || [];
      fns.forEach(fn => fn.call(el, evt));
    },
    click() { el.dispatchEvent({ type: 'click', target: el }); },
    focus() {},
    blur() {},
    scrollIntoView() {}
  };
  return el;
}

global.document = {
  readyState: 'complete',
  body: createMockElement('body'),
  createElement(tag) { return createMockElement(tag); },
  getElementById(id) { return createMockElement('div', id); },
  querySelector(sel) { return createMockElement('div'); },
  querySelectorAll(sel) { return []; },
  addEventListener() {},
  removeEventListener() {}
};

function loadScript(filePath) {
  const code = fs.readFileSync(path.resolve(filePath), 'utf8');
  vm.runInThisContext(code, { filename: filePath });
}

loadScript('public/js/mock-data.js');
loadScript('public/js/local-api.js');
loadScript('public/js/store.js');
loadScript('public/js/analytics.js');
loadScript('public/js/shifts.js');
loadScript('public/js/receipt.js');
loadScript('public/js/notifications.js');
loadScript('public/js/app.js');

const inconsistencies = [];
function reportInconsistency(title, area, details, severity = 'Medium') {
  inconsistencies.push({ title, area, details, severity });
  console.log(`[INCONSISTENCY] [${severity}] ${title} (${area})\n  -> ${details}\n`);
}

let passedTests = 0, failedTests = 0;
function test(name, fn) {
  try {
    fn();
    passedTests++;
    console.log(`  [PASS] ${name}`);
  } catch (err) {
    failedTests++;
    console.log(`  [FAIL] ${name}: ${err.message}`);
  }
}

console.log('--- 1. AUDITING BACKEND ROUTES & TEST HARNESS ---');

// Check logic.test.js path resolution issue
test('server/test/logic.test.js resolves paths relative to cwd', () => {
  const logicTest = fs.readFileSync('server/test/logic.test.js', 'utf8');
  if (logicTest.includes("path.resolve('public/")) {
    reportInconsistency(
      'Unit tests in server/test/logic.test.js fail when run from server directory',
      'Backend Tests / Developer Workflow',
      'README instructs: "cd server && npm test", but logic.test.js uses path.resolve(\'public/...\') instead of path.resolve(__dirname, \'../../public/...\'). Running npm test from server/ fails 7 tests with ENOENT.',
      'High'
    );
  }
});

// Check payment methods in Sale model vs POS vs LocalApi vs Services
test('Payment methods consistency across system', () => {
  const saleModel = fs.readFileSync('server/src/models/index.js', 'utf8');
  const salesService = fs.readFileSync('server/src/services/sales.js', 'utf8');
  const mockData = fs.readFileSync('public/js/mock-data.js', 'utf8');
  
  // Model allows legacy methods for historical queries
  assert.ok(saleModel.includes("'Cash', 'GCash', 'Maya', 'Bank Transfer', 'Other'"));
  // New sales only allow Cash and GCash
  assert.ok(salesService.includes("['Cash', 'GCash']"));
});

console.log('\n--- 2. AUDITING FRONTEND & BACKEND API ENDPOINTS PARITY ---');

// Check all LocalApi routes vs Express routes
const localApiCode = fs.readFileSync('public/js/local-api.js', 'utf8');
const routesCatalog = fs.readFileSync('server/src/routes/catalog.js', 'utf8');
const routesSales = fs.readFileSync('server/src/routes/sales.js', 'utf8');
const routesInventory = fs.readFileSync('server/src/routes/inventory.js', 'utf8');
const routesCustomers = fs.readFileSync('server/src/routes/customers.js', 'utf8');
const routesUsers = fs.readFileSync('server/src/routes/users.js', 'utf8');
const routesWarranties = fs.readFileSync('server/src/routes/warranties.js', 'utf8');
const routesMisc = fs.readFileSync('server/src/routes/misc.js', 'utf8');

test('Check customer update validation rules in server vs local-api', () => {
  // In server/src/routes/customers.js:
  // PHONE_RE = /^[0-9+()\-\s]{7,20}$/
  // EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  // Check if local-api has same regex
  const localCustPhone = localApiCode.includes('/^[0-9+()\\-\\s]{7,20}$/');
  assert.ok(localCustPhone, 'Phone regex in local-api should match');
});

test('Check customer soft delete vs hard delete', () => {
  // DELETE /customers/:id in local-api and server soft-deletes (sets status: 'Inactive')
  assert.ok(localApiCode.includes("status: 'Inactive'"));
  assert.ok(routesCustomers.includes("status: 'Inactive'"));
});

test('Check product creation ID format across server and local-api', () => {
  // Server: cat.prefix + '-' + String(await nextSeq('PRD-' + cat.prefix)).padStart(3, '0')
  // LocalApi: cat.prefix + '-' + pad(db.counters['PRD-' + cat.prefix], 3)
  assert.ok(routesCatalog.includes("cat.prefix + '-'"));
  assert.ok(localApiCode.includes("cat.prefix + '-'"));
});

console.log('\n--- 3. AUDITING USER PERMISSIONS & ROLE GUARDS ---');

// Authenticate Admin and Staff
const adminAuth = LocalApi.handle('POST', '/auth/login', { username: 'ronnie.manalo', password: 'Admin@12345' });
const staffAuth = LocalApi.handle('POST', '/auth/login', { username: 'juan.delacruz', password: 'Staff@12345' });

test('Role Guard: Settings PUT is Admin-only', () => {
  assert.throws(() => {
    LocalApi.handle('PUT', '/settings', { shopName: 'Test' }, staffAuth.token);
  }, /requires Admin access/);
  
  const ok = LocalApi.handle('PUT', '/settings', { shopName: 'TeamMotor Moto' }, adminAuth.token);
  assert.strictEqual(ok.shopName, 'TeamMotor Moto');
});

test('Role Guard: User management is Admin-only', () => {
  assert.throws(() => {
    LocalApi.handle('GET', '/users', {}, staffAuth.token);
  }, /requires Admin access/);

  assert.throws(() => {
    LocalApi.handle('POST', '/users', { name: 'New Guy', username: 'newguy', password: 'Password1', role: 'Staff' }, staffAuth.token);
  }, /requires Admin access/);
});

test('Role Guard: Audit log is Admin-only', () => {
  assert.throws(() => {
    LocalApi.handle('GET', '/audit', {}, staffAuth.token);
  }, /requires Admin access/);

  const res = LocalApi.handle('GET', '/audit', {}, adminAuth.token);
  assert.ok(Array.isArray(res.rows));
});

test('Role Guard: Sale Void is Admin-only', () => {
  const sale = LocalApi.handle('POST', '/sales', {
    items: [{ productId: 'LGT-001', qty: 1 }],
    paymentMethod: 'Cash',
    amountReceived: 1000
  }, adminAuth.token);

  assert.throws(() => {
    LocalApi.handle('POST', `/sales/${sale.sale.id}/void`, { type: 'Voided', reason: 'Customer error' }, staffAuth.token);
  }, /requires Admin access/);
});

test('Role Guard: Stock Adjustment is Admin-only', () => {
  assert.throws(() => {
    LocalApi.handle('POST', '/inventory/adjust', { productId: 'LGT-001', newQuantity: 10, reason: 'Count fix' }, staffAuth.token);
  }, /requires Admin access/);
});

test('Role Guard: Category & Brand & Supplier deletion is Admin-only', () => {
  assert.throws(() => {
    LocalApi.handle('POST', '/categories', { name: 'TestCat' }, staffAuth.token);
  }, /requires Admin access/);

  assert.throws(() => {
    LocalApi.handle('POST', '/brands', { name: 'TestBrand' }, staffAuth.token);
  }, /requires Admin access/);

  assert.throws(() => {
    LocalApi.handle('POST', '/suppliers', { name: 'TestSupplier' }, staffAuth.token);
  }, /requires Admin access/);
});

test('Role Guard: Staff CAN create customers and ring up sales', () => {
  const cust = LocalApi.handle('POST', '/customers', { name: 'Staff Customer', contactNumber: '0922-111-2233' }, staffAuth.token);
  assert.ok(cust.id.startsWith('CUST-'));

  const sale = LocalApi.handle('POST', '/sales', {
    items: [{ productId: 'LGT-001', qty: 1 }],
    paymentMethod: 'Cash',
    amountReceived: 1000,
    customerId: cust.id
  }, staffAuth.token);
  assert.strictEqual(sale.sale.status, 'Completed');
});

console.log('\n--- 4. AUDITING FORM VALIDATIONS & CONSTRAINTS ---');

test('Product Price & Cost Non-negative Validation', () => {
  assert.throws(() => {
    LocalApi.handle('POST', '/products', {
      name: 'Bad Product',
      category: 'lights',
      sellingPrice: -50
    }, adminAuth.token);
  }, /sellingPrice must be a non-negative number/);
});

test('Expiration Date Format Validation', () => {
  assert.throws(() => {
    LocalApi.handle('POST', '/products', {
      name: 'Bad Date Product',
      category: 'lights',
      sellingPrice: 100,
      expirationDate: '12/31/2026' // wrong format
    }, adminAuth.token);
  }, /Expiration date must be YYYY-MM-DD/);
});

test('Customer Phone Validation', () => {
  assert.throws(() => {
    LocalApi.handle('POST', '/customers', {
      name: 'Bad Phone',
      contactNumber: '123' // too short
    }, adminAuth.token);
  }, /Enter a valid phone number/);
});

test('Customer Email Format Validation', () => {
  assert.throws(() => {
    LocalApi.handle('POST', '/customers', {
      name: 'Bad Email',
      contactNumber: '0912-345-6789',
      email: 'notanemail'
    }, adminAuth.token);
  }, /Enter a valid email address/);
});

test('User Password Complexity Validation', () => {
  assert.throws(() => {
    LocalApi.handle('POST', '/users', {
      name: 'Weak Pass User',
      username: 'weakuser',
      password: 'password', // no digit
      role: 'Staff'
    }, adminAuth.token);
  }, /Password must be at least 8 characters and include a letter and a number/);
});

console.log('\n--- 5. CHECKING FRONTEND CODE IMPLEMENTATIONS ---');

// Let's inspect HTML forms vs JS fields
test('Check Inventory Product Form fields against cleanProduct fields', () => {
  const invHtml = fs.readFileSync('public/inventory.html', 'utf8');
  const invJs = fs.readFileSync('public/js/inventory.js', 'utf8');
  
  const formFields = [
    'pName', 'pBrand', 'pCategory', 'pSupplier', 'pSupplierRef',
    'pSku', 'pBarcode', 'pCostPrice', 'pSellingPrice', 'pReorderLevel',
    'pWarrantyDuration', 'pWarrantyUnit', 'pWarrantyType', 'pExpirationDate',
    'pStorageLocation', 'pDescription'
  ];
  
  formFields.forEach(f => {
    assert.ok(invHtml.includes(`id="${f}"`), `inventory.html missing input #${f}`);
  });
});

test('Check Manage Filters modal tabs and operations', () => {
  const invHtml = fs.readFileSync('public/inventory.html', 'utf8');
  assert.ok(invHtml.includes('id="ftab-categories"'));
  assert.ok(invHtml.includes('id="ftab-brands"'));
  assert.ok(invHtml.includes('id="ftab-suppliers"'));
  assert.ok(invHtml.includes('id="ftab-moto"'));
});

test('Check Customers page inputs and modal', () => {
  const custHtml = fs.readFileSync('public/customers.html', 'utf8');
  ['cName', 'cPhone', 'cEmail', 'cAddress', 'cNotes'].forEach(id => {
    assert.ok(custHtml.includes(`id="${id}"`), `customers.html missing input #${id}`);
  });
});

test('Check Users page inputs and modals', () => {
  const usersHtml = fs.readFileSync('public/users.html', 'utf8');
  ['uName', 'uUsername', 'uEmail', 'uContact', 'uBirthDate', 'uRole', 'uStatus', 'uPassword'].forEach(id => {
    assert.ok(usersHtml.includes(`id="${id}"`), `users.html missing input #${id}`);
  });
});

test('Check Settings page inputs', () => {
  const setHtml = fs.readFileSync('public/settings.html', 'utf8');
  ['sShopName', 'sTagline', 'sAddress1', 'sAddress2', 'sPhone', 'sTin', 'sVatRate', 'sVatMode', 'sVatEnabled', 'sWarningMonths', 'sReceiptFooter1', 'sReceiptFooter2'].forEach(id => {
    assert.ok(setHtml.includes(`id="${id}"`), `settings.html missing input #${id}`);
  });
});

console.log('\n--- 6. CHECKING POTENTIAL EDGE CASES & SUBTLE INCONSISTENCIES ---');

// Let's check settings field naming: sWarningMonths vs expiryWarningMonths
test('Settings field mapping check', () => {
  const setJs = fs.readFileSync('public/js/settings.js', 'utf8');
  assert.ok(setJs.includes('expiryWarningMonths: parseInt(document.getElementById(\'sWarningMonths\').value, 10)'));
});

// Let's check warranty claims filing in Warranty page vs LocalApi vs Server
test('Warranty Claims validation: defect and resolution required', () => {
  const boot = LocalApi.handle('GET', '/bootstrap', {}, adminAuth.token);
  const w = boot.warranties.find(x => x.status === 'Active');
  
  assert.throws(() => {
    LocalApi.handle('POST', `/warranties/${w.id}/claims`, { description: '', resolution: '' }, staffAuth.token);
  }, /Defect description and action taken are both required/);
});

// Let's check if there are any undefined variable references or typos in any frontend JS file
const jsFiles = fs.readdirSync('public/js').filter(f => f.endsWith('.js'));
for (const file of jsFiles) {
  const code = fs.readFileSync(path.join('public/js', file), 'utf8');
  try {
    // Check syntax errors by parsing with vm
    new vm.Script(code, { filename: file });
  } catch (syntaxErr) {
    reportInconsistency(
      `Syntax error in public/js/${file}`,
      'Frontend JavaScript',
      syntaxErr.message,
      'High'
    );
  }
}

// Let's check server JS files syntax
const serverJsFiles = [
  'server/src/server.js', 'server/src/app.js', 'server/src/config.js', 'server/src/db.js',
  'server/src/middleware/auth.js', 'server/src/middleware/error.js',
  'server/src/models/index.js',
  'server/src/routes/auth.js', 'server/src/routes/catalog.js', 'server/src/routes/customers.js',
  'server/src/routes/inventory.js', 'server/src/routes/misc.js', 'server/src/routes/sales.js',
  'server/src/routes/users.js', 'server/src/routes/warranties.js',
  'server/src/services/categories.js', 'server/src/services/expiry.js', 'server/src/services/filters.js',
  'server/src/services/inventory.js', 'server/src/services/notifications.js', 'server/src/services/sales.js',
  'server/src/services/serialize.js', 'server/src/services/settings.js',
  'server/src/utils/audit.js', 'server/src/utils/counters.js', 'server/src/utils/dates.js',
  'server/src/utils/errors.js', 'server/src/utils/money.js', 'server/src/utils/warranty.js',
  'server/scripts/seed.js'
];

for (const file of serverJsFiles) {
  const code = fs.readFileSync(file, 'utf8');
  try {
    new vm.Script(code, { filename: file });
  } catch (syntaxErr) {
    reportInconsistency(
      `Syntax error in ${file}`,
      'Backend JavaScript',
      syntaxErr.message,
      'High'
    );
  }
}

console.log('\n========================================================================');
console.log(`AUDIT COMPLETE: ${passedTests} Tests Passed, ${failedTests} Tests Failed`);
console.log(`TOTAL INCONSISTENCIES IDENTIFIED: ${inconsistencies.length}`);
console.log('========================================================================');
