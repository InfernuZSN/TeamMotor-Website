/* ==========================================================================
   dashboard.js — powers index.html (Dashboard)
   --------------------------------------------------------------------------
   Everything here is calculated from the live Inventory + POS data in the Store (products, sales,
   inventory transactions, warranties); nothing is hard-coded or taken from the demo seed.
   render() redraws the whole page from the Store, so it serves the first load AND the automatic refresh
   (every 30 s and whenever the tab becomes visible again), which is how a sale made at the POS shows up
   here without reloading.

   Layout: six status cards (good = green, low/critical = red, each with a text cue so colour is never the
   only signal) and ONE panel whose chips switch between Recent Sales, Sales Trend, Low Stock, Out of Stock,
   Expiring, Warranties, Stock-In and Top / Slow Sellers. The panel scrolls inside itself, so the page
   itself fits one screen.
   ========================================================================== */
Boot.ready(function () {
  if (!initShell('dashboard')) return;

  const $ = function (id) { return document.getElementById(id); };
  const esc = function (s) { return Utils.escapeHtml(s); };
  const DAY = 86400000;
  const startOfDay = function (d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const unitsIn = function (list) { return list.reduce(function (n, s) { return n + s.items.reduce(function (m, i) { return m + i.qty; }, 0); }, 0); };

  let view = 'recent';       // which panel view is showing
  let period = 'today';      // today | week | month  (Products Sold card + Top / Slow Sellers)
  let trendRange = 'week';   // week | month | year   (Sales Trend view)
  const PERIOD_LABEL = { today: 'today', week: 'in the last 7 days', month: 'in the last 30 days' };
  const PERIOD_DAYS = { today: 1, week: 7, month: 30 };

  /* ---------- everything the page shows, derived once per render ---------- */
  function collect() {
    const now = Utils.demoNow();
    const allProducts = Store.get('products', []);
    const products = allProducts.filter(function (p) { return !p.archived; });
    const sales = Store.get('sales', []).filter(Utils.isCountable);
    const warranties = Store.get('warranties', []);
    const months = (Store.get('settings', {}).expiryWarningMonths) || 3;

    const todaySales = Analytics.salesToday(sales, now);
    // "yesterday so far": same clock time yesterday, so a quiet morning is not flagged red against a full day
    const y0 = startOfDay(now).getTime() - DAY, y1 = now.getTime() - DAY;
    const ySoFar = sales.filter(function (s) { const t = new Date(s.date).getTime(); return t >= y0 && t <= y1; });

    const pStart = startOfDay(now).getTime() - (PERIOD_DAYS[period] - 1) * DAY;
    const periodSales = sales.filter(function (s) { return new Date(s.date).getTime() >= pStart; });

    const withExpiry = products.filter(function (p) { return p.stock > 0 && p.expirationDate; });
    return {
      now: now, allProducts: allProducts, products: products, sales: sales, warranties: warranties, months: months,
      todaySales: todaySales, ySoFar: ySoFar, periodSales: periodSales,
      low: Analytics.lowStockProducts(products), out: Analytics.outOfStockProducts(products),
      expired: withExpiry.filter(function (p) { return Utils.expiryStatus(p, months) === 'Expired'; }),
      expiring: withExpiry.filter(function (p) { return Utils.expiryStatus(p, months) === 'Expiring Soon'; }),
      warrantySoon: warranties.filter(function (w) { return Utils.getWarrantyStatus(w, now) === 'Expiring Soon'; }),
      customers: Store.get('customers', []),
      categories: Store.get('categories', []),
      units: products.reduce(function (n, p) { return n + p.stock; }, 0)
    };
  }

  /* ---------- the six cards ---------- */
  function renderCards(d) {
    const todayTotal = Analytics.sumTotal(d.todaySales), yTotal = Analytics.sumTotal(d.ySoFar);
    let salesTone = 'neutral', salesSub;
    if (!d.todaySales.length) { salesSub = 'No sales yet today'; }
    else if (!yTotal) { salesTone = 'ok'; salesSub = '\u2713 ' + d.todaySales.length + ' transaction' + (d.todaySales.length === 1 ? '' : 's'); }
    else {
      const pct = Math.round((todayTotal - yTotal) / yTotal * 100);
      salesTone = pct >= 0 ? 'ok' : 'danger';
      salesSub = (pct >= 0 ? '\u25B2 ' : '\u25BC ') + Math.abs(pct) + '% vs this time yesterday';
    }
    const unitsSold = unitsIn(d.periodSales);
    const cards = [
      { view: 'recent', label: "Today's Sales", value: Utils.formatPHP(todayTotal), sub: salesSub, icon: 'trendUp', tone: salesTone },
      { href: 'inventory.html', label: 'Total Products', value: d.products.length, sub: d.categories.length + ' categories \u00B7 ' + d.units.toLocaleString('en-PH') + ' units in stock', icon: 'box', tone: 'neutral' },
      { view: 'low', label: 'Low Stock', value: d.low.length, sub: d.low.length ? '! At or below reorder level' : '\u2713 All above reorder level', icon: 'alertTriangle', tone: d.low.length ? 'danger' : 'ok' },
      { view: 'out', label: 'Out of Stock', value: d.out.length, sub: d.out.length ? '! Needs immediate restock' : '\u2713 Nothing sold out', icon: 'xCircle', tone: d.out.length ? 'danger' : 'ok' },
      { view: 'perf', label: 'Products Sold', value: unitsSold.toLocaleString('en-PH'), sub: unitsSold ? '\u2713 units ' + PERIOD_LABEL[period] : 'No units sold ' + PERIOD_LABEL[period], icon: 'cart', tone: unitsSold ? 'ok' : 'neutral' },
      { view: 'warranty', label: 'Upcoming Warranties', value: d.warrantySoon.length, sub: d.warrantySoon.length ? '! Expiring soon' : '\u2713 None expiring soon', icon: 'shield', tone: d.warrantySoon.length ? 'danger' : 'ok' }
    ];
    $('statGrid').innerHTML = cards.map(function (c) {
      const inner = '<div class="stat-icon tone-' + c.tone + '">' + icon(c.icon) + '</div>' +
        '<div class="stat-label">' + c.label + '</div><div class="stat-value">' + c.value + '</div><div class="stat-sub">' + c.sub + '</div>';
      const aria = ' aria-label="' + esc(c.label + ': ' + String(c.value).replace(/<[^>]*>/g, '') + '. ' + c.sub.replace(/^[\u2713!\u25B2\u25BC]\s*/, '')) + '"';
      return c.href
        ? '<a class="stat-card tone-' + c.tone + '" href="' + c.href + '"' + aria + '>' + inner + '</a>'
        : '<button type="button" class="stat-card tone-' + c.tone + '" data-view="' + c.view + '"' + aria + '>' + inner + '</button>';
    }).join('');
  }

  /* ---------- chips that choose the panel view ---------- */
  function renderChips(d) {
    const chips = [
      { v: 'recent', label: 'Recent Sales' },
      { v: 'trend', label: 'Sales Trend' },
      { v: 'low', label: 'Low Stock', n: d.low.length },
      { v: 'out', label: 'Out of Stock', n: d.out.length },
      { v: 'expiring', label: 'Expiring', n: d.expired.length + d.expiring.length, bad: d.expired.length > 0 },
      { v: 'warranty', label: 'Warranties', n: d.warrantySoon.length },
      { v: 'stockin', label: 'Recent Stock-In' },
      { v: 'perf', label: 'Top / Slow Sellers' }
    ];
    $('dashViews').innerHTML = chips.map(function (c) {
      return '<button type="button" role="tab" class="chip' + (view === c.v ? ' active' : '') + '" data-view="' + c.v + '" aria-selected="' + (view === c.v) + '">' + c.label +
        (c.n ? '<span class="chip-count' + (c.bad ? ' is-bad' : '') + '">' + c.n + '</span>' : '') + '</button>';
    }).join('');
  }

  /* ---------- panel views ---------- */
  const empty = function (ico, text) { return '<div class="empty-state">' + icon(ico) + '<h3>' + text + '</h3></div>'; };
  const heading = function (title, note, link) {
    return '<div class="dash-sub"><div><h3>' + title + '</h3>' + (note ? '<p>' + note + '</p>' : '') + '</div>' + (link || '') + '</div>';
  };
  const invLink = '<a href="inventory.html" class="btn btn-ghost btn-sm">Open Inventory</a>';

  function viewRecent(d) {
    const rows = Analytics.recentSales(d.sales, 25);
    return heading('Recent Sales', 'Latest completed POS transactions', '<a href="sales.html" class="btn btn-ghost btn-sm">View all sales</a>') +
      (rows.length ? '<div class="table-wrap"><table><thead><tr><th>Transaction</th><th>Items</th><th class="text-right">Amount</th><th>Payment</th><th>Time</th></tr></thead><tbody>' +
        rows.map(function (s) {
          const items = s.items.map(function (i) { return i.qty + '\u00D7 ' + esc(i.name); }).join(', ');
          return '<tr><td class="mono-num" style="font-weight:600;color:var(--ink);">' + esc(s.id) + '</td><td style="max-width:22rem;">' + items + '</td>' +
            '<td class="text-right mono-num" style="font-weight:700;">' + Utils.formatPHP(s.total) + '</td><td><span class="pay-chip">' + esc(s.paymentMethod) + '</span></td>' +
            '<td class="text-muted">' + Utils.formatDateTime(s.date) + '</td></tr>';
        }).join('') + '</tbody></table></div>'
        : empty('sales', 'No sales yet'));
  }

  function viewTrend(d) {
    const now = d.now;
    let buckets, dense = false, yearly = false;
    if (trendRange === 'year') { buckets = Analytics.monthlyTotals(d.sales, now, 12); yearly = true; }
    else if (trendRange === 'month') { buckets = Analytics.dailyTotals(d.sales, now, 30); dense = true; }
    else { buckets = Analytics.dailyTotals(d.sales, now, 7); }
    const max = Math.max(1, Math.max.apply(null, buckets.map(function (b) { return b.total; })));
    const titles = { week: 'Last 7 days', month: 'Last 30 days', year: 'Last 12 months' };
    const chips = ['week', 'month', 'year'].map(function (r) {
      return '<button type="button" class="chip' + (trendRange === r ? ' active' : '') + '" data-trend="' + r + '">' + { week: '1 Week', month: '1 Month', year: '1 Year' }[r] + '</button>';
    }).join('');
    return heading('Sales Trend \u2014 ' + titles[trendRange], 'Total completed sales per ' + (yearly ? 'month' : 'day'), '<div class="chip-row">' + chips + '</div>') +
      '<div class="bar-chart dash-trend' + (dense ? ' is-dense' : '') + (yearly ? ' is-yearly' : '') + '">' + buckets.map(function (b, idx) {
        const pct = Math.round(b.total / max * 100), peak = b.total === max && b.total > 0;
        let label = b.label;
        if (dense) label = b.shortLabel + ((idx === 0 || b.shortLabel === '1') ? '<small>' + b.monthLabel + '</small>' : '');
        else if (yearly && (idx === 0 || b.month === 0)) label = b.label + '<small>' + b.year + '</small>';
        return '<div class="bar-col" title="' + b.title + ': ' + Utils.formatPHP(b.total) + '"><div class="bar' + (peak ? ' is-peak' : '') + '" style="height:' + Math.max(pct, b.total > 0 ? 6 : 2) + '%">' +
          (b.total > 0 && !dense ? '<span class="bar-value">' + Utils.formatPHP(b.total) + '</span>' : '') + '</div><div class="bar-label">' + label + '</div></div>';
      }).join('') + '</div>';
  }

  function stockTable(list) {
    const suppliers = Store.get('suppliers', []);
    return '<div class="table-wrap"><table><thead><tr><th>Product</th><th>Category</th><th>Supplier</th><th class="text-right">In stock</th><th class="text-right">Reorder at</th><th>Status</th></tr></thead><tbody>' +
      list.map(function (p) {
        const st = Utils.getStockStatus(p.stock, p.reorderLevel), cat = Store.get('categories', []).find(function (c) { return c.id === p.category; }), sup = suppliers.find(function (s) { return s.id === p.supplier; });
        return '<tr><td><div class="cell-product"><div class="cell-thumb thumb-' + p.category + '">' + icon('box') + '</div><div><div class="name">' + esc(p.name) + '</div><div class="sub">' + esc(p.id) + '</div></div></div></td>' +
          '<td>' + esc(cat ? cat.name : '\u2014') + '</td><td>' + esc(sup ? sup.name : '\u2014') + '</td>' +
          '<td class="text-right mono-num" style="font-weight:700;">' + p.stock + '</td><td class="text-right mono-num">' + p.reorderLevel + '</td>' +
          '<td><span class="badge ' + Utils.statusClass(st) + '">' + st + '</span></td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  const viewLow = function (d) {
    return heading('Low Stock', 'At or below the reorder level, still in stock', invLink) + (d.low.length ? stockTable(d.low.slice().sort(function (a, b) { return a.stock - b.stock; })) : empty('checkCircle', 'No low-stock items'));
  };
  const viewOut = function (d) {
    return heading('Out of Stock', 'Cannot be sold at the POS until restocked', invLink) + (d.out.length ? stockTable(d.out) : empty('checkCircle', 'Nothing is out of stock'));
  };

  function viewExpiring(d) {
    const rows = d.expired.map(function (p) { return { p: p, st: 'Expired' }; }).concat(d.expiring.map(function (p) { return { p: p, st: 'Expiring Soon' }; }));
    return heading('Expiring Products', 'Expired items must be pulled from sale; warning window is ' + d.months + ' months', invLink) +
      (rows.length ? '<div class="table-wrap"><table><thead><tr><th>Product</th><th class="text-right">In stock</th><th>Expires</th><th>Status</th></tr></thead><tbody>' +
        rows.map(function (r) {
          return '<tr><td style="font-weight:600;color:var(--ink);">' + esc(r.p.name) + ' <span class="text-muted">(' + esc(r.p.id) + ')</span></td><td class="text-right mono-num">' + r.p.stock + '</td>' +
            '<td>' + Utils.formatDate(r.p.expirationDate + 'T00:00:00') + '</td><td><span class="badge ' + (r.st === 'Expired' ? 'badge-danger' : 'badge-warn') + '">' + r.st + '</span></td></tr>';
        }).join('') + '</tbody></table></div>'
        : empty('checkCircle', 'Nothing expired or expiring soon'));
  }

  function viewWarranty(d) {
    const rows = d.warranties.map(function (w) { return { w: w, st: Utils.getWarrantyStatus(w, d.now) }; })
      .filter(function (r) { return r.st === 'Expiring Soon' || r.st === 'Active'; })
      .sort(function (a, b) { return (a.st === b.st ? 0 : a.st === 'Expiring Soon' ? -1 : 1) || new Date(a.w.warrantyExpiration) - new Date(b.w.warrantyExpiration); });
    return heading('Warranties', 'Expiring soon first, then active warranties', '<a href="warranty.html" class="btn btn-ghost btn-sm">Open Warranty</a>') +
      (rows.length ? '<div class="table-wrap"><table><thead><tr><th>Product</th><th>Customer</th><th>Expires</th><th>Status</th></tr></thead><tbody>' +
        rows.map(function (r) {
          const w = r.w, c = d.customers.find(function (x) { return x.id === w.customerId; }), p = d.allProducts.find(function (x) { return x.id === w.productId; });
          const left = Math.round((new Date(w.warrantyExpiration) - d.now) / DAY);
          return '<tr><td style="font-weight:600;color:var(--ink);">' + esc(p ? p.name : (w.productName || 'Motorcycle')) + '</td><td>' + esc(c ? c.name : 'Walk-in Customer') + '</td>' +
            '<td>' + Utils.formatDate(w.warrantyExpiration) + '</td><td><span class="badge ' + (r.st === 'Expiring Soon' ? 'badge-warn' : 'badge-ok') + '">' + (r.st === 'Expiring Soon' ? left + 'd left' : 'Active') + '</span></td></tr>';
        }).join('') + '</tbody></table></div>'
        : empty('shield', 'No upcoming warranty activity'));
  }

  function viewStockIn() {
    const rows = Store.get('inventoryTransactions', []).filter(function (t) { return t.type === 'Stock In' && t.reference !== 'Opening count'; }).slice(0, 30);
    const suppliers = Store.get('suppliers', []);
    return heading('Recent Stock-In', 'Latest deliveries received', invLink) +
      (rows.length ? '<div class="table-wrap"><table><thead><tr><th>Product</th><th class="text-right">Qty</th><th>Supplier</th><th>Reference</th><th>When</th></tr></thead><tbody>' +
        rows.map(function (t) {
          const sup = suppliers.find(function (s) { return s.id === t.supplierId; });
          return '<tr><td style="font-weight:600;color:var(--ink);">' + esc(t.productName) + '</td><td class="text-right mono-num" style="font-weight:700;color:var(--ok);">+' + t.quantity + '</td>' +
            '<td>' + esc(sup ? sup.name : '\u2014') + '</td><td class="text-muted">' + esc(t.reference || '\u2014') + '</td><td class="text-muted">' + Utils.timeAgo(t.date) + '</td></tr>';
        }).join('') + '</tbody></table></div>'
        : empty('stockIn', 'No recent stock-in'));
  }

  function viewPerf(d) {
    const ranked = Analytics.rankProductsBySales(d.products, d.periodSales);
    const top = ranked.slice(0, 5), bottom = ranked.slice(-5).reverse();
    const rows = top.map(function (r) { return { r: r, fast: true }; }).concat(bottom.filter(function (r) { return top.indexOf(r) === -1; }).map(function (r) { return { r: r, fast: false }; }));
    return heading('Top / Slow Sellers', 'Units sold ' + PERIOD_LABEL[period] + ' vs. what is in stock (change the period above the cards)') +
      (d.periodSales.length && rows.length ? '<div class="table-wrap"><table><thead><tr><th>Product</th><th class="text-right">Units sold</th><th class="text-right">In stock</th><th>Movement</th></tr></thead><tbody>' +
        rows.map(function (x) {
          return '<tr><td style="font-weight:600;color:var(--ink);">' + esc(x.r.product.name) + '</td><td class="text-right mono-num">' + x.r.unitsSold + '</td><td class="text-right mono-num">' + x.r.product.stock + '</td>' +
            '<td><span class="badge ' + (x.fast ? 'badge-ok' : 'badge-neutral') + '">' + (x.fast ? 'Fast Moving' : 'Slow Moving') + '</span></td></tr>';
        }).join('') + '</tbody></table></div>'
        : empty('sales', 'No sales ' + PERIOD_LABEL[period] + ' yet'));
  }

  const VIEWS = { recent: viewRecent, trend: viewTrend, low: viewLow, out: viewOut, expiring: viewExpiring, warranty: viewWarranty, stockin: viewStockIn, perf: viewPerf };

  /* ---------- draw everything (scroll position is kept so an auto-refresh doesn't jump) ---------- */
  function render() {
    const d = collect(), body = $('dashBody'), top = body.scrollTop;
    renderCards(d); renderChips(d);
    body.innerHTML = VIEWS[view](d);
    body.scrollTop = top;
  }
  function setView(v) { view = v; $('dashBody').scrollTop = 0; render(); }

  /* ---------- live refresh ---------- */
  function stamp(ok) {
    const live = $('dashLive');
    live.classList.toggle('is-stale', !ok);
    $('dashUpdated').textContent = ok ? 'Live \u00B7 updated ' + new Date().toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : 'Could not refresh \u2014 showing last data';
  }
  let refreshing = false;
  async function refresh() {
    if (refreshing || document.hidden) return;
    refreshing = true;
    try { await Store.refresh(); render(); stamp(true); renderSidebar('dashboard'); if (window.Notifications) Notifications.render(); }
    catch (e) { stamp(false); }
    finally { refreshing = false; }
  }

  Boot.dom(function () {
    render(); stamp(true);
    $('statGrid').addEventListener('click', function (e) { const c = e.target.closest('[data-view]'); if (c) setView(c.dataset.view); });
    $('dashViews').addEventListener('click', function (e) { const c = e.target.closest('[data-view]'); if (c) setView(c.dataset.view); });
    $('dashBody').addEventListener('click', function (e) { const t = e.target.closest('[data-trend]'); if (t) { trendRange = t.dataset.trend; render(); } });
    $('periodChips').addEventListener('click', function (e) {
      const c = e.target.closest('[data-period]'); if (!c) return;
      period = c.dataset.period;
      document.querySelectorAll('#periodChips .chip').forEach(function (x) { x.classList.toggle('active', x === c); });
      render();
    });
    setInterval(refresh, 30000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });
  });
});
