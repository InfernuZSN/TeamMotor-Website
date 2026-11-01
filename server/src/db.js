const mongoose = require('mongoose');
const config = require('./config');

mongoose.set('strictQuery', true);

async function connect() {
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 8000 });
  return mongoose.connection;
}

module.exports = { connect, mongoose };
