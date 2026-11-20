/* ==========================================================================
   guide.js — Role-Based User Guide & System Navigation Modal
   --------------------------------------------------------------------------
   Self-injecting interactive documentation and navigation guide.
   Dynamically tailors topics and instructions based on getSession().role:
     • Staff: Shows ONLY operational features Staff can access (POS cashiering,
       Stock In/Out, expiry vs warranty concepts, customer registration, filing
       warranty claims, and personal shift/password management). Strictly omits
       Admin-only controls.
     • Admin: Shows full store governance, catalog lifecycle, physical count
       adjustments, master filter management, sales reversals, user/shift
       governance, and shop settings / audit logs.
   ========================================================================== */
(function () {
  'use strict';

  function currentRole() {
    const s = (typeof getSession === 'function') ? getSession() : null;
    return (s && s.role === 'Admin') ? 'Admin' : 'Staff';
  }

  function guideIcon(name) {
    if (typeof icon === 'function') return icon(name);
    return '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/></svg>';
  }

  const GUIDE_TOPICS = [
    /* ---------------- Topic 1: Staff Variant ---------------- */
    {
      id: 'getting-started-staff',
      roles: ['Staff'],
      title: 'Getting Started & Staff Duties',
      shortTitle: 'Getting Started',
      icon: 'book',
      subtitle: 'Mandatory shift clock-in, your daily operational responsibilities, and system navigation.',
      cards: [
        {
          title: 'Step 1: Clock In to Unlock Store Menus',
          badges: [
            { label: 'Clock-In Required', tone: 'badge-warn' },
            { label: 'IN / Shift Started', tone: 'badge-ok' }
          ],
          intro: 'For store security and audit accountability, operational menus are locked while you are Off Duty:',
          steps: [
            '<strong>Locked While Off Duty</strong>: When you first sign in without an active shift, <strong>Inventory</strong>, <strong>POS</strong>, <strong>Sales</strong>, <strong>Customers</strong>, and <strong>Warranty</strong> display a padlock icon in the sidebar and are blocked from access (including direct URL links).',
            '<strong>How to Unlock</strong>: Click your name at the bottom of the left sidebar (or top-right profile menu) to open <strong>My Profile</strong>, then flip the <strong>Work Shift Status</strong> switch to <strong>Clock In</strong>.',
            '<strong>Immediate Access</strong>: As soon as your status changes to <span class="badge badge-ok">IN / Shift Started</span>, all five operational menus unlock automatically across the system.'
          ],
          tip: 'When your shift ends and you flip the switch to Clock Out, those five menus automatically re-lock until your next shift.'
        },
        {
          title: 'Your Staff Workspace & Navigation',
          badges: [
            { label: 'Staff Access', tone: 'badge-ok' },
            { label: 'Daily Operations', tone: 'badge-neutral' }
          ],
          intro: 'Use the left sidebar (or top-left menu button on mobile and POS) to switch between your daily workspaces:',
          steps: [
            '<strong>Dashboard</strong>: Always accessible to view daily store alerts, low-stock items, and upcoming batch expirations.',
            '<strong>My Profile (Clock In / Out)</strong>: Always accessible to clock in and out of your work shift and manage your account password.',
            '<strong>POS Terminal (Requires Clock-In)</strong>: Ring up customer purchases, scan barcodes, filter by motorcycle fitment, and print receipts.',
            '<strong>Inventory (Requires Clock-In)</strong>: Check part stock levels and storage locations, receive supplier deliveries (<strong>Stock In</strong>), and report damaged or expired units (<strong>Stock Out</strong>).',
            '<strong>Sales (Requires Clock-In)</strong>: Review completed sales transactions and reprint customer receipts when needed.',
            '<strong>Customers (Requires Clock-In)</strong>: Register new customers at checkout or look up their purchase history.',
            '<strong>Warranty (Requires Clock-In)</strong>: Check active customer warranty certificates and file repair or replacement claims.'
          ],
          tip: 'Discrepancies in physical inventory counts, sales reversals or refunds, and product catalog modifications must be escalated to an Admin.'
        }
      ]
    },

    /* ---------------- Topic 1: Admin Variant ---------------- */
    {
      id: 'getting-started-admin',
      roles: ['Admin'],
      title: 'Getting Started & Administrator Responsibilities',
      shortTitle: 'Getting Started',
      icon: 'book',
      subtitle: 'Complete store governance, inventory control, fiscal oversight, and team management.',
      cards: [
        {
          title: 'Administrator Oversight & Full System Map',
          badges: [
            { label: 'Admin Authority', tone: 'badge-danger' },
            { label: 'Full Store Control', tone: 'badge-ok' }
          ],
          intro: 'As an Administrator, you have full operational access plus master catalog, financial, and security controls:',
          steps: [
            '<strong>Dashboard & Sales Analysis</strong>: Track revenue trends (7-day, 30-day, 1-year), gross profit margins, payment method splits (Cash vs. GCash), and inventory health alerts.',
            '<strong>Product Catalog & Master Filters</strong>: Create, edit, archive, or delete products, and configure master Categories, Suppliers, Brands, and Motorcycle Compatibility models.',
            '<strong>Inventory Reconciliation</strong>: Receive deliveries (<strong>Stock In</strong>), write off losses (<strong>Stock Out</strong>), and perform FEFO-aware physical count reconciliations (<strong>Adjust Stock</strong>).',
            '<strong>Transaction Reversals</strong>: Authorize and execute <strong>Void Sale</strong>, Cancel, or Refund actions with mandatory audit trails and automatic inventory restocking.',
            '<strong>Team & Shift Governance</strong>: Create and manage accounts under <strong>Users</strong>, assign Admin or Staff roles, and monitor all-staff clock-in/out shift logs.',
            '<strong>Compliance & Settings</strong>: Audit every sensitive action in <strong>Audit Trail</strong> and configure VAT rules, expiry warning thresholds, and 58mm receipt headers in <strong>Settings</strong>.'
          ],
          tip: 'All administrative overrides (stock count adjustments, sales reversals, user role changes, and product updates) are permanently recorded in the Audit Trail with your name and timestamp.'
        }
      ]
    },

    /* ---------------- Operational Topics (Both Staff & Admin) ---------------- */
    {
      id: 'pos-cashiering',
      roles: ['Staff', 'Admin'],
      title: 'POS & Cashiering',
      shortTitle: 'POS & Cashiering',
      icon: 'pos',
      subtitle: 'Ringing up items, barcode scanning, Cash & GCash payments, and receipt printing.',
      cards: [
        {
          title: 'Building an Order & Fitment Filtering',
          badges: [
            { label: 'Barcode Ready', tone: 'badge-ok' },
            { label: 'Fitment Filter', tone: 'badge-neutral' }
          ],
          intro: 'The POS terminal is designed for fast, single-screen checkout during busy shop hours:',
          steps: [
            '<strong>Scan or Search</strong>: Scan a barcode with a USB scanner or type a Product ID, SKU, or part name into the search bar and press <strong>Enter</strong>.',
            '<strong>Fits My Bike Filter</strong>: Click <strong>Fits my bike</strong> to filter the catalog by a specific motorcycle brand and model (e.g., Honda Click 125i); Universal Fit parts remain included automatically.',
            '<strong>Adjust Quantities & Discounts</strong>: Use the <strong>+ / &minus;</strong> buttons in the cart to change quantities, or apply a preset/custom discount before payment.',
            '<strong>Hold & Resume Orders</strong>: Click <strong>Hold</strong> to park an unfinished cart while assisting another customer, then click <strong>Held orders</strong> in the top bar to resume it.'
          ],
          tip: 'Out-of-stock or expired products are automatically blocked from checkout to prevent fulfillment mistakes.'
        },
        {
          title: 'Processing Cash & GCash Payments',
          badges: [
            { label: 'Cash', tone: 'badge-ok' },
            { label: 'GCash Reference Required', tone: 'badge-warn' }
          ],
          intro: 'Click Pay in the cart panel to open the payment terminal:',
          steps: [
            '<strong>Cash Checkout</strong>: Enter the cash tendered using the keypad or quick-bill buttons (Exact, ₱100, ₱500, ₱1,000). The system automatically calculates exact change.',
            '<strong>GCash Checkout</strong>: Select <strong>GCash</strong>, verify the transfer on the shop phone, enter the customer&rsquo;s <strong>GCash Reference Number</strong>, and tick the confirmation checkbox.',
            '<strong>Sales Receipt & Reprints</strong>: After confirming payment, print the 58mm receipt. Any later reprint from the Sales page automatically carries a <strong>DUPLICATE COPY</strong> banner.'
          ],
          tip: 'Always link the customer account before completing payment if the product carries a customer warranty, so their warranty certificate is registered under their name.'
        }
      ]
    },

    {
      id: 'stock-in-out',
      roles: ['Staff', 'Admin'],
      title: 'Stock In & Stock Out',
      shortTitle: 'Stock In & Out',
      icon: 'inventory',
      subtitle: 'Receiving new supplier deliveries and recording damaged or expired inventory.',
      cards: [
        {
          title: 'Receiving Deliveries (Stock In)',
          badges: [
            { label: 'Stock In', tone: 'badge-ok' },
            { label: 'Batch Tracking', tone: 'badge-neutral' }
          ],
          intro: 'Whenever new inventory arrives from a supplier, record it via Stock In on the product row:',
          steps: [
            'In <strong>Inventory &rarr; Products</strong>, click the <strong>Stock In</strong> (up-arrow) button on the target product row.',
            'Enter the <strong>Quantity</strong> received, delivery <strong>Date</strong>, <strong>Supplier</strong>, and <strong>Reference (PO #)</strong>.',
            'Verify the <strong>Unit Cost (₱)</strong> and the batch <strong>Expiration Date</strong> (auto-calculated if the product has a default shelf life, or pick the date printed on the packaging).',
            'Click <strong>Confirm Stock In</strong>. The new delivery is tracked as its own batch and added to available stock.'
          ],
          tip: 'Each Stock In creates an independent batch record so the system can track which deliveries expire first (FEFO — First Expired, First Out).'
        },
        {
          title: 'Removing Unsellable Units (Stock Out)',
          badges: [
            { label: 'Stock Out', tone: 'badge-danger' },
            { label: 'Audit Logged', tone: 'badge-warn' }
          ],
          intro: 'When items are removed from shelves without being sold at POS, record a Stock Out:',
          steps: [
            'Click the <strong>Stock Out</strong> (down-arrow) button on the product row in <strong>Inventory</strong>.',
            'Enter the <strong>Quantity</strong> to deduct and select the mandatory <strong>Reason</strong> (<em>Damaged, Expired, Returned, Lost, Internal Use, or Other</em>).',
            'Add a brief explanation in <strong>Notes</strong> and click <strong>Confirm Stock Out</strong>.'
          ],
          tip: 'Never use Stock Out for normal customer purchases — customer sales must always go through the POS terminal.'
        }
      ]
    },

    {
      id: 'expiry-warranty',
      roles: ['Staff', 'Admin'],
      title: 'Understanding Expiry & Warranty',
      shortTitle: 'Expiry vs. Warranty',
      icon: 'clock',
      subtitle: 'How Product Shelf Life, Batch Expiration Dates, and Customer Warranties differ.',
      cards: [
        {
          title: 'The 3 Date Concepts Explained Simply',
          badges: [
            { label: 'Valid', tone: 'badge-ok' },
            { label: 'Expiring Soon', tone: 'badge-warn' },
            { label: 'Expired', tone: 'badge-danger' }
          ],
          intro: 'TeamMotor separates warehouse shelf expiration from post-sale customer protection:',
          steps: [
            '<strong>1. Product Shelf Life (Default Blueprint)</strong>: How long a product (like engine oil, brake fluid, or sealant) lasts on the shelf after delivery (e.g., <em>24 months</em>). Used to auto-calculate expiration dates on future Stock-In deliveries.',
            '<strong>2. Batch Expiration Date (Warehouse Cutoff)</strong>: The specific calendar date a delivered batch expires. Displayed in <strong>Product Details &rarr; Inventory</strong> per batch. Once a batch reaches its expiration date, it is flagged <span class="badge badge-danger">Expired</span>.',
            '<strong>3. Customer Warranty (Starts at POS Checkout)</strong>: Protection for the buyer (e.g., <em>6 months on electrical parts</em>). The countdown starts <strong>only when a customer buys the item at POS</strong> — never while sitting in the stockroom.'
          ],
          tip: 'Open any product and click the Eye (View) icon to inspect individual active batches and their exact expiration dates under the Inventory tab.'
        }
      ]
    },

    {
      id: 'warranty-claims',
      roles: ['Staff', 'Admin'],
      title: 'Customers & Filing Warranty Claims',
      shortTitle: 'Warranty Claims',
      icon: 'shield',
      subtitle: 'Registering customers and processing repair or replacement claims.',
      cards: [
        {
          title: 'How to Verify & File a Customer Warranty Claim',
          badges: [
            { label: 'Active', tone: 'badge-ok' },
            { label: 'Claimed', tone: 'badge-warn' }
          ],
          intro: 'When a customer returns with a defective part covered by warranty:',
          steps: [
            'Go to the <strong>Warranty</strong> menu and search by the customer&rsquo;s name, product name, or Sale ID.',
            'Check that the status badge is <span class="badge badge-ok">Active</span> or <span class="badge badge-warn">Expiring Soon</span> (expired or voided warranties cannot be claimed).',
            'Click the <strong>View</strong> icon to inspect the certificate, then click <strong>File Warranty Claim</strong>.',
            'Select the <strong>Claim Decision / Status</strong> (<em>Pending Evaluation, Approved, Resolved, or Rejected</em>), describe the defect and resolution, and click <strong>Submit Claim</strong>.'
          ],
          tip: 'You can also register new customers or update their phone number and email anytime from the Customers menu.'
        }
      ]
    },

    {
      id: 'shifts-profile',
      roles: ['Staff', 'Admin'],
      title: 'Personal Shifts & Password',
      shortTitle: 'Shifts & Profile',
      icon: 'user',
      subtitle: 'Managing your profile details, shift clock-in/out gate, and account security.',
      cards: [
        {
          title: 'Clocking In/Out & Updating Your Account',
          badges: [
            { label: 'Shift Gate', tone: 'badge-warn' },
            { label: 'Profile & Security', tone: 'badge-neutral' }
          ],
          intro: 'Access your personal profile by clicking your name at the bottom of the sidebar or top-right avatar menu:',
          steps: [
            '<strong>Work Shift Timer &amp; Menu Unlock (Staff)</strong>: In <strong>My Profile</strong>, click <strong>Clock In</strong> at the start of your duty to start the live shift timer and unlock <strong>Inventory</strong>, <strong>POS</strong>, <strong>Sales</strong>, <strong>Customers</strong>, and <strong>Warranty</strong>. Click <strong>Clock Out</strong> before signing off to complete your shift and re-lock operational menus.',
            '<strong>Profile Photo &amp; Info</strong>: Update your display photo or contact details and click <strong>Save Changes</strong>.',
            '<strong>Change Password</strong>: Enter your current password and a strong new password (at least 8 characters with uppercase, lowercase, number, and symbol) to keep your login secure.'
          ],
          tip: 'Always clock out and log out when leaving a shared shop terminal.'
        }
      ]
    },

    /* ---------------- Admin-Only Governance Topics ---------------- */
    {
      id: 'catalog-lifecycle',
      roles: ['Admin'],
      title: 'Product Catalog Lifecycle',
      shortTitle: 'Product Catalog',
      icon: 'edit',
      subtitle: 'Adding products, editing prices & default shelf life, archiving, and deletion.',
      cards: [
        {
          title: 'Adding, Editing & Archiving Products',
          badges: [
            { label: 'Admin Only', tone: 'badge-danger' },
            { label: 'Catalog Control', tone: 'badge-neutral' }
          ],
          intro: 'Maintain clean product master data from Inventory &rarr; Products:',
          steps: [
            '<strong>Add Product</strong>: Click <strong>+ Add Product</strong>. Scan a custom QR/barcode into <strong>Product ID</strong> or leave blank to auto-generate (e.g., <em>BRK-008</em>). Set opening quantity, Low Stock Indicator, optional shelf life, and optional customer warranty.',
            '<strong>Edit Product</strong>: Click the <strong>Edit</strong> (pencil) icon to update selling price, cost price, storage location, compatibility, or default shelf life for future deliveries.',
            '<strong>Archive vs. Delete</strong>: Use <strong>Archive</strong> to hide discontinued items while preserving past sales history. Use <strong>Delete Product</strong> only for mistakenly created catalog entries.'
          ],
          tip: 'Quantity and batch expiration dates are intentionally hidden in Edit Product so past batch records are never overwritten — use Stock In, Stock Out, or Adjust Stock instead.'
        }
      ]
    },

    {
      id: 'inventory-audits',
      roles: ['Admin'],
      title: 'Inventory Audits & Adjust Stock',
      shortTitle: 'Adjust Stock',
      icon: 'checkCircle',
      subtitle: 'Reconciling physical shelf counts with FEFO batch tracking.',
      cards: [
        {
          title: 'Reconciling Physical Counts with Adjust Stock',
          badges: [
            { label: 'Admin Only', tone: 'badge-danger' },
            { label: 'FEFO Reconciliation', tone: 'badge-ok' }
          ],
          intro: 'When a physical inventory audit reveals a discrepancy between shelf stock and system stock:',
          steps: [
            'In <strong>Inventory &rarr; Products</strong>, click the <strong>Adjust stock</strong> (checkmark) icon on the product row.',
            'If the product has multiple active delivery batches, select the specific <strong>Batch to Adjust</strong> or leave on <strong>Auto (FEFO — Earliest Expiry First)</strong>.',
            'Enter the <strong>Actual (counted) quantity</strong> found on the shelf and write a clear <strong>Reason</strong> (e.g., <em>Quarterly physical recount</em>).',
            'Click <strong>Save Adjustment</strong>. The system records the exact delta (e.g., <em>Adjusted 12 &rarr; 10</em>) in Inventory History and the Audit Trail.'
          ],
          tip: 'Dashboard reminders track your scheduled Inventory Check frequency so routine physical counts are never missed.'
        }
      ]
    },

    {
      id: 'manage-filters',
      roles: ['Admin'],
      title: 'Manage Filters & Master Data',
      shortTitle: 'Manage Filters',
      icon: 'filter',
      subtitle: 'Configuring Categories, Brands, Suppliers, and Motorcycle Compatibility.',
      cards: [
        {
          title: 'Maintaining Categories, Brands, Suppliers & Bikes',
          badges: [
            { label: 'Admin Only', tone: 'badge-danger' },
            { label: 'Master Lists', tone: 'badge-neutral' }
          ],
          intro: 'Click Manage Filters in the Inventory header to open the unified master data manager:',
          steps: [
            '<strong>Categories</strong>: Create or rename product categories (e.g., <em>Brakes, Engine Oils, Electrical</em>) or toggle them active/inactive. Note: The default <em>Others</em> category is system-protected.',
            '<strong>Brands</strong>: Register part manufacturers (e.g., <em>NGK, Motul, Bosch</em>). Renaming a brand automatically updates all products using it.',
            '<strong>Suppliers</strong>: Store supplier company names, contact persons, phone numbers, emails, and addresses for Stock-In tracking.',
            '<strong>Motorcycle Compatibility</strong>: Add motorcycle makes (e.g., <em>Honda, Yamaha</em>) and models (e.g., <em>Click 125i, NMAX 155</em>) to power the POS "Fits my bike" filter.'
          ],
          tip: 'Categories, brands, or motorcycle models that are still assigned to existing products are protected from accidental deletion.'
        }
      ]
    },

    {
      id: 'sales-reversals',
      roles: ['Admin'],
      title: 'Sales Reversals & Void Sale',
      shortTitle: 'Sales Reversals',
      icon: 'sales',
      subtitle: 'Authorizing Voids, Cancellations, and Refunds with automatic restocking.',
      cards: [
        {
          title: 'How to Void, Cancel, or Refund a Sale',
          badges: [
            { label: 'Admin Only', tone: 'badge-danger' },
            { label: 'Auto-Restock', tone: 'badge-ok' }
          ],
          intro: 'To reverse a completed sale and restore its items to inventory:',
          steps: [
            'Open the <strong>Sales</strong> menu, locate the transaction in the <strong>Transactions</strong> tab, and click <strong>Void / Refund</strong>.',
            'Choose the reversal <strong>Action</strong>: <em>Void (entry error / cashier mistake)</em>, <em>Cancel (customer changed mind)</em>, or <em>Refund (returned after sale)</em>.',
            'Enter a mandatory <strong>Reason</strong> explaining why the transaction is being reversed and click <strong>Confirm</strong>.',
            'Every line item is automatically returned to inventory as a <strong>Void Restock</strong> movement referencing the Sale ID in parentheses, e.g., <em>Voided sale (SALE-0070)</em>, and linked warranties are voided.'
          ],
          tip: 'Reversing a sale is permanent and immediately adjusts daily net revenue calculations across the Dashboard and Sales Analysis tabs.'
        }
      ]
    },

    {
      id: 'staff-governance',
      roles: ['Admin'],
      title: 'Staff & Shift Governance (Manage Users)',
      shortTitle: 'Manage Users',
      icon: 'userPlus',
      subtitle: 'Creating employee accounts, assigning roles, and auditing shift attendance.',
      cards: [
        {
          title: 'Managing Accounts & Reviewing All-Staff Shifts',
          badges: [
            { label: 'Admin Only', tone: 'badge-danger' },
            { label: 'Team Access', tone: 'badge-neutral' }
          ],
          intro: 'Control who can sign in to TeamMotor from the Users menu:',
          steps: [
            '<strong>Create Account</strong>: Click <strong>+ Add User</strong>, enter the employee&rsquo;s full name, username, email, and initial password, and assign either the <strong>Staff</strong> or <strong>Admin</strong> role.',
            '<strong>Status & Role Updates</strong>: Edit an employee to change their role, reset a forgotten password, or set their status to <em>Inactive</em> to revoke login access.',
            '<strong>Shift Attendance Logs</strong>: Click the <strong>Shifts</strong> (clock) button on any staff row to inspect their clock-in/out history, active duty status, and total hours worked.'
          ],
          tip: 'To prevent accidental lockouts, the system prevents you from deleting your own currently signed-in Admin account.'
        }
      ]
    },

    {
      id: 'settings-audit',
      roles: ['Admin'],
      title: 'Shop Settings & Audit Trail',
      shortTitle: 'Settings & Audit',
      icon: 'history',
      subtitle: 'Configuring VAT & receipt formatting and inspecting the security audit log.',
      cards: [
        {
          title: 'Tax / Receipt Settings & System Audit Trail',
          badges: [
            { label: 'Admin Only', tone: 'badge-danger' },
            { label: 'Compliance', tone: 'badge-ok' }
          ],
          intro: 'Configure store-wide rules and monitor compliance from the sidebar:',
          steps: [
            '<strong>Settings (Receipt & VAT)</strong>: Customize receipt tagline, address, phone, TIN, and footer lines with a live 58mm receipt preview. Configure VAT mode (<em>VAT-inclusive</em>, <em>VAT-exclusive</em>, or <em>Disabled</em>) and the <strong>Expiration monitoring</strong> warning window (in months).',
            '<strong>Audit Trail</strong>: Open <strong>Audit Trail</strong> to filter system events by category (<em>Logins, Sales, Stock, Products, Filters, Customers, Warranties, Users, Settings</em>) or toggle <strong>Sensitive actions only</strong> to review high-risk operations.'
          ],
          tip: 'Use the Export CSV buttons in Inventory, Sales, and Audit Trail to download records for external accounting or presentations.'
        }
      ]
    }
  ];

  function getTopicsForRole(role) {
    const r = (role === 'Admin') ? 'Admin' : 'Staff';
    return GUIDE_TOPICS.filter(function (t) {
      return t.roles.indexOf(r) !== -1;
    });
  }

  let activeTopicId = '';
  let searchQuery = '';

  function ensureModalInjected() {
    if (document.getElementById('guideModalOverlay')) return;
    if (!document.body || document.body.hasAttribute('data-public')) return;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'guideModalOverlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'guideModalTitle');

    overlay.innerHTML =
      '<div class="modal modal-xl guide-modal">' +
        '<div class="modal-header guide-header">' +
          '<div class="guide-header-title">' +
            '<span class="guide-header-icon">' + guideIcon('book') + '</span>' +
            '<div>' +
              '<div class="flex items-center gap-8">' +
                '<h2 id="guideModalTitle">System User Guide &amp; Navigation</h2>' +
                '<span class="badge" id="guideRoleBadge"></span>' +
              '</div>' +
              '<p class="guide-header-sub" id="guideRoleSubtitle"></p>' +
            '</div>' +
          '</div>' +
          '<button type="button" class="modal-close" id="guideCloseBtn" data-close="guideModalOverlay" aria-label="Close User Guide">' +
            guideIcon('close') +
          '</button>' +
        '</div>' +
        '<div class="guide-toolbar">' +
          '<div class="search-input guide-search-wrap">' +
            guideIcon('search') +
            '<input type="text" id="guideSearchInput" placeholder="Search guidelines, workflows, or keywords (e.g. GCash, Stock In, Warranty)..." autocomplete="off">' +
            '<button type="button" class="guide-search-clear" id="guideSearchClear" aria-label="Clear search" style="display:none;">' +
              guideIcon('close') +
            '</button>' +
          '</div>' +
        '</div>' +
        '<div class="guide-body">' +
          '<nav class="guide-nav" id="guideNav" aria-label="Guide topics"></nav>' +
          '<div class="guide-content" id="guideContent"></div>' +
        '</div>' +
        '<div class="modal-footer guide-footer">' +
          '<span class="text-muted" id="guideFooterNote" style="font-size:.78rem;margin-right:auto;"></span>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeGuideModal();
    });

    const closeBtn = document.getElementById('guideCloseBtn');
    if (closeBtn) closeBtn.addEventListener('click', closeGuideModal);

    const doneBtn = document.getElementById('guideDoneBtn');
    if (doneBtn) doneBtn.addEventListener('click', closeGuideModal);

    const searchInput = document.getElementById('guideSearchInput');
    const clearBtn = document.getElementById('guideSearchClear');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        searchQuery = (searchInput.value || '').trim();
        if (clearBtn) clearBtn.style.display = searchQuery ? 'inline-flex' : 'none';
        renderGuideBody();
      });
    }
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        searchQuery = '';
        if (searchInput) {
          searchInput.value = '';
          searchInput.focus();
        }
        clearBtn.style.display = 'none';
        renderGuideBody();
      });
    }

    const navEl = document.getElementById('guideNav');
    if (navEl) {
      navEl.addEventListener('click', function (e) {
        const btn = e.target.closest('[data-guide-topic]');
        if (!btn) return;
        activeTopicId = btn.getAttribute('data-guide-topic');
        if (searchQuery) {
          searchQuery = '';
          if (searchInput) searchInput.value = '';
          if (clearBtn) clearBtn.style.display = 'none';
        }
        renderGuideBody();
        const contentEl = document.getElementById('guideContent');
        if (contentEl) contentEl.scrollTop = 0;
      });
    }
  }

  function renderCardHtml(card, topicTitle) {
    const badgesHtml = (card.badges || []).map(function (b) {
      return '<span class="badge ' + (b.tone || 'badge-neutral') + '">' + b.label + '</span>';
    }).join(' ');

    const stepsHtml = (card.steps || []).map(function (step, idx) {
      return '<li class="guide-step-item">' +
        '<span class="guide-step-num">' + (idx + 1) + '</span>' +
        '<div class="guide-step-text">' + step + '</div>' +
      '</li>';
    }).join('');

    const tipHtml = card.tip
      ? '<div class="guide-tip">' +
          '<span class="guide-tip-label">💡 Tip:</span> ' +
          '<span>' + card.tip + '</span>' +
        '</div>'
      : '';

    return '<article class="guide-card">' +
      (topicTitle ? '<div class="guide-card-topic">' + topicTitle + '</div>' : '') +
      '<div class="guide-card-head">' +
        '<h3>' + card.title + '</h3>' +
        (badgesHtml ? '<div class="guide-card-badges">' + badgesHtml + '</div>' : '') +
      '</div>' +
      (card.intro ? '<p class="guide-card-intro">' + card.intro + '</p>' : '') +
      '<ol class="guide-steps">' + stepsHtml + '</ol>' +
      tipHtml +
    '</article>';
  }

  function renderGuideBody() {
    ensureModalInjected();
    const role = currentRole();
    const topics = getTopicsForRole(role);
    if (!topics.length) return;

    if (!activeTopicId || !topics.some(function (t) { return t.id === activeTopicId; })) {
      activeTopicId = topics[0].id;
    }

    const roleBadge = document.getElementById('guideRoleBadge');
    const roleSub = document.getElementById('guideRoleSubtitle');
    const footerNote = document.getElementById('guideFooterNote');

    if (roleBadge) {
      roleBadge.className = 'badge ' + (role === 'Admin' ? 'badge-danger' : 'badge-ok');
      roleBadge.textContent = role === 'Admin' ? 'Admin Mode' : 'Staff Mode';
    }
    if (roleSub) {
      roleSub.textContent = role === 'Admin'
        ? 'Showing full store administration, catalog controls, audits, and staff operational guidelines.'
        : 'Showing guidelines tailored exclusively to your daily Staff workflows and permissions.';
    }
    if (footerNote) {
      footerNote.textContent = role === 'Admin'
        ? 'Signed in as Administrator — All ' + topics.length + ' system guide topics unlocked.'
        : 'Signed in as Staff — Showing ' + topics.length + ' operational topics relevant to your role.';
    }

    const navEl = document.getElementById('guideNav');
    const contentEl = document.getElementById('guideContent');
    if (!navEl || !contentEl) return;

    const q = searchQuery.toLowerCase();

    navEl.innerHTML = topics.map(function (t) {
      const isActive = !q && t.id === activeTopicId;
      return '<button type="button" class="guide-nav-btn' + (isActive ? ' active' : '') + '" data-guide-topic="' + t.id + '">' +
        guideIcon(t.icon) +
        '<span>' + t.shortTitle + '</span>' +
      '</button>';
    }).join('');

    if (q) {
      const matchedCards = [];
      topics.forEach(function (t) {
        const topicMatch = t.title.toLowerCase().indexOf(q) !== -1 || t.subtitle.toLowerCase().indexOf(q) !== -1;
        t.cards.forEach(function (c) {
          const textBlob = [c.title, c.intro || '', (c.steps || []).join(' '), c.tip || ''].join(' ').toLowerCase();
          if (topicMatch || textBlob.indexOf(q) !== -1) {
            matchedCards.push(renderCardHtml(c, t.title));
          }
        });
      });

      if (!matchedCards.length) {
        contentEl.innerHTML =
          '<div class="empty-state" style="padding:2.5rem 1rem;">' +
            guideIcon('search') +
            '<h3>No matching guidelines found</h3>' +
            '<p>Try searching for a different keyword such as <strong>POS</strong>, <strong>GCash</strong>, <strong>Stock In</strong>, or <strong>Warranty</strong>.</p>' +
          '</div>';
      } else {
        contentEl.innerHTML =
          '<div class="guide-topic-header">' +
            '<h3>Search Results (' + matchedCards.length + ')</h3>' +
            '<p>Showing matching workflows for &ldquo;' + (typeof Utils !== 'undefined' ? Utils.escapeHtml(searchQuery) : searchQuery) + '&rdquo;</p>' +
          '</div>' +
          matchedCards.join('');
      }
      return;
    }

    const currentTopic = topics.find(function (t) { return t.id === activeTopicId; }) || topics[0];
    contentEl.innerHTML =
      '<div class="guide-topic-header">' +
        '<h3>' + currentTopic.title + '</h3>' +
        '<p>' + currentTopic.subtitle + '</p>' +
      '</div>' +
      currentTopic.cards.map(function (c) { return renderCardHtml(c, ''); }).join('');
  }

  function openGuideModal() {
    ensureModalInjected();
    const np = document.getElementById('notifPanel');
    if (np) np.classList.remove('open');
    const dd = document.getElementById('accountDropdown');
    if (dd) dd.classList.remove('open');

    searchQuery = '';
    const searchInput = document.getElementById('guideSearchInput');
    const clearBtn = document.getElementById('guideSearchClear');
    if (searchInput) searchInput.value = '';
    if (clearBtn) clearBtn.style.display = 'none';

    renderGuideBody();
    if (typeof openModal === 'function') {
      openModal('guideModalOverlay');
    } else {
      const el = document.getElementById('guideModalOverlay');
      if (el) el.classList.add('open');
    }
  }

  function closeGuideModal() {
    if (typeof closeModal === 'function') {
      closeModal('guideModalOverlay');
    } else {
      const el = document.getElementById('guideModalOverlay');
      if (el) el.classList.remove('open');
    }
  }

  // Event delegation for #guideBtn across standard topbar and POS header
  document.addEventListener('click', function (e) {
    const btn = e.target.closest('#guideBtn');
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      openGuideModal();
    }
  });

  // Capture-phase keydown handler so Escape closes the guide cleanly even on POS terminal
  document.addEventListener('keydown', function (e) {
    const overlay = document.getElementById('guideModalOverlay');
    if (!overlay || !overlay.classList.contains('open')) return;
    if (e.key === 'Escape') {
      closeGuideModal();
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, true);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureModalInjected);
  } else {
    ensureModalInjected();
  }

  window.UserGuide = {
    open: openGuideModal,
    close: closeGuideModal,
    getTopicsForRole: getTopicsForRole
  };
})();
