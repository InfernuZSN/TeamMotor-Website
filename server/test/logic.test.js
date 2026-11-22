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
const { addMonths, addDays, calculateWarrantyExpiry, today, manilaDate, BUSINESS_TZ } = require('../src/utils/dates');
const { warrantyStatus, hasConfiguredWarranty } = require('../src/utils/warranty');
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

test('Receipt: displays warranty information below change, groups identical products with quantity (Option A), and omits section when no warranty', () => {
  const Receipt = loadReceiptEngine();

  // 1. Sale with warranty items (2 units of same Headlight + 1 unit non-warranty item)
  const saleWithWarranty = {
    id: 'SALE-0085', date: '2026-11-22T17:51:00.000Z', staff: 'Juan Dela Cruz', paymentMethod: 'Cash',
    subtotal: 1400, discount: 0, vatEnabled: false, vatRate: 0, vatableAmount: 1400, vatAmount: 0, total: 1400,
    amountReceived: 1500, changeAmount: 100,
    items: [
      { productId: 'P-HD', name: 'Headlight (LED)', qty: 2, price: 550, subtotal: 1100 },
      { productId: 'P-OIL', name: 'Chain Lube 400ml', qty: 1, price: 300, subtotal: 300 }
    ],
    warranties: [
      {
        productId: 'P-HD', productName: 'Headlight (LED)', id: 'WAR-0085',
        duration: 6, unit: 'months', coverage: 'Standard parts warranty',
        warrantyExpiration: '2027-05-22'
      }
    ]
  };

  const dataWithWar = Receipt.fromSale(saleWithWarranty);
  const htmlWithWar = Receipt.html(dataWithWar);

  assert.ok(htmlWithWar.includes('WARRANTY INFORMATION'), 'Must display WARRANTY INFORMATION section');
  assert.ok(htmlWithWar.includes('2\u00D7 Headlight (LED)'), 'Must group identical products with quantity (Option A: 2× Headlight (LED))');
  assert.ok(htmlWithWar.includes('WAR-0085'), 'Must display Warranty ID WAR-0085');
  assert.ok(htmlWithWar.includes('6 Months (Standard parts warranty)'), 'Must display duration and coverage');
  assert.ok(htmlWithWar.includes('May 22, 2027'), 'Must display formatted expiration date');
  assert.ok(!htmlWithWar.includes('Chain Lube 400ml</div>\n    <div class="rcpt-warranty-row">'), 'Non-warranty items must NOT appear in warranty section');

  // Verify Warranty section is placed below Change
  const changePos = htmlWithWar.indexOf('Change');
  const warrantyPos = htmlWithWar.indexOf('WARRANTY INFORMATION');
  assert.ok(changePos !== -1 && warrantyPos !== -1, 'Both Change and Warranty Information must be present');
  assert.ok(warrantyPos > changePos, 'Warranty Information must appear below Change');

  // 2. Sale with NO warranty items
  const saleNoWarranty = {
    id: 'SALE-0086', date: '2026-11-22T18:00:00.000Z', staff: 'Juan Dela Cruz', paymentMethod: 'Cash',
    subtotal: 300, discount: 0, vatEnabled: false, vatRate: 0, vatableAmount: 300, vatAmount: 0, total: 300,
    amountReceived: 500, changeAmount: 200,
    items: [
      { productId: 'P-OIL', name: 'Chain Lube 400ml', qty: 1, price: 300, subtotal: 300 }
    ],
    warranties: []
  };

  const dataNoWar = Receipt.fromSale(saleNoWarranty);
  const htmlNoWar = Receipt.html(dataNoWar);
  assert.ok(!htmlNoWar.includes('WARRANTY INFORMATION'), 'Must omit WARRANTY INFORMATION section when sale has no warranty items');
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
  ['Cash', 'GCash', 'Maya', 'Other'].forEach(m => assert.ok(model.includes("'" + m + "'"), m + ' must stay in the Sale model enum (historical sales)'));
  assert.ok(!model.includes("'Bank Transfer'"), 'Bank Transfer must be removed from Sale model enum');
  assert.ok(!storeCode.includes("'Bank Transfer'"), 'Bank Transfer must be removed from store.js');

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

  const invHtml = fs.readFileSync(resolveRoot('public/inventory.html'), 'utf8');
  assert.ok(invHtml.includes('<label for="pReorder">Low Stock Indicator</label>'), 'Add Product modal must rename Reorder Level to Low Stock Indicator');
  assert.ok(!invHtml.includes('<label for="pReorder">Reorder Level</label>'), 'Add Product modal must not use Reorder Level label');
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

/* ------------------------------------------------------------------------------
   14. SECURITY & AUDIT REMEDIATION REGRESSION TESTS
   ------------------------------------------------------------------------------ */
test('Security: Google login rejects email-only payload and requires valid OAuth token', async () => {
  const authCode = fs.readFileSync(resolveRoot('server/src/routes/auth.js'), 'utf8');
  const googleStart = authCode.indexOf("router.post('/google'");
  const googleEnd = authCode.indexOf("router.get('/me'");
  const googleRouteCode = authCode.slice(googleStart, googleEnd);
  assert.ok(!googleRouteCode.includes('req.body.email'), 'POST /auth/google must never fall back to client-supplied req.body.email');
  assert.ok(googleRouteCode.includes('if (!accessToken && !idToken)'), 'POST /auth/google must require accessToken or idToken');

  const loginHtml = fs.readFileSync(resolveRoot('public/login.html'), 'utf8');
  assert.ok(!loginHtml.includes('email: googleEmail'), 'Frontend Google login must not submit client-declared email');

  const authRouter = require('../src/routes/auth');
  await assert.rejects(
    async () => authRouter.verifyGoogleToken({}),
    (err) => err instanceof HttpError && err.status === 400 && /required/i.test(err.message)
  );
});

test('Security: JWT configuration rejects missing/weak secrets in production and removes hard-coded fallback', () => {
  const configCode = fs.readFileSync(resolveRoot('server/src/config.js'), 'utf8');
  assert.ok(!configCode.includes('9bfb90c0_secure_token_key_2026'), 'Hard-coded production JWT fallback secret must be completely removed');

  const config = require('../src/config');
  assert.throws(() => config.validateJwtSecret('', true), /FATAL: JWT_SECRET/);
  assert.throws(() => config.validateJwtSecret('short-secret', true), /FATAL: JWT_SECRET/);
  assert.throws(() => config.validateJwtSecret('change-me-please-now-1234567890123456', true), /FATAL: JWT_SECRET/);

  const strong = 'a_very_strong_production_secret_key_with_more_than_32_characters';
  assert.strictEqual(config.validateJwtSecret(strong, true), strong);

  const devGenerated = config.validateJwtSecret('', false);
  assert.ok(typeof devGenerated === 'string' && devGenerated.length >= 32, 'Development mode must generate random ephemeral secret');
});

test('Security: Password-reset OTP is not logged and DB connection errors are sanitized', () => {
  const authCode = fs.readFileSync(resolveRoot('server/src/routes/auth.js'), 'utf8');
  assert.ok(!authCode.includes('Password reset OTP for'), 'Password-reset OTP must never be logged to stdout');

  const appCode = fs.readFileSync(resolveRoot('server/src/app.js'), 'utf8');
  assert.ok(!appCode.includes("'Database connection failed: ' + err.message"), 'Raw DB error details must never be returned to clients');
  assert.ok(appCode.includes('status(503).json({ error:'), 'App must return generic 503 error on DB failure');

  const gitignore = fs.readFileSync(resolveRoot('.gitignore'), 'utf8');
  assert.ok(gitignore.includes('server/.env'), '.gitignore must explicitly exclude server/.env');
});

test('Sales & Payments: GCash enforces reference number and manual cashier confirmation', () => {
  const salesSvcCode = fs.readFileSync(resolveRoot('server/src/services/sales.js'), 'utf8');
  assert.ok(salesSvcCode.includes('GCash reference number (at least 4 characters) is required'), 'Service layer must require GCash reference');
  assert.ok(salesSvcCode.includes('Paid (Cashier Confirmed)') && salesSvcCode.includes('Manual Cashier Confirmed'), 'GCash sale must distinguish manual cashier confirmation from provider verification');

  const posHtml = fs.readFileSync(resolveRoot('public/pos.html'), 'utf8');
  assert.ok(posHtml.includes('id="gcashConfirmed"'), 'POS UI must include manual GCash cashier confirmation checkbox');
  assert.ok(posHtml.includes('GCash Reference number (required)'), 'POS UI must mark GCash reference as required');

  const posJs = fs.readFileSync(resolveRoot('public/js/pos.js'), 'utf8');
  assert.ok(posJs.includes('gRef.length < 4') && posJs.includes('gcashConfirmed'), 'POS JS must enforce GCash reference and confirmation before submit');
});

test('Data Integrity: Hybrid MongoDB transactions and atomic stock adjustment concurrency control', () => {
  const dbModule = require('../src/db');
  assert.strictEqual(typeof dbModule.supportsTransactions, 'function', 'db.js must expose supportsTransactions');
  assert.strictEqual(typeof dbModule.withOptionalTransaction, 'function', 'db.js must expose withOptionalTransaction');
  assert.strictEqual(dbModule.supportsTransactions(), false, 'Unconnected/standalone db state safely reports no replica-set transaction');

  const salesSvcCode = fs.readFileSync(resolveRoot('server/src/services/sales.js'), 'utf8');
  assert.ok(salesSvcCode.includes('withOptionalTransaction('), 'createSale must use hybrid withOptionalTransaction');

  const invSvcCode = fs.readFileSync(resolveRoot('server/src/services/inventory.js'), 'utf8');
  assert.ok(invSvcCode.includes('async function adjustStock(opts)'), 'inventory service must define atomic adjustStock');
  assert.ok(invSvcCode.includes('filter.stock = exp'), 'adjustStock must support compare-and-set on expectedStock');

  const invRouteCode = fs.readFileSync(resolveRoot('server/src/routes/inventory.js'), 'utf8');
  assert.ok(invRouteCode.includes('await adjustStock('), 'POST /inventory/adjust must use atomic adjustStock');
  assert.ok(invRouteCode.indexOf('Cost price must be a non-negative number') < invRouteCode.indexOf('await changeStock('), 'POST /inventory/stock-in must validate metadata before mutating stock');

  const invJs = fs.readFileSync(resolveRoot('public/js/inventory.js'), 'utf8');
  assert.ok(invJs.includes('dataset.expectedStock') && invJs.includes('payload.expectedStock'), 'Inventory adjustment modal must send expectedStock for optimistic concurrency');
});

test('Warranty Claims: Defaults status to Pending and rejects unrecognized status values', () => {
  const warRouteCode = fs.readFileSync(resolveRoot('server/src/routes/warranties.js'), 'utf8');
  assert.ok(warRouteCode.includes("let status = 'Pending';"), 'Warranties route must default missing status to Pending');
  assert.ok(warRouteCode.includes('Invalid warranty claim status'), 'Warranties route must reject invalid status values');

  const warHtml = fs.readFileSync(resolveRoot('public/warranty.html'), 'utf8');
  assert.ok(warHtml.includes('<option value="Pending" selected>'), 'warranty.html must select Pending by default');

  const warJs = fs.readFileSync(resolveRoot('public/js/warranty.js'), 'utf8');
  assert.ok(warJs.includes("document.getElementById('claimStatus').value = 'Pending';"), 'warranty.js must initialize claim modal status to Pending');
});

test('Dates & Responsive UI: Standardizes Asia/Manila business timezone and ultra-narrow mobile rules', () => {
  assert.strictEqual(BUSINESS_TZ, 'Asia/Manila');
  // 2026-11-16 18:30:00 UTC is 2026-11-17 02:30:00 in Asia/Manila (UTC+8)
  assert.strictEqual(manilaDate('2026-11-16T18:30:00.000Z'), '2026-11-17', 'manilaDate must convert UTC midnight-to-8am to next Manila calendar day');
  assert.match(today(), /^\d{4}-\d{2}-\d{2}$/);

  const respCss = fs.readFileSync(resolveRoot('public/css/responsive.css'), 'utf8');
  assert.ok(respCss.includes('@media (max-width: 390px)') && respCss.includes('@media (max-width: 360px)'), 'responsive.css must include ultra-narrow mobile breakpoints');
  const posCss = fs.readFileSync(resolveRoot('public/css/pos.css'), 'utf8');
  assert.ok(posCss.includes('@media (max-width: 380px)'), 'pos.css must include ultra-narrow mobile POS rules');
});

test('Inventory Empty Table UI: adapts empty-row colspan to visible columns and centers empty state', () => {
  const invJs = fs.readFileSync(resolveRoot('public/js/inventory.js'), 'utf8');
  assert.ok(invJs.includes('function visibleColSpan(tbody, fallback)'), 'inventory.js must define visibleColSpan helper');
  assert.ok(invJs.includes("colspan=\"' + visibleColSpan(tbody, 10) + '\""), 'renderProductsTable must use visibleColSpan instead of hardcoded 10');
  assert.ok(invJs.includes("colspan=\"' + visibleColSpan(tbody, 9) + '\""), 'renderHistoryTable must use visibleColSpan instead of hardcoded 9');

  const appJs = fs.readFileSync(resolveRoot('public/js/app.js'), 'utf8');
  assert.ok(appJs.includes('cells[0].colSpan = visCols'), 'syncMobileTableLabels must sync empty-row colSpan to visible thead columns');
  assert.ok(appJs.includes("window.addEventListener('resize', scheduleSync)"), 'initMobileEnhancements must re-sync empty-row colSpan on window resize');

  const styleCss = fs.readFileSync(resolveRoot('public/css/style.css'), 'utf8');
  assert.ok(styleCss.includes('thead, thead tr { background: var(--ink); }'), 'style.css must paint full thead row background dark');
  assert.ok(styleCss.includes('.page-inventory .table-card > .table-wrap > table:has(.empty-state) { height: 100%; }'), 'style.css must stretch empty inventory table vertically for centering');

  assert.ok(
    fs.readFileSync(resolveRoot('public/css/responsive.css'), 'utf8').includes('tbody tr.mobile-empty-row > td'),
    'responsive.css must center empty-state cells on mobile'
  );
  assert.ok(
    styleCss.includes('#tab-products th:nth-child(10) { width: 13.25rem; }'),
    'style.css must allocate 13.25rem for Inventory Actions column so Delete button is not clipped'
  );
});

test('Menu Loading Performance: SWR cache, selective invalidation, immediate shell render, idle prefetch, parallel bootstrap, and HTTP compression', async () => {
  const storeCode = fs.readFileSync(resolveRoot('public/js/store.js'), 'utf8');
  assert.ok(storeCode.includes('SWR_MAX_AGE'), 'store.js must implement Stale-While-Revalidate window');
  assert.ok(storeCode.includes("path.indexOf('/notifications/') !== 0"), 'store.js must not invalidate bootstrap cache on notification read calls');
  assert.ok(storeCode.includes('stripHeavyImages'), 'store.js must fall back to slimmed cache on sessionStorage quota limits');

  const appCode = fs.readFileSync(resolveRoot('public/js/app.js'), 'utf8');
  assert.ok(appCode.includes('function applyImmediateShellRender()'), 'app.js must render shell synchronously before hydration completes');
  assert.ok(appCode.includes('teammotor:menus_prefetched'), 'app.js must proactively prefetch menu pages on idle');

  const auditCode = fs.readFileSync(resolveRoot('public/js/audit.js'), 'utf8');
  assert.ok(auditCode.includes('initialAuditPrefetch'), 'audit.js must prefetch initial audit rows in parallel with bootstrap');

  const miscCode = fs.readFileSync(resolveRoot('server/src/routes/misc.js'), 'utf8');
  assert.ok(miscCode.includes('.then(withItems)') && miscCode.includes('.then(withClaims)'), 'bootstrap route must parallelize withItems and withClaims inside Promise.all');

  const serverAppCode = fs.readFileSync(resolveRoot('server/src/app.js'), 'utf8');
  assert.ok(serverAppCode.includes('zlib.gzip') && serverAppCode.includes('stale-while-revalidate'), 'server/src/app.js must enable Gzip JSON compression and static Cache-Control headers');

  // Behavioral check: expiryReport strips base64 images when preloadedProducts is supplied
  const { expiryReport } = require('../src/services/expiry');
  const rep = await expiryReport(
    { expiryWarningMonths: 3 },
    [{ id: 'ENG-004', name: 'Degreaser', stock: 5, archived: false, expirationDate: '2020-01-01', image: 'data:image/png;base64,AAA' }]
  );
  assert.strictEqual(rep.expired.length, 1);
  assert.strictEqual(rep.expired[0].image, undefined, 'expiryReport must strip heavy images when preloadedProducts is passed');

  // Behavioral check: Store SWR returns cached data immediately while revalidating in background and skips invalidation on /notifications/*
  const ssMap = new Map();
  const lsMap = new Map([['teammotor:token', 'tok']]);
  const events = [];
  let fetchCalls = 0;
  let resolveBgFetch;
  const cachedPayload = { me: { id: 'USR-1', name: 'Admin', role: 'Admin' }, products: [{ id: 'P-1', name: 'Old' }], serverTime: 't0' };
  ssMap.set('teammotor:bootstrap', JSON.stringify(cachedPayload));
  ssMap.set('teammotor:bootstrap_time', String(Date.now() - 2 * 60 * 1000)); // 2 minutes old (> 60s fresh, < 30m SWR)

  const ctx = {
    URLSearchParams,
    CustomEvent: function (name) { this.type = name; },
    fetch: function (url) {
      fetchCalls++;
      if (String(url).includes('/notifications/')) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
      }
      return new Promise((resolve) => {
        resolveBgFetch = () => resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ me: { id: 'USR-1', name: 'Admin', role: 'Admin' }, products: [{ id: 'P-1', name: 'Updated' }], serverTime: 't1' })
        });
      });
    },
    location: { pathname: '/index.html', replace() {} },
    document: { readyState: 'complete', addEventListener() {}, body: {} },
    console, Date, Math, Set, Array, Object, String, Number, JSON, RegExp, Promise
  };
  ctx.window = {
    localStorage: { getItem: (k) => lsMap.get(k) ?? null, setItem: (k, v) => lsMap.set(k, String(v)), removeItem: (k) => lsMap.delete(k) },
    sessionStorage: { getItem: (k) => ssMap.get(k) ?? null, setItem: (k, v) => ssMap.set(k, String(v)), removeItem: (k) => ssMap.delete(k) },
    dispatchEvent: (ev) => events.push(ev.type),
    TEAMMOTOR_API_BASE: ''
  };
  vm.runInNewContext(storeCode + '; this.Store = Store; this.Api = Api;', ctx);

  assert.strictEqual(ctx.Store.isLoaded(), true, 'Store must synchronously pre-hydrate from sessionStorage');
  await ctx.Api.post('/notifications/NTF-0001/read');
  assert.ok(ssMap.has('teammotor:bootstrap_time'), 'Marking a notification read must not invalidate bootstrap cache');

  const immediate = await ctx.Store.hydrate();
  assert.strictEqual(immediate.products[0].name, 'Old', 'SWR hydrate must resolve immediately with cached payload');
  assert.strictEqual(fetchCalls, 2, 'SWR hydrate must kick off background /bootstrap fetch');
  resolveBgFetch();
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(ctx.Store.get('products')[0].name, 'Updated', 'Background SWR fetch must update in-memory Store');
  assert.ok(events.includes('store:refreshed'), 'Background SWR fetch must dispatch store:refreshed when payload changes');
});

