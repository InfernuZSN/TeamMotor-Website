/* ==========================================================================
   app.js
   ----------------------------------------------------------------------
   Shared shell for the internal (Admin/Staff) pages: icon set, session
   handling, sidebar + topbar rendering, mobile drawer, account menu,
   toasts. Included on every page — the DOM lookups are all defensive so
   it's harmless to load on pages that don't use every piece.
   ========================================================================== */

/* ---------- Icon set: plain SVG inner-markup, no build step needed ---------- */
const Icons = {
  dashboard: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  inventory: '<polygon points="12,3 21,7.5 21,16.5 12,21 3,16.5 3,7.5"/><polyline points="3,7.5 12,12 21,7.5"/><line x1="12" y1="12" x2="12" y2="21"/>',
  pos: '<circle cx="9" cy="20" r="1.6"/><circle cx="18" cy="20" r="1.6"/><polyline points="1,3 4,3 6.5,15 18,15 20,7 5.5,7"/>',
  sales: '<line x1="5" y1="20" x2="5" y2="11"/><line x1="12" y1="20" x2="12" y2="5"/><line x1="19" y1="20" x2="19" y2="14"/>',
  suppliers: '<rect x="1" y="7" width="13" height="9" rx="1"/><polygon points="14,10 18,10 21,13 21,16 14,16"/><circle cx="6" cy="18.5" r="1.7"/><circle cx="17" cy="18.5" r="1.7"/>',
  users: '<circle cx="9" cy="8" r="3.4"/><polyline points="2,20 2,19 4,15 14,15 16,19 16,20"/><circle cx="18" cy="9" r="2.6"/><polyline points="16.5,20 16.5,18.5 18,15.5 22,15.5"/>',
  bell: '<polygon points="12,3.2 8,8 8,13.2 5,16 19,16 16,13.2 16,8"/><rect x="10" y="18" width="4" height="2.4" rx="1.2"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><line x1="15.3" y1="15.3" x2="21" y2="21"/>',
  hamburger: '<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>',
  close: '<line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/>',
  chevronDown: '<polyline points="6,9 12,15 18,9"/>',
  chevronRight: '<polyline points="9,6 15,12 9,18"/>',
  chevronLeft: '<polyline points="15,6 9,12 15,18"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  minus: '<line x1="5" y1="12" x2="19" y2="12"/>',
  edit: '<polygon points="3,17.5 3,21 6.5,21 17,10.5 13.5,7 3,17.5"/><line x1="16" y1="4" x2="20" y2="8"/><line x1="13.5" y1="7" x2="17" y2="10.5"/>',
  eye: '<polygon points="12,5 22,12 12,19 2,12"/><circle cx="12" cy="12" r="3"/>',
  stockIn: '<line x1="12" y1="19" x2="12" y2="5"/><polyline points="6,11 12,5 18,11"/>',
  stockOut: '<line x1="12" y1="5" x2="12" y2="19"/><polyline points="6,13 12,19 18,13"/>',
  history: '<circle cx="12" cy="12" r="9"/><polyline points="12,7 12,12 16,14"/>',
  filter: '<polygon points="3,4 21,4 14,12.5 14,19 10,21 10,12.5"/>',
  logout: '<rect x="3" y="4" width="9" height="16" rx="1.5"/><line x1="10" y1="12" x2="21" y2="12"/><polyline points="17,8 21,12 17,16"/>',
  refresh: '<polyline points="3,4 3,9 8,9"/><polyline points="21,20 21,15 16,15"/><polyline points="3,9 7,5.5 12,4.5 17,6 20,9.5"/><polyline points="21,15 17,18.5 12,19.5 7,18 4,14.5"/>',
  mail: '<rect x="2" y="5" width="20" height="14" rx="1.5"/><polyline points="2,7 12,14 22,7"/>',
  phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><line x1="10" y1="18" x2="14" y2="18"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><polyline points="7.5,12.5 10.5,15.5 16.5,9"/>',
  alertTriangle: '<polygon points="12,3 22,20 2,20"/><line x1="12" y1="9" x2="12" y2="14"/><circle cx="12" cy="17" r="0.9"/>',
  xCircle: '<circle cx="12" cy="12" r="9"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/>',
  infoCircle: '<circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><circle cx="12" cy="7.5" r="0.9"/>',
  cart: '<circle cx="9" cy="20" r="1.6"/><circle cx="18" cy="20" r="1.6"/><polyline points="1,3 4,3 6.5,15 18,15 20,7 5.5,7"/>',
  share: '<circle cx="18" cy="5" r="2.4"/><circle cx="6" cy="12" r="2.4"/><circle cx="18" cy="19" r="2.4"/><line x1="8.2" y1="10.8" x2="15.8" y2="6.2"/><line x1="8.2" y1="13.2" x2="15.8" y2="17.8"/>',
  link: '<rect x="2" y="8" width="9" height="8" rx="4"/><rect x="13" y="8" width="9" height="8" rx="4"/><line x1="9" y1="12" x2="15" y2="12"/>',
  tag: '<polygon points="12,2 21,2 21,11 12,20 3,11 3,2"/><circle cx="16.5" cy="6.5" r="1.4"/>',
  trendUp: '<polyline points="3,17 9,11 13,15 21,6"/><polyline points="15,6 21,6 21,12"/>',
  download: '<line x1="12" y1="3" x2="12" y2="14"/><polyline points="7,10 12,15 17,10"/><line x1="4" y1="19" x2="20" y2="19"/>',
  camera: '<rect x="2" y="7" width="20" height="14" rx="2"/><polygon points="8,7 10,4 14,4 16,7"/><circle cx="12" cy="14" r="4"/>',
  motorcycle: '<circle cx="5" cy="18" r="3"/><circle cx="19" cy="18" r="3"/><polyline points="5,18 9,10 14,10 19,18"/><line x1="9" y1="10" x2="7" y2="6"/><line x1="14" y1="10" x2="16" y2="7"/>',
  box: '<polygon points="12,3 21,7.5 21,16.5 12,21 3,16.5 3,7.5"/><polyline points="3,7.5 12,12 21,7.5"/><line x1="12" y1="12" x2="12" y2="21"/>',
  archive: '<rect x="2" y="4" width="20" height="5" rx="1"/><rect x="4" y="9" width="16" height="11" rx="1"/><line x1="10" y1="13" x2="14" y2="13"/>',
  shield: '<polygon points="12,3 20,6.5 20,12 12,21 4,12 4,6.5"/><polyline points="8.5,11.5 11,14 15.5,8.5"/>',
  userPlus: '<circle cx="9" cy="8" r="3.4"/><polyline points="2,20 2,19 4,15 14,15 16,19 16,20"/><line x1="18" y1="8" x2="18" y2="14"/><line x1="15" y1="11" x2="21" y2="11"/>',
  clock: '<circle cx="12" cy="12" r="9"/><polyline points="12,7 12,12 16,14"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4,21 C4,16.5 7.5,14 12,14 C16.5,14 20,16.5 20,21"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9,7 L9,5 C9,4.4 9.4,4 10,4 L14,4 C14.6,4 15,4.4 15,5 L15,7"/><line x1="3" y1="13" x2="21" y2="13"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8,11 L8,8 C8,5.8 9.8,4 12,4 C14.2,4 16,5.8 16,8 L16,11"/>',
  key: '<circle cx="8" cy="15" r="4"/><line x1="11" y1="12" x2="20" y2="3"/><line x1="16" y1="7" x2="19" y2="10"/>',
  eyeOff: '<polygon points="12,5 22,12 12,19 2,12"/><circle cx="12" cy="12" r="3"/><line x1="3" y1="3" x2="21" y2="21"/>',
  trash: '<polyline points="3,6 5,6 21,6"/><path d="M19,6 L18,20 C18,21.1 17.1,22 16,22 L8,22 C6.9,22 6,21.1 6,20 L5,6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/><path d="M9,6 L9,4 C9,3.4 9.4,3 10,3 L14,3 C14.6,3 15,3.4 15,4 L15,6"/>'
};
function icon(name, cls) {
  return '<svg class="' + (cls || '') + '" viewBox="0 0 24 24">' + (Icons[name] || '') + '</svg>';
}

