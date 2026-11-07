const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    console.log('PASS:', name);
    passed++;
  } catch (err) {
    console.error('FAIL:', name, err);
    process.exitCode = 1;
  }
}

// 1. Product View Modal ("Sales" Tab) excludes voided/cancelled/refunded sales
test('1. Product View Modal ("Sales" tab) filters sales with Utils.isCountable', () => {
  const invJs = read('public/js/inventory.js');
  const openViewBlock = invJs.slice(invJs.indexOf('function openViewModal'), invJs.indexOf('function updateStockHint'));
  assert.ok(
    openViewBlock.includes("Store.get('sales', []).filter(Utils.isCountable)"),
    'openViewModal should filter sales with Utils.isCountable'
  );
});

// 2. Dynamic Store lookup on Sales page after receipt reprint & refresh
test('2. Sales page uses live Store.get("sales", []) in filterSales, openSaleModal, and renderDaySummary', () => {
  const salesJs = read('public/js/sales.js');
  const daySummaryBlock = salesJs.slice(salesJs.indexOf('function renderDaySummary'), salesJs.indexOf('function filterSales'));
  const filterSalesBlock = salesJs.slice(salesJs.indexOf('function filterSales'), salesJs.indexOf('function renderOrders'));
  const openSaleBlock = salesJs.slice(salesJs.indexOf('function openSaleModal'), salesJs.indexOf('async function reprintSale'));
  assert.ok(daySummaryBlock.includes("Store.get('sales', [])"), 'renderDaySummary should read live Store.get("sales", [])');
  assert.ok(filterSalesBlock.includes("Store.get('sales', [])"), 'filterSales should fallback to Store.get("sales", [])');
  assert.ok(openSaleBlock.includes("Store.get('sales', []).find"), 'openSaleModal should look up sale from live Store.get("sales", [])');
});

// 3. Preserve centavo precision in POS discount calculations
test('3. POS discount calculations preserve centavo precision (2 decimal places)', () => {
  const posJs = read('public/js/pos.js');
  const totalsBlock = posJs.slice(posJs.indexOf('function totals()'), posJs.indexOf('function vatLabel()'));
  const readDiscBlock = posJs.slice(posJs.indexOf('function readDiscForm()'), posJs.indexOf('function openDiscModal()'));
  assert.ok(
    totalsBlock.includes('Math.round((subtotal * disc.value / 100) * 100) / 100'),
    'totals() should preserve centavos on percent discount'
  );
  assert.ok(
    readDiscBlock.includes('Math.round((discType === \'percent\' ? sub * value / 100 : value) * 100) / 100'),
    'readDiscForm() should preserve centavos on discount preview/apply'
  );
});

// 4. Respect VAT-Exclusive mode in POS Held Orders total
test('4. POS heldTotal uses Utils.computeTotals(..., settings()).total', () => {
  const posJs = read('public/js/pos.js');
  const heldTotalBlock = posJs.slice(posJs.indexOf('function heldTotal(h)'), posJs.indexOf('function renderHeldList()'));
  assert.ok(
    heldTotalBlock.includes('Utils.computeTotals(sub, Math.max(0, Math.min(d, sub)), settings()).total'),
    'heldTotal(h) should compute total via Utils.computeTotals(..., settings()).total'
  );
});

// 5. Filter out Inactive categories & suppliers in Product and Stock-In selects
test('5. Inactive categories and suppliers are excluded from #pCategory, #pSupplier, #sSupplier while preserved on edit', () => {
  const invJs = read('public/js/inventory.js');
  const popBlock = invJs.slice(invJs.indexOf('function populateStaticSelects()'), invJs.indexOf('function getMotoBrandsMap') > invJs.indexOf('function populateStaticSelects()') ? invJs.indexOf('function getMotoBrandsMap') : invJs.indexOf('function populateStaticSelects()') + 1600);
  assert.ok(popBlock.includes("categories.filter(c => c.status !== 'Inactive')"), 'populateStaticSelects should filter out Inactive categories for product form');
  assert.ok(popBlock.includes("suppliers.filter(s => s.status !== 'Inactive')"), 'populateStaticSelects should filter out Inactive suppliers for product & stock-in forms');

  const editBlock = invJs.slice(invJs.indexOf('function openProductModal'), invJs.indexOf('async function saveProduct'));
  assert.ok(editBlock.includes("curCat.name + ' (Inactive)'"), 'openProductModal should preserve inactive category when editing existing product');
  assert.ok(editBlock.includes("curSup.name + ' (Inactive)'"), 'openProductModal should preserve inactive supplier when editing existing product');
});

// 6. Support "warning" toast type in app.js and style.css
test('6. showToast supports "warning" type with alertTriangle icon and warning CSS rule', () => {
  const appJs = read('public/js/app.js');
  const styleCss = read('public/css/style.css');
  const toastBlock = appJs.slice(appJs.indexOf('function showToast'), appJs.indexOf('function showToast') + 650);
  assert.ok(toastBlock.includes("type === 'warning'") && toastBlock.includes("'alertTriangle'"), 'showToast should map warning to alertTriangle');
  assert.ok(styleCss.includes('.toast.toast-warning svg'), 'style.css should style .toast.toast-warning svg');
});

