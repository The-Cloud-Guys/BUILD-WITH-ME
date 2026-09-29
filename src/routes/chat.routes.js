const express = require('express');
const mongoose = require('mongoose');
const { protect } = require('../middleware/auth.middleware');
const {
  getUserRooms,
  getRoomMessages,
  sendMessage,
  getOrCreateDirectRoom,
  createGroup,
  getCallRoom
} = require('../controllers/chat.controller');
const {
  acceptCall,
  cancelCall,
  createCall,
  declineCall,
  endCall,
  getCall,
} = require('../controllers/chatCall.controller');

const router = express.Router();

router.param('callId', (req, res, next, value) => {
  if (!mongoose.isValidObjectId(value)) return res.status(400).json({ message: 'Invalid call ID' });
  return next();
});

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
router.post('/rooms/:roomId/calls', createCall);
router.get('/calls/:callId', getCall);
router.post('/calls/:callId/accept', acceptCall);
router.post('/calls/:callId/decline', declineCall);
router.post('/calls/:callId/cancel', cancelCall);
router.post('/calls/:callId/end', endCall);

module.exports = router;
