/* ==========================================================================
   MongoDB schemas (Mongoose)
   --------------------------------------------------------------------------
   Every document carries a human-readable business id in `id` (e.g. SALE-0001,
   LGT-001, CUST-007). That is what the frontend already uses, so API payloads
   keep the exact shape of the old prototype. MongoDB's own `_id` / `__v` are
   stripped from JSON output.

   Collections:
     users, categories, suppliers, products, customers,
     sales, sale_items, inventory_transactions,
     warranties, warranty_claims, notifications, shifts,
     audit_logs, settings, counters
   ========================================================================== */
const { mongoose } = require('../db');
const { Schema } = mongoose;

function make(name, collection, definition, opts) {
  const schema = new Schema(definition, Object.assign({
    collection,
    versionKey: false,
    toJSON: {
      virtuals: false,
      transform(doc, ret) { delete ret._id; delete ret.__v; return ret; }
    }
  }, opts || {}));
  return { schema, model: mongoose.model(name, schema) };
}

const idField = { type: String, required: true, unique: true, index: true };

/* ---------- users ---------- */
const User = make('User', 'users', {
  id: { ...idField },
  name: { type: String, required: true, trim: true },
  username: { type: String, required: true, unique: true, lowercase: true, trim: true },
  email: { type: String, trim: true, lowercase: true, default: '' },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ['Admin', 'Staff'], required: true },       // Admin = Owner, Staff = Cashier
  status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' },
  dateAdded: { type: String },
  birthDate: { type: String, default: '' },
  contactNumber: { type: String, default: '' },
  photo: { type: String, default: '' },                                   // resized data URL
  tokenVersion: { type: Number, default: 0 },                             // bump to invalidate old JWTs
  lastLoginAt: { type: Date }
}, {
  toJSON: { transform(doc, ret) { delete ret._id; delete ret.__v; delete ret.passwordHash; delete ret.tokenVersion; return ret; } }
});

/* ---------- categories / suppliers ---------- */
const Category = make('Category', 'categories', {
  id: { ...idField },
  name: { type: String, required: true, trim: true },
  prefix: { type: String, required: true, uppercase: true, trim: true },
  status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' }
});

const Supplier = make('Supplier', 'suppliers', {
  id: { ...idField },
  name: { type: String, required: true, trim: true },
  contactPerson: { type: String, default: '' },
  contactNumber: { type: String, default: '' },
  email: { type: String, default: '' },
  address: { type: String, default: '' },
  lastDelivery: { type: String, default: '' },
  status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' }
});

/* ---------- products ---------- */
const Product = make('Product', 'products', {
  id: { ...idField },
  name: { type: String, required: true, trim: true },
  brand: { type: String, default: '' },
  category: { type: String, required: true, index: true },                // categories.id
  compatibility: { type: [String], default: [] },
  compatYears: { type: String, default: 'All Years' },
  supplier: { type: String, default: '' },                                // suppliers.id
  supplierRef: { type: String, default: '' },
  sku: { type: String, default: '', index: true },
  barcode: { type: String, default: '', index: true },
  description: { type: String, default: '' },
  costPrice: { type: Number, default: 0, min: 0 },
  sellingPrice: { type: Number, required: true, min: 0 },
  stock: { type: Number, default: 0, min: 0 },
  reorderLevel: { type: Number, default: 0, min: 0 },
  warrantyDuration: { type: Number, default: null },
  warrantyUnit: { type: String, default: null },
  warrantyType: { type: String, default: null },
  warrantyDays: { type: Number, default: null },
  rubber: { type: Boolean, default: false },
  expirationDate: { type: String, default: null },                        // optional 'YYYY-MM-DD'
  image: { type: String, default: '' },
  storageLocation: { type: String, default: '' },
  archived: { type: Boolean, default: false },
  lastUpdated: { type: String }
});

/* ---------- customers ---------- */
const Customer = make('Customer', 'customers', {
  id: { ...idField },
  name: { type: String, required: true, trim: true },
  contactNumber: { type: String, required: true, trim: true },
  email: { type: String, default: '' },
  address: { type: String, default: '' },
  username: { type: String, default: '' },
  notes: { type: String, default: '' },
  dateRegistered: { type: String },
  status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' }  // soft delete = Inactive
});

/* ---------- sales + sale_items ---------- */
const Sale = make('Sale', 'sales', {
  id: { ...idField },
  date: { type: String, required: true, index: true },                    // ISO timestamp
  subtotal: { type: Number, required: true },
  discount: { type: Number, default: 0 },
  discountMode: { type: String, default: null },                           // 'percent' | 'amount' (how the cashier entered it)
  discountValue: { type: Number, default: 0 },
  vatEnabled: { type: Boolean, default: true },
  vatMode: { type: String, enum: ['inclusive', 'exclusive'], default: 'inclusive' },
  vatRate: { type: Number, default: 0.12 },
  vatableAmount: { type: Number, default: 0 },
  vatAmount: { type: Number, default: 0 },
  total: { type: Number, required: true },
  paymentMethod: { type: String, enum: ['Cash', 'GCash', 'Maya', 'Bank Transfer', 'Other'], required: true },   // Maya / Bank Transfer / Other = legacy history only; new sales are Cash or GCash (services/sales.js)
  amountReceived: { type: Number, default: 0 },
  changeAmount: { type: Number, default: 0 },
  reference: { type: String, default: null },
  status: { type: String, enum: ['Completed', 'Voided', 'Cancelled', 'Refunded', 'Pending'], default: 'Completed', index: true },
  paymentStatus: { type: String, default: 'Paid' },
  staff: { type: String, default: '' },                                   // display name (kept for receipts/CSV)
  staffUsername: { type: String, default: '' },
  customerId: { type: String, default: null, index: true },
  shop: { type: Schema.Types.Mixed, default: null },                      // snapshot of shop details at time of sale (for faithful reprints)
  voidInfo: {
    type: { type: String },                                               // Voided | Cancelled | Refunded
    reason: String, by: String, byUsername: String, at: String
  },
  reprintCount: { type: Number, default: 0 },
  lastReprintAt: { type: String, default: null },
  clientRequestId: { type: String, index: { unique: true, sparse: true } }   // double-submit protection (idempotency key from the POS)
});

