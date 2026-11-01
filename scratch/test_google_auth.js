const assert = require('assert');
const path = require('path');
const vm = require('vm');
const fs = require('fs');

console.log('Testing Google Auth & Profile Email Flow...');

// Mock browser globals
global.window = {
  localStorage: {
    _d: {},
    getItem(k) { return this._d[k] || null; },
    setItem(k, v) { this._d[k] = String(v); },
    removeItem(k) { delete this._d[k]; }
  },
  location: { protocol: 'file:', pathname: '/public/login.html' }
};
global.localStorage = global.window.localStorage;
global.document = { readyState: 'complete', addEventListener() {} };

function loadScript(relPath) {
  const code = fs.readFileSync(path.resolve(relPath), 'utf8');
  vm.runInThisContext(code, { filename: relPath });
}

loadScript('public/js/mock-data.js');
loadScript('public/js/local-api.js');

// 1. Initial login as Admin Ronnie Manalo
const initialLogin = LocalApi.handle('POST', '/auth/login', { username: 'ronnie.manalo', password: 'Admin@12345' }, null);
assert(initialLogin.token);
const adminToken = initialLogin.token;

// 2. Ronnie updates email in Profile menu to jerichalmazan14@gmail.com
const newEmail = 'jerichalmazan14@gmail.com';
const updateRes = LocalApi.handle('PUT', '/users/me/profile', {
  name: 'Ronnie Manalo',
  email: newEmail,
  birthDate: '1998-06-14',
  contactNumber: '+63 917 884 2109'
}, adminToken);

assert.strictEqual(updateRes.email, newEmail, 'profile email updated');
console.log('  [PASS] Profile updated email to ' + newEmail);

// 3. Verify it was persisted to storage
const storedDb = JSON.parse(global.localStorage.getItem('teammotor:local:db:v1'));
const storedAdmin = storedDb.users.find(u => u.username === 'ronnie.manalo');
assert.strictEqual(storedAdmin.email, newEmail, 'email persisted in localStorage');
console.log('  [PASS] Updated email persisted in storage');

// 4. Test Google login using the new profile email
const googleLogin = LocalApi.handle('POST', '/auth/google', { email: newEmail }, null);
assert(googleLogin.token, 'Google login returns session token');
assert.strictEqual(googleLogin.user.username, 'ronnie.manalo');
assert.strictEqual(googleLogin.user.email, newEmail);
assert.strictEqual(googleLogin.user.role, 'Admin');
console.log('  [PASS] Google login with ' + newEmail + ' successfully logged in as Ronnie Manalo (Admin)!');

console.log('\nALL PROFILE EMAIL -> GOOGLE AUTH TESTS PASSED!');
