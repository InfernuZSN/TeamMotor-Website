# Summary of changes (prototype → backend release)

## Architecture
* **New `server/`** — Express API, Mongoose schemas for all 14 requested collections (+ `counters`, `physical_counts`),
  JWT auth with bcrypt, server-side role checks, audit logging, seed script, logic tests.
* **`public/js/store.js` replaced.** `Store.get()` still works synchronously (page scripts barely changed) but reads an
  in-memory copy loaded from `GET /api/bootstrap`; all changes go through `Api.post/put/del`. `Boot.ready()` runs each
  page script after login check + data load. Page scripts were wrapped with `Boot.ready` / `Boot.dom`.
* **Frontend files that now call the API:** `login.html` (real login), `app.js` (JWT session, nav), `pos.js`,
  `pos-receipt.js`, `sales.js`, `inventory.js`, `suppliers.js`, `users.js`, `profile.js` (profile/photo/password/shifts),
  `warranty.js`, `notifications.js`, `shifts.js`. The quick “log in as role” buttons and “Reset demo data” were removed.

## Features
1. **Backend + MongoDB** — done; see README / `docs/MONGODB_SCHEMA.md`.
2. **Physical count & discrepancy** — new `counts.html`, `/api/counts`; admin-approved adjustments; history kept.
3. **Expiration monitoring** — product field, badges/filter/banner, dashboard card, `expiring-soon` / `expired` notifications, `/api/reports/expiry`, expired items blocked at POS.
4. **Void / Cancel / Refund** — Admin-only, reason required, stock restored, reverse transactions, status updated, analytics exclude non-completed sales.
5. **Receipt reprint** — Sales row, sale details, POS success screen; DUPLICATE marking, reprint date/time, audit-logged.
6. **Customers page** — new `customers.html`; POS quick-add; soft delete.
7. **Maya** (and **Other**) added to POS, summaries and CSV.
8. **Audit trail** — new `audit.html`, `/api/audit` (Admin).
9. **VAT (default 12%)**, **Settings page**, **80 mm receipt** with VATable/VAT lines and shared renderer (`js/receipt.js`).

## Behaviour changes worth knowing
* Sale prices/totals are computed by the server; the browser only sends product ids and quantities.
* Stock edits no longer happen from the product form (Stock In/Out, Adjust, or a Count instead) — same as before in the UI, now enforced.
* Products, categories, suppliers, users, settings are Admin-only on the server (the UI already implied this for some of them).
* Password rule for new/changed passwords: 8+ characters with a letter and a number.
* Sales have a `status`; only `Completed` counts toward revenue, customer totals and charts.

# POS terminal redesign (step 1 of the HCI redesign)
* `pos.html`, `css/pos.css`, `js/pos.js` rebuilt as a single-screen touch terminal; `js/pos-receipt.js` removed (its job is now inside pos.js, using the shared `receipt.js`).
* Colour-coded categories (tab, tile, cart line); 11 shop categories; demo products for the new ones.
* Payment methods Cash / GCash / Maya / Bank Transfer / Other accepted by the server and offline API (the Sale model already allowed them).
* Hold / resume orders (saved in the browser, shared by this terminal), barcode auto-add, "Fits my bike" filter, discount chips, keypad payment modal, receipt screen + New Sale.
* `server/src/services/categories.js` + `ensureDefaultCategories()` in local-api.js add/rename categories in an existing database without touching custom names.

# Steps 2-3 of the HCI redesign
* POS restyled to the shared light theme (paper / surface / border / ink from css/style.css); auto-prints the receipt on sale (toggle on the receipt screen).
* Stock Count removed: counts.html, js/counts.js, nav link, /counts API (server + offline), PhysicalCount model, and the count-based notifications.
* Suppliers merged into Inventory (Admin): Suppliers button -> Manage Suppliers modal (search, add, edit, view products supplied + purchase history). suppliers.html, js/suppliers.js and the nav link removed. The /suppliers API is unchanged.
* Seed supplier emails were the placeholder text "[email protected]" (blocked editing); replaced with valid sample addresses.

