const crypto = require('crypto');
const mongoose = require('mongoose');

const AdminAccount = require('../models/adminAccount.model');
const AdminInvite = require('../models/adminInvite.model');
const { AuditLog } = require('../models/admin.model');
const { DEFAULT_ADMIN_PERMISSIONS } = require('../constants/admin.constants');
const { hashInvitationToken } = require('../services/adminInvitation.service');
const { createMfaChallenge, setMfaChallengeCookie } = require('../services/adminMfa.service');
const { getDurationMs } = require('../services/duration.service');
const {
  createFirebaseSessionCookie,
  revokeFirebaseSessions,
  verifyFirebaseSessionCookie,
  verifyFirebaseToken,
} = require('../services/firebase.service');
const {
  adminFirebaseValidation,
  bootstrapFirebaseAdminValidation,
  invitationTokenValidation,
  acceptFirebaseInvitationValidation,
} = require('../validation/adminAuth.validation');

const getSessionDuration = () => {
  const duration = getDurationMs(process.env.ADMIN_SESSION_EXPIRES_IN, '12h');
  return Math.min(Math.max(duration, 5 * 60 * 1000), 14 * 24 * 60 * 60 * 1000);
};

const adminCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  path: '/api/admin',
});

const setAdminSessionCookie = (res, sessionCookie) => res.cookie('adminSession', sessionCookie, {
  ...adminCookieOptions(),
  maxAge: getSessionDuration(),
});

const clearAdminCookies = (res) => res.clearCookie('adminSession', adminCookieOptions());

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

const verifyBootstrapSecret = (provided) => {
  const configured = process.env.ADMIN_SECRET_KEY;
  if (!configured || typeof provided !== 'string' || !provided) return false;
  const expected = crypto.createHash('sha256').update(configured).digest();
  const actual = crypto.createHash('sha256').update(provided).digest();
  return crypto.timingSafeEqual(expected, actual);
};

const getVerifiedFirebaseIdentity = async (idToken) => {
  const decoded = await verifyFirebaseToken(idToken, { checkRevoked: true });
  const uid = typeof decoded.uid === 'string' ? decoded.uid.trim() : '';
  const email = typeof decoded.email === 'string' ? decoded.email.trim().toLowerCase() : '';
  if (!uid || !email || decoded.email_verified !== true) {
    const error = new Error('A verified Firebase email is required');
    error.statusCode = 401;
    throw error;
  }
  return { decoded, email, uid };
};

const establishFirebaseSession = async (admin, idToken, req, res) => {
  if (admin.mfaEnabled) {
    setMfaChallengeCookie(res, await createMfaChallenge(admin, 'firebase', idToken));
    return false;
  }
  const sessionCookie = await createFirebaseSessionCookie(idToken, getSessionDuration());
  setAdminSessionCookie(res, sessionCookie);
  admin.lastLoginAt = new Date();
  admin.lastActivityAt = new Date();
  await admin.save();
  return true;
};

const bootstrapFirebaseAdmin = async (req, res) => {
  const { error, value } = bootstrapFirebaseAdminValidation(req.body);
  if (error) return res.status(400).json({ message: error.details[0].message });
  try {
    if (!verifyBootstrapSecret(req.get('x-admin-bootstrap-secret'))) {
      return res.status(403).json({ message: 'Invalid admin bootstrap credentials' });
    }
    if (await AdminAccount.exists({})) {
      return res.status(409).json({ message: 'Admin bootstrap is no longer available' });
    }
    const identity = await getVerifiedFirebaseIdentity(value.idToken);
    let admin;
    try {
      admin = await AdminAccount.create({
        email: identity.email,
        firebaseUid: identity.uid,
        firstName: value.firstName,
        lastName: value.lastName,
        role: 'super_admin',
        permissions: DEFAULT_ADMIN_PERMISSIONS.super_admin,
        authMethods: ['firebase'],
        emailVerified: true,
        bootstrapOwner: true,
        isActive: true,
      });
    } catch (createError) {
      if (createError.code === 11000) {
        return res.status(409).json({ message: 'Admin bootstrap is no longer available' });
      }
      throw createError;
    }
    const authenticated = await establishFirebaseSession(admin, value.idToken, req, res);
    return res.status(201).json({
      message: 'Initial Firebase super administrator created successfully',
      requiresMfa: !authenticated,
      admin: serializeAdmin(admin),
    });
  } catch (bootstrapError) {
    console.error('Firebase admin bootstrap failed:', bootstrapError.message);
    return res.status(bootstrapError.statusCode || 500).json({
      message: bootstrapError.statusCode === 503
        ? 'Firebase authentication is unavailable'
        : 'Unable to bootstrap administrator',
    });
  }
};

const loginAdminWithFirebase = async (req, res) => {
  const { error, value } = adminFirebaseValidation(req.body);
  if (error) return res.status(400).json({ message: error.details[0].message });
  try {
    const identity = await getVerifiedFirebaseIdentity(value.idToken);
    let admin = await AdminAccount.findOne({ firebaseUid: identity.uid });
    if (admin && admin.email !== identity.email) {
      return res.status(401).json({ message: 'Firebase identity does not match admin email' });
    }
    if (!admin) admin = await AdminAccount.findOne({ email: identity.email });
    if (!admin || admin.isActive === false || admin.migrationPending) {
      return res.status(403).json({ message: 'Administrator access has not been activated' });
    }
    if (admin.firebaseUid && admin.firebaseUid !== identity.uid) {
      return res.status(409).json({ message: 'Admin account is linked to another Firebase identity' });
    }
    admin.firebaseUid = identity.uid;
    admin.authMethods = ['firebase'];
    admin.emailVerified = true;
    await admin.save();
    const authenticated = await establishFirebaseSession(admin, value.idToken, req, res);
    if (!authenticated) {
      return res.status(202).json({
        message: 'Admin MFA verification required',
        requiresMfa: true,
      });
    }
    return res.json({ message: 'Admin Firebase login successful', admin: serializeAdmin(admin) });
  } catch (loginError) {
    console.error('Admin Firebase login failed:', loginError.message);
    const status = loginError.code === 11000 ? 409 : (loginError.statusCode || 401);
    return res.status(status).json({
      message: loginError.statusCode === 503
        ? 'Firebase authentication is unavailable'
        : loginError.code === 11000
          ? 'Firebase identity is already linked to another administrator'
          : 'Unable to authenticate administrator with Firebase',
    });
  }
};

