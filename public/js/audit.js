/* audit.js — Audit Trail viewer (Admin only; the API enforces it too).
   Stored action codes (e.g. stock.adjust) are never changed — they drive filtering and export. The page only adds a friendly
   label, a one-line readable summary, and a full-detail modal with before -> after. */
Boot.ready(function () {
  if (!initShell('audit')) return;
  if (!requireRole('Admin')) return;
  const $ = function (id) { return document.getElementById(id); };
  const esc = Utils.escapeHtml;
  let lastRows = [];

  const GROUPS = ['auth', 'sale', 'stock', 'product', 'customer', 'settings', 'user', 'supplier', 'category', 'brand', 'moto', 'warranty', 'shift'];
  GROUPS.forEach(function (g) { $('auAction').insertAdjacentHTML('beforeend', '<option value="' + g + '">' + g + '.*</option>'); });

  const LABELS = {
    'auth.login': 'Login', 'auth.logout': 'Logout', 'auth.login_failed': 'Failed login', 'auth.login_blocked': 'Login blocked',
    'user.password_change': 'Password changed', 'user.profile_update': 'Profile updated', 'user.update': 'User updated', 'user.create': 'User created', 'user.delete': 'User deleted',
    'sale.create': 'Sale completed', 'sale.void': 'Sale voided', 'sale.voided': 'Sale voided', 'sale.cancelled': 'Sale cancelled', 'sale.refunded': 'Sale refunded', 'sale.reprint': 'Receipt reprinted',
    'stock.in': 'Stock received', 'stock.out': 'Stock removed', 'stock.adjust': 'Stock adjusted',
    'product.create': 'Product added', 'product.update': 'Product edited', 'product.archive': 'Product archived', 'product.unarchive': 'Product restored', 'product.delete': 'Product deleted',
    'customer.create': 'Customer added', 'customer.update': 'Customer edited', 'customer.deactivate': 'Customer deactivated', 'customer.reactivate': 'Customer reactivated',
    'category.create': 'Category added', 'category.update': 'Category edited', 'category.delete': 'Category deleted',
    'brand.create': 'Brand added', 'brand.update': 'Brand edited', 'brand.delete': 'Brand deleted',
    'moto.create': 'Motorcycle brand added', 'moto.delete': 'Motorcycle brand deleted', 'moto.model_add': 'Motorcycle model added', 'moto.model_remove': 'Motorcycle model removed',
    'supplier.create': 'Supplier added', 'supplier.update': 'Supplier edited', 'supplier.delete': 'Supplier deleted',
    'settings.update': 'Settings changed', 'warranty.claim': 'Warranty claim', 'shift.clock_in': 'Clocked in', 'shift.clock_out': 'Clocked out'
  };
  function label(a) {
    if (LABELS[a]) return LABELS[a];
    const t = String(a || '').replace(/[._]/g, ' ');
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  function tone(a) { return /fail|blocked|void|cancel|refund|delete|deactivate|adjust|reprint|archive|password/.test(a) ? 'badge-warn' : /login$|create|approve/.test(a) ? 'badge-ok' : 'badge-neutral'; }

  /* ---------- value formatting ---------- */
  const SECRET = /password|hash|token|secret/i;
  const MONEY = /price|cost|total|subtotal|discount$|amount|vat/i;
  function plain(v, key) {
    if (v === null || v === undefined || v === '') return '\u2014';
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    if (typeof v === 'number' && key && MONEY.test(key) && !/qty|count|items|rate|percent/i.test(key)) return Utils.formatPHP(v);
    if (Array.isArray(v)) return v.map(function (x) { return typeof x === 'object' ? JSON.stringify(x) : String(x); }).join(', ') || '\u2014';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }
  const short = function (t, n) { t = String(t); return t.length > n ? t.slice(0, n - 1) + '\u2026' : t; };
  function labelize(k) { return String(k).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_.]/g, ' ').replace(/^./, function (c) { return c.toUpperCase(); }); }
  const isObj = function (v) { return v && typeof v === 'object' && !Array.isArray(v); };
  const isFromTo = function (v) { return isObj(v) && ('from' in v) && ('to' in v); };

  /* Normalise every shape the app has ever written into one list of {field, from, to}.
     Handles: details.changes {f:{from,to}}, details.changed {f:{from,to}}, details.before/after, and the legacy settings.update (map of {from,to}). */
  function changeList(a) {
    const d = a.details || {}, out = [];
    const fromMap = function (m) { Object.keys(m).forEach(function (k) { if (isFromTo(m[k])) out.push({ field: k, from: m[k].from, to: m[k].to }); }); };
    if (isObj(d.changes)) fromMap(d.changes);
    if (isObj(d.changed)) fromMap(d.changed);
    if (isObj(d.before) && isObj(d.after)) {
      Object.keys(Object.assign({}, d.before, d.after)).forEach(function (k) {
        if (JSON.stringify(d.before[k]) !== JSON.stringify(d.after[k])) out.push({ field: k, from: d.before[k], to: d.after[k] });
      });
    }
    if (!out.length && a.action === 'settings.update') fromMap(d);
    return out;
  }
  function changeText(list, max) {
    return list.slice(0, max || 4).map(function (c) { return labelize(c.field) + ' ' + short(plain(c.from, c.field), 24) + ' \u2192 ' + short(plain(c.to, c.field), 24); }).join('; ') + (list.length > (max || 4) ? '; +' + (list.length - (max || 4)) + ' more' : '');
  }

  /* One readable sentence per entry (shown in the table and at the top of the View modal). */
  function summary(a) {
    const d = a.details || {}, code = a.action || '', who = d.targetUsername || d.username || '';
    const prod = d.productName || d.name || a.entityId || '';
    const ch = changeList(a);
    const php = function (n) { return Utils.formatPHP(Number(n) || 0); };
    switch (code) {
      case 'auth.login': return (d.username || a.username || 'User') + ' signed in';
      case 'auth.logout': return (d.username || a.username || 'User') + ' signed out';
      case 'auth.login_failed': return 'Failed sign-in attempt for \u201c' + (d.username || '?') + '\u201d';
      case 'auth.login_blocked': return 'Blocked sign-in for \u201c' + (d.username || '?') + '\u201d' + (d.reason ? ' (' + d.reason + ' account)' : '');
      case 'user.password_change': return (d.changedBy === 'admin' ? 'Admin reset the password of ' : 'Changed own password \u2014 ') + (who || a.entityId || '');
      case 'user.profile_update': return 'Profile of ' + (who || a.entityId) + (ch.length ? ': ' + changeText(ch, 3) : d.photoChanged ? ': photo changed' : ': no field changes');
      case 'user.update': return 'Updated ' + (who || a.entityId) + (ch.length ? ': ' + changeText(ch, 3) : '') + (d.passwordReset ? (ch.length ? '; ' : ': ') + 'password reset' : '');
      case 'user.create': return 'Created ' + (d.role || 'user') + ' account ' + (d.username || '') + (d.name ? ' (' + d.name + ')' : '');
      case 'user.delete': return 'Deleted account ' + (d.username || '') + (d.name ? ' (' + d.name + ')' : '');
      case 'sale.create': return (a.entityId || 'Sale') + ' \u00b7 ' + php(d.total) + ' \u00b7 ' + (d.items != null ? d.items + (d.items === 1 ? ' line' : ' lines') + ' \u00b7 ' : '') + (d.paymentMethod || '') +
        (d.discount > 0 ? ' \u00b7 discount ' + php(d.discount) + (d.discountMode === 'percent' && d.discountValue ? ' (' + d.discountValue + '%)' : '') : '') + (d.customerName ? ' \u00b7 ' + d.customerName : '');
      case 'sale.void': case 'sale.voided': case 'sale.cancelled': case 'sale.refunded':
        return (label(code).replace('Sale ', '')).replace(/^./, function (c) { return c.toUpperCase(); }) + ' ' + (a.entityId || '') + ' \u00b7 ' + php(d.total) + (d.reason ? ' \u2014 \u201c' + short(d.reason, 70) + '\u201d' : '') +
          (Array.isArray(d.restockSkipped) && d.restockSkipped.length ? ' \u00b7 \u26a0 restock skipped for retired ' + d.restockSkipped.map(function (x) { return x.productId; }).join(', ') : '');
      case 'sale.reprint': return 'Reprint #' + (d.reprintNumber || '?') + ' of ' + (d.saleId || a.entityId || '') + (d.saleTotal != null ? ' (' + php(d.saleTotal) + ')' : '');
      case 'stock.in': return 'Received ' + d.qty + ' \u00d7 ' + prod + ' (' + d.from + ' \u2192 ' + d.to + ')' + (d.reference ? ' \u00b7 ' + d.reference : '');
      case 'stock.out': return 'Removed ' + d.qty + ' \u00d7 ' + prod + ' as ' + (d.reason || 'Other') + ' (' + d.from + ' \u2192 ' + d.to + ')';
      case 'stock.adjust': return 'Adjusted ' + (a.entityId || prod) + (d.productName ? ' (' + d.productName + ')' : '') + ' from ' + d.from + ' \u2192 ' + d.to + (d.reason ? ' (' + short(d.reason, 50) + ')' : '');
      case 'product.create': return 'Added ' + (d.name || prod) + ' \u00b7 stock ' + (d.initialStock != null ? d.initialStock : 0) + (d.sellingPrice != null ? ' \u00b7 ' + php(d.sellingPrice) : '');
      case 'product.update': return (d.name || prod) + (ch.length ? ': ' + changeText(ch, 3) : ': saved with no field changes');
      case 'product.archive': case 'product.unarchive': return (code === 'product.archive' ? 'Archived ' : 'Restored ') + (d.name || a.entityId);
      case 'product.delete': return 'Deleted ' + (d.name || prod);
      case 'customer.create': return 'Added customer ' + (d.name || a.entityId) + (d.source ? ' (' + d.source + ')' : '');
      case 'customer.update': return (d.name || a.entityId) + (ch.length ? ': ' + changeText(ch, 3) : ': saved with no field changes');
      case 'customer.deactivate': case 'customer.reactivate': return (code === 'customer.deactivate' ? 'Deactivated ' : 'Reactivated ') + (d.name || a.entityId);
      case 'category.create': return 'Added category ' + (d.name || a.entityId);
      case 'category.update': case 'supplier.update': case 'brand.update': return (d.name || a.entityId) + (ch.length ? ': ' + changeText(ch, 3) : '');
      case 'category.delete': return 'Deleted category ' + (d.name || a.entityId);
      case 'brand.create': return 'Added brand ' + (d.name || a.entityId);
      case 'brand.delete': return 'Deleted brand ' + (d.name || a.entityId);
      case 'moto.create': return 'Added motorcycle brand ' + (d.name || a.entityId) + (Array.isArray(d.models) && d.models.length ? ' (' + d.models.join(', ') + ')' : '');
      case 'moto.delete': return 'Deleted motorcycle brand ' + (d.name || a.entityId);
      case 'moto.model_add': return 'Added model ' + (d.model || '') + ' to ' + (d.name || a.entityId);
      case 'moto.model_remove': return 'Removed model ' + (d.model || '') + ' from ' + (d.name || a.entityId);
      case 'supplier.create': return 'Added supplier ' + (d.name || a.entityId);
      case 'supplier.delete': return 'Deleted supplier ' + (d.name || a.entityId);
      case 'settings.update': return ch.length ? 'Changed ' + changeText(ch, 3) : 'Saved settings with no changes';
      case 'warranty.claim': return 'Claim ' + (d.claimId || '') + ' (' + (d.status || '') + ') on ' + (d.productName || a.entityId);
      case 'shift.clock_in': return (d.staffName || a.userName || 'Staff') + ' clocked in';
      case 'shift.clock_out': return (d.staffName || a.userName || 'Staff') + ' clocked out';
    }
    const keys = Object.keys(d).filter(function (k) { return !SECRET.test(k); });
    return keys.length ? short(keys.map(function (k) { return labelize(k) + ': ' + plain(d[k], k); }).join(' \u00b7 '), 110) : '';
  }

  /* ---------- table ---------- */
  const pg = createPager($('auPager'), function () { load(); });
  function query() {
    const p = new URLSearchParams({ page: pg.page, limit: pg.size });
    if ($('auSearch').value.trim()) p.set('search', $('auSearch').value.trim());
    if ($('auAction').value) p.set('action', $('auAction').value);
    if ($('auSensitive').checked) p.set('sensitive', '1');
    if ($('auFrom').value) p.set('from', $('auFrom').value);
    if ($('auTo').value) p.set('to', $('auTo').value);
    return p.toString();
  }
  async function load() {
    try {
      const r = await Api.get('/audit?' + query());
      lastRows = r.rows;
      pg.update(r.total, r.page);
      $('auTbody').innerHTML = r.rows.length ? r.rows.map(function (a, i) {
        const sens = isSensitive(a.action);
        return '<tr><td class="text-muted" style="white-space:nowrap;">' + Utils.formatDateTime(a.at) + '</td>' +
          '<td>' + esc(a.userName || a.username || '\u2014') + (a.role ? '<br><small class="text-muted">' + esc(a.role) + '</small>' : '') + '</td>' +
          '<td><span class="badge ' + tone(a.action) + '" title="' + esc(a.action) + '">' + esc(label(a.action)) + '</span>' + (sens ? ' <span class="au-flag" title="Sensitive action">\u25cf</span>' : '') + '<br><small class="text-muted mono-num">' + esc(a.action) + '</small></td>' +
          '<td class="mono-num">' + esc(a.entityId || '\u2014') + '</td>' +
          '<td><span class="au-sum" title="' + esc(summary(a)) + '">' + esc(summary(a)) + '</span></td>' +
          '<td class="text-muted" style="font-size:.75rem;">' + esc(a.ip || '') + '</td>' +
          '<td class="text-center"><button type="button" class="btn btn-secondary btn-sm au-view-btn" data-view="' + i + '">' + icon('eye') + ' View</button></td></tr>';
      }).join('') : '<tr><td colspan="7"><div class="empty-state">' + icon('history') + '<h3>No matching entries</h3></div></td></tr>';
    } catch (err) { showToast(err.message, 'danger'); }
  }
  const SENS = ['user.password_change', 'auth.login_failed', 'auth.login_blocked', 'sale.void', 'sale.voided', 'sale.cancelled', 'sale.refunded', 'sale.refund', 'stock.adjust', 'stock.out', 'user.create', 'user.update', 'user.delete', 'product.archive', 'product.delete', 'customer.deactivate', 'settings.update'];
  const isSensitive = function (a) { return SENS.indexOf(a) !== -1; };

  /* ---------- View modal ---------- */
  function field(lbl, html) { return '<div><div class="text-muted" style="font-size:.7rem;text-transform:uppercase;letter-spacing:.04em;">' + lbl + '</div><div style="font-weight:600;color:var(--ink);word-break:break-word;">' + html + '</div></div>'; }
  function valHtml(v, key) {
    if (SECRET.test(key || '')) return '<span class="text-muted">[hidden]</span>';
    if (v === null || v === undefined || v === '') return '<span class="text-muted">\u2014</span>';
    if (typeof v === 'object') return '<pre class="au-pre">' + esc(JSON.stringify(v, null, 2)) + '</pre>';
    return esc(plain(v, key));
  }
  function kvTable(obj, skip) {
    const keys = Object.keys(obj || {}).filter(function (k) { return !(skip && skip.indexOf(k) !== -1); });
    if (!keys.length) return '<p class="text-muted" style="margin:0;">No other details were recorded for this action.</p>';
    return '<table><tbody>' + keys.map(function (k) { return '<tr><td class="text-muted" style="width:11rem;vertical-align:top;white-space:nowrap;">' + esc(labelize(k)) + '</td><td style="word-break:break-word;">' + valHtml(obj[k], k) + '</td></tr>'; }).join('') + '</tbody></table>';
  }
  function openDetail(a) {
    const d = a.details || {}, ch = changeList(a), sum = summary(a);
    const who = esc(a.userName || a.username || '\u2014') + (a.username ? ' <span class="text-muted" style="font-weight:400;">(@' + esc(a.username) + ')</span>' : '');
    const handled = ['changes', 'changed', 'before', 'after'];
    const rest = a.action === 'settings.update' && !isObj(d.changed) && !isObj(d.changes) ? {} : d;      // legacy settings entries are shown in the change table only
    $('auDetailId').textContent = a.id || '';
    $('auDetailBody').innerHTML =
      '<div class="form-grid" style="margin-bottom:1rem;">' +
        field('When', esc(Utils.formatDateTime(a.at)) + '<br><small class="text-muted" style="font-weight:400;">' + esc(new Date(a.at).toLocaleString()) + '</small>') +
        field('Who', who) +
        field('Role', esc(a.role || '\u2014')) +
        field('Action', '<span class="badge ' + tone(a.action || '') + '">' + esc(label(a.action)) + '</span> <span class="mono-num text-muted" style="font-weight:400;">' + esc(a.action || '') + '</span>') +
        field('Record', esc(a.entity || '\u2014') + ' \u00b7 <span class="mono-num">' + esc(a.entityId || '\u2014') + '</span>') +
        field('IP address', esc(a.ip || '\u2014')) +
      '</div>' +
      (sum ? '<div class="au-summary"><strong>Summary</strong> ' + esc(sum) + '</div>' : '') +
      (ch.length ? '<h3 class="au-h">What changed</h3><div class="table-wrap"><table><thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead><tbody>' +
        ch.map(function (c) { return '<tr><td style="font-weight:600;">' + esc(labelize(c.field)) + '</td><td class="au-before">' + valHtml(c.from, c.field) + '</td><td class="au-after">' + valHtml(c.to, c.field) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '') +
      '<h3 class="au-h">Full details</h3><div class="table-wrap">' + kvTable(rest, ch.length ? handled : null) + '</div>';
    $('auDetailOverlay').classList.add('open');
  }
  function closeDetail() { $('auDetailOverlay').classList.remove('open'); }

  let t = null;
  const reload = function () { pg.reset(); load(); };
  Boot.dom(function () {
    load();
    $('auSearch').addEventListener('input', function () { clearTimeout(t); t = setTimeout(reload, 300); });
    ['auAction', 'auFrom', 'auTo', 'auSensitive'].forEach(function (id) { $(id).addEventListener('change', reload); });
    $('auTbody').addEventListener('click', function (e) {
      const b = e.target.closest('[data-view]'); if (!b) return;
      const a = lastRows[parseInt(b.dataset.view, 10)];
      if (a) openDetail(a);
    });
    document.querySelectorAll('[data-close="auDetailOverlay"]').forEach(function (b) { b.addEventListener('click', closeDetail); });
    $('auDetailOverlay').addEventListener('click', function (e) { if (e.target === this) closeDetail(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDetail(); });
    $('auExport').addEventListener('click', function () {
      Utils.exportToCSV('teammotor-audit-trail.csv', ['When', 'User', 'Username', 'Role', 'Action', 'Action (code)', 'Record', 'Summary', 'Details', 'IP'],
        lastRows.map(function (a) { return [a.at, a.userName || '', a.username || '', a.role || '', label(a.action), a.action, a.entityId || '', summary(a), JSON.stringify(a.details || {}), a.ip || '']; }));
      showToast('Exported the entries shown on this page.', 'ok');
    });
  });
});
