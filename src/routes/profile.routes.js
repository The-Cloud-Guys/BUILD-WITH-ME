const express = require('express');
const { protect } = require('../middleware/auth.middleware');
const { upload } = require('../middleware/upload.middleware');
const {
  getMyProfile,
  deleteProfilePhoto,
  createUserProfile,
  updateUserProfile,
} = require('../controllers/profile.controller');

const router = express.Router();

router.get('/me', protect, getMyProfile);
router.delete('/me/photo', protect, deleteProfilePhoto);

// Canonical multipart profile routes: text fields and optional photo travel together.
router.post('/userProfile', protect, upload.single('photo'), createUserProfile);
router.patch('/userProfile', protect, upload.single('photo'), updateUserProfile);

module.exports = router;
