const User = require('../models/user.model');
const { roleValidation, skillsValidation, profileCompletionValidation } = require('../validation/onboarding.validation');
const { getOnboardingStatus } = require('../utils/onboardingStatus');

// @desc    Save user's role (Step 1)
// @route   POST /api/onboarding/role
// @access  Private
const setRole = async (req, res) => {
  try {
    const { error } = roleValidation(req.body);
    if (error) return res.status(400).json({ message: error.details[0].message });

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.onboardingStep !== 0 && user.onboardingStep !== 1) {
      return res.status(400).json({ message: `Role already saved. Current step: ${user.onboardingStep}` });
    }

    user.role = req.body.role;
    if (user.onboardingStep === 0) user.onboardingStep = 1;
    await user.save();

    res.json({
      message: 'Role saved successfully',
      nextStep: 'skills',
      user: {
        ...user.toObject(),
        onboardingCompleted: user.onboardingCompleted,
      },
      onboardingCompleted: user.onboardingCompleted,
      onboardingStatus: getOnboardingStatus(user.onboardingStep),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Save user's skills (Step 2)
// @route   POST /api/onboarding/skills
// @access  Private
const setSkills = async (req, res) => {
  try {
    const { error } = skillsValidation(req.body);
    if (error) return res.status(400).json({ message: error.details[0].message });

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.onboardingStep !== 1) {
      return res.status(400).json({ message: `Skills can only be set after role. Current step: ${user.onboardingStep}` });
    }

    user.skills = req.body.skills;
    user.onboardingStep = 2;
    await user.save();

    res.json({
      message: 'Skills saved successfully',
      nextStep: 'profile',
      user: {
        ...user.toObject(),
        onboardingCompleted: user.onboardingCompleted,
      },
      onboardingCompleted: user.onboardingCompleted,
      onboardingStatus: getOnboardingStatus(user.onboardingStep),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Complete profile (firstName, lastName, bio, externalLink) – Step 3
// @route   POST /api/onboarding/profile
// @access  Private
const completeProfile = async (req, res) => {
  try {
    const { error } = profileCompletionValidation(req.body);
    if (error) return res.status(400).json({ message: error.details[0].message });

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.onboardingStep !== 2) {
      return res.status(400).json({ message: `Profile can only be completed after skills. Current step: ${user.onboardingStep}` });
    }

    const { firstName, lastName, bio, externalLink } = req.body;
    user.firstName = firstName.trim();
    user.lastName = lastName.trim();
    user.bio = bio ? bio.slice(0, 500) : '';
    user.externalLink = externalLink ? externalLink.trim() : '';
    user.onboardingStep = 3;
    await user.save();

    const userObj = user.toObject();
    delete userObj.password;
    delete userObj.refreshToken;
    delete userObj.emailVerificationOTP;
    delete userObj.resetPasswordToken;
    delete userObj.resetPasswordExpires;

    res.json({
      message: 'Profile completed successfully',
      onboardingComplete: true,
      user: {
        ...userObj,
        onboardingCompleted: user.onboardingCompleted,
      },
      onboardingCompleted: user.onboardingCompleted,
      onboardingStatus: getOnboardingStatus(user.onboardingStep),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get current onboarding status
// @route   GET /api/onboarding/status
// @access  Private
const getOnboardingStatusHandler = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('onboardingStep role skills firstName lastName bio externalLink profilePhoto');
    res.json({
      onboardingStep: user.onboardingStep,
      onboardingCompleted: user.onboardingCompleted,
      onboardingStatus: getOnboardingStatus(user.onboardingStep),
      user,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  setRole,
  setSkills,
  completeProfile,
  getOnboardingStatus: getOnboardingStatusHandler,
};