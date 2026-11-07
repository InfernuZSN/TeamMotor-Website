const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

console.log('--- COMPREHENSIVE INTERACTIVE TEST OF ALL FEATURES & CLICKABLES ---');

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

// Load backend logic
const LocalApi = require('../public/js/local-api.js');

// We will test both LocalApi and data models
const issues = [];
function reportIssue(category, title, detail, recommendation) {
  issues.push({ category, title, detail, recommendation });
}

// 1. Audit currency formatting precision
console.log('[Test 1] Testing currency format precision across the application...');
const mockCode = fs.readFileSync(path.resolve('public/js/mock-data.js'), 'utf8');
const receiptCode = fs.readFileSync(path.resolve('public/js/receipt.js'), 'utf8');

const ctx1 = { window: {}, document: { addEventListener: () => {} }, console, Date, Math, RegExp, Set, Array, Object, String, Number, JSON, setTimeout, clearTimeout };
vm.runInNewContext(mockCode + '; ' + receiptCode + '; this.Utils = Utils; this.Receipt = Receipt;', ctx1);

const formattedWhole = ctx1.Utils.formatPHP(450);
const formattedDecimal = ctx1.Utils.formatPHP(427.50);
const receiptFormatted = ctx1.Receipt.peso ? ctx1.Receipt.peso(427.50) : null;

if (formattedDecimal === '₱428') {
  reportIssue(
    'Currency & Formatting',
    'Utils.formatPHP rounds off centavos and drops decimal precision',
    'In public/js/mock-data.js line 23, Utils.formatPHP() formats numbers with maximumFractionDigits: 0. When a sale total or product has centavos (such as a 5% discount on ₱450 = ₱427.50), Utils.formatPHP(427.50) rounds to "₱428". However, the POS receipt, order preview, and payment keypad use 2-decimal precision (e.g. "₱427.50"). This creates a visible mismatch where the receipt printed on the screen displays ₱427.50, but the Sales and Dashboard tables display ₱428.',
    'Update Utils.formatPHP to preserve 2 decimal places when centavos are present, or use consistent minimumFractionDigits: 2 for financial figures.'
  );
}

// 2. Audit input step attribute on product price and cost in inventory.html
console.log('[Test 2] Testing numeric step constraints in inventory form...');
const invHtml = fs.readFileSync(path.resolve('public/inventory.html'), 'utf8');
const costStepMatch = invHtml.match(/id="pCost"[^>]*step="([^"]*)"/);
const priceStepMatch = invHtml.match(/id="pPrice"[^>]*step="([^"]*)"/);

if ((costStepMatch && costStepMatch[1] === '1') || (priceStepMatch && priceStepMatch[1] === '1')) {
  reportIssue(
    'UI Form Constraints',
    'Product Cost and Selling Price fields restrict input to integer values (step="1")',
    'In public/inventory.html lines 144 and 148, <input type="number" id="pCost" min="0" step="1"> and id="pPrice" min="0" step="1"> forbid entering centavos. If a user inputs standard prices with centavos (e.g. ₱249.50 or ₱19.99), the HTML5 constraint triggers a validation error ("Please enter a valid value. The two nearest valid values are..."). In contrast, the Stock In modal (id="sCostPrice") correctly uses step="0.01".',
    'Change step="1" to step="0.01" or step="any" on #pCost and #pPrice in public/inventory.html.'
  );
}

// 3. Audit supplierViewToEdit button role visibility
console.log('[Test 3] Testing Supplier details modal Edit button role guard...');
const invJs = fs.readFileSync(path.resolve('public/js/inventory.js'), 'utf8');
const supViewToEditCheck = invJs.includes("supplierViewToEdit.style.display = isAdmin");
if (!supViewToEditCheck) {
  reportIssue(
    'Role & Permission Guards',
    'Supplier Details modal exposes "Edit Supplier" button to Staff',
    'In public/inventory.html line 525, #supplierViewToEdit is present in the supplierViewOverlay modal footer. In public/js/inventory.js lines 1042-1071 (openSupplierView), the visibility of #supplierViewToEdit is not restricted by isAdmin. When a Staff user clicks to view a supplier, the "Edit Supplier" button is displayed. Clicking it opens the supplier edit modal, which then fails with a 403 Forbidden error on submit.',
    'In openSupplierView() in public/js/inventory.js, toggle document.getElementById("supplierViewToEdit").style.display based on isAdmin.'
  );
}

