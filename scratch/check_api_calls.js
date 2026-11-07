const fs = require('fs');
const path = require('path');

const jsFiles = fs.readdirSync('public/js').filter(f => f.endsWith('.js') && f !== 'mock-data.js');

const apiCalls = [];

for (const file of jsFiles) {
  const content = fs.readFileSync(path.join('public/js', file), 'utf8');
  // Match Api.get, Api.post, Api.put, Api.del
  const regex = /Api\.(get|post|put|del)\(\s*([`'"][^`'"]+[`'"])/g;
  let m;
  while ((m = regex.exec(content)) !== null) {
    const method = m[1].toUpperCase() === 'DEL' ? 'DELETE' : m[1].toUpperCase();
    const endpoint = m[2].slice(1, -1);
    apiCalls.push({ file, method, endpoint });
  }

  // Also match template literals like Api.get(`/users/${id}`)
  const regexTpl = /Api\.(get|post|put|del)\(\s*`([^`]+)`/g;
  while ((m = regexTpl.exec(content)) !== null) {
    const method = m[1].toUpperCase() === 'DEL' ? 'DELETE' : m[1].toUpperCase();
    const endpoint = m[2];
    apiCalls.push({ file, method, endpoint });
  }
}

console.log('Total API calls extracted:', apiCalls.length);

// Print all unique endpoints
const uniqueCalls = {};
for (const call of apiCalls) {
  const key = `${call.method} ${call.endpoint}`;
  uniqueCalls[key] = uniqueCalls[key] || [];
  uniqueCalls[key].push(call.file);
}

for (const [k, files] of Object.entries(uniqueCalls)) {
  console.log(`${k}  [used in ${[...new Set(files)].join(', ')}]`);
}
