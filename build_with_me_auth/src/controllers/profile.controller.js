const User = require('../models/user.model');
const { uploadFile, deleteFile, getSignedUrl } = require('../services/supabase.service');
const sharp = require('sharp');

// ==============================
// HELPERS
// ==============================

// Generate profile image path (always JPG)
const generateProfilePhotoPath = (userId) => {
  const timestamp = Date.now();
  return `users/${userId}/profile_${timestamp}.jpg`;
};

// ==============================
// IMAGE PROCESSING
// ==============================

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

    const userObj = user.toObject();

    // Generate signed URL for private images
    if (userObj.profilePhoto && typeof userObj.profilePhoto === 'string' && userObj.profilePhoto.startsWith('users/')) {
      try {
        const signedUrl = await getSignedUrl(process.env.SUPABASE_BUCKET_AVATAR, userObj.profilePhoto);
        userObj.profilePhoto = signedUrl;
      } catch (err) {
        console.error('Signed URL generation failed:', err.message);
      }
    }

    res.json(userObj);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc Update profile (onboarding step 3)
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

    const userObj = user.toObject();

    // Generate signed URL if needed
    if (userObj.profilePhoto && typeof userObj.profilePhoto === 'string' && userObj.profilePhoto.startsWith('users/')) {
      try {
        const signedUrl = await getSignedUrl(process.env.SUPABASE_BUCKET_AVATAR, userObj.profilePhoto);
        userObj.profilePhoto = signedUrl;
      } catch (err) {
        console.error('Signed URL generation failed:', err.message);
      }
    }

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

    // Delete old private image if exists
    if (user.profilePhoto && typeof user.profilePhoto === 'string' && user.profilePhoto.startsWith('users/')) {
      try {
        await deleteFile(process.env.SUPABASE_BUCKET_AVATAR, user.profilePhoto);
      } catch (err) {
        console.warn('Could not delete old photo:', err.message);
      }
    }

    // Process image (resize & convert to JPEG)
    let processedBuffer;
    try {
      processedBuffer = await processImage(req.file.buffer);
    } catch (err) {
      if (err.message === 'INVALID_IMAGE') {
        return res.status(400).json({ message: 'Invalid or corrupted image file' });
      }
      throw err;
    }

    // Upload to Supabase
    const filePath = generateProfilePhotoPath(user._id);
    await uploadFile(process.env.SUPABASE_BUCKET_AVATAR, filePath, processedBuffer, 'image/jpeg');

    // Store only the path
    user.profilePhoto = filePath;
    await user.save();

    // Generate temporary signed URL for response
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

    // Delete only private Supabase images
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
};