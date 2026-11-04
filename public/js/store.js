/* ==========================================================================
   store.js — API client + in-memory data cache + page bootstrapper
   ----------------------------------------------------------------------
   The browser no longer owns any data. Everything lives in MongoDB behind the
   Express API (server/). This file keeps the OLD calling convention so the page
   scripts barely change:

     Store.get('products', [])   -> reads the in-memory copy loaded from GET /api/bootstrap
                                    (so reads stay synchronous, exactly like the old localStorage store)
     Api.post('/sales', {...})   -> every change goes to the server; the server validates, enforces
                                    roles, updates stock atomically and writes the audit trail
     await Store.refresh()       -> reload the cache after a change

   Boot.ready(fn)  runs fn once the user is authenticated and data is loaded (all page scripts use it).
   Boot.dom(fn)    like DOMContentLoaded, but also fires if the DOM is already parsed.

   Auth: JWT (8 h) kept in localStorage and sent as "Authorization: Bearer ...". The server re-checks the
   user + role on every request, so tampering with localStorage cannot grant access.
   To host the frontend on a different origin, set  window.TEAMMOTOR_API_BASE = 'https://api.example.com'
   before this script loads (and list the origin in CORS_ORIGINS on the server).
   ========================================================================== */
const Api = (function () {
  const TOKEN_KEY = 'teammotor:token';
  const USER_KEY = 'teammotor:user';
  const base = (window.TEAMMOTOR_API_BASE || '') + '/api';
  let memToken = null, memUser = null;

  function read(key) { try { return window.localStorage.getItem(key); } catch (e) { return null; } }
  function write(key, val) { try { if (val == null) window.localStorage.removeItem(key); else window.localStorage.setItem(key, val); } catch (e) { /* storage blocked */ } }

  function getToken() { return memToken || read(TOKEN_KEY); }
  function setToken(t) { memToken = t || null; write(TOKEN_KEY, t || null); }
  function getUser() { if (memUser) return memUser; try { return JSON.parse(read(USER_KEY) || 'null'); } catch (e) { return null; } }
  function setUser(u) { memUser = u || null; write(USER_KEY, u ? JSON.stringify(u) : null); }
  function clear() { memToken = null; memUser = null; write(TOKEN_KEY, null); write(USER_KEY, null); }

  function toLogin(reason) {
    clear();
    if (!/login\.html$/.test(location.pathname)) location.replace('login.html' + (reason ? '?reason=' + reason : ''));
  }

  /* ---- which backend? 'server' = Node/Express + MongoDB, 'local' = LocalApi (js/local-api.js, saved in this browser) ----
     • opened by double-click (file://)                 -> local
     • served by TeamMotor's Express server              -> server (GET /api/health answers JSON)
     • any other static host with no server behind it    -> local
     Force one with  window.TEAMMOTOR_MODE = 'server' | 'local'  before this script loads. */
  let mode = null, detecting = null;
  function detect() {
    if (mode) return Promise.resolve(mode);
    if (detecting) return detecting;
    detecting = (async function () {
      if (window.TEAMMOTOR_MODE === 'server' || window.TEAMMOTOR_MODE === 'local') mode = window.TEAMMOTOR_MODE;
      else if (location.protocol === 'file:') mode = 'local';
      else {
        try {
          const ctl = new AbortController(); const t = setTimeout(function () { ctl.abort(); }, 2500);
          const r = await fetch(base + '/health', { cache: 'no-store', signal: ctl.signal }); clearTimeout(t);
          mode = r.ok && /json/.test(r.headers.get('content-type') || '') ? 'server' : 'local';
        } catch (e) { mode = 'local'; }
      }
      if (mode === 'local' && typeof LocalApi === 'undefined') throw new Error('Offline mode files are missing (js/local-api.js).');
      return mode;
    })();
    return detecting;
  }

  async function request(method, path, body) {
    if ((await detect()) === 'local') {
      try { return LocalApi.handle(method, path, body, getToken()); }
      catch (e) { if (e.status === 401 && path.indexOf('/auth/login') !== 0) toLogin('expired'); throw e; }
    }
    const headers = { 'Accept': 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const token = getToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    let res;
    try {
      res = await fetch(base + path, { method: method, headers: headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    } catch (netErr) {
      const e = new Error('Cannot reach the TeamMotor server. Check that it is running.'); e.status = 0; e.network = true; throw e;
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* empty body */ }
    if (res.status === 401 && path.indexOf('/auth/login') !== 0) { toLogin('expired'); }
    if (!res.ok) {
      const e = new Error((data && data.error) || ('Request failed (' + res.status + ')'));
      e.status = res.status; e.details = data && data.details; throw e;
    }
    return data;
  }

  return {
    get: function (p) { return request('GET', p); },
    post: function (p, b) { return request('POST', p, b === undefined ? {} : b); },
    put: function (p, b) { return request('PUT', p, b === undefined ? {} : b); },
    del: function (p) { return request('DELETE', p); },
    detect: detect, mode: function () { return mode; },
    getToken: getToken, setToken: setToken, getUser: getUser, setUser: setUser, clear: clear, toLogin: toLogin
  };
})();

const Store = (function () {
  let data = {};
  let loaded = false;

  async function hydrate() {
    const d = await Api.get('/bootstrap');
    data = d;
    loaded = true;
    if (d.me) Api.setUser(d.me);
    // Let pages re-draw anything derived from the cache (e.g. Sales page product-movement tables).
    try { window.dispatchEvent(new CustomEvent('store:refreshed')); } catch (e) { /* very old browser */ }
    return d;
  }
  function get(key, fallback) {
    const v = data[key];
    return v === undefined || v === null ? fallback : v;
  }
  /* Local cache only (never persisted). Page code uses it to reflect an API response immediately. */
  function set(key, value) { data[key] = value; return value; }
  return { get: get, set: set, hydrate: hydrate, refresh: hydrate, isLoaded: function () { return loaded; } };
})();

const Boot = (function () {
  const queue = [];
  let isReady = false;
  let started = false;

  function dom(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }
  function ready(fn) {
    if (isReady) run(fn); else queue.push(fn);
    if (!started) { started = true; dom(start); }
  }
  function run(fn) { try { fn(); } catch (err) { console.error(err); } }

  function showFatal(message) {
    const bar = document.createElement('div');
    bar.setAttribute('role', 'alert');
    bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#b3261e;color:#fff;padding:12px 16px;font:600 14px system-ui,sans-serif;text-align:center;';
    bar.textContent = message + ' ';
    const retry = document.createElement('button');
    retry.textContent = 'Retry'; retry.style.cssText = 'margin-left:8px;padding:2px 10px;cursor:pointer;';
    retry.onclick = function () { location.reload(); };
    bar.appendChild(retry);
    document.body.appendChild(bar);
  }

  async function start() {
    const isPublic = document.body && document.body.hasAttribute('data-public');
    if (!isPublic) {
      if (!Api.getToken()) { Api.toLogin(); return; }
      try { await Store.hydrate(); }
      catch (err) { if (err.status === 401) return; showFatal(err.message); return; }
    }
    isReady = true;
    while (queue.length) run(queue.shift());
  }
  return { ready: ready, dom: dom };
})();
