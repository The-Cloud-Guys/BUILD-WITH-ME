const mongoose = require('mongoose');
const Project = require('../src/models/project.model');

const ATLAS_HOST_SUFFIX = '.mongodb.net';

function getAtlasHosts(connectionString) {
  if (typeof connectionString !== 'string') return [];

  const schemeMatch = connectionString.match(/^(mongodb(?:\+srv)?):\/\//i);
  if (!schemeMatch) return [];

  const authority = connectionString
    .slice(schemeMatch[0].length)
    .split(/[/?]/, 1)[0];
  const hostList = authority.slice(authority.lastIndexOf('@') + 1);

  return hostList
    .split(',')
    .map((host) => host.trim().replace(/:\d+$/, '').toLowerCase())
    .filter(Boolean);
}

function assertSupportedAtlasUri(connectionString) {
  const hosts = getAtlasHosts(connectionString);
  const isAtlasUri = hosts.length > 0 && hosts.every(
    (host) => host === 'mongodb.net' || host.endsWith(ATLAS_HOST_SUFFIX)
  );

  if (!isAtlasUri) {
    throw new Error(
      'MONGODB_URI must be an Atlas connection string using mongodb+srv:// or mongodb://'
    );
  }
}

function sanitizeMongoError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(
    /(mongodb(?:\+srv)?:\/\/)[^\s/@]+@/gi,
    '$1<credentials-redacted>@'
  );
}

async function main() {
  if (!process.env.MONGODB_URI) {
    throw new Error(
      'MONGODB_URI must be supplied explicitly; this command does not load .env'
    );
  }

  assertSupportedAtlasUri(process.env.MONGODB_URI);

  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  const topology = hello.msg === 'isdbgrid'
    ? 'sharded cluster'
    : hello.setName
      ? `replica set (${hello.setName})`
      : 'standalone';

  if (!hello.setName && hello.msg !== 'isdbgrid') {
    throw new Error(
      'Transactions are not supported: MongoDB is running as a standalone server'
    );
  }

  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    await Project.findOne().select('_id').session(session).lean();
    await session.abortTransaction();
  } finally {
    await session.endSession();
  }

  console.log(`MongoDB transaction verification passed on ${topology}.`);
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(`MongoDB transaction verification failed: ${sanitizeMongoError(error)}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}

module.exports = {
  assertSupportedAtlasUri,
  getAtlasHosts,
  main,
  sanitizeMongoError,
};