const SaleItem = make('SaleItem', 'sale_items', {
  saleId: { type: String, required: true, index: true },
  productId: { type: String, required: true, index: true },
  name: { type: String, required: true },
  qty: { type: Number, required: true, min: 1 },
  price: { type: Number, required: true },
  costPrice: { type: Number, default: 0 },
  subtotal: { type: Number, required: true }
});

/* ---------- inventory_transactions ---------- */
const InventoryTransaction = make('InventoryTransaction', 'inventory_transactions', {
  id: { ...idField },
  productId: { type: String, required: true, index: true },
  productName: String,
  type: { type: String, enum: ['Stock In', 'Stock Out', 'Sale', 'Void Restock', 'Adjustment'], required: true },
  quantity: { type: Number, required: true },                             // signed
  previousStock: Number,
  newStock: Number,
  date: { type: String, required: true, index: true },
  created_at: String,
  user: String,
  supplierId: { type: String, default: null },
  reference: { type: String, default: null },
  reason: { type: String, default: null },
  notes: { type: String, default: '' }
});

/* ---------- warranties + warranty_claims ---------- */
const Warranty = make('Warranty', 'warranties', {
  id: { ...idField },
  customerId: { type: String, default: null, index: true },
  saleId: { type: String, default: null, index: true },
  productId: { type: String, required: true },
  productName: String,
  purchaseDate: String,
  warrantyStart: String,
  warrantyExpiration: String,
  coverage: String,
  status: { type: String, default: 'Active' },                            // Active | Expiring Soon | Expired | Claimed | Voided
  notes: String
});

const WarrantyClaim = make('WarrantyClaim', 'warranty_claims', {
  id: { ...idField },
  warrantyId: { type: String, required: true, index: true },
  date: String,
  description: String,
  resolution: String,
  status: { type: String, default: 'Pending' },                           // Pending | Approved | Resolved | Rejected
  staff: String
});

/* ---------- notifications ---------- */
const Notification = make('Notification', 'notifications', {
  id: { ...idField },
  key: { type: String, required: true, unique: true },                    // `${type}:${refId}` — one live alert per condition
  type: { type: String, required: true },                                 // low-stock | out-of-stock | restock-reminder | expiring-soon | expired | warranty-expiring
  productId: String,
  warrantyId: String,
  title: String,
  message: String,
  link: String,
  date: String,
  read: { type: Boolean, default: false }
});

/* ---------- shifts ---------- */
const Shift = make('Shift', 'shifts', {
  id: { ...idField },
  username: { type: String, required: true, index: true },
  name: String,
  clockIn: { type: String, required: true },
  clockOut: { type: String, default: null }
});

/* ---------- audit_logs ---------- */
const AuditLog = make('AuditLog', 'audit_logs', {
  id: { ...idField },
  at: { type: Date, default: Date.now, index: true },
  userId: String, username: String, userName: String, role: String,
  action: { type: String, required: true, index: true },                  // e.g. sale.create, sale.void, sale.reprint, stock.adjust, auth.login
  entity: String, entityId: String,
  details: { type: Schema.Types.Mixed, default: {} },
  ip: String
});

/* ---------- settings (single document, key = 'shop') ---------- */
const Setting = make('Setting', 'settings', {
  key: { type: String, required: true, unique: true },
  shopName: { type: String, default: 'TeamMotor' },
  tagline: { type: String, default: 'MOTORCYCLE PARTS & ACCESSORIES SHOP' },
  addressLines: { type: [String], default: ['1234 Highway, Brgy. San Isidro', 'Quezon City, Metro Manila'] },
  phone: { type: String, default: '' },
  tin: { type: String, default: '' },
  vatEnabled: { type: Boolean, default: true },
  vatRate: { type: Number, default: 0.12, min: 0, max: 1 },
  vatMode: { type: String, enum: ['inclusive', 'exclusive'], default: 'inclusive' },
  receiptFooter: { type: [String], default: ['Thank you for your purchase!', 'Ride \u2022 Repair \u2022 Repeat'] },
  expiryWarningMonths: { type: Number, default: 3, min: 1, max: 24 },
  updatedBy: String,
  updatedAt: String
});

/* ---------- counters (atomic sequence generator) ---------- */
const Counter = make('Counter', 'counters', {
  _id: String,
  seq: { type: Number, default: 0 }
});

module.exports = {
  User: User.model, Category: Category.model, Supplier: Supplier.model, Product: Product.model,
  Customer: Customer.model, Sale: Sale.model, SaleItem: SaleItem.model,
  InventoryTransaction: InventoryTransaction.model, Warranty: Warranty.model,
  WarrantyClaim: WarrantyClaim.model, Notification: Notification.model, Shift: Shift.model,
  AuditLog: AuditLog.model, Setting: Setting.model, Counter: Counter.model
};
