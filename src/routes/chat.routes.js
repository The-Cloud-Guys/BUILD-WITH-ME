const express = require('express');
const { protect } = require('../middleware/auth.middleware');
const {
  getUserRooms,
  getRoomMessages,
  sendMessage,
  getOrCreateDirectRoom,
  createGroup,
  getCallRoom
} = require('../controllers/chat.controller');

const router = express.Router();

// All routes require authentication
router.use(protect);

// Get all user rooms
router.get('/rooms', getUserRooms);

// Direct message routes
router.get('/direct/:userId', getOrCreateDirectRoom);

// Group routes
router.post('/groups', createGroup);

// Room routes
router.get('/rooms/:roomId/messages', getRoomMessages);
router.post('/rooms/:roomId/messages', sendMessage);

// Call routes
router.get('/rooms/:roomId/call', getCallRoom);

module.exports = router;
