const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

const AdminAccount = require('../models/adminAccount.model');
const AdminInvite = require('../models/adminInvite.model');
const { hashInvitationToken } = require('../services/adminInvitation.service');
const { DEFAULT_ADMIN_PERMISSIONS } = require('../constants/admin.constants');
const {
  assertAdminAuthConfigured,
  issueAdminTokenPair,
  getDurationMs,
  revokeAdminRefreshToken,
  rotateAdminRefreshToken,
  verifyAdminBootstrapSecret,
} = require('../services/adminAuth.service');
const {
  acceptAdminInvitationValidation,
  adminLoginValidation,
  bootstrapAdminValidation,
} = require('../validation/adminAuth.validation');

const setAdminCookies = (res, accessToken, refreshToken) => {
  const isProduction = process.env.NODE_ENV === 'production';
  const sharedOptions = {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    path: '/api/admin',
  };

  res.cookie('adminAccessToken', accessToken, {
    ...sharedOptions,
    maxAge: getDurationMs(process.env.ADMIN_ACCESS_EXPIRES_IN, '15m'),
  });
  res.cookie('adminRefreshToken', refreshToken, {
    ...sharedOptions,
    maxAge: getDurationMs(process.env.ADMIN_REFRESH_EXPIRES_IN, '12h'),
  });
};

const clearAdminCookies = (res) => {
  const isProduction = process.env.NODE_ENV === 'production';
  const options = {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    path: '/api/admin',
  };
  res.clearCookie('adminAccessToken', options);
  res.clearCookie('adminRefreshToken', options);
};

const serializeAdmin = (admin) => ({
  _id: admin._id,
  email: admin.email,
  firstName: admin.firstName,
  lastName: admin.lastName,
  fullName: admin.fullName,
  role: admin.role,
  permissions: admin.permissions,
  authMethods: admin.authMethods,
  mfaEnabled: admin.mfaEnabled,
  lastLoginAt: admin.lastLoginAt,
});

const bootstrapAdmin = async (req, res) => {
  try {
    const { error, value } = bootstrapAdminValidation(req.body);
    if (error) {
      return res.status(400).json({ message: error.details[0].message });
    }

    // Validate all required signing configuration before creating the only
    // bootstrap account, so a configuration error cannot lock bootstrap.
    assertAdminAuthConfigured({ includeBootstrap: true });

    const bootstrapSecret = req.get('x-admin-bootstrap-secret');
    if (!verifyAdminBootstrapSecret(bootstrapSecret)) {
      return res.status(403).json({ message: 'Invalid admin bootstrap credentials' });
    }

    if (await AdminAccount.exists({})) {
      return res.status(409).json({ message: 'Admin bootstrap is no longer available' });
    }

    const passwordHash = await bcrypt.hash(value.password, 12);
    let admin;
    try {
      admin = await AdminAccount.create({
        email: value.email,
        passwordHash,
        firstName: value.firstName,
        lastName: value.lastName,
        role: 'super_admin',
        permissions: DEFAULT_ADMIN_PERMISSIONS.super_admin,
        authMethods: ['password'],
        emailVerified: true,
        bootstrapOwner: true,
        lastLoginAt: new Date(),
        lastActivityAt: new Date(),
      });
    } catch (errorCreatingAdmin) {
      if (errorCreatingAdmin?.code === 11000) {
        return res.status(409).json({ message: 'Admin bootstrap is no longer available' });
      }
      throw errorCreatingAdmin;
    }

    let tokens;
    try {
      tokens = await issueAdminTokenPair(admin, req, { authMethod: 'password' });
    } catch (tokenError) {
      // Allow a safe retry if the initial session could not be persisted.
      await AdminAccount.deleteOne({ _id: admin._id, bootstrapOwner: true });
      throw tokenError;
    }
    setAdminCookies(res, tokens.accessToken, tokens.refreshToken);

    return res.status(201).json({
      message: 'Initial super administrator created successfully',
      admin: serializeAdmin(admin),
    });
  } catch (error) {
    console.error('Admin bootstrap failed:', error.message);
    return res.status(error.statusCode || 500).json({
      message: error.statusCode ? error.message : 'Unable to bootstrap administrator',
    });
  }
};

const loginAdmin = async (req, res) => {
  try {
    const { error, value } = adminLoginValidation(req.body);
    if (error) {
      return res.status(400).json({ message: error.details[0].message });
    }

    const admin = await AdminAccount.findOne({ email: value.email })
      .select('+passwordHash');
    const passwordMatches = admin?.passwordHash
      ? await bcrypt.compare(value.password, admin.passwordHash)
      : false;

    if (!admin || !passwordMatches) {
      return res.status(401).json({ message: 'Invalid admin credentials' });
    }
    if (admin.isActive === false) {
      return res.status(401).json({ message: 'Admin account unavailable' });
    }

    const tokens = await issueAdminTokenPair(admin, req, { authMethod: 'password' });
    admin.lastLoginAt = new Date();
    admin.lastActivityAt = new Date();
    await admin.save();
    setAdminCookies(res, tokens.accessToken, tokens.refreshToken);

    return res.json({
      message: 'Admin login successful',
      admin: serializeAdmin(admin),
    });
  } catch (error) {
    console.error('Admin login failed:', error.message);
    return res.status(error.statusCode || 500).json({
      message: error.statusCode ? error.message : 'Unable to authenticate administrator',
    });
  }
};

