const { Message, ChatRoom, UnreadMessage } = require('../models/chat.model');
const Project = require('../models/project.model');
const Application = require('../models/application.model');
const User = require('../models/user.model');
const { getSignedUrl, uploadFile, deleteFile } = require('../services/supabase.service');
const { createAvatarResolver } = require('../services/avatar.service');
const { sendChatMessagePush } = require('../services/pushNotification.service');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');

const groupIconUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
    const allowedMimes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
    const extensionAllowed = allowedExtensions.has(path.extname(file.originalname).toLowerCase());
    const mimeAllowed = allowedMimes.has(file.mimetype) || file.mimetype === 'application/octet-stream';
    if (extensionAllowed && mimeAllowed) {
      return cb(null, true);
    }
    const error = new Error('Room icon must be a JPG, PNG, WEBP, or GIF image');
    error.statusCode = 400;
    return cb(error);
  },
});

const handleGroupIconUpload = (req, res, next) => {
  groupIconUpload.single('icon')(req, res, (error) => {
    if (!error) return next();
    return res.status(400).json({ message: error.message });
  });
};

const parseIdArray = (value) => {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return String(value).split(',').map((item) => item.trim()).filter(Boolean);
  }
};

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const imageMimeByExtension = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

const resolveRoomIcon = async (roomIcon) => {
  if (!roomIcon) return null;
  if (/^https?:\/\//i.test(roomIcon)) return roomIcon;
  try {
    return await getSignedUrl(
      process.env.SUPABASE_BUCKET_CHAT || process.env.SUPABASE_BUCKET_COMMUNITY,
      roomIcon
    );
  } catch (error) {
    console.error('Room icon signing failed:', error.message);
    return null;
  }
};

const serializeRoom = async ({ room, userId, unreadCount = 0, socketManager, resolveAvatar }) => {
  const participants = await Promise.all((room.participants || []).map(async (participant) => ({
    ...participant,
    profilePhoto: await resolveAvatar(participant.profilePhoto),
    isOnline: Boolean(socketManager?.isUserOnline(participant._id)),
  })));
  let lastMessage = room.lastMessage || null;
  if (lastMessage?.sender?.firstName !== undefined) {
    lastMessage = {
      ...lastMessage,
      sender: {
        ...lastMessage.sender,
        profilePhoto: await resolveAvatar(lastMessage.sender.profilePhoto),
      },
    };
  }
  const otherParticipant = room.type === 'direct'
    ? participants.find((participant) => participant._id.toString() !== userId.toString()) || null
    : null;
  const project = room.projectId && typeof room.projectId === 'object'
    ? { _id: room.projectId._id, title: room.projectId.title, stage: room.projectId.stage }
    : null;
  const displayName = room.type === 'direct'
    ? [otherParticipant?.firstName, otherParticipant?.lastName].filter(Boolean).join(' ') || 'Direct message'
    : room.name;

  return {
    ...room,
    roomIcon: undefined,
    projectId: project?._id || room.projectId || null,
    project,
    participants,
    lastMessage,
    displayName,
    displayPhoto: room.type === 'direct'
      ? otherParticipant?.profilePhoto || null
      : await resolveRoomIcon(room.roomIcon),
    otherParticipant,
    unreadCount,
    memberCount: participants.length,
    memberPreview: participants.slice(0, 3),
    firstMembers: participants.slice(0, 3),
    memberNames: participants.slice(0, 3).map((participant) => participant.firstName).filter(Boolean),
  };
};

const isParticipant = (room, userId) =>
  room.participants.some((participant) => participant.toString() === userId.toString());

// @desc Get all rooms for a user
const getUserRooms = async (req, res) => {
  try {
    const userId = req.user.id;
    const rooms = await ChatRoom.find({
      participants: userId
    })
    .populate('participants', 'firstName lastName profilePhoto email role')
    .populate({
      path: 'lastMessage',
      populate: { path: 'sender', select: 'firstName lastName profilePhoto email role' },
    })
    .populate('projectId', 'title stage')
    .sort('-lastMessageAt')
    .lean();

    const unreadRows = await UnreadMessage.find({
      room: { $in: rooms.map((room) => room._id) },
      user: userId,
    }).select('room count').lean();
    const unreadByRoom = new Map(unreadRows.map((row) => [row.room.toString(), row.count]));
    const resolveAvatar = createAvatarResolver();
    const socketManager = req.app.get('socketManager');
    const roomsWithUnread = await Promise.all(rooms.map((room) => serializeRoom({
      room,
      userId,
      unreadCount: unreadByRoom.get(room._id.toString()) || 0,
      socketManager,
      resolveAvatar,
    })));

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

    if (!mongoose.isValidObjectId(userId)) {
      return res.status(400).json({ message: 'Invalid user ID' });
    }
    if (userId === currentUserId) {
      return res.status(400).json({ message: 'Cannot create a direct room with yourself' });
    }

    const targetUser = await User.findOne({
      _id: userId,
      isActive: { $ne: false },
      isSuspended: { $ne: true },
    }).select('firstName lastName');
    if (!targetUser) return res.status(404).json({ message: 'Target user not found' });

    let room = await ChatRoom.findOne({
      type: 'direct',
      participants: { $all: [currentUserId, userId], $size: 2 }
    });

    if (!room) {
      const currentUser = await User.findById(currentUserId).select('firstName lastName');
      const orderedNames = [currentUser, targetUser]
        .sort((a, b) => a._id.toString().localeCompare(b._id.toString()))
        .map((user) => user.firstName || user.lastName || 'User');
      room = await ChatRoom.create({
        name: orderedNames.join(' & '),
        type: 'direct',
        participants: [currentUserId, userId],
        admins: [currentUserId, userId]
      });
    }

    const populatedRoom = await ChatRoom.findById(room._id)
      .populate('participants', 'firstName lastName profilePhoto email role')
      .populate({
        path: 'lastMessage',
        populate: { path: 'sender', select: 'firstName lastName profilePhoto email role' },
      })
      .lean();
    const response = await serializeRoom({
      room: populatedRoom,
      userId: currentUserId,
      socketManager: req.app.get('socketManager'),
      resolveAvatar: createAvatarResolver(),
    });
    res.json(response);
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

    if (!mongoose.isValidObjectId(roomId)) {
      return res.status(400).json({ message: 'Invalid room ID' });
    }

    const room = await ChatRoom.findById(roomId);
    if (!room) return res.status(404).json({ message: 'Room not found' });
    if (!isParticipant(room, userId)) {
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

    const resolveAvatar = createAvatarResolver();
    const socketManager = req.app.get('socketManager');
    const resolvedMessages = await Promise.all(messages.reverse().map(async (message) => ({
      ...message,
      sender: message.sender ? {
        ...message.sender,
        profilePhoto: await resolveAvatar(message.sender.profilePhoto),
      } : null,
    })));
    const participantWithRoles = await Promise.all(participants.map(async (participant) => ({
      ...participant,
      profilePhoto: await resolveAvatar(participant.profilePhoto),
      roleInProject: room.participantRoles.get(participant._id.toString()) || participant.role || 'Member',
      isOnline: Boolean(socketManager?.isUserOnline(participant._id)),
    })));

    res.json({
      messages: resolvedMessages,
      participants: participantWithRoles,
      roomDetails: {
        name: room.name,
        description: room.description,
        type: room.type,
        projectId: room.projectId,
        displayPhoto: await resolveRoomIcon(room.roomIcon),
        memberCount: participantWithRoles.length,
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
    if (!isParticipant(room, userId)) {
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

    let populatedMessage = await Message.findById(message._id)
      .populate('sender', 'firstName lastName profilePhoto email role')
      .lean();

    if (populatedMessage.sender) {
      populatedMessage = {
        ...populatedMessage,
        sender: {
          ...populatedMessage.sender,
          profilePhoto: await createAvatarResolver()(populatedMessage.sender.profilePhoto),
        },
      };
    }

    await sendChatMessagePush({ recipientIds: participants, message: populatedMessage, room });
    const socketManager = req.app.get('socketManager');
    if (socketManager) socketManager.io.to(`room:${roomId}`).emit('new-message', populatedMessage);

    res.status(201).json({ message: populatedMessage, roomId });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc Create group
const createGroup = async (req, res) => {
  let uploadedIcon = null;
  let uploadedBucket = null;
  try {
    const { name, projectId, description = '' } = req.body;
    const groupType = req.body.groupType || (projectId ? 'project_group' : 'open_group');
    const participantIds = parseIdArray(req.body.participantIds);
    const userId = req.user.id;
    if (!name?.trim() || name.trim().length > 100) {
      return res.status(400).json({ message: 'Room name is required and must not exceed 100 characters' });
    }
    if (description.length > 500) return res.status(400).json({ message: 'Description must not exceed 500 characters' });
    if (!['open_group', 'project_group'].includes(groupType)) {
      return res.status(400).json({ message: 'groupType must be open_group or project_group' });
    }
    if (participantIds.some((id) => !mongoose.isValidObjectId(id))) {
      return res.status(400).json({ message: 'participantIds contains an invalid user ID' });
    }

    const participantRoles = new Map();
    if (groupType === 'project_group') {
      if (!mongoose.isValidObjectId(projectId)) {
        return res.status(400).json({ message: 'A valid projectId is required for a project group' });
      }
      const project = await Project.findById(projectId).lean();
      if (!project) return res.status(404).json({ message: 'Project not found' });
      const projectMemberIds = [project.owner, ...project.teamMembers].map(String);
      if (!projectMemberIds.includes(userId.toString())) {
        return res.status(403).json({ message: 'You must be a member of this project' });
      }
      if (participantIds.some((id) => !projectMemberIds.includes(String(id)))) {
        return res.status(400).json({ message: 'Project groups can include only project team members' });
      }
      const applications = await Application.find({
        project: projectId,
        applicant: { $in: [...participantIds, userId] },
        status: 'ACCEPTED',
      }).select('applicant role').lean();
      applications.forEach((application) => {
        participantRoles.set(application.applicant.toString(), application.role);
      });
      participantRoles.set(project.owner.toString(), req.user.role || 'Owner');
    } else if (projectId) {
      return res.status(400).json({ message: 'projectId is only valid for a project group' });
    }

    const participants = [...new Set([userId.toString(), ...participantIds.map(String)])];
    if (participants.length < 2) return res.status(400).json({ message: 'Select at least one other member' });
    const validUsers = await User.find({
      _id: { $in: participants },
      isActive: { $ne: false },
      isSuspended: { $ne: true },
    }).select('_id').lean();
    if (validUsers.length !== participants.length) {
      return res.status(400).json({ message: 'One or more selected users are unavailable' });
    }

    const roomId = new mongoose.Types.ObjectId();
    let roomIcon = null;
    if (req.file) {
      uploadedBucket = process.env.SUPABASE_BUCKET_CHAT || process.env.SUPABASE_BUCKET_COMMUNITY;
      if (!uploadedBucket) return res.status(503).json({ message: 'Chat media storage is not configured' });
      const extension = path.extname(req.file.originalname).toLowerCase();
      roomIcon = `rooms/${roomId}/icon_${Date.now()}${extension}`;
      await uploadFile(uploadedBucket, roomIcon, req.file.buffer, imageMimeByExtension[extension]);
      uploadedIcon = roomIcon;
    }

    const room = await ChatRoom.create({
      _id: roomId,
      name: name.trim(),
      description: description.trim(),
      roomIcon,
      type: groupType,
      participants,
      admins: [userId],
      projectId: groupType === 'project_group' ? projectId : null,
      participantRoles,
      isPrivate: groupType === 'project_group',
      lastMessageAt: new Date()
    });
    const populatedRoom = await ChatRoom.findById(room._id)
      .populate('participants', 'firstName lastName profilePhoto email role')
      .populate('projectId', 'title stage')
      .lean();
    const response = await serializeRoom({
      room: populatedRoom,
      userId,
      socketManager: req.app.get('socketManager'),
      resolveAvatar: createAvatarResolver(),
    });
    res.status(201).json({ message: 'Group created successfully', room: response });
  } catch (error) {
    if (uploadedIcon && uploadedBucket) {
      await deleteFile(uploadedBucket, uploadedIcon).catch((cleanupError) => {
        console.error('Room icon cleanup failed:', cleanupError.message);
      });
    }
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc Search eligible users for the existing New Room screen
const getGroupCandidates = async (req, res) => {
  try {
    const { groupType = 'open_group', projectId, search = '', page = 1, limit = 20 } = req.query;
    if (!['open_group', 'project_group'].includes(groupType)) {
      return res.status(400).json({ message: 'groupType must be open_group or project_group' });
    }
    const parsedPage = Math.max(1, Number.parseInt(page, 10) || 1);
    const parsedLimit = Math.min(50, Math.max(1, Number.parseInt(limit, 10) || 20));
    const filter = {
      _id: { $ne: req.user._id },
      isActive: { $ne: false },
      isSuspended: { $ne: true },
      onboardingStep: { $gte: 3 },
    };
    let project = null;
    if (groupType === 'project_group') {
      if (!mongoose.isValidObjectId(projectId)) {
        return res.status(400).json({ message: 'A valid projectId is required for project candidates' });
      }
      project = await Project.findById(projectId).select('owner teamMembers').lean();
      if (!project) return res.status(404).json({ message: 'Project not found' });
      const projectMembers = [project.owner, ...project.teamMembers].map(String);
      if (!projectMembers.includes(req.user._id.toString())) {
        return res.status(403).json({ message: 'You must be a member of this project' });
      }
      filter._id = { $in: projectMembers.filter((id) => id !== req.user._id.toString()) };
    }
    if (search.trim()) {
      const query = new RegExp(escapeRegex(search.trim()), 'i');
      filter.$or = [{ firstName: query }, { lastName: query }, { role: query }];
    }
    const [users, total] = await Promise.all([
      User.find(filter)
        .select('firstName lastName profilePhoto role')
        .sort('firstName lastName')
        .skip((parsedPage - 1) * parsedLimit)
        .limit(parsedLimit)
        .lean(),
      User.countDocuments(filter),
    ]);
    if (groupType === 'project_group' && users.length) {
      const roles = await Application.find({
        project: projectId,
        applicant: { $in: users.map((user) => user._id) },
        status: 'ACCEPTED',
      }).select('applicant role').lean();
      const roleByUser = new Map(roles.map((item) => [item.applicant.toString(), item.role]));
      users.forEach((user) => {
        if (user._id.toString() !== project.owner.toString()) {
          user.role = roleByUser.get(user._id.toString()) || null;
        }
      });
    }
    const resolveAvatar = createAvatarResolver();
    const socketManager = req.app.get('socketManager');
    const resolvedUsers = await Promise.all(users.map(async (user) => ({
      ...user,
      profilePhoto: await resolveAvatar(user.profilePhoto),
      isOnline: Boolean(socketManager?.isUserOnline(user._id)),
    })));
    return res.json({
      users: resolvedUsers,
      pagination: {
        page: parsedPage,
        limit: parsedLimit,
        total,
        pages: Math.ceil(total / parsedLimit),
      },
    });
  } catch (error) {
    console.error('Get group candidates failed:', error.message);
    return res.status(500).json({ message: 'Server error' });
  }
};

// @desc Get call room
const getCallRoom = async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user.id;

    const room = await ChatRoom.findById(roomId);
    if (!room) return res.status(404).json({ message: 'Room not found' });
    if (!isParticipant(room, userId)) {
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
  getCallRoom,
  getGroupCandidates,
  handleGroupIconUpload,
};