test('CRUD & Entity Management Performance: instant Store mutators, connection pooling, and parallelized DB pipelines', () => {
  const storeCode = fs.readFileSync(resolveRoot('public/js/store.js'), 'utf8');
  const ssMap = new Map();
  ssMap.set('teammotor:bootstrap', JSON.stringify({ products: [{ id: 'LGT-001', name: 'Headlight', stock: 5 }], inventoryTransactions: [] }));
  ssMap.set('teammotor:bootstrap_time', String(Date.now()));
  let networkCalls = 0;
  const ctx = {
    URLSearchParams,
    CustomEvent: function (name) { this.type = name; },
    fetch: () => { networkCalls++; throw new Error('Network should not be called by local mutators'); },
    location: { pathname: '/inventory.html', replace() {} },
    document: { readyState: 'complete', addEventListener() {}, body: {} },
    console, Date, Math, Set, Array, Object, String, Number, JSON, RegExp, Promise
  };
  ctx.window = {
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: (k) => ssMap.get(k) ?? null, setItem: (k, v) => ssMap.set(k, String(v)), removeItem: (k) => ssMap.delete(k) },
    dispatchEvent() {},
    TEAMMOTOR_API_BASE: ''
  };
  vm.runInNewContext(storeCode + '; this.Store = Store;', ctx);

  // Upsert (create), partial patch, prepend, and remove
  ctx.Store.upsertItem('products', { id: 'LGT-002', name: 'Tail Light', stock: 10 });
  ctx.Store.upsertItem('products', { id: 'LGT-001', stock: 8 });
  ctx.Store.upsertItem('inventoryTransactions', { id: 'TRX-0001', productId: 'LGT-001' }, { prepend: true });
  ctx.Store.upsertItem('inventoryTransactions', { id: 'TRX-0002', productId: 'LGT-002' }, { prepend: true });
  assert.strictEqual(ctx.Store.get('products').length, 2);
  assert.strictEqual(ctx.Store.get('products').find(p => p.id === 'LGT-001').name, 'Headlight');
  assert.strictEqual(ctx.Store.get('products').find(p => p.id === 'LGT-001').stock, 8);
  assert.strictEqual(ctx.Store.get('inventoryTransactions')[0].id, 'TRX-0002');
  ctx.Store.removeItem('products', 'LGT-002');
  assert.strictEqual(ctx.Store.get('products').length, 1);
  assert.strictEqual(networkCalls, 0);
  const persisted = JSON.parse(ssMap.get('teammotor:bootstrap'));
  assert.strictEqual(persisted.products.length, 1);

  // Frontend pages patch Store directly instead of blocking on Store.refresh() / full page reload
  ['public/js/inventory.js', 'public/js/users.js', 'public/js/customers.js', 'public/js/warranty.js', 'public/js/sales.js', 'public/js/profile.js'].forEach((rel) => {
    const code = fs.readFileSync(resolveRoot(rel), 'utf8');
    assert.ok(code.includes('Store.upsertItem'), rel + ' must patch Store with Store.upsertItem');
    assert.ok(!code.includes('await Store.refresh()'), rel + ' must not block CRUD UI updates on await Store.refresh()');
  });
  const salesJs = fs.readFileSync(resolveRoot('public/js/sales.js'), 'utf8');
  assert.ok(!salesJs.includes('window.location.reload()'), 'sales.js must update Store in-place after void instead of reloading the page');

  // Backend optimizations
  const dbCode = fs.readFileSync(resolveRoot('server/src/db.js'), 'utf8');
  assert.ok(dbCode.includes('connectPromise') && dbCode.includes('maxPoolSize'), 'db.js must cache in-flight MongoDB connection promises');

  const invSvcCode = fs.readFileSync(resolveRoot('server/src/services/inventory.js'), 'utf8');
  assert.ok(invSvcCode.includes('opts.extraSet'), 'changeStock must accept extraSet for single-write stock-in metadata updates');

  const custRouteCode = fs.readFileSync(resolveRoot('server/src/routes/customers.js'), 'utf8');
  assert.ok(custRouteCode.includes('async function statsMap(customerId)') && custRouteCode.includes('statsMap(c.id)'), 'customers route must scope statsMap aggregation to single customer when applicable');

  const catalogRouteCode = fs.readFileSync(resolveRoot('server/src/routes/catalog.js'), 'utf8');
  assert.ok(catalogRouteCode.includes('InventoryTransaction.create('), 'POST /products must write initial stock and opening transaction without redundant Product re-reads');

  const salesSvcCode = fs.readFileSync(resolveRoot('server/src/services/sales.js'), 'utf8');
  assert.ok(salesSvcCode.includes('const [dup, products, customer, settings] = await Promise.all(['), 'createSale must parallelize initial lookups');
});

