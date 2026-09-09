const crypto = require('crypto');

const hashInvitationToken = (token) =>
  crypto.createHash('sha256').update(token).digest('hex');

module.exports = { hashInvitationToken };
