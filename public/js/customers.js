/* ==========================================================================
   customers.js — Customers page (list, search/filter, add/edit, details, soft delete)
   Data: customers come from /api/bootstrap (with totals computed server-side from COMPLETED sales);
   details (purchase history + warranties) come from GET /api/customers/:id.
   ========================================================================== */
Boot.ready(function () {
  if (!initShell('customers')) return;
  const isAdmin = getSession().role === 'Admin';
  let editingId = null, viewId = null;
  const $ = function (id) { return document.getElementById(id); };
  const openModal = function (id) { $(id).classList.add('open'); };
  const closeModal = function (id) { $(id).classList.remove('open'); };

  function rows() {
    const q = $('custSearch').value.trim().toLowerCase();
    const st = $('custStatus').value;
    return Store.get('customers', []).filter(function (c) {
      if (st && c.status !== st) return false;
      if (!q) return true;
      return [c.id, c.name, c.contactNumber, c.email].join(' ').toLowerCase().indexOf(q) !== -1;
    });
  }

  const pg = createPager($('custPager'), function () { render(); });
  function render() {
    const list = pg.slice(rows(), $('custSearch').value + '|' + $('custStatus').value);
    $('custTbody').innerHTML = list.length ? list.map(function (c) {
      const inactive = c.status === 'Inactive';
      return '<tr' + (inactive ? ' style="opacity:.6;"' : '') + '>' +
        '<td class="mono-num">' + c.id + '</td>' +
        '<td style="font-weight:600;color:var(--ink);">' + Utils.escapeHtml(c.name) + '</td>' +
        '<td>' + Utils.escapeHtml(c.contactNumber) + '</td>' +
        '<td>' + Utils.escapeHtml(c.email || '\u2014') + '</td>' +
        '<td class="text-right mono-num">' + (c.totalPurchases || 0) + '</td>' +
        '<td class="text-right mono-num">' + Utils.formatPHP(c.totalSpent || 0) + '</td>' +
        '<td class="text-muted">' + (c.lastPurchase ? Utils.formatDate(c.lastPurchase) : '\u2014') + '</td>' +
        '<td><span class="badge ' + (inactive ? 'badge-neutral' : 'badge-ok') + '">' + c.status + '</span></td>' +
        '<td><div class="flex gap-8">' +
          '<button class="icon-btn" title="View details" data-view="' + c.id + '">' + icon('eye') + '</button>' +
          '<button class="icon-btn" title="Edit" data-edit="' + c.id + '">' + icon('edit') + '</button>' +
          (isAdmin ? (inactive
            ? '<button class="icon-btn" title="Reactivate" data-reactivate="' + c.id + '">' + icon('refresh') + '</button>'
            : '<button class="icon-btn" title="Mark inactive (soft delete)" data-deactivate="' + c.id + '">' + icon('archive') + '</button>') : '') +
        '</div></td></tr>';
    }).join('') : '<tr><td colspan="9"><div class="empty-state">' + icon('search') + '<h3>No customers found</h3><p>Try a different search or filter.</p></div></td></tr>';
  }

  function clearErrors() {
    document.querySelectorAll('#custForm .field.has-error').forEach(function (f) { f.classList.remove('has-error'); const m = f.querySelector('.field-error-msg'); if (m) m.remove(); });
  }
  function openForm(id) {
    editingId = id || null;
    const c = id ? Store.get('customers', []).find(function (x) { return x.id === id; }) : null;
    $('custModalTitle').textContent = c ? 'Edit Customer' : 'Add Customer';
    $('custForm').reset(); clearErrors();
    if (c) { $('cName').value = c.name; $('cPhone').value = c.contactNumber; $('cEmail').value = c.email || ''; $('cAddress').value = c.address || ''; $('cNotes').value = c.notes || ''; }
    openModal('custModalOverlay'); $('cName').focus();
  }
  async function save() {
    if (!validateForm($('custForm'))) return;
    const body = { name: $('cName').value.trim(), contactNumber: $('cPhone').value.trim(), email: $('cEmail').value.trim(), address: $('cAddress').value.trim(), notes: $('cNotes').value.trim() };
    await Utils.withBusy($('custSaveBtn'), async function () {
      try {
        if (editingId) { await Api.put('/customers/' + encodeURIComponent(editingId), body); showToast('Updated ' + body.name + '.', 'ok'); }
        else { const c = await Api.post('/customers', body); showToast('Added ' + c.name + ' (' + c.id + ').', 'ok'); }
        await Store.refresh(); closeModal('custModalOverlay'); render();
      } catch (err) { showToast(err.message, 'danger'); }
    });
  }

  async function openDetails(id) {
    viewId = id;
    $('custViewBody').innerHTML = '<p class="text-muted">Loading...</p>';
    openModal('custViewOverlay');
    try {
      const d = await Api.get('/customers/' + encodeURIComponent(id));
      const c = d.customer;
      $('custViewTitle').textContent = c.name + ' (' + c.id + ')';
      const products = Store.get('products', []);
      $('custViewBody').innerHTML =
        '<div class="kv-grid" style="margin-bottom:14px;">' +
          kv('Phone', Utils.escapeHtml(c.contactNumber)) + kv('Email', Utils.escapeHtml(c.email || '\u2014')) + kv('Address', Utils.escapeHtml(c.address || '\u2014')) +
          kv('Registered', c.dateRegistered ? Utils.formatDate(c.dateRegistered + 'T00:00:00') : '\u2014') + kv('Status', '<span class="badge ' + (c.status === 'Active' ? 'badge-ok' : 'badge-neutral') + '">' + c.status + '</span>') +
          kv('Total purchases', c.totalPurchases) + kv('Total spent', Utils.formatPHP(c.totalSpent)) + kv('Last purchase', c.lastPurchase ? Utils.formatDate(c.lastPurchase) : '\u2014') +
        '</div>' + (c.notes ? '<p class="text-muted"><strong>Notes:</strong> ' + Utils.escapeHtml(c.notes) + '</p>' : '') +
        '<h4 style="margin:12px 0 6px;">Purchase history</h4>' +
        (d.sales.length ? '<div class="table-wrap is-scroll" style="max-height:14rem;"><table><thead><tr><th>Sale</th><th>Date</th><th>Items</th><th>Status</th><th class="text-right">Total</th></tr></thead><tbody>' +
          d.sales.map(function (s) { return '<tr class="' + (Utils.isCountable(s) ? '' : 'sale-voided-row') + '"><td>' + s.id + '</td><td class="text-muted">' + Utils.formatDateTime(s.date) + '</td><td>' +
            Utils.escapeHtml(s.items.map(function (i) { return i.qty + '\u00d7 ' + i.name; }).join(', ')) + '</td><td>' + Utils.saleStatusBadge(s.status) + '</td><td class="text-right mono-num">' + Utils.formatPHP(s.total) + '</td></tr>'; }).join('') +
          '</tbody></table></div>' : '<p class="text-muted">No purchases yet.</p>') +
        '<h4 style="margin:14px 0 6px;">Warranties</h4>' +
        (d.warranties.length ? '<div class="table-wrap"><table><thead><tr><th>Warranty</th><th>Product</th><th>Sale</th><th>Expires</th><th>Status</th></tr></thead><tbody>' +
          d.warranties.map(function (w) {
            const st = w.status, cls = st === 'Active' ? 'badge-ok' : st === 'Expiring Soon' ? 'badge-warn' : st === 'Claimed' ? 'badge-neutral' : 'badge-danger';
            return '<tr><td>' + w.id + '</td><td>' + Utils.escapeHtml(w.productName || w.productId) + '</td><td>' + (w.saleId || '\u2014') + '</td><td>' + Utils.formatDate(w.warrantyExpiration.slice(0, 10) + 'T00:00:00') + '</td><td><span class="badge ' + cls + '">' + st + '</span></td></tr>';
          }).join('') + '</tbody></table></div>' : '<p class="text-muted">No warranties linked.</p>');
    } catch (err) { $('custViewBody').innerHTML = '<p class="form-error">' + Utils.escapeHtml(err.message) + '</p>'; }
  }
  function kv(label, value) { return '<div><div class="hint" style="margin:0 0 3px;text-transform:uppercase;letter-spacing:.04em;font-weight:700;">' + label + '</div><div style="font-weight:600;color:var(--ink);">' + value + '</div></div>'; }

  Boot.dom(function () {
    render();
    ['custSearch'].forEach(function (id) { $(id).addEventListener('input', render); });
    $('custStatus').addEventListener('change', render);
    $('addCustomerBtn').addEventListener('click', function () { openForm(null); });
    $('custSaveBtn').addEventListener('click', save);
    $('custViewEditBtn').addEventListener('click', function () { closeModal('custViewOverlay'); openForm(viewId); });
    $('custTbody').addEventListener('click', function (e) {
      const v = e.target.closest('[data-view]'), ed = e.target.closest('[data-edit]'), de = e.target.closest('[data-deactivate]'), re = e.target.closest('[data-reactivate]');
      if (v) openDetails(v.dataset.view);
      else if (ed) openForm(ed.dataset.edit);
      else if (de) {
        const c = Store.get('customers', []).find(function (x) { return x.id === de.dataset.deactivate; });
        confirmDialog('Mark ' + c.name + ' as inactive?', 'Their sales history and warranties stay linked. They will no longer appear in the POS customer list. You can reactivate them later.', async function () {
          try { await Api.del('/customers/' + encodeURIComponent(c.id)); await Store.refresh(); render(); showToast(c.name + ' marked inactive.', 'ok'); } catch (err) { showToast(err.message, 'danger'); }
        });
      } else if (re) {
        Api.post('/customers/' + encodeURIComponent(re.dataset.reactivate) + '/reactivate').then(function () { return Store.refresh(); }).then(function () { render(); showToast('Customer reactivated.', 'ok'); }).catch(function (err) { showToast(err.message, 'danger'); });
      }
    });
    document.querySelectorAll('[data-close]').forEach(function (b) { b.addEventListener('click', function () { closeModal(b.dataset.close); }); });
    document.querySelectorAll('.modal-overlay').forEach(function (o) { o.addEventListener('click', function (e) { if (e.target === o) o.classList.remove('open'); }); });
  });
});
