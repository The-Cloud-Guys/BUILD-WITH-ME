const Application = require('../models/application.model');
const Post = require('../models/post.model');
const Comment = require('../models/comment.model');
const Like = require('../models/like.model');
const Save = require('../models/save.model');
const Follow = require('../models/follow.model');
const Mute = require('../models/mute.model');
const { Report } = require('../models/admin.model');
const User = require('../models/user.model');
const Project = require('../models/project.model');
const PollVote = require('../models/pollVote.model');
const { uploadFile, deleteFile, getSignedUrl } = require('../services/supabase.service');
const { createAvatarResolver, resolveProfilePhotos } = require('../services/avatar.service');
const {
  buildPostShare,
  buildCommentShare,
  buildProfileShare,
} = require('../services/shareLink.service');
const multer = require('multer');
const path = require('path');
const mongoose = require('mongoose');

// Configure multer for media upload (memory storage)
const mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB per file
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp|bmp|tiff|svg|mp4|mov|avi|mkv|webm|flv|wmv|m4v|3gp|mpg|mpeg/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (mimetype && extname) return cb(null, true);
    cb(new Error('Only images and videos are allowed'));
  },
});

const uploadMedia = async (files, userId, postId) => {
  const paths = [];
  const bucket = process.env.SUPABASE_BUCKET_COMMUNITY;
  
  for (const file of files) {
    try {
      const ext = path.extname(file.originalname).toLowerCase();
      const timestamp = Date.now();
      const randomString = Math.random().toString(36).substring(7);
      const filePath = `posts/${userId}/${postId}/${timestamp}_${randomString}${ext}`;
      
      await uploadFile(bucket, filePath, file.buffer, file.mimetype);
      paths.push(filePath);
    } catch (error) {
      console.error(`Failed to upload ${file.originalname}:`, error.message);
    }
  }
  
  return paths;
};

