const { AuditLog } = require('../models');
const { nextId } = require('./counters');

/* Never let an audit-write failure break the business action that already succeeded —
   but do make it loud in the server log. */
async function audit(req, action, entity, entityId, details) {
  try {
    const u = (req && req.user) || {};
    await AuditLog.create({
      id: await nextId('AUD', 6),
      at: new Date(),
      userId: u.id || null, username: u.username || (details && details.username) || null,
      userName: u.name || null, role: u.role || null,
      action, entity: entity || null, entityId: entityId || null,
      details: details || {},
      ip: req && (req.ip || (req.connection && req.connection.remoteAddress)) || null
    });
  } catch (err) {
    console.error('[audit] FAILED to write audit log for', action, entityId, err.message);
  }
}

/* Changed fields only: { field: { from, to } }. Never pass password fields here. */
function diff(before, after, keys) {
  const out = {};
  (keys || Object.keys(after || {})).forEach(k => {
    if (/password|hash|token/i.test(k)) return;
    const a = before ? before[k] : undefined, b = after ? after[k] : undefined;
    if (JSON.stringify(a === undefined ? null : a) !== JSON.stringify(b === undefined ? null : b)) out[k] = { from: a === undefined ? null : a, to: b === undefined ? null : b };
  });
  return out;
}

module.exports = { audit, diff };
