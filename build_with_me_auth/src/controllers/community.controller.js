const Application = require('../models/application.model');
const Post = require('../models/post.model');
const Comment = require('../models/comment.model');
const Like = require('../models/like.model');
const Save = require('../models/save.model');
const Follow = require('../models/follow.model');
const Mute = require('../models/mute.model');
const Report = require('../models/report.model');
const User = require('../models/user.model');
const Project = require('../models/project.model');
const { uploadFile, deleteFile, getSignedUrl } = require('../services/supabase.service');
const multer = require('multer');
const path = require('path');

// Configure multer for media upload (memory storage)
const mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB per file
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp|mp4|mov|avi/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (mimetype && extname) return cb(null, true);
    cb(new Error('Only images and videos are allowed'));
  },
});

// Helper to upload multiple media files
const uploadMedia = async (files, userId, postId) => {
  const urls = [];
  for (const file of files) {
    const ext = path.extname(file.originalname).toLowerCase();
    const timestamp = Date.now();
    const filePath = `posts/${userId}/${postId}/${timestamp}_${Math.random().toString(36).substring(7)}${ext}`;
    await uploadFile(process.env.SUPABASE_BUCKET_COMMUNITY, filePath, file.buffer, file.mimetype);
    const signedUrl = await getSignedUrl('community-media', filePath, 3600);
    urls.push(signedUrl);
  }
  return urls;
};

// ==============================
// POSTS
// ==============================

