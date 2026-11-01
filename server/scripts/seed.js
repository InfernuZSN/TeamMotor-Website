/* ==========================================================================
   Seed script:  npm run seed          (refuses to run if users already exist)
                 npm run seed:reset    (DROPS every TeamMotor collection first)

   The demo fixtures are the SAME ones the old browser prototype shipped with
   (public/js/mock-data.js is loaded in a sandbox and read), so the first run
   looks exactly like the prototype — except now it lives in MongoDB.
   Passwords are bcrypt-hashed. Set SEED_ADMIN_PASSWORD / SEED_STAFF_PASSWORD in .env.
   ========================================================================== */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const bcrypt = require('bcryptjs');
const config = require('../src/config');
const { connect, mongoose } = require('../src/db');
const M = require('../src/models');
const { ensureAtLeast } = require('../src/utils/counters');
const { computeTotals } = require('../src/utils/money');
const { addMonths, addDays, today } = require('../src/utils/dates');
const { refreshNotifications } = require('../src/services/notifications');

const RESET = process.argv.includes('--reset');

function loadFixtures() {
  const file = path.join(__dirname, '..', '..', 'public', 'js', 'mock-data.js');
  const code = fs.readFileSync(file, 'utf8') +
    '\n;({ CATEGORIES, SUPPLIERS, PRODUCTS, USERS, SALES, CUSTOMERS, INVENTORY_TRANSACTIONS, WARRANTIES, SHIFTS })';
  return vm.runInNewContext(code, { console, Date, Math, Set, Array, Object, String, Number, JSON, RegExp }, { filename: 'mock-data.js' });
}

const maxSuffix = (ids, re) => ids.reduce((m, id) => { const x = String(id).match(re); return x ? Math.max(m, parseInt(x[1], 10)) : m; }, 0);