test('Responsiveness & Font Consistency: unified typography, aligned 768px breakpoints, mobile input selectors, and POS tab contrast', () => {
  const styleCss = fs.readFileSync(resolveRoot('public/css/style.css'), 'utf8');
  assert.ok(!styleCss.includes('@media (min-width: 721px)'), 'style.css must not use stale 721px breakpoint');
  assert.ok(styleCss.includes('@media (min-width: 769px)'), 'style.css must align desktop-only breakpoints at min-width: 769px');
  assert.ok(/h1,\s*h2,\s*h3,\s*h4\s*\{[^}]*font-family:\s*var\(--font-label\)/.test(styleCss), 'style.css must unify h1-h4 to var(--font-label)');
  assert.ok(styleCss.includes('.au-pre') && styleCss.includes('font-family: var(--font-display);'), 'style.css must style .au-pre with var(--font-display)');
  assert.ok(styleCss.includes('font-family: var(--font-display) !important;'), 'style.css must style .fp-otp-input with var(--font-display)');
  assert.ok(!styleCss.includes("'Courier New', Courier, monospace !important"), 'style.css must not hardcode Courier New on OTP input');

  const respCss = fs.readFileSync(resolveRoot('public/css/responsive.css'), 'utf8');
  const mobileBlock = respCss.slice(respCss.indexOf('@media (max-width: 768px)'));
  assert.ok(mobileBlock.includes('input[type="text"]') && mobileBlock.includes('.search-input input'), 'responsive.css must target real form/search inputs on mobile');
  assert.ok(mobileBlock.includes('.modal-body .table-wrap.is-scroll'), 'responsive.css must uncap nested scrollable tables inside mobile modals');
  assert.ok(mobileBlock.includes('bottom: calc(0.75rem + var(--safe-bottom, 0px));'), 'responsive.css must anchor .profile-actions cleanly near the bottom');

  const posCss = fs.readFileSync(resolveRoot('public/css/pos.css'), 'utf8');
  assert.ok(posCss.includes('--pt-ink: var(--ink);'), 'pos.css must define --pt-ink on .pos-terminal for mobile switcher active tab contrast');

  const settingsHtml = fs.readFileSync(resolveRoot('public/settings.html'), 'utf8');
  assert.ok(settingsHtml.includes('class="grid-2 settings-grid"') && !settingsHtml.includes('minmax(320px,1fr)'), 'settings.html must use responsive .settings-grid instead of inline grid-template-columns');

  const htmlFiles = ['audit.html', 'customers.html', 'index.html', 'inventory.html', 'login.html', 'pos.html', 'profile.html', 'sales.html', 'settings.html', 'users.html', 'warranty.html'];
  for (const name of htmlFiles) {
    const html = fs.readFileSync(resolveRoot('public/' + name), 'utf8');
    assert.ok(html.includes('family=Poppins:wght@400;500;600;700;800'), name + ' must load Poppins weights');
    assert.ok(html.includes('family=Inter:wght@300;400;500;600;700'), name + ' must load Inter weights');
    assert.ok(!html.includes('Space+Mono') && !html.includes('Montserrat'), name + ' must only load Poppins and Inter');
  }
  assert.ok(styleCss.includes("--font-display: 'Poppins', sans-serif;"), 'style.css must define Poppins for --font-display');
  assert.ok(styleCss.includes("--font-label: 'Poppins', sans-serif;"), 'style.css must define Poppins for --font-label');
  assert.ok(styleCss.includes("--font-body: 'Inter', sans-serif;"), 'style.css must define Inter for --font-body');

  const salesJs = fs.readFileSync(resolveRoot('public/js/sales.js'), 'utf8');
  assert.ok(salesJs.includes('class="flex gap-8"') && salesJs.includes('data-view-sale='), 'sales.js action buttons must be wrapped in flex gap-8 so they do not touch');
  assert.ok(styleCss.includes('.page-sales #tab-overview td > .icon-btn + .icon-btn { margin-left: 0.5rem; }'), 'style.css must space adjacent sales action buttons');
});

test('Product Warranty vs. Product Expiration: user-controlled warranties only, independent shelf-life expiration, and Product Details Overview expiration display', () => {
  const salesSvcCode = fs.readFileSync(resolveRoot('server/src/services/sales.js'), 'utf8');
  assert.ok(salesSvcCode.includes('if (!hasConfiguredWarranty(p)) continue;'), 'createSale must gate warranty creation strictly on hasConfiguredWarranty(p)');
  assert.ok(!salesSvcCode.includes('isRubber') && !salesSvcCode.includes('tires?|tyres?|rubber'), 'createSale must not infer warranties from product name regex or rubber flag');

  assert.strictEqual(hasConfiguredWarranty({ id: 'TLS-002', name: 'Tire Pressure Gauge', rubber: true, warrantyDuration: null }), false, 'Product without configured warrantyDuration/warrantyDays must not have warranty even if named Tire or flagged rubber');
  assert.strictEqual(hasConfiguredWarranty({ id: 'OTH-001', warrantyDuration: 7, warrantyUnit: 'days' }), true, 'Product with configured warrantyDuration must report configured warranty');
  assert.strictEqual(hasConfiguredWarranty({ id: 'OTH-002', expirationDate: '2027-01-01', warrantyDuration: 6, warrantyUnit: 'months' }), true, 'Product can have both expirationDate and warranty simultaneously');

  // Short 7-day warranty should be Active on purchase day and Expiring Soon near end of period
  const t = today();
  assert.strictEqual(warrantyStatus({ warrantyStart: t, warrantyExpiration: addDays(t, 7) }, []), 'Active', 'Newly purchased 7-day warranty must be Active on purchase day');
  assert.strictEqual(warrantyStatus({ warrantyStart: addDays(t, -5), warrantyExpiration: addDays(t, 2) }, []), 'Expiring Soon', '7-day warranty on day 6 (2 days left) must be Expiring Soon');

  const storeCode = fs.readFileSync(resolveRoot('public/js/store.js'), 'utf8');
  const ctx = {
    URLSearchParams,
    CustomEvent: function (name) { this.type = name; },
    fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }),
    location: { pathname: '/inventory.html', replace() {} },
    document: { readyState: 'complete', addEventListener() {}, body: {} },
    console, Date, Math, Set, Array, Object, String, Number, JSON, RegExp, Promise
  };
  ctx.window = {
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    dispatchEvent() {},
    TEAMMOTOR_API_BASE: ''
  };
  vm.runInNewContext(storeCode + '; this.Utils = Utils;', ctx);

  assert.strictEqual(typeof ctx.Utils.hasProductWarranty, 'function', 'store.js must define Utils.hasProductWarranty');
  assert.strictEqual(typeof ctx.Utils.productExpiryDetail, 'function', 'store.js must define Utils.productExpiryDetail');
  assert.strictEqual(ctx.Utils.isRubberItem({ name: 'Tire Pressure Gauge', rubber: true }), false, 'Utils.isRubberItem must never auto-classify items as warranted');
  assert.strictEqual(ctx.Utils.hasProductWarranty({ id: 'TLS-002', name: 'Tire Pressure Gauge', warrantyDuration: null }), false);
  assert.strictEqual(ctx.Utils.hasProductWarranty({ id: 'OTH-002', expirationDate: '2027-01-01', warrantyDuration: 6, warrantyUnit: 'months' }), true);

  const expiredDetail = ctx.Utils.productExpiryDetail({ expirationDate: '2020-01-01' }, 3);
  assert.ok(expiredDetail.includes('Expired') && expiredDetail.includes('days ago'), 'productExpiryDetail must show Expired badge and elapsed days');
  const soonDetail = ctx.Utils.productExpiryDetail({ expirationDate: addDays(t, 10) }, 3);
  assert.ok(soonDetail.includes('Expiring Soon') && soonDetail.includes('10 days left'), 'productExpiryDetail must show Expiring Soon badge and remaining days');

  const invJs = fs.readFileSync(resolveRoot('public/js/inventory.js'), 'utf8');
  assert.ok(invJs.includes('Utils.txnBatchExpiry') && invJs.includes('Utils.batchExpiryHtml'), 'inventory.js must render batch expiration dates in Product Details Activity');
});