const verifyAdminInvitation = async (req, res) => {
  const { error, value } = invitationTokenValidation(req.body);
  if (error) return res.status(400).json({ message: error.details[0].message });
  try {
    const invitation = await AdminInvite.findOne({
      tokenHash: hashInvitationToken(value.token),
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    }).select('email firstName lastName role expiresAt');
    if (!invitation) return res.status(404).json({ valid: false, message: 'Invitation is invalid or expired' });
    return res.json({
      valid: true,
      invitation: {
        email: invitation.email,
        firstName: invitation.firstName,
        lastName: invitation.lastName,
        role: invitation.role,
        expiresAt: invitation.expiresAt,
      },
    });
  } catch (verifyError) {
    console.error('Verify admin invitation failed:', verifyError.message);
    return res.status(500).json({ message: 'Unable to verify admin invitation' });
  }
};

const acceptFirebaseInvitation = async (req, res) => {
  const { error, value } = acceptFirebaseInvitationValidation(req.body);
  if (error) return res.status(400).json({ message: error.details[0].message });
  let databaseSession;
  let admin;
  try {
    const identity = await getVerifiedFirebaseIdentity(value.idToken);
    databaseSession = await mongoose.startSession();
    await databaseSession.withTransaction(async () => {
      const invitation = await AdminInvite.findOneAndUpdate(
        {
          tokenHash: hashInvitationToken(value.token),
          email: identity.email,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { $gt: new Date() },
        },
        { $set: { acceptedAt: new Date() } },
        { new: true, session: databaseSession }
      );
      if (!invitation) {
        const invalid = new Error('Invitation is invalid, expired, or belongs to another email');
        invalid.statusCode = 400;
        throw invalid;
      }
      if (invitation.existingAdmin) {
        admin = await AdminAccount.findOne({
          _id: invitation.existingAdmin,
          migrationPending: true,
        }).session(databaseSession);
        if (!admin) {
          const unavailable = new Error('Invited administrator is unavailable');
          unavailable.statusCode = 409;
          throw unavailable;
        }
        Object.assign(admin, {
          email: invitation.email,
          firebaseUid: identity.uid,
          firstName: invitation.firstName,
          lastName: invitation.lastName,
          role: invitation.role,
          permissions: invitation.permissions,
          authMethods: ['firebase'],
          emailVerified: true,
          isActive: true,
          migrationPending: false,
          addedBy: invitation.invitedBy,
        });
        await admin.save({ session: databaseSession });
      } else {
        [admin] = await AdminAccount.create([{
          email: invitation.email,
          firebaseUid: identity.uid,
          firstName: invitation.firstName,
          lastName: invitation.lastName,
          role: invitation.role,
          permissions: invitation.permissions,
          authMethods: ['firebase'],
          emailVerified: true,
          isActive: true,
          addedBy: invitation.invitedBy,
        }], { session: databaseSession });
      }
      await AuditLog.create([{
        adminAccount: invitation.invitedBy,
        action: 'accept_admin_invitation',
        targetType: 'admin',
        targetId: admin._id,
        details: { email: invitation.email, activationMethod: 'firebase' },
      }], { session: databaseSession });
    });
    const authenticated = await establishFirebaseSession(admin, value.idToken, req, res);
    return res.status(201).json({
      message: 'Firebase administrator invitation accepted successfully',
      requiresMfa: !authenticated,
      admin: serializeAdmin(admin),
    });
  } catch (acceptError) {
    const status = acceptError.code === 11000 ? 409 : (acceptError.statusCode || 500);
    console.error('Accept Firebase admin invitation failed:', acceptError.message);
    return res.status(status).json({
      message: acceptError.code === 11000
        ? 'Firebase identity or email is already linked to another administrator'
        : status === 500
          ? 'Unable to accept admin invitation'
          : acceptError.message,
    });
  } finally {
    if (databaseSession) await databaseSession.endSession();
  }
};

const logoutAdmin = async (req, res) => {
  try {
    const decoded = await verifyFirebaseSessionCookie(req.cookies?.adminSession);
    await revokeFirebaseSessions(decoded.uid);
  } catch (_) {
    // Logout remains idempotent for missing or expired sessions.
  }
  clearAdminCookies(res);
  return res.json({ message: 'Admin logged out' });
};

const getCurrentAdmin = async (req, res) => res.json({ admin: serializeAdmin(req.adminAccount) });

module.exports = {
  acceptFirebaseInvitation,
  bootstrapFirebaseAdmin,
  clearAdminCookies,
  getCurrentAdmin,
  loginAdminWithFirebase,
  logoutAdmin,
  serializeAdmin,
  setAdminSessionCookie,
  getSessionDuration,
  verifyAdminInvitation,
};
