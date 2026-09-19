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

const router = express.Router();

router.use(verifyAdminRequestOrigin);
router.post('/bootstrap/firebase', adminBootstrapLimiter, bootstrapFirebaseAdmin);
router.post('/firebase', adminAuthLimiter, loginAdminWithFirebase);
router.post('/invitations/verify', adminAuthLimiter, verifyAdminInvitation);
router.post('/firebase/accept-invitation', adminAuthLimiter, acceptFirebaseInvitation);
router.post('/logout', logoutAdmin);
router.get('/me', authenticateAdmin, getCurrentAdmin);

module.exports = router;
