const mongoose = require('mongoose');
const dotenv = require('dotenv');

const Project = require('../src/models/project.model');

dotenv.config();

const missingStatusFilter = {
  $or: [{ status: { $exists: false } }, { status: null }, { status: '' }],
};

async function main() {
  const apply = process.argv.includes('--apply');
  await mongoose.connect(process.env.MONGODB_URI);

  const before = await Project.countDocuments(missingStatusFilter);
  console.log(`Projects missing status: ${before}`);

  if (!apply) {
    console.log('Dry run only. Re-run with --apply to backfill status=OPEN.');
    return;
  }

  const result = await Project.updateMany(missingStatusFilter, {
    $set: { status: 'OPEN' },
  });
  const after = await Project.countDocuments(missingStatusFilter);

  console.log(`Projects updated: ${result.modifiedCount}`);
  console.log(`Projects still missing status: ${after}`);
}

main()
  .catch((error) => {
    console.error(`Project status backfill failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