/* ---------- Session (JWT) ----------
   The token lives in localStorage (see Api in store.js); the user record is refreshed from the server on every
   page load (GET /api/bootstrap -> `me`). The server re-checks identity and role on every request, so the values
   below only drive what the UI shows — they are never what protects data. */
const PHOTO_PATTERN = /^data:image\/[a-z+.-]+;base64,[A-Za-z0-9+\/=]+$/;

function getSession() {
  const u = Api.getUser();
  return Api.getToken() && u && u.role ? u : null;
}

function setSession(token, user) {
  Api.setToken(token);
  Api.setUser(user);
}

function clearSession() {
  Api.clear();
}

function requireSession() {
  const session = getSession();
  if (!session) { Api.toLogin(); return null; }
  return session;
}

async function logout() {
  try { await Api.post('/auth/logout'); } catch (e) { /* token may already be expired */ }
  clearSession();
  window.location.href = 'login.html';
}

function initials(name) {
  if (!name) return '?';
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

/* Re-draw the sidebar-footer and top-right avatars (called after the profile photo changes). */
function syncProfileAvatars() {
  const session = getSession();
  if (!session) return;
  ['.sidebar-user .avatar', '#accountTrigger .avatar'].forEach(function (selector) {
    const el = document.querySelector(selector);
    if (el) el.innerHTML = accountAvatarHTML(session);
  });
}

function bindProfileAvatarSync() {
  window.addEventListener('pageshow', function (e) { if (e.persisted) syncProfileAvatars(); });
}

/* The profile photo is stored on the user record in MongoDB (resized data URL). The strict pattern keeps
   anything unexpected out of the markup. */
function profilePhotoFor(session) {
  return PHOTO_PATTERN.test(session.photo || '') ? session.photo : '';
}

/* Update the cached session user (e.g. after the profile photo or name was saved). */
function rememberSessionPhoto(photo) {
  const u = Api.getUser();
  if (!u) return;
  const next = Object.assign({}, u);
  if (photo) next.photo = photo; else delete next.photo;
  Api.setUser(next);
}

/* Inner HTML for the top-right account avatar (next to the notification bell): the profile photo saved on the
   user record by profile.js when there is one, otherwise the initials. Used on every page and again by
   profile.js right after the photo changes. Same strict data-URL check the sidebar footer uses. */
function accountAvatarHTML(session) {
  const photo = profilePhotoFor(session);
  return photo ? '<img src="' + photo + '" alt="">' : Utils.escapeHtml(initials(session.name));
}

/* ---------- Toasts ---------- */
/* ---------- Form validation (inline, styled — no native browser popups) ---------- */
function validateForm(formEl) {
  let isValid = true;
  let firstInvalid = null;
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  formEl.querySelectorAll('[required], [pattern]').forEach(function (input) {
    if (input.disabled) return;
    const field = input.closest('.field');
    let fieldValid = true;
    const val = (input.value || '').trim();

    if (input.type === 'radio') {
      const group = formEl.querySelectorAll('[name="' + input.name + '"]');
      fieldValid = Array.prototype.some.call(group, function (r) { return r.checked; });
    } else if (!val) {
      fieldValid = !input.required;
    } else if (input.type === 'email' && !emailRe.test(val)) {
      fieldValid = false;
    } else if (input.type === 'number' && (isNaN(val) || (input.min !== '' && Number(val) < Number(input.min)))) {
      fieldValid = false;
    } else if (input.pattern && val) {
      const re = new RegExp('^(?:' + input.pattern + ')$');
      if (!re.test(val)) fieldValid = false;
    }

    if (field) {
      field.classList.toggle('has-error', !fieldValid);
      let msg = field.querySelector('.field-error-msg');
      if (!fieldValid) {
        if (!msg) {
          msg = document.createElement('div');
          msg.className = 'field-error-msg';
          field.appendChild(msg);
        }
        msg.innerHTML = icon('alertTriangle') + '<span>' + (input.dataset.errorMsg ||
          (input.type === 'email' ? 'Enter a valid email address.' : 'This field is required.')) + '</span>';
      } else if (msg) {
        msg.remove();
      }
    }
    if (!fieldValid) {
      isValid = false;
      if (!firstInvalid) firstInvalid = input;
    }
  });

  if (firstInvalid) firstInvalid.focus();
  return isValid;
}
// Clear a field's error as soon as the person starts fixing it.
document.addEventListener('input', function (e) {
  if (e.target && e.target.id === 'pId') return;
  const field = e.target.closest && e.target.closest('.field.has-error');
  if (!field) return;
  const val = (e.target.value || '').trim();
  if (val || !e.target.required) {
    field.classList.remove('has-error');
    const msg = field.querySelector('.field-error-msg');
    if (msg) msg.remove();
  }
});

function showToast(message, type) {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    container.id = 'toastContainer';
    document.body.appendChild(container);
  }
  const iconName = type === 'danger' ? 'xCircle' : (type === 'warning' || type === 'warn') ? 'alertTriangle' : type === 'info' ? 'infoCircle' : 'checkCircle';
  const el = document.createElement('div');
  el.className = 'toast toast-' + (type || 'ok');
  el.innerHTML = icon(iconName) + '<div class="msg">' + Utils.escapeHtml(message) + '</div>';
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .2s ease';
    setTimeout(() => el.remove(), 220);
  }, 3200);
}

