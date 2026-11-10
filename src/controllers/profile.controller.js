const User = require('../models/user.model');
const { uploadFile, deleteFile, getSignedUrl } = require('../services/supabase.service');
const sharp = require('sharp');
const { getOnboardingStatus } = require('../utils/onboardingStatus');
const { resolveProfilePhotos } = require('../services/avatar.service');
const {
  combinedProfileValidation,
  normalizeSkillsInput,
} = require('../validation/onboarding.validation');

// ==============================
// HELPERS
// ==============================

const generateProfilePhotoPath = (userId) => {
  const timestamp = Date.now();
  return `users/${userId}/profile_${timestamp}.jpg`;
};

const processImage = async (buffer) => {
  try {
    const image = sharp(buffer);
    const metadata = await image.metadata();
    const maxSize = 500;
    let pipeline = image;
    if (metadata.width && metadata.height && (metadata.width > maxSize || metadata.height > maxSize)) {
      pipeline = pipeline.resize({
        width: maxSize,
        height: maxSize,
        fit: 'inside',
      });
    }
    return await pipeline.jpeg({ quality: 80 }).toBuffer();
  } catch (error) {
    console.error('Image processing error:', error.message);
    throw new Error('INVALID_IMAGE');
  }
};

// ==============================
// CONTROLLERS
// ==============================

