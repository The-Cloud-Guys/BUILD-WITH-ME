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
  const plainUser = typeof user.toObject === 'function' ? user.toObject() : user;
  return {
    ...plainUser,
    profilePhoto: await resolveAvatar(plainUser.profilePhoto),
  };
};

const resolveProfilePhotos = async (value, resolveAvatar = createAvatarResolver()) => {
  if (value == null) return value;
  if (Array.isArray(value)) {
    return Promise.all(value.map((item) => resolveProfilePhotos(item, resolveAvatar)));
  }
  if (typeof value !== 'object') return value;

  const plainValue = typeof value.toObject === 'function' ? value.toObject() : value;
  const prototype = Object.getPrototypeOf(plainValue);
  if (prototype !== Object.prototype && prototype !== null) return plainValue;

  const result = {};
  for (const [key, item] of Object.entries(plainValue)) {
    result[key] = key === 'profilePhoto'
      ? await resolveAvatar(item)
      : await resolveProfilePhotos(item, resolveAvatar);
  }
  return result;
};

module.exports = {
  isResolvedUrl,
  createAvatarResolver,
  attachResolvedAvatar,
  resolveProfilePhotos,
};
