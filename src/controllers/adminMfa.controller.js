const AdminAccount = require('../models/adminAccount.model');
const AdminSession = require('../models/adminSession.model');
const AdminMfaChallenge = require('../models/adminMfaChallenge.model');
const { issueAdminTokenPair } = require('../services/adminAuth.service');
const {
  buildOtpAuthUrl,
  clearMfaChallengeCookie,
  decryptSecret,
  encryptSecret,
  generateTotpSecret,
  hashChallengeId,
  verifyMfaChallenge,
  verifyTotp,
} = require('../services/adminMfa.service');
const { adminMfaCodeValidation } = require('../validation/adminMfa.validation');
const {
  clearAdminCookies,
  serializeAdmin,
  setAdminCookies,
} = require('./adminAuth.controller');

const setupAdminMfa = async (req, res) => {
  try {
    if (req.adminAccount.mfaEnabled) {
      return res.status(409).json({ message: 'Admin MFA is already enabled' });
    }
    const secret = generateTotpSecret();
    await AdminAccount.updateOne(
      { _id: req.adminAccount._id },
      { $set: { mfaPendingSecretEncrypted: encryptSecret(secret) } }
    );
    res.set('Cache-Control', 'no-store');
    return res.json({
      message: 'Scan the authenticator URI, then confirm a current code',
      secret,
      otpauthUrl: buildOtpAuthUrl(req.adminAccount, secret),
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      message: error.statusCode ? error.message : 'Unable to set up admin MFA',
    });
  }
};

const confirmAdminMfa = async (req, res) => {
  const { error, value } = adminMfaCodeValidation(req.body);
  if (error) return res.status(400).json({ message: error.details[0].message });
  try {
    const admin = await AdminAccount.findById(req.adminAccount._id)
      .select('+mfaPendingSecretEncrypted');
    if (!admin?.mfaPendingSecretEncrypted) {
      return res.status(409).json({ message: 'Admin MFA setup has not been started' });
    }
    const secret = decryptSecret(admin.mfaPendingSecretEncrypted);
    if (!verifyTotp(secret, value.code)) {
      return res.status(401).json({ message: 'Invalid admin MFA code' });
    }
    admin.mfaSecretEncrypted = admin.mfaPendingSecretEncrypted;
    admin.mfaPendingSecretEncrypted = null;
    admin.mfaEnabled = true;
    admin.tokenVersion = (admin.tokenVersion || 0) + 1;
    await admin.save();
    await AdminSession.updateMany(
      { admin: admin._id, revokedAt: null },
      { $set: { revokedAt: new Date() } }
    );
    clearAdminCookies(res);
    return res.json({
      message: 'Admin MFA enabled successfully; sign in again to continue',
      mfaEnabled: true,
    });
  } catch (mfaError) {
    return res.status(mfaError.statusCode || 500).json({
      message: mfaError.statusCode ? mfaError.message : 'Unable to confirm admin MFA',
    });
  }
};

const completeAdminMfaChallenge = async (req, res) => {
  const { error, value } = adminMfaCodeValidation(req.body);
  if (error) return res.status(400).json({ message: error.details[0].message });
  try {
    const challenge = verifyMfaChallenge(req.cookies?.adminMfaChallenge || '');
    if (challenge.type !== 'admin_mfa_challenge' || !challenge.sub || !challenge.jti) {
      clearMfaChallengeCookie(res);
      return res.status(401).json({ message: 'Invalid or expired admin MFA challenge' });
    }
    const storedChallenge = await AdminMfaChallenge.findOne({
      admin: challenge.sub,
      jtiHash: hashChallengeId(challenge.jti),
      usedAt: null,
      expiresAt: { $gt: new Date() },
    });
    if (!storedChallenge || storedChallenge.authMethod !== challenge.authMethod) {
      clearMfaChallengeCookie(res);
      return res.status(401).json({ message: 'Invalid or expired admin MFA challenge' });
    }
    const admin = await AdminAccount.findById(challenge.sub).select('+mfaSecretEncrypted');
    if (
      !admin || admin.isActive === false || !admin.mfaEnabled
      || (admin.tokenVersion || 0) !== challenge.tokenVersion
      || !admin.mfaSecretEncrypted
    ) {
      clearMfaChallengeCookie(res);
      return res.status(401).json({ message: 'Admin MFA challenge is unavailable' });
    }
    if (!verifyTotp(decryptSecret(admin.mfaSecretEncrypted), value.code)) {
      return res.status(401).json({ message: 'Invalid admin MFA code' });
    }
    const consumed = await AdminMfaChallenge.findOneAndUpdate(
      { _id: storedChallenge._id, usedAt: null },
      { $set: { usedAt: new Date() } },
      { new: true }
    );
    if (!consumed) {
      return res.status(401).json({ message: 'Invalid or expired admin MFA challenge' });
    }
    const tokens = await issueAdminTokenPair(admin, req, {
      authMethod: challenge.authMethod,
    });
    admin.lastLoginAt = new Date();
    admin.lastActivityAt = new Date();
    await admin.save();
    clearMfaChallengeCookie(res);
    setAdminCookies(res, tokens.accessToken, tokens.refreshToken);
    return res.json({ message: 'Admin MFA verification successful', admin: serializeAdmin(admin) });
  } catch (_) {
    clearMfaChallengeCookie(res);
    return res.status(401).json({ message: 'Invalid or expired admin MFA challenge' });
  }
};

const disableAdminMfa = async (req, res) => {
  const { error, value } = adminMfaCodeValidation(req.body);
  if (error) return res.status(400).json({ message: error.details[0].message });
  try {
    const admin = await AdminAccount.findById(req.adminAccount._id).select('+mfaSecretEncrypted');
    if (!admin?.mfaEnabled || !admin.mfaSecretEncrypted) {
      return res.status(409).json({ message: 'Admin MFA is not enabled' });
    }
    if (!verifyTotp(decryptSecret(admin.mfaSecretEncrypted), value.code)) {
      return res.status(401).json({ message: 'Invalid admin MFA code' });
    }
    admin.mfaEnabled = false;
    admin.mfaSecretEncrypted = null;
    admin.mfaPendingSecretEncrypted = null;
    admin.tokenVersion = (admin.tokenVersion || 0) + 1;
    await admin.save();
    await AdminSession.updateMany(
      { admin: admin._id, revokedAt: null },
      { $set: { revokedAt: new Date() } }
    );
    clearAdminCookies(res);
    return res.json({
      message: 'Admin MFA disabled; sign in again to continue',
      mfaEnabled: false,
    });
  } catch (mfaError) {
    return res.status(mfaError.statusCode || 500).json({
      message: mfaError.statusCode ? mfaError.message : 'Unable to disable admin MFA',
    });
  }
};

module.exports = {
  completeAdminMfaChallenge,
  confirmAdminMfa,
  disableAdminMfa,
  setupAdminMfa,
};
