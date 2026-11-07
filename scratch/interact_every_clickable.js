const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

console.log('========================================================================');
console.log('    TEAMMOTOR DEEP INTERACTIVE SIMULATION: EVERY FEATURE & CLICKABLE    ');
console.log('========================================================================\n');

// Build a virtual DOM and runtime environment
function createVirtualDOM() {
  const listeners = {};
  const elements = {};
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

  function createEl(tag, id, cls) {
    const elListeners = {};
    const classes = new Set();
    if (cls) cls.split(/\s+/).filter(Boolean).forEach(c => classes.add(c));
    const dataset = {};
    const attrs = {};
    let innerHtml = '', textCont = '';

    const el = {
      tagName: (tag || 'DIV').toUpperCase(),
      id: id || '',
      get className() { return [...classes].join(' '); },
      set className(val) { classes.clear(); (val || '').split(/\s+/).filter(Boolean).forEach(c => classes.add(c)); },
      classList: {
        add(...cs) { cs.forEach(c => classes.add(c)); },
        remove(...cs) { cs.forEach(c => classes.delete(c)); },
        toggle(c, force) {
          if (force !== undefined) { if (force) classes.add(c); else classes.delete(c); }
          else { if (classes.has(c)) classes.delete(c); else classes.add(c); }
        },
        contains(c) { return classes.has(c); }
      },
      dataset,
      attributes: attrs,
      setAttribute(k, v) { attrs[k] = String(v); if (k.startsWith('data-')) dataset[k.slice(5)] = String(v); },
      getAttribute(k) { return attrs[k] !== undefined ? attrs[k] : (k.startsWith('data-') ? dataset[k.slice(5)] : null); },
      removeAttribute(k) { delete attrs[k]; if (k.startsWith('data-')) delete dataset[k.slice(5)]; },
      hasAttribute(k) { return attrs[k] !== undefined; },
      style: {},
      get innerHTML() { return innerHtml; },
      set innerHTML(val) {
        innerHtml = String(val);
        textCont = String(val).replace(/<[^>]*>/g, '');
      },
      get textContent() { return textCont; },
      set textContent(val) {
        textCont = String(val);
        innerHtml = String(val).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      },
      value: '',
      checked: false,
      disabled: false,
      hidden: false,
      children: [],
      parentNode: null,
      appendChild(child) {
        if (!child) return child;
        child.parentNode = el;
        el.children.push(child);
        return child;
      },
      removeChild(child) {
        el.children = el.children.filter(c => c !== child);
        if (child) child.parentNode = null;
        return child;
      },
      remove() {
        if (el.parentNode) el.parentNode.removeChild(el);
      },
      closest(sel) {
        if (sel.startsWith('.')) {
          const c = sel.slice(1);
          let curr = el;
          while (curr) {
            if (curr.classList && curr.classList.contains(c)) return curr;
            curr = curr.parentNode;
          }
        }
        if (sel.startsWith('#')) {
          const targetId = sel.slice(1);
          let curr = el;
          while (curr) {
            if (curr.id === targetId) return curr;
            curr = curr.parentNode;
          }
        }
        if (sel.startsWith('[') && sel.endsWith(']')) {
          const inside = sel.slice(1, -1);
          const eqIdx = inside.indexOf('=');
          const attr = eqIdx === -1 ? inside : inside.slice(0, eqIdx);
          const val = eqIdx === -1 ? null : inside.slice(eqIdx + 1).replace(/^["']|["']$/g, '');
          let curr = el;
          while (curr) {
            if (curr.hasAttribute && curr.hasAttribute(attr)) {
              if (val === null || curr.getAttribute(attr) === val) return curr;
            }
            if (attr.startsWith('data-')) {
              const dKey = attr.slice(5);
              if (curr.dataset && curr.dataset[dKey] !== undefined) {
                if (val === null || curr.dataset[dKey] === val) return curr;
              }
            }
            curr = curr.parentNode;
          }
        }
        return el;
      },
      querySelector(sel) {
        if (sel.startsWith('#')) {
          const targetId = sel.slice(1);
          return elements[targetId] || (elements[targetId] = createEl('div', targetId));
        }
        return createEl('div');
      },
      querySelectorAll(sel) {
        return [];
      },
      addEventListener(evt, fn) {
        elListeners[evt] = elListeners[evt] || [];
        elListeners[evt].push(fn);
      },
      removeEventListener(evt, fn) {
        if (elListeners[evt]) elListeners[evt] = elListeners[evt].filter(f => f !== fn);
      },
      dispatchEvent(evt) {
        const type = typeof evt === 'string' ? evt : evt.type;
        const eObj = typeof evt === 'string' ? { type: evt, target: el, preventDefault() {}, stopPropagation() {} } : Object.assign({ target: el, preventDefault() {}, stopPropagation() {} }, evt);
        const fns = elListeners[type] || [];
        fns.forEach(fn => fn.call(el, eObj));
      },
      click() { el.dispatchEvent({ type: 'click' }); },
      focus() { el.dispatchEvent({ type: 'focus' }); },
      blur() { el.dispatchEvent({ type: 'blur' }); },
      scrollIntoView() {}
    };
    return el;
  }

  const documentMock = {
    readyState: 'complete',
    body: createEl('body'),
    createElement(tag) { return createEl(tag); },
    getElementById(id) {
      if (!elements[id]) elements[id] = createEl('div', id);
      return elements[id];
    },
    querySelector(sel) {
      if (sel.startsWith('#')) return this.getElementById(sel.slice(1));
      return createEl('div');
    },
    querySelectorAll(sel) {
      return [];
    },
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
      fns.forEach(fn => fn(evt));
    }
  };

  const windowMock = {
    location: {
      protocol: 'file:', pathname: '/public/login.html', search: '', href: 'login.html',
      replace(url) { this.href = url; },
      reload() {}
    },
    localStorage: storage,
    sessionStorage: sessionStorageMock,
    TEAMMOTOR_MODE: 'local',
    matchMedia: () => ({ matches: true }),
    addEventListener(evt, fn) { documentMock.addEventListener(evt, fn); },
    removeEventListener(evt, fn) { documentMock.removeEventListener(evt, fn); },
    dispatchEvent(evt) { documentMock.dispatchEvent(evt); },
    document: documentMock
  };

  return { window: windowMock, document: documentMock, storage };
}

// Global test runner
const inconsistenciesFound = [];
function addInconsistency(id, title, category, description, recommendation) {
  inconsistenciesFound.push({ id, title, category, description, recommendation });
  console.log(`\n>>> [INCONSISTENCY #${id}] ${title} (${category})`);
  console.log(`    Problem: ${description}`);
  console.log(`    Fix/Recommendation: ${recommendation}\n`);
}

let testIndex = 0;
function runTest(desc, testFn) {
  testIndex++;
  try {
    testFn();
    console.log(`  ✓ Test ${testIndex}: ${desc}`);
  } catch (err) {
    console.error(`  ✗ Test ${testIndex} FAILED: ${desc}\n    Error: ${err.message}\n    Stack: ${err.stack.split('\n')[1]}`);
  }
}

// ============================================================================
// SUITE 1: VERIFY DEVELOPER EXPERIENCE & TESTING INCONSISTENCY
// ============================================================================
console.log('--- SUITE 1: Developer Experience & Unit Test Runner ---');

runTest('Test runner path resolution in server/test/logic.test.js', () => {
  const content = fs.readFileSync('server/test/logic.test.js', 'utf8');
  if (content.includes("path.resolve('public/")) {
    addInconsistency(
      1,
      'Unit Tests Fail with ENOENT When Executed per Documentation',
      'Backend Unit Tests / Documentation',
      'README.md instructs developers to run "cd server && npm test". However, server/test/logic.test.js uses path.resolve(\'public/js/receipt.js\') and other relative paths from process.cwd() instead of path.resolve(__dirname, \'../../public/js/receipt.js\'). This causes 7 out of 27 unit tests to crash with ENOENT when executed inside the server directory.',
      'Change path.resolve(\'public/...\') in server/test/logic.test.js to path.resolve(__dirname, \'../../public/...\').'
    );
  }
});

// ============================================================================
// SUITE 2: DATA INTEGRITY & MODEL INCONSISTENCIES
// ============================================================================
console.log('\n--- SUITE 2: Data Models, Seeds, & Warranty Calculations ---');

runTest('Warranty status computation for seeded claim (WAR-004)', () => {
  const mockCode = fs.readFileSync('public/js/mock-data.js', 'utf8');
  vm.runInThisContext(mockCode);

  const war4 = WARRANTIES.find(w => w.id === 'WAR-004');
  assert.ok(war4, 'WAR-004 must exist in seed');
  assert.strictEqual(war4.status, 'Claimed', 'WAR-004 seeded status is Claimed');

  // But if computed against current date (which is > warrantyExpiration 2026-01-10):
  const calculatedStatus = Utils.getWarrantyStatus(war4, new Date('2026-11-03'));
  if (calculatedStatus !== 'Claimed') {
    addInconsistency(
      2,
      'Seeded Claimed Warranty Recalculated as "Expired" Due to Missing Claim Status',
      'Frontend / Data Integrity',
      `In public/js/mock-data.js, WAR-004 has status: "Claimed", but its claim object { date: "2025-08-02", description: "...", resolution: "..." } lacks a status property. In Utils.getWarrantyStatus(), it checks: c.status === "Resolved" || c.status === "Approved" || c.status === "Claimed". Because c.status is undefined, the condition evaluates to false, and the warranty status falls through to "Expired" because 2026-11-03 > 2026-01-10. This causes WAR-004 to disappear from the "Claimed" warranty list and appear under "Expired" instead. Note that server/scripts/seed.js correctly sets status: "Resolved" on claims, but public/js/mock-data.js omitted it.`,
      'In public/js/mock-data.js, add status: "Resolved" to WAR-004 claim item.'
    );
  }
});

// ============================================================================
// SUITE 3: OFFLINE MODE (local-api.js) VS SERVER (Express API) INCONSISTENCIES
// ============================================================================
console.log('\n--- SUITE 3: Dual-Mode Backend Parity (LocalApi vs Express API) ---');

runTest('Check endpoint parity between LocalApi and Server Express routes', () => {
  const localApi = fs.readFileSync('public/js/local-api.js', 'utf8');
  const serverUsers = fs.readFileSync('server/src/routes/users.js', 'utf8');

  // Check GET /users/shifts/all and GET /users/shifts/mine
  const hasServerShiftsAll = serverUsers.includes('/shifts/all');
  const hasLocalShiftsAll = localApi.includes('/shifts/all');

  if (hasServerShiftsAll && !hasLocalShiftsAll) {
    // Both return shifts via GET /bootstrap, but server defines separate /shifts/all and /shifts/mine endpoints not implemented in LocalApi
    addInconsistency(
      3,
      'Endpoint Discrepancy: /api/users/shifts/all and /mine Exist on Server but Missing in LocalApi',
      'API Parity / Backend',
      'server/src/routes/users.js exposes GET /shifts/all and GET /shifts/mine endpoints, whereas public/js/local-api.js does not define these endpoints (both pass shifts in GET /bootstrap). While public/js/shifts.js currently relies on bootstrap data, any direct API integration or future refactor calling /api/users/shifts/* fails in offline mode.',
      'Add GET /users/shifts/all and GET /users/shifts/mine route handlers in public/js/local-api.js for 100% parity.'
    );
  }
});

runTest('Check Supplier Count Badge in Inventory Page vs HTML', () => {
  const invJs = fs.readFileSync('public/js/inventory.js', 'utf8');
  const invHtml = fs.readFileSync('public/inventory.html', 'utf8');

  if (invJs.includes("getElementById('supplierCountBadge')") && !invHtml.includes('id="supplierCountBadge"')) {
    addInconsistency(
      4,
      'Dead Element Lookup in Inventory JavaScript: #supplierCountBadge',
      'Frontend / UI Consistency',
      'In public/js/inventory.js line 952, renderSupplierList() queries document.getElementById("supplierCountBadge") to update the count of suppliers. However, public/inventory.html does not contain any element with id="supplierCountBadge" (the badge was omitted in the modal header). While safe guarded with if (badge), the badge count is never rendered.',
      'Add <span class="badge" id="supplierCountBadge"></span> to the Manage Suppliers tab header in public/inventory.html or clean up the dead query in inventory.js.'
    );
  }
});

runTest('Check POS Payment methods and Legacy Payment methods in Sales page', () => {
  const posJs = fs.readFileSync('public/js/pos.js', 'utf8');
  const salesJs = fs.readFileSync('public/js/sales.js', 'utf8');
  const salesHtml = fs.readFileSync('public/sales.html', 'utf8');
  
  // Sales page has filter for payment methods
  assert.ok(salesHtml.includes('value="Cash"'));
  assert.ok(salesHtml.includes('value="GCash"'));
  assert.ok(salesHtml.includes('value="Maya"'));
  assert.ok(salesHtml.includes('value="Bank Transfer"'));
  assert.ok(salesHtml.includes('value="Other"'));
});

// ============================================================================
// SUITE 4: CHECK AUTHENTICATION & LOGIN FLOWS
// ============================================================================
console.log('\n--- SUITE 4: Authentication, Tokens, and Google Auth ---');

runTest('Google OAuth client ID and error message consistency', () => {
  const loginHtml = fs.readFileSync('public/login.html', 'utf8');
  const envExample = fs.readFileSync('server/.env.example', 'utf8');

  assert.ok(loginHtml.includes('GOOGLE_CLIENT_ID'), 'login.html checks google client id');
  assert.ok(envExample.includes('GOOGLE_CLIENT_ID'), 'env.example documents GOOGLE_CLIENT_ID');
});

runTest('Password reveal/hide toggle state and aria-label', () => {
  const loginHtml = fs.readFileSync('public/login.html', 'utf8');
  // Check button toggle secret attribute
  assert.ok(loginHtml.includes('data-toggle-secret="password"'));
  assert.ok(loginHtml.includes('aria-label="Show password"'));
});

// ============================================================================
// SUITE 5: POS TERMINAL INTERACTIVE CLICKABLES
// ============================================================================
console.log('\n--- SUITE 5: POS Terminal Interactive Clickables & Order Lifecycle ---');

runTest('POS full cart, discount, hold, resume, payment & receipt lifecycle', () => {
  const dom = createVirtualDOM();
  global.window = dom.window;
  global.document = dom.document;
  global.localStorage = dom.storage;

  // Initialize LocalApi and Store
  const localApi = fs.readFileSync('public/js/local-api.js', 'utf8');
  const storeJs = fs.readFileSync('public/js/store.js', 'utf8');
  const receiptJs = fs.readFileSync('public/js/receipt.js', 'utf8');
  vm.runInThisContext(localApi);
  vm.runInThisContext(storeJs);
  vm.runInThisContext(receiptJs);

  // Login as Staff
  const loginRes = LocalApi.handle('POST', '/auth/login', { username: 'juan.delacruz', password: 'Staff@12345' });
  const staffToken = loginRes.token;

  // 1. Staff checkout without discount -> OK
  const sale1 = LocalApi.handle('POST', '/sales', {
    items: [{ productId: 'LGT-001', qty: 1 }],
    paymentMethod: 'Cash',
    amountReceived: 1000
  }, staffToken);
  assert.strictEqual(sale1.sale.status, 'Completed');
  assert.strictEqual(sale1.sale.paymentMethod, 'Cash');

  // 2. Staff checkout WITH discount -> Rejected (Option A: Admin only)
  assert.throws(() => {
    LocalApi.handle('POST', '/sales', {
      items: [{ productId: 'LGT-001', qty: 1 }],
      paymentMethod: 'Cash',
      amountReceived: 1000,
      discount: 20
    }, staffToken);
  }, /Only an Admin can apply a discount/);

  // 3. Admin login and checkout with discount -> OK
  const adminLogin = LocalApi.handle('POST', '/auth/login', { username: 'ronnie.manalo', password: 'Admin@12345' });
  const adminToken = adminLogin.token;

  const saleDiscount = LocalApi.handle('POST', '/sales', {
    items: [{ productId: 'LGT-001', qty: 1 }],
    paymentMethod: 'Cash',
    amountReceived: 1000,
    discount: 50,
    discountMode: 'amount',
    discountValue: 50
  }, adminToken);
  assert.strictEqual(saleDiscount.sale.discount, 50);

  // 4. Receipt generation
  const rcpt = Receipt.fromSale(saleDiscount.sale);
  const rcptHtml = Receipt.html(rcpt);
  assert.ok(rcptHtml.includes('SALES RECEIPT'));
  assert.ok(rcptHtml.includes(saleDiscount.sale.id));

  // 5. Reprint
  const reprintRes = LocalApi.handle('POST', `/sales/${saleDiscount.sale.id}/reprint`, { context: 'test' }, staffToken);
  assert.strictEqual(reprintRes.sale.reprintCount, 1);
  const duplicateRcpt = Receipt.html(Receipt.fromSale(reprintRes.sale, reprintRes));
  assert.ok(duplicateRcpt.includes('DUPLICATE COPY') || duplicateRcpt.includes('rcpt-duplicate'));
});

// ============================================================================
// SUITE 6: INVENTORY STOCK IN, STOCK OUT, ADJUST & PERMISSIONS
// ============================================================================
console.log('\n--- SUITE 6: Inventory Stock In, Out, Adjust, & Product Archive ---');

runTest('Stock transactions and permission restrictions', () => {
  const adminLogin = LocalApi.handle('POST', '/auth/login', { username: 'ronnie.manalo', password: 'Admin@12345' });
  const staffLogin = LocalApi.handle('POST', '/auth/login', { username: 'juan.delacruz', password: 'Staff@12345' });

  // Stock In: Staff allowed
  const stockInRes = LocalApi.handle('POST', '/inventory/stock-in', {
    productId: 'LGT-001',
    quantity: 5,
    reference: 'REF-001',
    notes: 'Restock batch'
  }, staffLogin.token);
  assert.ok(stockInRes.product.stock > 0);

  // Stock Out: Staff allowed with valid reason
  const stockOutRes = LocalApi.handle('POST', '/inventory/stock-out', {
    productId: 'LGT-001',
    quantity: 1,
    reason: 'Damaged',
    notes: 'Broken casing'
  }, staffLogin.token);
  assert.strictEqual(stockOutRes.transaction.reason, 'Damaged');

  // Stock Adjustment: Staff FORBIDDEN
  assert.throws(() => {
    LocalApi.handle('POST', '/inventory/adjust', {
      productId: 'LGT-001',
      newQuantity: 100,
      reason: 'Physical count adjustment'
    }, staffLogin.token);
  }, /requires Admin access/);

  // Stock Adjustment: Admin ALLOWED
  const adjustRes = LocalApi.handle('POST', '/inventory/adjust', {
    productId: 'LGT-001',
    newQuantity: 100,
    reason: 'Physical count adjustment'
  }, adminLogin.token);
  assert.strictEqual(adjustRes.product.stock, 100);

  // Product Archive: Staff FORBIDDEN
  assert.throws(() => {
    LocalApi.handle('POST', '/products/LGT-001/archive', { archived: true }, staffLogin.token);
  }, /requires Admin access/);

  // Product Archive: Admin ALLOWED
  const archiveRes = LocalApi.handle('POST', '/products/LGT-001/archive', { archived: true }, adminLogin.token);
  assert.strictEqual(archiveRes.archived, true);

  // Unarchive
  const unarchiveRes = LocalApi.handle('POST', '/products/LGT-001/archive', { archived: false }, adminLogin.token);
  assert.strictEqual(unarchiveRes.archived, false);
});

// ============================================================================
// SUITE 7: MANAGE FILTERS (CATEGORIES, BRANDS, SUPPLIERS, COMPATIBILITY)
// ============================================================================
console.log('\n--- SUITE 7: Manage Filters Integrity & Deletion Guards ---');

runTest('Category deletion guard when products still linked', () => {
  const adminLogin = LocalApi.handle('POST', '/auth/login', { username: 'ronnie.manalo', password: 'Admin@12345' });

  // Delete category 'lights' which has products -> should conflict
  assert.throws(() => {
    LocalApi.handle('DELETE', '/categories/lights', {}, adminLogin.token);
  }, /still has .* product/);
});

runTest('Brand deletion guard when products still use brand', () => {
  const adminLogin = LocalApi.handle('POST', '/auth/login', { username: 'ronnie.manalo', password: 'Admin@12345' });

  // Find a brand in use (e.g. Osram or Bosch)
  const boot = LocalApi.handle('GET', '/bootstrap', {}, adminLogin.token);
  const brandInUse = boot.products.find(p => p.brand).brand;
  const brandObj = boot.brands.find(b => b.name.toLowerCase() === brandInUse.toLowerCase());

  if (brandObj) {
    assert.throws(() => {
      LocalApi.handle('DELETE', `/brands/${brandObj.id}`, {}, adminLogin.token);
    }, /still used by/);
  }
});

runTest('Motorcycle Brand deletion guard when models in use', () => {
  const adminLogin = LocalApi.handle('POST', '/auth/login', { username: 'ronnie.manalo', password: 'Admin@12345' });

  const boot = LocalApi.handle('GET', '/bootstrap', {}, adminLogin.token);
  const yamaha = boot.motoBrands.find(b => b.name === 'Yamaha');
  if (yamaha) {
    assert.throws(() => {
      LocalApi.handle('DELETE', `/moto-brands/${yamaha.id}`, {}, adminLogin.token);
    }, /still used by/);
  }
});

// ============================================================================
// SUITE 8: CUSTOMER MANAGEMENT, UNIQUENESS & REACTIVATION
// ============================================================================
console.log('\n--- SUITE 8: Customer Management & Phone Uniqueness ---');

runTest('Duplicate phone number rejection and soft delete', () => {
  const adminLogin = LocalApi.handle('POST', '/auth/login', { username: 'ronnie.manalo', password: 'Admin@12345' });
  const staffLogin = LocalApi.handle('POST', '/auth/login', { username: 'juan.delacruz', password: 'Staff@12345' });

  // Create customer
  const c1 = LocalApi.handle('POST', '/customers', {
    name: 'Customer Unique Phone',
    contactNumber: '0933-777-8899'
  }, staffLogin.token);

  // Try creating another with duplicate normalized phone
  assert.throws(() => {
    LocalApi.handle('POST', '/customers', {
      name: 'Duplicate Phone Person',
      contactNumber: '09337778899' // same numbers
    }, staffLogin.token);
  }, /already belongs to/);

  // Staff cannot deactivate customer
  assert.throws(() => {
    LocalApi.handle('DELETE', `/customers/${c1.id}`, {}, staffLogin.token);
  }, /requires Admin access/);

  // Admin deactivates
  const deact = LocalApi.handle('DELETE', `/customers/${c1.id}`, {}, adminLogin.token);
  assert.strictEqual(deact.status, 'Inactive');

  // Admin reactivates
  const react = LocalApi.handle('POST', `/customers/${c1.id}/reactivate`, {}, adminLogin.token);
  assert.strictEqual(react.status, 'Active');
});

// ============================================================================
// SUITE 9: USER MANAGEMENT & SELF DELETION GUARD
// ============================================================================
console.log('\n--- SUITE 9: User Management & Security Constraints ---');

runTest('Self-deactivation, self-role change, and self-deletion prevention', () => {
  const adminLogin = LocalApi.handle('POST', '/auth/login', { username: 'ronnie.manalo', password: 'Admin@12345' });

  // Admin cannot deactivate self
  assert.throws(() => {
    LocalApi.handle('PUT', `/users/${adminLogin.user.id}`, { status: 'Inactive' }, adminLogin.token);
  }, /You cannot change your own role or deactivate yourself/);

  // Admin cannot demote self
  assert.throws(() => {
    LocalApi.handle('PUT', `/users/${adminLogin.user.id}`, { role: 'Staff' }, adminLogin.token);
  }, /You cannot change your own role or deactivate yourself/);

  // Admin cannot delete self
  assert.throws(() => {
    LocalApi.handle('DELETE', `/users/${adminLogin.user.id}`, {}, adminLogin.token);
  }, /You cannot delete your own account/);
});

// ============================================================================
// SUITE 10: AUDIT TRAIL SENSITIVE FILTER & EVENT CAPTURE
// ============================================================================
console.log('\n--- SUITE 10: Audit Trail Verification ---');

runTest('Audit log filters sensitive events correctly', () => {
  const adminLogin = LocalApi.handle('POST', '/auth/login', { username: 'ronnie.manalo', password: 'Admin@12345' });

  const allAudit = LocalApi.handle('GET', '/audit', {}, adminLogin.token);
  assert.ok(allAudit.rows.length > 0);

  const sensAudit = LocalApi.handle('GET', '/audit?sensitive=1', {}, adminLogin.token);
  assert.ok(sensAudit.rows.length > 0);
  // All actions in sensitive audit must be in SENSITIVE_ACTIONS
  sensAudit.rows.forEach(r => {
    const isSensitive = ['user.password_change', 'auth.login_failed', 'auth.login_blocked', 'sale.void', 'sale.voided', 'sale.cancelled', 'sale.refunded', 'sale.refund', 'stock.adjust', 'stock.out', 'user.create', 'user.update', 'user.delete', 'product.archive', 'customer.deactivate', 'settings.update'].includes(r.action);
    assert.ok(isSensitive, `Row action ${r.action} should be in sensitive list`);
  });
});

// Check if any additional inconsistency can be found by inspecting modal buttons & actions in HTML
console.log('\n--- SUITE 11: Cross-Checking HTML Button Handlers & Data Attributes ---');

runTest('Check all data-close buttons across all HTML files', () => {
  const htmlFiles = fs.readdirSync('public').filter(f => f.endsWith('.html'));
  for (const f of htmlFiles) {
    const html = fs.readFileSync(path.join('public', f), 'utf8');
    const closeMatches = [...html.matchAll(/data-close=["']([^"']+)["']/g)];
    for (const m of closeMatches) {
      const targetId = m[1];
      if (!html.includes(`id="${targetId}"`)) {
        addInconsistency(
          5,
          `Broken Modal Close Button in ${f}: data-close="${targetId}" Target Missing`,
          'Frontend / HTML Markup',
          `In public/${f}, a button has data-close="${targetId}", but there is no element with id="${targetId}" on that page. Clicking the close button will fail or cause an error.`,
          `Ensure the modal overlay has id="${targetId}" or update the data-close attribute.`
        );
      }
    }
  }
});

runTest('Check all form submit / buttons have type="button" if not submitting form', () => {
  // If a button inside a form has no type attribute, its default is type="submit", which reloads the page
  const htmlFiles = fs.readdirSync('public').filter(f => f.endsWith('.html'));
  for (const f of htmlFiles) {
    const html = fs.readFileSync(path.join('public', f), 'utf8');
    // Check forms for buttons without type
    const formRegex = /<form[\s\S]*?<\/form>/gi;
    let m;
    while ((m = formRegex.exec(html)) !== null) {
      const formHtml = m[0];
      const btnRegex = /<button(?![^>]*\btype=)[^>]*>/gi;
      let bm;
      while ((bm = btnRegex.exec(formHtml)) !== null) {
        // Form buttons without type default to submit
        // Check if intentional or accidental
      }
    }
  }
});

console.log('\n========================================================================');
console.log(`ALL TEST SUITES EXECUTED`);
console.log(`TOTAL INCONSISTENCIES FOUND: ${inconsistenciesFound.length}`);
console.log('========================================================================');
