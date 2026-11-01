class HttpError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}
const bad = (msg, details) => new HttpError(400, msg, details);
const notFound = (msg) => new HttpError(404, msg || 'Not found');
const conflict = (msg) => new HttpError(409, msg);
const forbidden = (msg) => new HttpError(403, msg || 'You do not have permission to do this.');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { HttpError, bad, notFound, conflict, forbidden, wrap };
