const crypto = require('crypto');

/**
 * Generate a 6-digit numeric OTP (0-9)
 */
function generateNumericOTP(length = 6) {
  let otp = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    otp += (bytes[i] % 10).toString();
  }
  return otp;
}

function hashOTP(otp) {
  return crypto.createHash('sha256').update(otp).digest('hex');
}

module.exports = { generateNumericOTP, hashOTP };