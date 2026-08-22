const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const RefreshSession = require('../models/refreshSession.model');

const hashToken = (token) =>
  crypto.createHash('sha256').update(token).digest('hex');

const getRefreshExpiryDate = () => {
  const raw = process.env.JWT_REFRESH_EXPIRES_IN || '7d';
  const match = /^(\d+)\s*d$/i.exec(raw);
  const days = match ? Number(match[1]) : 7;

  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
};

const getRequestMetadata = (req) => ({
  userAgent: req.get('user-agent') || '',
  ip: req.ip || req.socket?.remoteAddress || '',
});

const issueTokenPair = async (user, req, options = {}) => {
  const family = options.family || crypto.randomUUID();
  const jti = crypto.randomUUID();

  const accessToken = jwt.sign(
    { id: user._id },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '5h' }
  );

  const refreshToken = jwt.sign(
    { id: user._id, jti, family, type: 'refresh' },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
  );

  const metadata = getRequestMetadata(req);

  await RefreshSession.create({
    user: user._id,
    jti,
    family,
    tokenHash: hashToken(refreshToken),
    userAgent: metadata.userAgent,
    ip: metadata.ip,
    expiresAt: getRefreshExpiryDate(),
  });

  return { accessToken, refreshToken, jti, family };
};

const rotateRefreshToken = async (refreshToken, req) => {
  const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

  if (
    decoded.type !== 'refresh' ||
    !decoded.id ||
    !decoded.jti ||
    !decoded.family
  ) {
    const err = new Error('Invalid refresh token');
    err.statusCode = 401;
    throw err;
  }

  const session = await RefreshSession.findOne({
    jti: decoded.jti,
    user: decoded.id,
  }).select('+tokenHash');

  if (!session || session.revokedAt || session.expiresAt <= new Date()) {
    if (session?.replacedByJti) {
      await RefreshSession.updateMany(
        { family: decoded.family, revokedAt: null },
        { $set: { revokedAt: new Date() } }
      );
    }

    const err = new Error('Refresh token revoked or expired');
    err.statusCode = 401;
    throw err;
  }

  if (session.tokenHash !== hashToken(refreshToken)) {
    await RefreshSession.updateMany(
      { family: decoded.family, revokedAt: null },
      { $set: { revokedAt: new Date() } }
    );

    const err = new Error('Refresh token mismatch');
    err.statusCode = 401;
    throw err;
  }

  const User = require('../models/user.model');
  const user = await User.findById(decoded.id);

  if (!user || user.isActive === false || user.isSuspended === true) {
    await RefreshSession.updateMany(
      { user: decoded.id, revokedAt: null },
      { $set: { revokedAt: new Date() } }
    );

    const err = new Error('Account unavailable');
    err.statusCode = 401;
    throw err;
  }

  const nextPair = await issueTokenPair(user, req, {
    family: decoded.family,
  });

  session.revokedAt = new Date();
  session.replacedByJti = nextPair.jti;
  session.lastUsedAt = new Date();
  await session.save();

  return {
    user,
    accessToken: nextPair.accessToken,
    refreshToken: nextPair.refreshToken,
  };
};

const revokeRefreshToken = async (refreshToken) => {
  if (!refreshToken) return;

  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

    if (decoded?.jti) {
      await RefreshSession.findOneAndUpdate(
        { jti: decoded.jti },
        { $set: { revokedAt: new Date() } }
      );
    }
  } catch (_) {
    // Logout remains idempotent for invalid/expired tokens.
  }
};

const revokeAllUserSessions = async (userId) => {
  await RefreshSession.updateMany(
    { user: userId, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
};

module.exports = {
  issueTokenPair,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllUserSessions,
};
