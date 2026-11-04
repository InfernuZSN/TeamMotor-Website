const fs = require('fs');
const path = require('path');

const pageMapping = {
  'public/audit.html': ['public/js/audit.js'],
  'public/customers.html': ['public/js/customers.js'],
  'public/index.html': ['public/js/dashboard.js'],
  'public/inventory.html': ['public/js/inventory.js'],
  'public/pos.html': ['public/js/pos.js'],
  'public/profile.html': ['public/js/shifts.js', 'public/js/profile.js'],
  'public/sales.html': ['public/js/sales.js', 'public/js/sales-trend.js'],
  'public/settings.html': ['public/js/settings.js'],
  'public/users.html': ['public/js/shifts.js', 'public/js/users.js'],
  'public/warranty.html': ['public/js/warranty.js']
};

for (const [htmlFile, scripts] of Object.entries(pageMapping)) {
  const html = fs.readFileSync(htmlFile, 'utf8');
  const idRegex = /id=["']([^"']+)["']/g;
  const htmlIds = new Set();
  let m;
  while ((m = idRegex.exec(html)) !== null) {
    htmlIds.add(m[1]);
  }

  for (const s of scripts) {
    const js = fs.readFileSync(s, 'utf8');
    
    // getElementById('xyz')
    const gebiRegex = /getElementById\(["']([^"']+)["']\)/g;
    let jsm;
    while ((jsm = gebiRegex.exec(js)) !== null) {
      const id = jsm[1];
      if (!htmlIds.has(id)) {
        const createdInJs = js.includes('id="' + id + '"') || js.includes("id='" + id + "'") || js.includes('id=\\"' + id + '\\"') || js.includes('id=`' + id + '`');
        if (!createdInJs) {
          console.log(`[getElementById MISSING] ${htmlFile} uses ${s} -> getElementById('${id}') NOT in HTML`);
        }
      }
    }

    // querySelector('#xyz')
    const qsRegex = /querySelector(?:All)?\(["']#([a-zA-Z0-9_-]+)["']\)/g;
    while ((jsm = qsRegex.exec(js)) !== null) {
      const id = jsm[1];
      if (!htmlIds.has(id)) {
        const createdInJs = js.includes('id="' + id + '"') || js.includes("id='" + id + "'") || js.includes('id=\\"' + id + '\\"') || js.includes('id=`' + id + '`');
        if (!createdInJs) {
          console.log(`[querySelector MISSING] ${htmlFile} uses ${s} -> querySelector('#${id}') NOT in HTML`);
        }
      }
    }
  }
}
