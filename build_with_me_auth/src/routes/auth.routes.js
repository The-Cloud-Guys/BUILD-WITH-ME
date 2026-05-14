const express = require('express');
const {
  register,
  verifyEmail,
  resendVerificationOTP,
  login,
  refreshToken,
  logout,
  getMe,
  forgotPassword,
  verifyResetOtp,      
  resetPassword,
  firebaseAuth,
} = require('../controllers/auth.controller');
const { protect, logCookies } = require('../middleware/auth.middleware'); // ← correct path
const { authLimiter } = require('../middleware/rateLimiter');
const onboardingRoutes = require('./onboarding.routes');
const router = express.Router();

// Public routes (with rate limiting on sensitive ones)
router.post('/register', authLimiter, register);
router.post('/verify-email', verifyEmail);
router.post('/resend-verification', resendVerificationOTP);
router.post('/login', authLimiter, login);
router.post('/refresh-token', refreshToken);
router.post('/logout', logout);
router.post('/forgot-password', authLimiter, forgotPassword);
router.post('/verify-reset-otp', authLimiter, verifyResetOtp);
router.post('/reset-password', authLimiter, resetPassword);
router.post('/firebase', firebaseAuth);

router.get('/me', logCookies, protect, getMe);

module.exports = router;