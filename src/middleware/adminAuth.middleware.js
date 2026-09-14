const AdminAccount = require('../models/adminAccount.model');
const { verifyFirebaseSessionCookie } = require('../services/firebase.service');

const authenticateAdmin = async (req, res, next) => {
  try {
    const decoded = await verifyFirebaseSessionCookie(req.cookies?.adminSession);
    if (!decoded.uid || !decoded.email || decoded.email_verified !== true) {
      return res.status(401).json({ message: 'Verified Firebase admin session required' });
    }
    const admin = await AdminAccount.findOne({ firebaseUid: decoded.uid });
    if (
      !admin || admin.isActive === false || admin.migrationPending
      || admin.email !== decoded.email.toLowerCase().trim()
    ) {
      return res.status(401).json({ message: 'Admin account unavailable' });
    }
    req.adminAccount = admin;
    req.admin = admin;
    req.firebaseAdminIdentity = decoded;
    return next();
  } catch (error) {
    return res.status(error.statusCode || 401).json({
      message: error.statusCode === 503
        ? 'Firebase authentication is unavailable'
        : 'Invalid or expired admin session',
    });
  }
};

const requireAdminPermission = (permission) => (req, res, next) => {
  const admin = req.adminAccount;
  if (!admin || (admin.role !== 'super_admin' && !admin.permissions.includes(permission))) {
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
  requireAdminPermission,
  verifyAdminRequestOrigin,
};
