/* ==========================================================================
   receipt.js — one receipt renderer for the whole app (POS preview, POS success screen, Sales page reprint)
   ----------------------------------------------------------------------
   Layout targets a 58 mm thermal roll (Xprinter XP-58, OC-58IIH, POS-58, ~48 mm printable) (see "Receipt" + @media print in css/style.css).

   Receipt.html(d)            -> markup for a receipt data object (see Receipt.fromSale / previewData in pos-receipt.js)
   Receipt.fromSale(sale, o)  -> data object built ONLY from the stored transaction (items, prices, VAT, tender, shop
                                 details as they were when the sale happened) — never from today's prices or settings
   Receipt.print(d)           -> opens the browser print dialog for just the receipt
   Receipt.reprint(saleId)    -> asks the server to record the reprint (count + audit trail), then prints the
                                 original data marked "DUPLICATE COPY — REPRINT" with the reprint date/time
   ========================================================================== */
const Receipt = (function () {
  const esc = function (s) { return Utils.escapeHtml(s); };
  const peso = function (n) { return '\u20B1' + (Number(n) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };

  function defaultShop() {
    const s = Store.get('settings', {});
    return { shopName: s.shopName, tagline: s.tagline, addressLines: s.addressLines, phone: s.phone, tin: s.tin, receiptFooter: s.receiptFooter };
  }

  function html(d) {
    const shop = d.shop || defaultShop();
    const dt = d.date instanceof Date ? d.date : new Date(d.date);
    const dateStr = dt.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
    const timeStr = dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const rows = d.items.length ? d.items.map(function (it) {
      return '<tr><td>' + it.qty + '</td><td>' + esc(it.name) + '</td><td class="r">' + peso(it.price) + '</td><td class="r">' + peso(it.subtotal) + '</td></tr>';
    }).join('') : '<tr><td colspan="4" class="rcpt-none">No items yet</td></tr>';

    let banner = '';
    if (d.isPreview) banner = '<div class="rcpt-banner rcpt-banner-preview">ORDER PREVIEW \u2022 NOT AN OFFICIAL RECEIPT</div>';
    else if (d.reprint) banner = '<div class="rcpt-banner rcpt-banner-reprint">DUPLICATE COPY \u2014 REPRINT' + (d.reprint.number > 1 ? ' #' + d.reprint.number : '') + '</div>';
    if (!d.isPreview && d.status && d.status !== 'Completed') banner += '<div class="rcpt-banner rcpt-banner-void">' + esc(String(d.status).toUpperCase()) + ' \u2014 NOT VALID FOR CLAIMS</div>';

    const head = d.isPreview
      ? '<div class="rcpt-head"><strong>ORDER PREVIEW</strong><span>Ref: ' + esc(d.no) + '</span></div>'
      : '<div class="rcpt-head"><strong>SALES RECEIPT</strong><span>No. ' + esc(d.no) + '</span></div>';

    const v = d.vat || {};
    const vatRows = v.enabled
      ? '<div><span>VATable Sales</span><span>' + peso(v.vatable) + '</span></div>' +
        '<div><span>VAT ' + (Math.round((v.rate || 0) * 10000) / 100) + '%' + (v.mode === 'exclusive' ? ' (added)' : ' (incl.)') + '</span><span>' + peso(v.amount) + '</span></div>'
      : '';

    const isCash = d.isCash !== undefined ? !!d.isCash : (d.method === 'Cash');
    const tenderRows = isCash
      ? '<div><span>Amount Tendered</span><span>' + peso(d.tendered) + '</span></div>' +
        '<div><span>Change</span><span>' + peso(d.change) + '</span></div>'
      : '';

    const warrantyItems = getWarrantyItems(d);
    let warrantyRows = '';
    if (warrantyItems.length) {
      warrantyRows = '<div class="rcpt-warranty">' +
        '<div class="rcpt-warranty-title">WARRANTY INFORMATION</div>' +
        warrantyItems.map(function (w) {
          const qtyPrefix = w.qty > 1 ? w.qty + '\u00D7 ' : '';
          const idDisplay = w.id ? esc(w.id) : (d.isPreview ? 'Pending checkout' : (d.no || 'Active'));
          let durDisplay = esc(w.duration || '');
          if (w.coverage) {
            durDisplay = durDisplay ? (durDisplay + ' (' + esc(w.coverage) + ')') : esc(w.coverage);
          }
          return '<div class="rcpt-warranty-item">' +
            '<div class="rcpt-warranty-name">&#8226; ' + qtyPrefix + esc(w.name) + '</div>' +
            '<div class="rcpt-warranty-row"><span>Warranty ID</span><span>: ' + idDisplay + '</span></div>' +
            (durDisplay ? '<div class="rcpt-warranty-row"><span>Duration</span><span>: ' + durDisplay + '</span></div>' : '') +
            (w.expires ? '<div class="rcpt-warranty-row"><span>Valid Until</span><span>: ' + esc(w.expires) + '</span></div>' : '') +
          '</div>';
        }).join('') +
      '</div>';
    }

    const reprintFoot = d.reprint
      ? '<div class="rcpt-reprint">Reprinted on: ' + esc(new Date(d.reprint.at).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })) +
        (d.reprint.by ? '<br>Reprinted by: ' + esc(d.reprint.by) : '') + '<br>Original sale: ' + esc(dateStr + ' ' + timeStr) + '</div>'
      : '';

    return '<div class="rcpt' + (d.reprint ? ' is-reprint' : '') + '">' +
      '<img class="rcpt-logo" src="img/receipt-logo.png" alt="' + esc(shop.shopName || 'TeamMotor') + '">' +
      '<div class="rcpt-shop">' + esc(shop.tagline || '') + (shop.addressLines || []).map(function (l) { return '<br>' + esc(l); }).join('') +
        (shop.phone ? '<br>Tel: ' + esc(shop.phone) : '') + (shop.tin ? '<br>' + esc(shop.tin) : '') + '</div>' +
      banner + head +
      '<div class="rcpt-meta"><span>Date</span><span>: ' + dateStr + '</span><span>Time</span><span>: ' + timeStr + '</span><span>Cashier</span><span>: ' + esc(d.cashier) + '</span></div>' +
      '<table class="rcpt-items"><thead><tr><th>Qty</th><th>Description</th><th class="r">Price</th><th class="r">Amount</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<div class="rcpt-sums">' +
        '<div><span>Subtotal</span><span>' + peso(d.subtotal) + '</span></div>' +
        '<div><span>Discount</span><span>' + peso(d.discount) + '</span></div>' +
        vatRows +
        '<div class="rcpt-total"><span>TOTAL</span><span>' + peso(d.total) + '</span></div>' +
        '<div><span>Payment Method</span><span>' + esc(d.method) + '</span></div>' +
        (d.reference ? '<div><span>Reference</span><span>' + esc(d.reference) + '</span></div>' : '') +
        tenderRows +
      '</div>' +
      warrantyRows +
      '<div class="rcpt-foot">' + (shop.receiptFooter || []).map(esc).join('<br>') + '</div>' +
      reprintFoot +
    '</div>';
  }

  /* Extract warranty records for items on the receipt (Option A: groups identical products with quantity) */
  function getWarrantyItems(d) {
    if (!d || !Array.isArray(d.items) || !d.items.length) return [];

    const grouped = [];
    const groupedMap = new Map();
    d.items.forEach(function (it) {
      if (!it) return;
      const key = (it.productId || it.name || '').trim();
      if (!key) return;
      if (groupedMap.has(key)) {
        groupedMap.get(key).qty += (Number(it.qty) || 1);
      } else {
        const copy = { productId: it.productId || '', name: it.name || '', qty: Number(it.qty) || 1 };
        groupedMap.set(key, copy);
        grouped.push(copy);
      }
    });

    const storeWarranties = (typeof Store !== 'undefined' && Store.get && Array.isArray(Store.get('warranties', []))) ? Store.get('warranties', []) : [];
    const storeProducts = (typeof Store !== 'undefined' && Store.get && Array.isArray(Store.get('products', []))) ? Store.get('products', []) : [];
    const explicitWarranties = Array.isArray(d.warranties) ? d.warranties : [];

    const baseDate = d.date instanceof Date ? d.date : new Date(d.date || Date.now());
    const baseDateStr = !isNaN(baseDate.getTime()) ? baseDate.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);

    const out = [];
    grouped.forEach(function (it) {
      const pId = it.productId;
      const pNameLower = (it.name || '').toLowerCase().trim();

      // Match explicit warranties attached to sale or stored in Store
      let matchedWar = explicitWarranties.find(function (w) {
        return (pId && w.productId === pId) || ((w.productName || '').toLowerCase().trim() === pNameLower);
      });

      if (!matchedWar && d.no && storeWarranties.length) {
        matchedWar = storeWarranties.find(function (w) {
          return w.saleId === d.no && ((pId && w.productId === pId) || ((w.productName || '').toLowerCase().trim() === pNameLower));
        });
      }

      // Match product definition in Store
      let prod = null;
      if (storeProducts.length) {
        prod = (pId && storeProducts.find(function (p) { return p.id === pId; })) ||
               storeProducts.find(function (p) { return (p.name || '').toLowerCase().trim() === pNameLower; });
      }

      const hasWarranty = matchedWar || (prod && typeof Utils !== 'undefined' && Utils.hasProductWarranty && Utils.hasProductWarranty(prod));
      if (!hasWarranty) return;

      let dur = '';
      if (matchedWar && matchedWar.duration && matchedWar.unit) {
        const n = Number(matchedWar.duration);
        let u = String(matchedWar.unit || 'months');
        u = (n === 1 ? u.replace(/s$/, '') : u);
        u = u.charAt(0).toUpperCase() + u.slice(1);
        dur = n + ' ' + u;
      } else if (prod && Number(prod.warrantyDuration) > 0) {
        const n = Number(prod.warrantyDuration);
        let u = String(prod.warrantyUnit || 'months');
        u = (n === 1 ? u.replace(/s$/, '') : u);
        u = u.charAt(0).toUpperCase() + u.slice(1);
        dur = n + ' ' + u;
      } else if (prod && Number(prod.warrantyDays) > 0) {
        const dDays = Number(prod.warrantyDays);
        dur = dDays + ' ' + (dDays === 1 ? 'Day' : 'Days');
      } else if (matchedWar && matchedWar.warrantyStart && matchedWar.warrantyExpiration) {
        const diff = Math.round((new Date(matchedWar.warrantyExpiration) - new Date(matchedWar.warrantyStart)) / 86400000);
        if (diff > 0) dur = diff + ' Days';
      }

      const coverage = (matchedWar && matchedWar.coverage) || (prod && prod.warrantyType) || 'Standard parts warranty';

      let exp = matchedWar ? (matchedWar.warrantyExpiration || '') : '';
      if (!exp && prod && typeof Utils !== 'undefined' && Utils.calculateWarrantyExpiry) {
        if (Number(prod.warrantyDuration) > 0) {
          exp = Utils.calculateWarrantyExpiry(baseDateStr, prod.warrantyDuration, prod.warrantyUnit || 'months');
        } else if (Number(prod.warrantyDays) > 0) {
          exp = Utils.calculateWarrantyExpiry(baseDateStr, prod.warrantyDays, 'days');
        }
      }

      let expFormatted = exp;
      if (exp) {
        const expDt = new Date(exp.slice(0, 10) + 'T00:00:00');
        if (!isNaN(expDt.getTime())) {
          expFormatted = expDt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        }
      }

      out.push({
        productId: pId,
        name: it.name,
        qty: it.qty,
        id: matchedWar ? matchedWar.id : '',
        duration: dur,
        coverage: coverage,
        expires: expFormatted
      });
    });

    return out;
  }

  /* Built purely from the stored sale. `reprint` = { number, at, by } when this is a duplicate copy. */
  function fromSale(sale, reprint) {
    const isCash = sale.paymentMethod === 'Cash';
    return {
      no: sale.id,
      date: sale.date, cashier: sale.staff, status: sale.status,
      items: (sale.items || []).map(function (i) { return { productId: i.productId, name: i.name, qty: i.qty, price: i.price, subtotal: i.subtotal }; }),
      subtotal: sale.subtotal != null ? sale.subtotal : sale.total,
      discount: sale.discount || 0,
      vat: { enabled: !!sale.vatEnabled && sale.vatAmount > 0, rate: sale.vatRate, mode: sale.vatMode, vatable: sale.vatableAmount, amount: sale.vatAmount },
      total: sale.total, method: sale.paymentMethod, reference: sale.reference,
      isCash: isCash,
      tendered: isCash ? (sale.amountReceived != null ? sale.amountReceived : sale.total) : null,
      change: isCash ? (sale.changeAmount != null ? sale.changeAmount : 0) : null,
      shop: sale.shop || null,
      warranties: sale.warranties || null,
      isPreview: false,
      reprint: reprint || null
    };
  }

  function print(d) {
    let area = document.getElementById('receiptPrintArea');
    if (!area) { area = document.createElement('div'); area.id = 'receiptPrintArea'; document.body.appendChild(area); }
    area.innerHTML = html(d);
    const pending = Array.prototype.filter.call(area.querySelectorAll('img'), function (img) { return !img.complete; });
    return Promise.all(pending.map(function (img) { return new Promise(function (resolve) { img.onload = img.onerror = resolve; }); })).then(function () {
      const cleanup = function () { area.innerHTML = ''; window.removeEventListener('afterprint', cleanup); };
      window.addEventListener('afterprint', cleanup);
      window.print();
    });
  }

  /* Server records the reprint BEFORE the dialog opens, so every duplicate is in the audit trail
     even if the person cancels the print dialog. */
  async function reprint(saleId, context) {
    const r = await Api.post('/sales/' + encodeURIComponent(saleId) + '/reprint', { context: context || 'sales-page' });
    await print(fromSale(r.sale, { number: r.reprintNumber, at: r.reprintedAt, by: r.reprintedBy }));
    return r;
  }

  return { html: html, fromSale: fromSale, print: print, reprint: reprint, peso: peso };
})();
