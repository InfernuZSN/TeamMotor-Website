const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const config = require('./config');
const { authenticate } = require('./middleware/auth');
const { notFoundHandler, errorHandler } = require('./middleware/error');
const { connect, mongoose } = require('./db');
const catalog = require('./routes/catalog');
const misc = require('./routes/misc');

const app = express();
app.set('trust proxy', 1);

// Ensure MongoDB is connected before handling requests (essential for serverless/Vercel)
app.use(async (req, res, next) => {
  if (req.path === '/api/health') return next();
  if (mongoose.connection.readyState !== 1) {
    try {
      await connect();
    } catch (err) {
      console.error('[MongoDB Connection Error]', err.message);
      return res.status(500).json({ error: 'Database connection failed: ' + err.message });
    }
  }
  next();
});

// The existing frontend uses inline <script>/style attributes, so 'unsafe-inline' is allowed; everything else is same-origin only.
app.use(helmet({
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  contentSecurityPolicy: {
    useDefaults: false,           // helmet's default adds upgrade-insecure-requests, which breaks plain-http local use
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://accounts.google.com/gsi/client'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://accounts.google.com/gsi/style'],
      frameSrc: ["'self'", 'https://accounts.google.com/gsi/'],
      connectSrc: ["'self'", 'https://accounts.google.com/gsi/', 'https://www.googleapis.com'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https://*.googleusercontent.com', 'https://accounts.google.com'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"]
    }
  }
}));
if (config.corsOrigins.length) app.use(cors({ origin: config.corsOrigins, credentials: false }));
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.use('/api/auth', require('./routes/auth'));

// ---- everything below requires a valid JWT ----
const api = express.Router();
api.use(authenticate);
api.use('/bootstrap', misc.bootstrap);
api.use('/users', require('./routes/users'));
api.use('/categories', catalog.categories);
api.use('/suppliers', catalog.suppliers);
api.use('/brands', catalog.brands);
api.use('/moto-brands', catalog.motoBrands);
api.use('/products', catalog.products);
api.use('/customers', require('./routes/customers'));
api.use('/sales', require('./routes/sales'));
api.use('/inventory', require('./routes/inventory'));
api.use('/warranties', require('./routes/warranties'));
api.use('/notifications', misc.notifications);
api.use('/audit', misc.auditRouter);
api.use('/settings', misc.settings);
api.use('/reports', misc.reports);
app.use('/api', api);
app.use('/api', notFoundHandler);

// ---- static frontend ----
const publicPath = path.join(__dirname, '..', '..', 'public');
app.use(express.static(publicPath, { extensions: ['html'], index: 'login.html' }));

app.use((req, res) => {
  res.status(404).send('Not Found');
});

app.use(errorHandler);
module.exports = app;
