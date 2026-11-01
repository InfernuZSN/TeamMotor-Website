/* settings.js — Shop details, VAT, expiry window (Admin only; PUT /api/settings is Admin-only on the server too). */
Boot.ready(function () {
  if (!initShell('settings')) return;
  if (!requireRole('Admin')) return;
  const $ = function (id) { return document.getElementById(id); };
  const lines = function (v) { return v.split('\n').map(function (x) { return x.trim(); }).filter(Boolean); };

  function fill(s) {
    $('sShopName').value = s.shopName || ''; $('sTagline').value = s.tagline || ''; $('sAddress').value = (s.addressLines || []).join('\n');
    $('sPhone').value = s.phone || ''; $('sTin').value = s.tin || ''; $('sFooter').value = (s.receiptFooter || []).join('\n');
    $('sVatEnabled').checked = !!s.vatEnabled; $('sVatRate').value = Math.round((s.vatRate || 0) * 10000) / 100; $('sVatMode').value = s.vatMode || 'inclusive';
    $('sExpiry').value = s.expiryWarningMonths || 3;
  }
  function read() {
    return {
      shopName: $('sShopName').value.trim(), tagline: $('sTagline').value.trim(), addressLines: lines($('sAddress').value), phone: $('sPhone').value.trim(),
      tin: $('sTin').value.trim(), receiptFooter: lines($('sFooter').value), vatEnabled: $('sVatEnabled').checked,
      vatRate: (parseFloat($('sVatRate').value) || 0) / 100, vatMode: $('sVatMode').value, expiryWarningMonths: parseInt($('sExpiry').value, 10) || 3
    };
  }
  function preview() {
    const s = read();
    const items = [{ name: 'Sample Brake Pad Set', qty: 1, price: 450, subtotal: 450 }, { name: 'Sample Engine Oil 1L', qty: 2, price: 275, subtotal: 550 }];
    const t = Utils.computeTotals(1000, 0, s);
    $('settingsPreview').innerHTML = Receipt.html({
      no: '0000', date: new Date(), cashier: 'Sample', items: items, subtotal: t.subtotal, discount: t.discount, total: t.total,
      vat: { enabled: t.vatEnabled, rate: t.vatRate, mode: t.vatMode, vatable: t.vatableAmount, amount: t.vatAmount },
      method: 'Cash', tendered: t.total, change: 0, isPreview: true, shop: { shopName: s.shopName, tagline: s.tagline, addressLines: s.addressLines, phone: s.phone, tin: s.tin, receiptFooter: s.receiptFooter }
    });
  }

  Boot.dom(function () {
    fill(Store.get('settings', {})); preview();
    $('settingsForm').addEventListener('input', preview);
    $('setSaveBtn').addEventListener('click', function () {
      const body = read();
      if (!body.shopName) { $('setError').textContent = 'Shop name is required.'; return; }
      if (body.vatRate < 0 || body.vatRate > 1) { $('setError').textContent = 'VAT rate must be between 0 and 100.'; return; }
      $('setError').textContent = '';
      Utils.withBusy($('setSaveBtn'), async function () {
        try { const s = await Api.put('/settings', body); Store.set('settings', s); fill(s); preview(); showToast('Settings saved. They apply to new sales.', 'ok'); }
        catch (err) { $('setError').textContent = err.message; showToast(err.message, 'danger'); }
      });
    });
  });
});
