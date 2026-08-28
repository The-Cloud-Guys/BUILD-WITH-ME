const mongoose = require('mongoose');

const Post = require('../models/post.model');
const Comment = require('../models/comment.model');
const User = require('../models/user.model');
const Project = require('../models/project.model');

const SUPPORTED_SHARE_TYPES = Object.freeze([
  'post',
  'comment',
  'profile',
  'project',
]);

const createShareResourceResolver = ({
  PostModel = Post,
  CommentModel = Comment,
  UserModel = User,
  ProjectModel = Project,
  isValidObjectId = mongoose.isValidObjectId,
} = {}) => async ({ resourceType, resourceId, commentId }) => {
  if (!SUPPORTED_SHARE_TYPES.includes(resourceType)) {
    return { status: 404, reason: 'unsupported' };
  }

  if (!isValidObjectId(resourceId)) {
    return { status: 400, reason: 'invalid_id' };
  }

  if (resourceType === 'post') {
    const postExists = await PostModel.exists({
      _id: resourceId,
      isHidden: { $ne: true },
    });
    if (!postExists) return { status: 404, reason: 'not_found' };

    if (commentId) {
      if (!isValidObjectId(commentId)) {
        return { status: 400, reason: 'invalid_comment_id' };
      }
      const commentExists = await CommentModel.exists({
        _id: commentId,
        post: resourceId,
      });
      if (!commentExists) return { status: 404, reason: 'comment_not_found' };
    }

    return { status: 200, resourceType, resourceId, commentId: commentId || null };
  }

  if (resourceType === 'comment') {
    const comment = await CommentModel.findOne({ _id: resourceId });
    if (!comment) return { status: 404, reason: 'not_found' };

    const postId = String(comment.post);
    const postExists = await PostModel.exists({
      _id: postId,
      isHidden: { $ne: true },
    });
    if (!postExists) return { status: 404, reason: 'not_found' };

    return {
      status: 200,
      resourceType,
      resourceId,
      postId,
      canonicalPath: `/share/post/${postId}?comment=${resourceId}`,
    };
  }

  if (resourceType === 'profile') {
    const userExists = await UserModel.exists({
      _id: resourceId,
      isActive: { $ne: false },
      isSuspended: { $ne: true },
    });
    return userExists
      ? { status: 200, resourceType, resourceId }
      : { status: 404, reason: 'not_found' };
  }

  const projectExists = await ProjectModel.exists({
    _id: resourceId,
    isHidden: { $ne: true },
  });
  return projectExists
    ? { status: 200, resourceType, resourceId }
    : { status: 404, reason: 'not_found' };
};

const resolveShareResource = createShareResourceResolver();

module.exports = {
  SUPPORTED_SHARE_TYPES,
  createShareResourceResolver,
  resolveShareResource,
};