/* ---------- Sidebar / topbar for internal pages ---------- */
const NAV_ITEMS = {
  Admin: [
    { key: 'dashboard', href: 'index.html', label: 'Dashboard', iconName: 'dashboard' },
    { key: 'inventory', href: 'inventory.html', label: 'Inventory', iconName: 'inventory' },
    { key: 'pos', href: 'pos.html', label: 'POS', iconName: 'pos' },
    { key: 'sales', href: 'sales.html', label: 'Sales', iconName: 'sales' },
    { key: 'customers', href: 'customers.html', label: 'Customers', iconName: 'users' },
    { key: 'warranty', href: 'warranty.html', label: 'Warranty', iconName: 'shield' },
    { key: 'users', href: 'users.html', label: 'Users', iconName: 'userPlus' },
    { key: 'audit', href: 'audit.html', label: 'Audit Trail', iconName: 'history' },
    { key: 'settings', href: 'settings.html', label: 'Settings', iconName: 'tag' }
  ],
  Staff: [
    { key: 'dashboard', href: 'index.html', label: 'Dashboard', iconName: 'dashboard' },
    { key: 'inventory', href: 'inventory.html', label: 'Inventory', iconName: 'inventory' },
    { key: 'pos', href: 'pos.html', label: 'POS', iconName: 'pos' },
    { key: 'sales', href: 'sales.html', label: 'Sales', iconName: 'sales' },
    { key: 'customers', href: 'customers.html', label: 'Customers', iconName: 'users' },
    { key: 'warranty', href: 'warranty.html', label: 'Warranty', iconName: 'shield' }
  ]
};

function renderSidebar(activeKey) {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  const session = requireSession();
  if (!session) return;
  const items = NAV_ITEMS[session.role] || NAV_ITEMS.Staff;
  const products = Store.get('products', []);
  const lowStockCount = Analytics.lowStockProducts(products).length + Analytics.outOfStockProducts(products).length;
  // Profile photo (saved on the user record by profile.js as a resized data URL). The strict pattern
  // keeps anything unexpected out of the markup below.
  const mePhoto = profilePhotoFor(session);

  sidebar.innerHTML =
    '<div class="sidebar-brand">' +
      '<div class="brand-mark">' + icon('motorcycle') + '</div>' +
      '<div class="brand-text">TeamMotor<span>Parts &amp; Accessories</span></div>' +
    '</div>' +
    '<div class="nav-group-label">Menu</div>' +
    items.map(item =>
      '<a class="nav-item' + (item.key === activeKey ? ' active' : '') + '" href="' + item.href + '" title="' + item.label + '">' +
        icon(item.iconName) + '<span>' + item.label + '</span>' +
        (item.key === 'inventory' && lowStockCount > 0 ? '<span class="nav-badge">' + lowStockCount + '</span>' : '') +
      '</a>'
    ).join('') +
    '<div class="sidebar-footer">' +
      '<a class="sidebar-user' + (activeKey === 'profile' ? ' active' : '') + '" href="profile.html" title="My profile">' +
        '<div class="avatar">' + (mePhoto ? '<img src="' + mePhoto + '" alt="">' : initials(session.name)) + '</div>' +
        '<div class="who"><strong>' + Utils.escapeHtml(session.name) + '</strong><span>' + session.role + '</span></div>' +
      '</a>' +
    '</div>';

  const scrim = document.getElementById('sidebarScrim');
  if (scrim) {
    sidebar.querySelectorAll('.nav-item').forEach(a => a.addEventListener('click', closeMobileSidebar));
  }
  const oldNav = document.getElementById('mobileBottomNav');
  if (oldNav) oldNav.remove();
}

