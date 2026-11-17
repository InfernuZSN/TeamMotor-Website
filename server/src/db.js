const mongoose = require('mongoose');
const config = require('./config');

mongoose.set('strictQuery', true);

let connectPromise = null;

async function connect() {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (!connectPromise) {
    connectPromise = mongoose.connect(config.mongoUri, {
      serverSelectionTimeoutMS: 8000,
      maxPoolSize: 10
    }).then(() => mongoose.connection).catch((err) => {
      connectPromise = null;
      throw err;
    });
  }
  return connectPromise;
}

function supportsTransactions() {
  try {
    const conn = mongoose.connection;
    if (!conn || conn.readyState !== 1 || !conn.client) return false;
    const desc = conn.client.topology && conn.client.topology.description;
    if (!desc) return false;
    return desc.type === 'ReplicaSetWithPrimary' || desc.type === 'Sharded' || desc.type === 'LoadBalanced';
  } catch (e) {
    return false;
  }
}

async function withOptionalTransaction(workFn) {
  if (supportsTransactions()) {
    const session = await mongoose.startSession();
    try {
      let out;
      await session.withTransaction(async () => {
        out = await workFn(session);
      });
      return out;
    } finally {
      await session.endSession();
    }
  }
  return await workFn(null);
}

module.exports = { connect, mongoose, supportsTransactions, withOptionalTransaction };
