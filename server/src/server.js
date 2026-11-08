const config = require('./config');
const { connect } = require('./db');
const app = require('./app');
const { Product } = require('./models');
const { getSettings } = require('./services/settings');
const { ensureDefaultCategories } = require('./services/categories');
const { ensureDefaultFilters } = require('./services/filters');

(async () => {
  try {
    await connect();
    await Product.collection.updateMany({ barcode: { $exists: true } }, { $unset: { barcode: '' } }).catch(() => {});
    await Product.collection.dropIndex('barcode_1').catch(() => {});
    await getSettings();                                        // creates the default settings document on first run
    await ensureDefaultCategories();                            // adds the shop's standard categories to an existing database
    await ensureDefaultFilters();                               // fills the Manage Brands / Motorcycle Compatibility lists
    app.listen(config.port, '0.0.0.0', () => {
      console.log('TeamMotor running on http://0.0.0.0:' + config.port + '  (' + config.env + ')');
      console.log('MongoDB connected: ' + config.mongoUri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@'));
    });
  } catch (err) {
    console.error('Failed to start:', err.message);
    process.exit(1);
  }
})();
