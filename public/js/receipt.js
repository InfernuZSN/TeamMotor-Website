/* ==========================================================================
   receipt.js — one receipt renderer for the whole app (POS preview, POS success screen, Sales page reprint)
   ----------------------------------------------------------------------
   Layout targets a 58 mm thermal roll (OC-58IIH, ~50 mm printable) (see "Receipt" + @media print in css/style.css).

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
      '<div class="rcpt-foot">' + (shop.receiptFooter || []).map(esc).join('<br>') + '</div>' +
      reprintFoot +
    '</div>';
  }

  /* Built purely from the stored sale. `reprint` = { number, at, by } when this is a duplicate copy. */
  function fromSale(sale, reprint) {
    const isCash = sale.paymentMethod === 'Cash';
    return {
      no: sale.id,
      date: sale.date, cashier: sale.staff, status: sale.status,
      items: (sale.items || []).map(function (i) { return { name: i.name, qty: i.qty, price: i.price, subtotal: i.subtotal }; }),
      subtotal: sale.subtotal != null ? sale.subtotal : sale.total,
      discount: sale.discount || 0,
      vat: { enabled: !!sale.vatEnabled && sale.vatAmount > 0, rate: sale.vatRate, mode: sale.vatMode, vatable: sale.vatableAmount, amount: sale.vatAmount },
      total: sale.total, method: sale.paymentMethod, reference: sale.reference,
      isCash: isCash,
      tendered: isCash ? (sale.amountReceived != null ? sale.amountReceived : sale.total) : null,
      change: isCash ? (sale.changeAmount != null ? sale.changeAmount : 0) : null,
      shop: sale.shop || null,
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
