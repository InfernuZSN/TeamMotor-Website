const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

console.log('--- VERIFYING ALL 9 FIXES ---');

// 1. WAR-004 Status & Claim Status
const mockCode = fs.readFileSync(path.resolve('public/js/mock-data.js'), 'utf8');
const appCode = fs.readFileSync(path.resolve('public/js/app.js'), 'utf8');
const ctx = { window: {}, document: { addEventListener: () => {} }, console, Date, Math, RegExp, Set, Array, Object, String, Number, JSON, setTimeout, clearTimeout };
vm.runInNewContext(appCode + '; ' + mockCode + '; this.WARRANTIES = WARRANTIES; this.Utils = Utils;', ctx);
const war4 = ctx.WARRANTIES.find(w => w.id === 'WAR-004');
assert.ok(war4, 'WAR-004 exists');
assert.strictEqual(war4.claims[0].status, 'Resolved', 'WAR-004 claim has status Resolved');
const calculatedStatus = ctx.Utils.getWarrantyStatus(war4);
assert.strictEqual(calculatedStatus, 'Claimed', 'WAR-004 calculates as Claimed, not Expired');
console.log('✓ Fix 1 (WAR-004 Claimed status): PASS');

// 2. logic.test.js relative path resolution
const testCode = fs.readFileSync(path.resolve('server/test/logic.test.js'), 'utf8');
assert.ok(testCode.includes("const ROOT = path.resolve(__dirname, '../..');"), 'ROOT defined using __dirname');
assert.ok(!testCode.includes("fs.readFileSync(path.resolve('public/"), 'No relative cwd path.resolve calls remaining');
console.log('✓ Fix 2 (Test runner paths): PASS');

// 3. #viewToEditBtn permission guard
const invJs = fs.readFileSync(path.resolve('public/js/inventory.js'), 'utf8');
assert.ok(invJs.includes("viewToEditBtn.style.display = isAdmin ? '' : 'none'"), '#viewToEditBtn checks isAdmin');
console.log('✓ Fix 3 (Staff edit button hidden in view modal): PASS');

// 4. LocalApi shift endpoints
const localApiCode = fs.readFileSync(path.resolve('public/js/local-api.js'), 'utf8');
assert.ok(localApiCode.includes("R('GET', '/users/shifts/all'"), 'LocalApi has GET /users/shifts/all');
assert.ok(localApiCode.includes("R('GET', '/users/shifts/mine'"), 'LocalApi has GET /users/shifts/mine');
console.log('✓ Fix 4 (LocalApi shift query endpoints): PASS');

// 5. #supplierCountBadge in HTML
const invHtml = fs.readFileSync(path.resolve('public/inventory.html'), 'utf8');
assert.ok(invHtml.includes('id="supplierCountBadge"'), 'inventory.html contains #supplierCountBadge');
console.log('✓ Fix 5 (#supplierCountBadge in DOM): PASS');

// 6. CSV exports respect active search & filters
assert.ok(invJs.includes('const products = getFilteredProducts();'), 'exportInventoryCSV uses getFilteredProducts');
const salesJs = fs.readFileSync(path.resolve('public/js/sales.js'), 'utf8');
assert.ok(salesJs.includes("document.getElementById('salesSearch')"), 'exportSalesCSV respects salesSearch');
console.log('✓ Fix 6 (CSV exports respect active search and filters): PASS');

// 7. Case-insensitive brand matching in server catalog & LocalApi
const catCode = fs.readFileSync(path.resolve('server/src/routes/catalog.js'), 'utf8');
assert.ok(catCode.includes('Brand.findOne({ name: sameName(data.brand) })'), 'catalog.js uses sameName for brand query');
assert.ok(localApiCode.includes('sameName(x.name, d.brand)'), 'LocalApi uses sameName for brand query');
console.log('✓ Fix 7 (Case-insensitive brand validation in catalog & LocalApi): PASS');

// 8. Dynamic expiry warning window label in inventory filter
assert.ok(invJs.includes("expOpt.textContent = 'Expiring Soon (' + expiryMonths() + ' mo)'"), 'inventory.js dynamically updates expiring soon label');
console.log('✓ Fix 8 (Dynamic expiry window label): PASS');

// 9. Voided status option in warranty.html
const warHtml = fs.readFileSync(path.resolve('public/warranty.html'), 'utf8');
assert.ok(warHtml.includes('<option value="Voided">Voided</option>'), 'warranty.html contains Voided filter option');
console.log('✓ Fix 9 (Voided option in warranty filter): PASS');

console.log('\nALL 9 FIXES VERIFIED SUCCESSFULLY!');
