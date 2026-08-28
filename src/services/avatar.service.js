const isResolvedUrl = (value) => /^https?:\/\//i.test(value || '');

const defaultSignUrl = (...args) =>
  require('./supabase.service').getSignedUrl(...args);

const createAvatarResolver = ({
  bucket = process.env.SUPABASE_BUCKET_AVATAR,
  signUrl = defaultSignUrl,
} = {}) => {
  const requestCache = new Map();

  return async (profilePhoto) => {
    if (!profilePhoto) return null;
    if (isResolvedUrl(profilePhoto)) return profilePhoto;
    if (requestCache.has(profilePhoto)) return requestCache.get(profilePhoto);

    const pending = signUrl(bucket, profilePhoto).catch((error) => {
      console.error('Avatar signed URL generation failed:', error.message);
      return null;
    });
    requestCache.set(profilePhoto, pending);
    return pending;
  };
};

const attachResolvedAvatar = async (user, resolveAvatar) => {
  if (!user) return null;
  return {
    ...user,
    profilePhoto: await resolveAvatar(user.profilePhoto),
  };
};

module.exports = {
  isResolvedUrl,
  createAvatarResolver,
  attachResolvedAvatar,
};
