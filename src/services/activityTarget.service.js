const User = require('../models/user.model');

const createActivityUserTargetResolver = ({ UserModel = User } = {}) => async (
  activities,
  resolveAvatar = async (value) => value || null
) => {
  const userTargetIds = [
    ...new Set(
      activities
        .filter((activity) => activity.targetType === 'user' && activity.targetId)
        .map((activity) => String(activity.targetId))
    ),
  ];

  if (userTargetIds.length === 0) {
    return activities.map((activity) => ({ ...activity, target: null }));
  }

  const users = await UserModel.find({ _id: { $in: userTargetIds } })
    .select('firstName lastName email role profilePhoto')
    .lean();

  const targetById = new Map(
    await Promise.all(users.map(async (user) => [
      String(user._id),
      {
        ...user,
        fullName: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
        profilePhoto: await resolveAvatar(user.profilePhoto),
      },
    ]))
  );

  return activities.map((activity) => ({
    ...activity,
    target: activity.targetType === 'user'
      ? targetById.get(String(activity.targetId)) || null
      : null,
  }));
};

const resolveActivityUserTargets = createActivityUserTargetResolver();

module.exports = {
  createActivityUserTargetResolver,
  resolveActivityUserTargets,
};
