/* ==========================================================================
   sales.js — powers sales.html
   ========================================================================== */
Boot.ready(function () {
  if (!initShell('sales')) return;

  const isAdmin = (getSession() || {}).role === 'Admin';

  /* ---------- Sales Analysis: KPI cards (completed sales only; all figures come from the live POS data) ---------- */
  function renderKpiCards() {
    const sales = Store.get('sales', []).filter(Utils.isCountable);
    const now = Utils.demoNow();
    const today = Analytics.salesToday(sales, now);
    const week = Analytics.salesInLastDays(sales, now, 7);
    const month = Analytics.salesInCurrentMonth(sales, now);
    const todayTotal = Analytics.sumTotal(today);
    const weekTotal = Analytics.sumTotal(week);
    const monthTotal = Analytics.sumTotal(month);
    const avgTotal = sales.length ? Analytics.sumTotal(sales) / sales.length : 0;
    const stats = [
      { label: "Today's Sales", value: Utils.formatCardPHP(todayTotal), title: Utils.formatPHP(todayTotal), sub: today.length + ' transaction' + (today.length === 1 ? '' : 's'), iconName: 'trendUp', tone: 'ok' },
      { label: 'Weekly Sales', value: Utils.formatCardPHP(weekTotal), title: Utils.formatPHP(weekTotal), sub: week.length + ' transactions', iconName: 'sales', tone: 'accent' },
      { label: 'Monthly Sales', value: Utils.formatCardPHP(monthTotal), title: Utils.formatPHP(monthTotal), sub: month.length + ' transactions', iconName: 'sales', tone: 'accent' },
      { label: 'Total Transactions', value: sales.length >= 10000000 ? (sales.length >= 1e9 ? (sales.length / 1e9).toFixed(1) + 'B' : (sales.length / 1e6).toFixed(1) + 'M') : sales.length.toLocaleString('en-PH'), title: sales.length.toLocaleString('en-PH'), sub: 'All-time (completed sales)', iconName: 'cart', tone: 'warn' },
      { label: 'Average Transaction', value: Utils.formatCardPHP(avgTotal), title: Utils.formatPHP(avgTotal), sub: 'Per completed sale', iconName: 'trendUp', tone: 'accent' }
    ];
    document.getElementById('salesStatGrid').className = 'stat-grid stat-grid-5';
    document.getElementById('salesStatGrid').innerHTML = stats.map(s =>
      '<div class="stat-card tone-' + s.tone + '" title="' + Utils.escapeHtml(s.title || '') + '">' +
        '<div class="stat-icon tone-' + s.tone + '">' + icon(s.iconName) + '</div>' +
        '<div class="stat-label">' + s.label + '</div>' +
        '<div class="stat-value">' + s.value + '</div>' +
        '<div class="stat-sub">' + s.sub + '</div>' +
      '</div>'
    ).join('');
  }
  renderKpiCards();

  /* ---------- Today's sales summary (read-only, live from the same sales data the POS writes — online and offline) ----------
     Completed = sales rung up today that are still Completed. Voided = anything voided / cancelled / refunded TODAY (even if the sale
     was rung on an earlier day). Net = completed minus refunds of earlier-day sales issued today. There is no cash drawer, so no drawer count. */
  function renderDaySummary() {
    const ref = Utils.demoNow(), peso = Utils.formatPHP;
    const liveSales = Store.get('sales', []);
    const completed = liveSales.filter(function (s) { return Utils.isCountable(s) && Analytics.isSameDay(s.date, ref); });
    const reversed = liveSales.filter(function (s) { return !Utils.isCountable(s) && s.voidInfo && s.voidInfo.at && Analytics.isSameDay(s.voidInfo.at, ref); });
    const earlier = reversed.filter(function (s) { return !Analytics.isSameDay(s.date, ref); });
    const sum = function (l) { return Math.round(l.reduce(function (n, s) { return n + (Number(s.total) || 0); }, 0) * 100) / 100; };
    const gross = sum(completed), voided = sum(reversed), earlierAmt = sum(earlier), net = Math.round((gross - earlierAmt) * 100) / 100;
    const discounts = Math.round(completed.reduce(function (n, s) { return n + (Number(s.discount) || 0); }, 0) * 100) / 100;
    const card = function (lbl, rawAmt, sub, cls) {
      const full = peso(rawAmt);
      const display = Utils.formatCardPHP(rawAmt);
      return '<div class="eod-stat ' + (cls || '') + '" title="' + Utils.escapeHtml(full) + '">' +
        '<div class="eod-lbl">' + lbl + '</div>' +
        '<div class="eod-val">' + display + '</div>' +
        '<div class="eod-sub">' + sub + '</div>' +
      '</div>';
    };
    const n = function (c, w) { return c + ' ' + w + (c === 1 ? '' : 's'); };
    document.getElementById('eodDate').textContent = ref.toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    document.getElementById('eodGrid').innerHTML =
      card('Completed sales', gross, n(completed.length, 'sale'), 'is-ok') +
      card('Voided / refunded', voided, n(reversed.length, 'sale'), reversed.length ? 'is-bad' : '') +
      card('Net sales', net, 'completed \u2212 earlier sales reversed today', 'is-net') +
      card('Discounts given', discounts, 'on completed sales', '');
    const methods = PAYMENT_METHODS.concat(LEGACY_PAYMENT_METHODS.filter(function (m) { return completed.some(function (s) { return s.paymentMethod === m; }); }));   // legacy methods only appear if today has such a sale
    document.getElementById('eodPay').innerHTML = methods.map(function (m) {
      const l = completed.filter(function (s) { return s.paymentMethod === m; });
      const mSum = sum(l);
      return '<div class="eod-pm' + (l.length ? '' : ' is-zero') + '" title="' + Utils.escapeHtml(peso(mSum)) + '"><span>' + m + '</span><strong>' + Utils.formatCardPHP(mSum) + '</strong><small>' + n(l.length, 'sale') + '</small></div>';
    }).join('');
    document.getElementById('eodNote').textContent = 'Read-only. Calculated from today\u2019s recorded sales \u2014 this is not a cash-drawer count.' +
      (earlier.length ? ' ' + n(earlier.length, 'earlier sale') + ' (' + peso(earlierAmt) + ') reversed today ' + (earlier.length === 1 ? 'is' : 'are') + ' subtracted from net.' : '');
  }
  renderDaySummary();

  /* ---------- Orders (time filter + View All Items) ---------- */
  function filterSales(range, source) {
    const src = source || Store.get('sales', []);
    const ref = Utils.demoNow();
    if (range === 'day') return Analytics.salesToday(src, ref);
    if (range === 'week') return Analytics.salesInLastDays(src, ref, 7);
    if (range === 'month') return Analytics.salesInCurrentMonth(src, ref);
    if (range === 'year') return src.filter(s => new Date(s.date).getFullYear() === ref.getFullYear());
    return src;
  }

  const pgSales = createPager(document.getElementById('salesPager'), function () { renderOrders(); }, { size: 5, sizes: [5, 10, 25, 50] });
  function renderOrders() {
    const q = document.getElementById('salesSearch').value.trim().toLowerCase();
    const list = filterSales(document.getElementById('salesFilter').value).filter(function (s) {
      return !q || [s.id, s.staff, s.paymentMethod, s.status].some(function (f) { return f && String(f).toLowerCase().indexOf(q) !== -1; }) ||
        s.items.some(function (i) { return i.name.toLowerCase().indexOf(q) !== -1; });
    });
    const counted = list.filter(Utils.isCountable);
    const recent = pgSales.slice(Analytics.recentSales(list, list.length), q + '|' + document.getElementById('salesFilter').value);
    const sumVal = Analytics.sumTotal(counted);
    const sumHtml = Math.abs(sumVal) >= 10000000
      ? '<span class="abbr-money" data-tooltip="' + Utils.escapeHtml(Utils.formatPHP(sumVal)) + '" title="' + Utils.escapeHtml(Utils.formatPHP(sumVal)) + '">' + Utils.formatCardPHP(sumVal) + '</span>'
      : Utils.formatPHP(sumVal);
    document.getElementById('ordersSummary').innerHTML = counted.length + ' order' + (counted.length === 1 ? '' : 's') + ' \u00b7 ' + sumHtml +
      (list.length !== counted.length ? ' (+' + (list.length - counted.length) + ' voided/refunded)' : '');
    document.getElementById('recentOrdersTbody').innerHTML = recent.length
      ? recent.map(s => {
          const itemSummary = s.items.length === 1 ? s.items[0].name : s.items[0].name + ' +' + (s.items.length - 1) + ' more';
          return '<tr class="' + (Utils.isCountable(s) ? '' : 'sale-voided-row') + '">' +
            '<td data-label="Order" class="mobile-cell-primary" style="font-weight:700;color:var(--ink);">' + s.id + '</td>' +
            '<td data-label="Date" class="text-muted">' + Utils.formatDateTime(s.date) + '</td>' +
            '<td data-label="Items" class="cell-items">' + Utils.escapeHtml(itemSummary) + '</td>' +
            '<td data-label="Staff" class="cell-staff">' + Utils.escapeHtml(s.staff) + '</td>' +
            '<td data-label="Payment"><span class="pay-chip">' + s.paymentMethod + '</span></td>' +
            '<td data-label="Status">' + Utils.saleStatusBadge(s.status) + '</td>' +
            '<td data-label="Total" class="text-right mono-num cell-total" style="font-weight:700;">' + Utils.formatMoneyHtml(s.total) + '</td>' +
            '<td data-label="Actions" class="col-actions mobile-cell-actions"><div class="flex gap-8" style="display:flex;gap:0.5rem;align-items:center;"><button class="icon-btn" title="View All Items" aria-label="View all items in ' + s.id + '" data-mobile-label="View" data-view-sale="' + s.id + '">' + icon('eye') + '</button>' +
            '<button class="icon-btn" title="Reprint receipt (marked DUPLICATE)" aria-label="Reprint receipt for ' + s.id + '" data-mobile-label="Reprint" data-reprint-sale="' + s.id + '">' + icon('download') + '</button></div></td></tr>';
        }).join('')
      : '<tr><td colspan="8"><div class="empty-state">' + icon('sales') + '<h3>No sales for this period</h3></div></td></tr>';
  }

  function saleField(label, value) {
    return '<div><div class="hint" style="margin:0 0 3px;text-transform:uppercase;letter-spacing:.04em;font-weight:700;">' + label + '</div><div style="font-weight:600;color:var(--ink);font-size:.9rem;">' + value + '</div></div>';
  }
  let openSaleId = null;
  function openSaleModal(saleId) {
    const s = Store.get('sales', []).find(x => x.id === saleId);
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
          '<td class="text-right mono-num">' + i.qty + '</td><td class="text-right mono-num">' + Utils.formatMoneyHtml(i.price) + '</td>' +
          '<td class="text-right mono-num">' + Utils.formatMoneyHtml(i.subtotal) + '</td></tr>').join('') +
      '</tbody></table></div>' +
      '<div style="margin-top:14px;text-align:right;font-size:.88rem;">' +
        (discount > 0 ? '<div class="text-muted">Subtotal ' + Utils.formatPHP(subtotal) + ' &nbsp;&middot;&nbsp; Discount -' + Utils.formatPHP(discount) + '</div>' : '') +
        (s.vatEnabled && s.vatAmount > 0 ? '<div class="text-muted">VATable ' + Receipt.peso(s.vatableAmount) + ' &nbsp;&middot;&nbsp; VAT ' + (Math.round(s.vatRate * 10000) / 100) + '% ' + Receipt.peso(s.vatAmount) + (s.vatMode === 'exclusive' ? ' (added)' : ' (included)') + '</div>' : '') +
        '<div style="font-weight:700;color:var(--ink);font-size:1rem;">Total ' + Utils.formatMoneyHtml(s.total) + '</div>' +
      '</div>';
    const voidBtn = document.getElementById('saleVoidBtn');
    voidBtn.style.display = Utils.isCountable(s) ? 'inline-flex' : 'none';     // Staff see it too and get a clear 'Admin only' message; the API enforces it as well
    document.getElementById('saleModalOverlay').classList.add('open');
  }

  async function reprintSale(saleId, btn) {
    await Utils.withBusy(btn, async function () {
      try {
        const r = await Receipt.reprint(saleId, 'sales-page');
        if (r && r.sale) Store.upsertItem('sales', r.sale);
        showToast('Duplicate receipt logged in audit trail and print preview opened.', 'ok');
        renderOrders();
        if (openSaleId === saleId && document.getElementById('saleModalOverlay').classList.contains('open')) openSaleModal(saleId);
        if (Store.syncInBackground) Store.syncInBackground();
      } catch (err) { showToast(err.message, 'danger'); }
    });
  }

  function openVoidModal() {
    if (!openSaleId) return;
    if (!isAdmin) { showToast('Only an Admin can void, cancel or refund a sale. Please ask an Admin.', 'danger'); return; }
    const sale = Store.get('sales', []).find(function (x) { return x.id === openSaleId; });
    const voidTotalStr = sale ? (Math.abs(Number(sale.total) || 0) >= 10000000 ? Utils.formatCardPHP(sale.total) : Utils.formatPHP(sale.total)) + ' \u00b7 ' + (sale.paymentMethod || '') : '';
    document.getElementById('voidSaleTotal').textContent = voidTotalStr;
    if (sale && Math.abs(Number(sale.total) || 0) >= 10000000) {
      document.getElementById('voidSaleTotal').title = Utils.formatPHP(sale.total);
    } else {
      document.getElementById('voidSaleTotal').removeAttribute('title');
    }
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
        if (r && r.sale) Store.upsertItem('sales', r.sale);
        (r.restocked || []).forEach(function (x) {
          if (x && x.productId && x.newStock !== undefined) {
            Store.upsertItem('products', { id: x.productId, stock: x.newStock });
          }
        });
        const skipped = (r.restockSkipped || []).length;
        document.getElementById('voidOverlay').classList.remove('open');
        document.getElementById('saleModalOverlay').classList.remove('open');
        renderKpiCards();
        renderDaySummary();
        renderOrders();
        renderPaymentSummary();
        updateMovementTables();
        if (Store.syncInBackground) Store.syncInBackground();
        showToast(
          r.sale.id + ' marked ' + r.sale.status + '. Stock restored for ' + r.restocked.length + ' item' + (r.restocked.length === 1 ? '' : 's') + '.' +
          (skipped ? ' ' + skipped + ' retired item' + (skipped === 1 ? ' was' : 's were') + ' not restocked (logged in the audit trail).' : ''),
          'ok'
        );
      } catch (err) { document.getElementById('voidError').textContent = err.message; }
    });
  }

  function exportSalesCSV() {
    const q = (document.getElementById('salesSearch') ? document.getElementById('salesSearch').value.trim().toLowerCase() : '');
    const list = filterSales(document.getElementById('salesFilter').value).filter(function (s) {
      return !q || [s.id, s.staff, s.paymentMethod, s.status].some(function (f) { return f && String(f).toLowerCase().indexOf(q) !== -1; }) ||
        s.items.some(function (i) { return i.name.toLowerCase().indexOf(q) !== -1; });
    });
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
          '<span style="font-size:.8rem;color:var(--steel);">' + v.count + ' orders &middot; ' + Utils.formatMoneyHtml(v.total) + '</span>' +
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

  /* ---------- Top sellers / slow movers + product movement tables ----------
     Re-computed from the live Store cache every time, so they stay correct after Store.refresh()
     (fired as 'store:refreshed') and after a sale is voided — no full page reload needed. */
  function hbarList(rows, slow, maxSold) {
    if (!rows.length) return '<div class="empty-state">' + icon('sales') + '<h3>No sales data yet</h3></div>';
    return '<div class="hbar-list" style="margin-top:12px;">' + rows.map(r => {
      const pct = Math.max(4, Math.round((r.unitsSold / maxSold) * 100));
      return '<div class="hbar-row"><div class="hbar-name">' + Utils.escapeHtml(r.product.name) + '</div>' +
        '<div class="hbar-track"><div class="hbar-fill' + (slow ? ' slow' : '') + '" style="width:' + pct + '%"></div></div>' +
        '<div class="hbar-val">' + r.unitsSold + '</div></div>';
    }).join('') + '</div>';
  }

  function renderMovementTable(elementId, rows, categories) {
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
            '<td class="text-right mono-num">' + Utils.formatMoneyHtml(p.sellingPrice) + '</td>' +
            '<td class="text-right mono-num" style="font-weight:700;">' + r.unitsSold + '</td>' +
            '<td class="text-right mono-num" style="font-weight:600;">' + Utils.formatMoneyHtml(revenue) + '</td>' +
            '<td class="text-right mono-num">' + p.stock + '</td>' +
            '<td><span class="badge ' + Utils.statusClass(status) + '">' + status + '</span></td>' +
          '</tr>';
        }).join('')
      : '<tr><td colspan="7"><div class="empty-state">' + icon('sales') + '<h3>No data yet</h3></div></td></tr>';
  }

  function updateMovementTables() {
    const liveProducts = Store.get('products', []).filter(function (p) { return !p.archived; });
    const liveSales = Store.get('sales', []).filter(Utils.isCountable);
    const categories = Store.get('categories', []);
    const ranked = Analytics.rankProductsBySales(liveProducts, liveSales);

    const top5 = ranked.slice(0, 5);
    const bottom5 = ranked.slice(-5).reverse();
    const maxSold = Math.max(1, top5[0] ? top5[0].unitsSold : 1);
    document.getElementById('topSellersList').innerHTML = hbarList(top5, false, maxSold);
    document.getElementById('slowMoversList').innerHTML = hbarList(bottom5, true, maxSold);

    const fastList = ranked.slice(0, Math.min(8, Math.ceil(ranked.length / 2)));
    const slowList = ranked.slice(-Math.min(8, Math.floor(ranked.length / 2))).reverse();
    renderMovementTable('fastMovingTbody', fastList, categories);
    renderMovementTable('slowMovingTbody', slowList, categories);
  }
  updateMovementTables();
  window.addEventListener('store:refreshed', function () {
    renderKpiCards();
    renderDaySummary();
    renderOrders();
    renderPaymentSummary();
    updateMovementTables();
  });

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
