const fs = require('fs');
const pages = ['customers.js', 'inventory.js', 'sales.js', 'warranty.js', 'users.js', 'audit.js', 'pos.js'];
pages.forEach(p => {
  const c = fs.readFileSync('public/js/' + p, 'utf8');
  const hasBackdropClick = c.includes('e.target ===') || c.includes('modal-overlay');
  const hasEscKey = c.includes("Escape") || c.includes("27");
  console.log(p + ' : backdrop click = ' + hasBackdropClick + ', ESC key = ' + hasEscKey);
});
