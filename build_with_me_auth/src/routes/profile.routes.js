const express = require('express');
const { protect } = require('../middleware/auth.middleware');
const { upload } = require('../middleware/upload.middleware');
const {
  getMyProfile,
  updateProfile,
  verifyGitHub,
  uploadProfilePhoto,
  deleteProfilePhoto,
} = require('../controllers/profile.controller');

const router = express.Router();

// All routes require authentication
router.get('/me', protect, getMyProfile);
router.put('/me', protect, updateProfile);
router.post('/verify-github', protect, verifyGitHub);
router.post('/me/photo', protect, upload.single('photo'), uploadProfilePhoto);
router.delete('/me/photo', protect, deleteProfilePhoto);

module.exports = router;