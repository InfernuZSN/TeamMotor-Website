/* Makes sure the shop's standard categories exist in an EXISTING database (the seed script only runs on an empty one).
   Idempotent and non-destructive: it adds missing categories and renames the old default names, but never touches
   a category id, a name an admin customised, or any product. Mirrors ensureDefaultCategories() in public/js/local-api.js. */
const { Category } = require('../models');

const DEFAULTS = [
  { id: 'lights', name: 'Lights', prefix: 'LGT' },
  { id: 'bulbs', name: 'Bulbs', prefix: 'BLB' },
  { id: 'electrical', name: 'Electronics', prefix: 'ELC' },
  { id: 'engine-parts', name: 'Motorcycle Parts', prefix: 'ENG' },
  { id: 'accessories', name: 'Motorcycle Accessories', prefix: 'ACC' },
  { id: 'engine-oils', name: 'Engine Oils / Fluids', prefix: 'OIL' },
  { id: 'brakes', name: 'Brake Systems', prefix: 'BRK' },
  { id: 'cvt', name: 'CVT & Transmission', prefix: 'CVT' },
  { id: 'helmets', name: 'Helmets & Accessories', prefix: 'HLM' },
  { id: 'tools', name: 'Tools & Fluids', prefix: 'TLS' },
  { id: 'other-parts', name: 'Others', prefix: 'OTH' }
];
const LEGACY_NAMES = { electrical: 'Electrical', brakes: 'Brakes', accessories: 'Accessories', 'engine-parts': 'Engine Parts', 'other-parts': 'Other Parts' };

async function ensureDefaultCategories() {
  const existing = await Category.find({});
  const byId = new Map(existing.map(c => [c.id, c]));
  const prefixes = new Set(existing.map(c => c.prefix));
  let added = 0, renamed = 0;
  for (const def of DEFAULTS) {
    const have = byId.get(def.id);
    if (have) {
      if (LEGACY_NAMES[def.id] && have.name === LEGACY_NAMES[def.id]) { have.name = def.name; await have.save(); renamed++; }
      continue;
    }
    const prefix = prefixes.has(def.prefix) ? def.prefix.slice(0, 2) + 'X' : def.prefix;
    await Category.create({ id: def.id, name: def.name, prefix, status: 'Active' });
    prefixes.add(prefix);
    added++;
  }
  return { added, renamed };
}

module.exports = { ensureDefaultCategories, DEFAULTS };
