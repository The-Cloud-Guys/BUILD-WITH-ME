const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const routes = require('../src/routes/adminAuth.routes');

const routeSignatures = () => routes.stack.filter((layer) => layer.route).map((layer) => `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`);

test('admin auth exposes only Firebase, invitation, session, and MFA routes', () => {
  assert.deepEqual(routeSignatures(), ['POST /bootstrap/firebase', 'POST /firebase', 'POST /invitations/verify', 'POST /firebase/accept-invitation', 'POST /mfa/challenge', 'POST /logout', 'GET /me', 'POST /mfa/setup', 'POST /mfa/confirm', 'DELETE /mfa']);
});

test('Firebase login is provisioned and never auto-creates an admin', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'controllers', 'adminAuth.controller.js'), 'utf8');
  assert.match(source, /verifyFirebaseToken\(idToken, \{ checkRevoked: true \}\)/);
  assert.match(source, /decoded\.email_verified !== true/);
  assert.match(source, /Administrator access has not been activated/);
  assert.doesNotMatch(source, /loginAdmin\s*=/);
});

test('Firebase invitation acceptance matches token and verified email atomically', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'controllers', 'adminAuth.controller.js'), 'utf8');
  assert.match(source, /databaseSession\.withTransaction/);
  assert.match(source, /email: identity\.email/);
  assert.match(source, /acceptedAt: null/);
  assert.match(source, /authMethods: \['firebase'\]/);
});

test('Firebase sessions require recent authentication and revocation checks', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'firebase.service.js'), 'utf8');
  assert.match(source, /createSessionCookie/);
  assert.match(source, /verifySessionCookie\(sessionCookie, true\)/);
  assert.match(source, /nowSeconds - decoded\.auth_time > 5 \* 60/);
});

test('direct Google and Microsoft admin SSO implementation is removed', () => {
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'services', 'adminSso.service.js')), false);
  const envExample = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8');
  assert.doesNotMatch(envExample, /ADMIN_GOOGLE|ADMIN_MICROSOFT|ADMIN_JWT|ADMIN_REFRESH/);
});
