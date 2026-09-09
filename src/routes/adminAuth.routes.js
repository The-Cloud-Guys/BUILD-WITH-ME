const express = require('express');

const {
  acceptAdminInvitation,
  bootstrapAdmin,
  completeAdminSso,
  getCurrentAdmin,
  loginAdmin,
  logoutAdmin,
  refreshAdminSession,
  startAdminSso,
} = require('../controllers/adminAuth.controller');
const {
  authenticateAdmin,
  verifyAdminRequestOrigin,
} = require('../middleware/adminAuth.middleware');
const {
  adminAuthLimiter,
  adminBootstrapLimiter,
} = require('../middleware/rateLimiter');
const {
  completeAdminMfaChallenge,
  confirmAdminMfa,
  disableAdminMfa,
  setupAdminMfa,
} = require('../controllers/adminMfa.controller');

const router = express.Router();

router.use(verifyAdminRequestOrigin);
router.post('/bootstrap', adminBootstrapLimiter, bootstrapAdmin);
router.post('/accept-invitation', adminAuthLimiter, acceptAdminInvitation);
router.post('/login', adminAuthLimiter, loginAdmin);
router.get('/sso/:provider', adminAuthLimiter, startAdminSso);
router.get('/sso/:provider/callback', adminAuthLimiter, completeAdminSso);
router.post('/mfa/challenge', adminAuthLimiter, completeAdminMfaChallenge);
router.post('/refresh-token', refreshAdminSession);
router.post('/logout', logoutAdmin);
router.get('/me', authenticateAdmin, getCurrentAdmin);
router.post('/mfa/setup', authenticateAdmin, setupAdminMfa);
router.post('/mfa/confirm', adminAuthLimiter, authenticateAdmin, confirmAdminMfa);
router.delete('/mfa', adminAuthLimiter, authenticateAdmin, disableAdminMfa);

module.exports = router;