(async () => {
  await connect();
  const existing = await M.User.countDocuments();
  if (existing && !RESET) {
    console.error('Database already has ' + existing + ' user(s). Run `npm run seed:reset` to wipe and re-seed.');
    process.exit(1);
  }
  if (RESET) {
    for (const model of Object.values(M)) await model.deleteMany({});
    console.log('Cleared all collections.');
  }

  const fx = loadFixtures();
  const adminPw = process.env.SEED_ADMIN_PASSWORD || 'Admin@12345';
  const staffPw = process.env.SEED_STAFF_PASSWORD || 'Staff@12345';
  const settings = await M.Setting.create({ key: 'shop', shopName: 'TeamMotor', phone: '(02) 8123-4567', tin: 'VAT REG. TIN: 123-456-789-00000' });
  const shopSnap = { shopName: settings.shopName, tagline: settings.tagline, addressLines: settings.addressLines, phone: settings.phone, tin: settings.tin, receiptFooter: settings.receiptFooter };

  /* users */
  const hAdmin = await bcrypt.hash(adminPw, 10), hStaff = await bcrypt.hash(staffPw, 10);
  await M.User.insertMany(fx.USERS.map(u => Object.assign({}, u, { passwordHash: u.role === 'Admin' ? hAdmin : hStaff })));
  const userByName = new Map(fx.USERS.map(u => [u.name, u.username]));

  await M.Category.insertMany(fx.CATEGORIES.filter(c => c.id !== 'motorcycles'));
  await M.Supplier.insertMany(fx.SUPPLIERS);

  /* products — plus two demo items so Expiration Monitoring has something to show */
  const t = today();
  const products = fx.PRODUCTS.filter(p => p.category !== 'motorcycles').map(p => Object.assign({}, p, { expirationDate: null }));
  const oil = products.find(p => p.id === 'ENG-001'); if (oil) oil.expirationDate = addMonths(t, 14);
  const extras = [
    { id: 'OTH-002', sku: 'TM-OTH-002', barcode: '480123456716', name: 'Brake Fluid DOT 4 (250ml)', brand: 'Bosch', category: 'other-parts', compatibility: ['Universal (All Models)'], compatYears: 'All Years', supplier: 'SUP-002', supplierRef: 'YGP-BF-250', description: 'DOT 4 brake fluid, 250 ml bottle. Shelf-life limited.', costPrice: 120, sellingPrice: 190, stock: 8, reorderLevel: 4, expirationDate: addDays(t, 52) },
    { id: 'ENG-004', sku: 'TM-ENG-004', barcode: '480123456717', name: 'Engine Degreaser Spray (400ml)', brand: 'Generic', category: 'engine-parts', compatibility: ['Universal (All Models)'], compatYears: 'All Years', supplier: 'SUP-001', supplierRef: 'ABC-DG-400', description: 'Aerosol degreaser. Past its best-before date — pull from sale.', costPrice: 95, sellingPrice: 150, stock: 5, reorderLevel: 3, expirationDate: addDays(t, -20) }
  ];
  extras.forEach(e => products.push(Object.assign({ image: e.category, archived: false, lastUpdated: new Date().toISOString() }, e)));
  await M.Product.insertMany(products);

  const txns = fx.INVENTORY_TRANSACTIONS.filter(x => x.productId.indexOf('MOT-') !== 0).map(x => Object.assign({}, x));
  let trxN = maxSuffix(txns.map(x => x.id), /^TRX-(\d+)$/);
  extras.forEach(e => txns.push({ id: 'TRX-' + String(++trxN).padStart(4, '0'), productId: e.id, productName: e.name, type: 'Stock In', quantity: e.stock, previousStock: 0, newStock: e.stock, date: new Date().toISOString(), user: 'Juan Dela Cruz', supplierId: e.supplier, reference: 'Opening count', reason: null, notes: 'Opening stock count' }));
  await M.InventoryTransaction.insertMany(txns);

  /* customers */
  await M.Customer.insertMany(fx.CUSTOMERS);

  /* sales + sale_items (VAT-inclusive 12% breakdown computed the same way the POS does) */
  const sales = [], items = [];
  fx.SALES.forEach(s => {
    const sub = s.items.reduce((n, i) => n + i.subtotal, 0);
    const tt = computeTotals(sub, 0, settings);
    sales.push({
      id: s.id, date: s.date, subtotal: tt.subtotal, discount: 0, vatEnabled: tt.vatEnabled, vatMode: tt.vatMode, vatRate: tt.vatRate,
      vatableAmount: tt.vatableAmount, vatAmount: tt.vatAmount, total: tt.total, paymentMethod: s.paymentMethod, amountReceived: tt.total, changeAmount: 0,
      status: 'Completed', paymentStatus: 'Paid', staff: s.staff, staffUsername: userByName.get(s.staff) || '', customerId: s.customerId || null, shop: shopSnap
    });
    s.items.forEach(i => items.push({ saleId: s.id, productId: i.productId, name: i.name, qty: i.qty, price: i.price, subtotal: i.subtotal }));
  });
  await M.Sale.insertMany(sales);
  await M.SaleItem.insertMany(items);

  /* warranties + claims */
  const claims = [];
  const warranties = fx.WARRANTIES.map(w => {
    (w.claims || []).forEach((c, i) => claims.push(Object.assign({ id: 'CLM-' + w.id.slice(4) + String(i + 1), warrantyId: w.id, status: 'Resolved', staff: c.staff || 'Juan Dela Cruz' }, c)));
    const copy = Object.assign({}, w); delete copy.claims; return copy;
  });
  await M.Warranty.insertMany(warranties);
  if (claims.length) await M.WarrantyClaim.insertMany(claims);

  await M.Shift.insertMany(fx.SHIFTS);

  /* sequence counters continue after the seeded ids */
  await ensureAtLeast('SALE', maxSuffix(sales.map(s => s.id), /^SALE-(\d+)$/));
  await ensureAtLeast('TRX', trxN);
  await ensureAtLeast('USR', maxSuffix(fx.USERS.map(u => u.id), /^USR-(\d+)$/));
  await ensureAtLeast('SUP', maxSuffix(fx.SUPPLIERS.map(u => u.id), /^SUP-(\d+)$/));
  await ensureAtLeast('CUST', maxSuffix(fx.CUSTOMERS.map(u => u.id), /^CUST-(\d+)$/));
  await ensureAtLeast('WAR', maxSuffix(warranties.map(u => u.id), /^WAR-(\d+)$/));
  await ensureAtLeast('SHF', maxSuffix(fx.SHIFTS.map(u => u.id), /^SHF-(\d+)$/));
  await ensureAtLeast('CLM', 100);
  for (const c of fx.CATEGORIES) {
    await ensureAtLeast('PRD-' + c.prefix, maxSuffix(products.filter(p => p.category === c.id).map(p => p.id), /-(\d+)$/));
  }

  await refreshNotifications();
  console.log('Seeded: ' + products.length + ' products, ' + sales.length + ' sales, ' + fx.CUSTOMERS.length + ' customers, ' + fx.USERS.length + ' users.');
  console.log('Logins:  ronnie.manalo / ' + adminPw + '   (Admin)');
  console.log('         juan.delacruz / ' + staffPw + '   (Staff)   — change these after first login!');
  await mongoose.disconnect();
})().catch(err => { console.error('Seed failed:', err); process.exit(1); });