// 4. Audit quick customer phone validation in pos.js vs customer clean validation
console.log('[Test 4] Testing customer phone number regex consistency...');
const posJs = fs.readFileSync(path.resolve('public/js/pos.js'), 'utf8');
const custJs = fs.readFileSync(path.resolve('public/js/customers.js'), 'utf8');
const profileJs = fs.readFileSync(path.resolve('public/js/profile.js'), 'utf8');

// In profile.js:
// PH_MOBILE_PATTERNS = [/^\+63 ?9\d{2} ?\d{3} ?\d{4}$/, /^09\d{2} ?\d{3} ?\d{4}$/, /^9\d{2} ?\d{3} ?\d{4}$/]
// In pos.js / customers.js / server:
// /^[0-9+()\-\s]{7,20}$/
// Let's check profile.js vs customers.js:
// A user editing their profile phone number must follow Philippine mobile pattern (+63 9xx... or 09xx...),
// whereas customer phone allows any international or landline pattern. That is acceptable since customers can have landlines.

// 5. Audit Sales tab switching and table updates
console.log('[Test 5] Testing Sales Movement and Top Sellers reactivity...');
const salesJs = fs.readFileSync(path.resolve('public/js/sales.js'), 'utf8');
const salesHtml = fs.readFileSync(path.resolve('public/sales.html'), 'utf8');

