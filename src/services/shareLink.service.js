const SHARE_TYPES = Object.freeze({
  POST: 'post',
  COMMENT: 'comment',
  PROFILE: 'profile',
  PROJECT: 'project',
});

const normalizeFrontendUrl = (value = process.env.FRONTEND_URL) => {
  if (!value) return null;

  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url.toString().replace(/\/$/, '');
  } catch (_) {
    return null;
  }
};

const excerpt = (value, maxLength = 160) => {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
};

const buildShareMetadata = ({ type, id, postId, title, text }) => {
  const resourceId = String(id);
  let path;

  if (type === SHARE_TYPES.POST) {
    path = `/share/post/${resourceId}`;
  } else if (type === SHARE_TYPES.COMMENT) {
    if (!postId) throw new Error('postId is required for comment share links');
    path = `/share/post/${String(postId)}?comment=${resourceId}`;
  } else if (type === SHARE_TYPES.PROFILE) {
    path = `/share/profile/${resourceId}`;
  } else if (type === SHARE_TYPES.PROJECT) {
    path = `/share/project/${resourceId}`;
  } else {
    throw new Error(`Unsupported share type: ${type}`);
  }

  const frontendUrl = normalizeFrontendUrl();

  return {
    type,
    resourceId,
    path,
    url: frontendUrl ? `${frontendUrl}${path}` : null,
    title: excerpt(title, 100),
    text: excerpt(text),
    configured: Boolean(frontendUrl),
  };
};

const buildPostShare = (post) => buildShareMetadata({
  type: SHARE_TYPES.POST,
  id: post._id,
  title: 'View this post on Connexd',
  text: post.content,
});

const buildCommentShare = (comment) => buildShareMetadata({
  type: SHARE_TYPES.COMMENT,
  id: comment._id,
  postId: comment.post,
  title: 'View this comment on Connexd',
  text: comment.content,
});

const buildProfileShare = (user) => {
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return buildShareMetadata({
    type: SHARE_TYPES.PROFILE,
    id: user._id,
    title: name ? `${name} on Connexd` : 'View this profile on Connexd',
    text: user.bio || (name ? `View ${name}'s profile on Connexd.` : 'View this profile on Connexd.'),
  });
};

const buildProjectShare = (project) => buildShareMetadata({
  type: SHARE_TYPES.PROJECT,
  id: project._id,
  title: project.title
    ? `${project.title} on Connexd`
    : 'View this project on Connexd',
  text: project.description || 'View this project on Connexd.',
});

module.exports = {
  SHARE_TYPES,
  normalizeFrontendUrl,
  buildShareMetadata,
  buildPostShare,
  buildCommentShare,
  buildProfileShare,
  buildProjectShare,
};