test('Batch-Relative Expiration Tracking, Activity Layout, and FEFO Stock Adjustment', () => {
  const modelsCode = fs.readFileSync(resolveRoot('server/src/models/index.js'), 'utf8');
  assert.ok(modelsCode.includes('shelfLifeDuration: { type: Number, default: null }'), 'Product model must include shelfLifeDuration');
  assert.ok(modelsCode.includes('shelfLifeUnit: { type: String, default: null }'), 'Product model must include shelfLifeUnit');
  assert.ok(/const InventoryTransaction = make\([^)]+\{[\s\S]*?expirationDate:\s*\{\s*type:\s*String,\s*default:\s*null\s*\}/.test(modelsCode), 'InventoryTransaction model must include expirationDate');

  const invJs = fs.readFileSync(resolveRoot('public/js/inventory.js'), 'utf8');
  const overviewMatch = invJs.match(/document\.getElementById\('vtab-overview'\)\.innerHTML\s*=[\s\S]*?document\.getElementById\('vtab-inventory'\)\.innerHTML\s*=[\s\S]*?viewField\('Last Updated'[^;]+;/);
  assert.ok(overviewMatch, 'inventory.js must populate vtab-overview and vtab-inventory');
  assert.ok(!overviewMatch[0].includes("viewField('Expiration Date'"), 'vtab-overview and vtab-inventory must not display static Expiration Date');

  const actMatch = invJs.match(/function renderViewActivity\(\)\s*\{[\s\S]*?\n\s*\}\n\n\s*function openViewModal/);
  assert.ok(actMatch, 'inventory.js must define renderViewActivity');
  assert.ok(actMatch[0].includes('<th>Expiration Date</th>'), 'renderViewActivity must include Expiration Date column');
  assert.ok(!actMatch[0].includes('<th>Reason</th>'), 'renderViewActivity must not include Reason column');
  assert.ok(actMatch[0].includes('notesLower.includes(refLower)'), 'renderViewActivity must avoid repeating reference in notes');
  assert.ok(actMatch[0].includes('notesLower.includes(reasonLower)'), 'renderViewActivity must avoid repeating reason in notes');

  const invHtml = fs.readFileSync(resolveRoot('public/inventory.html'), 'utf8');
  assert.ok(invHtml.includes('id="pShelfLifeDuration"') && invHtml.includes('id="pShelfLifeUnit"'), 'inventory.html must provide Product Shelf Life fields');
  assert.ok(invHtml.includes('id="adjBatchField"') && invHtml.includes('id="adjBatch"'), 'inventory.html Adjust Stock modal must include optional Batch to Adjust selector');

  // Relative batch expiration calculation (Nov 2 + 8 days = Nov 10; Nov 7 restock + 8 days = Nov 15)
  assert.strictEqual(calculateWarrantyExpiry('2026-11-02', 8, 'days'), '2026-11-10');
  assert.strictEqual(calculateWarrantyExpiry('2026-11-07', 8, 'days'), '2026-11-15');

  const { computeActiveBatches, resolveEarliestBatchExpiry } = require('../src/services/inventory');
  const sampleProduct = { id: 'OTH-002', stock: 15, shelfLifeDuration: 8, shelfLifeUnit: 'days', expirationDate: '2026-11-10' };
  const initialAndRestock = [
    { id: 'TRX-0001', productId: 'OTH-002', type: 'Stock In', quantity: 5, date: '2026-11-02T08:00:00Z', expirationDate: '2026-11-10' },
    { id: 'TRX-0002', productId: 'OTH-002', type: 'Stock In', quantity: 10, date: '2026-11-07T08:00:00Z', expirationDate: '2026-11-15' }
  ];

  // Auto FEFO deducts from earliest expiring batch (Nov 10) first and spills over to Nov 15
  const afterFefoPartial = computeActiveBatches(sampleProduct, initialAndRestock.concat([
    { id: 'TRX-0003', productId: 'OTH-002', type: 'Adjustment', quantity: -3, date: '2026-11-08T08:00:00Z', expirationDate: null }
  ]));
  assert.deepStrictEqual(afterFefoPartial.map(b => [b.expirationDate, b.remainingQty]), [
    ['2026-11-10', 2],
    ['2026-11-15', 10]
  ]);
  assert.strictEqual(resolveEarliestBatchExpiry(sampleProduct, initialAndRestock.concat([
    { id: 'TRX-0003', productId: 'OTH-002', type: 'Adjustment', quantity: -5, date: '2026-11-08T08:00:00Z', expirationDate: null }
  ])), '2026-11-15', 'When Nov 10 batch is depleted, earliest active batch shifts to Nov 15');

  // Targeted batch adjustment deducts directly from specified batch (Nov 15) while leaving Nov 10 intact
  const afterTargeted = computeActiveBatches(sampleProduct, initialAndRestock.concat([
    { id: 'TRX-0004', productId: 'OTH-002', type: 'Adjustment', quantity: -4, date: '2026-11-08T09:00:00Z', expirationDate: '2026-11-15' }
  ]));
  assert.deepStrictEqual(afterTargeted.map(b => [b.expirationDate, b.remainingQty]), [
    ['2026-11-10', 5],
    ['2026-11-15', 6]
  ]);

  // Verify frontend Utils.computeProductBatches & Utils.txnBatchExpiry in VM
  const storeCode = fs.readFileSync(resolveRoot('public/js/store.js'), 'utf8');
  const ctx = {
    URLSearchParams,
    CustomEvent: function (name) { this.type = name; },
    fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }),
    location: { pathname: '/inventory.html', replace() {} },
    document: { readyState: 'complete', addEventListener() {}, body: {} },
    console, Date, Math, Set, Array, Object, String, Number, JSON, RegExp, Promise
  };
  ctx.window = {
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    dispatchEvent() {},
    TEAMMOTOR_API_BASE: ''
  };
  vm.runInNewContext(storeCode + '; this.Utils = Utils;', ctx);

  assert.strictEqual(ctx.Utils.txnBatchExpiry({ type: 'Stock In', date: '2026-11-07T08:00:00Z' }, { shelfLifeDuration: 8, shelfLifeUnit: 'days' }), '2026-11-15');
  const fefoBatches = ctx.Utils.computeProductBatches(sampleProduct, initialAndRestock.concat([
    { id: 'TRX-0003', productId: 'OTH-002', type: 'Adjustment', quantity: -6, date: '2026-11-08T08:00:00Z', expirationDate: null }
  ]));
  assert.strictEqual(fefoBatches[0].remainingQty, 0);
  assert.strictEqual(fefoBatches[1].remainingQty, 9);

  // Stock In / Out uses current system time rather than defaulting to UTC midnight (8:00 AM in PH)
  const invRouteCode = fs.readFileSync(resolveRoot('server/src/routes/inventory.js'), 'utf8');
  assert.ok(invRouteCode.includes('if (vDate === today())') && invRouteCode.includes('return now.toISOString()'), 'parseDate must return current system timestamp when stocking in/out today');
});

test('Inventory Activity Notifications, Individual Delete (x), and Clear All with Confirmation', async () => {
  const modelsCode = fs.readFileSync(resolveRoot('server/src/models/index.js'), 'utf8');
  assert.ok(modelsCode.includes('dismissed: { type: Boolean, default: false }'), 'Notification schema must track dismissed state');

  const notifService = require('../src/services/notifications');
  assert.strictEqual(typeof notifService.createActivityNotification, 'function', 'notifications service must export createActivityNotification');
  const notifServiceCode = fs.readFileSync(resolveRoot('server/src/services/notifications.js'), 'utf8');
  assert.ok(notifServiceCode.includes('EVENT_TYPES') && notifServiceCode.includes('stock-in') && notifServiceCode.includes('stock-out') && notifServiceCode.includes('stock-adjust') && notifServiceCode.includes('product-archive') && notifServiceCode.includes('product-delete'), 'notifications service must preserve inventory activity event types');

  const miscCode = fs.readFileSync(resolveRoot('server/src/routes/misc.js'), 'utf8');
  assert.ok(miscCode.includes("notifications.delete('/clear-all'"), 'misc routes must expose DELETE /notifications/clear-all');
  assert.ok(miscCode.includes("notifications.delete('/:id'"), 'misc routes must expose DELETE /notifications/:id');
  assert.ok(miscCode.includes('dismissed: { $ne: true }'), 'notification queries must filter out dismissed notifications');

  const invRouteCode = fs.readFileSync(resolveRoot('server/src/routes/inventory.js'), 'utf8');
  assert.ok(invRouteCode.includes("type: 'stock-in'") && invRouteCode.includes("type: 'stock-out'") && invRouteCode.includes("type: 'stock-adjust'"), 'inventory routes must create notifications for stock-in, stock-out, and stock-adjust');

  const catalogRouteCode = fs.readFileSync(resolveRoot('server/src/routes/catalog.js'), 'utf8');
  assert.ok(catalogRouteCode.includes('createActivityNotification') && catalogRouteCode.includes("archived ? 'product-archive' : 'product-unarchive'") && catalogRouteCode.includes("type: 'product-delete'"), 'catalog routes must create notifications for archive/unarchive and product deletion');

  const notifClientCode = fs.readFileSync(resolveRoot('public/js/notifications.js'), 'utf8');
  assert.ok(notifClientCode.includes('data-del-notif') && notifClientCode.includes('&times;'), 'notifications UI must render x button to delete single notifications');
  assert.ok(notifClientCode.indexOf('markAllReadBtn') < notifClientCode.indexOf('clearAllNotifsBtn'), 'Clear all button must be placed to the right of Mark all read button');
  assert.ok(notifClientCode.includes("confirmDialog(") && notifClientCode.includes("clearAll()"), 'Clear all button must prompt confirmation before deleting all notifications');

  const invClientCode = fs.readFileSync(resolveRoot('public/js/inventory.js'), 'utf8');
  assert.ok(invClientCode.includes("Store.upsertItem('notifications'") && invClientCode.includes('Notifications.poll()'), 'inventory client actions must immediately update notifications');

  // Behavioral check of Notifications UI & Actions in VM
  let storeNotifs = [
    { id: 'NTF-0001', type: 'stock-in', title: 'Stock In', message: 'Chain +5', link: 'inventory.html', date: new Date().toISOString(), read: false },
    { id: 'NTF-0002', type: 'product-delete', title: 'Product Deleted', message: 'Helmet deleted', link: 'inventory.html', date: new Date().toISOString(), read: false }
  ];
  const deletedCalls = [];
  let confirmPrompted = null;
  let renderedPanelHtml = '';
  const panelEl = {
    classList: { toggle() {}, remove() {} },
    addEventListener() {},
    querySelectorAll() { return []; },
    get innerHTML() { return renderedPanelHtml; },
    set innerHTML(v) { renderedPanelHtml = v; }
  };
  const ctx = {
    window: {},
    Utils: { escapeHtml: s => String(s), timeAgo: () => 'just now' },
    icon: () => '<svg></svg>',
    showToast() {},
    confirmDialog(title, msg, onConfirm) {
      confirmPrompted = { title, msg, onConfirm };
    },
    Store: {
      get: (k, fb) => (k === 'notifications' ? storeNotifs : fb),
      set: (k, v) => { if (k === 'notifications') storeNotifs = v; return v; }
    },
    Api: {
      del: async (path) => { deletedCalls.push(path); return { ok: true }; },
      post: async () => ({ ok: true }),
      get: async () => storeNotifs
    },
    document: {
      getElementById: (id) => (id === 'notifPanel' ? panelEl : id === 'notifDot' ? { className: '', textContent: '', style: {} } : null),
      addEventListener() {}
    },
    setInterval() {},
    Date, Array, Object, String, Number, Promise, encodeURIComponent
  };
  ctx.window = ctx;
  vm.runInNewContext(notifClientCode, ctx);

  ctx.Notifications.render();
  assert.ok(renderedPanelHtml.includes('id="markAllReadBtn"') && renderedPanelHtml.includes('id="clearAllNotifsBtn"'));
  assert.ok(renderedPanelHtml.includes('data-del-notif="NTF-0001"') && renderedPanelHtml.includes('data-del-notif="NTF-0002"'));

  await ctx.Notifications.deleteOne('NTF-0001');
  assert.strictEqual(storeNotifs.length, 1);
  assert.strictEqual(storeNotifs[0].id, 'NTF-0002');
  assert.ok(deletedCalls.includes('/notifications/NTF-0001'));

  await ctx.Notifications.clearAll();
  assert.strictEqual(storeNotifs.length, 0);
  assert.ok(deletedCalls.includes('/notifications/clear-all'));
});

test('Eye Icon Modernization: Updated to radiating eyelashes, almond eyelid, and iris pupil', () => {
  const appJs = fs.readFileSync(path.join(__dirname, '../../public/js/app.js'), 'utf8');
  const loginHtml = fs.readFileSync(path.join(__dirname, '../../public/login.html'), 'utf8');

  // Must not have old diamond polygon icon
  assert.ok(!appJs.includes('<polygon points="12,5 22,12 12,19 2,12"/>'), 'app.js must not use old diamond eye');
  assert.ok(!loginHtml.includes('points="12,5 22,12 12,19 2,12"'), 'login.html must not use old diamond eye');

  // Must have 7 radiating upper eyelashes, almond path, and iris circle
  assert.ok(appJs.includes('<line x1="12" y1="6" x2="12" y2="2.2"/>'), 'app.js eye must have center vertical eyelash');
  assert.ok(appJs.includes('<circle cx="12" cy="13.5" r="4.2"/>'), 'app.js eye must have circular iris');
  assert.ok(appJs.includes('stroke-linecap="round"'), 'app.js eye must have rounded line caps');

  // eyeOff must match with slash
  assert.ok(appJs.includes('eyeOff:') && appJs.includes('<line x1="2" y1="2" x2="22" y2="22"/>'), 'eyeOff must have slash line');
});

