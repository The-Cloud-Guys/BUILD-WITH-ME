const socketIO = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('../models/user.model');
const { Message, ChatRoom, UnreadMessage } = require('../models/chat.model');
const { createNotification } = require('../services/notification.service');

class SocketManager {
  constructor(server) {
    this.io = socketIO(server, {
      cors: {
        origin: process.env.FRONTEND_URL || 'http://localhost:3000',
        credentials: true
      }
    });
    
    this.activeCalls = new Map(); 
    this.setupMiddleware();
    this.setupHandlers();
  }

  setupMiddleware() {
    this.io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token || 
                     socket.handshake.headers.authorization?.split(' ')[1];
        
        if (!token) {
          return next(new Error('Authentication required'));
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id);
        
        if (!user) {
          return next(new Error('User not found'));
        }

        socket.user = user;
        socket.userId = user._id.toString();
        next();
      } catch (error) {
        next(new Error('Invalid token'));
      }
    });
  }

  setupHandlers() {
    this.io.on('connection', (socket) => {
      console.log(`User connected: ${socket.userId}`);
      
      this.joinUserRooms(socket);

      socket.on('join-room', (roomId) => {
        socket.join(`room:${roomId}`);
        console.log(`User ${socket.userId} joined room: ${roomId}`);
      });

      socket.on('send-message', async (data) => {
        try {
          const { roomId, content, media } = data;
          const message = await this.handleSendMessage(socket.userId, roomId, content, media);
          
          this.io.to(`room:${roomId}`).emit('new-message', message);
          const room = await ChatRoom.findById(roomId);
          for (const participant of room.participants) {
            if (participant.toString() !== socket.userId) {
              const unread = await UnreadMessage.findOne({
                room: roomId,
                user: participant
              });
              this.io.to(`user:${participant}`).emit('unread-update', {
                roomId,
                count: unread?.count || 0
              });
            }
          }
        } catch (error) {
          console.error('Send message error:', error);
          socket.emit('message-error', { error: error.message });
        }
      });

      socket.on('typing', (data) => {
        const { roomId, isTyping } = data;
        socket.to(`room:${roomId}`).emit('typing-indicator', {
          userId: socket.userId,
          userName: `${socket.user.firstName} ${socket.user.lastName}`,
          isTyping
        });
      });

      // ==============================
      // CALL MANAGEMENT HANDLERS
      // ==============================

      socket.on('call-initiate', (data) => {
        const { roomId, callType } = data;
        
        console.log(` Call initiated by ${socket.userId} in room ${roomId} (${callType})`);
        
        if (!this.activeCalls.has(roomId)) {
          this.activeCalls.set(roomId, {
            participants: new Set([socket.userId]),
            callType: callType,
            startedAt: new Date()
          });
        } else {
          this.activeCalls.get(roomId).participants.add(socket.userId);
        }

        socket.to(`room:${roomId}`).emit('call-incoming', {
          callerId: socket.userId,
          callerName: `${socket.user.firstName} ${socket.user.lastName}`,
          callType: callType
        });

        this.io.to(`room:${roomId}`).emit('call-state', {
          participants: Array.from(this.activeCalls.get(roomId).participants),
          callType: callType,
          active: true,
          startedAt: this.activeCalls.get(roomId).startedAt
        });
      });

      socket.on('call-response', (data) => {
        const { roomId, accepted } = data;
        
        console.log(` Call response from ${socket.userId}: ${accepted ? 'ACCEPTED' : 'REJECTED'}`);
        
        if (accepted) {
          if (this.activeCalls.has(roomId)) {
            this.activeCalls.get(roomId).participants.add(socket.userId);
          }
          
          socket.to(`room:${roomId}`).emit('call-response', {
            userId: socket.userId,
            userName: `${socket.user.firstName} ${socket.user.lastName}`,
            accepted: true
          });
          
          this.broadcastCallState(roomId);
        } else {
          socket.to(`room:${roomId}`).emit('call-response', {
            userId: socket.userId,
            userName: `${socket.user.firstName} ${socket.user.lastName}`,
            accepted: false
          });
        }
      });

      socket.on('leave-call', (data) => {
        const { roomId } = data;
        console.log(`📞 User ${socket.userId} leaving call in room ${roomId}`);
        this.handleLeaveCall(socket.userId, roomId);
      });

      socket.on('signal', (data) => {
        const { roomId, signal } = data;
        socket.to(`room:${roomId}`).emit('signal', {
          userId: socket.userId,
          signal
        });
      });

      socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.userId}`);
        
        for (const [roomId, call] of this.activeCalls) {
          if (call.participants.has(socket.userId)) {
            this.handleLeaveCall(socket.userId, roomId);
          }
        }
        
        socket.rooms.forEach(room => {
          if (room.startsWith('room:')) {
            socket.to(room).emit('user-disconnected', socket.userId);
          }
        });
      });
    });
  }

  // ==============================
  // HELPER METHODS
  // ==============================

  async joinUserRooms(socket) {
    const rooms = await ChatRoom.find({ participants: socket.userId });
    for (const room of rooms) {
      socket.join(`room:${room._id.toString()}`);
    }
    socket.join(`user:${socket.userId}`);
    console.log(`User ${socket.userId} joined ${rooms.length} rooms`);
  }

  async handleSendMessage(userId, roomId, content, media) {
    const message = await Message.create({
      room: roomId,
      sender: userId,
      content: content || '',
      media: media || [],
      deliveredTo: await this.getRoomParticipants(roomId)
    });

    const populatedMessage = await Message.findById(message._id)
      .populate('sender', 'firstName lastName profilePhoto email role')
      .lean();

    await ChatRoom.findByIdAndUpdate(roomId, {
      lastMessage: message._id,
      lastMessageAt: new Date()
    });

    return populatedMessage;
  }

  async getRoomParticipants(roomId) {
    const room = await ChatRoom.findById(roomId);
    return room.participants;
  }

  // ==============================
  // CALL MANAGEMENT HELPERS
  // ==============================

  handleLeaveCall(userId, roomId) {
    const call = this.activeCalls.get(roomId);
    if (!call) {
      console.log(` No active call found in room ${roomId}`);
      return;
    }

    // Remove user from participants
    call.participants.delete(userId);
    const participantCount = call.participants.size;

    console.log(`User ${userId} left call in room ${roomId} - ${participantCount} participant(s) remaining`);

    this.io.to(`room:${roomId}`).emit('user-left-call', {
      userId: userId,
      remainingParticipants: Array.from(call.participants),
      participantCount: participantCount
    });

    if (participantCount === 0) {
      this.activeCalls.delete(roomId);
      
      this.io.to(`room:${roomId}`).emit('call-ended', {
        reason: 'All participants have left the call',
        endedAt: new Date()
      });
      
      console.log(`📞 Call ended in room: ${roomId} - All participants left`);
    } else {
      this.io.to(`room:${roomId}`).emit('call-state', {
        participants: Array.from(call.participants),
        participantCount: participantCount,
        callType: call.callType,
        active: true,
        startedAt: call.startedAt
      });
    }
  }

  broadcastCallState(roomId) {
    const call = this.activeCalls.get(roomId);
    if (!call) return;

    this.io.to(`room:${roomId}`).emit('call-state', {
      participants: Array.from(call.participants),
      participantCount: call.participants.size,
      callType: call.callType,
      active: true,
      startedAt: call.startedAt
    });
  }

  getCallParticipants(roomId) {
    const call = this.activeCalls.get(roomId);
    return call ? Array.from(call.participants) : [];
  }

  isUserInCall(userId, roomId) {
    const call = this.activeCalls.get(roomId);
    return call ? call.participants.has(userId) : false;
  }
}

module.exports = SocketManager;