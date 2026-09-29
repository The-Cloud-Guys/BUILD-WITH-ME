const mongoose = require('mongoose');

const callSessionSchema = new mongoose.Schema(
  {
    room: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ChatRoom',
      required: true,
      index: true,
    },
    caller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    recipients: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    recipientResponses: [{
      user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
      status: { type: String, enum: ['pending', 'accepted', 'declined'], default: 'pending' },
      respondedAt: { type: Date, default: null },
    }],
    callType: {
      type: String,
      enum: ['audio', 'video'],
      required: true,
    },
    status: {
      type: String,
      enum: ['ringing', 'accepted', 'declined', 'missed', 'cancelled', 'ended'],
      default: 'ringing',
      index: true,
    },
    answeredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    answeredAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
  },
  { timestamps: true }
);

callSessionSchema.index({ room: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('CallSession', callSessionSchema);
