const fs = require('fs');

const tables = [
  { page: 'sales.html', js: 'sales.js', tbodyId: 'salesTbody' },
  { page: 'inventory.html', js: 'inventory.js', tbodyId: 'inventoryTbody' },
  { page: 'customers.html', js: 'customers.js', tbodyId: 'custTbody' },
  { page: 'warranty.html', js: 'warranty.js', tbodyId: 'warTbody' },
  { page: 'users.html', js: 'users.js', tbodyId: 'usersTbody' },
  { page: 'audit.html', js: 'audit.js', tbodyId: 'auditTbody' }
];

tables.forEach(t => {
  const html = fs.readFileSync('public/' + t.page, 'utf8');
  const js = fs.readFileSync('public/js/' + t.js, 'utf8');
  const tableMatch = html.match(new RegExp('<table[\\s\\S]*?id=[\"\']' + t.tbodyId + '[\"\'][\\s\\S]*?</table>', 'i'))
    || html.match(new RegExp('<thead[\\s\\S]*?</thead>[\\s\\S]*?id=[\"\']' + t.tbodyId + '[\"\']', 'i'));
  if (tableMatch) {
    const ths = (tableMatch[0].match(/<th\b/gi) || []).length;
    const csMatches = [...js.matchAll(/colspan=[\"\']?(\d+)[\"\']?/gi)].map(m => m[1]);
    console.log(t.page + ' -> ' + t.tbodyId + ': ' + ths + ' THs; JS colspans: ' + csMatches.join(', '));
  }
});
