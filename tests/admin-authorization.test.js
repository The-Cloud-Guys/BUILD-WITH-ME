const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  requireAdminPermission,
  verifyAdminRequestOrigin,
} = require('../src/middleware/adminAuth.middleware');

const invokeMiddleware = (middleware, req) => {
  let statusCode;
  let body;
  let nextCalled = false;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(value) {
      body = value;
      return this;
    },
  };
  middleware(req, res, () => { nextCalled = true; });
  return { body, nextCalled, statusCode };
};

test('admin permission middleware allows matching permissions and super admins', () => {
  const requireUsers = requireAdminPermission('manage_users');
  assert.equal(invokeMiddleware(requireUsers, {
    adminAccount: { role: 'admin', permissions: ['manage_users'] },
  }).nextCalled, true);
  assert.equal(invokeMiddleware(requireUsers, {
    adminAccount: { role: 'super_admin', permissions: [] },
  }).nextCalled, true);
});

test('admin permission middleware denies missing privileges', () => {
  const result = invokeMiddleware(requireAdminPermission('manage_users'), {
    adminAccount: { role: 'moderator', permissions: ['manage_reports'] },
  });
  assert.equal(result.statusCode, 403);
  assert.equal(result.nextCalled, false);
  assert.equal(result.body.requiredPermission, 'manage_users');
});

test('cookie-authenticated admin mutations require an allowed browser origin', () => {
  const previous = process.env.ADMIN_DASHBOARD_URL;
  process.env.ADMIN_DASHBOARD_URL = 'https://admin.example.com';
  try {
    const request = (origin) => ({
      method: 'POST',
      headers: {},
      protocol: 'https',
      get(name) {
        if (name === 'origin') return origin;
        if (name === 'host') return 'api.example.com';
        return undefined;
      },
    });
    assert.equal(
      invokeMiddleware(verifyAdminRequestOrigin, request('https://admin.example.com')).nextCalled,
      true
    );
    assert.equal(
      invokeMiddleware(verifyAdminRequestOrigin, request('https://attacker.example')).statusCode,
      403
    );
  } finally {
    if (previous === undefined) delete process.env.ADMIN_DASHBOARD_URL;
    else process.env.ADMIN_DASHBOARD_URL = previous;
  }
});

test('explicit bearer admin mutations are not subject to ambient-cookie origin checks', () => {
  const result = invokeMiddleware(verifyAdminRequestOrigin, {
    method: 'POST',
    headers: { authorization: 'Bearer test-token' },
    get: () => 'https://attacker.example',
  });
  assert.equal(result.nextCalled, true);
});

test('ordinary frontend origins are not trusted for admin cookie requests', () => {
  const previousDashboard = process.env.ADMIN_DASHBOARD_URL;
  const previousFrontend = process.env.FRONTEND_URL;
  process.env.ADMIN_DASHBOARD_URL = 'https://admin.example.com';
  process.env.FRONTEND_URL = 'https://app.example.com';
  try {
    const result = invokeMiddleware(verifyAdminRequestOrigin, {
      method: 'GET',
      headers: {},
      protocol: 'https',
      get(name) {
        if (name === 'origin') return 'https://app.example.com';
        if (name === 'host') return 'api.example.com';
        return undefined;
      },
    });
    assert.equal(result.statusCode, 403);
  } finally {
    if (previousDashboard === undefined) delete process.env.ADMIN_DASHBOARD_URL;
    else process.env.ADMIN_DASHBOARD_URL = previousDashboard;
    if (previousFrontend === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = previousFrontend;
  }
});

test('operational admin routes use dedicated authentication and explicit permissions', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'routes', 'admin.routes.js'),
    'utf8'
  );
  const dedicatedStart = source.indexOf('router.use(authenticateAdmin)');
  assert.ok(dedicatedStart > 0);

  const operationalSource = source.slice(dedicatedStart);
  for (const permission of [
    'view_analytics',
    'manage_users',
    'manage_projects',
    'manage_reports',
    'manage_admins',
  ]) {
    assert.match(operationalSource, new RegExp(`requireAdminPermission\\('${permission}'\\)`));
  }
  assert.doesNotMatch(operationalSource, /router\.use\(protect\)/);
});

test('dedicated admin actions use dedicated audit and moderation actor fields', () => {
  const controllerSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'controllers', 'admin.controller.js'),
    'utf8'
  );
  assert.match(controllerSource, /adminAccount: req\.adminAccount\.id/);
  assert.match(controllerSource, /reviewedByAdmin = req\.adminAccount\.id/);
  assert.match(controllerSource, /suspendedByAdmin = adminId/);
  assert.match(controllerSource, /terminatedByAdmin = adminId/);
});

test('dedicated access authentication requires a live admin session', () => {
  const middlewareSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'middleware', 'adminAuth.middleware.js'),
    'utf8'
  );
  assert.match(middlewareSource, /AdminSession\.exists/);
  assert.match(middlewareSource, /family: decoded\.sid/);
  assert.match(middlewareSource, /revokedAt: null/);
});

test('Postman uses dedicated admin cookies for all admin management routes', () => {
  const collection = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'build_with_me_auth.postman_collection.json'),
    'utf8'
  ));
  const administration = collection.item.find(({ name }) => name === '11 - Administration');
  for (const item of administration.item) {
    assert.equal(item.request.auth.type, 'noauth');
    if (item.request.url !== '{{baseUrl}}/api/admin/auth/accept-invitation') {
      assert.match(item.request.description, /dedicated adminAccessToken HttpOnly cookie/);
    }
  }
});
