const jwt = require('jsonwebtoken');

const AdminAccount = require('../models/adminAccount.model');
const AdminSession = require('../models/adminSession.model');
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

    const activeSession = await AdminSession.exists({
      admin: admin._id,
      family: decoded.sid,
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    });
    if (!activeSession) {
      return res.status(401).json({ message: 'Admin session unavailable' });
    }

    req.adminAccount = admin;
    // Temporary controller compatibility during the phased cutover.
    req.admin = admin;
    req.adminSessionId = decoded.sid;
    return next();
  } catch (_) {
    return res.status(401).json({ message: 'Invalid or expired admin access token' });
  }
};

const requireAdminPermission = (permission) => (req, res, next) => {
  const admin = req.adminAccount;
  const authorized = admin && (
    admin.role === 'super_admin' || admin.permissions.includes(permission)
  );

  if (!authorized) {
    return res.status(403).json({
      message: 'Insufficient admin permissions',
      requiredPermission: permission,
    });
  }
  return next();
};

const normalizeOrigin = (value) => {
  if (typeof value !== 'string') return null;
  return value.trim().replace(/\/$/, '') || null;
};

const verifyAdminRequestOrigin = (req, res, next) => {
  // Bearer tokens are explicitly attached by the client and are not
  // automatically included in cross-site browser requests.
  if (req.headers.authorization?.startsWith('Bearer ')) return next();

  const origin = normalizeOrigin(req.get('origin'));
  if (!origin) return next();

  const configuredOrigins = new Set([
    normalizeOrigin(process.env.ADMIN_DASHBOARD_URL),
    normalizeOrigin(`${req.protocol}://${req.get('host')}`),
  ].filter(Boolean));

  if (!configuredOrigins.has(origin)) {
    return res.status(403).json({ message: 'Admin request origin is not allowed' });
  }
  return next();
};

module.exports = {
  authenticateAdmin,
  getAdminAccessToken,
  requireAdminPermission,
  verifyAdminRequestOrigin,
};
