/* Manage Filters lists (brands + motorcycle compatibility) for an EXISTING database. Idempotent and non-destructive.
   Mirrors ensureDefaultFilters() in public/js/local-api.js.
     • brands: every brand already written on a product is added to the `brands` list, so existing products stay valid
       and show up in the Add / Edit Product brand dropdown. (A brand that is in use cannot be deleted, so this never
       brings back a brand an admin removed.)
     • motorcycle_compatibility: filled with the shop's default makes/models ONCE. The `counters` doc 'SEED-motorcycle-compatibility'
       remembers that, so makes an admin deletes stay deleted after a restart. */
const { Brand, MotorcycleCompatibility, Product, Counter } = require('../models');
const { mongoose } = require('../db');
const { nextId } = require('../utils/counters');

const UNIVERSAL_FIT = 'Universal (All Models)';
const DEFAULT_MOTORCYCLE_BRANDS = [                 // same list as MOTO_BRANDS in public/js/mock-data.js
  { name: 'Yamaha', models: ['NMAX', 'Aerox', 'Mio i125', 'Sniper 155'] },
  { name: 'Honda', models: ['Click 125i', 'Click 160', 'Beat', 'ADV 160'] },
  { name: 'Suzuki', models: ['Burgman Street', 'Raider R150', 'Skydrive'] }
];
const MOTO_SEED_MARKER = 'SEED-motorcycle-compatibility';

async function ensureDefaultFilters() {
  let brandsAdded = 0, makesAdded = 0;

  const used = (await Product.distinct('brand')).map(b => String(b || '').trim()).filter(Boolean).sort((a, b) => a.localeCompare(b));
  const have = new Set((await Brand.find({}).select('name')).map(b => b.name.toLowerCase()));
  for (const name of used) {
    if (have.has(name.toLowerCase())) continue;
    await Brand.create({ id: await nextId('BRD', 3), name });
    have.add(name.toLowerCase());
    brandsAdded++;
  }

  // If motorcycle_compatibility is empty, migrate from legacy collection if present, else seed defaults
  if (!(await MotorcycleCompatibility.countDocuments())) {
    let migrated = false;
    try {
      if (mongoose.connection && mongoose.connection.db) {
        const legacyDocs = await mongoose.connection.db.collection('motorcycle_brands').find({}).toArray();
        if (legacyDocs && legacyDocs.length > 0) {
          for (const doc of legacyDocs) {
            delete doc._id;
            await MotorcycleCompatibility.create(doc);
            makesAdded++;
          }
          migrated = true;
        }
      }
    } catch (e) { /* ignore */ }

    if (!migrated) {
      for (const def of DEFAULT_MOTORCYCLE_BRANDS) {
        await MotorcycleCompatibility.create({ id: await nextId('MOTO', 3), name: def.name, models: def.models.slice() });
        makesAdded++;
      }
    }
  }
  if (!(await Counter.findById(MOTO_SEED_MARKER))) {
    await Counter.create({ _id: MOTO_SEED_MARKER, seq: 1 });
  }

  // Clean up legacy collection if present
  try {
    if (mongoose.connection && mongoose.connection.db) {
      const collections = await mongoose.connection.db.listCollections({ name: 'motorcycle_brands' }).toArray();
      if (collections.length > 0) {
        await mongoose.connection.db.collection('motorcycle_brands').drop();
      }
    }
  } catch (e) { /* ignore if already dropped or no permissions */ }
  return { brandsAdded, makesAdded };
}

module.exports = { ensureDefaultFilters, DEFAULT_MOTORCYCLE_BRANDS, UNIVERSAL_FIT };