// @desc    Create a new post (with optional media)
// @route   POST /api/community/posts
// @access  Private
const createPost = async (req, res) => {
  try {
    const { content, tags } = req.body;
    const { error } = require('../validation/community.validation').createPostValidation({ content, tags });
    if (error) return res.status(400).json({ message: error.details[0].message });

    const post = await Post.create({
      author: req.user.id,
      content,
      tags: tags || [],
    });

    let mediaUrls = [];
    if (req.files && req.files.length) {
      mediaUrls = await uploadMedia(req.files, req.user.id, post._id);
      post.media = mediaUrls;
      await post.save();
    }

    const populatedPost = await Post.findById(post._id).populate('author', 'firstName lastName profilePhoto email');
    // Convert profilePhoto to signed URL
    if (populatedPost.author.profilePhoto && populatedPost.author.profilePhoto.startsWith('users/')) {
      populatedPost.author.profilePhoto = await getSignedUrl(process.env.SUPABASE_BUCKET_AVATAR, populatedPost.author.profilePhoto);
    }

    res.status(201).json({ message: 'Post created successfully', post: populatedPost });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get feed (recent posts, paginated)
// @route   GET /api/community/feed
// @access  Private (or public? We'll keep private to show personalized feed later)
const getFeed = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const posts = await Post.find()
      .populate('author', 'firstName lastName profilePhoto email')
      .sort('-createdAt')
      .skip(skip)
      .limit(limit)
      .lean();

    // Check if current user has liked each post
    const userId = req.user.id;
    for (let post of posts) {
      const liked = await Like.findOne({ user: userId, targetType: 'Post', targetId: post._id });
      post.isLiked = !!liked;

      const saved = await Save.findOne({ user: userId, post: post._id });
      post.isSaved = !!saved;

      // Convert author profile photo to signed URL
      if (post.author.profilePhoto && post.author.profilePhoto.startsWith('users/')) {
        post.author.profilePhoto = await getSignedUrl(process.env.SUPABASE_BUCKET_AVATAR, post.author.profilePhoto);
      }
      // Generate signed URLs for media
      if (post.media && post.media.length) {
        post.media = await Promise.all(post.media.map(async (url) => {
        if (url.startsWith('users/') || url.includes('/posts/')) {
            return await getSignedUrl(process.env.SUPABASE_BUCKET_COMMUNITY, url, 3600);
        }
          return url;
        }));
      }
    }

    const total = await Post.countDocuments();

    res.json({
      posts,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get single post by ID
// @route   GET /api/community/posts/:id
// @access  Private
const getPostById = async (req, res) => {
  try {
    const post = await Post.findById(req.params.id)
      .populate('author', 'firstName lastName profilePhoto email')
      .lean();
    if (!post) return res.status(404).json({ message: 'Post not found' });

    const userId = req.user.id;
    post.isLiked = !!(await Like.findOne({ user: userId, targetType: 'Post', targetId: post._id }));
    post.isSaved = !!(await Save.findOne({ user: userId, post: post._id }));

    if (post.author.profilePhoto && post.author.profilePhoto.startsWith('users/')) {
      post.author.profilePhoto = await getSignedUrl(process.env.SUPABASE_BUCKET_AVATAR, post.author.profilePhoto);
    }

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

    res.json({ message: 'Post updated successfully', post });
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
    await Comment.deleteMany({ post: post._id });
    await Like.deleteMany({ targetType: 'Post', targetId: post._id });
    await Save.deleteMany({ post: post._id });
    await Mute.deleteMany({ post: post._id });
    await Report.deleteMany({ post: post._id });

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
        await Post.findByIdAndUpdate(targetId, { $inc: { likeCount: -1 } });
      } else {
        await Comment.findByIdAndUpdate(targetId, { $inc: { likeCount: -1 } });
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

    const post = await Post.findById(postId);
    if (!post) return res.status(404).json({ message: 'Post not found' });

    let parent = null;
    if (parentCommentId) {
      parent = await Comment.findById(parentCommentId);
      if (!parent) return res.status(404).json({ message: 'Parent comment not found' });
    }

    const comment = await Comment.create({
      post: postId,
      author: req.user.id,
      parentComment: parentCommentId || null,
      content,
    });

    // Increment post's comment count
    await Post.findByIdAndUpdate(postId, { $inc: { commentCount: 1 } });

    const populatedComment = await Comment.findById(comment._id).populate('author', 'firstName lastName profilePhoto email');
    if (populatedComment.author.profilePhoto && populatedComment.author.profilePhoto.startsWith('users/')) {
      populatedComment.author.profilePhoto = await getSignedUrl(process.env.SUPABASE_BUCKET_AVATAR, populatedComment.author.profilePhoto);
    }
    // Mark if author is also post author
    const isPostAuthor = post.author.toString() === req.user.id;
    populatedComment._doc.isAuthor = isPostAuthor;

    res.status(201).json({ message: 'Comment added', comment: populatedComment });
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
      .populate('author', 'firstName lastName profilePhoto email')
      .sort('-likeCount') // most liked first? Or use '-createdAt'? We'll use '-createdAt'
      .skip(skip)
      .limit(limit)
      .lean();

    const post = await Post.findById(postId);
    const userId = req.user.id;

    for (let comment of comments) {
      // Check if user liked this comment
      const liked = await Like.findOne({ user: userId, targetType: 'Comment', targetId: comment._id });
      comment.isLiked = !!liked;
      // Mark if comment author is post author
      comment.isAuthor = post.author.toString() === comment.author._id.toString();
      // Get replies
      const replies = await Comment.find({ parentComment: comment._id })
        .populate('author', 'firstName lastName profilePhoto email')
        .sort('createdAt')
        .lean();
      for (let reply of replies) {
        const replyLiked = await Like.findOne({ user: userId, targetType: 'Comment', targetId: reply._id });
        reply.isLiked = !!replyLiked;
        reply.isAuthor = post.author.toString() === reply.author._id.toString();
        if (reply.author.profilePhoto && reply.author.profilePhoto.startsWith('users/')) {
          reply.author.profilePhoto = await getSignedUrl(process.env.SUPABASE_BUCKET_AVATAR, reply.author.profilePhoto);
        }
      }
      comment.replies = replies;
      if (comment.author.profilePhoto && comment.author.profilePhoto.startsWith('users/')) {
        comment.author.profilePhoto = await getSignedUrl(process.env.SUPABASE_BUCKET_AVATAR, comment.author.profilePhoto);
      }
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
    // Delete all replies recursively (optional: cascade)
    await Comment.deleteMany({ parentComment: comment._id });
    await Like.deleteMany({ targetType: 'Comment', targetId: comment._id });
    await comment.deleteOne();
    await Post.findByIdAndUpdate(comment.post, { $inc: { commentCount: -1 } });
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
      populate: { path: 'author', select: 'firstName lastName profilePhoto email' }
    }).sort('-createdAt');
    const posts = saves.map(s => s.post).filter(p => p);
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
    const followers = await Follow.find({ following: userId }).populate('follower', 'firstName lastName profilePhoto email');
    res.json(followers.map(f => f.follower));
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
    const following = await Follow.find({ follower: userId }).populate('following', 'firstName lastName profilePhoto email');
    res.json(following.map(f => f.following));
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

// @desc    Report a post
// @route   POST /api/community/report/:postId
// @access  Private
const reportPost = async (req, res) => {
  try {
    const postId = req.params.postId;
    const { reason } = req.body;
    const { error } = require('../validation/community.validation').reportValidation({ reason });
    if (error) return res.status(400).json({ message: error.details[0].message });

    const existing = await Report.findOne({ reporter: req.user.id, post: postId });
    if (existing) return res.status(400).json({ message: 'You have already reported this post' });

    await Report.create({ reporter: req.user.id, post: postId, reason: reason || '' });
    res.json({ message: 'Post reported. Our team will review it.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
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
        role = 'Creator';
      } else {
        const application = await Application.findOne({ project: p._id, applicant: userId, status: 'ACCEPTED' });
        if (application) role = application.role;
      }
      projectsWithRole.push({ _id: p._id, title: p.title, stage: p.stage, role });
    }

    // Get user's posts
    const posts = await Post.find({ author: userId }).populate('author', 'firstName lastName profilePhoto email').sort('-createdAt').lean();
    for (let post of posts) {
      if (post.author.profilePhoto && post.author.profilePhoto.startsWith('users/')) {
        post.author.profilePhoto = await getSignedUrl(process.env.SUPABASE_BUCKET_AVATAR, post.author.profilePhoto);
      }
    }

    const profileObj = user.toObject();
    if (profileObj.profilePhoto && profileObj.profilePhoto.startsWith('users/')) {
      profileObj.profilePhoto = await getSignedUrl(process.env.SUPABASE_BUCKET_AVATAR, profileObj.profilePhoto);
    }

    res.json({
      user: profileObj,
      stats: {
        projects: projectsCount,
        collaborations: collaborationsCount,
        posts: postsCount,
      },
      projects: projectsWithRole,
      posts,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ==============================
// COPY LINK (returns post URL)
// ==============================
// No backend endpoint needed – frontend constructs URL from post ID.

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
  getUserProfile,
  mediaUpload, // export for routes
};