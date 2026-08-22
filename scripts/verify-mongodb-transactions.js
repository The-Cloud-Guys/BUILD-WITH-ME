const mongoose = require('mongoose');
const Project = require('../src/models/project.model');

async function main() {
  if (!process.env.MONGODB_URI) {
    throw new Error(
      'MONGODB_URI must be supplied explicitly; this command does not load .env'
    );
  }

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
      console.error(`MongoDB transaction verification failed: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}

module.exports = { main };
