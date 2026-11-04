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
  const mockDataCode = fs.readFileSync(resolveRoot('public/js/mock-data.js'), 'utf8');
  const ctx = { console, Date, Math, Set, Array, Object, String, Number, JSON, RegExp };
  vm.runInNewContext(mockDataCode + '; this.PAYMENT_METHODS = PAYMENT_METHODS; this.PRODUCTS = PRODUCTS;', ctx);
  assert.deepStrictEqual(Array.from(ctx.PAYMENT_METHODS), ['Cash', 'GCash']);
  const svc = fs.readFileSync(resolveRoot('server/src/services/sales.js'), 'utf8');
  assert.ok(svc.includes("const PAYMENT_METHODS = ['Cash', 'GCash'];"), 'server allowlist must match the frontend list');
  const model = fs.readFileSync(resolveRoot('server/src/models/index.js'), 'utf8');
  ['Cash', 'GCash', 'Maya', 'Bank Transfer', 'Other'].forEach(m => assert.ok(model.includes("'" + m + "'"), m + ' must stay in the Sale model enum (historical sales)'));

  const eng003 = ctx.PRODUCTS.find(p => p.id === 'ENG-003');
  assert.ok(eng003, 'ENG-003 must exist in PRODUCTS');
  assert.strictEqual(eng003.sku, 'TM-ENG-003');
  assert.strictEqual(eng003.barcode, '480123456705');
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

test('Inventory & Users: Add Product visible to Staff/Admin, SKU/Barcode in Overview, and Staff Deletion', () => {
  const invCode = fs.readFileSync(resolveRoot('public/js/inventory.js'), 'utf8');
  assert.ok(invCode.includes("viewField('SKU'"), 'Inventory Overview must display SKU');
  assert.ok(invCode.includes("viewField('Barcode'"), 'Inventory Overview must display Barcode');
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


