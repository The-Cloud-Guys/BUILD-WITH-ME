const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const AdminAccount = require('../src/models/adminAccount.model');
const adminAuthRoutes = require('../src/routes/adminAuth.routes');
const {
  assertAdminAuthConfigured,
  getDurationMs,
  verifyAdminBootstrapSecret,
} = require('../src/services/adminAuth.service');
const {
  adminLoginValidation,
  bootstrapAdminValidation,
} = require('../src/validation/adminAuth.validation');

const routeSignatures = () => adminAuthRoutes.stack
  .filter((layer) => layer.route)
  .map((layer) => {
    const method = Object.keys(layer.route.methods)[0].toUpperCase();
    return `${method} ${layer.route.path}`;
  });

test('admin local-auth router exposes the Phase 2 endpoints', () => {
  assert.deepEqual(routeSignatures(), [
    'POST /bootstrap',
    'POST /accept-invitation',
    'POST /login',
    'GET /sso/:provider',
    'GET /sso/:provider/callback',
    'POST /mfa/challenge',
    'POST /refresh-token',
    'POST /logout',
    'GET /me',
    'POST /mfa/setup',
    'POST /mfa/confirm',
    'DELETE /mfa',
  ]);
});

test('admin SSO uses state, nonce, PKCE, and verified provider identity', () => {
  const serviceSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'services', 'adminSso.service.js'),
    'utf8'
  );
  const controllerSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'controllers', 'adminAuth.controller.js'),
    'utf8'
  );
  assert.match(serviceSource, /code_challenge_method: 'S256'/);
  assert.match(serviceSource, /claims\.nonce !== nonce/);
  assert.match(serviceSource, /algorithms: \['RS256'\]/);
  assert.match(controllerSource, /req\.query\.state !== req\.cookies\?\.adminSsoState/);
  assert.match(controllerSource, /SSO access has not been provisioned/);
  assert.doesNotMatch(controllerSource, /AdminAccount\.create\([^)]*sso/i);
});

test('Microsoft admin SSO requires a specific tenant', () => {
  const { getConfiguration } = require('../src/services/adminSso.service');
  const names = [
    'ADMIN_MICROSOFT_TENANT_ID',
    'ADMIN_MICROSOFT_CLIENT_ID',
    'ADMIN_MICROSOFT_CLIENT_SECRET',
    'ADMIN_MICROSOFT_CALLBACK_URL',
  ];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    process.env.ADMIN_MICROSOFT_TENANT_ID = 'common';
    assert.throws(() => getConfiguration('microsoft'), /specific tenant ID/);
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});

test('admin bootstrap requires a strong password and complete identity', () => {
  const invalid = bootstrapAdminValidation({
    email: 'admin@example.com',
    password: 'short',
    firstName: 'Admin',
    lastName: 'User',
  });
  assert.ok(invalid.error);

  const valid = bootstrapAdminValidation({
    email: 'ADMIN@EXAMPLE.COM',
    password: 'a-long-admin-password',
    firstName: 'Admin',
    lastName: 'User',
  });
  assert.equal(valid.error, undefined);
  assert.equal(valid.value.email, 'admin@example.com');
});

test('admin login validation does not weaken bootstrap password requirements', () => {
  assert.equal(adminLoginValidation({
    email: 'admin@example.com',
    password: 'existing-password',
  }).error, undefined);
});

test('admin bootstrap secret comparison accepts only the configured value', () => {
  const previous = process.env.ADMIN_SECRET_KEY;
  process.env.ADMIN_SECRET_KEY = 'test-only-bootstrap-secret';
  try {
    assert.equal(verifyAdminBootstrapSecret('test-only-bootstrap-secret'), true);
    assert.equal(verifyAdminBootstrapSecret('incorrect-secret'), false);
    assert.equal(verifyAdminBootstrapSecret(''), false);
  } finally {
    if (previous === undefined) delete process.env.ADMIN_SECRET_KEY;
    else process.env.ADMIN_SECRET_KEY = previous;
  }
});

test('admin auth configuration is checked before bootstrap can create an account', () => {
  const names = ['ADMIN_SECRET_KEY', 'ADMIN_JWT_SECRET', 'ADMIN_REFRESH_SECRET'];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    process.env.ADMIN_SECRET_KEY = 'test-bootstrap-secret';
    process.env.ADMIN_JWT_SECRET = 'test-access-secret';
    process.env.ADMIN_REFRESH_SECRET = 'test-refresh-secret';
    assert.doesNotThrow(() => assertAdminAuthConfigured({ includeBootstrap: true }));

    delete process.env.ADMIN_REFRESH_SECRET;
    assert.throws(
      () => assertAdminAuthConfigured({ includeBootstrap: true }),
      /ADMIN_REFRESH_SECRET is not configured/
    );
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});

test('admin token durations support short web-session units', () => {
  assert.equal(getDurationMs('15m', '1h'), 15 * 60 * 1000);
  assert.equal(getDurationMs('12h', '1h'), 12 * 60 * 60 * 1000);
  assert.equal(getDurationMs('1d', '1h'), 24 * 60 * 60 * 1000);
});

test('admin account bootstrap owner has a one-record uniqueness guard', () => {
  assert.ok(
    AdminAccount.schema.indexes().some(([keys, options]) => (
      keys.bootstrapOwner === 1 &&
      options.unique === true &&
      options.partialFilterExpression?.bootstrapOwner === true
    ))
  );
});

test('admin auth routes mount before the legacy admin router', () => {
  const indexSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'index.js'),
    'utf8'
  );
  assert.ok(
    indexSource.indexOf("app.use('/api/admin/auth', adminAuthRoutes)") <
      indexSource.indexOf("app.use('/api/admin', adminRoutes)")
  );
  assert.match(indexSource, /process\.env\.ADMIN_DASHBOARD_URL/);
});