function openMobileSidebar() {
  const sidebar = document.getElementById('sidebar');
  const scrim = document.getElementById('sidebarScrim');
  if (sidebar) sidebar.classList.add('open');
  if (scrim) scrim.classList.add('open');
}
function closeMobileSidebar() {
  const sidebar = document.getElementById('sidebar');
  const scrim = document.getElementById('sidebarScrim');
  if (sidebar) sidebar.classList.remove('open');
  if (scrim) scrim.classList.remove('open');
}

function renderTopbarActions() {
  const mount = document.getElementById('topbarActions');
  if (!mount) return;
  const session = getSession();
  if (!session) return;
  mount.innerHTML =
    '<div class="notif-btn account-menu" id="notifWrap">' +
      '<button class="icon-btn" id="notifBell" aria-label="Notifications">' + icon('bell') + '<span id="notifDot"></span></button>' +
      '<div class="notif-panel" id="notifPanel"></div>' +
    '</div>' +
    '<div class="account-menu" id="accountWrap">' +
      '<button class="account-trigger" id="accountTrigger">' +
        '<span class="avatar">' + accountAvatarHTML(session) + '</span>' +
        icon('chevronDown') +
      '</button>' +
      '<div class="account-dropdown" id="accountDropdown">' +
        '<button type="button" id="myProfileBtn">' + icon('user') + ' My Profile</button>' +
        '<hr>' +
        '<button type="button" id="logoutBtn">' + icon('logout') + ' Log out</button>' +
      '</div>' +
    '</div>';

  document.getElementById('accountTrigger').addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('accountDropdown').classList.toggle('open');
    document.getElementById('notifPanel').classList.remove('open');
  });
  document.getElementById('myProfileBtn').addEventListener('click', () => {
    window.location.href = 'profile.html';
  });
  document.getElementById('logoutBtn').addEventListener('click', logout);
  document.addEventListener('click', () => {
    document.getElementById('accountDropdown').classList.remove('open');
  });
}

function requireRole(role) {
  const session = getSession();
  if (!session) return false;
  if (session.role !== role) {
    const page = document.querySelector('.page');
    if (page) {
      page.innerHTML =
        '<div class="empty-state card" style="max-width:420px;margin:60px auto;">' +
          icon('alertTriangle') +
          '<h3>Admin access required</h3>' +
          '<p>You&rsquo;re signed in as ' + Utils.escapeHtml(session.name) + ' (' + session.role + '). This page is limited to Admin/Owner accounts.</p>' +
          '<a class="btn btn-primary" href="index.html">Go to Dashboard</a>' +
        '</div>';
    }
    return false;
  }
  return true;
}

/* ---------- Sidebar collapse: grey round arrow button on the sidebar's right edge ----------
   Points left while the sidebar is open (click to minimize) and right while it is
   minimized (click to maximize). The choice is remembered per browser so moving
   between pages doesn't snap the sidebar back open. UI preference only — it
   deliberately does not go through Store, which is reserved for shop data. */
const SIDEBAR_COLLAPSED_KEY = 'motoshop:sidebarCollapsed';

function initSidebarToggle() {
  const shell = document.querySelector('.app-shell');
  if (!shell || document.getElementById('sidebarToggle')) return;
  let collapsed = false;
  try { collapsed = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'; } catch (e) { /* ignore */ }

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'sidebarToggle';
  btn.className = 'sidebar-toggle';
  shell.appendChild(btn);

  function apply() {
    shell.classList.toggle('is-collapsed', collapsed);
    btn.innerHTML = icon(collapsed ? 'chevronRight' : 'chevronLeft');
    btn.setAttribute('aria-label', collapsed ? 'Maximize sidebar' : 'Minimize sidebar');
    btn.setAttribute('aria-expanded', String(!collapsed));
  }
  btn.addEventListener('click', function () {
    collapsed = !collapsed;
    try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0'); } catch (e) { /* ignore */ }
    apply();
  });
  apply();
}

/* ---------- Escape closes the top-most open .modal-overlay (every internal page) ----------
   Closing goes through the page's own logic first — a backdrop click, which every page script already
   handles (e.g. users.js stops its shift timer there) — and only falls back to removing .open directly.
   The POS screen uses its own .pt-overlay stack + Escape handler, so it is not affected. */
let escapeCloseBound = false;
function bindEscapeToCloseModals() {
  if (escapeCloseBound) return;
  escapeCloseBound = true;
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    const open = document.querySelectorAll('.modal-overlay.open');
    if (!open.length) return;
    const top = open[open.length - 1];                    // later in the DOM = drawn on top (confirm dialogs are appended last)
    top.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));   // target === overlay -> page backdrop handler
    if (top.isConnected && top.classList.contains('open')) top.classList.remove('open');
    e.preventDefault();
  });
}