const acceptAdminInvitation = async (req, res) => {
  const { error, value } = acceptAdminInvitationValidation(req.body);
  if (error) return res.status(400).json({ message: error.details[0].message });

  const passwordHash = await bcrypt.hash(value.password, 12);
  let databaseSession;
  let admin;
  let tokens;
  try {
    databaseSession = await mongoose.startSession();
    await databaseSession.withTransaction(async () => {
      const now = new Date();
      const invitation = await AdminInvite.findOneAndUpdate(
        {
          tokenHash: hashInvitationToken(value.token),
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { $gt: now },
        },
        { $set: { acceptedAt: now } },
        { new: true, session: databaseSession }
      );

      if (!invitation) {
        const invalidInvite = new Error('Admin invitation is invalid or expired');
        invalidInvite.statusCode = 400;
        throw invalidInvite;
      }

      if (invitation.existingAdmin) {
        admin = await AdminAccount.findOne({
          _id: invitation.existingAdmin,
          migrationPending: true,
        }).session(databaseSession);
        if (!admin) {
          const unavailable = new Error('Migrated administrator is unavailable');
          unavailable.statusCode = 409;
          throw unavailable;
        }
        admin.email = invitation.email;
        admin.firstName = invitation.firstName;
        admin.lastName = invitation.lastName;
        admin.role = invitation.role;
        admin.permissions = invitation.permissions;
        admin.passwordHash = passwordHash;
        admin.authMethods = Array.from(new Set([...admin.authMethods, 'password']));
        admin.emailVerified = true;
        admin.isActive = true;
        admin.migrationPending = false;
        admin.addedBy = invitation.invitedBy;
        admin.lastLoginAt = now;
        admin.lastActivityAt = now;
        await admin.save({ session: databaseSession });
      } else {
        [admin] = await AdminAccount.create([{
          email: invitation.email,
          passwordHash,
          firstName: invitation.firstName,
          lastName: invitation.lastName,
          role: invitation.role,
          permissions: invitation.permissions,
          authMethods: ['password'],
          emailVerified: true,
          isActive: true,
          addedBy: invitation.invitedBy,
          lastLoginAt: now,
          lastActivityAt: now,
        }], { session: databaseSession });
      }

      tokens = await issueAdminTokenPair(admin, req, {
        authMethod: 'password',
        dbSession: databaseSession,
      });
    });

    setAdminCookies(res, tokens.accessToken, tokens.refreshToken);
    return res.status(201).json({
      message: 'Admin invitation accepted successfully',
      admin: serializeAdmin(admin),
    });
  } catch (acceptanceError) {
    const statusCode = acceptanceError.statusCode ||
      (acceptanceError.code === 11000 ? 409 : 500);
    console.error('Accept admin invitation failed:', acceptanceError.message);
    return res.status(statusCode).json({
      message: statusCode === 500
        ? 'Unable to accept admin invitation'
        : acceptanceError.message,
    });
  } finally {
    if (databaseSession) await databaseSession.endSession();
  }
};

const refreshAdminSession = async (req, res) => {
  try {
    const suppliedToken = req.cookies?.adminRefreshToken;
    if (!suppliedToken) {
      return res.status(401).json({ message: 'Admin refresh token required' });
    }

    const rotated = await rotateAdminRefreshToken(suppliedToken, req);
    setAdminCookies(res, rotated.accessToken, rotated.refreshToken);
    return res.json({
      message: 'Admin session refreshed',
      admin: serializeAdmin(rotated.admin),
    });
  } catch (error) {
    clearAdminCookies(res);
    return res.status(error.statusCode || 401).json({
      message: error.statusCode ? error.message : 'Invalid admin refresh token',
    });
  }
};

const logoutAdmin = async (req, res) => {
  await revokeAdminRefreshToken(req.cookies?.adminRefreshToken);
  clearAdminCookies(res);
  return res.json({ message: 'Admin logged out' });
};

const getCurrentAdmin = async (req, res) => res.json({
  admin: serializeAdmin(req.adminAccount),
});

module.exports = {
  acceptAdminInvitation,
  bootstrapAdmin,
  clearAdminCookies,
  getCurrentAdmin,
  loginAdmin,
  logoutAdmin,
  refreshAdminSession,
  serializeAdmin,
  setAdminCookies,
};
