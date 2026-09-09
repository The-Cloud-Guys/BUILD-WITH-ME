const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const AdminAccount = require('../src/models/adminAccount.model');
const AdminMfaChallenge = require('../src/models/adminMfaChallenge.model');
const {
  decryptSecret,
  encryptSecret,
  generateTotp,
  generateTotpSecret,
  verifyTotp,
} = require('../src/services/adminMfa.service');

test('admin MFA secrets are encrypted with authenticated encryption', () => {
  const previous = process.env.ADMIN_MFA_ENCRYPTION_KEY;
  process.env.ADMIN_MFA_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
  try {
    const secret = generateTotpSecret();
    const encrypted = encryptSecret(secret);
    assert.notEqual(encrypted, secret);
    assert.equal(decryptSecret(encrypted), secret);
    assert.equal(encrypted.split('.').length, 3);
  } finally {
    if (previous === undefined) delete process.env.ADMIN_MFA_ENCRYPTION_KEY;
    else process.env.ADMIN_MFA_ENCRYPTION_KEY = previous;
  }
});

test('admin TOTP accepts the current window and rejects malformed codes', () => {
  const secret = 'JBSWY3DPEHPK3PXP';
  const timestamp = 1788955200000;
  const code = generateTotp(secret, timestamp);
  assert.equal(verifyTotp(secret, code, timestamp), true);
  assert.equal(verifyTotp(secret, '12345', timestamp), false);
  assert.equal(verifyTotp(secret, code, timestamp + 90000), false);
});

test('admin MFA secrets are excluded from queries by default', () => {
  assert.equal(AdminAccount.schema.path('mfaSecretEncrypted').options.select, false);
  assert.equal(AdminAccount.schema.path('mfaPendingSecretEncrypted').options.select, false);
});

test('admin MFA challenges are hashed, expiring, and single-use', () => {
  assert.equal(AdminMfaChallenge.schema.path('jtiHash').options.select, false);
  assert.ok(AdminMfaChallenge.schema.indexes().some(([keys, options]) => (
    keys.expiresAt === 1 && options.expireAfterSeconds === 0
  )));
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'controllers', 'adminMfa.controller.js'),
    'utf8'
  );
  assert.match(source, /findOneAndUpdate\(/);
  assert.match(source, /usedAt: null/);
});

test('password and SSO login both stop for MFA before issuing a session', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'controllers', 'adminAuth.controller.js'),
    'utf8'
  );
  assert.match(source, /createMfaChallenge\(admin, 'password'\)/);
  assert.match(source, /createMfaChallenge\(admin, req\.params\.provider\)/);
  assert.match(source, /requiresMfa: true/);
});

test('enabling or disabling MFA invalidates existing admin sessions', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'controllers', 'adminMfa.controller.js'),
    'utf8'
  );
  const revocations = source.match(/AdminSession\.updateMany\(/g) || [];
  assert.equal(revocations.length, 2);
  assert.match(source, /tokenVersion = \(admin\.tokenVersion \|\| 0\) \+ 1/);
});
