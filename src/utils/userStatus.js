const USER_STATUS_FILTERS = Object.freeze({
  active: {
    isActive: { $ne: false },
    isSuspended: { $ne: true },
    emailVerified: true,
    onboardingStep: { $gte: 3 },
  },
  pending: {
    isActive: { $ne: false },
    isSuspended: { $ne: true },
    $or: [
      { emailVerified: { $ne: true } },
      { onboardingStep: { $lt: 3 } },
    ],
  },
  suspended: {
    isActive: { $ne: false },
    isSuspended: true,
  },
  terminated: {
    isActive: false,
  },
});

const getUserStatus = (user) => {
  if (user.isActive === false) return 'terminated';
  if (user.isSuspended === true) return 'suspended';
  if (user.emailVerified !== true || Number(user.onboardingStep) < 3) return 'pending';
  return 'active';
};

const getPendingReason = (user) => {
  if (getUserStatus(user) !== 'pending') return null;
  if (user.emailVerified !== true) return 'email_verification_required';
  return 'onboarding_incomplete';
};

module.exports = { USER_STATUS_FILTERS, getPendingReason, getUserStatus };