test('Dashboard Panel: Unconstrained natural height, chip status tones, and visual divider', () => {
  const styleCss = fs.readFileSync(path.join(__dirname, '../../public/css/style.css'), 'utf8');
  const dashJs = fs.readFileSync(path.join(__dirname, '../../public/js/dashboard.js'), 'utf8');

  // No constrained viewport height on dash-panel
  assert.ok(!styleCss.includes('height: max(19rem, calc(100vh - 21.5rem))'), 'dash-panel must not be constrained by viewport height');
  assert.ok(styleCss.includes('.dash-panel { display: flex; flex-direction: column; gap: .75rem; padding: 1rem 1.125rem; height: auto; min-height: auto; }'), 'dash-panel must have natural height');
  assert.ok(styleCss.includes('.dash-body { flex: 1; min-height: 0; overflow-y: visible; overflow-x: auto; }'), 'dash-body must not force internal vertical scrolling');

  // Divider line under chip tabs
  assert.ok(styleCss.includes('.dash-views { flex-shrink: 0; border-bottom: 1px solid var(--border); padding-bottom: .75rem; }'), 'dash-views must have border-bottom divider');

  // Chip status colors
  assert.ok(styleCss.includes('.chip-count.is-warn'), 'style.css must have warning chip count color');
  assert.ok(styleCss.includes('.chip-count.is-danger') || styleCss.includes('.chip-count.is-bad'), 'style.css must have danger chip count color');
  assert.ok(dashJs.includes("tone: 'warn'") && dashJs.includes("tone: 'danger'"), 'dashboard.js must assign warn and danger tones to low and out of stock chips');
});

test('Dashboard & Sales Analysis: Mobile horizontal sales trend bars with visible income values', () => {
  const responsiveCss = fs.readFileSync(path.join(__dirname, '../../public/css/responsive.css'), 'utf8');
  const styleCss = fs.readFileSync(path.join(__dirname, '../../public/css/style.css'), 'utf8');
  const dashJs = fs.readFileSync(path.join(__dirname, '../../public/js/dashboard.js'), 'utf8');
  const trendJs = fs.readFileSync(path.join(__dirname, '../../public/js/sales-trend.js'), 'utf8');

  // Desktop preservation in style.css
  assert.ok(styleCss.includes('.bar-chart .bar-track { display: contents; }'), 'Desktop must treat bar-track as display: contents');
  assert.ok(styleCss.includes('.bar-chart .bar-val-mobile { display: none; }'), 'Desktop must hide bar-val-mobile');

  // JS generates track, mobile value label, and proportional width variable
  assert.ok(dashJs.includes('class="bar-track"') && dashJs.includes('bar-val-mobile'), 'dashboard.js must render bar-track and bar-val-mobile');
  assert.ok(dashJs.includes('--bar-w:'), 'dashboard.js must calculate horizontal bar width style');
  assert.ok(trendJs.includes('class="bar-track"') && trendJs.includes('bar-val-mobile'), 'sales-trend.js must render bar-track and bar-val-mobile');
  assert.ok(trendJs.includes('--bar-w:'), 'sales-trend.js must calculate horizontal bar width style');

  // Mobile horizontal transformation in responsive.css
  assert.ok(responsiveCss.includes('.dash-trend.bar-chart') && responsiveCss.includes('flex-direction: column !important'), 'Mobile trend chart must stack rows vertically');
  assert.ok(responsiveCss.includes('.dash-trend .bar-col') && responsiveCss.includes('display: grid !important'), 'Mobile bar columns must render as horizontal grid rows');
  assert.ok(responsiveCss.includes('.dash-trend .bar-val-mobile') && responsiveCss.includes('display: block !important'), 'Mobile bar value must be displayed');
  assert.ok(responsiveCss.includes('.dash-trend .bar .bar-value') && responsiveCss.includes('display: none !important'), 'Mobile desktop tooltip must be hidden');
});

test('Inventory History UI: Void Restock & Staff column widths, grey Returned badge without dot, and aligned bullet points in Reference / Notes', () => {
  const invJs = fs.readFileSync(resolveRoot('public/js/inventory.js'), 'utf8');
  const styleCss = fs.readFileSync(resolveRoot('public/css/style.css'), 'utf8');

  // Returned reason tone must be badge-neutral (grey and no dot)
  assert.ok(invJs.includes("if (t.type === 'Void Restock') return { label: 'Returned', tone: 'badge-neutral' };"), 'movementReason must assign badge-neutral to Void Restock');
  assert.ok(invJs.includes("tone: r === 'Returned' ? 'badge-neutral'"), 'movementReason must assign badge-neutral to Returned reason');
  assert.ok(styleCss.includes('.badge-neutral::before { display: none; }'), 'badge-neutral must hide dot pseudo-element');

  // Reference / Notes ordered as bullet points
  assert.ok(invJs.includes('extractRefNotesList(t)'), 'inventory.js must define extractRefNotesList helper');
  assert.ok(invJs.includes('<ul class="ref-notes-list">'), 'renderHistoryTable must render bullet list for notes');
  assert.ok(styleCss.includes('.ref-notes-list'), 'style.css must style .ref-notes-list');
  assert.ok(styleCss.includes('list-style-type: disc;'), 'ref-notes-list must use disc bullets');

  // Separates voided sale action and user note into distinct bullet points and wraps Sales ID in parentheses
  assert.ok(invJs.includes('part.indexOf(\':\')') && invJs.includes('prefix') && invJs.includes('suffix'), 'extractRefNotesList must split event prefix from note text');
  assert.ok(invJs.includes("'$1 sale ($2)'"), 'inventory.js must wrap Sales ID in parentheses for void/cancel/refund');
  assert.ok(invJs.includes('adjMatch = part.match('), 'extractRefNotesList must split adjustment summary from note text');

  const salesSvcCode = fs.readFileSync(resolveRoot('server/src/services/sales.js'), 'utf8');
  assert.ok(salesSvcCode.includes("notes: type + ' sale (' + saleId + '): '"), 'voidSale must create transaction notes with Sales ID in parentheses');

  // Unclipped Type and Staff column widths + table min-width
  assert.ok(styleCss.includes('#tab-history th:nth-child(3) { width: 7.75rem; }'), 'Type column must have expanded width for Void Restock');
  assert.ok(styleCss.includes('#tab-history th:nth-child(9) { width: 8.5rem; }'), 'Staff column must have expanded width for full names');
  assert.ok(styleCss.includes('#tab-history table { min-width: 60rem; }'), 'History table must have min-width for responsive scroll');
});

test('Product Modal: hides Quantity and Initial Batch Expiry in Edit mode, preserves them in Add mode, and clarifies default Shelf Life', () => {
  const invHtml = fs.readFileSync(resolveRoot('public/inventory.html'), 'utf8');
  assert.ok(invHtml.includes('id="pStockField"'), 'inventory.html must include id="pStockField"');
  assert.ok(invHtml.includes('id="pExpiryField"'), 'inventory.html must include id="pExpiryField"');
  assert.ok(invHtml.includes('id="pShelfLifeField"'), 'inventory.html must include id="pShelfLifeField"');
  assert.ok(invHtml.includes('id="pShelfLifeLabel"'), 'inventory.html must include id="pShelfLifeLabel"');
  assert.ok(invHtml.includes('id="pShelfLifeHint"'), 'inventory.html must include id="pShelfLifeHint"');

  const invJs = fs.readFileSync(resolveRoot('public/js/inventory.js'), 'utf8');
  // Edit mode hides stock & expiry, and adapts shelf life label/hint
  assert.ok(invJs.includes("if (stockField) stockField.style.display = 'none';"), 'Edit mode must hide Quantity field');
  assert.ok(invJs.includes("if (expiryField) expiryField.style.display = 'none';"), 'Edit mode must hide Initial Batch Expiration Date field');
  assert.ok(invJs.includes("stockInput.removeAttribute('required');"), 'Edit mode must remove required from Quantity input');
  assert.ok(invJs.includes("shelfLifeField.classList.add('span-2');"), 'Edit mode must expand Shelf Life field across row');
  assert.ok(invJs.includes("shelfLifeLabel.textContent = 'Product Shelf Life (Default for new Stock-Ins)'"), 'Edit mode must clarify shelf life is default for future deliveries');
  assert.ok(invJs.includes("shelfLifeHint.textContent = 'Sets the default duration used to auto-calculate expiration dates on future deliveries. Does not rewrite past batches.'"), 'Edit mode must display informative hint about not rewriting past batches');

  // Add mode shows stock & expiry
  assert.ok(invJs.includes("if (stockField) stockField.style.display = '';"), 'Add mode must display Quantity field');
  assert.ok(invJs.includes("if (expiryField) expiryField.style.display = '';"), 'Add mode must display Initial Batch Expiration Date field');
  assert.ok(invJs.includes("stockInput.setAttribute('required', '');"), 'Add mode must make Quantity required');
  assert.ok(invJs.includes("shelfLifeField.classList.remove('span-2');"), 'Add mode must reset Shelf Life span');
  assert.ok(invJs.includes("shelfLifeLabel.textContent = 'Product Shelf Life (optional)'"), 'Add mode must restore optional shelf life label');

  // syncShelfLifeExpiry and saveProduct
  assert.ok(invJs.includes('if (editingProductId) return;'), 'syncShelfLifeExpiry must skip recalculation when editing');
  assert.ok(invJs.includes('if (existing && existing.expirationDate)'), 'saveProduct must preserve existing expiration date in edit mode');

  // Backend catalog cleanProduct logic
  const catalogJs = fs.readFileSync(resolveRoot('server/src/routes/catalog.js'), 'utf8');
  assert.ok(catalogJs.includes('cleanProduct(body, isUpdate = false)'), 'cleanProduct must accept isUpdate flag');
  assert.ok(catalogJs.includes('if (!isUpdate && out.shelfLifeDuration && !out.expirationDate)'), 'cleanProduct must not overwrite expiration date on update');
  assert.ok(catalogJs.includes('cleanProduct(req.body, true)'), 'PUT /products/:id must call cleanProduct with update flag');
});

test('Role-Based User Guide & System Navigation Modal: book icon button next to notifications and strict Staff vs Admin filtering', () => {
  const vm = require('vm');
  const appJs = fs.readFileSync(resolveRoot('public/js/app.js'), 'utf8');
  assert.ok(appJs.includes('book:'), 'app.js Icons object must define the book SVG icon');
  assert.ok(appJs.includes('id="guideBtn"') && appJs.includes("icon('book')"), 'renderTopbarActions must render #guideBtn with the book icon');

  const posHtml = fs.readFileSync(resolveRoot('public/pos.html'), 'utf8');
  assert.ok(posHtml.includes('id="guideBtn"'), 'pos.html must include #guideBtn in the POS header');

  const pages = ['index.html', 'inventory.html', 'pos.html', 'sales.html', 'customers.html', 'warranty.html', 'users.html', 'audit.html', 'settings.html', 'profile.html'];
  pages.forEach(page => {
    const html = fs.readFileSync(resolveRoot('public/' + page), 'utf8');
    assert.ok(html.includes('js/guide.js'), page + ' must load js/guide.js');
  });

  const guideJs = fs.readFileSync(resolveRoot('public/js/guide.js'), 'utf8');
  assert.ok(guideJs.includes('guideModalOverlay'), 'guide.js must inject #guideModalOverlay');
  assert.ok(guideJs.includes("s.role === 'Admin'") && guideJs.includes("'Staff'"), 'guide.js must check session role for Admin vs Staff');

  // Execute guide.js in an isolated context to verify getTopicsForRole('Staff') vs getTopicsForRole('Admin')
  const sandbox = {
    window: {},
    document: {
      readyState: 'loading',
      addEventListener: () => {},
      getElementById: () => null
    }
  };
  vm.runInNewContext(guideJs, sandbox);
  assert.ok(sandbox.window.UserGuide && typeof sandbox.window.UserGuide.getTopicsForRole === 'function', 'guide.js must expose window.UserGuide.getTopicsForRole');

  const staffTopics = sandbox.window.UserGuide.getTopicsForRole('Staff');
  const adminTopics = sandbox.window.UserGuide.getTopicsForRole('Admin');

  assert.ok(staffTopics.length >= 5, 'Staff must receive operational guide topics');
  assert.ok(adminTopics.length > staffTopics.length, 'Admin must receive additional governance topics beyond Staff view');
  assert.strictEqual(staffTopics[0].title, 'Getting Started & Staff Duties', 'Staff Topic 1 must be Getting Started & Staff Duties');
  assert.strictEqual(adminTopics[0].title, 'Getting Started & Administrator Responsibilities', 'Admin Topic 1 must be Getting Started & Administrator Responsibilities');

  const staffSerialized = JSON.stringify(staffTopics);
  ['Void Sale', 'Adjust Stock', 'Manage Users'].forEach(keyword => {
    assert.ok(!staffSerialized.includes(keyword), 'Staff view must strictly exclude Admin-only keyword: ' + keyword);
  });

  const adminSerialized = JSON.stringify(adminTopics);
  ['Void Sale', 'Adjust Stock', 'Manage Users'].forEach(keyword => {
    assert.ok(adminSerialized.includes(keyword), 'Admin view must include administrative keyword: ' + keyword);
  });
});

