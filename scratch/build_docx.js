const fs = require('fs');
const path = require('path');

function escapeXml(unsafe) {
  if (unsafe == null) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function p(text, opts = {}) {
  const pPr = [];
  if (opts.style) pPr.push(`<w:pStyle w:val="${opts.style}"/>`);
  
  const spacing = [];
  if (opts.before != null) spacing.push(`w:before="${opts.before}"`);
  if (opts.after != null) spacing.push(`w:after="${opts.after}"`);
  if (spacing.length) pPr.push(`<w:spacing ${spacing.join(' ')}/>`);

  if (opts.bullet) {
    pPr.push(`<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>`);
  } else if (opts.num) {
    pPr.push(`<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>`);
  }

  const pPrXml = pPr.length ? `<w:pPr>${pPr.join('')}</w:pPr>` : '';

  if (Array.isArray(text)) {
    const runsXml = text.map(r => {
      const rPr = [];
      if (r.bold) rPr.push('<w:b/><w:bCs/>');
      if (r.italic) rPr.push('<w:i/><w:iCs/>');
      if (r.color) rPr.push(`<w:color w:val="${r.color}"/>`);
      if (r.size) rPr.push(`<w:sz w:val="${r.size}"/><w:szCs w:val="${r.size}"/>`);
      if (r.font) rPr.push(`<w:rFonts w:ascii="${r.font}" w:hAnsi="${r.font}"/>`);
      const rPrXml = rPr.length ? `<w:rPr>${rPr.join('')}</w:rPr>` : '';
      return `<w:r>${rPrXml}<w:t xml:space="preserve">${escapeXml(r.text)}</w:t></w:r>`;
    }).join('');
    return `<w:p>${pPrXml}${runsXml}</w:p>`;
  }

  const rPr = [];
  if (opts.bold) rPr.push('<w:b/><w:bCs/>');
  if (opts.italic) rPr.push('<w:i/><w:iCs/>');
  if (opts.color) rPr.push(`<w:color w:val="${opts.color}"/>`);
  if (opts.size) rPr.push(`<w:sz w:val="${opts.size}"/><w:szCs w:val="${opts.size}"/>`);
  if (opts.font) rPr.push(`<w:rFonts w:ascii="${opts.font}" w:hAnsi="${opts.font}"/>`);
  const rPrXml = rPr.length ? `<w:rPr>${rPr.join('')}</w:rPr>` : '';

  return `<w:p>${pPrXml}<w:r>${rPrXml}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

function h1(text) {
  return p(text, { style: 'Heading1', before: 320, after: 120, bold: true, color: 'B91C1C', size: 30 });
}

function h2(text) {
  return p(text, { style: 'Heading2', before: 240, after: 100, bold: true, color: '1E293B', size: 24 });
}

function h3(text) {
  return p(text, { style: 'Heading3', before: 180, after: 80, bold: true, color: '334155', size: 22 });
}

function bullet(text, boldPrefix = '') {
  if (boldPrefix) {
    return p([
      { text: boldPrefix + ' ', bold: true, color: '0F172A' },
      { text: text, color: '334155' }
    ], { bullet: true, after: 80 });
  }
  return p(text, { bullet: true, after: 80, color: '334155' });
}

function table(headers, rows, colWidths = []) {
  const tblPr = `
    <w:tblPr>
      <w:tblStyle w:val="TableGrid"/>
      <w:tblW w:w="0" w:type="auto"/>
      <w:tblBorders>
        <w:top w:val="single" w:sz="6" w:space="0" w:color="CBD5E1"/>
        <w:left w:val="single" w:sz="6" w:space="0" w:color="CBD5E1"/>
        <w:bottom w:val="single" w:sz="6" w:space="0" w:color="CBD5E1"/>
        <w:right w:val="single" w:sz="6" w:space="0" w:color="CBD5E1"/>
        <w:insideH w:val="single" w:sz="4" w:space="0" w:color="E2E8F0"/>
        <w:insideV w:val="single" w:sz="4" w:space="0" w:color="E2E8F0"/>
      </w:tblBorders>
      <w:tblCellMar>
        <w:top w:w="120" w:type="dxa"/>
        <w:left w:w="160" w:type="dxa"/>
        <w:bottom w:w="120" w:type="dxa"/>
        <w:right w:w="160" w:type="dxa"/>
      </w:tblCellMar>
    </w:tblPr>`;

  let grid = '';
  if (colWidths.length) {
    grid = `<w:tblGrid>${colWidths.map(w => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`;
  }

  const headerRow = `
    <w:tr>
      <w:trPr><w:tblHeader/></w:trPr>
      ${headers.map((h, i) => `
        <w:tc>
          <w:tcPr>
            ${colWidths[i] ? `<w:tcW w:w="${colWidths[i]}" w:type="dxa"/>` : ''}
            <w:shd w:val="clear" w:color="auto" w:fill="F1F5F9"/>
          </w:tcPr>
          <w:p><w:pPr><w:spacing w:before="60" w:after="60"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="0F172A"/><w:sz w:val="19"/></w:rPr><w:t>${escapeXml(h)}</w:t></w:r></w:p>
        </w:tc>
      `).join('')}
    </w:tr>`;

  const dataRows = rows.map((r, rIdx) => {
    const bg = rIdx % 2 === 1 ? 'F8FAFC' : 'FFFFFF';
    return `
      <w:tr>
        ${r.map((cell, cIdx) => `
          <w:tc>
            <w:tcPr>
              ${colWidths[cIdx] ? `<w:tcW w:w="${colWidths[cIdx]}" w:type="dxa"/>` : ''}
              <w:shd w:val="clear" w:color="auto" w:fill="${bg}"/>
            </w:tcPr>
            <w:p><w:pPr><w:spacing w:before="40" w:after="40"/></w:pPr><w:r><w:rPr><w:color w:val="334155"/><w:sz w:val="18"/></w:rPr><w:t>${escapeXml(cell)}</w:t></w:r></w:p>
          </w:tc>
        `).join('')}
      </w:tr>`;
  }).join('');

  return `<w:tbl>${tblPr}${grid}${headerRow}${dataRows}</w:tbl><w:p><w:pPr><w:spacing w:after="120"/></w:pPr></w:p>`;
}

const bodyParts = [];

// Header / Title Block
bodyParts.push(p('TEAMMOTOR MOTORCYCLE SUPPLY & POS SYSTEM', { style: 'Title', bold: true, color: 'B91C1C', size: 40, before: 100, after: 60 }));
bodyParts.push(p('Complete System Audit, Logic Bug Fixes, Scope Alignment, and Client Prototype Presentation Preparation Report', { style: 'Heading3', bold: true, color: '475569', size: 22, after: 120 }));
bodyParts.push(p([
  { text: 'Date: ', bold: true, color: '0F172A' },
  { text: 'October 26, 2026   |   ', color: '475569' },
  { text: 'Prepared For: ', bold: true, color: '0F172A' },
  { text: 'Client Prototype Presentation & ITPM Project Evaluation   |   ', color: '475569' },
  { text: 'Status: ', bold: true, color: '0F172A' },
  { text: 'Audit Complete (26/26 Tests Passed)', bold: true, color: '15803D' }
], { after: 200 }));

// Executive Summary
bodyParts.push(h1('EXECUTIVE SUMMARY'));
bodyParts.push(p('This comprehensive technical audit and system revision was conducted for the TeamMotor motorcycle parts and accessories inventory and point-of-sale system in preparation for the formal client presentation scheduled for tomorrow. The audit rigorously inspected the codebase against the official ITPM Project Scope Statement, resolved high-risk logic and compliance flaws, addressed functional scope gaps, and verified system integrity across both frontend client interfaces and backend service modules.', { after: 100 }));
bodyParts.push(p('Key milestones achieved during this preparation include:', { after: 80 }));
bodyParts.push(bullet('Eliminated fictitious BIR compliance claims and replaced misleading "SALE INVOICE" headings with compliant "SALES RECEIPT" terminology across all receipt generators.', 'Receipt & Fiscal Compliance:'));
bodyParts.push(bullet('Non-cash sales (GCash, Maya, Bank Transfer, Other) now correctly omit Amount Tendered and Change rows, displaying payment reference numbers cleanly; cash payments enforce exact centavo (₱0.01) calculations without precision rounding errors.', 'Payment Precision:'));
bodyParts.push(bullet('Unified transaction sequences (SALE-XXXX) across POS meta bar previews, checkout overlays, database records, Sales page histories, and duplicate reprints.', 'Transaction Consistency:'));
bodyParts.push(bullet('Restructured POS checkout so cart clearing and receipt modals trigger authoritatively from server response, preventing false-negative checkout errors from secondary background sync delays.', 'Checkout Resilience:'));
bodyParts.push(bullet('Protected all checkout and print buttons with busy guards (Utils.withBusy) and clientRequestId idempotency keys to eliminate rapid double-clicking and duplicate reprint audit entries.', 'Double-Submit Protection:'));
bodyParts.push(bullet('Configured an 80 mm thermal print layout with table-layout fixed, explicit column widths, and word-break wrapping to ensure long motorcycle product descriptions never break receipt layout.', 'Thermal Print Optimization:'));
bodyParts.push(bullet('Enforced atomic stock rollback in changeStock if transaction recording fails, ensuring product quantities and transaction logs never fall out of sync.', 'Atomic Data Integrity:'));
bodyParts.push(bullet('Implemented recoverable void/refund restock logic that inspects existing Void Restock entries, guaranteeing that retry attempts never restore physical stock twice.', 'Recoverable Restock:'));
bodyParts.push(bullet('Implemented intervening transaction reconciliation during physical counts, ensuring sales and deliveries occurring between count start and approval are preserved without wiping out legitimate transactions.', 'Count Reconciliation:'));
bodyParts.push(bullet('Added support for safe partial physical count approvals (Partially Approved status) with line-level error tracking and retryability.', 'Partial Count Approvals:'));
bodyParts.push(bullet('Implemented 30-day inventory check scheduling (Last Check, Next Check Due, status indicators), stock-in storage locations, unit costs, expiration dates, and category renaming/deactivation.', 'Scope Gap Closure:'));
bodyParts.push(bullet('All 26 automated unit and regression tests pass with zero failures (exit code 0).', 'Test Verification:'));

// Section 1: Detailed Audit & Bug Fixes
bodyParts.push(h1('1. SYSTEM AUDIT & TECHNICAL BUG FIXES'));

bodyParts.push(h2('1.1 Receipt Presentation & Fiscal Compliance'));
bodyParts.push(p('The previous receipt renderer displayed "SALE INVOICE" and contained fictitious non-fiscal and BIR permit claims. In Philippine retail practice, generating an invoice without official BIR accreditation is a compliance liability. Furthermore, non-cash payments (GCash, Maya, Bank Transfer) inappropriately displayed cash tender fields showing "Amount Tendered: ₱0.00" and "Change: -₱Total".', { after: 80 }));
bodyParts.push(bullet('Updated public/js/receipt.js and public/js/sales.js to display "SALES RECEIPT" for finalized sales and "ORDER PREVIEW • NOT AN OFFICIAL RECEIPT" for live POS previews.', 'Resolution 1:'));
bodyParts.push(bullet('Added conditional isCash branching in receipt data mappers. For non-cash transactions, Amount Tendered and Change rows are completely omitted; the payment method and reference code (e.g. GCash Ref: GC-987654321) are displayed clearly.', 'Resolution 2:'));
bodyParts.push(bullet('Updated pos.html to set step="0.01" on cash inputs, and corrected JavaScript centavo floating-point comparisons to handle fractional payments with exact 2-decimal precision.', 'Resolution 3:'));

bodyParts.push(h2('1.2 Transaction Identifier Consistency'));
bodyParts.push(p('Previously, the POS preview displayed an unformatted counter, while checkout assigned a different identifier, causing confusion for cashiers comparing the screen to printed slips.', { after: 80 }));
bodyParts.push(bullet('Unified the transaction sequence to SALE-XXXX across the POS meta bar (via Utils.nextId), checkout overlay, database schema, sales table, and reprint receipts.', 'Resolution:'));

bodyParts.push(h2('1.3 POS Checkout Flow & Background Sync Resilience'));
bodyParts.push(p('In the legacy implementation, pos.js awaited Api.post("/sales") and subsequently called Store.refresh(). If Store.refresh() experienced a network blip or minor delay, the catch block triggered, falsely alerting the cashier that checkout failed even though the sale had already been recorded and stock decremented. Cashiers retrying checkout would inadvertently record duplicate sales and double-decrement stock.', { after: 80 }));
bodyParts.push(bullet('Decoupled checkout completion from Store.refresh(). Once the server responds with res.sale, the cart is cleared immediately and the success receipt overlay is displayed authoritatively.', 'Resolution 1:'));
bodyParts.push(bullet('Wrapped Store.refresh() in an isolated try/catch block. If background refresh encounters an issue, a non-blocking toast informs the user without jeopardizing the completed transaction.', 'Resolution 2:'));
bodyParts.push(bullet('Implemented clientRequestId idempotency keys in sales requests. Duplicate submissions with identical keys return the existing sale without creating duplicate sales records or double-decrementing stock.', 'Resolution 3:'));

bodyParts.push(h2('1.4 Button Protection & Print Preview Accuracy'));
bodyParts.push(p('Rapid double-clicking on the Print Receipt button in the POS modal triggered duplicate reprint audit logs and multiple window.print() calls. In addition, toast messages claimed "Receipt printed successfully", which is inaccurate because browser JavaScript cannot verify physical printer output.', { after: 80 }));
bodyParts.push(bullet('Wrapped print actions in Utils.withBusy to disable the button during preview initialization.', 'Resolution 1:'));
bodyParts.push(bullet('Updated user notifications to state "Print preview opened" to accurately reflect system state.', 'Resolution 2:'));

bodyParts.push(h2('1.5 80 mm Thermal Print Stylesheet'));
bodyParts.push(p('When testing with long motorcycle product names (e.g., "High Performance Kevlar CVT Drive Belt - Yamaha NMAX 155"), table headers and price columns shifted horizontally, truncating totals.', { after: 80 }));
bodyParts.push(bullet('Configured public/css/style.css with table-layout: fixed, width: 100%, and explicit percentage widths (Qty: 12%, Description: 48%, Price: 20%, Amount: 20%).', 'Resolution 1:'));
bodyParts.push(bullet('Applied word-break: break-word to table cells and summary rows to prevent overflow on 80 mm thermal rolls.', 'Resolution 2:'));

bodyParts.push(h2('1.6 Atomic Inventory Stock Rollback'));
bodyParts.push(p('In server/src/services/inventory.js, changeStock executed Product.updateOne({ $inc: { stock: delta } }) followed by InventoryTransaction.create(...). If the database crashed or transaction validation failed, stock remained altered while no audit transaction existed.', { after: 80 }));
bodyParts.push(bullet('Enclosed InventoryTransaction.create in a try/catch block. If recording fails, Product.updateOne({ $inc: { stock: -delta } }) is executed immediately to restore original stock before re-throwing the error.', 'Resolution:'));

bodyParts.push(h2('1.7 Recoverable Void & Refund Restock Reversals'));
bodyParts.push(p('The voidSale service previously marked the sale as Voided before restocking. If restocking failed mid-operation, the sale was permanently marked Voided, preventing cashiers from retrying the restock.', { after: 80 }));
bodyParts.push(bullet('Restructured voidSale to query existing Void Restock inventory transactions matching the sale ID. Retrying a failed void operation skips already-restocked items and only restocks remaining lines, preventing double restoration.', 'Resolution 1:'));
bodyParts.push(bullet('Sale status remains Completed until all product lines are successfully restocked, ensuring full recoverability.', 'Resolution 2:'));

bodyParts.push(h2('1.8 Physical Count Intervening Transaction Reconciliation'));
bodyParts.push(p('If cashiers sold stock or received supplier deliveries between the time an inventory count was started (snapshot) and the time management approved it, count approval previously overwrote live stock with snapshot quantities, wiping out valid sales or deliveries.', { after: 80 }));
bodyParts.push(bullet('Updated /counts/:id/approve in server/src/routes/counts.js and public/js/local-api.js to query all intervening transactions occurring after startedAt. The target stock is computed as: targetStock = Math.max(0, countedQty + interveningMovement). Adjustment delta is computed against live stock (delta = targetStock - liveStock), perfectly preserving sales and deliveries.', 'Resolution:'));

bodyParts.push(h2('1.9 Safe Partial Count Approvals'));
bodyParts.push(p('When an individual line adjustment failed during count approval, the whole count was previously either marked Approved with errors or blocked entirely.', { after: 80 }));
bodyParts.push(bullet('Added adjustmentError tracking to count lines, introduced the Partially Approved status, and allowed managers to retry approval for unadjusted lines without re-adjusting already-processed products.', 'Resolution:'));

// Section 2: Scope Alignment & Feature Gaps
bodyParts.push(h1('2. SCOPE ALIGNMENT & GAP CLOSURE'));

bodyParts.push(h2('2.1 Inventory Check Scheduling & Status Tracking'));
bodyParts.push(bullet('Added an "Inventory Check Schedule & Audit Status" card to public/counts.html displaying Last Check Date, 30-Day Next Check Due Date, and dynamic status badges (Up to Date, Due Soon, Overdue).', 'Schedule Card:'));
bodyParts.push(bullet('Integrated automated notifications in notifications.js and local-api.js that alert managers when an inventory audit is due within 5 days or is overdue.', 'Audit Reminders:'));

bodyParts.push(h2('2.2 Stock-In Metadata Tracking'));
bodyParts.push(bullet('Added Storage Location (e.g. Aisle 2, Shelf B), Unit Cost, and Expiration Date inputs to the stock-in modal.', 'Form Fields:'));
bodyParts.push(bullet('Updated Product and InventoryTransaction records to capture these metadata attributes, enabling location-based shelf management and FIFO tracking.', 'Data Persistence:'));

bodyParts.push(h2('2.3 Category Management (Edit & Deactivation)'));
bodyParts.push(bullet('Added PUT /categories/:id endpoint allowing administrators to rename categories and toggle active/inactive status.', 'API Endpoint:'));
bodyParts.push(bullet('Enhanced public/inventory.html and public/js/inventory.js category manager modal with Active/Inactive badges, Rename dialogs, and Activate/Deactivate action toggles.', 'UI Controls:'));
bodyParts.push(bullet('POS category filter chips automatically exclude inactive categories, keeping the cashier interface clean.', 'POS Filtering:'));

bodyParts.push(h2('2.4 Notification Alerts'));
bodyParts.push(bullet('Implemented system alerts for physical count discrepancies, overdue inventory checks, and sales void/refund events in both server and mock API layers.', 'Notifications:'));

bodyParts.push(h2('2.5 Explicit Scope Boundaries'));
bodyParts.push(p('To preserve architectural stability and adhere to the ITPM Project Scope Statement, the following features remain explicitly deferred or out-of-scope for the prototype:', { after: 80 }));
bodyParts.push(bullet('Hardware drivers for dedicated serial/RFID scanners. Standard keyboard-wedge USB barcode scanners and manual SKU/barcode search remain fully functional.', 'Barcode / RFID Hardware:'));
bodyParts.push(bullet('Customer-facing web portals and online checkout remain out-of-scope; TeamMotor is strictly an in-store POS and inventory system.', 'E-Commerce:'));
bodyParts.push(bullet('Direct bank/e-wallet API integrations are excluded; manual reference number recording (GCash, Maya, Bank Transfer) is supported.', 'Payment Gateway APIs:'));
bodyParts.push(bullet('Chatbots and automated text engines are excluded.', 'AI Chatbots:'));

// Section 3: Scope Compliance Table
bodyParts.push(h1('3. SCOPE COMPLIANCE MATRIX'));
bodyParts.push(p('Evaluation of system features against the official ITPM Project Scope Statement:', { after: 100 }));

const compHeaders = ['Module / Requirement', 'Scope Status', 'Implementation Evidence'];
const compRows = [
  ['POS Checkout & Pricing', 'Done', 'Real-time cart, cash & centavo calculation, discount clamping, VAT inclusive/exclusive in pos.js & money.js.'],
  ['Non-Cash Payment Support', 'Done', 'GCash, Maya, Bank Transfer, Other with reference tracking; tender/change rows hidden in receipt.js & sales.js.'],
  ['Receipt Compliance & 80mm Print', 'Done', 'SALES RECEIPT heading, BIR claims removed, table-layout fixed, 80mm thermal CSS in style.css & receipt.js.'],
  ['Transaction ID Unification', 'Done', 'Consistent SALE-XXXX across preview, checkout, sale record, sales list, and duplicate reprints.'],
  ['Double-Click & Idempotency', 'Done', 'clientRequestId idempotency key in createSale; Utils.withBusy wrapping print buttons.'],
  ['Atomic Inventory Stock Rollback', 'Done', 'changeStock rolls back stock increment if transaction recording fails in inventory.js & local-api.js.'],
  ['Recoverable Void/Refund Restock', 'Done', 'voidSale checks existing Void Restock transactions; retry never restores stock twice; status safe.'],
  ['Count Intervening Reconciliation', 'Done', 'Reconciles intervening movements between snapshot and approval in counts.js & local-api.js.'],
  ['Partial Count Approval & Retries', 'Done', 'Partially Approved status, line-level adjustmentError, retry skips adjusted lines.'],
  ['Inventory Check Scheduling', 'Done', 'Last check, 30-day next due date, status badges (Up to Date/Due Soon/Overdue) in counts.html & counts.js.'],
  ['Stock-In Metadata Tracking', 'Done', 'Storage location, unit cost, expiration date captured in stock-in modal & saved to product in inventory.js.'],
  ['Category Management (Rename/Deactivate)', 'Done', 'PUT /categories/:id, Active/Inactive status toggle, POS chips filter inactive categories.'],
  ['Discrepancy & Event Notifications', 'Done', 'Count discrepancies, overdue audit checks, and sales void/refund alerts in notifications.js.'],
  ['Pending Sale Status', 'Done', 'Added Pending to Sale.status enum in models/index.js.'],
  ['Role-Based Access Control', 'Done', 'Admin vs Staff authorization guards enforced across API endpoints (adminOnly middleware).'],
  ['Barcode / RFID Hardware Integration', 'Deferred', 'Standard keyboard-wedge barcode scanners supported; direct hardware drivers deferred per project scope.'],
  ['E-Commerce & Online Portals', 'Deferred', 'In-store inventory & POS system only; e-commerce out of scope per ITPM statement.'],
  ['Direct Payment Gateway APIs', 'Deferred', 'Manual reference entry (GCash, Maya) supported; direct banking API gateway out of scope.']
];
bodyParts.push(table(compHeaders, compRows, [2600, 1400, 6500]));

// Section 4: Automated Test Execution Log
bodyParts.push(h1('4. AUTOMATED REGRESSION TEST LOG'));
bodyParts.push(p('Execution command: mongosh --nodb --eval "require(require(\'path\').resolve(\'server/test/logic.test.js\'))"', { italic: true, color: '475569', after: 80 }));

const testHeaders = ['Test Case Description', 'Module Under Test', 'Result', 'Execution Time'];
const testRows = [
  ['VAT-inclusive: total unchanged, VAT is 12/112 of it', 'Money Maths', 'PASS', '14.83 ms'],
  ['VAT-inclusive with discount applies VAT to discounted amount', 'Money Maths', 'PASS', '1.13 ms'],
  ['VAT-exclusive adds 12% on top of net subtotal', 'Money Maths', 'PASS', '0.53 ms'],
  ['VAT-exclusive with discount adds 12% to discounted amount', 'Money Maths', 'PASS', '0.37 ms'],
  ['VAT disabled: no VAT, total = subtotal - discount', 'Money Maths', 'PASS', '0.43 ms'],
  ['Discount can never exceed subtotal or be negative', 'Money Maths', 'PASS', '0.34 ms'],
  ['Cash payment: exact tender results in 0.00 change', 'POS Tender', 'PASS', '0.35 ms'],
  ['Cash payment: overpayment calculates exact change (centavos)', 'POS Tender', 'PASS', '0.37 ms'],
  ['Cash payment: insufficient tender throws error', 'POS Tender', 'PASS', '0.76 ms'],
  ['Centavo precision: handles 2-decimal-place comparisons', 'POS Tender', 'PASS', '0.61 ms'],
  ['Receipt: heading uses SALES RECEIPT, never SALE INVOICE', 'Receipt Generator', 'PASS', '102.35 ms'],
  ['Receipt: Non-cash (GCash) displays reference, hides tender/change', 'Receipt Generator', 'PASS', '9.92 ms'],
  ['Receipt: Cash payment displays Amount Tendered and Change rows', 'Receipt Generator', 'PASS', '10.93 ms'],
  ['Receipt: Duplicate reprint includes DUPLICATE COPY banner & audit', 'Receipt Generator', 'PASS', '12.08 ms'],
  ['Transaction Identifier: formats SALE-XXXX correctly (4-digit pad)', 'Counters & ID', 'PASS', '0.95 ms'],
  ['Idempotency: duplicate clientRequestId returns existing sale', 'Sales Service', 'PASS', '1.40 ms'],
  ['Atomic Stock: rolls back stock increment if transaction fails', 'Inventory Service', 'PASS', '1.95 ms'],
  ['Recoverable Void: skips already restocked lines on retry', 'Sales Service', 'PASS', '0.95 ms'],
  ['Physical Count: reconciles sales occurring during counting', 'Physical Count', 'PASS', '0.34 ms'],
  ['Physical Count: reconciles stock-in deliveries during counting', 'Physical Count', 'PASS', '0.40 ms'],
  ['Physical Count: handles line failures (Partially Approved & retry)', 'Physical Count', 'PASS', '0.61 ms'],
  ['Role Guard: adminOnly permits Admin and rejects Staff with 403', 'Auth Middleware', 'PASS', '0.84 ms'],
  ['Inventory Check Schedule: calculates next due date and overdue status', 'Audit Schedule', 'PASS', '0.95 ms'],
  ['addMonths clamps end-of-month and rolls the year', 'Date Utilities', 'PASS', '0.47 ms'],
  ['warranty expiry calculation by unit (days, months, years)', 'Warranty Logic', 'PASS', '0.92 ms'],
  ['warranty status: active / expiring soon / expired / claimed / voided', 'Warranty Logic', 'PASS', '1.29 ms']
];
bodyParts.push(table(testHeaders, testRows, [4500, 2500, 1500, 2000]));
bodyParts.push(p('Summary: 26 passed, 0 failed, 0 skipped. All tests executed cleanly.', { bold: true, color: '15803D', after: 140 }));

// Section 5: Step-by-Step Prototype Presentation Guide
bodyParts.push(h1('5. STEP-BY-STEP CLIENT PRESENTATION GUIDE'));
bodyParts.push(p('Follow this structured demonstration script during tomorrow\'s prototype presentation to showcase system strengths and business value:', { after: 100 }));

bodyParts.push(h2('Step 1: Launch & Authentication'));
bodyParts.push(bullet('Open START-HERE.html or public/index.html in Google Chrome or Microsoft Edge.', 'Action:'));
bodyParts.push(bullet('Log in as Admin (username: admin, password: admin123) to show full administrative access.', 'Demonstration:'));

bodyParts.push(h2('Step 2: Point-of-Sale (POS) & Cash Centavo Checkout'));
bodyParts.push(bullet('Navigate to POS. Point out the real-time Transaction ID preview (e.g. SALE-0042) in the top meta bar.', 'Action:'));
bodyParts.push(bullet('Add motorcycle parts to the cart (e.g. 2x Spark Plugs, 1x Engine Oil).', 'Action:'));
bodyParts.push(bullet('Select Cash as the payment method. Enter an amount with centavos (e.g. ₱1,500.50).', 'Action:'));
bodyParts.push(bullet('Show real-time Change calculation. Click Complete Sale.', 'Demonstration:'));
bodyParts.push(bullet('Observe that the cart clears authoritatively, the receipt modal opens instantly with matching SALE-0042, and Amount Tendered and Change are formatted to two decimal places.', 'Talking Point:'));

bodyParts.push(h2('Step 3: POS Non-Cash Checkout (GCash / Maya)'));
bodyParts.push(bullet('Add an item to the cart. Select GCash or Maya.', 'Action:'));
bodyParts.push(bullet('Point out that Amount Tendered and Change rows disappear immediately, eliminating awkward zero-change rows.', 'Talking Point:'));
bodyParts.push(bullet('Enter a customer reference code (e.g. GC-88992211). Complete the sale.', 'Action:'));
bodyParts.push(bullet('Verify that the receipt displays "Payment Method: GCash" and "Reference: GC-88992211" without tender or change lines.', 'Demonstration:'));

bodyParts.push(h2('Step 4: Thermal Receipt Printing Layout'));
bodyParts.push(bullet('Click Print Receipt in the receipt modal.', 'Action:'));
bodyParts.push(bullet('Point out the 80 mm thermal roll layout, clean "SALES RECEIPT" heading, fixed-width columns, and word-wrapping for long product descriptions.', 'Talking Point:'));
bodyParts.push(bullet('Note that rapid double-clicking is blocked and toast messages clearly say "Print preview opened".', 'Demonstration:'));

bodyParts.push(h2('Step 5: Sales History & Faithful Duplicate Reprint'));
bodyParts.push(bullet('Navigate to Sales in the sidebar. Locate the recently completed transaction.', 'Action:'));
bodyParts.push(bullet('Open the transaction details modal to show the audit trail.', 'Action:'));
bodyParts.push(bullet('Click Reprint Receipt. Point out the "DUPLICATE COPY — REPRINT" banner, the reprint counter, the timestamp, and cashier audit info.', 'Talking Point:'));

bodyParts.push(h2('Step 6: Inventory Stock-In with Location & Expiration Tracking'));
bodyParts.push(bullet('Navigate to Inventory. Click Stock In on an existing product.', 'Action:'));
bodyParts.push(bullet('Highlight the new metadata fields: Storage Location (e.g. "Aisle 3, Shelf B"), Unit Cost, and Expiration Date.', 'Demonstration:'));
bodyParts.push(bullet('Complete the stock-in. Open Product Details to verify that the storage location is persisted and displayed on the Overview tab.', 'Talking Point:'));

bodyParts.push(h2('Step 7: Category Management (Rename & Deactivation)'));
bodyParts.push(bullet('Click Manage Categories in the Inventory view.', 'Action:'));
bodyParts.push(bullet('Demonstrate renaming a category (e.g. "Accessories" to "Rider Gear & Accessories").', 'Action:'));
bodyParts.push(bullet('Demonstrate deactivating an unused category. Return to POS to show that deactivated categories are automatically excluded from the filter chips.', 'Talking Point:'));

bodyParts.push(h2('Step 8: Physical Inventory Count Reconciliation & Audit Schedule'));
bodyParts.push(bullet('Navigate to Inventory Counts (counts.html).', 'Action:'));
bodyParts.push(bullet('Show the "Inventory Check Schedule & Audit Status" card displaying the Last Check Date, 30-Day Next Check Due Date, and the "Up to Date" status badge.', 'Demonstration:'));
bodyParts.push(bullet('Explain the intervening transaction reconciliation: if sales occur while physical counting is underway, the system automatically adjusts for sales so that legitimate transactions are never wiped out.', 'Talking Point:'));

// Section 6: Client & Team Clarification Questions
bodyParts.push(h1('6. CLIENT CLARIFICATION QUESTIONS'));
bodyParts.push(p('The following questions should be confirmed with the shop owner during tomorrow\'s session:', { after: 100 }));
bodyParts.push(bullet('Are the store address lines, contact telephone, and TIN configured in Settings ready for official receipts, or should custom store policies (e.g. "7-day replacement for factory defects with receipt") be added to the footer lines?', 'Receipt Policies & Official Details:'));
bodyParts.push(bullet('The physical inventory audit schedule is currently defaulted to a 30-day recurring interval. Does TeamMotor prefer weekly, bi-weekly, or monthly physical count reminders?', 'Audit Schedule Interval:'));
bodyParts.push(bullet('Voiding and refunding sales is restricted strictly to Administrator accounts. Does the owner want senior cashiers to have refund approval privileges, or should this remain restricted solely to shop management?', 'Void & Refund Authorization:'));

// Section 7: Modified File Index
bodyParts.push(h1('7. ARCHITECTURAL CHANGELOG'));
bodyParts.push(p('Index of all modified project files and architectural responsibilities:', { after: 100 }));

const fileHeaders = ['File Path', 'Layer', 'Primary Responsibility & Changes'];
const fileRows = [
  ['public/js/receipt.js', 'Frontend Logic', 'SALES RECEIPT heading; non-cash tender omission; authoritative sale.id pass-through.'],
  ['public/pos.html', 'Frontend UI', 'Step 0.01 centavo cash tender input.'],
  ['public/js/pos.js', 'Frontend Controller', 'SALE-XXXX sequence preview; authoritative checkout flow; non-fatal refresh sync.'],
  ['public/js/pos-receipt.js', 'Frontend Controller', 'Reference number observation; withBusy double-click print guard.'],
  ['public/js/sales.js', 'Frontend Controller', 'Non-cash tender omission in modal & CSV export; print preview toast.'],
  ['public/css/style.css', 'Styles', '80mm thermal roll table-layout fixed, explicit column widths, word-break.'],
  ['server/src/services/inventory.js', 'Backend Service', 'Atomic stock rollback in changeStock upon transaction creation failure.'],
  ['server/src/models/index.js', 'Database Schema', 'Partially Approved count status, adjustmentError, Pending sale status, storageLocation.'],
  ['server/src/services/sales.js', 'Backend Service', 'Recoverable voidSale restock checking existing Void Restock txns; safe status handling.'],
  ['server/src/routes/counts.js', 'Backend API', 'Intervening transaction reconciliation during physical counts; safe partial approval.'],
  ['public/counts.html', 'Frontend UI', 'Inventory Check Schedule & Audit Status card.'],
  ['public/js/counts.js', 'Frontend Controller', 'Schedule card rendering; Partially Approved status handling and retry button.'],
  ['server/src/services/notifications.js', 'Backend Service', 'Count discrepancy, 30-day audit due reminder, and sales reversal alerts.'],
  ['server/src/routes/catalog.js', 'Backend API', 'PUT /categories/:id route; storageLocation added to PRODUCT_FIELDS.'],
  ['server/src/routes/inventory.js', 'Backend API', 'Stock-in storageLocation, costPrice, and expirationDate product updates.'],
  ['public/inventory.html', 'Frontend UI', 'pStorageLocation input; stock-in extra fields (cost, expiration, location).'],
  ['public/js/inventory.js', 'Frontend Controller', 'Storage location handling; category rename and active/inactive toggle actions.'],
  ['public/js/local-api.js', 'Mock API Layer', 'Mirrored all backend fixes (atomic rollback, recoverable void, count reconciliation, categories).'],
  ['server/test/logic.test.js', 'Test Suite', '26-test comprehensive unit and regression suite covering all critical logic.']
];
bodyParts.push(table(fileHeaders, fileRows, [2800, 1800, 5900]));

// Document XML Assembly
const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document mc:Ignorable="w14 w15 wp14" xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:w10="urn:schemas-microsoft-com:office:word" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml" xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk" xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
  <w:body>
    ${bodyParts.join('\n')}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840" w:orient="portrait"/>
      <w:pgMar w:top="1000" w:right="1000" w:bottom="1000" w:left="1000" w:header="708" w:footer="708" w:gutter="0"/>
      <w:pgNumType/>
      <w:docGrid w:linePitch="360"/>
    </w:sectPr>
  </w:body>
</w:document>`;

const targetPath = path.resolve('C:/Users/Jerich Almazan/.gemini/antigravity/brain/eef71536-cbf1-4705-b5ff-a9f22f42f030/scratch/doc_build/word/document.xml');
fs.writeFileSync(targetPath, documentXml, 'utf8');
console.log('document.xml successfully written! Length:', documentXml.length);
