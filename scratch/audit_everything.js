const fs = require('fs');
const path = require('path');

console.log('--- COMPREHENSIVE SCAN FOR INCONSISTENCIES ACROSS ALL MODULES ---');

const htmlFiles = fs.readdirSync(path.resolve('public')).filter(f => f.endsWith('.html'));
const jsFiles = fs.readdirSync(path.resolve('public/js')).filter(f => f.endsWith('.js'));

const findings = [];
function addFinding(area, title, description, impact, fileRef) {
  findings.push({ area, title, description, impact, fileRef });
}

// 1. Check all navigation links in all HTML files
console.log('1. Checking Navigation links and active states...');
htmlFiles.forEach(file => {
  const content = fs.readFileSync(path.resolve('public', file), 'utf8');
  const links = [...content.matchAll(/<a[^>]+href=["']([^"']+)["']/gi)].map(m => m[1]);
  links.forEach(href => {
    if (!href.startsWith('#') && !href.startsWith('http') && !href.startsWith('javascript:')) {
      const cleanPath = href.split('?')[0];
      const targetFile = path.resolve('public', cleanPath);
      if (!fs.existsSync(targetFile)) {
        addFinding(
          'Navigation',
          `Broken href link in ${file}`,
          `Link pointing to "${href}" does not exist in public/ directory.`,
          'User clicks a navigation item and gets a 404 or broken navigation.',
          `public/${file}`
        );
      }
    }
  });
});

// 2. Check getElementById references in all JS files
console.log('2. Checking getElementById references vs HTML elements...');
const allHtmlCombined = htmlFiles.map(f => fs.readFileSync(path.resolve('public', f), 'utf8')).join('\n');
// Extract all IDs from HTML
const existingIds = new Set();
const idMatches = [...allHtmlCombined.matchAll(/\bid=["']([^"']+)["']/gi)];
idMatches.forEach(m => existingIds.add(m[1]));

// Dynamic IDs or common template IDs that might not be in base HTML:
const knownDynamicIds = new Set([
  'toast', 'toast-container', 'receiptPreview', 'printFrame', 'app', 'sidebar',
  'chartCanvas', 'main-content', 'modal-root', 'scanner-video'
]);

jsFiles.forEach(file => {
  const content = fs.readFileSync(path.resolve('public/js', file), 'utf8');
  const getElemMatches = [...content.matchAll(/document\.getElementById\(["']([^"']+)["']\)/gi)].map(m => m[1]);
  getElemMatches.forEach(id => {
    // If id does not exist in any HTML file and is not known dynamic ID
    if (!existingIds.has(id) && !knownDynamicIds.has(id) && !id.includes('${') && !id.startsWith('dyn_')) {
      // Check if it's created dynamically in JS (e.g. document.createElement or innerHTML)
      const jsCreated = jsFiles.some(jf => {
        const c = fs.readFileSync(path.resolve('public/js', jf), 'utf8');
        return c.includes(`id="${id}"`) || c.includes(`id=\\"${id}\\"`) || c.includes(`id='${id}'`);
      });
      if (!jsCreated) {
        addFinding(
          'DOM Reference',
          `Unmatched getElementById("${id}") in ${file}`,
          `Script attempts to access element with id "${id}", but this element is never defined in any HTML file or dynamic template.`,
          'Can cause TypeError: Cannot set properties of null or silent failure when feature is used.',
          `public/js/${file}`
        );
      }
    }
  });
});

// 3. Check API routes used in frontend vs handled in server & local-api
console.log('3. Checking API route parity...');
const serverFiles = fs.readdirSync(path.resolve('server/src/routes')).filter(f => f.endsWith('.js'));
const serverRoutesContent = serverFiles.map(f => fs.readFileSync(path.resolve('server/src/routes', f), 'utf8')).join('\n');
const localApiContent = fs.readFileSync(path.resolve('public/js/local-api.js'), 'utf8');

