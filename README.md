# TeamMotor — Motorcycle Shop Inventory + POS

Node.js + Express REST API, MongoDB (local or Atlas), and the existing vanilla HTML/CSS/JS frontend.

```
teammotor/
├─ START-HERE.html    Double-click to open the app (offline mode)
├─ public/            Frontend (HTML, CSS, vanilla JS) — served by Express
│  ├─ js/store.js     API client + in-memory cache + page bootstrapper; picks server or offline mode
│  └─ js/local-api.js Offline mode: the API running in the browser (localStorage)
├─ server/
│  ├─ src/models      Mongoose schemas (the MongoDB schema)
│  ├─ src/routes      auth, users/shifts, catalog (products/categories/suppliers), customers, sales,
│  │                  inventory, warranties, notifications/audit/settings/reports/bootstrap
│  ├─ src/services    sales (checkout/void), inventory (atomic stock), notifications, expiry, settings
│  ├─ src/middleware  JWT auth + role guard, error handler
│  ├─ scripts/seed.js Seed data
│  └─ test/           Pure-logic tests (VAT, dates, warranty status)
└─ docs/              MONGODB_SCHEMA.md, CHANGES.md
```

## Quick start — no install (double-click)

1. Unzip the folder.
2. Double-click **`START-HERE.html`** (or `public/login.html`). Use **Chrome or Edge**.
3. Log in — Admin: `ronnie.manalo` / `Admin@12345` · Staff: `juan.delacruz` / `Staff@12345`.

No terminal, Node.js or MongoDB needed. In this **Offline mode** the app runs the same rules as the server
(`public/js/local-api.js`: VAT, stock, void/refund, audit, Admin/Staff permissions) and saves everything in
the browser. A badge at the bottom-left shows the mode; click it to reset to the original demo data.

Offline mode limits: data lives only in that one browser on that one computer (not shared between devices), clearing
browser data erases it, and there is no real security (passwords are only checked by the page itself). It is meant for
trying, demos and a single-counter setup. It also works if you upload the `public` folder to any free static host
(Netlify, GitHub Pages…). Firefox may not keep data between pages when opened from a file; use Chrome/Edge or a static host.
Use the Node + MongoDB server below when you need shared, protected, backed-up data — the same pages switch to it
automatically when served by the server.

## Run the real server (Node.js + MongoDB)

Requirements: **Node.js 18+** and **MongoDB** (local install, Docker, or a free MongoDB Atlas cluster).

```bash
cd server
npm install
cp .env.example .env          # then edit .env (see below)
npm run seed                  # loads demo data (use `npm run seed:reset` to wipe and reload)
npm start                     # http://localhost:3000
```

Open <http://localhost:3000>. The API and the frontend share one origin, so no CORS setup is needed.

**`.env`**

| Variable | Meaning |
|---|---|
| `MONGODB_URI` | Local: `mongodb://127.0.0.1:27017/teammotor` · Atlas: `mongodb+srv://USER:PASS@CLUSTER.mongodb.net/teammotor` |
| `JWT_SECRET` | Long random string (`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`). Required in production. |
| `JWT_EXPIRES_IN` | Session length, default `8h` |
| `PORT` | default `3000` |
| `CORS_ORIGINS` | Only if the frontend is hosted on another origin (also set `window.TEAMMOTOR_API_BASE` in the HTML) |
| `SEED_ADMIN_PASSWORD`, `SEED_STAFF_PASSWORD` | Passwords the seed script gives the demo accounts |

**MongoDB options**

* *Local:* install MongoDB Community, or `docker run -d -p 27017:27017 --name mongo mongo:7`.
* *Atlas:* create a free cluster → Database Access (user + password) → Network Access (allow your IP) → Connect →
  Drivers → copy the `mongodb+srv://` string into `MONGODB_URI`.

**Demo logins** (after `npm run seed`; change them after first login)

| Role | Username | Password |
|---|---|---|
| Admin / Owner | `ronnie.manalo` | `Admin@12345` |
| Staff / Cashier | `juan.delacruz` | `Staff@12345` |

Set `TZ=Asia/Manila` in the server environment so "today", expiry and warranty dates follow shop time.
The seeded sales are dated in the past, so "Today's sales" starts at ₱0 until you ring up a sale.

Tests: `cd server && npm test` (no database needed).

## Roles (enforced on the server, not just hidden in the UI)

| Action | Staff / Cashier | Admin / Owner |
|---|---|---|
| POS checkout, view sales, reprint receipts | ✔ | ✔ |
| POS discount application (Admin authorization required) | ✘ | ✔ |
| Customers: view, add, edit | ✔ | ✔ (+ deactivate / reactivate) |
| Add new product (Inventory "+ Add Product") | ✔ | ✔ |
| Edit product details, archive / unarchive products | ✘ | ✔ |
| Categories & Suppliers management | ✘ | ✔ |
| Stock In / Stock Out / Adjust (with reason & notes) | ✔ | ✔ |
| Void / cancel / refund a sale (with reason & restock) | ✘ | ✔ |
| Users, Audit Trail, Settings | ✘ | ✔ |

## Feature guide

* **Auth & Security** — bcrypt-hashed passwords, JWT (Bearer) signed with token version invalidation. Deactivating a user,
  changing a role, or resetting a password immediately invalidates active sessions across all devices. Login includes rate limiting,
  failed login auditing, and an interactive password reveal/hide toggle button matching the Profile security menu.