function initShell(activeKey) {
  if (!requireSession()) return false;
  initSidebarToggle();
  renderSidebar(activeKey);
  renderTopbarActions();
  bindProfileAvatarSync();
  bindEscapeToCloseModals();
  const hamburger = document.getElementById('hamburgerBtn');
  if (hamburger) hamburger.addEventListener('click', openMobileSidebar);
  const scrim = document.getElementById('sidebarScrim');
  if (scrim) scrim.addEventListener('click', closeMobileSidebar);
  if (window.Notifications) Notifications.init();
  if (Api.mode() === 'local') showOfflineBadge();
  initMobileEnhancements();
  try {                                   // message left by an action that reloaded the page
    const flash = sessionStorage.getItem('tm:flash');
    if (flash) { sessionStorage.removeItem('tm:flash'); showToast(flash, 'ok'); }
  } catch (e) { /* ignore */ }
  return true;
}

/* ---------- Mobile Ergonomics, Table-to-Card Labels & Filter Drawers (inert on >768px) ---------- */
let mobileEnhancementsBound = false;
function shortMobileActionLabel(raw) {
  if (!raw) return '';
  if (/stock in/i.test(raw)) return 'Stock In';
  if (/stock out/i.test(raw)) return 'Stock Out';
  if (/adjust/i.test(raw)) return 'Adjust';
  if (/unarchive|reactivate/i.test(raw)) return 'Restore';
  if (/archive|inactive/i.test(raw)) return 'Archive';
  if (/reprint/i.test(raw)) return 'Reprint';
  if (/claim/i.test(raw)) return 'Claim';
  if (/shift/i.test(raw)) return 'Shifts';
  if (/delete/i.test(raw)) return 'Delete';
  if (/edit/i.test(raw)) return 'Edit';
  if (/view/i.test(raw)) return 'View';
  return '';
}

function syncMobileTableLabels() {
  document.querySelectorAll('table').forEach(function (table) {
    if (table.classList.contains('rcpt-items') || table.classList.contains('order-table')) return;
    const thead = table.querySelector('thead');
    const tbody = table.querySelector('tbody');
    if (!thead || !tbody) return;
    const headers = Array.from(thead.querySelectorAll('th')).map(function (th) {
      return (th.textContent || '').trim();
    });
    if (!headers.length) return;

    const h0 = (headers[0] || '').toLowerCase();
    const h1 = (headers[1] || '').toLowerCase();
    const h2 = (headers[2] || '').toLowerCase();
    let primaryIdx = 0;
    if ((h0 === 'date' && h1 === 'product') || (h0 === 'customer id' && h1 === 'name') || (h0 === '#' && h1 === 'product')) {
      primaryIdx = 1;
    } else if (h0 === 'when' && h2 === 'action') {
      primaryIdx = 2;
    }

    Array.from(tbody.children).forEach(function (tr) {
      if (tr.tagName !== 'TR' || tr.dataset.mSynced === '1') return;
      tr.dataset.mSynced = '1';
      const cells = Array.from(tr.children);
      if (cells.length === 1 && cells[0].hasAttribute('colspan')) {
        tr.classList.add('mobile-empty-row');
        return;
      }
      cells.forEach(function (td, idx) {
        const lbl = headers[idx] || '';
        if (lbl) td.setAttribute('data-label', lbl);
        const lower = lbl.toLowerCase();
        const isAction = lower === 'actions' || lower === 'view' || td.classList.contains('col-actions') ||
          (idx === cells.length - 1 && !!td.querySelector('.icon-btn, .au-view-btn'));
        if (isAction) {
          td.classList.add('mobile-cell-actions');
          td.querySelectorAll('.icon-btn').forEach(function (btn) {
            if (!btn.hasAttribute('data-mobile-label')) {
              const shortLbl = shortMobileActionLabel(btn.getAttribute('title') || btn.getAttribute('aria-label') || '');
              if (shortLbl) btn.setAttribute('data-mobile-label', shortLbl);
            }
          });
        } else if (idx === primaryIdx) {
          td.classList.add('mobile-cell-primary');
        } else if (primaryIdx > 0 && idx === 0) {
          td.classList.add('mobile-cell-meta');
        }
        if (/compatibility|reference|notes|items|summary|email/i.test(lower)) {
          td.classList.add('mobile-cell-wide');
        }
      });
    });
  });
}

function initMobileSearchAndInputs() {
  document.querySelectorAll('.search-input').forEach(function (wrap) {
    if (wrap.querySelector('.search-clear-btn')) return;
    const input = wrap.querySelector('input');
    if (!input) return;
    if (!input.getAttribute('inputmode')) input.setAttribute('inputmode', 'search');
    input.setAttribute('autocorrect', 'off');
    input.setAttribute('autocapitalize', 'off');
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'search-clear-btn';
    clearBtn.setAttribute('aria-label', 'Clear search');
    clearBtn.hidden = !input.value;
    clearBtn.innerHTML = icon('close');
    wrap.appendChild(clearBtn);

    const syncClear = function () { clearBtn.hidden = !input.value; };
    input.addEventListener('input', syncClear);
    clearBtn.addEventListener('click', function () {
      input.value = '';
      clearBtn.hidden = true;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
    });
  });

  document.querySelectorAll('input[type="number"]').forEach(function (inp) {
    if (inp.getAttribute('inputmode')) return;
    const step = inp.getAttribute('step');
    inp.setAttribute('inputmode', step && step.indexOf('.') !== -1 ? 'decimal' : 'numeric');
  });
  document.querySelectorAll('input[type="tel"], #cPhone, #supPhone, #sPhone, #pfContact, #qcPhone').forEach(function (inp) {
    if (!inp.getAttribute('inputmode')) inp.setAttribute('inputmode', 'tel');
  });
  document.querySelectorAll('#pId, #pSku, #sReference, #uUsername, #username').forEach(function (inp) {
    inp.setAttribute('autocorrect', 'off');
    inp.setAttribute('autocapitalize', 'off');
    inp.setAttribute('spellcheck', 'false');
  });
}

