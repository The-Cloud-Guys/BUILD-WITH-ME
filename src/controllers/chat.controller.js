const { Message, ChatRoom, UnreadMessage } = require('../models/chat.model');
const Project = require('../models/project.model');
const Application = require('../models/application.model');
const User = require('../models/user.model');
const { getSignedUrl } = require('../services/supabase.service');

// @desc Get all rooms for a user
const getUserRooms = async (req, res) => {
  try {
    const userId = req.user.id;
    const rooms = await ChatRoom.find({
      participants: userId
    })
    .populate('participants', 'firstName lastName profilePhoto email role')
    .populate('lastMessage')
    .sort('-lastMessageAt')
    .lean();

    const roomsWithUnread = await Promise.all(rooms.map(async (room) => {
      const unread = await UnreadMessage.findOne({
        room: room._id,
        user: userId
      });
      room.unreadCount = unread ? unread.count : 0;
      room.memberCount = room.participants.length;
      room.firstMembers = room.participants.slice(0, 3);
      return room;
    }));

    res.json(roomsWithUnread);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc Get or create direct message room
const getOrCreateDirectRoom = async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user.id;

    let room = await ChatRoom.findOne({
      type: 'direct',
      participants: { $all: [currentUserId, userId], $size: 2 }
    });

    if (!room) {
      const users = await User.find({ _id: { $in: [currentUserId, userId] } });
      room = await ChatRoom.create({
        name: `${users[0].firstName} & ${users[1].firstName}`,
        type: 'direct',
        participants: [currentUserId, userId],
        admins: [currentUserId, userId]
      });
    }

    res.json(room);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc Get messages for a room
const getRoomMessages = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const userId = req.user.id;

    const room = await ChatRoom.findById(roomId);
    if (!room) return res.status(404).json({ message: 'Room not found' });
    if (!room.participants.includes(userId)) {
      return res.status(403).json({ message: 'Not a member of this room' });
    }

    const messages = await Message.find({
      room: roomId,
      isDeleted: false,
      deletedFor: { $nin: [userId] }
    })
    .populate('sender', 'firstName lastName profilePhoto email role')
    .sort('-createdAt')
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();

    // Mark messages as read
    const messageIds = messages.map(m => m._id);
    await Message.updateMany(
      { _id: { $in: messageIds } },
      { $addToSet: { readBy: { user: userId, readAt: new Date() } } }
    );

    await UnreadMessage.updateOne(
      { room: roomId, user: userId },
      { $set: { count: 0, lastReadMessage: messageIds[0] || null } }
    );

    const participants = await User.find(
      { _id: { $in: room.participants } },
      'firstName lastName profilePhoto email role'
    ).lean();

    const participantWithRoles = participants.map(p => ({
      ...p,
      roleInProject: room.participantRoles.get(p._id.toString()) || 'Member'
    }));

    res.json({
      messages: messages.reverse(),
      participants: participantWithRoles,
      roomDetails: {
        name: room.name,
        type: room.type,
        projectId: room.projectId
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit)
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc Send message
const sendMessage = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { content } = req.body;
    const userId = req.user.id;

    const room = await ChatRoom.findById(roomId);
    if (!room) return res.status(404).json({ message: 'Room not found' });
    if (!room.participants.includes(userId)) {
      return res.status(403).json({ message: 'Not a member of this room' });
    }

    let media = [];
    let mediaType = null;
    if (req.files && req.files.length > 0) {
      // Media upload logic would go here
    }

    const message = await Message.create({
      room: roomId,
      sender: userId,
      content: content || '',
      media,
      mediaType,
      deliveredTo: room.participants
    });

    room.lastMessage = message._id;
    room.lastMessageAt = new Date();
    await room.save();

    // Increment unread counts
    const participants = room.participants.filter(p => p.toString() !== userId);
    for (const participant of participants) {
      await UnreadMessage.findOneAndUpdate(
        { room: roomId, user: participant },
        { $inc: { count: 1 } },
        { upsert: true, new: true }
      );
    }

    const populatedMessage = await Message.findById(message._id)
      .populate('sender', 'firstName lastName profilePhoto email role')
      .lean();

    res.status(201).json({ message: populatedMessage, roomId });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc Create group
const createGroup = async (req, res) => {
  try {
    const { name, projectId, participantIds, isPrivate = false } = req.body;
    const userId = req.user.id;

    let participants = [userId];
    const participantRoles = new Map();
    participantRoles.set(userId.toString(), 'Owner');

    if (projectId) {
      const project = await Project.findById(projectId);
      if (!project) return res.status(404).json({ message: 'Project not found' });
      const isMember = project.owner.toString() === userId || 
                       project.teamMembers.includes(userId);
      if (!isMember) {
        return res.status(403).json({ message: 'You must be a member of this project' });
      }
      
      participants = [userId, ...project.teamMembers.map(m => m._id)];
      for (const member of project.teamMembers) {
        const app = await Application.findOne({
          project: projectId,
          applicant: member._id,
          status: 'ACCEPTED'
        });
        participantRoles.set(member._id.toString(), app?.role || 'Member');
      }
    } else if (participantIds && participantIds.length > 0) {
      participants = [userId, ...participantIds];
    }

    const room = await ChatRoom.create({
      name,
      type: projectId ? 'project_group' : 'open_group',
      participants,
      admins: [userId],
      projectId: projectId || null,
      participantRoles,
      isPrivate,
      lastMessageAt: new Date()
    });

    res.status(201).json({ message: 'Group created successfully', room });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc Get call room
const getCallRoom = async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user.id;

    const room = await ChatRoom.findById(roomId);
    if (!room) return res.status(404).json({ message: 'Room not found' });
    if (!room.participants.includes(userId)) {
      return res.status(403).json({ message: 'Not a member of this room' });
    }

    res.json({
      roomId: room._id,
      participants: room.participants,
      callType: req.query.type || 'video'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  getUserRooms,
  getRoomMessages,
  sendMessage,
  getOrCreateDirectRoom,
  createGroup,
  getCallRoom
};