const resolveCommunityMedia = async (mediaPaths = []) => {
  const resolved = await Promise.all(mediaPaths.map(async (mediaPath) => {
    if (!mediaPath) return null;
    if (/^https?:\/\//i.test(mediaPath)) return mediaPath;
    try {
      return await getSignedUrl(process.env.SUPABASE_BUCKET_COMMUNITY, mediaPath, 3600);
    } catch (error) {
      console.error('Community media signed URL generation failed:', error.message);
      return null;
    }
  }));
  return resolved.filter(Boolean);
};

const parseMultipartArray = (value) => {
  if (!value || Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : value;
  } catch (_) {
    return String(value).split(',').map((item) => item.trim()).filter(Boolean);
  }
};

const attachPollViewerState = async (post, userId) => {
  if (post.postType !== 'poll' || !post.poll) return post;
  const vote = await PollVote.findOne({ post: post._id, user: userId }).select('optionId').lean();
  post.poll.hasVoted = Boolean(vote);
  post.poll.selectedOptionId = vote?.optionId || null;
  post.poll.isExpired = new Date(post.poll.expiresAt) <= new Date();
  return post;
};

// ==============================
// POSTS
// ==============================

// @desc    Create a new post (with optional media)
// @route   POST /api/community/posts
// @access  Private
const createPost = async (req, res) => {
  try {
    if (req.body.tags && typeof req.body.tags === 'string') {
      req.body.tags = req.body.tags.split(',').map(tag => tag.trim()).filter(Boolean);
    }

    req.body.pollOptions = parseMultipartArray(req.body.pollOptions);
    if (!req.body.postType && req.files?.length) req.body.postType = 'photo';
    const { error, value } = require('../validation/community.validation').createPostValidation({
      ...req.body,
      mediaCount: req.files?.length || 0,
    });
    if (error) return res.status(400).json({ message: error.details[0].message });

    const {
      content, tags, postType, codeLanguage, codeSnippet, linkUrl, linkTitle,
      linkDescription, linkPreviewImage, pollQuestion, pollOptions, pollDurationHours,
    } = value;

    const post = await Post.create({
      author: req.user.id,
      content,
      tags: tags || [],
      postType,
      code: postType === 'code' ? { language: codeLanguage, snippet: codeSnippet } : null,
      link: postType === 'link' ? {
        url: linkUrl,
        title: linkTitle || '',
        description: linkDescription || '',
        previewImage: linkPreviewImage || '',
      } : null,
      poll: postType === 'poll' ? {
        question: pollQuestion,
        options: pollOptions.map((text) => ({ text })),
        expiresAt: new Date(Date.now() + pollDurationHours * 60 * 60 * 1000),
      } : null,
    });

    let mediaUrls = [];
    if (req.files && req.files.length > 0) {
      mediaUrls = await uploadMedia(req.files, req.user.id, post._id);
      post.media = mediaUrls;
      await post.save();
    }

    const populatedPost = await Post.findById(post._id)
      .populate('author', 'firstName lastName profilePhoto email role')
      .lean();

    populatedPost.author = await resolveProfilePhotos(populatedPost.author);
    populatedPost.media = await resolveCommunityMedia(populatedPost.media);
    populatedPost.share = buildPostShare(populatedPost);
    await attachPollViewerState(populatedPost, req.user.id);

    res.status(201).json({ 
      message: 'Post created successfully', 
      post: populatedPost 
    });
  } catch (error) {
    console.error('Error in createPost:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get feed (recent posts, paginated)
// @route   GET /api/community/feed
// @access  Private (or public? We'll keep private to show personalized feed later)
// In community.controller.js - FIXED getFeed
const getFeed = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const posts = await Post.find({ isHidden: { $ne: true } })
      .populate('author', 'firstName lastName profilePhoto email role')
      .sort('-createdAt')
      .skip(skip)
      .limit(limit)
      .lean();

    const userId = req.user.id;

    const validPosts = posts.filter(post => post.author !== null);

    const resolveAvatar = createAvatarResolver();
    for (let post of validPosts) {
      const liked = await Like.findOne({ user: userId, targetType: 'Post', targetId: post._id });
      post.isLiked = !!liked;

      const saved = await Save.findOne({ user: userId, post: post._id });
      post.isSaved = !!saved;

      post.author = await resolveProfilePhotos(post.author, resolveAvatar);

      post.media = await resolveCommunityMedia(post.media);
      post.share = buildPostShare(post);
      await attachPollViewerState(post, userId);
    }

    const total = await Post.countDocuments({ isHidden: { $ne: true } });

    res.json({
      posts: validPosts,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total,
    });
  } catch (error) {
    console.error('Error in getFeed:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Get single post by ID
// @route   GET /api/community/posts/:id
// @access  Private
const getPostById = async (req, res) => {
  try {
    const post = await Post.findOne({
      _id: req.params.id,
      isHidden: { $ne: true },
    })
      .populate('author', 'firstName lastName profilePhoto email role')
      .lean();
    if (!post) return res.status(404).json({ message: 'Post not found' });

    const userId = req.user.id;
    post.isLiked = !!(await Like.findOne({ user: userId, targetType: 'Post', targetId: post._id }));
    post.isSaved = !!(await Save.findOne({ user: userId, post: post._id }));

    post.author = await resolveProfilePhotos(post.author);

    post.media = await resolveCommunityMedia(post.media);
    post.share = buildPostShare(post);
    await attachPollViewerState(post, userId);

    res.json(post);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Update post (author only)
// @route   PUT /api/community/posts/:id
// @access  Private
const updatePost = async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ message: 'Post not found' });
    if (post.author.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const { content, tags } = req.body;
    if (content) post.content = content;
    if (tags) post.tags = tags;
    await post.save();
    const updatedPost = await Post.findById(post._id)
      .populate('author', 'firstName lastName profilePhoto email role')
      .lean();
    updatedPost.author = await resolveProfilePhotos(updatedPost.author);
    updatedPost.media = await resolveCommunityMedia(updatedPost.media);
    updatedPost.share = buildPostShare(updatedPost);

    res.json({ message: 'Post updated successfully', post: updatedPost });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Delete post (author only)
// @route   DELETE /api/community/posts/:id
// @access  Private
const deletePost = async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ message: 'Post not found' });
    if (post.author.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    // Delete all associated comments, likes, saves, mutes, reports
    const commentIds = await Comment.find({ post: post._id }).distinct('_id');
    await Comment.deleteMany({ post: post._id });
    await Like.deleteMany({
      $or: [
        { targetType: 'Post', targetId: post._id },
        { targetType: 'Comment', targetId: { $in: commentIds } },
      ],
    });
    await Save.deleteMany({ post: post._id });
    await Mute.deleteMany({ post: post._id });
    await Report.deleteMany({ targetType: 'post', targetId: post._id });
    await PollVote.deleteMany({ post: post._id });

    await post.deleteOne();
    res.json({ message: 'Post deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ==============================
// LIKES (Post & Comment)
// ==============================

// @desc    Like/Unlike a post or comment
// @route   POST /api/community/like
// @access  Private
const toggleLike = async (req, res) => {
  try {
    const { targetType, targetId } = req.body;
    if (!['Post', 'Comment'].includes(targetType)) {
      return res.status(400).json({ message: 'Invalid target type' });
    }

    const existing = await Like.findOne({ user: req.user.id, targetType, targetId });
    if (existing) {
      // Unlike
      await existing.deleteOne();
      // Decrement count on target
      if (targetType === 'Post') {
        await Post.findByIdAndUpdate(targetId, [
          { $set: { likeCount: { $max: [0, { $subtract: ['$likeCount', 1] }] } } },
        ]);
      } else {
        await Comment.findByIdAndUpdate(targetId, [
          { $set: { likeCount: { $max: [0, { $subtract: ['$likeCount', 1] }] } } },
        ]);
      }
      return res.json({ message: 'Unliked', liked: false });
    } else {
      // Like
      await Like.create({ user: req.user.id, targetType, targetId });
      if (targetType === 'Post') {
        await Post.findByIdAndUpdate(targetId, { $inc: { likeCount: 1 } });
      } else {
        await Comment.findByIdAndUpdate(targetId, { $inc: { likeCount: 1 } });
      }
      return res.json({ message: 'Liked', liked: true });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ==============================
// COMMENTS & REPLIES
// ==============================

// @desc    Create comment on post or reply to comment
// @route   POST /api/community/comments
// @access  Private
const createComment = async (req, res) => {
  try {
    const { content, postId, parentCommentId } = req.body;
    const { error } = require('../validation/community.validation').commentValidation({ content });
    if (error) return res.status(400).json({ message: error.details[0].message });

    const post = await Post.findOne({ _id: postId, isHidden: { $ne: true } });
    if (!post) return res.status(404).json({ message: 'Post not found' });

    let parent = null;
    if (parentCommentId) {
      parent = await Comment.findById(parentCommentId);
      if (!parent) return res.status(404).json({ message: 'Parent comment not found' });
      if (parent.post.toString() !== post._id.toString()) {
        return res.status(400).json({
          message: 'Parent comment does not belong to this post',
        });
      }
    }

    const comment = await Comment.create({
      post: postId,
      author: req.user.id,
      parentComment: parentCommentId || null,
      content,
    });

    // Increment post's comment count
    await Post.findByIdAndUpdate(postId, { $inc: { commentCount: 1 } });

    const populatedComment = await Comment.findById(comment._id)
      .populate('author', 'firstName lastName profilePhoto email role')
      .lean();
    const responseComment = await resolveProfilePhotos(populatedComment);
    // Mark if author is also post author
    const isPostAuthor = post.author.toString() === req.user.id;
    responseComment.isAuthor = isPostAuthor;
    responseComment.share = buildCommentShare(responseComment);

    res.status(201).json({ message: 'Comment added', comment: responseComment });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get comments for a post (with replies)
// @route   GET /api/community/posts/:postId/comments
// @access  Private
const getComments = async (req, res) => {
  try {
    const postId = req.params.postId;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const comments = await Comment.find({ post: postId, parentComment: null })
      .populate('author', 'firstName lastName profilePhoto email role')
      .sort('-likeCount') // most liked first? Or use '-createdAt'? We'll use '-createdAt'
      .skip(skip)
      .limit(limit)
      .lean();

    const post = await Post.findById(postId);
    const userId = req.user.id;

    const resolveAvatar = createAvatarResolver();
    for (let comment of comments) {
      // Check if user liked this comment
      const liked = await Like.findOne({ user: userId, targetType: 'Comment', targetId: comment._id });
      comment.isLiked = !!liked;
      // Mark if comment author is post author
      comment.isAuthor = post.author.toString() === comment.author._id.toString();
      // Get replies
      const replies = await Comment.find({ parentComment: comment._id })
        .populate('author', 'firstName lastName profilePhoto email role')
        .sort('createdAt')
        .lean();
      for (let reply of replies) {
        const replyLiked = await Like.findOne({ user: userId, targetType: 'Comment', targetId: reply._id });
        reply.isLiked = !!replyLiked;
        reply.isAuthor = post.author.toString() === reply.author._id.toString();
        reply.author = await resolveProfilePhotos(reply.author, resolveAvatar);
        reply.share = buildCommentShare(reply);
      }
      comment.replies = replies;
      comment.author = await resolveProfilePhotos(comment.author, resolveAvatar);
      comment.share = buildCommentShare(comment);
    }

    const total = await Comment.countDocuments({ post: postId, parentComment: null });
    res.json({
      comments,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Delete comment (author or post author only)
// @route   DELETE /api/community/comments/:id
// @access  Private
const deleteComment = async (req, res) => {
  try {
    const comment = await Comment.findById(req.params.id);
    if (!comment) return res.status(404).json({ message: 'Comment not found' });
    const post = await Post.findById(comment.post);
    if (comment.author.toString() !== req.user.id && post.author.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized' });
    }
    const replies = await Comment.find({ parentComment: comment._id }).select('_id');
    const deletedIds = [comment._id, ...replies.map((reply) => reply._id)];
    await Comment.deleteMany({ _id: { $in: replies.map((reply) => reply._id) } });
    await Like.deleteMany({ targetType: 'Comment', targetId: { $in: deletedIds } });
    await comment.deleteOne();
    await Post.findByIdAndUpdate(comment.post, [
      {
        $set: {
          commentCount: {
            $max: [0, { $subtract: ['$commentCount', deletedIds.length] }],
          },
        },
      },
    ]);
    res.json({ message: 'Comment deleted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ==============================
// SAVE / UNSAVE POST
// ==============================

// @desc    Save a post
// @route   POST /api/community/save/:postId
// @access  Private
const savePost = async (req, res) => {
  try {
    const postId = req.params.postId;
    const existing = await Save.findOne({ user: req.user.id, post: postId });
    if (existing) {
      await existing.deleteOne();
      return res.json({ message: 'Post unsaved', saved: false });
    }
    await Save.create({ user: req.user.id, post: postId });
    res.json({ message: 'Post saved', saved: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get saved posts of current user
// @route   GET /api/community/saved
// @access  Private
const getSavedPosts = async (req, res) => {
  try {
    const saves = await Save.find({ user: req.user.id }).populate({
      path: 'post',
      populate: { path: 'author', select: 'firstName lastName profilePhoto email role' }
    }).sort('-createdAt').lean();
    const resolveAvatar = createAvatarResolver();
    const posts = await Promise.all(saves
      .map((save) => save.post)
      .filter((post) => post && post.isHidden !== true)
      .map(async (post) => {
        const resolvedPost = await resolveProfilePhotos(post, resolveAvatar);
        resolvedPost.media = await resolveCommunityMedia(resolvedPost.media);
        resolvedPost.share = buildPostShare(resolvedPost);
        return resolvedPost;
      }));
    res.json(posts);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ==============================
// FOLLOW / UNFOLLOW
// ==============================

// @desc    Follow a user
// @route   POST /api/community/follow/:userId
// @access  Private
const followUser = async (req, res) => {
  try {
    const targetUserId = req.params.userId;
    if (targetUserId === req.user.id) {
      return res.status(400).json({ message: 'Cannot follow yourself' });
    }
    const existing = await Follow.findOne({ follower: req.user.id, following: targetUserId });
    if (existing) {
      await existing.deleteOne();
      return res.json({ message: 'Unfollowed', following: false });
    }
    await Follow.create({ follower: req.user.id, following: targetUserId });
    res.json({ message: 'Followed', following: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get followers of a user
// @route   GET /api/community/followers/:userId
// @access  Private
const getFollowers = async (req, res) => {
  try {
    const userId = req.params.userId;
    const followers = await Follow.find({ following: userId })
      .populate('follower', 'firstName lastName profilePhoto email role')
      .lean();
    res.json(await resolveProfilePhotos(followers.map((follow) => follow.follower)));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get following of a user
// @route   GET /api/community/following/:userId
// @access  Private
const getFollowing = async (req, res) => {
  try {
    const userId = req.params.userId;
    const following = await Follow.find({ follower: userId })
      .populate('following', 'firstName lastName profilePhoto email role')
      .lean();
    res.json(await resolveProfilePhotos(following.map((follow) => follow.following)));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ==============================
// MUTE NOTIFICATIONS
// ==============================

// @desc    Mute notifications for a post
// @route   POST /api/community/mute/:postId
// @access  Private
const mutePost = async (req, res) => {
  try {
    const postId = req.params.postId;
    const existing = await Mute.findOne({ user: req.user.id, post: postId });
    if (existing) {
      await existing.deleteOne();
      return res.json({ message: 'Post unmuted', muted: false });
    }
    await Mute.create({ user: req.user.id, post: postId });
    res.json({ message: 'Post muted', muted: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ==============================
// REPORT POST
// ==============================

// src/controllers/community.controller.js - FIXED reportPost

// @desc Report a post
// @route POST /api/community/report/:postId
// @access Private
const reportPost = async (req, res) => {
  try {
    const postId = req.params.postId;
    const { error, value } = require('../validation/community.validation').reportValidation(req.body);
    if (error) return res.status(400).json({ message: error.details[0].message });
    const { reason, offenseType, projectId } = value;

    const post = await Post.findById(postId);
    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }
    if (projectId && !(await Project.exists({ _id: projectId }))) {
      return res.status(404).json({ message: 'Related project not found' });
    }

    const existing = await Report.findOne({ 
      reporter: req.user.id, 
      targetId: postId,
      targetType: 'post'
    });
    
    if (existing) {
      return res.status(400).json({ message: 'You have already reported this post' });
    }

    const report = await Report.create({
      reporter: req.user.id,
      reportedUser: post.author,
      targetType: 'post',
      targetId: postId,
      reason: reason.trim(),
      offenseType,
      relatedProject: projectId || null,
      status: 'pending',
      severity: 'medium'
    });

    res.json({ 
      message: 'Post reported. Our team will review it.',
      report: {
        id: report._id,
        reportId: report.reportId,
        status: report.status,
        offenseType: report.offenseType,
        targetType: report.targetType,
        projectId: report.relatedProject
      }
    });
  } catch (error) {
    console.error('Error in reportPost:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};


// @desc Report a comment
// @route POST /api/community/report/comment/:commentId
// @access Private
const reportComment = async (req, res) => {
  try {
    const commentId = req.params.commentId;
    const { error, value } = require('../validation/community.validation').reportValidation(req.body);
    if (error) return res.status(400).json({ message: error.details[0].message });
    const { reason, offenseType, projectId } = value;

    const comment = await Comment.findById(commentId);
    if (!comment) {
      return res.status(404).json({ message: 'Comment not found' });
    }
    if (projectId && !(await Project.exists({ _id: projectId }))) {
      return res.status(404).json({ message: 'Related project not found' });
    }

    const existing = await Report.findOne({ 
      reporter: req.user.id, 
      targetId: commentId,
      targetType: 'comment'
    });
    
    if (existing) {
      return res.status(400).json({ message: 'You have already reported this comment' });
    }

    const report = await Report.create({
      reporter: req.user.id,
      reportedUser: comment.author,
      targetType: 'comment',
      targetId: commentId,
      reason: reason.trim(),
      offenseType,
      relatedProject: projectId || null,
      status: 'pending',
      severity: 'medium'
    });

    res.json({ 
      message: 'Comment reported. Our team will review it.',
      report: {
        id: report._id,
        reportId: report.reportId,
        status: report.status,
        offenseType: report.offenseType,
        targetType: report.targetType,
        projectId: report.relatedProject
      }
    });
  } catch (error) {
    console.error('Error in reportComment:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc Report a project
// @route POST /api/community/report/project/:projectId
// @access Private
const reportProject = async (req, res) => {
  try {
    const { projectId } = req.params;
    const { error, value } = require('../validation/community.validation').reportValidation({
      ...req.body,
      projectId,
    });
    if (error) return res.status(400).json({ message: error.details[0].message });

    const project = await Project.findById(projectId).select('owner title');
    if (!project) return res.status(404).json({ message: 'Project not found' });
    const existing = await Report.findOne({
      reporter: req.user.id,
      targetId: projectId,
      targetType: 'project',
    });
    if (existing) {
      return res.status(400).json({ message: 'You have already reported this project' });
    }

    const report = await Report.create({
      reporter: req.user.id,
      reportedUser: project.owner,
      targetType: 'project',
      targetId: project._id,
      relatedProject: project._id,
      offenseType: value.offenseType,
      reason: value.reason,
      status: 'pending',
      severity: 'medium',
    });

    return res.status(201).json({
      message: 'Project reported. Our team will review it.',
      report: {
        id: report._id,
        reportId: report.reportId,
        status: report.status,
        offenseType: report.offenseType,
        targetType: report.targetType,
        projectId: report.relatedProject,
      },
    });
  } catch (error) {
    console.error('Error in reportProject:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ==============================
// USER PROFILE & STATS
// ==============================

// @desc    Get user profile (public stats)
// @route   GET /api/community/profile/:userId
// @access  Private (authenticated users can view any profile)
const getUserProfile = async (req, res) => {
  try {
    const userId = req.params.userId;
    const user = await User.findById(userId).select('-password -refreshToken -emailVerificationOTP -resetPasswordToken -resetPasswordExpires');
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Stats
    const projectsCount = await Project.countDocuments({
      $or: [{ owner: userId }, { teamMembers: userId }]
    });
    const collaborationsCount = await Project.countDocuments({ teamMembers: userId });
    const postsCount = await Post.countDocuments({ author: userId });

    // Get user's projects (with role info)
    const projects = await Project.find({ $or: [{ owner: userId }, { teamMembers: userId }] })
      .select('title stage roles teamMembers owner')
      .lean();

    // Use a for loop to handle async await inside
    const projectsWithRole = [];
    for (const p of projects) {
      let role = '';
      if (p.owner.toString() === userId) {
        role = user.role || '';
      } else {
        const application = await Application.findOne({ project: p._id, applicant: userId, status: 'ACCEPTED' });
        if (application) role = application.role;
      }
      projectsWithRole.push({ _id: p._id, title: p.title, stage: p.stage, role });
    }

    // Get user's posts
    const posts = await Post.find({ author: userId, isHidden: { $ne: true } })
  .select('content tags media likeCount commentCount createdAt')
  .populate('author', 'firstName lastName profilePhoto email role')
  .sort('-createdAt')
  .lean();

    const resolveAvatar = createAvatarResolver();
    const profileObj = await resolveProfilePhotos(user, resolveAvatar);
    profileObj.share = buildProfileShare(profileObj);
    const resolvedPosts = await Promise.all(posts.map(async (post) => {
      const resolvedPost = await resolveProfilePhotos(post, resolveAvatar);
      resolvedPost.media = await resolveCommunityMedia(resolvedPost.media);
      resolvedPost.share = buildPostShare(resolvedPost);
      return resolvedPost;
    }));
    res.json({
      user: profileObj,
      stats: {
        projects: projectsCount,
        collaborations: collaborationsCount,
        posts: postsCount,
      },
      projects: projectsWithRole,
      posts: resolvedPosts,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc Vote once on an active poll
// @route POST /api/community/posts/:postId/poll/vote
// @access Private
const voteOnPoll = async (req, res) => {
  const { postId } = req.params;
  const { optionId } = req.body;
  if (!mongoose.isValidObjectId(postId) || !mongoose.isValidObjectId(optionId)) {
    return res.status(400).json({ message: 'Valid postId and optionId are required' });
  }

  let session;
  try {
    session = await mongoose.startSession();
    await session.withTransaction(async () => {
      const post = await Post.findOne({
        _id: postId,
        postType: 'poll',
        isHidden: { $ne: true },
      }).session(session);
      if (!post?.poll) {
        const error = new Error('Poll not found');
        error.statusCode = 404;
        throw error;
      }
      if (post.poll.expiresAt <= new Date()) {
        const error = new Error('Poll has ended');
        error.statusCode = 409;
        throw error;
      }
      if (!post.poll.options.id(optionId)) {
        const error = new Error('Poll option not found');
        error.statusCode = 400;
        throw error;
      }
      const existingVote = await PollVote.exists({ post: postId, user: req.user.id }).session(session);
      if (existingVote) {
        const error = new Error('You have already voted on this poll');
        error.statusCode = 409;
        throw error;
      }
      await PollVote.create([{ post: postId, user: req.user.id, optionId }], { session });
      await Post.updateOne(
        { _id: postId, 'poll.options._id': optionId },
        { $inc: { 'poll.options.$.voteCount': 1, 'poll.totalVotes': 1 } },
        { session }
      );
    });

    const updatedPost = await Post.findById(postId).select('postType poll').lean();
    await attachPollViewerState(updatedPost, req.user.id);
    return res.json({ message: 'Vote recorded successfully', poll: updatedPost.poll });
  } catch (error) {
    const status = error.code === 11000 ? 409 : (error.statusCode || 500);
    return res.status(status).json({
      message: error.code === 11000
        ? 'You have already voted on this poll'
        : status === 500 ? 'Unable to record vote' : error.message,
    });
  } finally {
    if (session) await session.endSession();
  }
};

module.exports = {
  createPost,
  getFeed,
  getPostById,
  updatePost,
  deletePost,
  toggleLike,
  createComment,
  getComments,
  deleteComment,
  savePost,
  getSavedPosts,
  followUser,
  getFollowers,
  getFollowing,
  mutePost,
  reportPost,
  reportComment,
  reportProject,
  voteOnPoll,
  getUserProfile,
  mediaUpload,
};
