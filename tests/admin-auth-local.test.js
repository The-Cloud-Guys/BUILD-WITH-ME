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
    'POST /login',
    'POST /refresh-token',
    'POST /logout',
    'GET /me',
  ]);
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
