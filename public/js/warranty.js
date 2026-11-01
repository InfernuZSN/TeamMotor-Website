/* ==========================================================================
   warranty.js — powers warranty.html
   ========================================================================== */
Boot.ready(function () {
  if (!initShell('warranty')) return;

  function warrantyBadgeClass(status) {
    if (status === 'Active') return 'badge-ok';
    if (status === 'Expiring Soon') return 'badge-warn';
    if (status === 'Expired') return 'badge-danger';
    return 'badge-neutral';
  }

  function renderStats() {
    const warranties = Store.get('warranties', []);
    const counts = { Active: 0, 'Expiring Soon': 0, Expired: 0, Claimed: 0 };
    warranties.forEach(function (w) {
      const currentStatus = Utils.getWarrantyStatus(w);
      counts[currentStatus] = (counts[currentStatus] || 0) + 1;
    });
    const stats = [
      { label: 'Active', value: counts.Active, iconName: 'shield', tone: 'ok' },
      { label: 'Expiring Soon', value: counts['Expiring Soon'], iconName: 'clock', tone: 'warn' },
      { label: 'Expired', value: counts.Expired, iconName: 'xCircle', tone: 'danger' },
      { label: 'Claimed', value: counts.Claimed, iconName: 'checkCircle', tone: 'accent' }
    ];
    document.getElementById('warStatGrid').innerHTML = stats.map(function (s) {
      return '<div class="stat-card tone-' + s.tone + '"><div class="stat-icon tone-' + s.tone + '">' + icon(s.iconName) + '</div>' +
        '<div class="stat-label">' + s.label + '</div><div class="stat-value">' + s.value + '</div></div>';
    }).join('');
  }

  const pgW = createPager(document.getElementById('warPager'), function () { renderTable(); });
  function renderTable() {
    const q = document.getElementById('warSearch').value.trim().toLowerCase();
    const statusFilter = document.getElementById('warFilterStatus').value;
    const customers = Store.get('customers', []);
    const products = Store.get('products', []);
    let rows = Store.get('warranties', []).map(function (w) {
      const status = Utils.getWarrantyStatus(w);
      const cust = customers.find(function (c) { return c.id === w.customerId; });
      const prod = products.find(function (p) { return p.id === w.productId; }) || { name: w.productName || 'Motorcycle' };
      return { w: w, customer: cust, product: prod, currentStatus: status };
    });
    rows = rows.filter(function (r) {
      if (statusFilter && r.currentStatus !== statusFilter) return false;
      const custName = r.customer ? r.customer.name.toLowerCase() : 'walk-in customer';
      const prodName = r.product ? r.product.name.toLowerCase() : '';
      if (q && custName.indexOf(q) === -1 && prodName.indexOf(q) === -1 && r.w.id.toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    rows = pgW.slice(rows, q + '|' + statusFilter);
    const tbody = document.getElementById('warrantyTbody');
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state">' + icon('shield') + '<h3>No warranty records found</h3></div></td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(function (r) {
      const custDisplay = r.customer ? Utils.escapeHtml(r.customer.name) : '<span class="text-muted">Walk-in Customer</span>';
      const canClaim = r.currentStatus === 'Active' || r.currentStatus === 'Expiring Soon';
      return '<tr><td style="font-weight:600;color:var(--ink);">' + custDisplay + '</td>' +
        '<td>' + Utils.escapeHtml(r.product.name) + '</td>' +
        '<td class="text-muted">' + Utils.formatDate(r.w.purchaseDate) + '</td>' +
        '<td class="text-muted">' + Utils.formatDate(r.w.warrantyExpiration) + '</td>' +
        '<td><span class="badge ' + warrantyBadgeClass(r.currentStatus) + '">' + r.currentStatus + '</span></td>' +
        '<td><div class="flex gap-8">' +
          '<button class="icon-btn" title="View details" data-view="' + r.w.id + '">' + icon('eye') + '</button>' +
          (canClaim ? '<button class="icon-btn" title="File claim" data-claim="' + r.w.id + '" style="color:var(--accent);">' + icon('edit') + '</button>' : '') +
        '</div></td></tr>';
    }).join('');
  }

  function openWarrantyView(warrantyId) {
    const w = Store.get('warranties', []).find(function (x) { return x.id === warrantyId; });
    if (!w) return;
    const currentStatus = Utils.getWarrantyStatus(w);
    const c = Store.get('customers', []).find(function (x) { return x.id === w.customerId; });
    const p = Store.get('products', []).find(function (x) { return x.id === w.productId; }) || { name: w.productName || 'Motorcycle' };
    const custName = c ? Utils.escapeHtml(c.name) : 'Walk-in Customer';
    const custContact = c ? Utils.escapeHtml(c.contactNumber) : 'Not recorded';

    document.getElementById('warrantyViewBody').innerHTML =
      '<div class="flex justify-between items-center" style="margin-bottom:14px;"><h2 style="margin:0;">' + Utils.escapeHtml(p.name) + '</h2><span class="badge ' + warrantyBadgeClass(currentStatus) + '">' + currentStatus + '</span></div>' +
      '<div class="form-grid">' +
        '<div><div class="hint" style="font-weight:700;text-transform:uppercase;">Customer</div><div style="font-weight:600;">' + custName + '</div></div>' +
        '<div><div class="hint" style="font-weight:700;text-transform:uppercase;">Contact</div><div style="font-weight:600;">' + custContact + '</div></div>' +
        '<div><div class="hint" style="font-weight:700;text-transform:uppercase;">Purchase Date</div><div style="font-weight:600;">' + Utils.formatDate(w.purchaseDate) + '</div></div>' +
        '<div><div class="hint" style="font-weight:700;text-transform:uppercase;">Warranty Start</div><div style="font-weight:600;">' + Utils.formatDate(w.warrantyStart) + '</div></div>' +
        '<div><div class="hint" style="font-weight:700;text-transform:uppercase;">Expiration</div><div style="font-weight:600;">' + Utils.formatDate(w.warrantyExpiration) + '</div></div>' +
        (Utils.isRubberItem(p) ? '<div><div class="hint" style="font-weight:700;text-transform:uppercase;">Warranty Period</div><div style="font-weight:600;">' + RUBBER_WARRANTY_DAYS + ' days \u2014 defects only</div></div>' : '') +
        '<div class="span-2"><div class="hint" style="font-weight:700;text-transform:uppercase;">Coverage</div><div style="font-weight:600;">' + Utils.escapeHtml(w.coverage) + '</div></div>' +
      '</div>' +
      '<h3 style="font-size:.9rem;margin-top:18px;">Claim History</h3>' +
      (w.claims && w.claims.length
        ? w.claims.map(function (cl) {
            return '<div style="padding:10px 0;border-bottom:1px solid var(--border);">' +
              '<div style="font-weight:600;font-size:.85rem;color:var(--ink);">' + Utils.formatDate(cl.date) + ' \u2014 ' + Utils.escapeHtml(cl.description) + ' <span class="badge badge-neutral" style="margin-left:6px;">' + (cl.status || 'Resolved') + '</span></div>' +
              '<div class="text-muted" style="font-size:.82rem;margin-top:2px;">' + Utils.escapeHtml(cl.resolution) + '</div>' +
              (cl.staff ? '<div class="hint" style="margin-top:2px;">Processed by: ' + Utils.escapeHtml(cl.staff) + '</div>' : '') +
            '</div>';
          }).join('')
        : '<p class="hint">No claims filed.</p>');

    const claimBtn = document.getElementById('viewClaimBtn');
    if (claimBtn) {
      const canClaim = currentStatus === 'Active' || currentStatus === 'Expiring Soon';
      claimBtn.style.display = canClaim ? 'inline-flex' : 'none';
      claimBtn.dataset.warrantyId = w.id;
    }
  }

  function openClaimModal(warrantyId) {
    const w = Store.get('warranties', []).find(function (x) { return x.id === warrantyId; });
    if (!w) return;
    const c = Store.get('customers', []).find(function (x) { return x.id === w.customerId; });
    const p = Store.get('products', []).find(function (x) { return x.id === w.productId; }) || { name: w.productName || 'Motorcycle' };

    document.getElementById('claimWarrantyId').value = w.id;
    document.getElementById('claimProductDisplay').textContent = p.name + ' (' + w.id + ')';
    document.getElementById('claimCustomerDisplay').textContent = c ? c.name : 'Walk-in Customer';
    document.getElementById('claimDate').value = Analytics.dateKey(Utils.demoNow().toISOString());
    document.getElementById('claimDescription').value = '';
    document.getElementById('claimResolution').value = '';
    document.getElementById('claimStatus').value = 'Approved';

    document.getElementById('warrantyViewOverlay').classList.remove('open');
    document.getElementById('warrantyClaimOverlay').classList.add('open');
  }

  async function handleClaimSubmit(e) {
    e.preventDefault();
    const warId = document.getElementById('claimWarrantyId').value;
    const desc = document.getElementById('claimDescription').value.trim();
    const res = document.getElementById('claimResolution').value.trim();
    if (!desc || !res) {
      showToast('Please fill in both defect description and action taken.', 'danger');
      return;
    }
    try {
      const claim = await Api.post('/warranties/' + encodeURIComponent(warId) + '/claims', {
        date: document.getElementById('claimDate').value, status: document.getElementById('claimStatus').value, description: desc, resolution: res
      });
      await Store.refresh();
      document.getElementById('warrantyClaimOverlay').classList.remove('open');
      renderStats();
      renderTable();
      if (window.Notifications) Notifications.render();
      showToast('Warranty claim successfully recorded (' + claim.id + ').', 'ok');
    } catch (err) { showToast(err.message, 'danger'); }
  }

  Boot.dom(function () {
    renderStats();
    renderTable();
    document.getElementById('warSearch').addEventListener('input', renderTable);
    document.getElementById('warFilterStatus').addEventListener('change', renderTable);

    document.getElementById('warrantyTbody').addEventListener('click', function (e) {
      const viewBtn = e.target.closest('[data-view]');
      const claimBtn = e.target.closest('[data-claim]');
      if (viewBtn) {
        openWarrantyView(viewBtn.dataset.view);
        document.getElementById('warrantyViewOverlay').classList.add('open');
      } else if (claimBtn) {
        openClaimModal(claimBtn.dataset.claim);
      }
    });

    const viewClaimBtn = document.getElementById('viewClaimBtn');
    if (viewClaimBtn) {
      viewClaimBtn.addEventListener('click', function () {
        openClaimModal(this.dataset.warrantyId);
      });
    }

    const claimForm = document.getElementById('warrantyClaimForm');
    if (claimForm) {
      claimForm.addEventListener('submit', handleClaimSubmit);
    }

    document.querySelectorAll('[data-close]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.getElementById(btn.dataset.close).classList.remove('open');
      });
    });
    document.querySelectorAll('.modal-overlay').forEach(function (overlay) {
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) overlay.classList.remove('open');
      });
    });
  });
});