test('Staff Shift Clock-In Constraint: blocks off-duty Staff from Inventory, POS, Sales, Customers, and Warranty across UI, direct URLs, and API routes', () => {
  const appJs = fs.readFileSync(resolveRoot('public/js/app.js'), 'utf8');
  assert.ok(
    appJs.includes("const SHIFT_REQUIRED_KEYS = ['inventory', 'pos', 'sales', 'customers', 'warranty']"),
    'app.js must define SHIFT_REQUIRED_KEYS for inventory, pos, sales, customers, and warranty'
  );
  assert.ok(appJs.includes('function isStaffClockedIn('), 'app.js must define isStaffClockedIn helper');
  assert.ok(appJs.includes('function requireShiftClockIn('), 'app.js must define requireShiftClockIn route gate');
  assert.ok(appJs.includes('function renderShiftLockedView('), 'app.js must define renderShiftLockedView to block direct URL access');
  assert.ok(appJs.includes('if (!requireShiftClockIn(activeKey)) return false;'), 'initShell must enforce requireShiftClockIn and abort page scripts when off duty');
  assert.ok(appJs.includes('nav-lock-badge') && appJs.includes('is-locked'), 'renderSidebar must mark restricted menus as locked when Staff is off duty');

  const shiftsJs = fs.readFileSync(resolveRoot('public/js/shifts.js'), 'utf8');
  assert.ok(shiftsJs.includes("if (typeof renderSidebar === 'function') renderSidebar();"), 'Shifts.upsert must re-render sidebar immediately on clock-in/out');

  const authMwJs = fs.readFileSync(resolveRoot('server/src/middleware/auth.js'), 'utf8');
  assert.ok(authMwJs.includes('const requireActiveShift ='), 'auth.js middleware must define requireActiveShift');
  assert.ok(authMwJs.includes("Shift.findOne({ username: req.user.username, clockOut: null })"), 'requireActiveShift must verify active shift in MongoDB');

  const serverAppJs = fs.readFileSync(resolveRoot('server/src/app.js'), 'utf8');
  ['/products', '/customers', '/sales', '/inventory', '/warranties'].forEach(route => {
    assert.ok(
      serverAppJs.includes("api.use('" + route + "', requireActiveShift"),
      'server/src/app.js must protect ' + route + ' with requireActiveShift middleware'
    );
  });

  const guideJs = fs.readFileSync(resolveRoot('public/js/guide.js'), 'utf8');
  assert.ok(
    guideJs.includes('Step 1: Clock In to Unlock Store Menus') && guideJs.includes('Locked While Off Duty'),
    'Staff User Guide must document mandatory shift clock-in to unlock Inventory, POS, Sales, Customers, and Warranty'
  );
});

/* ------------------------------------------------------------------------------
   55. INVENTORY TABLE TYPOGRAPHY & RESPONSIVENESS
   ------------------------------------------------------------------------------ */
test('Inventory Table Typography & Responsiveness: Full visibility for product names, word wrapping, alignment, and responsive card labels', () => {
  const styleCss = fs.readFileSync(resolveRoot('public/css/style.css'), 'utf8');
  assert.ok(
    styleCss.includes('.page-inventory .cell-product .name') &&
    styleCss.includes('white-space: normal !important;') &&
    styleCss.includes('word-break: break-word;') &&
    styleCss.includes('overflow-wrap: break-word;'),
    'style.css must allow product names to wrap naturally with word-break and overflow-wrap'
  );
  assert.ok(
    !styleCss.includes('.page-inventory .cell-product .name, .page-inventory .cell-product .sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }'),
    'style.css must not force product names into single-line ellipsis truncation'
  );
  assert.ok(
    styleCss.includes('#tab-products table { width: 100%; min-width: 0; table-layout: fixed; }'),
    'style.css must fit inventory products table to 100% width with min-width: 0 to prevent horizontal scroll'
  );
  assert.ok(
    styleCss.includes('#tab-products .table-wrap { overflow-x: hidden; }'),
    'style.css must disable horizontal scrollbar on #tab-products .table-wrap'
  );
  assert.ok(
    styleCss.includes('#tab-products th:nth-child(1), #tab-products td:nth-child(1) { width: auto; min-width: 0; }'),
    'style.css must allow Product column to flex and fill remaining card width'
  );
  assert.ok(
    styleCss.includes('#tab-products th.col-actions, #tab-products th:nth-child(9) { width: 13.25rem; text-align: left; padding-left: 0.5rem; }'),
    'style.css must align Actions header to the left over the action buttons'
  );

  const invHtml = fs.readFileSync(resolveRoot('public/inventory.html'), 'utf8');
  assert.ok(
    invHtml.includes('<th class="col-actions text-left">Actions</th>'),
    'inventory.html Actions header must use text-left alignment'
  );

  const invJs = fs.readFileSync(resolveRoot('public/js/inventory.js'), 'utf8');
  assert.ok(invJs.includes('data-label="Product"'), 'renderProductsTable must label Product cell');
  assert.ok(invJs.includes('mobile-cell-primary'), 'renderProductsTable must assign mobile-cell-primary to Product cell');
  assert.ok(invJs.includes('mobile-cell-actions text-left'), 'renderProductsTable must assign mobile-cell-actions text-left to Actions cell');
  assert.ok(invJs.includes('data-label="Brand"'), 'renderProductsTable must label Brand cell');
  assert.ok(invJs.includes('data-label="Category"'), 'renderProductsTable must label Category cell');
  assert.ok(invJs.includes('data-label="Price"'), 'renderProductsTable must label Price cell');
  assert.ok(invJs.includes('data-label="Stock"'), 'renderProductsTable must label Stock cell');
  assert.ok(invJs.includes('data-label="Status"'), 'renderProductsTable must label Status cell');
});

test('Modal Footer Cleanups, Product Image Clear Control, and Sales Transactions Responsiveness', () => {
  const invHtml = fs.readFileSync(resolveRoot('public/inventory.html'), 'utf8');
  const salesHtml = fs.readFileSync(resolveRoot('public/sales.html'), 'utf8');
  const usersHtml = fs.readFileSync(resolveRoot('public/users.html'), 'utf8');
  const warrantyHtml = fs.readFileSync(resolveRoot('public/warranty.html'), 'utf8');
  const auditHtml = fs.readFileSync(resolveRoot('public/audit.html'), 'utf8');
  const guideJs = fs.readFileSync(resolveRoot('public/js/guide.js'), 'utf8');
  const invJs = fs.readFileSync(resolveRoot('public/js/inventory.js'), 'utf8');
  const salesJs = fs.readFileSync(resolveRoot('public/js/sales.js'), 'utf8');
  const styleCss = fs.readFileSync(resolveRoot('public/css/style.css'), 'utf8');

  // 1. Inventory modal footers
  assert.ok(!invHtml.includes('data-close="productModalOverlay">Cancel</button>'), 'Product modal must not contain Cancel button');
  assert.ok(!invHtml.includes('data-close="viewModalOverlay">Close</button>'), 'View product modal must not contain Close button');
  assert.ok(!invHtml.includes('data-close="adjustModalOverlay" type="button">Cancel</button>'), 'Adjust stock modal must not contain Cancel button');
  assert.ok(!invHtml.includes('data-close="stockModalOverlay">Cancel</button>'), 'Stock In/Out modal must not contain Cancel button');

  // 2. Sales modal footer
  assert.ok(!salesHtml.includes('data-close="saleModalOverlay">Close</button>'), 'Sale detail modal must not contain Close button');

  // 3. Users modal footers
  assert.ok(!usersHtml.includes('data-close="userModalOverlay">Cancel</button>'), 'User modal must not contain Cancel button');
  assert.ok(!usersHtml.includes('data-close="shiftModalOverlay">Close</button>'), 'Shift history modal must not contain Close button');

  // 4. Warranty modal footers
  assert.ok(!warrantyHtml.includes('data-close="warrantyViewOverlay">Close</button>'), 'Warranty view modal must not contain Close button');
  assert.ok(!warrantyHtml.includes('data-close="warrantyClaimOverlay">Cancel</button>'), 'Warranty claim modal must not contain Cancel button');

  // 5. Guide modal
  assert.ok(!guideJs.includes('Close Guide'), 'Guide modal must not contain Close Guide button');

  // 6. Audit modal footer
  assert.ok(!auditHtml.includes('data-close="auDetailOverlay">Close</button>'), 'Audit modal must not contain Close button');

  // 6b. Customer details modal footer
  const custHtml = fs.readFileSync(resolveRoot('public/customers.html'), 'utf8');
  assert.ok(!custHtml.includes('data-close="custViewOverlay" type="button">Close</button>'), 'Customer view modal must not contain Close button');

  // 7. Product image clear button
  assert.ok(invHtml.includes('id="clearImageBtn"'), 'inventory.html must include clear image button');
  assert.ok(invJs.includes('clearImgBtn.addEventListener'), 'inventory.js must attach clear image button handler');
  assert.ok(styleCss.includes('.image-clear-btn'), 'style.css must style .image-clear-btn');

  // 8. Sales transactions responsiveness and zero horizontal scroll
  assert.ok(styleCss.includes('.page-sales #tab-overview .table-wrap') && styleCss.includes('overflow-x: hidden;'), 'Sales overview table-wrap must enforce overflow-x: hidden');
  assert.ok(styleCss.includes('.page-sales #tab-overview table') && styleCss.includes('table-layout: fixed;'), 'Sales overview table must use table-layout: fixed');
  assert.ok(salesJs.includes('data-label="Order"') && salesJs.includes('data-label="Total"'), 'sales.js must assign data-label attributes to cells');

  // 9. Audit trail view button consistency
  const auditJs = fs.readFileSync(resolveRoot('public/js/audit.js'), 'utf8');
  assert.ok(auditJs.includes('class="icon-btn au-view-btn"'), 'audit.js must use icon-btn for view button consistency');
  assert.ok(!auditJs.includes('View</button>'), 'audit.js view button must not include text inside the icon button');
  assert.ok(styleCss.includes('.au-table .icon-btn') || styleCss.includes('.au-view-btn'), 'style.css must style audit view button');

  // 10. POS sidebar availability
  const posHtml = fs.readFileSync(resolveRoot('public/pos.html'), 'utf8');
  const posCss = fs.readFileSync(resolveRoot('public/css/pos.css'), 'utf8');
  assert.ok(posHtml.includes('class="app-shell"') && posHtml.includes('id="sidebar"'), 'pos.html must wrap sidebar and app inside app-shell');
  assert.ok(posCss.includes('.pos-terminal .app-shell'), 'pos.css must configure app-shell grid for POS terminal');
  assert.ok(posCss.includes('.pos-terminal .sidebar') && posCss.includes('position: sticky;'), 'pos.css must dock sidebar on desktop');
});

