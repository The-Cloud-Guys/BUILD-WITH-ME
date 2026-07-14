const express = require('express');
const { protect } = require('../middleware/auth.middleware');
const {
  setRole,
  setSkills,
  completeProfile,
  getOnboardingStatus,
} = require('../controllers/onboarding.controller');

const router = express.Router();

// All routes are protected (user must be authenticated)
router.use(protect);

// ==============================
// ONBOARDING FLOW ROUTES
// ==============================

// Get current onboarding progress
router.get('/status', getOnboardingStatus);

// Step 1: Set user role
router.post('/role', setRole);

// Step 2: Set skills (free text array)
router.post('/skills', setSkills);

// Step 3: Complete profile (first name, last name, bio, external link)
router.post('/profile', completeProfile);

module.exports = router;