function initMobileFilterDrawers() {
  /* 1. Inventory Products tab: collapsible filter drawer + quick status pills */
  const tabProducts = document.getElementById('tab-products');
  if (tabProducts && !document.getElementById('invMobileFilterBtn')) {
    const bars = tabProducts.querySelectorAll(':scope > .filter-bar');
    if (bars.length >= 1) {
      bars[0].classList.add('mobile-collapsible-bar', 'mobile-bar-primary');
      if (bars[1]) bars[1].classList.add('mobile-collapsible-bar', 'mobile-bar-secondary');

      const searchWrap = bars[0].querySelector('.search-input');
      const filterBtn = document.createElement('button');
      filterBtn.type = 'button';
      filterBtn.className = 'btn btn-secondary mobile-filter-btn';
      filterBtn.id = 'invMobileFilterBtn';
      filterBtn.setAttribute('aria-expanded', 'false');
      if (searchWrap && searchWrap.nextSibling) bars[0].insertBefore(filterBtn, searchWrap.nextSibling);
      else bars[0].appendChild(filterBtn);

      const quickChips = document.createElement('div');
      quickChips.className = 'mobile-quick-chips';
      quickChips.id = 'invMobileQuickChips';
      quickChips.setAttribute('role', 'group');
      quickChips.setAttribute('aria-label', 'Quick stock status filters');
      quickChips.innerHTML =
        '<button type="button" class="chip active" data-qstatus="">All</button>' +
        '<button type="button" class="chip" data-qstatus="In Stock">In Stock</button>' +
        '<button type="button" class="chip" data-qstatus="Low Stock">Low Stock</button>' +
        '<button type="button" class="chip" data-qstatus="Out of Stock">Out of Stock</button>' +
        '<button type="button" class="chip" data-qstatus="Expiring Soon">Expiring</button>' +
        '<button type="button" class="chip" data-qarchived="1">Archived</button>';
      bars[0].insertAdjacentElement('afterend', quickChips);

      const footerHost = bars[1] || bars[0];
      const drawerFoot = document.createElement('div');
      drawerFoot.className = 'mobile-filter-footer';
      drawerFoot.innerHTML =
        '<button type="button" class="btn btn-secondary btn-sm" id="invMobileResetFilters">Reset Filters</button>' +
        '<button type="button" class="btn btn-primary btn-sm" id="invMobileApplyFilters">Done</button>';
      footerHost.appendChild(drawerFoot);

      const selectIds = ['filterCategory', 'filterProductBrand', 'filterSupplier', 'filterStatus', 'filterBrand', 'filterModel'];
      const syncInvBadge = function () {
        let count = 0;
        selectIds.forEach(function (id) {
          const el = document.getElementById(id);
          if (el && el.value) count++;
        });
        const sortEl = document.getElementById('sortBy');
        if (sortEl && sortEl.value && sortEl.value !== 'name-asc') count++;
        const archChip = document.getElementById('toggleArchivedChip');
        const isArch = archChip && archChip.classList.contains('active');
        if (isArch) count++;

        filterBtn.innerHTML = icon('filter') + '<span>Filter &amp; Sort</span>' +
          (count > 0 ? '<em class="mobile-filter-count">' + count + '</em>' : '');
        filterBtn.classList.toggle('has-active-filters', count > 0);

        const curStatus = (document.getElementById('filterStatus') || {}).value || '';
        quickChips.querySelectorAll('[data-qstatus]').forEach(function (c) {
          c.classList.toggle('active', !isArch && c.dataset.qstatus === curStatus);
        });
        const qArch = quickChips.querySelector('[data-qarchived]');
        if (qArch) qArch.classList.toggle('active', !!isArch);
      };

      filterBtn.addEventListener('click', function () {
        const open = tabProducts.classList.toggle('filters-open');
        filterBtn.setAttribute('aria-expanded', String(open));
      });
      document.getElementById('invMobileApplyFilters').addEventListener('click', function () {
        tabProducts.classList.remove('filters-open');
        filterBtn.setAttribute('aria-expanded', 'false');
      });
      document.getElementById('invMobileResetFilters').addEventListener('click', function () {
        selectIds.forEach(function (id) {
          const el = document.getElementById(id);
          if (el) el.value = '';
        });
        const sortEl = document.getElementById('sortBy');
        if (sortEl) sortEl.value = 'name-asc';
        const archChip = document.getElementById('toggleArchivedChip');
        if (archChip && archChip.classList.contains('active')) archChip.click();
        const brandEl = document.getElementById('filterBrand');
        if (brandEl) brandEl.dispatchEvent(new Event('change'));
        const catEl = document.getElementById('filterCategory');
        if (catEl) catEl.dispatchEvent(new Event('change'));
        syncInvBadge();
      });

      quickChips.addEventListener('click', function (e) {
        const stBtn = e.target.closest('[data-qstatus]');
        const arBtn = e.target.closest('[data-qarchived]');
        const statusSel = document.getElementById('filterStatus');
        const archChip = document.getElementById('toggleArchivedChip');
        if (stBtn && statusSel) {
          if (archChip && archChip.classList.contains('active')) archChip.click();
          statusSel.value = stBtn.dataset.qstatus;
          statusSel.dispatchEvent(new Event('change'));
          syncInvBadge();
        } else if (arBtn && archChip) {
          archChip.click();
          syncInvBadge();
        }
      });

      selectIds.concat(['sortBy']).forEach(function (id) {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', syncInvBadge);
      });
      const archChip = document.getElementById('toggleArchivedChip');
      if (archChip) archChip.addEventListener('click', function () { setTimeout(syncInvBadge, 0); });
      syncInvBadge();
    }
  }

  /* 2. Inventory History tab: collapsible filter drawer */
  const tabHistory = document.getElementById('tab-history');
  if (tabHistory && !document.getElementById('histMobileFilterBtn')) {
    const bar = tabHistory.querySelector('.filter-bar');
    if (bar) {
      bar.classList.add('mobile-collapsible-bar', 'mobile-bar-primary');
      const searchWrap = bar.querySelector('.search-input');
      const filterBtn = document.createElement('button');
      filterBtn.type = 'button';
      filterBtn.className = 'btn btn-secondary mobile-filter-btn';
      filterBtn.id = 'histMobileFilterBtn';
      filterBtn.setAttribute('aria-expanded', 'false');
      if (searchWrap && searchWrap.nextSibling) bar.insertBefore(filterBtn, searchWrap.nextSibling);
      else bar.appendChild(filterBtn);

      const syncHistBadge = function () {
        let count = 0;
        ['filterHistType', 'filterHistReason'].forEach(function (id) {
          const el = document.getElementById(id);
          if (el && el.value) count++;
        });
        filterBtn.innerHTML = icon('filter') + '<span>Filters</span>' +
          (count > 0 ? '<em class="mobile-filter-count">' + count + '</em>' : '');
        filterBtn.classList.toggle('has-active-filters', count > 0);
      };
      filterBtn.addEventListener('click', function () {
        const open = tabHistory.classList.toggle('filters-open');
        filterBtn.setAttribute('aria-expanded', String(open));
      });
      ['filterHistType', 'filterHistReason'].forEach(function (id) {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', syncHistBadge);
      });
      syncHistBadge();
    }
  }

  /* 3. Audit Trail page: collapsible filter bar */
  const auSearch = document.getElementById('auSearch');
  if (auSearch && !document.getElementById('auMobileFilterBtn')) {
    const bar = auSearch.closest('.flex');
    const searchWrap = auSearch.closest('.search-input');
    if (bar && searchWrap) {
      bar.classList.add('mobile-collapsible-bar', 'mobile-bar-primary');
      const filterBtn = document.createElement('button');
      filterBtn.type = 'button';
      filterBtn.className = 'btn btn-secondary mobile-filter-btn';
      filterBtn.id = 'auMobileFilterBtn';
      filterBtn.setAttribute('aria-expanded', 'false');
      if (searchWrap.nextSibling) bar.insertBefore(filterBtn, searchWrap.nextSibling);
      else bar.appendChild(filterBtn);

      const syncAuBadge = function () {
        let count = 0;
        ['auAction', 'auFrom', 'auTo'].forEach(function (id) {
          const el = document.getElementById(id);
          if (el && el.value) count++;
        });
        const sens = document.getElementById('auSensitive');
        if (sens && sens.checked) count++;
        filterBtn.innerHTML = icon('filter') + '<span>Filters</span>' +
          (count > 0 ? '<em class="mobile-filter-count">' + count + '</em>' : '');
        filterBtn.classList.toggle('has-active-filters', count > 0);
      };
      filterBtn.addEventListener('click', function () {
        const open = bar.classList.toggle('filters-open');
        filterBtn.setAttribute('aria-expanded', String(open));
      });
      ['auAction', 'auFrom', 'auTo', 'auSensitive'].forEach(function (id) {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', syncAuBadge);
      });
      syncAuBadge();
    }
  }
}

