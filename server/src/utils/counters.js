const { Counter } = require('../models');

/* Atomic, gap-tolerant sequence: nextId('SALE', 4) -> 'SALE-0001'.
   Uses findOneAndUpdate+$inc so two cashiers can never get the same number. */
async function nextSeq(name) {
  const doc = await Counter.findOneAndUpdate({ _id: name }, { $inc: { seq: 1 } }, { new: true, upsert: true });
  return doc.seq;
}
async function nextId(prefix, pad, counterName) {
  const n = await nextSeq(counterName || prefix);
  return prefix + '-' + String(n).padStart(pad || 4, '0');
}
/* Make sure a counter is at least `min` (used by the seed script after inserting fixtures). */
async function ensureAtLeast(name, min) {
  const doc = await Counter.findById(name);
  if (!doc) { await Counter.create({ _id: name, seq: min }); return; }
  if (doc.seq < min) { doc.seq = min; await doc.save(); }
}

module.exports = { nextSeq, nextId, ensureAtLeast };