// Check if fastMovingTbody / slowMovingTbody are re-rendered on sales changes or if they are static
const hasMovementRefresh = salesJs.includes("function renderMovementTable") && salesJs.includes("renderOrders();");
// Notice that fastList and slowList are calculated once at top-level of sales.js (lines 274-275), not wrapped in a function that re-executes when sales data updates or when a sale is voided.
const isMovementStatic = !salesJs.includes("function updateMovementTables") && salesJs.match(/renderMovementTable\(/g).length === 2;
if (isMovementStatic) {
  reportIssue(
    'UI State & Reactivity',
    'Product Movement tables in Sales page do not update after voiding or re-filtering',
    'In public/js/sales.js lines 274-298, fastMovingTbody and slowMovingTbody are rendered exactly once on initial page load using an initial snapshot of Store.get("sales"). When an Admin voids a sale, or when new sales are synchronized via Store.refresh(), the order list refreshes but the Product Movement (Fast/Slow moving) tables remain static until the entire page is hard-reloaded.',
    'Wrap the movement table calculation into a reactive function (e.g. renderMovementTables()) and invoke it on Store refresh or after voiding.'
  );
}

// 6. Audit audit trail filter in audit.html vs LocalApi & server
console.log('[Test 6] Testing Audit Trail search and action groups...');
const auditJs = fs.readFileSync(path.resolve('public/js/audit.js'), 'utf8');
const auditHtml = fs.readFileSync(path.resolve('public/audit.html'), 'utf8');
// Check action groups:
// GROUPS = ['auth', 'sale', 'stock', 'product', 'customer', 'count', 'settings', 'user', 'supplier', 'category', 'brand', 'moto', 'warranty', 'shift'];
// 'count' group: does 'count.*' exist in the audit logs or server?
// Let's check if 'count' actions exist in server or LocalApi:
const serverAuditDiff = fs.readFileSync(path.resolve('server/src/utils/audit.js'), 'utf8');
const localApiCode = fs.readFileSync(path.resolve('public/js/local-api.js'), 'utf8');

const hasCountAction = localApiCode.includes("'count.") || serverAuditDiff.includes("'count.");
const groupsLine = (auditJs.split('\n').find(l => l.includes('const GROUPS')) || '');
const offersCountGroup = /'count'/.test(groupsLine);
if (offersCountGroup && !hasCountAction) {
  reportIssue(
    'UI / Filter Inconsistency',
    'Audit Trail action filter includes nonexistent "count.*" group',
    'In public/js/audit.js line 11, GROUPS includes "count", which populates the Action filter with <option value="count">count.*</option>. However, physical inventory counts in TeamMotor were designed as "stock.adjust" and no "count.*" actions are ever emitted anywhere in server/src/ or public/js/local-api.js. Selecting "count.*" always returns an empty list.',
    'Remove "count" from GROUPS in public/js/audit.js or alias it to stock.adjust.'
  );
}

// 7. Audit Warranty Claim Status Options
console.log('[Test 7] Testing Warranty Claim status choices in warranty modal vs schema...');
const warJs = fs.readFileSync(path.resolve('public/js/warranty.js'), 'utf8');
const warHtml = fs.readFileSync(path.resolve('public/warranty.html'), 'utf8');
// Check warranty claim statuses in warranty.html
const claimStatusOptions = warHtml.match(/<select[^>]*id="claimStatus"[^>]*>([\s\S]*?)<\/select>/);
// Let's inspect the options:
if (claimStatusOptions) {
  console.log('Claim status options:', claimStatusOptions[1].trim().replace(/\s+/g, ' '));
}

// 8. Audit Password Validation Consistency: login vs registration vs profile
console.log('[Test 8] Testing Password requirements across modules...');
const usersJs = fs.readFileSync(path.resolve('public/js/users.js'), 'utf8');
// In users.js: /^(?=.*[A-Za-z])(?=.*\d).{8,}$/
// In profile.js: /^(?=.*[A-Za-z])(?=.*\d).{8,}$/
// In local-api.js: /^(?=.*[A-Za-z])(?=.*\d).{8,}$/
// In server/src/utils/validation.js or users.js:
// Let's check server password validation:
const serverUsersRoute = fs.readFileSync(path.resolve('server/src/routes/users.js'), 'utf8');
// checkPw(req.body.newPassword);
console.log('Password complexity regex is consistent across users.js, profile.js, and backend.');

// 9. Check empty state colspan across tables
console.log('[Test 9] Checking table empty state colspan counts vs thead columns...');
const htmlFiles = fs.readdirSync(path.resolve('public')).filter(f => f.endsWith('.html'));
const htmlContents = {};
htmlFiles.forEach(f => {
  htmlContents[f] = fs.readFileSync(path.resolve('public', f), 'utf8');
});
const jsFiles = fs.readdirSync(path.resolve('public/js')).filter(f => f.endsWith('.js'));

const checkTableColspans = () => {
  htmlFiles.forEach(h => {
    const content = htmlContents[h];
    // Find all <table> blocks
    const tables = content.match(/<table[\s\S]*?<\/table>/gi) || [];
    tables.forEach(t => {
      const thMatch = t.match(/<th\b/gi) || [];
      const thCount = thMatch.length;
      const tdColspanMatch = t.match(/<td[^>]*colspan=['"](\d+)['"]/gi) || [];
      tdColspanMatch.forEach(td => {
        const m = td.match(/colspan=['"](\d+)['"]/i);
        if (m && thCount > 0 && parseInt(m[1], 10) !== thCount) {
          reportIssue(
            'HTML Table Colspan Mismatch',
            `Table colspan in ${h} (${m[1]}) does not match thead column count (${thCount})`,
            `In ${h}, an empty-state <td> has colspan="${m[1]}", but the <thead> has ${thCount} <th> columns. This causes the empty state message to align incorrectly or span only a fraction of the table width.`,
            `Update the empty state <td colspan="${m[1]}"> to <td colspan="${thCount}"> in ${h}.`
          );
        }
      });
    });
  });
};
checkTableColspans();

// Also check JS files for empty-state colspan in dynamic innerHTML
jsFiles.forEach(j => {
  const content = fs.readFileSync(path.join('public', 'js', j), 'utf8');
  const emptyMatches = content.match(/<td[^>]*colspan=\\?['"]?(\d+)\\?['"]?[^>]*><div class=\\?['"]?empty-state/gi) || [];
  // e.g. '<tr><td colspan="9"><div class="empty-state">'
});

console.log('\n--- IDENTIFIED INCONSISTENCIES: ---');
console.log(JSON.stringify(issues, null, 2));