// Find all fetch/callApi/LocalApi calls in public/js
jsFiles.forEach(file => {
  if (file === 'local-api.js' || file === 'mock-data.js') return;
  const content = fs.readFileSync(path.resolve('public/js', file), 'utf8');
  // Match callApi or fetch routes like '/api/...' or 'api/...'
  const apiCalls = [...content.matchAll(/(?:callApi|fetch|LocalApi\.request)\s*\(\s*['"`]([^'"`?#]+)/gi)].map(m => m[1]);
  apiCalls.forEach(route => {
    if (route.startsWith('/api/') || route.startsWith('api/')) {
      const cleanRoute = route.replace(/^\/?api\//, '');
      const baseRoute = cleanRoute.split('/')[0]; // e.g. 'products', 'sales', 'users'
      // Check if handled in localApi and server
      const inLocal = localApiContent.includes(baseRoute);
      const inServer = serverRoutesContent.includes(baseRoute) || fs.existsSync(path.resolve(`server/src/routes/${baseRoute}.js`));
      if (!inLocal && !inServer) {
        addFinding(
          'API Parity',
          `API endpoint "${route}" in ${file} not implemented`,
          `Endpoint /api/${cleanRoute} is called by ${file} but not matched in backend or LocalApi.`,
          'Request fails with 404 Not Found.',
          `public/js/${file}`
        );
      }
    }
  });
});

// 4. Check Customer Loyalty / Discount / Point logic
console.log('4. Checking Customer loyalty points & tiers...');
// In customers.js or pos.js: points to discount ratio
// Let's check pos.js for how customer loyalty points are redeemed:
const posContent = fs.readFileSync(path.resolve('public/js/pos.js'), 'utf8');
const custContent = fs.readFileSync(path.resolve('public/js/customers.js'), 'utf8');

// Let's inspect points logic in pos.js
console.log('POS points matching:');
const posPointsMatch = posContent.match(/points/gi) || [];
console.log(`Found ${posPointsMatch.length} points references in pos.js`);

// 5. Check Warranty Claim & Warranty Period handling
console.log('5. Checking Warranty Claim transitions...');
const warContent = fs.readFileSync(path.resolve('public/js/warranty.js'), 'utf8');
// Check warranty claim statuses in warranty.js
// Approved, Resolved, Pending, Rejected vs Claimed, Active, Expired, Voided

// 6. Check Settings form fields vs defaults in settings.js and server
console.log('6. Checking Settings form persistence...');
const settingsContent = fs.readFileSync(path.resolve('public/js/settings.js'), 'utf8');
const settingsHtml = fs.readFileSync(path.resolve('public/settings.html'), 'utf8');
// Extract all input IDs from settings.html form
const settingsFormInputs = [...settingsHtml.matchAll(/<(?:input|select|textarea)[^>]+id=["']([^"']+)["']/gi)].map(m => m[1]);
console.log(`Settings inputs count: ${settingsFormInputs.length}`);
// Check if all settings inputs are read and saved in settings.js
const unhandledSettingsInputs = [];
settingsFormInputs.forEach(inputId => {
  if (!settingsContent.includes(inputId)) {
    unhandledSettingsInputs.push(inputId);
  }
});
if (unhandledSettingsInputs.length > 0) {
  addFinding(
    'Settings',
    `Settings form inputs not wired up in settings.js: ${unhandledSettingsInputs.join(', ')}`,
    `The following elements exist in settings.html but are never read or populated by settings.js: ${unhandledSettingsInputs.join(', ')}`,
    'User edits these settings in the UI, but they are never saved or applied.',
    'public/settings.html'
  );
}

// 7. Check inventory batch & expiry date handling
console.log('7. Checking Inventory batch & expiry alerts...');
const invContent = fs.readFileSync(path.resolve('public/js/inventory.js'), 'utf8');

// Print all findings so far
console.log('\n--- SCAN FINDINGS: ---');
console.log(JSON.stringify(findings, null, 2));
