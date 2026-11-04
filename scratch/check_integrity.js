const fs = require('fs');
const path = require('path');

console.log('--- CHECKING CASCADE / REFERENTIAL INTEGRITY CHECKS ---');
const localApiCode = fs.readFileSync(path.resolve('public/js/local-api.js'), 'utf8');
const catRoute = fs.readFileSync(path.resolve('server/src/routes/catalog.js'), 'utf8');
const supRoute = fs.readFileSync(path.resolve('server/src/routes/suppliers.js'), 'utf8');

// Check category delete in catalog.js vs local-api.js
console.log('Category delete check in server:');
const catDelServer = catRoute.match(/router\.delete\('\/categories[\s\S]*?\}\);/);
if (catDelServer) console.log(catDelServer[0]);

console.log('Category delete check in local-api:');
const catDelLocal = localApiCode.match(/if \(method === 'DELETE' && \/^\/categories\//i);
console.log('Found local delete categories:', !!catDelLocal);

// Check brand delete
console.log('Brand delete check in server:');
const brandDelServer = catRoute.match(/router\.delete\('\/brands[\s\S]*?\}\);/);
if (brandDelServer) console.log(brandDelServer[0]);

// Check moto delete
console.log('Moto delete check in server:');
const motoDelServer = catRoute.match(/router\.delete\('\/motos[\s\S]*?\}\);/);
if (motoDelServer) console.log(motoDelServer[0]);

// Check supplier delete
console.log('Supplier delete check in server:');
const supDelServer = supRoute.match(/router\.delete\('[\s\S]*?\}\);/);
if (supDelServer) console.log(supDelServer[0]);
