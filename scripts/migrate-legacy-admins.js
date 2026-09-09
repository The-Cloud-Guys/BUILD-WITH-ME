const mongoose = require('mongoose');

const User = require('../src/models/user.model');
const Project = require('../src/models/project.model');
const AdminAccount = require('../src/models/adminAccount.model');
const { Admin, AuditLog, Report } = require('../src/models/admin.model');
const {
  assertSupportedAtlasUri,
  sanitizeMongoError,
} = require('./verify-mongodb-transactions');

const migrateActorReferences = async (legacyUserId, adminAccountId) => {
  const operations = [
    AuditLog.updateMany(
      { admin: legacyUserId, adminAccount: null },
      { $set: { adminAccount: adminAccountId } }
    ),
    Report.updateMany(
      { reviewedBy: legacyUserId, reviewedByAdmin: null },
      { $set: { reviewedByAdmin: adminAccountId } }
    ),
    Project.updateMany(
      { reviewedBy: legacyUserId, reviewedByAdmin: null },
      { $set: { reviewedByAdmin: adminAccountId } }
    ),
    User.updateMany(
      { suspendedBy: legacyUserId, suspendedByAdmin: null },
      { $set: { suspendedByAdmin: adminAccountId } }
    ),
    User.updateMany(
      { terminatedBy: legacyUserId, terminatedByAdmin: null },
      { $set: { terminatedByAdmin: adminAccountId } }
    ),
  ];
  const results = await Promise.all(operations);
  return results.reduce((total, result) => total + result.modifiedCount, 0);
};

const migrateLegacyAdmins = async ({ apply = false } = {}) => {
  const activeDedicatedSuperAdmin = await AdminAccount.exists({
    role: 'super_admin',
    isActive: true,
    migrationPending: false,
    'authMethods.0': { $exists: true },
  });
  if (apply && !activeDedicatedSuperAdmin) {
    throw new Error(
      'Create and verify the dedicated bootstrap super admin before applying migration'
    );
  }

  const legacyAdmins = await Admin.find()
    .populate('user', 'email firstName lastName')
    .lean();
  const summary = {
    mode: apply ? 'apply' : 'dry-run',
    readyForApply: Boolean(activeDedicatedSuperAdmin),
    legacyAdmins: legacyAdmins.length,
    eligible: 0,
    missingUsers: 0,
    conflicts: 0,
    createdAccounts: 0,
    linkedAccounts: 0,
    actorReferencesUpdated: 0,
  };
  const mappings = new Map();

  for (const legacyAdmin of legacyAdmins) {
    const user = legacyAdmin.user;
    if (!user?.email) {
      summary.missingUsers += 1;
      continue;
    }
    summary.eligible += 1;

    let account = await AdminAccount.findOne({
      $or: [{ legacyUser: user._id }, { email: user.email }],
    });

    if (
      account?.legacyUser
      && account.legacyUser.toString() !== user._id.toString()
    ) {
      summary.conflicts += 1;
      continue;
    }

    if (!account) {
      summary.createdAccounts += 1;
      if (apply) {
        account = await AdminAccount.create({
          email: user.email,
          firstName: user.firstName || '',
          lastName: user.lastName || '',
          role: legacyAdmin.role,
          permissions: legacyAdmin.permissions || [],
          authMethods: [],
          isActive: false,
          emailVerified: false,
          migrationPending: true,
          legacyUser: user._id,
        });
      }
    } else if (!account.legacyUser) {
      summary.linkedAccounts += 1;
      if (apply) {
        account.legacyUser = user._id;
        await account.save();
      }
    }

    if (apply && account) mappings.set(user._id.toString(), account);
  }

  if (apply) {
    for (const legacyAdmin of legacyAdmins) {
      const legacyUserId = legacyAdmin.user?._id?.toString();
      const account = mappings.get(legacyUserId);
      if (!account) continue;

      const addedByAccount = mappings.get(legacyAdmin.addedBy?.toString());
      if (addedByAccount && !account.addedBy) {
        account.addedBy = addedByAccount._id;
        await account.save();
      }
      summary.actorReferencesUpdated += await migrateActorReferences(
        legacyAdmin.user._id,
        account._id
      );
    }
  }

  return summary;
};

async function main() {
  const connectionString = process.env.MONGODB_URI;
  if (!connectionString) {
    throw new Error(
      'MONGODB_URI must be supplied explicitly; this command does not load .env'
    );
  }
  assertSupportedAtlasUri(connectionString);
  const apply = process.argv.includes('--apply');

  await mongoose.connect(connectionString, { serverSelectionTimeoutMS: 10000 });
  const summary = await migrateLegacyAdmins({ apply });
  console.log('Legacy admin migration summary:', summary);
  if (!apply) {
    console.log('Dry-run only. Re-run with --apply after reviewing this summary.');
  }
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(`Legacy admin migration failed: ${sanitizeMongoError(error)}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}

module.exports = { migrateActorReferences, migrateLegacyAdmins };
