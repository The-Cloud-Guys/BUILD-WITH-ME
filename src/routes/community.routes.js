const express = require('express');
const { protect } = require('../middleware/auth.middleware');
const {
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
  mediaUpload,
} = require('../controllers/community.controller');

const router = express.Router();

// All routes require authentication
router.use(protect);

// Posts
router.post('/posts', mediaUpload.array('media', 5), createPost);
router.get('/feed', getFeed);
router.get('/posts/:id', getPostById);
router.put('/posts/:id', updatePost);
router.delete('/posts/:id', deletePost);

// Likes
router.post('/like', toggleLike);

// Comments
router.post('/comments', createComment);
router.get('/posts/:postId/comments', getComments);
router.delete('/comments/:id', deleteComment);

// Save
router.post('/save/:postId', savePost);
router.get('/saved', getSavedPosts);

// Follow
router.post('/follow/:userId', followUser);
router.get('/followers/:userId', getFollowers);
router.get('/following/:userId', getFollowing);

// Mute & Report
router.post('/mute/:postId', mutePost);
router.post('/report/:postId', reportPost);

// Profile
router.get('/profile/:userId', getUserProfile);

module.exports = router;