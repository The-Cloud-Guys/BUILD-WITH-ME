const getOnboardingStatus = (step) => {
  switch (step) {
    case 0: return 'email_verified';
    case 1: return 'role_pending';
    case 2: return 'skills_pending';
    case 3: return 'completed';
    default: return 'unknown';
  }
};

module.exports = { getOnboardingStatus };

