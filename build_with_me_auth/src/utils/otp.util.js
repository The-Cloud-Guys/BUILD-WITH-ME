const crypto = require('crypto');

function generateAlphanumericOTP(length = 6) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let otp = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    otp += chars[bytes[i] % chars.length];
  }
  return otp;
}

function hashOTP(otp) {
  return crypto.createHash('sha256').update(otp).digest('hex');
}

module.exports = { generateAlphanumericOTP, hashOTP };