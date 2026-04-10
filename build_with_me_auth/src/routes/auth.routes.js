const express = require('express');
const {
  register,
  login,
  getMe,
  forgotPassword,
  resetPassword,
  firebaseAuth,         
} = require('../controllers/auth.controller');
const { protect } = require('../middleware/auth.middleware');

const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.get('/me', protect, getMe);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.post('/firebase', firebaseAuth); 

module.exports = router;