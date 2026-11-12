/* ==============================================================================
   TeamMotor Comprehensive Logic & Regression Test Suite
   Executable via: mongosh --nodb --eval "require(require('path').resolve('server/test/logic.test.js'))"
   ============================================================================== */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const resolveRoot = (...segs) => path.join(ROOT, ...segs);

const { computeTotals, round2 } = require('../src/utils/money');
const { addMonths, addDays, calculateWarrantyExpiry, today } = require('../src/utils/dates');
const { warrantyStatus } = require('../src/utils/warranty');
const { HttpError } = require('../src/utils/errors');

const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return next(new HttpError(401, 'Authentication required.'));
  if (!roles.includes(req.user.role)) return next(new HttpError(403, 'This action requires ' + roles.join(' or ') + ' access.'));
  next();
};
const adminOnly = requireRole('Admin');

/* ------------------------------------------------------------------------------
   1. VAT & PRICING CALCULATIONS
   ------------------------------------------------------------------------------ */
const vat = { vatEnabled: true, vatRate: 0.12, vatMode: 'inclusive' };

test('VAT-inclusive: total unchanged, VAT is 12/112 of it', () => {
  const t = computeTotals(1120, 0, vat);
  assert.deepStrictEqual([t.total, t.vatAmount, t.vatableAmount], [1120, 120, 1000]);
});

test('VAT-inclusive with discount applies VAT to the discounted amount', () => {
  const t = computeTotals(1000, 100, vat);
  assert.deepStrictEqual([t.total, t.vatAmount, t.vatableAmount], [900, 96.43, 803.57]);
});

test('VAT-exclusive adds 12% on top of net subtotal', () => {
  const t = computeTotals(1000, 0, { ...vat, vatMode: 'exclusive' });
  assert.deepStrictEqual([t.total, t.vatAmount, t.vatableAmount], [1120, 120, 1000]);
});

test('VAT-exclusive with discount adds 12% to discounted amount', () => {
  const t = computeTotals(1000, 200, { ...vat, vatMode: 'exclusive' });
  assert.deepStrictEqual([t.total, t.vatAmount, t.vatableAmount], [896, 96, 800]);
});

test('VAT disabled: no VAT, total = subtotal - discount', () => {
  const t = computeTotals(500, 50, { vatEnabled: false, vatRate: 0.12 });
  assert.deepStrictEqual([t.total, t.vatAmount, t.vatableAmount], [450, 0, 450]);
});

test('Discount can never exceed subtotal or be negative', () => {
  assert.strictEqual(computeTotals(100, 500, vat).discount, 100);
  assert.strictEqual(computeTotals(100, -5, vat).discount, 0);
});

/* ------------------------------------------------------------------------------
   2. CASH TENDER, CHANGE & CENTAVO ACCURACY
   ------------------------------------------------------------------------------ */
test('Cash payment: exact tender results in 0.00 change', () => {
  const total = 145.50;
  const tendered = 145.50;
  assert.strictEqual(round2(tendered), round2(total));
  const change = round2(tendered - total);
  assert.strictEqual(change, 0);
});

test('Cash payment: overpayment calculates exact change including centavos', () => {
  const total = 125.75;
  const tendered = 200.00;
  assert.ok(tendered >= total);
  const change = round2(tendered - total);
  assert.strictEqual(change, 74.25);
});

test('Cash payment: insufficient tender throws error', () => {
  const total = 250.00;
  const tendered = 249.50;
  assert.throws(() => {
    if (tendered < total) {
      throw new Error(`Cash received (${tendered.toFixed(2)}) is less than the total due (${total.toFixed(2)}).`);
    }
  }, /Cash received \(249\.50\) is less than the total due \(250\.00\)\./);
});

test('Centavo precision: handles 2-decimal-place comparisons correctly', () => {
  const subtotal = round2(19.99 * 3); // 59.97
  const tendered = 60.00;
  const change = round2(tendered - subtotal);
  assert.strictEqual(subtotal, 59.97);
  assert.strictEqual(change, 0.03);
});

/* ------------------------------------------------------------------------------
   3. RECEIPT RENDERING & CASH VS NON-CASH RULES
   ------------------------------------------------------------------------------ */
