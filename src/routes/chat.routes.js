const express = require('express');
const mongoose = require('mongoose');
const { protect } = require('../middleware/auth.middleware');
const { iceServerLimiter } = require('../middleware/rateLimiter');
const { getCallIceServers } = require('../controllers/iceServer.controller');
const {
  getUserRooms,
  getRoomMessages,
  sendMessage,
  getOrCreateDirectRoom,
  createGroup,
  getCallRoom,
  getGroupCandidates,
  handleGroupIconUpload,
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
router.post('/direct/:userId', getOrCreateDirectRoom);

// Group routes
router.get('/group-candidates', getGroupCandidates);
router.post('/groups', handleGroupIconUpload, createGroup);

// Room routes
router.get('/rooms/:roomId/messages', getRoomMessages);
router.post('/rooms/:roomId/messages', sendMessage);

// Call routes
router.get('/rooms/:roomId/call', getCallRoom);
router.post('/rooms/:roomId/calls', createCall);
router.get('/calls/:callId', getCall);
router.get('/calls/:callId/ice-servers', iceServerLimiter, getCallIceServers);
router.post('/calls/:callId/accept', acceptCall);
router.post('/calls/:callId/decline', declineCall);
router.post('/calls/:callId/cancel', cancelCall);
router.post('/calls/:callId/end', endCall);

module.exports = router;