# Step 4: Dashboard
* index.html / js/dashboard.js rebuilt: six live status cards (Today's Sales vs. same time yesterday, Total Products, Low Stock, Out of Stock, Products Sold with a Today / 7 days / 30 days period, Upcoming Warranties). Green = good, red = low/critical, neutral = informational; each has a text cue (checkmark / "!" / arrows), not just colour.
* The five stacked sections are now ONE panel with filter chips (Recent Sales, Sales Trend, Low Stock, Out of Stock, Expiring, Warranties, Recent Stock-In, Top / Slow Sellers) that scrolls inside itself, so the page fits one screen. Cards are clickable shortcuts to the matching view.
* All numbers are calculated from the live Store (Inventory + POS data). The "categories" figure no longer comes from the static demo seed. The page refreshes itself every 30 s and when the tab regains focus.
* js/local-api.js: the offline store now adopts a newer copy saved by another tab before serving a request (fixes stale numbers across tabs and a lost-update risk).

# Step 5: Inventory and Sales cleanup
* Inventory: "Recent Stock Activity" card, the stat cards and the expiry banner are removed; the product list now starts at the top of the page. One slim row of status chips (All / In Stock / Low / Out / Expiring Soon / Expired, each with a live count) replaces them and doubles as a quick filter. Product and supplier columns widened so more rows fit.
* Inventory History: a dedicated Reason column with badges (Sold, Returned, Damaged, Lost, Expired, Internal Use, Other, Received, Adjusted), a Reason filter, and a separate Reference / Notes column. Stock In / Stock Out / Adjust are unchanged.
* Sales: the first tab is now "Transactions": a full-width orders list with search (plus the existing period filter, CSV export, view and reprint). The KPI cards and Payment Method Summary moved into the "Sales Analysis" tab (the summary has its own period filter). All figures come from live POS data; nothing is taken from demo seed data.

## Inventory chips removed, Audit View modal, Product Activity reasons
- inventory.html / inventory.js / style.css: removed the status chip row (invStatusChips) and its JS/CSS. The All Statuses dropdown is unchanged.
- audit.html / audit.js: added a View button per row opening a full-detail modal (when, who, role, action, entity, record ID, IP, all details keys pretty-printed, before/after changes). Works online and offline; no server change needed (API already returns full rows).
- inventory.js: Product View > Activity now shows the same Sold / Returned / Damaged / Lost / Received / Adjusted reason badges plus notes as the History tab.

## Production hardening
**Audit** — server routes + `local-api.js` now write matching enriched details (names, before/after changed fields only, never passwords/hashes). `settings.update` is `{ changed: {key:{from,to}} }`. Admin password reset writes `user.update` (passwordReset:true) AND `user.password_change` (changedBy:'admin'). Audit page: friendly labels (stored codes unchanged), one-line summaries, "Sensitive only" filter (`GET /audit?sensitive=1`), View modal with Summary + Before/After table + full details, server-side pagination.
**Void / discount** — Void: Admin-only API, reason required (API + UI), dialog shows sale total; Staff get a clear message. Discount: **Option A, Admin only**, enforced in `createSale` (server + offline) and in the POS UI. Sale stores `discountMode` / `discountValue`; audit `sale.create` includes them. No new settings keys.
**End of day** — "Today's sales summary" on Sales → Transactions: completed (count/₱), voided today, net, discounts, Cash/GCash/Maya/Bank Transfer/Other breakdown. Read-only, live data, no cash-drawer count.
**58 mm receipt (OC-58IIH)** — `@page 58mm`, 50 mm content, item rows re-flowed (name line, then qty × price … amount). Wording stays "SALES RECEIPT". No drawer commands.
**Inventory layout** — fixed-layout tables, no horizontal scroll ≥ ~900px, Last Updated / Brand / Supplier columns drop out as the window narrows, truncation with tooltips, page fits the viewport and only the table body scrolls; pager under the table.
**Pagination** — shared `createPager()` in `app.js` (25/50 rows): Inventory Products + History, Sales Transactions, Customers, Warranty (client-side), Audit (server-side). Filters/search reset to page 1.

Shop setup: set OC-58IIH as the Windows default printer (paper 58 mm, margins minimal). C986 scanner keeps its Enter suffix.

## Revised prompts (8 tasks)
1. **Manage Suppliers modal** — fixed-layout table (no horizontal scroll), 10 rows/page with Previous/Next + numbers + "Showing a–b of n"; supplier name, contact line and email truncate with tooltips; search resets to page 1; pager is a fixed footer of the list.
2. **Stock In / Stock Out** — Product dropdown removed; the product from the clicked inventory row is shown read-only (`#sProductLabel`) and carried in a hidden `#sProduct`; saving is refused if that product no longer exists.
3. **Product View** — Sales and Activity tabs paginate at 10/page with independent page state (each resets to page 1 when a product is opened); the old "latest 8" limit is gone.
4. **Payments** — new sales accept Cash and GCash only (POS UI, `local-api.js`, `server/src/services/sales.js`; unsupported values return 400). The Sale model enum and reports still recognise Maya / Bank Transfer / Other so history is untouched. New constants: `LEGACY_PAYMENT_METHODS`, `ALL_PAYMENT_METHODS` (mock-data.js).
5. **Payment modal** — header / scrolling body / pinned footer (Cancel + Confirm), capped to the viewport; compact spacing under 820px tall.
6. **Login** — Sign up link removed (signup.html file left in place, unlinked).
7. **Login hero/typography** — complete artwork (`img/sidebar-logo.jpg`, `object-fit: contain`) over a dark panel; one Inter-based type scale for labels, inputs, buttons and notes.
8. **Users page** — shows `user.photo` (the field the Profile page saves) in the circular avatar; initials remain as the fallback.

## Audit consistency fixes
- **Seed customer emails**: CUST-001..006 had the placeholder text "[email protected]" (blocked editing); replaced with `<username>@mail.example`. `local-api.js` `fixPlaceholderEmails()` repairs browsers that already saved the old data. The server seed reads the same fixtures.
- **Voiding sales with retired products** (e.g. the MOT-00x motorcycle history): lines whose product no longer exists are skipped instead of blocking the void; the void result and its audit entry carry `restockSkipped: [{ productId, name, qty, reason }]`. Other restock failures still block (unchanged). Server (`services/sales.js`, `routes/sales.js`) and offline (`local-api.js`) match.
- **Profile password**: removed the "not available yet" notice; added a **Save Password** submit button and a **Clear** button (the old "Reset Password" button only cleared the form).
- **Sales trend chart**: removed the old 7/14-day handler from `sales.js` (it called `parseInt('week')` → NaN); `sales-trend.js` is now the only handler, without capture-phase / `stopPropagation`.
- **Notifications**: items get `is-read` / `is-unread` classes with matching styles, so read alerts look different.
- **signup.html** removed (it was unlinked; self-registration is disabled).
- **Receipt docs**: Settings preview label and README now say 58 mm, matching `@page 58mm`.
