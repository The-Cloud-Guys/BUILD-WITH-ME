const mongoose = require('mongoose');

// Message Schema
const messageSchema = new mongoose.Schema({
  room: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChatRoom',
    required: true
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  content: {
    type: String,
    trim: true,
    maxlength: 2000,
    default: ''
  },
  media: [{
    type: String,
    default: []
  }],
  mediaType: {
    type: String,
    enum: ['image', 'video', 'audio', 'file', null],
    default: null
  },
  readBy: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    readAt: { type: Date, default: Date.now }
  }],
  deliveredTo: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  isDeleted: {
    type: Boolean,
    default: false
  },
  deletedFor: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }]
}, { timestamps: true });

// ChatRoom Schema
const chatRoomSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  type: {
    type: String,
    enum: ['direct', 'team_room', 'open_group', 'project_group'],
    required: true
  },
  participants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }],
  admins: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  projectId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    default: null
  },
  participantRoles: {
    type: Map,
    of: String,
    default: new Map()
  },
  isPrivate: {
    type: Boolean,
    default: false
  },
  lastMessage: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message'
  },
  lastMessageAt: {
    type: Date,
    default: Date.now
  },
  mutedUsers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  maxMessages: {
    type: Number,
    default: 1000
  }
}, { timestamps: true });

// UnreadMessage Schema
const unreadMessageSchema = new mongoose.Schema({
  room: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChatRoom',
    required: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  count: {
    type: Number,
    default: 0
  },
  lastReadMessage: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message'
  }
}, { timestamps: true });

// Indexes
messageSchema.index({ room: 1, createdAt: -1 });
messageSchema.index({ sender: 1, createdAt: -1 });
chatRoomSchema.index({ participants: 1 });
chatRoomSchema.index({ projectId: 1 });
unreadMessageSchema.index({ room: 1, user: 1 }, { unique: true });

module.exports = {
  Message: mongoose.model('Message', messageSchema),
  ChatRoom: mongoose.model('ChatRoom', chatRoomSchema),
  UnreadMessage: mongoose.model('UnreadMessage', unreadMessageSchema)
};