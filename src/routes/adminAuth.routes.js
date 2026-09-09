const express = require('express');

const {
  acceptAdminInvitation,
  bootstrapAdmin,
  getCurrentAdmin,
  loginAdmin,
  logoutAdmin,
  refreshAdminSession,
} = require('../controllers/adminAuth.controller');
const {
  authenticateAdmin,
  verifyAdminRequestOrigin,
} = require('../middleware/adminAuth.middleware');
const {
  adminAuthLimiter,
  adminBootstrapLimiter,
} = require('../middleware/rateLimiter');

const router = express.Router();

router.use(verifyAdminRequestOrigin);
router.post('/bootstrap', adminBootstrapLimiter, bootstrapAdmin);
router.post('/accept-invitation', adminAuthLimiter, acceptAdminInvitation);
router.post('/login', adminAuthLimiter, loginAdmin);
router.post('/refresh-token', refreshAdminSession);
router.post('/logout', logoutAdmin);
router.get('/me', authenticateAdmin, getCurrentAdmin);

module.exports = router;
