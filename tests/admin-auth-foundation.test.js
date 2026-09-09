const test = require('node:test');
const assert = require('node:assert/strict');

const AdminAccount = require('../src/models/adminAccount.model');
const AdminSession = require('../src/models/adminSession.model');
const {
  ADMIN_PERMISSIONS,
  DEFAULT_ADMIN_PERMISSIONS,
} = require('../src/constants/admin.constants');

test('dedicated admin accounts do not require a normal user identity', () => {
  const admin = new AdminAccount({
    email: 'ADMIN@EXAMPLE.COM',
    firstName: 'System',
    lastName: 'Administrator',
    role: 'super_admin',
    permissions: DEFAULT_ADMIN_PERMISSIONS.super_admin,
    authMethods: ['password'],
  });

  assert.equal(admin.legacyUser, null);
  assert.equal(admin.email, 'admin@example.com');
  assert.equal(admin.fullName, 'System Administrator');
  assert.deepEqual(admin.permissions, ADMIN_PERMISSIONS);
});

test('admin password hashes are excluded from queries by default', () => {
  assert.equal(AdminAccount.schema.path('passwordHash').options.select, false);
});

test('admin sessions are separate from ordinary user refresh sessions', () => {
  assert.equal(AdminSession.schema.path('admin').options.ref, 'AdminAccount');
  assert.equal(AdminSession.schema.path('tokenHash').options.select, false);
  assert.ok(
    AdminSession.schema
      .indexes()
      .some(([keys, options]) => keys.expiresAt === 1 && options.expireAfterSeconds === 0)
  );
});

test('admin SSO identities support Google and Microsoft only', () => {
  const identitySchema = AdminAccount.schema.path('ssoIdentities').schema;
  assert.deepEqual(
    identitySchema.path('provider').enumValues,
    ['google', 'microsoft']
  );
});

test('admin SSO provider subjects have a unique compound index', () => {
  assert.ok(AdminAccount.schema.indexes().some(([keys, options]) => (
    keys['ssoIdentities.provider'] === 1
    && keys['ssoIdentities.subject'] === 1
    && options.unique === true
  )));
});