// @desc Get current user's profile
// @route GET /api/profile/me
// @access Private
const getMyProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select(
      '-password -refreshToken -emailVerificationOTP -resetPasswordToken -resetPasswordExpires'
    );
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    const userObj = await resolveProfilePhotos(user);
    res.json({
      ...userObj,
      onboardingCompleted: user.onboardingCompleted,
      onboardingStatus: getOnboardingStatus(user.onboardingStep),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ✅ SINGLE createUserProfile function (removed duplicate)
// @desc    Complete onboarding in one multipart request with optional photo
// @route   POST /api/profile/userProfile
// @access  Private
const createUserProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const normalizedInput = {
      ...req.body,
      skills: normalizeSkillsInput(req.body.skills),
    };
    const { error, value } = combinedProfileValidation(normalizedInput);
    if (error) {
      return res.status(400).json({
        message: error.details[0].message,
        errors: error.details.map((detail) => detail.message),
      });
    }

    const { firstName, lastName, role, bio, skills, externalLink } = value;
    const updateData = {};
    let oldPhotoToDelete = null;

    updateData.firstName = firstName;
    updateData.lastName = lastName;
    updateData.role = role;
    updateData.skills = skills;
    updateData.bio = bio || '';
    updateData.externalLink = externalLink || '';
    updateData.onboardingStep = 3;

    // Handle profile photo if provided
    if (req.file) {
      const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
      if (!allowedMimeTypes.includes(req.file.mimetype)) {
        return res.status(400).json({ message: 'Only JPG, PNG, and WEBP images are allowed' });
      }

      const processedBuffer = await processImage(req.file.buffer);
      const filePath = generateProfilePhotoPath(user._id);
      await uploadFile(process.env.SUPABASE_BUCKET_AVATAR, filePath, processedBuffer, 'image/jpeg');
      updateData.profilePhoto = filePath;

      if (user.profilePhoto && user.profilePhoto.startsWith('users/')) {
        oldPhotoToDelete = user.profilePhoto;
      }
    }

    // Update user
    const updatedUser = await User.findByIdAndUpdate(req.user.id, updateData, {
      new: true,
      runValidators: true,
    })
      .select('-password -refreshToken -emailVerificationOTP -resetPasswordToken -resetPasswordExpires');

    if (oldPhotoToDelete) {
      await deleteFile(process.env.SUPABASE_BUCKET_AVATAR, oldPhotoToDelete);
    }

    // Generate signed URL for photo if needed
    const userObj = await resolveProfilePhotos(updatedUser);

    res.json({
      message: 'Profile created successfully',
      onboardingCompleted: userObj.onboardingStep === 3,
      onboardingStatus: getOnboardingStatus(userObj.onboardingStep),
      user: userObj
    });
  } catch (error) {
    console.error('Error in createUserProfile:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Update profile (including photo) – PATCH /api/userProfile
// @route   PATCH /api/userProfile
// @access  Private
const updateUserProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const normalizedInput = {
      ...req.body,
      skills: normalizeSkillsInput(req.body.skills),
    };
    const { error, value } = combinedProfileValidation(normalizedInput, { partial: true });
    if (error) {
      return res.status(400).json({
        message: error.details[0].message,
        errors: error.details.map((detail) => detail.message),
      });
    }

    const { firstName, lastName, role, bio, skills, externalLink } = value;
    const updateData = {};
    let oldPhotoToDelete = null;

    if (firstName !== undefined) updateData.firstName = firstName.trim();
    if (lastName !== undefined) updateData.lastName = lastName.trim();
    if (role !== undefined) updateData.role = role;
    if (bio !== undefined) updateData.bio = bio.slice(0, 500);
    if (externalLink !== undefined) updateData.externalLink = externalLink.trim();

    if (skills !== undefined) {
      updateData.skills = skills;
    }

    if (req.file) {
      const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
      if (!allowedMimeTypes.includes(req.file.mimetype)) {
        return res.status(400).json({ message: 'Only JPG, PNG, and WEBP images are allowed' });
      }

      const processedBuffer = await processImage(req.file.buffer);
      const filePath = generateProfilePhotoPath(user._id);
      await uploadFile(process.env.SUPABASE_BUCKET_AVATAR, filePath, processedBuffer, 'image/jpeg');
      updateData.profilePhoto = filePath;

      if (user.profilePhoto && user.profilePhoto.startsWith('users/')) {
        oldPhotoToDelete = user.profilePhoto;
      }
    }

    const updatedUser = await User.findByIdAndUpdate(req.user.id, updateData, {
      new: true,
      runValidators: true,
    })
      .select('-password -refreshToken -emailVerificationOTP -resetPasswordToken -resetPasswordExpires');

    if (oldPhotoToDelete) {
      await deleteFile(process.env.SUPABASE_BUCKET_AVATAR, oldPhotoToDelete);
    }

    const userObj = await resolveProfilePhotos(updatedUser);

    res.json({
      message: 'Profile updated successfully',
      onboardingCompleted: userObj.onboardingStep === 3,
      onboardingStatus: getOnboardingStatus(userObj.onboardingStep),
      user: userObj,
    });
  } catch (error) {
    console.error('Error in updateUserProfile:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc Update profile (legacy, kept for compatibility)
// @route PUT /api/profile/me
// @access Private
const updateProfile = async (req, res) => {
  try {
    const { firstName, lastName, bio, skills, externalLink } = req.body;
    const updateData = {};

    if (firstName !== undefined) updateData.firstName = firstName.trim();
    if (lastName !== undefined) updateData.lastName = lastName.trim();
    if (bio !== undefined) updateData.bio = bio.slice(0, 500);
    if (skills !== undefined) {
      let normalizedSkills = [];
      if (Array.isArray(skills)) {
        normalizedSkills = skills.map((skill) => String(skill).trim()).filter(Boolean);
      } else if (typeof skills === 'string') {
        normalizedSkills = skills.split(',').map((skill) => skill.trim()).filter(Boolean);
      }
      updateData.skills = normalizedSkills;
    }
    if (externalLink !== undefined) updateData.externalLink = externalLink.trim();

    const user = await User.findByIdAndUpdate(req.user.id, updateData, {
      new: true,
      runValidators: true,
    }).select('-password -refreshToken -emailVerificationOTP -resetPasswordToken -resetPasswordExpires');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userObj = await resolveProfilePhotos(user);

    res.json({ message: 'Profile updated successfully', user: userObj });
  } catch (error) {
    console.error(error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc Upload profile photo
// @route POST /api/profile/me/photo
// @access Private
const uploadProfilePhoto = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedMimeTypes.includes(req.file.mimetype)) {
      return res.status(400).json({ message: 'Only JPG, PNG, and WEBP images are allowed' });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    let processedBuffer;
    try {
      processedBuffer = await processImage(req.file.buffer);
    } catch (err) {
      if (err.message === 'INVALID_IMAGE') {
        return res.status(400).json({ message: 'Invalid or corrupted image file' });
      }
      throw err;
    }

    const filePath = generateProfilePhotoPath(user._id);
    await uploadFile(process.env.SUPABASE_BUCKET_AVATAR, filePath, processedBuffer, 'image/jpeg');

    const oldPhoto = user.profilePhoto;

    user.profilePhoto = filePath;
    await user.save();

    if (oldPhoto && typeof oldPhoto === 'string' && oldPhoto.startsWith('users/')) {
      await deleteFile(process.env.SUPABASE_BUCKET_AVATAR, oldPhoto);
    }

    const signedUrl = await getSignedUrl(process.env.SUPABASE_BUCKET_AVATAR, filePath);
    res.json({ message: 'Profile photo uploaded successfully', profilePhoto: signedUrl });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc Delete profile photo
// @route DELETE /api/profile/me/photo
// @access Private
const deleteProfilePhoto = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user || !user.profilePhoto) {
      return res.status(404).json({ message: 'No profile photo found' });
    }

    if (typeof user.profilePhoto === 'string' && user.profilePhoto.startsWith('users/')) {
      await deleteFile(process.env.SUPABASE_BUCKET_AVATAR, user.profilePhoto);
    }

    user.profilePhoto = null;
    await user.save();

    res.json({ message: 'Profile photo deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  getMyProfile,
  updateProfile,
  uploadProfilePhoto,
  deleteProfilePhoto,
  createUserProfile,
  updateUserProfile,
};
