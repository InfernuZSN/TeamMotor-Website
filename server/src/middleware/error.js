const config = require('../config');

function notFoundHandler(req, res) {
  res.status(404).json({ error: 'Not found: ' + req.method + ' ' + req.originalUrl });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let status = err.status || 500;
  let message = err.message || 'Server error';
  if (err.name === 'ValidationError') { status = 400; message = Object.values(err.errors).map(e => e.message).join(' '); }
  else if (err.name === 'CastError') { status = 400; message = 'Invalid value for ' + err.path + '.'; }
  else if (err.code === 11000) { status = 409; message = 'Duplicate value: ' + Object.keys(err.keyValue || {}).join(', ') + ' already exists.'; }
  else if (err.type === 'entity.too.large') { status = 413; message = 'Request too large (images must be resized).'; }
  if (status >= 500) { console.error('[error]', req.method, req.originalUrl, err); if (config.isProd) message = 'Server error'; }
  res.status(status).json({ error: message, details: err.details });
}

module.exports = { notFoundHandler, errorHandler };
