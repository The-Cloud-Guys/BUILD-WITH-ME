const test = require('node:test');
const assert = require('node:assert/strict');

const {
  assertSupportedAtlasUri,
  sanitizeMongoError,
} = require('../scripts/verify-mongodb-transactions');

test('MongoDB integration guard accepts an Atlas SRV connection string', () => {
  assert.doesNotThrow(() => {
    assertSupportedAtlasUri(
      'mongodb+srv://example-user:example-password@example-cluster.mongodb.net/example-db'
    );
  });
});

test('MongoDB integration guard accepts a standard multi-host Atlas connection string', () => {
  assert.doesNotThrow(() => {
    assertSupportedAtlasUri(
      'mongodb://example-user:example-password@example-shard-00-00.mongodb.net:27017,' +
        'example-shard-00-01.mongodb.net:27017/example-db?tls=true'
    );
  });
});

test('MongoDB integration guard rejects unsupported and non-Atlas connection strings', () => {
  for (const connectionString of [
    'https://example-cluster.mongodb.net/example-db',
    'mongodb://localhost:27017/example-db',
    'mongodb+srv://example.invalid/example-db',
  ]) {
    assert.throws(
      () => assertSupportedAtlasUri(connectionString),
      /must be an Atlas connection string/
    );
  }
});

test('MongoDB integration errors redact credentials', () => {
  const safeMessage = sanitizeMongoError(
    new Error(
      'Unable to connect to mongodb://private-user:private-password@example.mongodb.net/db'
    )
  );

  assert.equal(safeMessage.includes('private-user'), false);
  assert.equal(safeMessage.includes('private-password'), false);
  assert.match(safeMessage, /<credentials-redacted>@example\.mongodb\.net/);
});