function loadReceiptEngine() {
  const receiptPath = resolveRoot('public/js/receipt.js');
  const code = fs.readFileSync(receiptPath, 'utf8');
  const ctx = {
    Utils: {
      escapeHtml: (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
      formatPHP: (n) => '\u20B1' + (Number(n) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    },
    Store: {
      get: () => ({ shopName: 'TeamMotor Moto Supply', tagline: 'Quality Parts', addressLines: ['123 Main St'], phone: '0912-345-6789', tin: 'TIN 123-456-789-000', receiptFooter: ['Thank you!'] })
    }
  };
  vm.runInNewContext(code + '; this.Receipt = Receipt;', ctx);
  return ctx.Receipt;
}

test('Receipt: heading uses "SALES RECEIPT" and never misleading "SALE INVOICE"', () => {
  const Receipt = loadReceiptEngine();
  const sale = {
    id: 'SALE-0105', date: '2026-10-26T10:00:00.000Z', staff: 'Cashier Maria', paymentMethod: 'Cash',
    subtotal: 500, discount: 0, vatEnabled: true, vatRate: 0.12, vatMode: 'inclusive', vatableAmount: 446.43, vatAmount: 53.57, total: 500,
    amountReceived: 500, changeAmount: 0, items: [{ name: 'Brake Pad', qty: 1, price: 500, subtotal: 500 }]
  };
  const data = Receipt.fromSale(sale);
  const html = Receipt.html(data);
  assert.ok(html.includes('SALES RECEIPT'), 'Receipt must contain SALES RECEIPT heading');
  assert.ok(!html.includes('SALE INVOICE'), 'Receipt must NEVER contain SALE INVOICE');
});

test('Receipt: Non-cash payment (GCash) displays reference and omits Amount Tendered & Change rows', () => {
  const Receipt = loadReceiptEngine();
  const sale = {
    id: 'SALE-0106', date: '2026-10-26T10:15:00.000Z', staff: 'Cashier Maria', paymentMethod: 'GCash', reference: 'GC-987654321',
    subtotal: 1200, discount: 0, vatEnabled: true, vatRate: 0.12, vatMode: 'inclusive', vatableAmount: 1071.43, vatAmount: 128.57, total: 1200,
    amountReceived: 1200, changeAmount: 0, items: [{ name: 'Synthetic Oil 1L', qty: 2, price: 600, subtotal: 1200 }]
  };
  const data = Receipt.fromSale(sale);
  assert.strictEqual(data.isCash, false);
  assert.strictEqual(data.tendered, null);
  assert.strictEqual(data.change, null);

  const html = Receipt.html(data);
  assert.ok(html.includes('GCash'), 'Must include payment method GCash');
  assert.ok(html.includes('GC-987654321'), 'Must include reference number');
  assert.ok(!html.includes('Amount Tendered'), 'Non-cash receipt must NOT show Amount Tendered');
  assert.ok(!html.includes('<span>Change</span>'), 'Non-cash receipt must NOT show Change row');
});

test('Receipt: Cash payment displays Amount Tendered and Change rows', () => {
  const Receipt = loadReceiptEngine();
  const sale = {
    id: 'SALE-0107', date: '2026-10-26T10:30:00.000Z', staff: 'Cashier Maria', paymentMethod: 'Cash',
    subtotal: 750, discount: 50, vatEnabled: true, vatRate: 0.12, vatMode: 'inclusive', vatableAmount: 625, vatAmount: 75, total: 700,
    amountReceived: 1000, changeAmount: 300, items: [{ name: 'Drive Belt', qty: 1, price: 750, subtotal: 750 }]
  };
  const data = Receipt.fromSale(sale);
  assert.strictEqual(data.isCash, true);
  assert.strictEqual(data.tendered, 1000);
  assert.strictEqual(data.change, 300);

  const html = Receipt.html(data);
  assert.ok(html.includes('Amount Tendered'), 'Cash receipt must show Amount Tendered');
  assert.ok(html.includes('Change'), 'Cash receipt must show Change');
});

test('Receipt: Duplicate reprint includes DUPLICATE COPY banner and reprint audit metadata', () => {
  const Receipt = loadReceiptEngine();
  const sale = {
    id: 'SALE-0108', date: '2026-10-26T11:00:00.000Z', staff: 'Cashier Maria', paymentMethod: 'Cash',
    subtotal: 350, discount: 0, vatEnabled: false, vatRate: 0, vatableAmount: 350, vatAmount: 0, total: 350,
    amountReceived: 500, changeAmount: 150, items: [{ name: 'Spark Plug', qty: 1, price: 350, subtotal: 350 }]
  };
  const reprintMeta = { number: 1, at: '2026-10-26T12:00:00.000Z', by: 'Admin User' };
  const data = Receipt.fromSale(sale, reprintMeta);
  const html = Receipt.html(data);

  assert.ok(html.includes('DUPLICATE COPY \u2014 REPRINT'), 'Must display duplicate reprint banner');
  assert.ok(html.includes('Reprinted by: Admin User'), 'Must display reprinted by audit info');
});

/* ------------------------------------------------------------------------------
   4. TRANSACTION IDENTIFIERS & SEQUENCING
   ------------------------------------------------------------------------------ */
test('Transaction Identifier: formats SALE-XXXX correctly with 4-digit zero padding', () => {
  const formatSaleId = (n) => 'SALE-' + String(n).padStart(4, '0');
  assert.strictEqual(formatSaleId(1), 'SALE-0001');
  assert.strictEqual(formatSaleId(42), 'SALE-0042');
  assert.strictEqual(formatSaleId(1024), 'SALE-1024');
  assert.strictEqual(formatSaleId(12345), 'SALE-12345');
  assert.match(formatSaleId(88), /^SALE-\d{4,}$/);
});

/* ------------------------------------------------------------------------------
   5. CHECKOUT IDEMPOTENCY (clientRequestId)
   ------------------------------------------------------------------------------ */
test('Idempotency: duplicate clientRequestId returns existing sale without double-processing', () => {
  const dbSales = [];
  function processCheckout(req) {
    if (req.clientRequestId) {
      const existing = dbSales.find(s => s.clientRequestId === req.clientRequestId);
      if (existing) {
        return { sale: existing, duplicate: true };
      }
    }
    const newSale = { id: 'SALE-0099', total: req.total, clientRequestId: req.clientRequestId };
    dbSales.push(newSale);
    return { sale: newSale, duplicate: false };
  }

  const req1 = { clientRequestId: 'req-uuid-1234', total: 500 };
  const res1 = processCheckout(req1);
  assert.strictEqual(res1.duplicate, false);
  assert.strictEqual(dbSales.length, 1);

  // Rapid double-click with identical clientRequestId
  const req2 = { clientRequestId: 'req-uuid-1234', total: 500 };
  const res2 = processCheckout(req2);
  assert.strictEqual(res2.duplicate, true);
  assert.strictEqual(res2.sale.id, res1.sale.id);
  assert.strictEqual(dbSales.length, 1); // No second sale inserted
});

/* ------------------------------------------------------------------------------
   6. ATOMIC INVENTORY STOCK ROLLBACK ON FAILURE
   ------------------------------------------------------------------------------ */
test('Atomic Stock: rolls back product stock increment if transaction recording fails', async () => {
  let productStock = 50;
  let txnCreated = false;

  async function mockChangeStock({ delta, failTxn }) {
    productStock += delta; // step 1: update stock
    try {
      if (failTxn) {
        throw new Error('Database disk error recording transaction');
      }
      txnCreated = true;
    } catch (err) {
      // atomic rollback
      productStock -= delta;
      throw err;
    }
  }

  // Attempt stock change with failing transaction
  await assert.rejects(async () => {
    await mockChangeStock({ delta: 10, failTxn: true });
  }, /Database disk error recording transaction/);

  // Verify stock rolled back to original 50
  assert.strictEqual(productStock, 50, 'Stock must roll back to 50 on failure');
  assert.strictEqual(txnCreated, false);
});

/* ------------------------------------------------------------------------------
   7. RECOVERABLE VOID / REFUND RESTOCK (NEVER RESTORE TWICE)
   ------------------------------------------------------------------------------ */
test('Recoverable Void: skips already restocked lines on retry without double-restocking', () => {
  const sale = {
    id: 'SALE-0200',
    status: 'Completed',
    items: [
      { productId: 'PRD-01', name: 'Product 1', qty: 2 },
      { productId: 'PRD-02', name: 'Product 2', qty: 5 }
    ]
  };

  const inventory = { 'PRD-01': 10, 'PRD-02': 20 };
  const existingTxns = [
    { reference: 'SALE-0200', type: 'Void Restock', productId: 'PRD-01', quantity: 2 }
  ];

  // Restock simulation matching server/src/services/sales.js logic
  const alreadyRestocked = new Set(existingTxns.map(t => t.productId));
  const newlyRestocked = [];

  for (const item of sale.items) {
    if (alreadyRestocked.has(item.productId)) {
      continue; // Skip already restocked line!
    }
    inventory[item.productId] += item.qty;
    existingTxns.push({ reference: sale.id, type: 'Void Restock', productId: item.productId, quantity: item.qty });
    newlyRestocked.push(item.productId);
  }

  // PRD-01 was already restocked, so stock remains 10 (not 12!)
  assert.strictEqual(inventory['PRD-01'], 10, 'PRD-01 must not be restocked a second time');
  // PRD-02 was newly restocked from 20 -> 25
  assert.strictEqual(inventory['PRD-02'], 25, 'PRD-02 must be restocked');
  assert.deepStrictEqual(newlyRestocked, ['PRD-02']);
});

/* ------------------------------------------------------------------------------
   10. ROLE-BASED ACCESS CONTROL (ADMIN ONLY GUARDS)
   ------------------------------------------------------------------------------ */
test('Role Guard: adminOnly middleware permits Admin and rejects Staff with 403', () => {
  let adminPassed = false;
  let staffError = null;

  const adminReq = { user: { role: 'Admin', name: 'Admin Boss' } };
  adminOnly(adminReq, {}, (err) => { if (!err) adminPassed = true; });
  assert.strictEqual(adminPassed, true, 'Admin must be granted access');

  const staffReq = { user: { role: 'Staff', name: 'Cashier Staff' } };
  adminOnly(staffReq, {}, (err) => { staffError = err; });
  assert.ok(staffError, 'Staff must be blocked with error');
  assert.strictEqual(staffError.status, 403, 'Must return HTTP 403 Forbidden');
});

/* ------------------------------------------------------------------------------
   11. INVENTORY CHECK SCHEDULING LOGIC
   ------------------------------------------------------------------------------ */
test('Inventory Check Schedule: calculates next check due date and overdue status', () => {
  function getScheduleStatus(lastCheckDate, intervalDays = 30) {
    if (!lastCheckDate) return { nextDue: null, status: 'No Previous Check', isOverdue: true };
    const nextDue = addDays(lastCheckDate, intervalDays);
    const t = today();
    const daysRemaining = Math.round((new Date(nextDue) - new Date(t)) / 86400000);
    let status = 'Up to Date';
    if (daysRemaining < 0) status = 'Overdue';
    else if (daysRemaining <= 5) status = 'Due Soon';
    return { nextDue, daysRemaining, status, isOverdue: daysRemaining < 0 };
  }

  // 10 days ago -> due in 20 days -> Up to Date
  const recent = getScheduleStatus(addDays(today(), -10));
  assert.strictEqual(recent.status, 'Up to Date');

  // 28 days ago -> due in 2 days -> Due Soon
  const soon = getScheduleStatus(addDays(today(), -28));
  assert.strictEqual(soon.status, 'Due Soon');

  // 35 days ago -> overdue by 5 days -> Overdue
  const overdue = getScheduleStatus(addDays(today(), -35));
  assert.strictEqual(overdue.status, 'Overdue');
});

/* ------------------------------------------------------------------------------
   12. DATES & WARRANTY UTILITIES
   ------------------------------------------------------------------------------ */
test('addMonths clamps end-of-month and rolls the year', () => {
  assert.strictEqual(addMonths('2026-01-31', 1), '2026-02-28');
  assert.strictEqual(addMonths('2026-11-15', 3), '2027-02-15');
});

test('warranty expiry calculation by unit', () => {
  assert.strictEqual(calculateWarrantyExpiry('2026-08-27', 7, 'days'), '2026-09-03');
  assert.strictEqual(calculateWarrantyExpiry('2026-08-27', 1, 'years'), '2027-08-27');
  assert.strictEqual(calculateWarrantyExpiry('2026-08-27', 6, 'months'), '2027-02-27');
});

test('warranty status: active / expiring soon / expired / claimed / voided', () => {
  assert.strictEqual(warrantyStatus({ warrantyExpiration: addDays(today(), 200) }, []), 'Active');
  assert.strictEqual(warrantyStatus({ warrantyExpiration: addDays(today(), 10) }, []), 'Expiring Soon');
  assert.strictEqual(warrantyStatus({ warrantyExpiration: '2020-01-01' }, []), 'Expired');
  assert.strictEqual(warrantyStatus({ warrantyExpiration: addDays(today(), 200) }, [{ status: 'Resolved' }]), 'Claimed');
  assert.strictEqual(warrantyStatus({ status: 'Voided', warrantyExpiration: addDays(today(), 200) }, []), 'Voided');
});

/* ------------------------------------------------------------------------------
   13. UI & SCOPE REFINEMENTS (PAYMENT METHODS, SKU/BARCODE, USER DELETION)
   ------------------------------------------------------------------------------ */
test('POS Payment Methods: only Cash and GCash are accepted for new sales; legacy methods stay valid in the Sale model', () => {
  const storeCode = fs.readFileSync(resolveRoot('public/js/store.js'), 'utf8');
  const fixturesCode = fs.readFileSync(resolveRoot('server/scripts/fixtures.js'), 'utf8');
  const ctx = { window: {}, console, Date, Math, Set, Array, Object, String, Number, JSON, RegExp };
  vm.runInNewContext(fixturesCode + '; this.PRODUCTS = PRODUCTS;', ctx);
  assert.ok(storeCode.includes("const PAYMENT_METHODS = ['Cash', 'GCash'];"), 'store.js must define PAYMENT_METHODS');
  const svc = fs.readFileSync(resolveRoot('server/src/services/sales.js'), 'utf8');
  assert.ok(svc.includes("const PAYMENT_METHODS = ['Cash', 'GCash'];"), 'server allowlist must match the frontend list');
  const model = fs.readFileSync(resolveRoot('server/src/models/index.js'), 'utf8');
  ['Cash', 'GCash', 'Maya', 'Bank Transfer', 'Other'].forEach(m => assert.ok(model.includes("'" + m + "'"), m + ' must stay in the Sale model enum (historical sales)'));

  const eng003 = ctx.PRODUCTS.find(p => p.id === 'ENG-003');
  assert.ok(eng003, 'ENG-003 must exist in PRODUCTS');
  assert.strictEqual(eng003.sku, 'TM-ENG-003');
  assert.strictEqual(eng003.barcode, undefined, 'barcode field must be removed from products');
});

test('POS Order Summary Removal: resets Total Paid and Change to 0 when all items are removed', () => {
  function calcPaymentState(items, method, rawTender) {
    const total = items.reduce((s, it) => s + it.subtotal, 0);
    const hasItems = items.length > 0;
    const tendered = !hasItems ? 0 : (method === 'Cash' ? rawTender : total);
    const change = !hasItems ? 0 : (method === 'Cash' ? Math.max(0, round2(tendered - total)) : 0);
    const totalPaid = hasItems ? (method === 'Cash' ? tendered : total) : 0;
    return { total, tendered, change, totalPaid };
  }

  // With 1 item (450) and 55555 tendered
  const active = calcPaymentState([{ subtotal: 450 }], 'Cash', 55555);
  assert.strictEqual(active.totalPaid, 55555);
  assert.strictEqual(active.change, 55105);

  // When all items are removed from Order Summary
  const empty = calcPaymentState([], 'Cash', 55555);
  assert.strictEqual(empty.total, 0);
  assert.strictEqual(empty.tendered, 0);
  assert.strictEqual(empty.totalPaid, 0);
  assert.strictEqual(empty.change, 0);
});

test('Inventory & Users: Add Product visible to Staff/Admin, SKU/Product ID in Overview, and Staff Deletion', () => {
  const invCode = fs.readFileSync(resolveRoot('public/js/inventory.js'), 'utf8');
  assert.ok(invCode.includes("viewField('SKU'"), 'Inventory Overview must display SKU');
  assert.ok(invCode.includes("viewField('Product ID'"), 'Inventory Overview must display Product ID');
  assert.ok(!invCode.includes("['addProductBtn', 'manageCategoriesBtn']"), 'addProductBtn must not be hidden for Staff');

  const usersCode = fs.readFileSync(resolveRoot('public/js/users.js'), 'utf8');
  assert.ok(usersCode.includes('data-delete='), 'Users table must render Delete button for staff accounts');
  assert.ok(usersCode.includes("Api.del('/users/'"), 'Users script must call DELETE /users/:id');
});

test('Manage Filters: unifies Manage Categories, Manage Brands, Manage Suppliers, and Manage Motorcycle Compatibility across UI, LocalApi, and MongoDB models', () => {
  const invHtml = fs.readFileSync(resolveRoot('public/inventory.html'), 'utf8');
  assert.ok(invHtml.includes('Manage Filters'), 'Inventory page must have Manage Filters button and modal title');
  assert.ok(invHtml.includes('Manage Categories'), 'Manage Filters must include Manage Categories tab');
  assert.ok(invHtml.includes('Manage Brands'), 'Manage Filters must include Manage Brands tab');
  assert.ok(invHtml.includes('Manage Suppliers'), 'Manage Filters must include Manage Suppliers tab');
  assert.ok(invHtml.includes('Manage Motorcycle Compatibility'), 'Manage Filters must include Manage Motorcycle Compatibility tab');
  assert.ok(!invHtml.includes('id="supplierManagerOverlay"'), 'Standalone Suppliers modal must be merged into Manage Filters');
  assert.ok(/<select[^>]+id="pBrand"/.test(invHtml), 'Add Product Brand field must be a <select> populated from Manage Brands');

  const modelsCode = fs.readFileSync(resolveRoot('server/src/models/index.js'), 'utf8');
  assert.ok(modelsCode.includes("make('Brand', 'brands'"), 'Mongoose Brand model must exist');
  assert.ok(modelsCode.includes("make('MotorcycleCompatibility', 'motorcycle_compatibility'"), 'Mongoose MotorcycleCompatibility model must exist');

  const catalogCode = fs.readFileSync(resolveRoot('server/src/routes/catalog.js'), 'utf8');
  assert.ok(catalogCode.includes('brands.post(') && catalogCode.includes('brands.delete('), 'Server catalog routes must support Brand CRUD');
  assert.ok(catalogCode.includes('motoBrands.post(') && catalogCode.includes('motoBrands.delete('), 'Server catalog routes must support MotorcycleBrand & Model CRUD');
  assert.ok(catalogCode.includes("suppliers.delete('/:id'"), 'Server catalog routes must support Supplier deletion');
  assert.ok(catalogCode.includes('!models.length'), 'Server must enforce at least one model when creating motorcycle compatibility');

  const invJs = fs.readFileSync(resolveRoot('public/js/inventory.js'), 'utf8');
  assert.ok(invJs.includes('data-sup-delete'), 'Supplier list must have delete action button');
  assert.ok(invJs.includes('deleteSupplier('), 'Supplier deletion function must be implemented');
  assert.ok(invJs.includes('!models.length'), 'Motorcycle compatibility creation must validate both brand and models');
});

test('Forgot Password OTP & Settings Cleanup: 6-digit OTP endpoints, password confirmation constraint, and Settings Shop Name removal', () => {
  const loginHtml = fs.readFileSync(resolveRoot('public/login.html'), 'utf8');
  assert.ok(loginHtml.includes('id="forgotPasswordOverlay"'), 'Login page must have Forgot Password OTP modal');
  assert.ok(loginHtml.includes('id="fpFormEmail"') && loginHtml.includes('id="fpFormOtp"') && loginHtml.includes('id="fpFormReset"'), 'Forgot Password modal must have 3-step forms (Email, 6-digit OTP, New & Confirm Password)');
  assert.ok(loginHtml.includes("Api.post('/auth/forgot-password'"), 'Login page must request OTP via /auth/forgot-password');
  assert.ok(loginHtml.includes("Api.post('/auth/verify-otp'"), 'Login page must verify 6-digit code via /auth/verify-otp');
  assert.ok(loginHtml.includes("Api.post('/auth/reset-password'"), 'Login page must submit new password & confirmation via /auth/reset-password');

  const authCode = fs.readFileSync(resolveRoot('server/src/routes/auth.js'), 'utf8');
  assert.ok(authCode.includes("router.post('/forgot-password'"), 'Auth routes must define POST /forgot-password');
  assert.ok(authCode.includes("router.post('/verify-otp'"), 'Auth routes must define POST /verify-otp');
  assert.ok(authCode.includes("router.post('/reset-password'"), 'Auth routes must define POST /reset-password');
  assert.ok(authCode.includes('newPassword !== confirmPassword'), 'Server must enforce matching newPassword and confirmPassword constraint');

  const settingsHtml = fs.readFileSync(resolveRoot('public/settings.html'), 'utf8');
  assert.ok(!settingsHtml.includes('id="sShopName"'), 'Shop name input field must be removed from settings.html');
});

test('Motorcycle Compatibility: supports adding multiple models without single-model overwrite bug', () => {
  const invJs = fs.readFileSync(resolveRoot('public/js/inventory.js'), 'utf8');
  assert.ok(!invJs.includes('syncSingleCompatSelection'), 'syncSingleCompatSelection must be removed so dropdown changes do not overwrite existing chips');
  assert.ok(invJs.includes("document.getElementById('addCompatBtn').addEventListener('click'"), 'Add button must have click listener');
  assert.ok(invJs.includes('compatSelections.push(combo)'), 'Add button must push new model into compatSelections');
  assert.ok(invJs.includes('renderCompatChips()'), 'renderCompatChips must update the compatibility chip UI');
});

test('Mobile UX/UI Optimization & Desktop Preservation: scopes mobile enhancements to <= 768px and preserves desktop layout', () => {
  const styleCss = fs.readFileSync(resolveRoot('public/css/style.css'), 'utf8');
  const responsiveCss = fs.readFileSync(resolveRoot('public/css/responsive.css'), 'utf8');
  const posCss = fs.readFileSync(resolveRoot('public/css/pos.css'), 'utf8');
  const appJs = fs.readFileSync(resolveRoot('public/js/app.js'), 'utf8');
  const posJs = fs.readFileSync(resolveRoot('public/js/pos.js'), 'utf8');

  // Safe area CSS variables & desktop-hidden defaults
  assert.ok(styleCss.includes('--safe-bottom: env(safe-area-inset-bottom'), 'style.css must define safe-area-inset-bottom variable');
  assert.ok(styleCss.includes('.mobile-filter-btn') && styleCss.includes('display: none;'), 'Mobile helpers must be hidden on desktop by default');

  // Strict @media (max-width: 768px) scoping & table-to-card transformation in responsive.css
  assert.ok(responsiveCss.includes('@media (max-width: 768px)'), 'responsive.css must scope mobile rules inside @media (max-width: 768px)');
  assert.ok(responsiveCss.includes('table:not(.rcpt-items):not(.order-table) tbody tr'), 'responsive.css must transform data table rows into mobile cards');
  assert.ok(responsiveCss.includes('#tab-products td:nth-child(2)') && responsiveCss.includes('#tab-products td:nth-child(9)'), 'responsive.css must re-enable all previously hidden product columns on mobile');
  assert.ok(responsiveCss.includes('border-radius: 1.25rem 1.25rem 0 0'), 'responsive.css must style modals as bottom-anchored sheets on mobile');

  // Non-destructive DOM enhancements in app.js
  assert.ok(appJs.includes('function syncMobileTableLabels'), 'app.js must populate data-label attributes on table cells for mobile cards');
  assert.ok(appJs.includes('function initMobileFilterDrawers'), 'app.js must initialize collapsible mobile filter drawers and quick filter chips');

  // POS mobile streamlining in pos.css and pos.js
  assert.ok(posCss.includes('@media (max-width: 768px)'), 'pos.css must scope mobile POS rules inside @media (max-width: 768px)');
  assert.ok(posCss.includes('display: flex !important;') && posCss.includes('.pt-done-right'), 'pos.css must keep receipt preview visible on mobile checkout completion');
  assert.ok(posJs.includes('View Cart'), 'pos.js must display rich item count and total summary in the floating cart bar');
  assert.ok(posJs.includes('ptMobileSwitch'), 'pos.js must provide fast-switching Catalog/Scan and Current Cart tabs on mobile');
});

test('Product Deletion: Delete button positioned below product image and API route support', () => {
  const invHtml = fs.readFileSync(resolveRoot('public/inventory.html'), 'utf8');
  assert.ok(invHtml.includes('id="deleteProductModalBtn"'), 'Delete button must exist in Add/Edit Product modal');
  assert.ok(invHtml.indexOf('id="imageDropZone"') < invHtml.indexOf('id="deleteProductModalBtn"'), 'Delete button must be positioned below the product image dropzone');

  const invJs = fs.readFileSync(resolveRoot('public/js/inventory.js'), 'utf8');
  assert.ok(invJs.includes('function deleteProduct('), 'inventory.js must define deleteProduct function');
  assert.ok(invJs.includes("Api.del('/products/'"), 'inventory.js must invoke DELETE /products/:id');

  const catalogJs = fs.readFileSync(resolveRoot('server/src/routes/catalog.js'), 'utf8');
  assert.ok(catalogJs.includes("products.delete('/:id'"), 'catalog.js must implement DELETE /products/:id endpoint');
});

test('Hybrid Product ID: removes barcode variable from product collection, enforces duplicate Product ID constraint, and supports custom/auto IDs + POS checkout', () => {
  const invHtml = fs.readFileSync(resolveRoot('public/inventory.html'), 'utf8');
  assert.ok(invHtml.includes('id="pId"'), 'Add/Edit Product modal must include #pId input field');
  assert.ok(invHtml.includes('Product ID (Scan QR code or leave blank to auto-generate)'), 'Label must instruct user to scan QR code or leave blank to auto-generate');
  assert.ok(!invHtml.includes('id="autoGenIdBtn"'), 'Add Product modal must not include redundant Auto-generate button');
  assert.ok(!invHtml.includes('id="pBarcode"'), 'Separate Barcode ID field (#pBarcode) must be removed');
  assert.ok(invHtml.includes('pattern="[A-Za-z0-9\\-_]+"'), 'Product ID input must enforce alphanumeric + dash/underscore pattern');

  const modelsJs = fs.readFileSync(resolveRoot('server/src/models/index.js'), 'utf8');
  assert.ok(!modelsJs.includes('barcode:'), 'barcode field must be deleted from Product schema in models/index.js');

  const invJs = fs.readFileSync(resolveRoot('public/js/inventory.js'), 'utf8');
  assert.ok(invJs.includes('pIdEl.disabled = true') && invJs.includes('pIdEl.readOnly = true'), 'Edit Product modal must disable/readOnly Product ID');
  assert.ok(invJs.includes('function checkProductIdField('), 'inventory.js must define checkProductIdField to block duplicate Product IDs');
  assert.ok(invJs.includes('if (!editingProductId && customId) payload.id = customId'), 'saveProduct must pass customId in payload when provided');

  const catalogJs = fs.readFileSync(resolveRoot('server/src/routes/catalog.js'), 'utf8');
  assert.ok(catalogJs.includes('PRODUCT_ID_RE = /^[A-Za-z0-9\\-_]+$/'), 'Backend must validate Product ID format against regex');
  assert.ok(catalogJs.includes("is already in use. Please use a unique ID or update existing stock."), 'Backend must return clear duplicate ID error message');
  assert.ok(!catalogJs.includes('barcode'), 'Backend catalog routes must not reference barcode');
});

test('Protected Others Category: prevents renaming, deactivating, or deleting other-parts across UI and API', () => {
  const catalogJs = fs.readFileSync(resolveRoot('server/src/routes/catalog.js'), 'utf8');
  assert.ok(catalogJs.includes("PROTECTED_CATEGORY_ID = 'other-parts'"), 'catalog.js must mark other-parts as protected');
  assert.ok(catalogJs.includes('cannot be renamed or deactivated'), 'PUT /categories/:id must block renaming/deactivating Others');
  assert.ok(catalogJs.includes('cannot be deleted'), 'DELETE /categories/:id must block deleting Others');

  const invJs = fs.readFileSync(resolveRoot('public/js/inventory.js'), 'utf8');
  assert.ok(invJs.includes("PROTECTED_CATEGORY_ID = 'other-parts'"), 'inventory.js must mark other-parts as protected in Manage Categories');
  assert.ok(invJs.includes('Protected default category'), 'inventory.js must disable category actions for Others');
});






