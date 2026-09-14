const test = require('node:test');
const assert = require('node:assert/strict');
const AdminAccount = require('../src/models/adminAccount.model');
const { ADMIN_AUTH_METHODS, ADMIN_PERMISSIONS, DEFAULT_ADMIN_PERMISSIONS } = require('../src/constants/admin.constants');

test('dedicated admins use Firebase identity without a normal user account', () => {
  const admin = new AdminAccount({ email: 'ADMIN@EXAMPLE.COM', firebaseUid: 'firebase-admin-uid', firstName: 'System', lastName: 'Administrator', role: 'super_admin', permissions: DEFAULT_ADMIN_PERMISSIONS.super_admin, authMethods: ['firebase'] });
  assert.equal(admin.legacyUser, null);
  assert.equal(admin.email, 'admin@example.com');
  assert.equal(admin.fullName, 'System Administrator');
  assert.deepEqual(admin.permissions, ADMIN_PERMISSIONS);
});

test('Firebase is the only dedicated admin authentication method', () => {
  assert.deepEqual(ADMIN_AUTH_METHODS, ['firebase']);
  assert.equal(AdminAccount.schema.path('passwordHash'), undefined);
  assert.equal(AdminAccount.schema.path('ssoIdentities'), undefined);
  assert.equal(AdminAccount.schema.path('firebaseUid').options.unique, true);
});

test('admin bootstrap owner has a one-record uniqueness guard', () => {
  assert.ok(AdminAccount.schema.indexes().some(([keys, options]) => keys.bootstrapOwner === 1 && options.unique === true && options.partialFilterExpression?.bootstrapOwner === true));
});