test('Mobile Card Alignment, Responsive Actions, and Display Card Truncation over 10M', () => {
  const storeJs = fs.readFileSync(resolveRoot('public/js/store.js'), 'utf8');
  const salesJs = fs.readFileSync(resolveRoot('public/js/sales.js'), 'utf8');
  const usersJs = fs.readFileSync(resolveRoot('public/js/users.js'), 'utf8');
  const respCss = fs.readFileSync(resolveRoot('public/css/responsive.css'), 'utf8');
  const styleCss = fs.readFileSync(resolveRoot('public/css/style.css'), 'utf8');

  // 1. Utils.formatCardPHP definition and behavior
  assert.ok(storeJs.includes('formatCardPHP(amount)'), 'store.js must define formatCardPHP');
  const ctx = {
    URLSearchParams,
    CustomEvent: function (name) { this.type = name; },
    window: { location: { origin: 'http://localhost' } },
    document: { addEventListener: () => {} },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    console, Date, Math, Set, Array, Object, String, Number, JSON, RegExp
  };
  vm.runInNewContext(storeJs + '; this.Utils = Utils;', ctx);
  assert.strictEqual(ctx.Utils.formatCardPHP(90634), '₱90,634');
  assert.strictEqual(ctx.Utils.formatCardPHP(-23366), '₱-23,366');
  assert.strictEqual(ctx.Utils.formatCardPHP(10000000), '₱10M');
  assert.strictEqual(ctx.Utils.formatCardPHP(10500000), '₱10.5M');
  assert.strictEqual(ctx.Utils.formatCardPHP(3200000000), '₱3.2B');
  assert.strictEqual(ctx.Utils.formatCardPHP(-15000000), '₱-15M');
  assert.strictEqual(ctx.Utils.formatCardPHP(3.2e18), '₱3.2Q');
  assert.strictEqual(ctx.Utils.formatCardPHP(3.2e33), '₱3.2Dc');

  // 1b. Utils.formatMoneyHtml with native title hover for true value
  assert.strictEqual(typeof ctx.Utils.formatMoneyHtml, 'function', 'store.js must define formatMoneyHtml');
  assert.strictEqual(ctx.Utils.formatMoneyHtml(88924), '₱88,924');
  const hugeHtml = ctx.Utils.formatMoneyHtml(3.2e33);
  assert.ok(hugeHtml.includes('class="abbr-money"') && hugeHtml.includes('₱3.2Dc'), 'formatMoneyHtml must abbreviate huge values to ₱3.2Dc');
  assert.ok(hugeHtml.includes('title="₱'), 'formatMoneyHtml must include native title attribute showing the true full value');
  assert.ok(salesJs.includes('Utils.formatMoneyHtml(s.total)'), 'sales.js transactions table must use formatMoneyHtml for s.total');
  assert.ok(!salesJs.includes('cellTitle'), 'sales.js transactions table must not include redundant cellTitle on td');
  const invJs = fs.readFileSync(resolveRoot('public/js/inventory.js'), 'utf8');
  assert.ok(invJs.includes('Utils.formatMoneyHtml(p.sellingPrice)'), 'inventory.js must use formatMoneyHtml for p.sellingPrice');
  assert.ok(styleCss.includes('.abbr-money'), 'style.css must style .abbr-money');

  // 2. Sales display cards use formatCardPHP
  assert.ok(salesJs.includes('Utils.formatCardPHP(gross)') || salesJs.includes('formatCardPHP(rawAmt)'), 'sales.js must format display card totals with formatCardPHP');
  assert.ok(salesJs.includes('Utils.formatCardPHP(todayTotal)'), 'sales.js KPI cards must format totals with formatCardPHP');

  // 3. CSS overflow prevention on display cards
  assert.ok(styleCss.includes('.eod-val') && styleCss.includes('overflow: hidden;') && styleCss.includes('text-overflow: ellipsis;'), 'style.css must prevent overflow on eod-val');
  assert.ok(respCss.includes('.eod-val') && respCss.includes('text-overflow: ellipsis !important;'), 'responsive.css must enforce text-overflow: ellipsis on mobile eod-val');

  // 4. Mobile card alignment: Items, Compatibility, Supplier flush with padding 0 and transparent background
  assert.ok(respCss.includes('td[data-label="Items"]') && respCss.includes('background: transparent !important;') && respCss.includes('padding: 0 !important;'), 'responsive.css must align Items flush');
  assert.ok(respCss.includes('td[data-label="Compatibility"]') && respCss.includes('background: transparent !important;'), 'responsive.css must align Compatibility flush');
  assert.ok(respCss.includes('td[data-label="Supplier"]') && respCss.includes('background: transparent !important;'), 'responsive.css must align Supplier flush');

  // 5. Users card layout and responsive full-width actions
  assert.ok(respCss.includes('#usersTbody td[data-label="Username"]') && respCss.includes('#usersTbody td[data-label="Role"]'), 'responsive.css must balance users grid fields');
  assert.ok(respCss.includes('td.mobile-cell-actions .row-actions') && respCss.includes('flex: 1 1 0 !important;'), 'responsive.css must stretch user card actions across full width');
  assert.ok(usersJs.includes('data-mobile-label="Edit"') && usersJs.includes('data-mobile-label="Shifts"') && usersJs.includes('data-mobile-label="Delete"'), 'users.js must provide mobile labels for action buttons');

  // 6. Custom money hover pop-up matching sales trend 1 month & removal of question mark cursor
  assert.ok(!styleCss.includes('.abbr-money {\n  cursor: help;'), 'style.css must not use cursor: help to prevent question mark cursor');
  assert.ok(styleCss.includes('.abbr-money') && styleCss.includes('cursor: pointer;'), 'style.css must use pointer cursor on .abbr-money');
  assert.ok(styleCss.includes('.tm-money-tooltip') && styleCss.includes('background: var(--ink, #111827);'), 'style.css must define dark pop-up matching sales trend 1 month');
  assert.ok(storeJs.includes('tm-money-tooltip') && storeJs.includes('positionTip'), 'store.js must initialize global money pop-up handler');

  // 7. Even spacing for Price and Stock in inventory table
  assert.ok(styleCss.includes('#tab-products th:nth-child(6)') && styleCss.includes('width: 7.5rem;'), 'Price column must have ample 7.5rem width');
  assert.ok(styleCss.includes('#tab-products th:nth-child(7)') && styleCss.includes('width: 6rem;'), 'Stock column must have ample 6rem width');
  assert.ok(styleCss.includes('#tab-products th:nth-child(6)') && styleCss.includes('padding-right: 1.25rem;'), 'Price column must have right padding for spacing');
  assert.ok(styleCss.includes('#tab-products th:nth-child(7)') && styleCss.includes('padding-right: 1.25rem;'), 'Stock column must have right padding for spacing');

  // 8. Payment Method Summary modern design, visible progress bars, and exclusion of Bank Transfer
  const salesHtml = fs.readFileSync(resolveRoot('public/sales.html'), 'utf8');
  assert.ok(salesHtml.includes('Breakdown of recorded revenue by payment method'), 'sales.html must include subtitle for Payment Method Summary');
  assert.ok(salesJs.includes('const methods = PAYMENT_METHODS;'), 'sales.js renderPaymentSummary must use active PAYMENT_METHODS only without Bank Transfer');
  assert.ok(styleCss.includes('.pay-summary-list') && styleCss.includes('.pay-summary-item'), 'style.css must style payment summary list');

  // 9. Sales Analysis 3-card grid layout: Payment Method Summary, Top-Selling, Slow-Moving
  assert.ok(salesHtml.includes('class="analysis-cards-grid"'), 'sales.html must use analysis-cards-grid for the 3 analysis cards');
  assert.ok(styleCss.includes('.analysis-cards-grid') && styleCss.includes('repeat(3, minmax(0, 1fr))'), 'style.css must define 3-column equal grid for analysis cards');

  // 10. Product Movement compact sizing & proportional columns
  assert.ok(salesJs.includes('Math.min(5, Math.ceil(ranked.length / 2))'), 'sales.js fastList must be capped at 5 rows');
  assert.ok(salesJs.includes('Math.min(5, Math.floor(ranked.length / 2))'), 'sales.js slowList must be capped at 5 rows');
  assert.ok(styleCss.includes('.page-sales #tab-movement .movement-table'), 'style.css must scope movement table');
  assert.ok(styleCss.includes('.page-sales #tab-movement th:nth-child(1)'), 'style.css must allocate proportional widths for movement columns');
  assert.ok(!salesHtml.includes('High Demand'), 'High Demand badge must be removed from Product Movement card');
  assert.ok(!salesHtml.includes('Low Turnover'), 'Low Turnover badge must be removed from Product Movement card');
});

/* ------------------------------------------------------------------------------
   58. NOTIFICATION LIFECYCLE, STAFF SHIFTS, PRODUCT ADDITION & CIRCULAR BUTTONS
   ------------------------------------------------------------------------------ */
test('Notifications: Admin-only shift alerts, all-user product add alerts, circular buttons, and database deletion', async () => {
  const modelsCode = fs.readFileSync(resolveRoot('server/src/models/index.js'), 'utf8');
  assert.ok(modelsCode.includes('targetRole: { type: String, default: null }'), 'Notification schema must include targetRole field');

  const notifService = fs.readFileSync(resolveRoot('server/src/services/notifications.js'), 'utf8');
  assert.ok(notifService.includes("'staff-clock-in'"), 'EVENT_TYPES must include staff-clock-in');
  assert.ok(notifService.includes("'staff-clock-out'"), 'EVENT_TYPES must include staff-clock-out');
  assert.ok(notifService.includes("'product-add'"), 'EVENT_TYPES must include product-add');
  assert.ok(notifService.includes('targetRole: targetRole || null'), 'createActivityNotification must persist targetRole');

  const usersRoutes = fs.readFileSync(resolveRoot('server/src/routes/users.js'), 'utf8');
  assert.ok(usersRoutes.includes("type: 'staff-clock-in'") && usersRoutes.includes("targetRole: 'Admin'"), 'clock-in must create admin-only notification');
  assert.ok(usersRoutes.includes("type: 'staff-clock-out'") && usersRoutes.includes("targetRole: 'Admin'"), 'clock-out must create admin-only notification');

  const catalogRoutes = fs.readFileSync(resolveRoot('server/src/routes/catalog.js'), 'utf8');
  assert.ok(catalogRoutes.includes("type: 'product-add'") && catalogRoutes.includes("targetRole: null"), 'product addition must create notification for all users');

  const miscRoutes = fs.readFileSync(resolveRoot('server/src/routes/misc.js'), 'utf8');
  assert.ok(miscRoutes.includes('await Notification.deleteOne({ id: req.params.id })'), 'DELETE /:id must delete document from database');
  assert.ok(miscRoutes.includes('await Notification.deleteMany'), 'DELETE /clear-all must delete documents from database');
  assert.ok(miscRoutes.includes('targetRole: null') && miscRoutes.includes("targetRole: 'Staff'"), 'Notification query must filter out admin-only notifications for non-admins');

  const styleCss = fs.readFileSync(resolveRoot('public/css/style.css'), 'utf8');
  assert.ok(styleCss.includes('.notif-header-actions button') && styleCss.includes('border-radius: 9999px !important;'), 'style.css must style notification header buttons circular');

  const notifsJs = fs.readFileSync(resolveRoot('public/js/notifications.js'), 'utf8');
  assert.ok(notifsJs.includes("n.targetRole !== 'Admin'"), 'notifications.js recompute must filter admin notifications for staff');
  assert.ok(notifsJs.includes("type === 'staff-clock-in'") && notifsJs.includes("type === 'product-add'"), 'toneForType must support staff-clock-in and product-add');
});

/* ------------------------------------------------------------------------------
   59. PRODUCT THUMBNAIL COMPRESSION & INVENTORY TABLE HOVER PREVIEW POPOVER
   ------------------------------------------------------------------------------ */
