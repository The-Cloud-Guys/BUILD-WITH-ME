const mongoose = require('mongoose');
const { Message } = require('../models/chat.model');

const replyPopulate = {
  path: 'replyTo',
  select: 'content media mediaType isDeleted sender',
  populate: {
    path: 'sender',
    select: 'firstName lastName',
  },
};

const createReplyValidationError = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
};

const validateReplyTarget = async ({ replyTo, roomId }) => {
  if (replyTo == null || replyTo === '') return null;
  if (!mongoose.isValidObjectId(replyTo)) {
    throw createReplyValidationError('Invalid replyTo message ID');
  }

  const target = await Message.findOne({
    _id: replyTo,
    room: roomId,
  }).select('_id isDeleted').lean();

  if (!target) {
    throw createReplyValidationError('Reply message was not found in this room');
  }
  if (target.isDeleted) {
    throw createReplyValidationError('You cannot reply to a deleted message');
  }
  return target._id;
};

const populateReplyTo = (query) => query.populate(replyPopulate);

const serializeReplyTo = (message) => {
  if (!message) return message;
  const replyTo = message.replyTo || null;
  if (!replyTo || typeof replyTo !== 'object') {
    return { ...message, replyTo: null };
  }
  if (!replyTo.isDeleted) return { ...message, replyTo };

  return {
    ...message,
    replyTo: {
      ...replyTo,
      content: '',
      media: [],
      mediaType: null,
      isDeleted: true,
    },
  };
};

module.exports = {
  populateReplyTo,
  replyPopulate,
  serializeReplyTo,
  validateReplyTarget,
};