function initMobileEnhancements() {
  if (mobileEnhancementsBound) return;
  mobileEnhancementsBound = true;
  const runAll = function () {
    initMobileSearchAndInputs();
    initMobileFilterDrawers();
    syncMobileTableLabels();
  };
  if (window.Boot && typeof Boot.dom === 'function') {
    Boot.dom(runAll);
  } else {
    setTimeout(runAll, 0);
  }
  const obs = new MutationObserver(function () {
    syncMobileTableLabels();
  });
  obs.observe(document.body, { childList: true, subtree: true });
}

/* ---------- Shared confirm dialog (pages without their own confirm modal) ---------- */
function confirmDialog(title, message, onConfirm, okLabel) {
  let overlay = document.getElementById('sharedConfirmOverlay');
  if (overlay) overlay.remove();
  overlay = document.createElement('div');
  overlay.className = 'modal-overlay open';
  overlay.id = 'sharedConfirmOverlay';
  overlay.innerHTML = '<div class="modal" role="dialog" aria-modal="true"><div class="modal-body" style="text-align:center;padding:1.75rem 1.5rem 1rem;">' +
    '<h2 style="margin-bottom:.4rem;"></h2><p class="text-muted" style="margin:0;"></p></div>' +
    '<div class="modal-footer" style="justify-content:center;border-top:none;"><button type="button" class="btn btn-secondary" data-act="no">Cancel</button>' +
    '<button type="button" class="btn btn-danger" data-act="yes"></button></div></div>';
  overlay.querySelector('h2').textContent = title;
  overlay.querySelector('p').textContent = message;
  overlay.querySelector('[data-act="yes"]').textContent = okLabel || 'Confirm';
  overlay.addEventListener('click', function (e) {
    const act = e.target.closest('[data-act]');
    if (act || e.target === overlay) {
      overlay.remove();
      if (act && act.dataset.act === 'yes') onConfirm();
    }
  });
  document.body.appendChild(overlay);
}

