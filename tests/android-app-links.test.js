const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const assetLinksPath = 'public/.well-known/assetlinks.json';

test('Android Digital Asset Links file has a valid app-link statement', () => {
  const statements = JSON.parse(fs.readFileSync(assetLinksPath, 'utf8'));
  assert.ok(Array.isArray(statements));
  assert.equal(statements.length, 1);

  const [statement] = statements;
  assert.deepEqual(statement.relation, [
    'delegate_permission/common.handle_all_urls',
  ]);
  assert.equal(statement.target.namespace, 'android_app');
  assert.equal(statement.target.package_name, 'com.tcg.conexd');
  assert.equal(statement.target.sha256_cert_fingerprints.length, 1);
  assert.match(
    statement.target.sha256_cert_fingerprints[0],
    /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/
  );
});

test('assetlinks route is public, exact, and registered before the final 404', () => {
  const source = fs.readFileSync('src/index.js', 'utf8');
  const route = source.indexOf("app.get('/.well-known/assetlinks.json'");
  const apiRoutes = source.indexOf("app.use('/api/auth'");
  const final404 = source.indexOf("message: 'Route not found'");

  assert.ok(route >= 0);
  assert.ok(route < apiRoutes);
  assert.ok(route < final404);
  assert.match(source, /res\.type\('application\/json'\)/);
  assert.match(source, /res\.sendFile\(assetLinksPath/);
});