* **POS** — Single-screen counter interface for walk-in or registered customers (with inline customer registration),
  live barcode/SKU scanner search, motorcycle model filtering, line item quantity adjustments, and **12% VAT** calculation
  (inclusive/exclusive). Payment accepts **Cash** (with exact centavo precision) and **GCash** (with reference number recording).
  Checkout executes atomically: stock decrements verify inventory availability (`$gte`), generate warranty records, and roll back
  automatically upon error. A per-checkout `clientRequestId` idempotency key prevents duplicate transactions or double-charging.
* **Void / Cancel / Refund** — Accessible to Administrators from the Sales transactions list (reason required). Restores physical
  stock, records reverse `Void Restock` transactions, marks linked warranties voided, updates sale status, and writes full audit entries.
  Voiding historical sales with retired catalog items (e.g., legacy motorcycle vehicles) gracefully skips restock for those items with
  logged audit warnings without throwing 409 conflict errors. Voided/refunded sales are strictly excluded from revenue metrics.
* **Today's Sales Summary & Trends** — The Sales page features an end-of-day summary card displaying completed sales totals,
  voided amounts, net revenue, total discounts applied, and full payment method breakdowns. An interactive Sales Trend chart
  provides 1 Week, 1 Month, and 1 Year aggregate sales visualization.
* **Receipt reprint** — button on every sale row, the sale details dialog, and the POS success screen. Rebuilt faithfully from the
  stored transaction (items, unit prices, VAT, tender, and store details *as they existed at sale time*), stamped
  **DUPLICATE COPY — REPRINT** with reprint counter and audit metadata.
  Layout targets standard 58 mm thermal rolls (OC-58IIH, `@page size: 58mm auto; margin: 2mm;`).
* **Expiration monitoring** — optional expiry date on products. Inventory shows Expired / Expiring Soon badges, a filter and a
  banner; the Dashboard shows a card; the bell gets “Expiring soon” (within `expiryWarningMonths`, default 3) and “Expired”
  alerts. Expired items cannot be sold at the POS.
* **Customers** — list with Total Purchases / Total Spent / Last Purchase (completed sales only), search, Active/Inactive
  filter, add/edit (name + phone required, duplicate phone rejected, valid sample email domain formatting), details with
  purchase history and warranties, soft delete (Inactive) that keeps history.
* **Audit Trail** — Admin-only compliance viewer with full text search, action dropdown, sensitive-event filter, inline aligned
  date range pickers ("From" and "To"), pagination, and CSV export. Each row includes a centered **View** button opening a detailed
  modal displaying complete event payloads and before/after diffs.
* **Settings & Profile** — Configurable shop name, tagline, address lines, phone, TIN, receipt footer, VAT rate, and expiry window
  with live 58 mm receipt preview. The user Profile page supports photo uploads, staff shift tracking, and active password updates
  via a dedicated Save Password button.

## API overview

All routes are under `/api`, JSON in/out, `Authorization: Bearer <token>` except login.

| Route | Notes |
|---|---|
| `POST /auth/login` · `GET /auth/me` · `POST /auth/logout` | |
| `GET /bootstrap` | everything a page needs, in one call |
| `GET/POST /products` · `PUT /products/:id` · `POST /products/:id/archive` · `GET /products/lookup/:code` | update/archive Admin |
| `GET/POST/DELETE /categories` · `GET/POST/PUT /suppliers` | writes Admin |
| `GET/POST /customers` · `GET/PUT /customers/:id` · `DELETE /customers/:id` (soft) · `POST /customers/:id/reactivate` | delete/reactivate Admin |
| `GET/POST /sales` · `GET /sales/:id` · `POST /sales/:id/void` · `POST /sales/:id/reprint` | void Admin |
| `GET /inventory/transactions` · `POST /inventory/stock-in` · `/stock-out` · `/adjust` | adjust with reason |
| `GET /warranties` · `POST /warranties/:id/claims` | |
| `GET /notifications` · `POST /notifications/read-all` · `POST /notifications/:id/read` | |
| `GET /audit` | Admin |
| `GET/PUT /settings` | write Admin |
| `GET /reports/expiry` | expired + expiring list |
| `/users` (Admin CRUD), `PUT /users/me/profile`, `PUT /users/me/password`, `/users/shifts/*` | |

## Notes & limits

* The browser keeps a read-only in-memory copy of the data loaded at page start (`/api/bootstrap`: latest 5,000 sales,
  3,000 stock movements). That is fine for a single shop; for very large histories add server-side paging to the
  Sales/History tables.
* `js/mock-data.js` is no longer used for data in the browser. It still provides the shared `Utils` helpers and is the
  fixture source for `npm run seed`.
* Card payments remain “unavailable” (no terminal integration). Self-registration stays closed — Admins create accounts.
* The JWT is stored in `localStorage` (simple and works for this app). Serve over HTTPS in production; the CSP in
  `server/src/app.js` limits scripts to same-origin plus the app’s inline handlers.
* The original MySQL schema (`sql/`) is intentionally removed — MongoDB replaces it.

## Automatic receipt printing (POS)
The POS prints the 58 mm receipt automatically when a sale is saved (switch it off with the checkbox on the receipt screen).
Browsers always show their print dialog unless started in kiosk-printing mode. For a one-tap counter, set the receipt printer as
the default printer and start Chrome/Edge with `--kiosk-printing` (for example `chrome.exe --kiosk-printing --app=http://localhost:3000/pos.html`).
