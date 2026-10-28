const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const AdminAccount = require('../src/models/adminAccount.model');
const AdminInvite = require('../src/models/adminInvite.model');
const {
  applyFirebaseProfile,
  getFirebaseProfile,
} = require('../src/controllers/adminAuth.controller');
const { mayGrant: mayGrantAccess } = require('../src/controllers/adminManagement.controller');
const { getAdminDuplicateMessage } = require('../src/controllers/adminAuth.controller');
const { hashInvitationToken } = require('../src/services/adminInvitation.service');
const { createAdminInvitationValidation } = require('../src/validation/adminManagement.validation');

test('admin invitation tokens are stored as hashes and expire through TTL', () => {
  assert.equal(AdminInvite.schema.path('tokenHash').options.select, false);
  assert.equal(hashInvitationToken('secret-token').includes('secret-token'), false);
  assert.ok(AdminInvite.schema.indexes().some(([keys, options]) => (
    keys.expiresAt === 1 && options.expireAfterSeconds === 0
  )));
});

test('admin invitation accepts email alone and applies safe access defaults', () => {
  const { error, value } = createAdminInvitationValidation({
    email: 'INVITEE@EXAMPLE.COM',
  });
  assert.equal(error, undefined);
  assert.equal(value.email, 'invitee@example.com');
  assert.equal(value.role, 'admin');
  assert.equal(value.firstName, undefined);
  assert.equal(value.lastName, undefined);
});

test('verified Firebase claims provide administrator name and profile picture', () => {
  assert.deepEqual(
    getFirebaseProfile({
      name: 'Ada King Lovelace',
      picture: 'https://example.com/ada.jpg',
    }, 'ada@example.com'),
    {
      firstName: 'Ada',
      lastName: 'King Lovelace',
      profilePhoto: 'https://example.com/ada.jpg',
    }
  );
});

test('only super admins can grant privileges they do not hold', () => {
  assert.equal(mayGrantAccess(
    { role: 'admin', permissions: ['manage_users'] },
    'admin',
    ['manage_users']
  ), true);
  assert.equal(mayGrantAccess(
    { role: 'admin', permissions: ['manage_users'] },
    'super_admin',
    ['manage_users']
  ), false);
  assert.equal(mayGrantAccess(
    { role: 'super_admin', permissions: [] },
    'super_admin',
    []
  ), true);
});

test('Firebase profile data replaces inviter-supplied administrator identity data', () => {
  const admin = new AdminAccount({
    email: 'invitee@example.com',
    firstName: 'Typed',
    lastName: 'By Inviter',
  });
  applyFirebaseProfile(admin, {
    firstName: 'Verified',
    lastName: 'Google User',
    profilePhoto: 'https://example.com/google-photo.jpg',
  });
  assert.equal(admin.firstName, 'Verified');
  assert.equal(admin.lastName, 'Google User');
  assert.equal(admin.profilePhoto, 'https://example.com/google-photo.jpg');
});

test('migrated admin accounts require invitation activation', () => {
  const migrated = new AdminAccount({
    email: 'legacy-admin@example.com',
    role: 'admin',
    isActive: false,
    migrationPending: true,
    authMethods: [],
  });
  assert.equal(migrated.isActive, false);
  assert.equal(migrated.migrationPending, true);
  assert.deepEqual(migrated.authMethods, []);
});

test('legacy migration is explicit, dry-run-first, and does not load dotenv', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'migrate-legacy-admins.js'),
    'utf8'
  );
  assert.match(source, /process\.argv\.includes\('--apply'\)/);
  assert.match(source, /mode: apply \? 'apply' : 'dry-run'/);
  assert.match(source, /dedicated bootstrap super admin before applying migration/);
  assert.match(source, /'authMethods\.0': \{ \$exists: true \}/);
  assert.match(source, /summary\.conflicts \+= 1/);
  assert.doesNotMatch(source, /dotenv/);
  assert.doesNotMatch(source, /deleteMany|findByIdAndDelete|findOneAndDelete/);
});

test('admin management routes no longer use ordinary user authentication', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'routes', 'admin.routes.js'),
    'utf8'
  );
  assert.doesNotMatch(source, /auth\.middleware|admin\.middleware/);
  assert.match(source, /router\.use\(authenticateAdmin\)/);
  assert.match(source, /post\('\/admins\/invitations'/);
  assert.match(source, /patch\('\/admins\/:adminId'/);
});

test('admin management validates object IDs before database operations', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'controllers', 'adminManagement.controller.js'),
    'utf8'
  );
  assert.match(source, /isValidObjectId\(req\.params\.inviteId\)/);
  assert.match(source, /isValidObjectId\(req\.params\.adminId\)/);
});

test('admin duplicate errors identify the conflicting unique field', () => {
  assert.equal(
    getAdminDuplicateMessage({ keyPattern: { email: 1 } }),
    'An administrator with this email already exists'
  );
  assert.equal(
    getAdminDuplicateMessage({ keyPattern: { firebaseUid: 1 } }),
    'This Firebase identity is already linked to another administrator'
  );
  assert.equal(
    getAdminDuplicateMessage({
      message: 'E11000 duplicate key index: legacyUser_1 dup key: { legacyUser: null }',
    }),
    'Administrator legacy account linkage conflicts with another record'
  );
});
