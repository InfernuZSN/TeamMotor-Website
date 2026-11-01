# TeamMotor — MongoDB schema

Database name: `teammotor` (any name works; set it in `MONGODB_URI`).
The schemas are defined with Mongoose in `server/src/models/index.js` — that file is the source of truth. Every document
has a human-readable business id in `id` (e.g. `SALE-0001`, `BRK-001`) which is what the UI shows and what other
collections reference. MongoDB's own `_id` is never exposed by the API.

| Collection | Purpose | Key fields | Indexes |
|---|---|---|---|
| `users` | Staff / owner accounts | `id`, `name`, `username`, `email`, `passwordHash` (bcrypt, never returned by the API), `role` (`Admin`\|`Staff`), `status`, `tokenVersion` | `id` unique, `username` unique |
| `categories` | Product categories | `id` (slug), `name`, `prefix` (3 letters used in product ids) | `id` unique |
| `suppliers` | Suppliers | `id`, `name`, contact fields, `status`, `lastDelivery` | `id` unique |
| `products` | Catalogue + live stock | `id`, `name`, `category`→categories, `supplier`→suppliers, `sku`, `barcode`, `costPrice`, `sellingPrice`, `stock`, `reorderLevel`, warranty fields, **`expirationDate`** (optional `YYYY-MM-DD`), `archived` | `id` unique, `category`, `sku`, `barcode` |
| `customers` | Customers (soft delete) | `id`, `name`, `contactNumber` (required), `email`, `status` (`Active`\|`Inactive`) | `id` unique |
| `sales` | Sale headers | `id`, `date`, `subtotal`, `discount`, `vatRate/vatMode/vatableAmount/vatAmount`, `total`, `paymentMethod` (`Cash`,`GCash`,`Maya`,`Bank Transfer`,`Other`), `amountReceived`, `changeAmount`, `reference`, **`status`** (`Completed`\|`Voided`\|`Cancelled`\|`Refunded`), `voidInfo{type,reason,by,at}`, `reprintCount`, `lastReprintAt`, `shop` (snapshot of shop details at sale time), `clientRequestId` | `id` unique, `date`, `status`, `customerId`, `clientRequestId` unique+sparse |
| `sale_items` | Sale lines | `saleId`→sales, `productId`, `name`, `qty`, `price`, `costPrice`, `subtotal` | `saleId`, `productId` |
| `inventory_transactions` | Every stock movement | `id`, `productId`, `type` (`Stock In`,`Stock Out`,`Sale`,`Void Restock`,`Adjustment`), signed `quantity`, `previousStock`, `newStock`, `reference`, `reason`, `user`, `date` | `id` unique, `productId`, `date` |
| `warranties` | One per warranted item sold | `id`, `saleId`, `customerId`, `productId`, `warrantyStart`, `warrantyExpiration`, `coverage`, `status` (`Voided` when the sale is voided) | `id` unique, `saleId`, `customerId` |
| `warranty_claims` | Claims against a warranty | `id`, `warrantyId`, `date`, `description`, `resolution`, `status`, `staff` | `id` unique, `warrantyId` |
| `notifications` | Live alerts (low/out of stock, restock reminder, **expiring-soon**, **expired**, warranty expiring) | `id`, `key` (`type:refId`), `type`, `message`, `read` | `key` unique |
| `shifts` | Clock in / out | `id`, `username`, `clockIn`, `clockOut` | `username` |
| `audit_logs` | Who did what | `id`, `at`, `userId/username/role`, `action`, `entity`, `entityId`, `details`, `ip` | `id` unique, `at`, `action` |
| `settings` | Single doc `key:'shop'` | shop name/address/phone/TIN, `vatEnabled`, `vatRate`, `vatMode`, `receiptFooter`, `expiryWarningMonths` | `key` unique |
| `counters` | Atomic id sequences | `_id` (e.g. `SALE`, `TRX`, `PRD-BRK`), `seq` | — |

## Relationships

```
categories 1─* products *─1 suppliers
customers  1─* sales 1─* sale_items *─1 products
sales      1─* warranties 1─* warranty_claims
products   1─* inventory_transactions
```

## Integrity rules the server enforces

* Stock can never go negative: every decrement is a conditional atomic update (`stock >= qty`).
* Sale totals, prices and VAT are recomputed on the server; the browser only sends product ids and quantities.
* A sale is claimed for void/cancel/refund with an atomic `status: 'Completed'` filter, so it cannot be reversed twice.
* No multi-document transactions are used, so everything works on a standalone local MongoDB as well as Atlas. If
  anything fails mid-checkout the stock decrements and partial documents are rolled back (`services/sales.js`).

## Seed data

`npm run seed` loads the same demo fixtures the prototype shipped with (15 products across 5 categories, 3 suppliers,
5 users, 6 customers, 42 sales with VAT breakdown, 75 stock movements, warranties, shifts) plus two perishable demo
products (one expiring in ~7 weeks, one already expired) so Expiration Monitoring has something to show.
