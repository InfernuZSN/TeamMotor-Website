const fs = require('fs');
const path = require('path');

console.log('--- DEEP STATIC & RUNTIME CODEBASE AUDIT ---');

const htmlFiles = [
  'login.html', 'index.html', 'pos.html', 'inventory.html', 'sales.html',
  'customers.html', 'warranty.html', 'users.html', 'audit.html', 'settings.html', 'profile.html'
];

const jsFiles = [
  'app.js', 'store.js', 'local-api.js', 'mock-data.js', 'pos.js', 'inventory.js',
  'dashboard.js', 'sales.js', 'sales-trend.js', 'customers.js', 'warranty.js',
  'users.js', 'audit.js', 'settings.js', 'profile.js', 'receipt.js', 'shifts.js',
  'notifications.js', 'analytics.js'
];

// Check 1: Audit all getElementById calls in each JS file against corresponding HTML files
console.log('\n[1] Checking DOM ID lookups in JS vs HTML files...');
const htmlContents = {};
htmlFiles.forEach(f => {
  htmlContents[f] = fs.readFileSync(path.join('public', f), 'utf8');
});

// Mapping of page-specific JS to HTML
const pageMapping = {
  'dashboard.js': ['index.html'],
  'pos.js': ['pos.html'],
  'inventory.js': ['inventory.html'],
  'sales.js': ['sales.html'],
  'sales-trend.js': ['sales.html'],
  'customers.js': ['customers.html'],
  'warranty.js': ['warranty.html'],
  'users.js': ['users.html'],
  'audit.js': ['audit.html'],
  'settings.js': ['settings.html'],
  'profile.js': ['profile.html'],
  'notifications.js': htmlFiles,
  'app.js': htmlFiles
};

const idRegex = /document\.getElementById\(['"]([^'"]+)['"]\)/g;
const dollarRegex = /\$\(['"]([^'"]+)['"]\)/g;

const missingLookups = [];

Object.entries(pageMapping).forEach(([jsFile, targetHtmls]) => {
  const jsContent = fs.readFileSync(path.join('public', 'js', jsFile), 'utf8');
  const ids = new Set();
  let m;
  while ((m = idRegex.exec(jsContent)) !== null) ids.add(m[1]);
  while ((m = dollarRegex.exec(jsContent)) !== null) ids.add(m[1]);

  ids.forEach(id => {
    // Check if id exists in at least one of targetHtmls or in shared templates (sidebar, topbar, toast)
    const exists = targetHtmls.some(h => htmlContents[h].includes('id="' + id + '"') || htmlContents[h].includes("id='" + id + "'"));
    const isShared = ['sidebar', 'topbarActions', 'toastContainer', 'sidebarScrim', 'hamburgerBtn'].includes(id);
    if (!exists && !isShared) {
      missingLookups.push({ jsFile, id, targetHtmls });
    }
  });
});

console.log('Missing DOM ID lookups:', missingLookups);

// Check 2: Check all data-close references across all HTML files
console.log('\n[2] Checking modal data-close attributes vs modal overlay IDs...');
const closeRegex = /data-close=['"]([^'"]+)['"]/g;
const deadCloseButtons = [];
htmlFiles.forEach(h => {
  const content = htmlContents[h];
  let m;
  while ((m = closeRegex.exec(content)) !== null) {
    const targetModal = m[1];
    if (!content.includes('id="' + targetModal + '"') && !content.includes("id='" + targetModal + "'")) {
      deadCloseButtons.push({ htmlFile: h, targetModal });
    }
  }
});
console.log('Dead data-close buttons:', deadCloseButtons);

// Check 3: Check all buttons in HTML files for missing type or missing listeners
console.log('\n[3] Checking buttons without type attribute in forms...');
const btnNoType = [];
htmlFiles.forEach(h => {
  const content = htmlContents[h];
  const formBlocks = content.match(/<form[\s\S]*?<\/form>/gi) || [];
  formBlocks.forEach(fb => {
    const btns = fb.match(/<button(?![^>]*\btype=)[^>]*>/gi) || [];
    if (btns.length) {
      btnNoType.push({ htmlFile: h, count: btns.length, btns });
    }
  });
});
console.log('Form buttons missing explicit type attribute (default to submit):', btnNoType);

// Check 4: Check links with href="#" or javascript:
console.log('\n[4] Checking empty or hashtag links...');
const hashLinks = [];
htmlFiles.forEach(h => {
  const content = htmlContents[h];
  const links = content.match(/<a\b[^>]*href=['"]#['"][^>]*>/gi) || [];
  if (links.length) {
    hashLinks.push({ htmlFile: h, links });
  }
});
console.log('Hashtag links:', hashLinks);

