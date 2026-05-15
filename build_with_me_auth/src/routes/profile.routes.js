const express = require('express');
const { protect } = require('../middleware/auth.middleware');
const { upload } = require('../middleware/upload.middleware');
const {
  getMyProfile,
  updateProfile,
  uploadProfilePhoto,
  deleteProfilePhoto,
  createUserProfile,   
  updateUserProfile,   
} = require('../controllers/profile.controller');

const router = express.Router();

router.get('/me', protect, getMyProfile);
router.patch('/me', protect, updateProfile);
router.post('/me/photo', protect, upload.single('photo'), uploadProfilePhoto);
router.delete('/me/photo', protect, deleteProfilePhoto);

router.post('/userProfile', protect, upload.single('photo'), createUserProfile);
router.patch('/userProfile', protect, upload.single('photo'), updateUserProfile);


module.exports = router;