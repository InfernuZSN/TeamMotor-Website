const config = require('./config');
const { connect } = require('./db');
const app = require('./app');
const { getSettings } = require('./services/settings');
const { ensureDefaultCategories } = require('./services/categories');
const { ensureDefaultFilters } = require('./services/filters');

(async () => {
  try {
    await connect();
    await getSettings();                                        // creates the default settings document on first run
    await ensureDefaultCategories();                            // adds the shop's standard categories to an existing database
    await ensureDefaultFilters();                               // fills the Manage Brands / Motorcycle Compatibility lists
    app.listen(config.port, () => {
      console.log('TeamMotor running on http://localhost:' + config.port + '  (' + config.env + ')');
      console.log('MongoDB connected: ' + config.mongoUri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@'));
    });
  } catch (err) {
    console.error('Failed to start:', err.message);
    process.exit(1);
  }
})();