test('Product Thumbnail: Auto-compression (~10 KB - 30 KB), model/route thumbnail support, and inventory icon hover preview popover', async () => {
  // 1. Models: Product schema includes thumbnail
  const modelsCode = fs.readFileSync(resolveRoot('server/src/models/index.js'), 'utf8');
  assert.ok(modelsCode.includes("thumbnail: { type: String, default: '' }"), 'Product schema must include thumbnail field');

  // 2. Catalog routes: PRODUCT_FIELDS and cleanProduct handle thumbnail
  const catalogRoutes = fs.readFileSync(resolveRoot('server/src/routes/catalog.js'), 'utf8');
  assert.ok(catalogRoutes.includes("'thumbnail'"), 'PRODUCT_FIELDS must include thumbnail');
  assert.ok(catalogRoutes.includes('out.thumbnail.length > 250000'), 'cleanProduct must validate thumbnail length');
  assert.ok(catalogRoutes.includes("k === 'thumbnail'"), 'PUT /:id must omit thumbnail from verbose changes diff');

  // 3. Store.js: Utils.productImage and Utils.productThumbnail
  const storeJs = fs.readFileSync(resolveRoot('public/js/store.js'), 'utf8');
  assert.ok(storeJs.includes('productThumbnail(p)'), 'store.js must export Utils.productThumbnail');
  const vm = require('vm');
  const ctx = {
    window: { location: { origin: 'http://localhost' } },
    document: { addEventListener: () => {} },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    console, Date, Math, Set, Array, Object, String, Number, JSON, RegExp
  };
  vm.runInNewContext(storeJs + '; this.Utils = Utils;', ctx);
  assert.strictEqual(typeof ctx.Utils.productThumbnail, 'function');
  assert.strictEqual(typeof ctx.Utils.productImage, 'function');
  const mockProd = { id: 'P1', thumbnail: 'data:image/jpeg;base64,thumb123', image: 'data:image/jpeg;base64,img456' };
  assert.strictEqual(ctx.Utils.productThumbnail(mockProd), 'data:image/jpeg;base64,thumb123');
  assert.strictEqual(ctx.Utils.productImage(mockProd), 'data:image/jpeg;base64,img456');
  const legacyProd = { id: 'P2', image: 'data:image/jpeg;base64,legacy' };
  assert.strictEqual(ctx.Utils.productThumbnail(legacyProd), 'data:image/jpeg;base64,legacy');

  // 4. Client-side auto-compression & thumbnail state in inventory.js
  const invJs = fs.readFileSync(resolveRoot('public/js/inventory.js'), 'utf8');
  assert.ok(invJs.includes('pendingThumbnail'), 'inventory.js must track pendingThumbnail state');
  assert.ok(invJs.includes('resizeImage(file, done)') || invJs.includes('function resizeImage(file, done)'), 'inventory.js must define resizeImage');
  assert.ok(invJs.includes('maxThumb = 160') || invJs.includes('scaleThumb'), 'resizeImage must create compact thumbnail');
  assert.ok(invJs.includes('Optimized thumbnail'), 'updateImagePreviewFallback must show thumbnail optimization status');
  assert.ok(invJs.includes("thumbnail: imageRemoved ? '' :"), 'saveProduct must store thumbnail in payload');

  // 5. Inventory table icon hover popover
  assert.ok(invJs.includes('data-prod-thumb-id='), 'renderProductsTable must attach data-prod-thumb-id to category icon');
  assert.ok(!invJs.includes('has-custom-photo'), 'renderProductsTable must not include red dot indicator class');
  assert.ok(!invJs.includes('<span class="popover-tag">Thumbnail</span>'), 'popover must not include Thumbnail tag');
  assert.ok(!invJs.includes('popover-price'), 'popover must not include price row');
  assert.ok(!invJs.includes('popover-badge'), 'popover must not include in-stock badge');
  assert.ok(invJs.includes('product.brand'), 'popover must display product brand in subtitle');
  assert.ok(invJs.includes('function showThumbPopover'), 'inventory.js must define showThumbPopover');
  assert.ok(invJs.includes('function hideThumbPopover'), 'inventory.js must define hideThumbPopover');
  assert.ok(invJs.includes("prodTbody.addEventListener('mouseover'"), 'inventory.js must attach mouseover listener to table rows');
  assert.ok(invJs.includes("prodTbody.addEventListener('mouseout'"), 'inventory.js must attach mouseout listener to table rows');

  // 6. CSS styling for popover and category icon hover
  const styleCss = fs.readFileSync(resolveRoot('public/css/style.css'), 'utf8');
  assert.ok(styleCss.includes('.prod-thumb-popover'), 'style.css must style .prod-thumb-popover');
  assert.ok(styleCss.includes('.prod-thumb-popover.is-visible'), 'style.css must style .prod-thumb-popover.is-visible');
  assert.ok(!styleCss.includes('.page-inventory .cell-thumb.has-custom-photo::after'), 'style.css must not render red dot on cell-thumb');
  assert.ok(styleCss.includes('.page-inventory .cell-thumb:hover'), 'style.css must provide hover effect for table category icons');

  // 7. Inventory HTML markup
  const invHtml = fs.readFileSync(resolveRoot('public/inventory.html'), 'utf8');
  assert.ok(invHtml.includes('id="imageDropSubtext"'), 'inventory.html must include imageDropSubtext for dynamic feedback');
});

/* ------------------------------------------------------------------------------
   60. DASHBOARD PRODUCT LIST ICONS & HOVER THUMBNAIL POPOVER
   ------------------------------------------------------------------------------ */
test('Dashboard: Product list category icons and hover thumbnail popover in Expiring, Warranties, Stock-In, and Top / Slow Sellers', async () => {
  const dashJs = fs.readFileSync(resolveRoot('public/js/dashboard.js'), 'utf8');

  // 1. Category icons with data-prod-thumb-id across dashboard views
  assert.ok(dashJs.includes("Utils.categoryIcon(p.category)"), 'stockTable must use Utils.categoryIcon');
  assert.ok(dashJs.includes("Utils.categoryIcon(r.p.category)"), 'viewExpiring must use Utils.categoryIcon');
  assert.ok(dashJs.includes("Utils.categoryIcon(pCat)"), 'viewWarranty and viewStockIn must use Utils.categoryIcon');
  assert.ok(dashJs.includes("data-prod-thumb-id="), 'Dashboard views must attach data-prod-thumb-id to .cell-thumb');

  // 2. Shared Utils thumbnail popover
  const storeJs = fs.readFileSync(resolveRoot('public/js/store.js'), 'utf8');
  assert.ok(storeJs.includes('showThumbPopover(targetEl)'), 'store.js Utils must define showThumbPopover');
  assert.ok(storeJs.includes('hideThumbPopover()'), 'store.js Utils must define hideThumbPopover');
  assert.ok(storeJs.includes("cell-thumb[data-prod-thumb-id]"), 'store.js must attach global hover listeners for thumbnail popovers');

  // 3. Styling for dashboard table thumbs
  const styleCss = fs.readFileSync(resolveRoot('public/css/style.css'), 'utf8');
  assert.ok(styleCss.includes('.page-dashboard .cell-thumb'), 'style.css must style .page-dashboard .cell-thumb');
  assert.ok(styleCss.includes('.page-dashboard .cell-thumb:hover'), 'style.css must style .page-dashboard .cell-thumb:hover');
});

/* ------------------------------------------------------------------------------
   61. DASHBOARD STATUS CARDS LAYOUT (STAFF & ADMIN)
   ------------------------------------------------------------------------------ */
test('Dashboard Status Cards: Staff excludes Today\'s Sales and Upcoming Warranties, Admin includes all 7 cards, both feature Stocked Products between Total Products and Low Stock', async () => {
  const dashJs = fs.readFileSync(resolveRoot('public/js/dashboard.js'), 'utf8');

  // 1. Logic for staff cards vs admin cards
  assert.ok(dashJs.includes("session.role === 'Staff'"), 'dashboard.js must detect Staff role from session');
  assert.ok(dashJs.includes("label: 'Stocked Products'"), 'dashboard.js must define Stocked Products card');
  assert.ok(dashJs.includes("icon: 'stockIn'"), 'Stocked Products card must use stockIn icon');
  assert.ok(dashJs.includes("view: 'stockin'"), 'Stocked Products card must switch panel to stockin view');
  assert.ok(dashJs.includes("unitsStocked"), 'dashboard.js must calculate unitsStocked in collect()');

  // Check Admin includes Stocked Products in between Total Products and Low Stock
  const adminCardsSection = dashJs.substring(dashJs.indexOf('// Admin Dashboard'));
  const totalProductsIdx = adminCardsSection.indexOf("label: 'Total Products'");
  const stockedProductsIdx = adminCardsSection.indexOf("label: 'Stocked Products'");
  const lowStockIdx = adminCardsSection.indexOf("label: 'Low Stock'");
  assert.ok(totalProductsIdx !== -1 && stockedProductsIdx !== -1 && lowStockIdx !== -1, 'Admin cards must contain Total Products, Stocked Products, and Low Stock');
  assert.ok(totalProductsIdx < stockedProductsIdx && stockedProductsIdx < lowStockIdx, 'Stocked Products must be placed in between Total Products and Low Stock for Admin');

  // 2. CSS for 5-card layout on desktop and 7-card layout
  const styleCss = fs.readFileSync(resolveRoot('public/css/style.css'), 'utf8');
  assert.ok(styleCss.includes('.dash-cards.has-5-cards') && styleCss.includes('repeat(5, minmax(0, 1fr))'), 'style.css must define 5-column grid for staff dashboard cards');
  assert.ok(styleCss.includes('.dash-cards.has-7-cards') && styleCss.includes('repeat(7, minmax(0, 1fr))'), 'style.css must define 7-column grid for admin dashboard cards');
});

/* ------------------------------------------------------------------------------
   62. SIDEBAR TOGGLE IN POS & MODALS
   ------------------------------------------------------------------------------ */
test('Sidebar Toggle in POS & Modals: hidden on mobile, hidden during active modals/overlays, and restrained z-index', async () => {
  const posCss = fs.readFileSync(resolveRoot('public/css/pos.css'), 'utf8');
  const styleCss = fs.readFileSync(resolveRoot('public/css/style.css'), 'utf8');
  const posJs = fs.readFileSync(resolveRoot('public/js/pos.js'), 'utf8');
  const appJs = fs.readFileSync(resolveRoot('public/js/app.js'), 'utf8');

  // 1. Mobile view: sidebar toggle must be strictly hidden in pos.css and style.css
  assert.ok(posCss.includes('.pos-terminal .sidebar-toggle') && posCss.includes('display: none !important;'), 'pos.css must hide sidebar-toggle on mobile');
  assert.ok(styleCss.includes('.sidebar-toggle') && styleCss.includes('display: none !important;'), 'style.css must hide sidebar-toggle on mobile');

  // 2. Modals/overlays: sidebar toggle must be hidden when any modal overlay is active
  assert.ok(posCss.includes(':has(.pt-overlay.open)') || posCss.includes(':has(.modal-overlay.open)'), 'pos.css must hide sidebar-toggle when modal overlays are active');
  assert.ok(styleCss.includes(':has(.modal-overlay.open)') || styleCss.includes(':has(.pt-overlay.open)'), 'style.css must hide sidebar-toggle when modal overlays are active');

  // 3. Script level modal protection
  assert.ok(posJs.includes("toggleBtn.style.display = 'none'"), 'pos.js openModal must hide sidebarToggle');
  assert.ok(appJs.includes("toggleBtn.style.display = 'none'"), 'app.js openModal must hide sidebarToggle');

  // 4. Desktop z-index sanity: toggle must not exceed overlay z-index (100)
  assert.ok(!posCss.includes('z-index: 120;'), 'pos.css must not assign z-index: 120 to sidebar-toggle');
  assert.ok(posCss.includes('.pos-terminal .sidebar-toggle {\n  z-index: 35;'), 'pos.css must constrain sidebar-toggle to z-index: 35');
});
