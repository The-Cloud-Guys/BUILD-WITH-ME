const express = require('express');

const {
  acceptFirebaseInvitation,
  bootstrapFirebaseAdmin,
  getCurrentAdmin,
  loginAdminWithFirebase,
  logoutAdmin,
  verifyAdminInvitation,
} = require('../controllers/adminAuth.controller');
const {
  authenticateAdmin,
  verifyAdminRequestOrigin,
} = require('../middleware/adminAuth.middleware');
const { adminAuthLimiter, adminBootstrapLimiter } = require('../middleware/rateLimiter');
const {
  completeAdminMfaChallenge,
  confirmAdminMfa,
  disableAdminMfa,
  setupAdminMfa,
} = require('../controllers/adminMfa.controller');

const router = express.Router();

router.use(verifyAdminRequestOrigin);
router.post('/bootstrap/firebase', adminBootstrapLimiter, bootstrapFirebaseAdmin);
router.post('/firebase', adminAuthLimiter, loginAdminWithFirebase);
router.post('/invitations/verify', adminAuthLimiter, verifyAdminInvitation);
router.post('/firebase/accept-invitation', adminAuthLimiter, acceptFirebaseInvitation);
router.post('/mfa/challenge', adminAuthLimiter, completeAdminMfaChallenge);
router.post('/logout', logoutAdmin);
router.get('/me', authenticateAdmin, getCurrentAdmin);
router.post('/mfa/setup', authenticateAdmin, setupAdminMfa);
router.post('/mfa/confirm', adminAuthLimiter, authenticateAdmin, confirmAdminMfa);
router.delete('/mfa', adminAuthLimiter, authenticateAdmin, disableAdminMfa);

module.exports = router;
