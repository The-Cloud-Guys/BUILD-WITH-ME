const express = require('express');
const {
  register,
  verifyEmail,
  resendVerificationOTP,
  resendResetPasswordOTP,
  login,
  refreshToken,
  logout,
  getMe,
  forgotPassword,
  verifyResetOtp,      
  resetPassword,
  firebaseAuth,
} = require('../controllers/auth.controller');
const { protect } = require('../middleware/auth.middleware');
const { authLimiter } = require('../middleware/rateLimiter');
const onboardingRoutes = require('./onboarding.routes');
const router = express.Router();

// Public routes (with rate limiting on sensitive ones)
router.post('/register', authLimiter, register);
router.post('/verify-email', authLimiter, verifyEmail);
router.post('/resend-verification', authLimiter, resendVerificationOTP);
router.post('/resend-reset-otp', authLimiter, resendResetPasswordOTP);
router.post('/login', authLimiter, login);
router.post('/refresh-token', refreshToken);
router.post('/logout', logout);
router.post('/forgot-password', authLimiter, forgotPassword);
router.post('/verify-reset-otp', authLimiter, verifyResetOtp);
router.post('/reset-password', authLimiter, resetPassword);
router.post('/firebase', authLimiter, firebaseAuth);

router.get('/me', protect, getMe);

module.exports = router;
