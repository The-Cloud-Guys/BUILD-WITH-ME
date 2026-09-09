const jwt = require('jsonwebtoken');

const AdminAccount = require('../models/adminAccount.model');
const {
  ADMIN_TOKEN_AUDIENCE,
  ADMIN_TOKEN_ISSUER,
} = require('../services/adminAuth.service');

const getAdminAccessToken = (req) => {
  if (req.headers.authorization?.startsWith('Bearer ')) {
    return req.headers.authorization.slice(7).trim();
  }
  return req.cookies?.adminAccessToken || null;
};

const authenticateAdmin = async (req, res, next) => {
  const token = getAdminAccessToken(req);
  if (!token) {
    return res.status(401).json({ message: 'Admin authentication required' });
  }

  try {
    const decoded = jwt.verify(token, process.env.ADMIN_JWT_SECRET, {
      issuer: ADMIN_TOKEN_ISSUER,
      audience: ADMIN_TOKEN_AUDIENCE,
    });

    if (decoded.type !== 'admin' || !decoded.sub) {
      return res.status(401).json({ message: 'Invalid admin access token' });
    }

    const admin = await AdminAccount.findById(decoded.sub);
    if (
      !admin ||
      admin.isActive === false ||
      (admin.tokenVersion || 0) !== decoded.tokenVersion
    ) {
      return res.status(401).json({ message: 'Admin account unavailable' });
    }

    req.adminAccount = admin;
    req.adminSessionId = decoded.sid;
    return next();
  } catch (_) {
    return res.status(401).json({ message: 'Invalid or expired admin access token' });
  }
};

module.exports = { authenticateAdmin, getAdminAccessToken };
