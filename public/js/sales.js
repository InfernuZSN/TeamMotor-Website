/* ==========================================================================
   sales.js — powers sales.html
   ========================================================================== */
Boot.ready(function () {
  if (!initShell('sales')) return;

  const products = Store.get('products', []).filter(function (p) { return !p.archived; });
  const allSales = Store.get('sales', []);                     // every sale, including voided / cancelled / refunded
  const sales = allSales.filter(Utils.isCountable);           // only Completed sales count towards revenue and analytics
  const isAdmin = (getSession() || {}).role === 'Admin';
  const now = Utils.demoNow();

  /* ---------- Sales Analysis: KPI cards (completed sales only; all figures come from the live POS data) ---------- */
  const today = Analytics.salesToday(sales, now);
  const week = Analytics.salesInLastDays(sales, now, 7);
  const month = Analytics.salesInCurrentMonth(sales, now);
  const stats = [
    { label: "Today's Sales", value: Utils.formatPHP(Analytics.sumTotal(today)), sub: today.length + ' transaction' + (today.length === 1 ? '' : 's'), iconName: 'trendUp', tone: 'ok' },
    { label: 'Weekly Sales', value: Utils.formatPHP(Analytics.sumTotal(week)), sub: week.length + ' transactions', iconName: 'sales', tone: 'accent' },
    { label: 'Monthly Sales', value: Utils.formatPHP(Analytics.sumTotal(month)), sub: month.length + ' transactions', iconName: 'sales', tone: 'accent' },
    { label: 'Total Transactions', value: sales.length, sub: 'All-time (completed sales)', iconName: 'cart', tone: 'warn' },
    { label: 'Average Transaction', value: Utils.formatPHP(sales.length ? Analytics.sumTotal(sales) / sales.length : 0), sub: 'Per completed sale', iconName: 'trendUp', tone: 'accent' }
  ];
  document.getElementById('salesStatGrid').className = 'stat-grid stat-grid-5';
  document.getElementById('salesStatGrid').innerHTML = stats.map(s =>
    '<div class="stat-card tone-' + s.tone + '">' +
      '<div class="stat-icon tone-' + s.tone + '">' + icon(s.iconName) + '</div>' +
      '<div class="stat-label">' + s.label + '</div>' +
      '<div class="stat-value">' + s.value + '</div>' +
      '<div class="stat-sub">' + s.sub + '</div>' +
    '</div>'
  ).join('');

  /* ---------- Today's sales summary (read-only, live from the same sales data the POS writes — online and offline) ----------
     Completed = sales rung up today that are still Completed. Voided = anything voided / cancelled / refunded TODAY (even if the sale
     was rung on an earlier day). Net = completed minus refunds of earlier-day sales issued today. There is no cash drawer, so no drawer count. */
  function renderDaySummary() {
    const ref = Utils.demoNow(), peso = Utils.formatPHP;
    const completed = allSales.filter(function (s) { return Utils.isCountable(s) && Analytics.isSameDay(s.date, ref); });
    const reversed = allSales.filter(function (s) { return !Utils.isCountable(s) && s.voidInfo && s.voidInfo.at && Analytics.isSameDay(s.voidInfo.at, ref); });
    const earlier = reversed.filter(function (s) { return !Analytics.isSameDay(s.date, ref); });
    const sum = function (l) { return Math.round(l.reduce(function (n, s) { return n + (Number(s.total) || 0); }, 0) * 100) / 100; };
    const gross = sum(completed), voided = sum(reversed), earlierAmt = sum(earlier), net = Math.round((gross - earlierAmt) * 100) / 100;
    const discounts = Math.round(completed.reduce(function (n, s) { return n + (Number(s.discount) || 0); }, 0) * 100) / 100;
    const card = function (lbl, val, sub, cls) { return '<div class="eod-stat ' + (cls || '') + '"><div class="eod-lbl">' + lbl + '</div><div class="eod-val">' + val + '</div><div class="eod-sub">' + sub + '</div></div>'; };
    const n = function (c, w) { return c + ' ' + w + (c === 1 ? '' : 's'); };
    document.getElementById('eodDate').textContent = ref.toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    document.getElementById('eodGrid').innerHTML =
      card('Completed sales', peso(gross), n(completed.length, 'sale'), 'is-ok') +
      card('Voided / refunded', peso(voided), n(reversed.length, 'sale'), reversed.length ? 'is-bad' : '') +
      card('Net sales', peso(net), 'completed \u2212 earlier sales reversed today', 'is-net') +
      card('Discounts given', peso(discounts), 'on completed sales', '');
    const methods = PAYMENT_METHODS.concat(LEGACY_PAYMENT_METHODS.filter(function (m) { return completed.some(function (s) { return s.paymentMethod === m; }); }));   // legacy methods only appear if today has such a sale
    document.getElementById('eodPay').innerHTML = methods.map(function (m) {
      const l = completed.filter(function (s) { return s.paymentMethod === m; });
      return '<div class="eod-pm' + (l.length ? '' : ' is-zero') + '"><span>' + m + '</span><strong>' + peso(sum(l)) + '</strong><small>' + n(l.length, 'sale') + '</small></div>';
    }).join('');
    document.getElementById('eodNote').textContent = 'Read-only. Calculated from today\u2019s recorded sales \u2014 this is not a cash-drawer count.' +
      (earlier.length ? ' ' + n(earlier.length, 'earlier sale') + ' (' + peso(earlierAmt) + ') reversed today ' + (earlier.length === 1 ? 'is' : 'are') + ' subtracted from net.' : '');
  }
  renderDaySummary();

  /* ---------- Orders (time filter + View All Items) ---------- */
  function filterSales(range, source) {
    const src = source || allSales;
    const ref = Utils.demoNow();
    if (range === 'day') return Analytics.salesToday(src, ref);
    if (range === 'week') return Analytics.salesInLastDays(src, ref, 7);
    if (range === 'month') return Analytics.salesInCurrentMonth(src, ref);
    if (range === 'year') return src.filter(s => new Date(s.date).getFullYear() === ref.getFullYear());
    return src;
  }

  const pgSales = createPager(document.getElementById('salesPager'), function () { renderOrders(); });
  function renderOrders() {
    const q = document.getElementById('salesSearch').value.trim().toLowerCase();
    const list = filterSales(document.getElementById('salesFilter').value).filter(function (s) {
      return !q || [s.id, s.staff, s.paymentMethod, s.status].some(function (f) { return f && String(f).toLowerCase().indexOf(q) !== -1; }) ||
        s.items.some(function (i) { return i.name.toLowerCase().indexOf(q) !== -1; });
    });
    const counted = list.filter(Utils.isCountable);
    const recent = pgSales.slice(Analytics.recentSales(list, list.length), q + '|' + document.getElementById('salesFilter').value);
    document.getElementById('ordersSummary').textContent = counted.length + ' order' + (counted.length === 1 ? '' : 's') + ' \u00b7 ' + Utils.formatPHP(Analytics.sumTotal(counted)) +
      (list.length !== counted.length ? ' (+' + (list.length - counted.length) + ' voided/refunded)' : '');
    document.getElementById('recentOrdersTbody').innerHTML = recent.length
      ? recent.map(s => {
          const itemSummary = s.items.length === 1 ? s.items[0].name : s.items[0].name + ' +' + (s.items.length - 1) + ' more';
          return '<tr class="' + (Utils.isCountable(s) ? '' : 'sale-voided-row') + '"><td style="font-weight:700;color:var(--ink);">' + s.id + '</td>' +
            '<td class="text-muted">' + Utils.formatDateTime(s.date) + '</td>' +
            '<td>' + Utils.escapeHtml(itemSummary) + '</td>' +
            '<td>' + Utils.escapeHtml(s.staff) + '</td>' +
            '<td><span class="pay-chip">' + s.paymentMethod + '</span></td>' +
            '<td>' + Utils.saleStatusBadge(s.status) + '</td>' +
            '<td class="text-right mono-num" style="font-weight:700;">' + Utils.formatPHP(s.total) + '</td>' +
            '<td style="white-space:nowrap;"><button class="icon-btn" title="View All Items" aria-label="View all items in ' + s.id + '" data-view-sale="' + s.id + '">' + icon('eye') + '</button>' +
            '<button class="icon-btn" title="Reprint receipt (marked DUPLICATE)" aria-label="Reprint receipt for ' + s.id + '" data-reprint-sale="' + s.id + '">' + icon('download') + '</button></td></tr>';
        }).join('')
      : '<tr><td colspan="8"><div class="empty-state">' + icon('sales') + '<h3>No sales for this period</h3></div></td></tr>';
  }

  function saleField(label, value) {
    return '<div><div class="hint" style="margin:0 0 3px;text-transform:uppercase;letter-spacing:.04em;font-weight:700;">' + label + '</div><div style="font-weight:600;color:var(--ink);font-size:.9rem;">' + value + '</div></div>';
  }
  let openSaleId = null;
  function openSaleModal(saleId) {
    const s = allSales.find(x => x.id === saleId);
    if (!s) return;
    openSaleId = s.id;
    const units = s.items.reduce((n, i) => n + i.qty, 0);
    const subtotal = s.subtotal != null ? s.subtotal : s.items.reduce((n, i) => n + i.subtotal, 0);
    const discount = s.discount || 0;
    const customer = s.customerId ? Store.get('customers', []).find(c => c.id === s.customerId) : null;
    const vi = s.voidInfo && s.voidInfo.reason ? s.voidInfo : null;

    document.getElementById('saleModalTitle').textContent = 'Order ' + s.id;
    document.getElementById('saleModalBody').innerHTML =
      (vi ? '<div class="alert" style="background:var(--danger-bg,#fdecea);border:1px solid #f5c6c2;border-radius:8px;padding:10px 12px;margin-bottom:12px;font-size:.85rem;">' +
        '<strong>' + Utils.escapeHtml(vi.type || s.status) + '</strong> by ' + Utils.escapeHtml(vi.by || '') + ' on ' + Utils.formatDateTime(vi.at) + '<br>Reason: ' + Utils.escapeHtml(vi.reason) + '</div>' : '') +
      '<div class="form-grid" style="margin-bottom:14px;">' +
        saleField('Date', Utils.formatDateTime(s.date)) + saleField('Staff', Utils.escapeHtml(s.staff)) +
        saleField('Status', Utils.saleStatusBadge(s.status)) +
        saleField('Customer', customer ? Utils.escapeHtml(customer.name) : 'Walk-in') +
        saleField('Payment Method', s.paymentMethod) +
        (s.reference ? saleField('Payment Reference', Utils.escapeHtml(s.reference)) : '') +
        saleField('Items', s.items.length + ' product' + (s.items.length === 1 ? '' : 's') + ' (' + units + ' unit' + (units === 1 ? '' : 's') + ')') +
        (s.paymentMethod === 'Cash'
          ? (saleField('Amount Tendered', Utils.formatPHP(s.amountReceived != null ? s.amountReceived : s.total)) +
             saleField('Change', Utils.formatPHP(s.changeAmount || 0)))
          : '') +
        saleField('Receipt reprints', (s.reprintCount || 0) + (s.lastReprintAt ? ' (last ' + Utils.formatDateTime(s.lastReprintAt) + ')' : '')) +
      '</div>' +
      '<div class="table-wrap is-scroll" style="max-height:20rem;"><table><thead><tr><th>#</th><th>Product</th><th class="text-right">Qty</th><th class="text-right">Price</th><th class="text-right">Subtotal</th></tr></thead><tbody>' +
        s.items.map((i, n) => '<tr><td class="text-muted">' + (n + 1) + '</td><td style="font-weight:600;color:var(--ink);">' + Utils.escapeHtml(i.name) + '</td>' +
          '<td class="text-right mono-num">' + i.qty + '</td><td class="text-right mono-num">' + Utils.formatPHP(i.price) + '</td>' +
          '<td class="text-right mono-num">' + Utils.formatPHP(i.subtotal) + '</td></tr>').join('') +
      '</tbody></table></div>' +
      '<div style="margin-top:14px;text-align:right;font-size:.88rem;">' +
        (discount > 0 ? '<div class="text-muted">Subtotal ' + Utils.formatPHP(subtotal) + ' &nbsp;&middot;&nbsp; Discount -' + Utils.formatPHP(discount) + '</div>' : '') +
        (s.vatEnabled && s.vatAmount > 0 ? '<div class="text-muted">VATable ' + Receipt.peso(s.vatableAmount) + ' &nbsp;&middot;&nbsp; VAT ' + (Math.round(s.vatRate * 10000) / 100) + '% ' + Receipt.peso(s.vatAmount) + (s.vatMode === 'exclusive' ? ' (added)' : ' (included)') + '</div>' : '') +
        '<div style="font-weight:700;color:var(--ink);font-size:1rem;">Total ' + Utils.formatPHP(s.total) + '</div>' +
      '</div>';
    const voidBtn = document.getElementById('saleVoidBtn');
    voidBtn.style.display = Utils.isCountable(s) ? 'inline-flex' : 'none';     // Staff see it too and get a clear 'Admin only' message; the API enforces it as well
    document.getElementById('saleModalOverlay').classList.add('open');
  }

  async function reprintSale(saleId, btn) {
    await Utils.withBusy(btn, async function () {
      try {
        await Receipt.reprint(saleId, 'sales-page');
        await Store.refresh();
        showToast('Duplicate receipt logged in audit trail and print preview opened.', 'ok');
        renderOrders();
        if (openSaleId === saleId && document.getElementById('saleModalOverlay').classList.contains('open')) openSaleModal(saleId);
      } catch (err) { showToast(err.message, 'danger'); }
    });
  }

  function openVoidModal() {
    if (!openSaleId) return;
    if (!isAdmin) { showToast('Only an Admin can void, cancel or refund a sale. Please ask an Admin.', 'danger'); return; }
    const sale = Store.get('sales', []).find(function (x) { return x.id === openSaleId; });
    document.getElementById('voidSaleTotal').textContent = sale ? Utils.formatPHP(sale.total) + ' \u00b7 ' + (sale.paymentMethod || '') : '';
    document.getElementById('voidSaleLabel').textContent = openSaleId;
    document.getElementById('voidType').value = 'Voided';
    document.getElementById('voidReason').value = '';
    document.getElementById('voidError').textContent = '';
    document.getElementById('voidOverlay').classList.add('open');
    document.getElementById('voidReason').focus();
  }
  async function confirmVoid() {
    if (!isAdmin) { document.getElementById('voidError').textContent = 'Only an Admin can void, cancel or refund a sale.'; return; }
    const reason = document.getElementById('voidReason').value.trim();
    if (!reason) { document.getElementById('voidError').textContent = 'A reason is required before this sale can be reversed.'; return; }
    if (reason.length < 3) { document.getElementById('voidError').textContent = 'Please give a clearer reason (at least 3 characters).'; return; }
    const type = document.getElementById('voidType').value;
    await Utils.withBusy(document.getElementById('voidConfirmBtn'), async function () {
      try {
        const r = await Api.post('/sales/' + encodeURIComponent(openSaleId) + '/void', { type: type, reason: reason });
        const skipped = (r.restockSkipped || []).length;
        sessionStorage.setItem('tm:flash', r.sale.id + ' marked ' + r.sale.status + '. Stock restored for ' + r.restocked.length + ' item' + (r.restocked.length === 1 ? '' : 's') + '.' +
          (skipped ? ' ' + skipped + ' retired item' + (skipped === 1 ? ' was' : 's were') + ' not restocked (logged in the audit trail).' : ''));
        window.location.reload();
      } catch (err) { document.getElementById('voidError').textContent = err.message; }
    });
  }

  function exportSalesCSV() {
    const list = filterSales(document.getElementById('salesFilter').value);
    const headers = ['Order ID', 'Date & Time', 'Staff', 'Payment Method', 'Reference', 'Items Count', 'Subtotal', 'Discount', 'VATable Sales', 'VAT', 'Total Due', 'Amount Tendered', 'Change', 'Status', 'Void/Refund Reason', 'Reprints'];
    const rows = list.map(s => {
      const subtotal = s.subtotal != null ? s.subtotal : s.items.reduce((n, i) => n + i.subtotal, 0);
      const isCash = s.paymentMethod === 'Cash';
      return [
        s.id, s.date, s.staff, s.paymentMethod, s.reference || '', s.items.length, subtotal, s.discount || 0,
        s.vatableAmount != null ? s.vatableAmount : '', s.vatAmount != null ? s.vatAmount : '', s.total,
        isCash ? (s.amountReceived != null ? s.amountReceived : s.total) : '',
        isCash ? (s.changeAmount != null ? s.changeAmount : 0) : '',
        s.status || 'Completed', s.voidInfo && s.voidInfo.reason ? s.voidInfo.reason : '', s.reprintCount || 0
      ];
    });
    Utils.exportToCSV('teammotor-sales.csv', headers, rows);
    showToast('Sales records exported to CSV.', 'ok');
  }

  /* ---------- Payment method summary (Sales Analysis tab; has its own period) ---------- */
  function renderPaymentSummary() {
    const list = filterSales(document.getElementById('payPeriod').value).filter(Utils.isCountable);
    const summary = Analytics.paymentMethodSummary(list);
    const totalAll = Object.keys(summary).reduce((s, k) => s + summary[k].total, 0) || 1;
    const methods = PAYMENT_METHODS.concat(LEGACY_PAYMENT_METHODS.filter(function (m) { return summary[m] && summary[m].count > 0; }));   // old Maya / Bank Transfer / Other sales stay visible
    document.getElementById('paymentSummary').innerHTML = methods.map(m => {
      const v = summary[m] || { count: 0, total: 0 };
      const pct = Math.round((v.total / totalAll) * 100);
      return '<div style="margin-bottom:16px;">' +
        '<div class="flex justify-between" style="margin-bottom:6px;">' +
          '<span style="font-weight:600;font-size:.85rem;color:var(--ink);">' + m + '</span>' +
          '<span style="font-size:.8rem;color:var(--steel);">' + v.count + ' orders &middot; ' + Utils.formatPHP(v.total) + '</span>' +
        '</div>' +
        '<div class="hbar-track"><div class="hbar-fill" style="width:' + pct + '%"></div></div>' +
      '</div>';
    }).join('');
  }

  renderOrders();
  renderPaymentSummary();
  document.getElementById('salesFilter').addEventListener('change', renderOrders);
  document.getElementById('salesSearch').addEventListener('input', renderOrders);
  document.getElementById('payPeriod').addEventListener('change', renderPaymentSummary);
  const expBtn = document.getElementById('exportSalesBtn');
  if (expBtn) expBtn.addEventListener('click', exportSalesCSV);
  document.getElementById('recentOrdersTbody').addEventListener('click', function (e) {
    const btn = e.target.closest('[data-view-sale]');
    const rp = e.target.closest('[data-reprint-sale]');
    if (btn) openSaleModal(btn.dataset.viewSale);
    else if (rp) reprintSale(rp.dataset.reprintSale, rp);
  });
  document.getElementById('saleReprintBtn').addEventListener('click', function () { if (openSaleId) reprintSale(openSaleId, this); });
  document.getElementById('saleVoidBtn').addEventListener('click', openVoidModal);
  document.getElementById('voidConfirmBtn').addEventListener('click', confirmVoid);
  document.querySelectorAll('[data-close="voidOverlay"]').forEach(btn => btn.addEventListener('click', () => document.getElementById('voidOverlay').classList.remove('open')));
  document.querySelectorAll('[data-close="saleModalOverlay"]').forEach(btn => {
    btn.addEventListener('click', () => document.getElementById('saleModalOverlay').classList.remove('open'));
  });
  document.getElementById('saleModalOverlay').addEventListener('click', function (e) { if (e.target === this) this.classList.remove('open'); });

  /* ---------- Sales trend chart ----------
     Owned by sales-trend.js (1 Week / 1 Month / 1 Year chips on #analysisRange). */

  /* ---------- Top sellers / slow movers ---------- */
  const ranked = Analytics.rankProductsBySales(products, sales);
  const top5 = ranked.slice(0, 5);
  const bottom5 = ranked.slice(-5).reverse();
  const maxSold = Math.max(1, top5[0] ? top5[0].unitsSold : 1);

  function hbarList(rows, slow) {
    if (!rows.length) return '<div class="empty-state">' + icon('sales') + '<h3>No sales data yet</h3></div>';
    return '<div class="hbar-list" style="margin-top:12px;">' + rows.map(r => {
      const pct = Math.max(4, Math.round((r.unitsSold / maxSold) * 100));
      return '<div class="hbar-row"><div class="hbar-name">' + Utils.escapeHtml(r.product.name) + '</div>' +
        '<div class="hbar-track"><div class="hbar-fill' + (slow ? ' slow' : '') + '" style="width:' + pct + '%"></div></div>' +
        '<div class="hbar-val">' + r.unitsSold + '</div></div>';
    }).join('') + '</div>';
  }
  document.getElementById('topSellersList').innerHTML = hbarList(top5, false);
  document.getElementById('slowMoversList').innerHTML = hbarList(bottom5, true);

  /* ---------- Product movement tables ---------- */
  const categories = Store.get('categories', []);
  const fastList = ranked.slice(0, Math.min(8, Math.ceil(ranked.length / 2)));
  const slowList = ranked.slice(-Math.min(8, Math.floor(ranked.length / 2))).reverse();

  function renderMovementTable(elementId, rows) {
    document.getElementById(elementId).innerHTML = rows.length
      ? rows.map(r => {
          const p = r.product;
          const cat = categories.find(c => c.id === p.category);
          const status = Utils.getStockStatus(p.stock, p.reorderLevel);
          const revenue = (r.unitsSold || 0) * (p.sellingPrice || 0);
          return '<tr>' +
            '<td><div style="font-weight:600;color:var(--ink);">' + Utils.escapeHtml(p.name) + '</div>' +
              '<div class="text-muted" style="font-size:.78rem;">' + Utils.escapeHtml(p.id) + (p.brand ? ' &middot; ' + Utils.escapeHtml(p.brand) : '') + '</div></td>' +
            '<td>' + Utils.escapeHtml(cat ? cat.name : (p.category || '\u2014')) + '</td>' +
            '<td class="text-right mono-num">' + Utils.formatPHP(p.sellingPrice) + '</td>' +
            '<td class="text-right mono-num" style="font-weight:700;">' + r.unitsSold + '</td>' +
            '<td class="text-right mono-num" style="font-weight:600;">' + Utils.formatPHP(revenue) + '</td>' +
            '<td class="text-right mono-num">' + p.stock + '</td>' +
            '<td><span class="badge ' + Utils.statusClass(status) + '">' + status + '</span></td>' +
          '</tr>';
        }).join('')
      : '<tr><td colspan="7"><div class="empty-state">' + icon('sales') + '<h3>No data yet</h3></div></td></tr>';
  }
  renderMovementTable('fastMovingTbody', fastList);
  renderMovementTable('slowMovingTbody', slowList);

  /* ---------- Tabs ---------- */
  document.querySelectorAll('.tabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tabs .tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.page > .tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    });
  });
});