// 7. Include Voided status in Warranty summary metrics
test('7. Warranty renderStats includes Voided count card and uses stat-grid-5', () => {
  const warJs = read('public/js/warranty.js');
  const statsBlock = warJs.slice(warJs.indexOf('function renderStats()'), warJs.indexOf('function renderTable()'));
  assert.ok(statsBlock.includes("Voided: 0") && statsBlock.includes("label: 'Voided'"), 'renderStats should count and display Voided warranties');
  assert.ok(statsBlock.includes('stat-grid-5'), 'renderStats should apply stat-grid-5 class');
});

// 8. Expand Stock History search scope (#histSearch)
test('8. Stock History search matches productName, productId, reference, notes, and user', () => {
  const invJs = read('public/js/inventory.js');
  const invHtml = read('public/inventory.html');
  const histBlock = invJs.slice(invJs.indexOf('function renderHistoryTable()'), invJs.indexOf('function renderHistoryTable()') + 700);
  assert.ok(
    histBlock.includes('[t.productName, t.productId, t.reference, t.notes, t.user]'),
    'renderHistoryTable should search across productName, productId, reference, notes, and user'
  );
  assert.ok(
    invHtml.includes('id="histSearch" placeholder="Search product, ID, ref, or staff..."'),
    'inventory.html should have updated placeholder on #histSearch'
  );
});

// 9. Backend & Offline LocalApi endpoint and email uniqueness parity
test('9. LocalApi and users.js implement missing endpoints, query filters, and email uniqueness', () => {
  const usersRoute = read('server/src/routes/users.js');
  assert.ok(usersRoute.includes('async function assertEmailFree'), 'server/src/routes/users.js should define assertEmailFree');
  assert.ok(usersRoute.includes('await assertEmailFree(b.email)'), 'POST /api/users should check email uniqueness');
  assert.ok(usersRoute.includes('await assertEmailFree(b.email, user.id)'), 'PUT /api/users/:id and PUT /api/users/me/profile should check email uniqueness');

  // Execute LocalApi in a VM sandbox and test endpoints & query params & email uniqueness
  const storeMem = {};
  const sandbox = {
    window: {},
    localStorage: {
      getItem: (k) => (k in storeMem ? storeMem[k] : null),
      setItem: (k, v) => { storeMem[k] = String(v); },
      removeItem: (k) => { delete storeMem[k]; }
    },
    sessionStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {}
    },
    URLSearchParams,
    console
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read('public/js/mock-data.js') + '\n' + read('public/js/local-api.js') + '\nwindow.LocalApi = LocalApi;', sandbox);

  const LocalApi = sandbox.window.LocalApi;
  // Log in as admin to get token
  const loginRes = LocalApi.handle('POST', '/auth/login', { username: 'ronnie.manalo', password: 'Admin@12345' });
  const token = loginRes.token;

  const products = LocalApi.handle('GET', '/products', null, token);
  assert.ok(Array.isArray(products) && products.length > 0, 'GET /products should return product list in LocalApi');

  const firstProd = products[0];
  const lookedUp = LocalApi.handle('GET', '/products/lookup/' + encodeURIComponent(firstProd.id), null, token);
  assert.equal(lookedUp.id, firstProd.id, 'GET /products/lookup/:code should resolve product by ID');

  const txnsFiltered = LocalApi.handle('GET', '/inventory/transactions?limit=2', null, token);
  assert.ok(Array.isArray(txnsFiltered) && txnsFiltered.length <= 2, 'GET /inventory/transactions should respect limit query');

  const allSales = LocalApi.handle('GET', '/sales?limit=3', null, token);
  assert.ok(Array.isArray(allSales) && allSales.length <= 3, 'GET /sales should respect limit query');
  if (allSales.length > 0) {
    const singleSale = LocalApi.handle('GET', '/sales/' + encodeURIComponent(allSales[0].id), null, token);
    assert.equal(singleSale.id, allSales[0].id, 'GET /sales/:id should return single sale in LocalApi');
  }

  const activeCustomers = LocalApi.handle('GET', '/customers?status=Active', null, token);
  assert.ok(activeCustomers.every(c => c.status === 'Active'), 'GET /customers?status=Active should filter by status');

  // Test duplicate email on POST /users in LocalApi
  LocalApi.handle('POST', '/users', {
    name: 'First Staff',
    username: 'staff_uniq1',
    email: 'unique.staff@teammotor.ph',
    role: 'Staff',
    password: 'password123'
  }, token);
  let dupErr = null;
  try {
    LocalApi.handle('POST', '/users', {
      name: 'Second Staff',
      username: 'staff_uniq2',
      email: 'UNIQUE.STAFF@teammotor.ph',
      role: 'Staff',
      password: 'password123'
    }, token);
  } catch (e) {
    dupErr = e;
  }
  assert.ok(dupErr && dupErr.status === 409, 'POST /users should reject duplicate email case-insensitively with 409');
});

console.log(`\nVerified ${passed}/9 fixes successfully.`);
