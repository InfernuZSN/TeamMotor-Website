/* ==========================================================================
   inventory.js — powers inventory.html
   ========================================================================== */
Boot.ready(function () {
  if (!initShell('inventory')) return;
  const isAdmin = getSession().role === 'Admin';   // Staff don't see admin buttons; the server enforces it regardless
  const expiryMonths = function () { return (Store.get('settings', {}).expiryWarningMonths) || 3; };
  async function afterChange() {
    await Store.refresh();
    populateStaticSelects(); renderProductsTable(); renderHistoryTable(); renderSupplierList();
    const addBtn = document.getElementById('addProductBtn');
    if (addBtn) { addBtn.style.display = ''; addBtn.disabled = false; }
    if (window.Notifications) Notifications.render();
    renderSidebar('inventory');
  }
  let editingProductId = null;
  let compatSelections = [];
  let stockModalType = 'in';
  let showArchived = false;
  let pendingImage = '';   // resized data URL of the photo chosen in the Add/Edit form (saved on Save Product)

  function openModal(id) { document.getElementById(id).classList.add('open'); }
  function closeModal(id) { document.getElementById(id).classList.remove('open'); }

  function showConfirm(title, message, onConfirm) {
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMessage').textContent = message;
    const btn = document.getElementById('confirmActionBtn');
    const freshBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(freshBtn, btn);
    freshBtn.addEventListener('click', function () {
      closeModal('confirmOverlay');
      onConfirm();
    });
    openModal('confirmOverlay');
  }

  /* ---------- Static dropdown population ---------- */
  function populateStaticSelects() {
    const categories = Store.get('categories', []);
    const suppliers = Store.get('suppliers', []);
    const products = Store.get('products', []);

    const catOptions = categories.map(c => '<option value="' + c.id + '">' + c.name + '</option>').join('');
    const prevCat = document.getElementById('filterCategory').value;
    document.getElementById('filterCategory').innerHTML = '<option value="">All Categories</option>' + catOptions;
    document.getElementById('filterCategory').value = prevCat;
    document.getElementById('pCategory').innerHTML = catOptions;

    const supOptions = suppliers.map(s => '<option value="' + s.id + '">' + Utils.escapeHtml(s.name) + '</option>').join('');
    const prevSup = document.getElementById('filterSupplier').value;
    document.getElementById('pSupplier').innerHTML = supOptions;
    document.getElementById('sSupplier').innerHTML = supOptions;
    document.getElementById('filterSupplier').innerHTML = '<option value="">All Suppliers</option>' + supOptions;
    document.getElementById('filterSupplier').value = prevSup;

    const brands = Array.from(new Set(products.map(p => p.brand).filter(Boolean))).sort();
    const prevProdBrand = document.getElementById('filterProductBrand').value;
    document.getElementById('filterProductBrand').innerHTML = '<option value="">All Brands</option>' + brands.map(b => '<option value="' + Utils.escapeHtml(b) + '">' + Utils.escapeHtml(b) + '</option>').join('');
    document.getElementById('filterProductBrand').value = prevProdBrand;

    const brandOptions = Object.keys(MOTO_BRANDS).map(b => '<option value="' + b + '">' + b + '</option>').join('');
    const prevBrand = document.getElementById('filterBrand').value;
    document.getElementById('filterBrand').innerHTML = '<option value="">Any Brand</option>' + brandOptions;
    document.getElementById('filterBrand').value = prevBrand;

  }

  function populateCompatBrandSelect() {
    const brandSel = document.getElementById('pCompatBrand');
    brandSel.innerHTML = Object.keys(MOTO_BRANDS).map(b => '<option value="' + b + '">' + b + '</option>').join('');
    updateCompatModelOptions();
  }
  function updateCompatModelOptions() {
    const brand = document.getElementById('pCompatBrand').value;
    document.getElementById('pCompatModel').innerHTML = (MOTO_BRANDS[brand] || []).map(m => '<option value="' + m + '">' + m + '</option>').join('');
  }

  /* ---------- Products table ---------- */
  function compatSummary(compat) {
    if (compat.includes(UNIVERSAL_FIT)) return 'Universal';
    if (compat.length <= 2) return compat.join(', ');
    return compat[0] + ' +' + (compat.length - 1) + ' more';
  }
  function matchesBrandModel(product, brand, model) {
    if (!brand) return true;
    if (product.compatibility.includes(UNIVERSAL_FIT)) return true;
    if (model) return product.compatibility.includes(brand + ' ' + model);
    return product.compatibility.some(c => c.indexOf(brand + ' ') === 0);
  }
  function getFilteredProducts() {
    const products = Store.get('products', []);
    const q = document.getElementById('invSearch').value.trim().toLowerCase();
    const cat = document.getElementById('filterCategory').value;
    const status = document.getElementById('filterStatus').value;
    const brand = document.getElementById('filterBrand').value;
    const model = document.getElementById('filterModel').value;
    const prodBrand = document.getElementById('filterProductBrand').value;
    const supplier = document.getElementById('filterSupplier').value;
    const sortBy = document.getElementById('sortBy').value;

    let rows = products.filter(p => {
      if (!!p.archived !== showArchived) return false;
      if (q && p.name.toLowerCase().indexOf(q) === -1 && p.id.toLowerCase().indexOf(q) === -1 && (p.brand || '').toLowerCase().indexOf(q) === -1 && (p.sku || '').toLowerCase().indexOf(q) === -1 && (p.barcode || '').toLowerCase().indexOf(q) === -1) return false;
      if (cat && p.category !== cat) return false;
      if (status === 'Expiring Soon' || status === 'Expired') { if (Utils.expiryStatus(p, expiryMonths()) !== status) return false; }
      else if (status && Utils.getStockStatus(p.stock, p.reorderLevel) !== status) return false;
      if (prodBrand && p.brand !== prodBrand) return false;
      if (supplier && p.supplier !== supplier) return false;
      if (!matchesBrandModel(p, brand, model)) return false;
      return true;
    });

    const sorters = {
      'name-asc': (a, b) => a.name.localeCompare(b.name),
      'name-desc': (a, b) => b.name.localeCompare(a.name),
      'price-asc': (a, b) => a.sellingPrice - b.sellingPrice,
      'price-desc': (a, b) => b.sellingPrice - a.sellingPrice,
      'stock-asc': (a, b) => a.stock - b.stock,
      'stock-desc': (a, b) => b.stock - a.stock,
      'updated-desc': (a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated)
    };
    rows.sort(sorters[sortBy] || sorters['name-asc']);
    return rows;
  }
  const pgProducts = createPager(document.getElementById('invPager'), function () { renderProductsTable(); });
  const pgHistory = createPager(document.getElementById('histPager'), function () { renderHistoryTable(); });
  const filterSig = function (ids) { return ids.map(function (id) { return document.getElementById(id).value; }).join('|'); };

  function renderProductsTable() {
    const categories = Store.get('categories', []);
    const suppliers = Store.get('suppliers', []);
    const all = getFilteredProducts();
    const rows = pgProducts.slice(all, filterSig(['invSearch', 'filterCategory', 'filterStatus', 'filterBrand', 'filterModel', 'filterProductBrand', 'filterSupplier', 'sortBy']) + '|' + showArchived);
    const tbody = document.getElementById('productsTbody');
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="10"><div class="empty-state">' + icon('search') + '<h3>' + (showArchived ? 'No archived products' : 'No products match your filters') + '</h3><p>' + (showArchived ? 'Nothing has been archived yet.' : 'Try a different search or clear filters.') + '</p></div></td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(p => {
      const cat = categories.find(c => c.id === p.category);
      const sup = suppliers.find(s => s.id === p.supplier);
      const status = Utils.getStockStatus(p.stock, p.reorderLevel);
      const flagClass = status === 'Out of Stock' ? 'danger' : status === 'Low Stock' ? 'warn' : 'ok';
      const archivedRow = p.archived ? ' style="opacity:.6;"' : '';
      return '<tr class="row-status-bar"' + archivedRow + '>' +
        '<td><span class="stock-flag ' + flagClass + '"></span><div class="cell-product"><div class="cell-thumb thumb-' + p.category + '">' +
          '<svg viewBox="0 0 24 24" style="width:18px;height:18px;stroke-width:1.8;fill:none;">' + Utils.categoryIcon(p.category) + '</svg></div>' +
          '<div><div class="name" title="' + Utils.escapeHtml(p.name) + '">' + Utils.escapeHtml(p.name) + (p.archived ? ' <span class="badge badge-neutral">Archived</span>' : '') + '</div><div class="sub">' + p.id + '</div></div></div></td>' +
        '<td><span class="cell-trunc" title="' + Utils.escapeHtml(p.brand || '') + '">' + Utils.escapeHtml(p.brand || '\u2014') + '</span></td>' +
        '<td><span class="cell-trunc" title="' + Utils.escapeHtml(cat ? cat.name : p.category) + '">' + Utils.escapeHtml(cat ? cat.name : p.category) + '</span></td>' +
        '<td><span class="cell-clamp" title="' + Utils.escapeHtml((p.compatibility || []).join(', ')) + '">' + Utils.escapeHtml(compatSummary(p.compatibility || [])) + '</span></td>' +
        '<td><span class="cell-clamp" title="' + Utils.escapeHtml(sup ? sup.name : '') + '">' + (sup ? Utils.escapeHtml(sup.name) : '\u2014') + '</span></td>' +
        '<td class="text-right mono-num">' + Utils.formatPHP(p.sellingPrice) + '</td>' +
        '<td class="text-right mono-num">' + p.stock + '</td>' +
        '<td class="col-status"><span class="badge ' + Utils.statusClass(status) + '">' + status + '</span> ' + Utils.expiryBadge(p, expiryMonths()) + '</td>' +
        '<td class="text-muted" style="font-size:.78rem;">' + Utils.timeAgo(p.lastUpdated) + '</td>' +
        '<td class="col-actions"><div class="flex gap-8">' +
          '<button class="icon-btn" title="View" data-view="' + p.id + '">' + icon('eye') + '</button>' +
          (isAdmin ? '<button class="icon-btn" title="Edit" data-edit="' + p.id + '">' + icon('edit') + '</button>' : '') +
          (p.archived
            ? (isAdmin ? '<button class="icon-btn" title="Unarchive" data-unarchive="' + p.id + '">' + icon('refresh') + '</button>' : '')
            : '<button class="icon-btn" title="Stock In" data-stockin="' + p.id + '">' + icon('stockIn') + '</button>' +
              '<button class="icon-btn" title="Stock Out" data-stockout="' + p.id + '">' + icon('stockOut') + '</button>' +
              (isAdmin ? '<button class="icon-btn" title="Adjust stock (set counted quantity)" data-adjust="' + p.id + '">' + icon('checkCircle') + '</button>' +
              '<button class="icon-btn" title="Archive" data-archive="' + p.id + '">' + icon('archive') + '</button>' : '')) +
        '</div></td>' +
      '</tr>';
    }).join('');
  }

  /* ---------- History table ----------
     Every stock movement is shown with a plain reason: Sold (POS sale), Returned (voided / refunded sale put back on the shelf,
     or a Stock Out marked Returned), Damaged, Lost, Expired, Internal Use, Other (all chosen at Stock Out), Received (stock in)
     and Adjusted (manual count correction, with the typed reason in Reference / Notes). */
  function movementReason(t) {
    if (t.type === 'Sale') return { label: 'Sold', tone: 'badge-neutral' };
    if (t.type === 'Void Restock') return { label: 'Returned', tone: 'badge-info' };
    if (t.type === 'Stock In') return { label: 'Received', tone: 'badge-ok' };
    if (t.type === 'Adjustment') return { label: 'Adjusted', tone: 'badge-neutral' };
    const r = t.reason || 'Other';
    return { label: r, tone: r === 'Returned' ? 'badge-info' : (r === 'Damaged' || r === 'Lost' || r === 'Expired') ? 'badge-danger' : 'badge-warn' };
  }

  function renderHistoryTable() {
    const q = document.getElementById('histSearch').value.trim().toLowerCase();
    const type = document.getElementById('filterHistType').value;
    const reasonFilter = document.getElementById('filterHistReason').value;
    const transactions = Store.get('inventoryTransactions', []).slice().sort((a, b) => new Date(b.date) - new Date(a.date));
    const filtered = transactions.filter(t => {
      if (q && t.productName.toLowerCase().indexOf(q) === -1) return false;
      if (type && t.type !== type) return false;
      if (reasonFilter && movementReason(t).label !== reasonFilter) return false;
      return true;
    });
    const rows = pgHistory.slice(filtered, filterSig(['histSearch', 'filterHistType', 'filterHistReason']));
    const tbody = document.getElementById('historyTbody');
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="9"><div class="empty-state">' + icon('history') + '<h3>No history yet</h3></div></td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(t => {
      const qtyDisplay = (t.quantity > 0 ? '+' : '') + t.quantity;
      const typeTone = t.type === 'Stock In' ? 'badge-ok' : t.type === 'Sale' ? 'badge-neutral' : 'badge-danger';
      const why = movementReason(t);
      const refNotes = [t.reference, t.notes].filter(x => x && x !== why.label).join(' \u00B7 ') || '\u2014';
      return '<tr>' +
        '<td class="text-muted">' + Utils.formatDateTime(t.date) + '</td>' +
        '<td style="font-weight:600;color:var(--ink);"><span class="cell-clamp" title="' + Utils.escapeHtml(t.productName) + '">' + Utils.escapeHtml(t.productName) + '</span></td>' +
        '<td><span class="badge ' + typeTone + '">' + t.type + '</span></td>' +
        '<td class="text-right mono-num" style="font-weight:700;color:' + (t.quantity < 0 ? 'var(--danger)' : 'var(--ok)') + ';">' + qtyDisplay + '</td>' +
        '<td class="text-right mono-num text-muted">' + t.previousStock + '</td>' +
        '<td class="text-right mono-num" style="font-weight:700;">' + t.newStock + '</td>' +
        '<td><span class="badge ' + why.tone + '">' + Utils.escapeHtml(why.label) + '</span></td>' +
        '<td class="text-muted"><span class="cell-clamp" title="' + Utils.escapeHtml(refNotes) + '">' + Utils.escapeHtml(refNotes) + '</span></td>' +
        '<td><span class="cell-trunc" title="' + Utils.escapeHtml(t.user) + '">' + Utils.escapeHtml(t.user) + '</span></td>' +
      '</tr>';
    }).join('');
  }

  /* ---------- Compatibility chip builder ---------- */
  function renderCompatChips() {
    const wrap = document.getElementById('compatChips');
    wrap.innerHTML = compatSelections.length
      ? compatSelections.map((c, i) => '<span class="chip active" data-remove-compat="' + i + '" style="cursor:pointer;">' + Utils.escapeHtml(c) + ' &times;</span>').join('')
      : '<span class="hint" style="margin:0;">No specific models added yet.</span>';
  }

  /* ---------- Image preview ---------- */
  function updateImagePreviewFallback() {
    const saved = editingProductId ? Utils.productImage(Store.get('products', []).find(p => p.id === editingProductId)) : '';
    if (pendingImage || saved) {
      document.getElementById('imagePreview').innerHTML = '<img src="' + (pendingImage || saved) + '" alt="">';
      document.getElementById('imageDropLabel').textContent = pendingImage ? document.getElementById('pImageFile').files[0].name : 'Click to change image';
      return;
    }
    const cat = document.getElementById('pCategory').value;
    document.getElementById('imagePreview').innerHTML = '<svg viewBox="0 0 24 24" style="width:26px;height:26px;stroke:var(--steel);stroke-width:1.7;fill:none;">' + Utils.categoryIcon(cat) + '</svg>';
    document.getElementById('imageDropLabel').textContent = 'Click to choose an image';
  }

  /* Shrinks the chosen photo (max 360 px, JPEG) so many product photos fit in the browser's ~5 MB of storage. */
  function resizeImage(file, done) {
    const reader = new FileReader();
    reader.onload = function (ev) {
      const img = new Image();
      img.onload = function () {
        const scale = Math.min(1, 360 / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';   // JPEG has no transparency
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        done(canvas.toDataURL('image/jpeg', 0.75));
      };
      img.onerror = function () { showToast('That file could not be read as an image.', 'danger'); };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }

  /* ---------- Add / Edit product modal ---------- */
  function updateIdPreview() {
    const categories = Store.get('categories', []);
    const cat = categories.find(c => c.id === document.getElementById('pCategory').value);
    const products = Store.get('products', []);
    document.getElementById('idPreviewValue').textContent = cat ? Utils.nextId(cat.prefix, products.map(p => p.id), 3) : '\u2014';
  }

  /* Warranty (optional): the checkbox reveals the period + coverage fields. They stay disabled
     (and the period stays non-required) while the box is unticked, so validateForm ignores them. */
  function syncWarrantyFields() {
    const on = document.getElementById('pHasWarranty').checked;
    document.getElementById('warrantyFields').style.display = on ? '' : 'none';
    ['pWarrantyDuration', 'pWarrantyUnit', 'pWarrantyCoverage'].forEach(function (id) {
      document.getElementById(id).disabled = !on;
    });
    document.getElementById('pWarrantyDuration').required = on;
  }

  function warrantyLabel(p) {
    const n = p.warrantyDuration || p.warrantyDays;   // warrantyDays: older records only stored days
    if (!n) return 'No warranty';
    const unit = p.warrantyDuration ? (p.warrantyUnit || 'months') : 'days';
    return n + ' ' + (n === 1 ? unit.replace(/s$/, '') : unit) + (p.warrantyType ? ' \u2014 ' + p.warrantyType : '');
  }

  function openProductModal(mode, productId) {
    editingProductId = mode === 'edit' ? productId : null;
    const products = Store.get('products', []);
    const product = productId ? products.find(p => p.id === productId) : null;

    document.getElementById('productModalTitle').textContent = mode === 'edit' ? 'Edit Product' : 'Add Product';
    document.getElementById('productForm').reset();
    document.querySelectorAll('#productForm .field.has-error').forEach(f => { f.classList.remove('has-error'); const m = f.querySelector('.field-error-msg'); if (m) m.remove(); });
    compatSelections = [];
    document.getElementById('pImageFile').value = '';
    pendingImage = '';

    const stockInput = document.getElementById('pStock');
    const stockHint = document.getElementById('stockEditHint');

    if (mode === 'edit' && product) {
      document.getElementById('pName').value = product.name;
      document.getElementById('pBrand').value = product.brand || '';
      if (document.getElementById('pSku')) document.getElementById('pSku').value = product.sku || ('TM-' + product.id);
      if (document.getElementById('pBarcode')) document.getElementById('pBarcode').value = product.barcode || '';
      document.getElementById('pCategory').value = product.category;
      document.getElementById('pSupplier').value = product.supplier;
      document.getElementById('pSupplierRef').value = product.supplierRef || '';
      document.getElementById('pCompatYears').value = product.compatYears || '';
      stockInput.value = product.stock;
      stockInput.disabled = true;
      stockHint.style.display = 'block';
      document.getElementById('pCost').value = product.costPrice;
      document.getElementById('pPrice').value = product.sellingPrice;
      document.getElementById('pReorder').value = product.reorderLevel;
      document.getElementById('pDescription').value = product.description || '';
      document.getElementById('pExpiry').value = product.expirationDate ? String(product.expirationDate).slice(0, 10) : '';
      document.getElementById('pStorageLocation').value = product.storageLocation || '';
      const warrantyN = product.warrantyDuration || product.warrantyDays;
      if (warrantyN) {
        document.getElementById('pHasWarranty').checked = true;
        document.getElementById('pWarrantyDuration').value = warrantyN;
        document.getElementById('pWarrantyUnit').value = product.warrantyDuration ? (product.warrantyUnit || 'months') : 'days';
        document.getElementById('pWarrantyCoverage').value = product.warrantyType || '';
      }
      document.getElementById('idPreviewValue').textContent = product.id;
      if (product.compatibility.includes(UNIVERSAL_FIT)) {
        document.getElementById('pUniversal').checked = true;
      } else {
        compatSelections = product.compatibility.slice();
        document.getElementById('pUniversal').checked = false;
      }
    } else {
      stockInput.disabled = false;
      stockInput.value = 0;
      stockHint.style.display = 'none';
      document.getElementById('pStorageLocation').value = '';
      if (document.getElementById('pSku')) document.getElementById('pSku').value = '';
      if (document.getElementById('pBarcode')) document.getElementById('pBarcode').value = '';
      document.getElementById('pUniversal').checked = true;   // most parts are universal; untick to pick specific models
      document.getElementById('pCompatYears').value = 'All Years';
      updateIdPreview();
    }
    document.getElementById('pUniversal').dispatchEvent(new Event('change'));
    syncWarrantyFields();
    renderCompatChips();
    updateImagePreviewFallback();
    openModal('productModalOverlay');
  }

  async function saveProduct() {
    const form = document.getElementById('productForm');
    if (!validateForm(form)) return;
    const isUniversal = document.getElementById('pUniversal').checked;
    const compatibility = isUniversal || !compatSelections.length ? [UNIVERSAL_FIT] : compatSelections.slice();   // no models picked = universal
    const categoryId = document.getElementById('pCategory').value;
    const hasWarranty = document.getElementById('pHasWarranty').checked;
    const warrantyDuration = hasWarranty ? (parseInt(document.getElementById('pWarrantyDuration').value, 10) || null) : null;
    const warrantyUnit = hasWarranty ? document.getElementById('pWarrantyUnit').value : null;
    const payload = {
      name: document.getElementById('pName').value.trim(),
      brand: document.getElementById('pBrand').value.trim(),
      sku: document.getElementById('pSku') ? document.getElementById('pSku').value.trim() : '',
      barcode: document.getElementById('pBarcode') ? document.getElementById('pBarcode').value.trim() : '',
      category: categoryId,
      supplier: document.getElementById('pSupplier').value,
      supplierRef: document.getElementById('pSupplierRef').value.trim(),
      description: document.getElementById('pDescription').value.trim(),
      costPrice: parseFloat(document.getElementById('pCost').value) || 0,
      sellingPrice: parseFloat(document.getElementById('pPrice').value) || 0,
      reorderLevel: parseInt(document.getElementById('pReorder').value, 10) || 0,
      expirationDate: document.getElementById('pExpiry').value || null,     // optional
      storageLocation: document.getElementById('pStorageLocation').value.trim() || '',
      warrantyDuration: warrantyDuration,
      warrantyUnit: warrantyDuration ? warrantyUnit : null,
      warrantyType: warrantyDuration ? (document.getElementById('pWarrantyCoverage').value.trim() || null) : null,
      /* warrantyDays is the older day-count field; keep it in step (months = 30 days, years = 365) */
      warrantyDays: warrantyDuration ? warrantyDuration * ({ days: 1, months: 30, years: 365 }[warrantyUnit] || 1) : null,
      compatibility: compatibility,
      compatYears: document.getElementById('pCompatYears').value.trim() || 'All Years',
      image: pendingImage || Utils.productImage(Store.get('products', []).find(p => p.id === editingProductId)) || categoryId
    };
    await Utils.withBusy(document.getElementById('saveProductBtn'), async function () {
      try {
        if (editingProductId) {
          await Api.put('/products/' + encodeURIComponent(editingProductId), payload);
          showToast('Updated ' + payload.name + '.', 'ok');
        } else {
          payload.stock = parseInt(document.getElementById('pStock').value, 10) || 0;   // opening stock (recorded as a Stock In transaction)
          const created = await Api.post('/products', payload);
          showToast('Added ' + created.name + ' (' + created.id + ').', 'ok');
        }
        closeModal('productModalOverlay');
        await afterChange();
      } catch (err) { showToast(err.message, 'danger'); }
    });
  }

  /* ---------- View modal ---------- */
  function viewField(label, value) {
    return '<div><div class="hint" style="margin:0 0 3px;text-transform:uppercase;letter-spacing:.04em;font-weight:700;">' + label + '</div><div style="font-weight:600;color:var(--ink);font-size:.9rem;">' + value + '</div></div>';
  }
  /* ---------- Product View: Sales + Activity tabs (10 rows per page, independent page state; both reset to page 1 each time a product is opened) ---------- */
  let viewSalesRows = [], viewActRows = [];
  const pgVSales = createPager(document.getElementById('vSalesPager'), function () { renderViewSales(); }, { size: 10, sizes: false });
  const pgVAct = createPager(document.getElementById('vActPager'), function () { renderViewActivity(); }, { size: 10, sizes: false });
  function renderViewSales() {
    const rows = pgVSales.slice(viewSalesRows);
    document.getElementById('vSalesList').innerHTML = rows.length
      ? '<div class="table-wrap vt-scroll"><table class="vt-table"><thead><tr><th>Date</th><th class="text-right">Qty</th><th class="text-right">Amount</th></tr></thead><tbody>' +
        rows.map(function (r) {
          return '<tr><td class="text-muted">' + Utils.formatDate(r.date) + '</td><td class="text-right mono-num">' + r.qty + '</td><td class="text-right mono-num">' + Utils.formatPHP(r.subtotal) + '</td></tr>';
        }).join('') + '</tbody></table></div>'
      : '<div class="empty-state">' + icon('sales') + '<h3>No sales yet</h3></div>';
  }
  function renderViewActivity() {
    const rows = pgVAct.slice(viewActRows);
    document.getElementById('vActList').innerHTML = rows.length
      ? '<div class="table-wrap vt-scroll"><table class="vt-table vt-activity"><thead><tr><th>Date</th><th>Reason</th><th>Type</th><th class="text-right">Qty</th><th>Notes</th><th>Staff</th></tr></thead><tbody>' +
        rows.map(function (t) {
          const typeTone = t.type === 'Stock In' ? 'badge-ok' : t.type === 'Sale' ? 'badge-neutral' : 'badge-danger';
          const why = movementReason(t);
          const note = [t.reference, t.notes].filter(function (x) { return x && x !== why.label; }).join(' \u00B7 ') || '\u2014';
          return '<tr><td class="text-muted">' + Utils.formatDateTime(t.date) + '</td>' +
            '<td><span class="badge ' + why.tone + '">' + Utils.escapeHtml(why.label) + '</span></td>' +
            '<td><span class="badge ' + typeTone + '">' + Utils.escapeHtml(t.type) + '</span></td>' +
            '<td class="text-right mono-num" style="font-weight:700;color:' + (t.quantity < 0 ? 'var(--danger)' : 'var(--ok)') + ';">' + (t.quantity > 0 ? '+' : '') + t.quantity + '</td>' +
            '<td class="text-muted" style="font-size:.8rem;"><span class="cell-clamp" title="' + Utils.escapeHtml(note) + '">' + Utils.escapeHtml(note) + '</span></td>' +
            '<td><span class="cell-trunc" title="' + Utils.escapeHtml(t.user) + '">' + Utils.escapeHtml(t.user) + '</span></td></tr>';
        }).join('') + '</tbody></table></div>'
      : '<div class="empty-state">' + icon('history') + '<h3>No activity yet</h3></div>';
  }

  function openViewModal(productId) {
    const products = Store.get('products', []);
    const categories = Store.get('categories', []);
    const suppliers = Store.get('suppliers', []);
    const sales = Store.get('sales', []);
    const transactions = Store.get('inventoryTransactions', []);
    const p = products.find(x => x.id === productId);
    if (!p) return;
    const cat = categories.find(c => c.id === p.category);
    const sup = suppliers.find(s => s.id === p.supplier);
    const status = Utils.getStockStatus(p.stock, p.reorderLevel);
    const compat = p.compatibility.includes(UNIVERSAL_FIT) ? 'Universal (All Models)' : p.compatibility.join(', ');

    document.getElementById('viewModalHead').innerHTML =
      '<div class="flex gap-12">' +
        (Utils.productImage(p)
          ? '<img src="' + Utils.productImage(p) + '" alt="' + Utils.escapeHtml(p.name) + '" style="width:96px;height:96px;object-fit:cover;border-radius:var(--radius-sm);border:1px solid var(--border);flex-shrink:0;">'
          : '<div class="cell-thumb thumb-' + p.category + '" style="width:60px;height:60px;flex-shrink:0;">' +
            '<svg viewBox="0 0 24 24" style="width:28px;height:28px;stroke-width:1.6;fill:none;">' + Utils.categoryIcon(p.category) + '</svg></div>') +
        '<div><h2 style="margin-bottom:2px;">' + Utils.escapeHtml(p.name) + '</h2>' +
        '<div class="text-muted" style="font-size:.85rem;">' + p.id + ' &middot; ' + Utils.escapeHtml(p.brand || '') + ' &middot; ' + (cat ? cat.name : '') + '</div>' +
        '<span class="badge ' + Utils.statusClass(status) + '" style="margin-top:6px;">' + status + '</span>' +
        (p.archived ? ' <span class="badge badge-neutral">Archived</span>' : '') + '</div>' +
      '</div>';

    const pIdx = products.findIndex(x => x.id === p.id);
    const skuDisplay = p.sku || ('TM-' + p.id);
    const barcodeDisplay = p.barcode || ('4801234567' + String(pIdx >= 0 ? pIdx + 1 : 1).padStart(2, '0'));
    document.getElementById('vtab-overview').innerHTML =
      '<p style="color:var(--steel);font-size:.88rem;">' + Utils.escapeHtml(p.description || 'No description yet.') + '</p>' +
      '<div class="form-grid" style="margin-top:6px;">' +
        viewField('Selling Price', Utils.formatPHP(p.sellingPrice)) +
        viewField('Cost Price', Utils.formatPHP(p.costPrice)) +
        viewField('SKU', Utils.escapeHtml(skuDisplay)) +
        viewField('Barcode', Utils.escapeHtml(barcodeDisplay)) +
        viewField('Compatibility', compat) +
        viewField('Model Year', Utils.escapeHtml(p.compatYears || 'All Years')) +
        viewField('Warranty', Utils.escapeHtml(warrantyLabel(p))) +
        (p.category === 'motorcycles' ? viewField('Engine Type', Utils.escapeHtml(p.engineType || '\u2014')) : '') +
        (p.category === 'motorcycles' ? viewField('Displacement / Color', Utils.escapeHtml((p.displacement || '') + (p.color ? ' \u2014 ' + p.color : ''))) : '') +
      '</div>';

    document.getElementById('vtab-inventory').innerHTML =
      '<div class="form-grid">' +
        viewField('Current Stock', p.stock + ' units') +
        viewField('Reorder Level', p.reorderLevel + ' units') +
        viewField('Storage Location', Utils.escapeHtml(p.storageLocation || 'Not assigned')) +
        viewField('Status', status) +
        viewField('Last Updated', Utils.formatDateTime(p.lastUpdated)) +
      '</div>';

    viewSalesRows = [];
    sales.forEach(function (s) {
      s.items.forEach(function (i) { if (i.productId === p.id) viewSalesRows.push({ date: s.date, qty: i.qty, subtotal: i.subtotal }); });
    });
    viewSalesRows.sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
    const unitsSold = viewSalesRows.reduce(function (s, r) { return s + r.qty; }, 0);
    const revenue = viewSalesRows.reduce(function (s, r) { return s + r.subtotal; }, 0);
    document.getElementById('vSalesSummary').innerHTML =
      '<div class="form-grid" style="margin-bottom:14px;">' +
        viewField('Total Units Sold', String(unitsSold)) +
        viewField('Total Revenue', Utils.formatPHP(revenue)) +
      '</div>';
    pgVSales.reset(); renderViewSales();

    document.getElementById('vtab-supplier').innerHTML = sup
      ? '<div class="form-grid">' +
          viewField('Supplier', Utils.escapeHtml(sup.name)) +
          viewField('Contact', Utils.escapeHtml(sup.contactPerson) + ' \u2014 ' + Utils.escapeHtml(sup.contactNumber)) +
          viewField('Supplier Reference', Utils.escapeHtml(p.supplierRef || '\u2014')) +
          viewField('Last Delivery', sup.lastDelivery ? Utils.formatDate(sup.lastDelivery) : '\u2014') +
        '</div>'
      : '<div class="empty-state">' + icon('suppliers') + '<h3>No supplier on file</h3></div>';

    viewActRows = transactions.filter(function (t) { return t.productId === p.id; }).sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
    pgVAct.reset(); renderViewActivity();

    document.querySelectorAll('#viewTabs .tab-btn').forEach(function (b) { b.classList.remove('active'); });
    document.querySelector('#viewTabs .tab-btn[data-tab="overview"]').classList.add('active');
    document.querySelectorAll('#viewModalOverlay .tab-panel').forEach(function (tp) { tp.classList.remove('active'); });
    document.getElementById('vtab-overview').classList.add('active');

    document.getElementById('viewToEditBtn').dataset.productId = p.id;
    openModal('viewModalOverlay');
  }

  /* ---------- Stock In / Out modal ---------- */
  function updateStockHint() {
    const products = Store.get('products', []);
    const p = products.find(x => x.id === document.getElementById('sProduct').value);
    document.getElementById('currentStockHint').textContent = p ? ('Current stock: ' + p.stock + ' units') : '';
    if (stockModalType === 'in' && p) {
      document.getElementById('sCostPrice').value = (p.costPrice !== undefined && p.costPrice !== null) ? p.costPrice : '';
      document.getElementById('sExpirationDate').value = p.expirationDate ? String(p.expirationDate).slice(0, 10) : '';
      document.getElementById('sStorageLocation').value = p.storageLocation || '';
    }
  }
  function openStockModal(type, productId) {
    stockModalType = type;
    document.getElementById('stockForm').reset();
    document.querySelectorAll('#stockForm .field.has-error').forEach(f => { f.classList.remove('has-error'); const m = f.querySelector('.field-error-msg'); if (m) m.remove(); });
    document.getElementById('stockModalTitle').textContent = type === 'in' ? 'Stock In' : 'Stock Out';
    document.getElementById('sSupplierField').style.display = type === 'in' ? 'block' : 'none';
    document.getElementById('sReferenceField').style.display = type === 'in' ? 'block' : 'none';
    const extraFields = document.getElementById('stockInExtraFields');
    if (extraFields) extraFields.style.display = type === 'in' ? 'block' : 'none';
    document.getElementById('sReasonField').style.display = type === 'out' ? 'block' : 'none';
    const saveBtn = document.getElementById('saveStockBtn');
    saveBtn.className = 'btn ' + (type === 'in' ? 'btn-primary' : 'btn-danger');
    saveBtn.textContent = type === 'in' ? 'Confirm Stock In' : 'Confirm Stock Out';
    // The product is the inventory row the user clicked; it cannot be switched inside the modal.
    const sp = Store.get('products', []).find(x => x.id === productId);
    document.getElementById('sProduct').value = sp ? sp.id : '';
    document.getElementById('sProductLabel').textContent = sp ? sp.name + ' (' + sp.id + ')' : '\u2014';
    updateStockHint();
    document.getElementById('sDate').value = Analytics.dateKey(Utils.demoNow().toISOString());
    openModal('stockModalOverlay');
  }
  async function saveStock() {
    const form = document.getElementById('stockForm');
    if (!validateForm(form)) return;
    const productId = document.getElementById('sProduct').value;
    if (!productId || !Store.get('products', []).some(x => x.id === productId)) { showToast('This product could not be found. Close the window and pick the product from the list again.', 'danger'); return; }
    const qty = parseInt(document.getElementById('sQty').value, 10);
    if (isNaN(qty) || qty < 1) { showToast('Quantity must be a positive whole number (at least 1).', 'danger'); return; }
    if (stockModalType === 'out' && !document.getElementById('sReason').value) { showToast('Please specify a reason for Stock Out.', 'danger'); return; }
    const body = { productId: productId, quantity: qty, date: document.getElementById('sDate').value || undefined, notes: document.getElementById('sNotes').value.trim() };
    if (stockModalType === 'in') {
      body.supplierId = document.getElementById('sSupplier').value || undefined;
      body.reference = document.getElementById('sReference').value.trim() || undefined;
      const cp = document.getElementById('sCostPrice').value;
      if (cp !== '') body.costPrice = Number(cp);
      const exp = document.getElementById('sExpirationDate').value;
      if (exp) body.expirationDate = exp;
      const loc = document.getElementById('sStorageLocation').value.trim();
      if (loc) body.storageLocation = loc;
    }
    else body.reason = document.getElementById('sReason').value;
    await Utils.withBusy(document.getElementById('saveStockBtn'), async function () {
      try {
        const r = await Api.post(stockModalType === 'in' ? '/inventory/stock-in' : '/inventory/stock-out', body);
        closeModal('stockModalOverlay');
        await afterChange();
        showToast((stockModalType === 'in' ? 'Stocked in ' : 'Stocked out ') + qty + ' units of ' + r.product.name + '. (' + r.transaction.previousStock + ' \u2192 ' + r.transaction.newStock + ')', 'ok');
      } catch (err) { showToast(err.message, 'danger'); }    // e.g. someone sold the stock a moment ago
    });
  }

  /* ---------- Authorized stock adjustment (Admin) ---------- */
  function openAdjustModal(productId) {
    const p = Store.get('products', []).find(x => x.id === productId);
    if (!p) return;
    document.getElementById('adjProductId').value = p.id;
    document.getElementById('adjProductName').textContent = p.name + ' (' + p.id + ') \u2014 system stock: ' + p.stock;
    document.getElementById('adjQty').value = p.stock;
    document.getElementById('adjReason').value = '';
    document.getElementById('adjError').textContent = '';
    openModal('adjustModalOverlay');
  }
  async function saveAdjustment() {
    const reason = document.getElementById('adjReason').value.trim();
    const newQuantity = parseInt(document.getElementById('adjQty').value, 10);
    if (isNaN(newQuantity) || newQuantity < 0) { document.getElementById('adjError').textContent = 'Enter the counted quantity (0 or more).'; return; }
    if (reason.length < 3) { document.getElementById('adjError').textContent = 'A reason is required.'; return; }
    await Utils.withBusy(document.getElementById('adjSaveBtn'), async function () {
      try {
        const r = await Api.post('/inventory/adjust', { productId: document.getElementById('adjProductId').value, newQuantity: newQuantity, reason: reason });
        closeModal('adjustModalOverlay');
        await afterChange();
        showToast('Stock adjusted: ' + r.transaction.previousStock + ' \u2192 ' + r.transaction.newStock + '. Logged in history and audit trail.', 'ok');
      } catch (err) { document.getElementById('adjError').textContent = err.message; }
    });
  }

  /* ---------- CSV Export (MIG-03) ---------- */
  function exportInventoryCSV() {
    const products = Store.get('products', []);
    const categories = Store.get('categories', []);
    const suppliers = Store.get('suppliers', []);
    const headers = ['Product ID', 'Name', 'Brand', 'Category', 'Compatibility', 'Supplier', 'Cost Price', 'Selling Price', 'Current Stock', 'Reorder Level', 'Status', 'Archived', 'Expiration Date', 'Last Updated'];
    const rows = products.map(p => {
      const cat = categories.find(c => c.id === p.category);
      const sup = suppliers.find(s => s.id === p.supplier);
      const status = Utils.getStockStatus(p.stock, p.reorderLevel);
      return [
        p.id,
        p.name,
        p.brand || '',
        cat ? cat.name : p.category,
        (p.compatibility || []).join('; '),
        sup ? sup.name : '',
        p.costPrice,
        p.sellingPrice,
        p.stock,
        p.reorderLevel,
        status,
        p.archived ? 'Yes' : 'No',
        p.expirationDate || '',
        p.lastUpdated || ''
      ];
    });
    Utils.exportToCSV('teammotor-inventory.csv', headers, rows);
    showToast('Inventory list exported to CSV.', 'ok');
  }

  /* ---------- Archive / Unarchive ---------- */
  function archiveProduct(productId) {
    const product = Store.get('products', []).find(p => p.id === productId);
    if (!product) return;
    showConfirm('Archive ' + product.name + '?', 'Archived products are hidden from POS, the storefront, and default reports, but their history is kept. You can unarchive anytime.', async function () {
      try { await Api.post('/products/' + encodeURIComponent(productId) + '/archive', { archived: true }); await afterChange(); showToast(product.name + ' archived.', 'ok'); }
      catch (err) { showToast(err.message, 'danger'); }
    });
  }
  async function unarchiveProduct(productId) {
    const product = Store.get('products', []).find(p => p.id === productId);
    if (!product) return;
    try { await Api.post('/products/' + encodeURIComponent(productId) + '/archive', { archived: false }); await afterChange(); showToast(product.name + ' unarchived.', 'ok'); }
    catch (err) { showToast(err.message, 'danger'); }
  }

  /* ---------- Category management ---------- */
  function renderCategoryList() {
    const categories = Store.get('categories', []);
    const products = Store.get('products', []);
    document.getElementById('categoryList').innerHTML = categories.map(c => {
      const count = products.filter(p => p.category === c.id && !p.archived).length;
      const inUse = products.some(p => p.category === c.id);
      const isInactive = c.status === 'Inactive';
      return '<div class="flex items-center justify-between" style="padding:10px 0;border-bottom:1px solid var(--border);">' +
        '<div><div style="font-weight:600;color:var(--ink);font-size:.88rem;display:flex;align-items:center;gap:6px;">' +
          Utils.escapeHtml(c.name) +
          '<span class="badge ' + (isInactive ? 'badge-danger' : 'badge-ok') + '" style="font-size:0.7rem;padding:2px 6px;">' + (isInactive ? 'Inactive' : 'Active') + '</span>' +
        '</div>' +
        '<div class="hint" style="margin:2px 0 0;">Prefix: ' + c.prefix + ' &bull; ' + count + ' product' + (count === 1 ? '' : 's') + '</div></div>' +
        '<div class="flex items-center gap-8">' +
          '<button type="button" class="btn btn-secondary btn-sm" data-edit-category="' + c.id + '" title="Edit category name">Rename</button>' +
          '<button type="button" class="btn btn-secondary btn-sm" data-toggle-category="' + c.id + '" title="' + (isInactive ? 'Activate' : 'Deactivate') + ' category">' + (isInactive ? 'Activate' : 'Deactivate') + '</button>' +
          '<button type="button" class="icon-btn" data-delete-category="' + c.id + '" aria-label="Delete category ' + Utils.escapeHtml(c.name) + '"' +
            (inUse ? ' title="In use \u2014 move its products to another category first" style="opacity:.45;"' : ' title="Delete category"') + '>' +
            '<svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  async function editCategory(categoryId) {
    const cat = Store.get('categories', []).find(c => c.id === categoryId);
    if (!cat) return;
    const newName = prompt('Enter new category name:', cat.name);
    if (newName === null) return;
    const trimmed = newName.trim();
    if (!trimmed) { showToast('Category name cannot be empty.', 'danger'); return; }
    try {
      await Api.put('/categories/' + encodeURIComponent(categoryId), { name: trimmed });
      await afterChange(); renderCategoryList();
      showToast('Renamed category to "' + trimmed + '".', 'ok');
    } catch (err) { showToast(err.message, 'danger'); }
  }

  async function toggleCategoryStatus(categoryId) {
    const cat = Store.get('categories', []).find(c => c.id === categoryId);
    if (!cat) return;
    const newStatus = cat.status === 'Inactive' ? 'Active' : 'Inactive';
    try {
      await Api.put('/categories/' + encodeURIComponent(categoryId), { status: newStatus });
      await afterChange(); renderCategoryList();
      showToast((newStatus === 'Active' ? 'Activated' : 'Deactivated') + ' category "' + cat.name + '".', 'ok');
    } catch (err) { showToast(err.message, 'danger'); }
  }

  /* Delete a category. Only allowed while no product (archived ones included) still uses it, so a product is
     never left pointing at a category that no longer exists. */
  function deleteCategory(categoryId) {
    const cat = Store.get('categories', []).find(c => c.id === categoryId);
    if (!cat) return;
    const used = Store.get('products', []).filter(p => p.category === categoryId).length;
    if (used) {
      showToast('"' + cat.name + '" still has ' + used + ' product' + (used === 1 ? '' : 's') + ' (archived ones count too). Move them to another category first (Edit product \u2192 Category).', 'danger');
      return;
    }
    showConfirm('Delete the "' + cat.name + '" category?', 'It has no products. This removes it from Inventory and POS. You can add it again later.', async function () {
      try {
        await Api.del('/categories/' + encodeURIComponent(categoryId));
        await afterChange(); renderCategoryList();
        showToast('Deleted category "' + cat.name + '".', 'ok');
      } catch (err) { showToast(err.message, 'danger'); }
    });
  }
  function derivePrefix(name, existingPrefixes) {
    const base = (name.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 3)) || 'GEN';
    let candidate = base, n = 1;
    while (existingPrefixes.indexOf(candidate) !== -1) { n++; candidate = base.slice(0, 2) + n; }
    return candidate;
  }

  /* ---------- Wiring ---------- */
  /* ---------- Suppliers (merged in from the old Suppliers page; Admin only) ---------- */
  let editingSupplierId = null;
  function productsSuppliedBy(supplierId) { return Store.get('products', []).filter(p => p.supplier === supplierId); }
  const pgSup = createPager(document.getElementById('supPager'), function () { renderSupplierList(); }, { size: 10, sizes: false });
  function renderSupplierList() {
    const badge = document.getElementById('supplierCountBadge');
    const all = Store.get('suppliers', []);
    if (badge) badge.textContent = all.length;
    const tbody = document.getElementById('suppliersTbody');
    if (!tbody) return;
    const q = document.getElementById('supSearch').value.trim().toLowerCase();
    const suppliers = all.filter(s => !q || [s.name, s.contactPerson, s.contactNumber, s.email].some(f => f && String(f).toLowerCase().indexOf(q) !== -1));
    const pageRows = pgSup.slice(suppliers, q);
    if (!suppliers.length) {
      tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state">' + icon('suppliers') + '<h3>No suppliers found</h3></div></td></tr>';
      return;
    }
    tbody.innerHTML = pageRows.map(s => {
      const count = productsSuppliedBy(s.id).length;
      const contact = [s.contactPerson, s.contactNumber].filter(Boolean).join(' \u00B7 ');
      return '<tr>' +
        '<td><div class="cell-trunc" style="font-weight:600;color:var(--ink);" title="' + Utils.escapeHtml(s.name) + '">' + Utils.escapeHtml(s.name) + '</div>' +
          '<div class="cell-trunc text-muted" style="font-size:.78rem;" title="' + Utils.escapeHtml(contact) + '">' + Utils.escapeHtml(contact) + '</div></td>' +
        '<td><span class="cell-trunc" title="' + Utils.escapeHtml(s.email || '') + '">' + Utils.escapeHtml(s.email || '\u2014') + '</span></td>' +
        '<td>' + count + ' product' + (count === 1 ? '' : 's') + '</td>' +
        '<td class="text-muted">' + (s.lastDelivery ? Utils.formatDate(s.lastDelivery) : '\u2014') + '</td>' +
        '<td><span class="badge ' + (s.status === 'Active' ? 'badge-ok' : 'badge-neutral') + '">' + s.status + '</span></td>' +
        '<td><div class="flex gap-8">' +
          '<button class="icon-btn" title="View" data-sup-view="' + s.id + '">' + icon('eye') + '</button>' +
          '<button class="icon-btn" title="Edit" data-sup-edit="' + s.id + '">' + icon('edit') + '</button>' +
        '</div></td></tr>';
    }).join('');
  }
  function openSupplierModal(mode, supplierId) {
    editingSupplierId = mode === 'edit' ? supplierId : null;
    document.getElementById('supplierForm').reset();
    document.getElementById('supplierModalTitle').textContent = mode === 'edit' ? 'Edit Supplier' : 'Add Supplier';
    if (mode === 'edit') {
      const s = Store.get('suppliers', []).find(x => x.id === supplierId);
      if (!s) return;
      document.getElementById('supName').value = s.name;
      document.getElementById('supContact').value = s.contactPerson;
      document.getElementById('supPhone').value = s.contactNumber;
      document.getElementById('supEmail').value = s.email;
      document.getElementById('supLastDelivery').value = s.lastDelivery || '';
      document.getElementById('supStatus').value = s.status;
    }
    openModal('supplierModalOverlay');
  }
  async function saveSupplier() {
    const form = document.getElementById('supplierForm');
    if (!validateForm(form)) return;
    const payload = {
      name: document.getElementById('supName').value.trim(),
      contactPerson: document.getElementById('supContact').value.trim(),
      contactNumber: document.getElementById('supPhone').value.trim(),
      email: document.getElementById('supEmail').value.trim(),
      lastDelivery: document.getElementById('supLastDelivery').value,
      status: document.getElementById('supStatus').value
    };
    await Utils.withBusy(document.getElementById('saveSupplierBtn'), async function () {
      try {
        if (editingSupplierId) { await Api.put('/suppliers/' + encodeURIComponent(editingSupplierId), payload); showToast('Updated ' + payload.name + '.', 'ok'); }
        else { await Api.post('/suppliers', payload); showToast('Added supplier ' + payload.name + '.', 'ok'); }
        closeModal('supplierModalOverlay');
        await afterChange();                 // refreshes the supplier list AND every supplier dropdown / column on this page
      } catch (err) { showToast(err.message, 'danger'); }
    });
  }
  function openSupplierView(supplierId) {
    const s = Store.get('suppliers', []).find(x => x.id === supplierId);
    if (!s) return;
    const products = productsSuppliedBy(s.id);
    const purchaseHistory = Store.get('inventoryTransactions', [])
      .filter(t => t.type === 'Stock In' && t.supplierId === s.id)
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    document.getElementById('supplierViewBody').innerHTML =
      '<h2 style="margin-bottom:2px;">' + Utils.escapeHtml(s.name) + '</h2>' +
      '<span class="badge ' + (s.status === 'Active' ? 'badge-ok' : 'badge-neutral') + '">' + s.status + '</span>' +
      '<div class="form-grid" style="margin-top:16px;">' +
        viewField('Contact Person', Utils.escapeHtml(s.contactPerson)) +
        viewField('Contact Number', Utils.escapeHtml(s.contactNumber)) +
        viewField('Email', Utils.escapeHtml(s.email)) +
        viewField('Last Delivery', s.lastDelivery ? Utils.formatDate(s.lastDelivery) : '\u2014') +
      '</div>' +
      '<h3 style="margin-top:22px;font-size:.92rem;">Products Supplied (' + products.length + ')</h3>' +
      (products.length
        ? '<ul style="margin-top:8px;">' + products.map(p => '<li style="padding:7px 0;border-bottom:1px solid var(--border);font-size:.85rem;">' + Utils.escapeHtml(p.name) + ' <span class="text-muted">(' + p.id + ')</span></li>').join('') + '</ul>'
        : '<p class="text-muted" style="font-size:.85rem;">No products linked yet.</p>') +
      '<h3 style="margin-top:22px;font-size:.92rem;">Purchase History (' + purchaseHistory.length + ')</h3>' +
      (purchaseHistory.length
        ? '<ul style="margin-top:8px;">' + purchaseHistory.slice(0, 8).map(t =>
            '<li style="display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid var(--border);font-size:.85rem;">' +
              '<span>' + Utils.escapeHtml(t.productName) + (t.reference ? ' <span class="text-muted">(' + Utils.escapeHtml(t.reference) + ')</span>' : '') + '</span>' +
              '<span class="mono-num" style="white-space:nowrap;"><strong style="color:var(--ok);">+' + t.quantity + '</strong> &middot; ' + Utils.formatShortDate(t.date) + '</span></li>').join('') + '</ul>'
        : '<p class="text-muted" style="font-size:.85rem;">No stock-in recorded from this supplier yet.</p>');
    document.getElementById('supplierViewToEdit').dataset.supplierId = s.id;
    openModal('supplierViewOverlay');
  }

  Boot.dom(function () {
    populateStaticSelects();
    populateCompatBrandSelect();
    renderProductsTable();
    renderHistoryTable();
   
    renderSupplierList();
    if (!isAdmin) { ['manageCategoriesBtn', 'manageSuppliersBtn'].forEach(function (id) { const el = document.getElementById(id); if (el) el.style.display = 'none'; }); }
    document.getElementById('adjSaveBtn').addEventListener('click', saveAdjustment);

    document.getElementById('pCompatBrand').addEventListener('change', updateCompatModelOptions);
    document.getElementById('pCategory').addEventListener('change', function () {
      if (!editingProductId) updateIdPreview();
      updateImagePreviewFallback();
    });
    document.getElementById('addCompatBtn').addEventListener('click', function () {
      const brand = document.getElementById('pCompatBrand').value;
      const model = document.getElementById('pCompatModel').value;
      const combo = brand + ' ' + model;
      if (compatSelections.indexOf(combo) === -1) compatSelections.push(combo);
      renderCompatChips();
    });
    document.getElementById('compatChips').addEventListener('click', function (e) {
      const target = e.target.closest('[data-remove-compat]');
      if (target) { compatSelections.splice(parseInt(target.dataset.removeCompat, 10), 1); renderCompatChips(); }
    });
    document.getElementById('pHasWarranty').addEventListener('change', syncWarrantyFields);

    document.getElementById('pUniversal').addEventListener('change', function (e) {
      const disabled = e.target.checked;
      document.getElementById('pCompatBrand').disabled = disabled;
      document.getElementById('pCompatModel').disabled = disabled;
      document.getElementById('addCompatBtn').disabled = disabled;
      document.getElementById('compatChips').style.opacity = disabled ? '.4' : '1';
    });

    document.getElementById('imageDropZone').addEventListener('click', function () { document.getElementById('pImageFile').click(); });
    document.getElementById('pImageFile').addEventListener('change', function (e) {
      const file = e.target.files[0];
      if (!file) return;
      resizeImage(file, function (dataUrl) {
        pendingImage = dataUrl;
        updateImagePreviewFallback();
      });
    });

    const exportBtn = document.getElementById('exportInventoryBtn');
    if (exportBtn) exportBtn.addEventListener('click', exportInventoryCSV);
    document.getElementById('addProductBtn').addEventListener('click', function () { openProductModal('add'); });
    document.getElementById('saveProductBtn').addEventListener('click', saveProduct);
    document.getElementById('saveStockBtn').addEventListener('click', saveStock);
    document.getElementById('viewToEditBtn').addEventListener('click', function () {
      const id = document.getElementById('viewToEditBtn').dataset.productId;
      closeModal('viewModalOverlay');
      openProductModal('edit', id);
    });

    document.getElementById('manageCategoriesBtn').addEventListener('click', function () { renderCategoryList(); openModal('categoryModalOverlay'); });
    document.getElementById('manageSuppliersBtn').addEventListener('click', function () { document.getElementById('supSearch').value = ''; pgSup.reset(); renderSupplierList(); openModal('supplierManagerOverlay'); });
    document.getElementById('supSearch').addEventListener('input', renderSupplierList);
    document.getElementById('addSupplierBtn').addEventListener('click', function () { openSupplierModal('add'); });
    document.getElementById('saveSupplierBtn').addEventListener('click', saveSupplier);
    document.getElementById('suppliersTbody').addEventListener('click', function (e) {
      const v = e.target.closest('[data-sup-view]'), ed = e.target.closest('[data-sup-edit]');
      if (v) openSupplierView(v.dataset.supView); else if (ed) openSupplierModal('edit', ed.dataset.supEdit);
    });
    document.getElementById('supplierViewToEdit').addEventListener('click', function () {
      const id = this.dataset.supplierId; closeModal('supplierViewOverlay'); openSupplierModal('edit', id);
    });
    document.getElementById('newCategoryName').addEventListener('input', function (e) {
      const categories = Store.get('categories', []);
      document.getElementById('newCategoryPrefix').textContent = e.target.value.trim() ? derivePrefix(e.target.value, categories.map(c => c.prefix)) : '\u2014';
    });
    document.getElementById('addCategoryBtn').addEventListener('click', async function () {
      const nameInput = document.getElementById('newCategoryName');
      const name = nameInput.value.trim();
      if (!name) { showToast('Enter a category name first.', 'danger'); return; }
      try {
        await Api.post('/categories', { name: name });
        nameInput.value = '';
        document.getElementById('newCategoryPrefix').textContent = '\u2014';
        await afterChange(); renderCategoryList();
        showToast('Added category "' + name + '".', 'ok');
      } catch (err) { showToast(err.message, 'danger'); }
    });
    document.getElementById('categoryList').addEventListener('click', function (e) {
      const delBtn = e.target.closest('[data-delete-category]');
      if (delBtn) { deleteCategory(delBtn.dataset.deleteCategory); return; }
      const editBtn = e.target.closest('[data-edit-category]');
      if (editBtn) { editCategory(editBtn.dataset.editCategory); return; }
      const toggleBtn = e.target.closest('[data-toggle-category]');
      if (toggleBtn) { toggleCategoryStatus(toggleBtn.dataset.toggleCategory); return; }
    });

    document.getElementById('productsTbody').addEventListener('click', function (e) {
      const viewBtn = e.target.closest('[data-view]');
      const editBtn = e.target.closest('[data-edit]');
      const inBtn = e.target.closest('[data-stockin]');
      const outBtn = e.target.closest('[data-stockout]');
      const adjustBtn = e.target.closest('[data-adjust]');
      const archiveBtn = e.target.closest('[data-archive]');
      const unarchiveBtn = e.target.closest('[data-unarchive]');
      if (viewBtn) openViewModal(viewBtn.dataset.view);
      else if (editBtn) openProductModal('edit', editBtn.dataset.edit);
      else if (inBtn) openStockModal('in', inBtn.dataset.stockin);
      else if (outBtn) openStockModal('out', outBtn.dataset.stockout);
      else if (adjustBtn) openAdjustModal(adjustBtn.dataset.adjust);
      else if (archiveBtn) archiveProduct(archiveBtn.dataset.archive);
      else if (unarchiveBtn) unarchiveProduct(unarchiveBtn.dataset.unarchive);
    });

    document.getElementById('toggleArchivedChip').addEventListener('click', function () {
      showArchived = !showArchived;
      this.classList.toggle('active', showArchived);
      this.textContent = showArchived ? 'Showing Archived' : 'Show Archived';
      renderProductsTable();
    });

    document.getElementById('filterHistReason').addEventListener('change', renderHistoryTable);

    document.querySelectorAll('[data-close]').forEach(function (btn) { btn.addEventListener('click', function () { closeModal(btn.dataset.close); }); });
    document.querySelectorAll('.modal-overlay').forEach(function (overlay) {
      overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(overlay.id); });
    });

    ['invSearch'].forEach(function (id) { document.getElementById(id).addEventListener('input', renderProductsTable); });
    ['filterCategory', 'filterStatus', 'filterModel', 'filterProductBrand', 'filterSupplier', 'sortBy'].forEach(function (id) {
      document.getElementById(id).addEventListener('change', renderProductsTable);
    });
    document.getElementById('filterBrand').addEventListener('change', function () {
      const brand = document.getElementById('filterBrand').value;
      document.getElementById('filterModel').innerHTML = '<option value="">Any Model</option>' + (MOTO_BRANDS[brand] || []).map(function (m) { return '<option value="' + m + '">' + m + '</option>'; }).join('');
      renderProductsTable();
    });
    document.getElementById('histSearch').addEventListener('input', renderHistoryTable);
    document.getElementById('filterHistType').addEventListener('change', renderHistoryTable);

    document.querySelectorAll('.page-header .tab-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.page-header .tab-btn').forEach(function (b) { b.classList.remove('active'); });
        document.querySelectorAll('#tab-products, #tab-history').forEach(function (p) { p.classList.remove('active'); });
        btn.classList.add('active');
        document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
      });
    });
    document.querySelectorAll('#viewTabs .tab-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('#viewTabs .tab-btn').forEach(function (b) { b.classList.remove('active'); });
        document.querySelectorAll('#viewModalOverlay .tab-panel').forEach(function (tp) { tp.classList.remove('active'); });
        btn.classList.add('active');
        document.getElementById('vtab-' + btn.dataset.tab).classList.add('active');
      });
    });
  });
});
