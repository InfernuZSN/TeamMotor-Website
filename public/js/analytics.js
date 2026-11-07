/* ==========================================================================
   analytics.js
   ----------------------------------------------------------------------
   Pure functions that turn raw sales/products/transactions into the
   numbers the Dashboard and Sales pages show. Nothing here touches the
   DOM or Store directly — pages read data from Store, hand it to
   Analytics, and render the result. Keeping this pure makes it trivial
   to point at a real reporting API later.
   ========================================================================== */
const Analytics = {
  /* Local calendar day (YYYY-MM-DD) of an ISO timestamp. Slicing the UTC string put sales made before 8 AM
     in the Philippines on the previous day. */
  dateKey(iso) {
    const d = new Date(iso);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  },

  isSameDay(iso, refDate) {
    return Analytics.dateKey(iso) === Analytics.dateKey(refDate.toISOString());
  },

  salesToday(sales, refDate) {
    return sales.filter(s => Analytics.isSameDay(s.date, refDate));
  },

  salesInLastDays(sales, refDate, days) {
    const cutoff = new Date(refDate);
    cutoff.setDate(cutoff.getDate() - (days - 1));
    cutoff.setHours(0, 0, 0, 0);
    return sales.filter(s => new Date(s.date) >= cutoff && new Date(s.date) <= refDate);
  },

  salesInCurrentMonth(sales, refDate) {
    return sales.filter(s => {
      const d = new Date(s.date);
      return d.getFullYear() === refDate.getFullYear() && d.getMonth() === refDate.getMonth();
    });
  },

  sumTotal(sales) {
    return sales.reduce((sum, s) => sum + s.total, 0);
  },

  unitsSoldByProduct(sales) {
    const map = {};
    sales.forEach(s => s.items.forEach(i => {
      map[i.productId] = (map[i.productId] || 0) + i.qty;
    }));
    return map;
  },

  /* Every product ranked by units sold, most to least — dashboard/sales
     pages slice() the ends of this for "fast" and "slow" movers so the
     two lists always agree with each other. */
  rankProductsBySales(products, sales) {
    const sold = Analytics.unitsSoldByProduct(sales);
    return products
      .filter(p => !p.archived)
      .map(p => ({ product: p, unitsSold: sold[p.id] || 0 }))
      .sort((a, b) => b.unitsSold - a.unitsSold);
  },

  paymentMethodSummary(sales) {
    const methods = ALL_PAYMENT_METHODS;
    const summary = {};
    methods.forEach(m => { summary[m] = { count: 0, total: 0 }; });
    sales.forEach(s => {
      if (!summary[s.paymentMethod]) summary[s.paymentMethod] = { count: 0, total: 0 };
      summary[s.paymentMethod].count += 1;
      summary[s.paymentMethod].total += s.total;
    });
    return summary;
  },

  /* One bucket per day for the last `days` days, oldest first — feeds the
     sales-trend bar charts. Labels adapt to the range: weekday names for a
     week or less, "Mon 12" style for longer ranges. `shortLabel` is the bare
     day number, used by dense (30-day) charts where full labels won't fit. */
  dailyTotals(sales, refDate, days) {
    const buckets = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(refDate);
      d.setDate(d.getDate() - i);
      const key = Analytics.dateKey(d.toISOString());
      buckets.push({
        date: key,
        label: days <= 7
          ? d.toLocaleDateString('en-PH', { weekday: 'short' })
          : d.toLocaleDateString('en-PH', { weekday: 'short' }) + ' ' + d.getDate(),
        shortLabel: String(d.getDate()),
        monthLabel: d.toLocaleDateString('en-PH', { month: 'short' }),
        title: d.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }),
        total: 0
      });
    }
    sales.forEach(s => {
      const key = Analytics.dateKey(s.date);
      const bucket = buckets.find(b => b.date === key);
      if (bucket) bucket.total += s.total;
    });
    return buckets;
  },

  /* One bucket per calendar month for the last `months` months (including
     the month of refDate), oldest first — feeds the 1-year trend view.
     Months with no sales are kept as zero-height buckets. */
  monthlyTotals(sales, refDate, months) {
    const buckets = [];
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(refDate.getFullYear(), refDate.getMonth() - i, 1);
      const y = d.getFullYear(), m = d.getMonth();
      buckets.push({
        year: y, month: m,
        date: y + '-' + String(m + 1).padStart(2, '0'),
        label: d.toLocaleDateString('en-PH', { month: 'short' }),
        title: d.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' }),
        total: 0
      });
    }
    sales.forEach(s => {
      const d = new Date(s.date);
      const bucket = buckets.find(b => b.year === d.getFullYear() && b.month === d.getMonth());
      if (bucket) bucket.total += s.total;
    });
    return buckets;
  },

  recentSales(sales, n) {
    return sales.slice().sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, n);
  },

  recentTransactions(transactions, n) {
    return transactions.slice().sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, n);
  },

  lowStockProducts(products) {
    return products.filter(p => !p.archived && Utils.getStockStatus(p.stock, p.reorderLevel) === 'Low Stock');
  },

  outOfStockProducts(products) {
    return products.filter(p => !p.archived && Utils.getStockStatus(p.stock, p.reorderLevel) === 'Out of Stock');
  }
};
