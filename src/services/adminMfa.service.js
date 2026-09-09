const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const AdminMfaChallenge = require('../models/adminMfaChallenge.model');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const MFA_ISSUER = 'CONNEXD Admin';

const base32Encode = (buffer) => {
  let bits = '';
  for (const byte of buffer) bits += byte.toString(2).padStart(8, '0');
  let result = '';
  for (let index = 0; index < bits.length; index += 5) {
    result += ALPHABET[parseInt(bits.slice(index, index + 5).padEnd(5, '0'), 2)];
  }
  return result;
};

const base32Decode = (value) => {
  let bits = '';
  for (const character of value.replace(/=+$/, '').toUpperCase()) {
    const index = ALPHABET.indexOf(character);
    if (index < 0) throw new Error('Invalid MFA secret');
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
};

const getEncryptionKey = () => {
  const configured = process.env.ADMIN_MFA_ENCRYPTION_KEY;
  const key = configured ? Buffer.from(configured, 'base64') : Buffer.alloc(0);
  if (key.length !== 32) {
    const error = new Error('ADMIN_MFA_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
    error.statusCode = 503;
    throw error;
  }
  return key;
};

const encryptSecret = (secret) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((part) => part.toString('base64url')).join('.');
};

const decryptSecret = (encrypted) => {
  const [iv, tag, ciphertext] = String(encrypted || '')
    .split('.')
    .map((part) => Buffer.from(part, 'base64url'));
  if (!iv || !tag || !ciphertext) throw new Error('Invalid encrypted MFA secret');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
};

const generateTotpSecret = () => base32Encode(crypto.randomBytes(20));

const generateTotp = (secret, timestamp = Date.now()) => {
  const counter = Math.floor(timestamp / 30000);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', base32Decode(secret)).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = (digest.readUInt32BE(offset) & 0x7fffffff) % 1000000;
  return String(binary).padStart(6, '0');
};

const verifyTotp = (secret, suppliedCode, timestamp = Date.now()) => {
  const code = String(suppliedCode || '');
  if (!/^\d{6}$/.test(code)) return false;
  return [-1, 0, 1].some((window) => {
    const expected = generateTotp(secret, timestamp + window * 30000);
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(code));
  });
};

const buildOtpAuthUrl = (admin, secret) => {
  const label = encodeURIComponent(`${MFA_ISSUER}:${admin.email}`);
  const query = new URLSearchParams({
    secret,
    issuer: MFA_ISSUER,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${label}?${query}`;
};

const hashChallengeId = (jti) => crypto.createHash('sha256').update(jti).digest('hex');

const createMfaChallenge = async (admin, authMethod) => {
  const jti = crypto.randomUUID();
  const token = jwt.sign({
    sub: admin._id.toString(),
    jti,
    authMethod,
    tokenVersion: admin.tokenVersion || 0,
    type: 'admin_mfa_challenge',
  },
  process.env.ADMIN_JWT_SECRET, {
    expiresIn: '5m',
    issuer: 'connexd-admin-api',
    audience: 'connexd-admin-mfa',
  });
  await AdminMfaChallenge.create({
    admin: admin._id,
    jtiHash: hashChallengeId(jti),
    authMethod,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  });
  return token;
};

const verifyMfaChallenge = (token) => jwt.verify(token, process.env.ADMIN_JWT_SECRET, {
  issuer: 'connexd-admin-api',
  audience: 'connexd-admin-mfa',
});

const mfaCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  path: '/api/admin',
});

const setMfaChallengeCookie = (res, token) => res.cookie('adminMfaChallenge', token, {
  ...mfaCookieOptions(),
  maxAge: 5 * 60 * 1000,
});

const clearMfaChallengeCookie = (res) => res.clearCookie(
  'adminMfaChallenge',
  mfaCookieOptions()
);

module.exports = {
  buildOtpAuthUrl,
  clearMfaChallengeCookie,
  createMfaChallenge,
  decryptSecret,
  encryptSecret,
  generateTotp,
  generateTotpSecret,
  hashChallengeId,
  setMfaChallengeCookie,
  verifyMfaChallenge,
  verifyTotp,
};
