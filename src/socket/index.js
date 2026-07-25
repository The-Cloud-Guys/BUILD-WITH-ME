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
      
      // Join user's rooms
      this.joinUserRooms(socket);

      // Handle joining a room
      socket.on('join-room', (roomId) => {
        socket.join(`room:${roomId}`);
      });

      // Handle sending messages
      socket.on('send-message', async (data) => {
        try {
          const { roomId, content, media } = data;
          const message = await this.handleSendMessage(socket.userId, roomId, content, media);
          
          // Emit to room
          this.io.to(`room:${roomId}`).emit('new-message', message);
          
          // Notify participants with unread count
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

      // Handle typing indicator
      socket.on('typing', (data) => {
        const { roomId, isTyping } = data;
        socket.to(`room:${roomId}`).emit('typing-indicator', {
          userId: socket.userId,
          userName: `${socket.user.firstName} ${socket.user.lastName}`,
          isTyping
        });
      });

      // Handle call initiation
      socket.on('call-initiate', (data) => {
        const { roomId, callType } = data;
        socket.to(`room:${roomId}`).emit('call-incoming', {
          callerId: socket.userId,
          callerName: `${socket.user.firstName} ${socket.user.lastName}`,
          callType
        });
      });

      // Handle call response
      socket.on('call-response', (data) => {
        const { roomId, accepted } = data;
        socket.to(`room:${roomId}`).emit('call-response', {
          callerId: socket.userId,
          accepted
        });
      });

      // Handle WebRTC signaling
      socket.on('signal', (data) => {
        const { roomId, signal } = data;
        socket.to(`room:${roomId}`).emit('signal', {
          userId: socket.userId,
          signal
        });
      });

      // Handle disconnection
      socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.userId}`);
        socket.rooms.forEach(room => {
          if (room.startsWith('room:')) {
            socket.to(room).emit('user-disconnected', socket.userId);
          }
        });
      });
    });
  }

  async joinUserRooms(socket) {
    const rooms = await ChatRoom.find({ participants: socket.userId });
    for (const room of rooms) {
      socket.join(`room:${room._id.toString()}`);
    }
    socket.join(`user:${socket.userId}`);
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
}

module.exports = SocketManager;