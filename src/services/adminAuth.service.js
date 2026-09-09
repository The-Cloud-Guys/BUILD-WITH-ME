const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const AdminAccount = require('../models/adminAccount.model');
const AdminSession = require('../models/adminSession.model');

const ADMIN_TOKEN_ISSUER = 'connexd-admin-api';
const ADMIN_TOKEN_AUDIENCE = 'connexd-admin-dashboard';

const hashToken = (token) =>
  crypto.createHash('sha256').update(token).digest('hex');

const getDurationMs = (rawValue, fallback) => {
  const value = typeof rawValue === 'string' && rawValue.trim()
    ? rawValue.trim()
    : fallback;
  const match = /^(\d+)\s*([smhd])$/i.exec(value);
  if (!match) return getDurationMs(fallback, '12h');

  const units = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  return Number(match[1]) * units[match[2].toLowerCase()];
};

const getRequestMetadata = (req) => ({
  userAgent: req.get('user-agent') || '',
  ip: req.ip || req.socket?.remoteAddress || '',
});

const getRequiredSecret = (name) => {
  const value = process.env[name];
  if (!value) {
    const error = new Error(`${name} is not configured`);
    error.statusCode = 503;
    throw error;
  }
  return value;
};

const assertAdminAuthConfigured = ({ includeBootstrap = false } = {}) => {
  getRequiredSecret('ADMIN_JWT_SECRET');
  getRequiredSecret('ADMIN_REFRESH_SECRET');
  if (includeBootstrap) getRequiredSecret('ADMIN_SECRET_KEY');
};

const verifyAdminBootstrapSecret = (providedSecret) => {
  if (typeof providedSecret !== 'string' || providedSecret.length === 0) {
    return false;
  }

  const configuredDigest = crypto
    .createHash('sha256')
    .update(getRequiredSecret('ADMIN_SECRET_KEY'))
    .digest();
  const providedDigest = crypto
    .createHash('sha256')
    .update(providedSecret)
    .digest();

  return crypto.timingSafeEqual(configuredDigest, providedDigest);
};

const issueAdminTokenPair = async (admin, req, options = {}) => {
  const jwtSecret = getRequiredSecret('ADMIN_JWT_SECRET');
  const refreshSecret = getRequiredSecret('ADMIN_REFRESH_SECRET');
  const family = options.family || crypto.randomUUID();
  const jti = crypto.randomUUID();
  const authMethod = options.authMethod || 'password';
  const tokenVersion = admin.tokenVersion || 0;

  const accessToken = jwt.sign(
    {
      sub: admin._id.toString(),
      sid: family,
      type: 'admin',
      tokenVersion,
    },
    jwtSecret,
    {
      expiresIn: process.env.ADMIN_ACCESS_EXPIRES_IN || '15m',
      issuer: ADMIN_TOKEN_ISSUER,
      audience: ADMIN_TOKEN_AUDIENCE,
    }
  );

  const refreshToken = jwt.sign(
    {
      sub: admin._id.toString(),
      jti,
      family,
      type: 'admin_refresh',
      tokenVersion,
    },
    refreshSecret,
    {
      expiresIn: process.env.ADMIN_REFRESH_EXPIRES_IN || '12h',
      issuer: ADMIN_TOKEN_ISSUER,
      audience: ADMIN_TOKEN_AUDIENCE,
    }
  );

  const metadata = getRequestMetadata(req);
  await AdminSession.create({
    admin: admin._id,
    jti,
    family,
    tokenHash: hashToken(refreshToken),
    authMethod,
    userAgent: metadata.userAgent,
    ip: metadata.ip,
    expiresAt: new Date(
      Date.now() + getDurationMs(process.env.ADMIN_REFRESH_EXPIRES_IN, '12h')
    ),
  });

  return { accessToken, refreshToken };
};

const rotateAdminRefreshToken = async (refreshToken, req) => {
  const decoded = jwt.verify(
    refreshToken,
    getRequiredSecret('ADMIN_REFRESH_SECRET'),
    {
      issuer: ADMIN_TOKEN_ISSUER,
      audience: ADMIN_TOKEN_AUDIENCE,
    }
  );

  if (
    decoded.type !== 'admin_refresh' ||
    !decoded.sub ||
    !decoded.jti ||
    !decoded.family
  ) {
    const error = new Error('Invalid admin refresh token');
    error.statusCode = 401;
    throw error;
  }

  const session = await AdminSession.findOne({
    admin: decoded.sub,
    jti: decoded.jti,
  }).select('+tokenHash');

  if (!session || session.revokedAt || session.expiresAt <= new Date()) {
    if (session?.replacedByJti) {
      await AdminSession.updateMany(
        { family: decoded.family, revokedAt: null },
        { $set: { revokedAt: new Date() } }
      );
    }
    const error = new Error('Admin session revoked or expired');
    error.statusCode = 401;
    throw error;
  }

  if (session.tokenHash !== hashToken(refreshToken)) {
    await AdminSession.updateMany(
      { family: decoded.family, revokedAt: null },
      { $set: { revokedAt: new Date() } }
    );
    const error = new Error('Admin refresh token mismatch');
    error.statusCode = 401;
    throw error;
  }

  const admin = await AdminAccount.findById(decoded.sub);
  if (
    !admin ||
    admin.isActive === false ||
    (admin.tokenVersion || 0) !== decoded.tokenVersion
  ) {
    await AdminSession.updateMany(
      { admin: decoded.sub, revokedAt: null },
      { $set: { revokedAt: new Date() } }
    );
    const error = new Error('Admin account unavailable');
    error.statusCode = 401;
    throw error;
  }

  const nextPair = await issueAdminTokenPair(admin, req, {
    authMethod: session.authMethod,
    family: decoded.family,
  });

  const nextDecoded = jwt.decode(nextPair.refreshToken);
  session.revokedAt = new Date();
  session.replacedByJti = nextDecoded.jti;
  session.lastUsedAt = new Date();
  await session.save();

  return { admin, ...nextPair };
};

const revokeAdminRefreshToken = async (refreshToken) => {
  if (!refreshToken) return;

  try {
    const decoded = jwt.verify(
      refreshToken,
      getRequiredSecret('ADMIN_REFRESH_SECRET'),
      {
        issuer: ADMIN_TOKEN_ISSUER,
        audience: ADMIN_TOKEN_AUDIENCE,
      }
    );
    if (decoded?.jti) {
      await AdminSession.findOneAndUpdate(
        { jti: decoded.jti, admin: decoded.sub },
        { $set: { revokedAt: new Date() } }
      );
    }
  } catch (_) {
    // Logout stays idempotent for malformed, expired, or revoked tokens.
  }
};

module.exports = {
  ADMIN_TOKEN_AUDIENCE,
  ADMIN_TOKEN_ISSUER,
  assertAdminAuthConfigured,
  getDurationMs,
  issueAdminTokenPair,
  revokeAdminRefreshToken,
  rotateAdminRefreshToken,
  verifyAdminBootstrapSecret,
};
