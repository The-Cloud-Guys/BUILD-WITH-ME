const socketIO = require('socket.io');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const User = require('../models/user.model');
const { Message, ChatRoom, UnreadMessage } = require('../models/chat.model');
const CallSession = require('../models/callSession.model');
const { createNotification } = require('../services/notification.service');
const { sendChatMessagePush } = require('../services/pushNotification.service');

class SocketManager {
  constructor(server) {
    this.io = socketIO(server, {
      cors: {
        origin: process.env.FRONTEND_URL || 'http://localhost:3000',
        credentials: true
      }
    });

    this.onlineUsers = new Map();
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
        
        if (!user || user.isActive === false || user.isSuspended === true) {
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

      this.onlineUsers.set(socket.userId, (this.onlineUsers.get(socket.userId) || 0) + 1);
      this.joinUserRooms(socket).then(() => {
        socket.to([...socket.rooms]).emit('presence-update', {
          userId: socket.userId,
          isOnline: true,
        });
      });

      socket.on('join-room', async (roomId) => {
        if (!(await this.isRoomMember(socket.userId, roomId))) {
          return socket.emit('room-error', { error: 'Not a member of this room' });
        }
        socket.join(`room:${roomId}`);
      });

      socket.on('send-message', async (data) => {
        try {
          const { roomId, content } = data;
          if (!(await this.isRoomMember(socket.userId, roomId))) {
            throw new Error('Not a member of this room');
          }
          const message = await this.handleSendMessage(socket.userId, roomId, content);
          
          this.io.to(`room:${roomId}`).emit('new-message', message);
          const room = await ChatRoom.findById(roomId);
          const recipients = room.participants.filter(
            (participant) => participant.toString() !== socket.userId
          );
          await sendChatMessagePush({ recipientIds: recipients, message, room });
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

      socket.on('typing', async (data) => {
        const { roomId, isTyping } = data;
        if (!(await this.isRoomMember(socket.userId, roomId))) return;
        socket.to(`room:${roomId}`).emit('typing-indicator', {
          userId: socket.userId,
          userName: `${socket.user.firstName} ${socket.user.lastName}`,
          isTyping
        });
      });

      // ==============================
      // CALL MANAGEMENT HANDLERS
      // ==============================

      socket.on('call-initiate', async (data) => {
        const { roomId } = data;
        if (!(await this.isRoomMember(socket.userId, roomId))) {
          return socket.emit('call-error', { error: 'Not a member of this room' });
        }
        return socket.emit('call-error', {
          code: 'PERSISTENT_CALL_REQUIRED',
          error: 'Create calls with POST /api/chat/rooms/:roomId/calls',
        });
      });

      socket.on('call-response', async (data) => {
        const { roomId } = data;
        if (!(await this.isRoomMember(socket.userId, roomId))) return;
        return socket.emit('call-error', {
          code: 'PERSISTENT_CALL_REQUIRED',
          error: 'Accept or decline calls through the call lifecycle API',
        });
      });

      socket.on('leave-call', async (data) => {
        const { roomId } = data;
        if (!(await this.isRoomMember(socket.userId, roomId))) return;
        return socket.emit('call-error', {
          code: 'PERSISTENT_CALL_REQUIRED',
          error: 'End accepted calls through POST /api/chat/calls/:callId/end',
        });
      });

      socket.on('signal', async (data) => {
        const { callId, roomId, targetUserId, signal } = data;
        if (!(await this.isRoomMember(socket.userId, roomId))) return;
        if (!callId || !targetUserId || !signal) {
          return socket.emit('signal-error', { error: 'callId, roomId, targetUserId and signal are required' });
        }
        if (!mongoose.isValidObjectId(callId) || !mongoose.isValidObjectId(targetUserId)) {
          return socket.emit('signal-error', { error: 'Invalid call or target user ID' });
        }
        const call = await CallSession.findOne({
          _id: callId,
          room: roomId,
          status: 'accepted',
        }).select('caller answeredBy').lean();
        if (!call?.answeredBy) {
          return socket.emit('signal-error', { error: 'Accepted call not found' });
        }
        const participants = [call.caller.toString(), call.answeredBy.toString()];
        if (
          !participants.includes(socket.userId) ||
          !participants.includes(targetUserId.toString()) ||
          targetUserId.toString() === socket.userId
        ) {
          return socket.emit('signal-error', { error: 'Invalid call signaling participants' });
        }
        this.io.to(`user:${targetUserId}`).emit('signal', {
          callId,
          roomId,
          fromUserId: socket.userId,
          signal,
        });
      });

      socket.on('disconnecting', () => {
        const remaining = Math.max(0, (this.onlineUsers.get(socket.userId) || 1) - 1);
        if (remaining === 0) this.onlineUsers.delete(socket.userId);
        else this.onlineUsers.set(socket.userId, remaining);
        if (remaining === 0) {
          socket.to([...socket.rooms]).emit('presence-update', {
            userId: socket.userId,
            isOnline: false,
          });
        }
      });

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

  async handleSendMessage(userId, roomId, content) {
    const participants = await this.getRoomParticipants(roomId);
    const message = await Message.create({
      room: roomId,
      sender: userId,
      content: content || '',
      media: [],
      deliveredTo: participants
    });

    const populatedMessage = await Message.findById(message._id)
      .populate('sender', 'firstName lastName profilePhoto email role')
      .lean();

    await ChatRoom.findByIdAndUpdate(roomId, {
      lastMessage: message._id,
      lastMessageAt: new Date()
    });

    await Promise.all(
      participants
        .filter((participant) => participant.toString() !== userId)
        .map((participant) =>
          UnreadMessage.findOneAndUpdate(
            { room: roomId, user: participant },
            { $inc: { count: 1 } },
            { upsert: true }
          )
        )
    );

    return populatedMessage;
  }

  async getRoomParticipants(roomId) {
    const room = await ChatRoom.findById(roomId);
    return room ? room.participants : [];
  }

  async isRoomMember(userId, roomId) {
    if (!mongoose.isValidObjectId(roomId)) return false;
    try {
      return Boolean(await ChatRoom.exists({ _id: roomId, participants: userId }));
    } catch {
      return false;
    }
  }

  isUserOnline(userId) {
    return this.onlineUsers.has(String(userId));
  }

}

module.exports = SocketManager;
