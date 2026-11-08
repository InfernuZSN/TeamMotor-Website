const app = require('../server/src/app');
const { connect, mongoose } = require('../server/src/db');

module.exports = async (req, res) => {
  // Ensure MongoDB is connected for serverless invocations
  if (mongoose.connection.readyState !== 1) {
    try {
      await connect();
    } catch (err) {
      console.error('[Vercel Serverless] MongoDB connection error:', err);
      return res.status(500).json({ error: 'Database connection failed: ' + err.message });
    }
  }
  return app(req, res);
};