/* ---------- Offline-mode badge (data is kept in this browser; see js/local-api.js) ---------- */
function showOfflineBadge() {
  if (document.getElementById('offlineBadge')) return;
  const b = document.createElement('button');
  b.id = 'offlineBadge'; b.type = 'button';
  b.title = 'Offline mode: data is saved only in this browser. Click for options.';
  b.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:900;background:#1b1f27;color:#fff;border:1px solid #444;border-radius:999px;padding:6px 12px;font:600 12px system-ui,sans-serif;cursor:pointer;opacity:.9;';
  b.textContent = '\u25CF Offline mode \u2014 saved in this browser';
  b.addEventListener('click', function () {
    confirmDialog('Reset offline demo data?', 'This erases everything saved in this browser (sales, stock changes, customers, users you added) and restores the original demo data. You will be logged out.', function () {
      LocalApi.reset(); Api.clear(); window.location.href = 'login.html';
    }, 'Reset');
  });
  document.body.appendChild(b);
}

/* ---------- Shared pagination bar ----------
   const pg = createPager(document.getElementById('xPager'), rerenderFn);
   Client-side lists:  rows = pg.slice(filteredList, signatureOfFilters)  -> current page only (resets to page 1 when the signature changes)
   Server-paged lists: pg.update(total)  and read pg.page / pg.size to build the query.
   The bar shows "Showing 1–25 of 53", Previous / page numbers / Next, and a rows-per-page selector (25 / 50). */
function createPager(el, onChange, opts) {
  opts = opts || {};
  const st = { page: 1, size: opts.size || 25, total: 0, sig: null };
  const pages = function () { return Math.max(1, Math.ceil(st.total / st.size)); };
  function numbers() {
    const n = pages(), cur = st.page, out = [];
    const add = function (v) { if (out[out.length - 1] !== v) out.push(v); };
    for (let i = 1; i <= n; i++) { if (i === 1 || i === n || Math.abs(i - cur) <= 1) add(i); else add('\u2026'); }
    return out;
  }
  function render() {
    if (!el) return;
    const n = pages(), from = st.total ? (st.page - 1) * st.size + 1 : 0, to = Math.min(st.total, st.page * st.size);
    el.classList.add('pg-bar');
    el.innerHTML = '<span class="pg-info">' + (st.total ? 'Showing ' + from + '\u2013' + to + ' of ' + st.total : 'No entries') + '</span>' +
      '<span class="pg-ctrl" role="navigation" aria-label="Pagination">' +
        (opts.sizes === false ? '' : '<label class="pg-size">Show <select data-pg-size aria-label="Rows per page">' + (opts.sizes || [25, 50]).map(function (s) { return '<option value="' + s + '"' + (s === st.size ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></label>') +
        '<button type="button" class="pg-btn" data-pg="prev"' + (st.page <= 1 ? ' disabled' : '') + '>Previous</button>' +
        (st.total ? numbers().map(function (v) { return v === '\u2026' ? '<span class="pg-gap">\u2026</span>' : '<button type="button" class="pg-btn pg-num' + (v === st.page ? ' is-on' : '') + '" data-pg="' + v + '"' + (v === st.page ? ' aria-current="page"' : '') + '>' + v + '</button>'; }).join('') : '') +
        '<button type="button" class="pg-btn" data-pg="next"' + (st.page >= n ? ' disabled' : '') + '>Next</button>' +
      '</span>';
  }
  if (el) {
    el.addEventListener('click', function (e) {
      const b = e.target.closest('[data-pg]'); if (!b || b.disabled) return;
      const v = b.dataset.pg, n = pages();
      st.page = v === 'prev' ? Math.max(1, st.page - 1) : v === 'next' ? Math.min(n, st.page + 1) : parseInt(v, 10) || 1;
      onChange();
    });
    el.addEventListener('change', function (e) {
      if (!e.target.matches('[data-pg-size]')) return;
      st.size = parseInt(e.target.value, 10) || 25; st.page = 1; onChange();
    });
  }
  return {
    get page() { return st.page; },
    get size() { return st.size; },
    reset: function () { st.page = 1; },
    slice: function (list, sig) {
      if (sig !== undefined && sig !== st.sig) { if (st.sig !== null) st.page = 1; st.sig = sig; }
      st.total = list.length;
      if (st.page > pages()) st.page = pages();
      render();
      const start = (st.page - 1) * st.size;
      return list.slice(start, start + st.size);
    },
    update: function (total, page) { st.total = total; if (page) st.page = page; if (st.page > pages()) st.page = pages(); render(); }
  };
}
