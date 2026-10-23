const mongoose = require('mongoose');

const pollVoteSchema = new mongoose.Schema({
  post: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Post',
    required: true,
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  optionId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
  },
}, { timestamps: true });

pollVoteSchema.index({ post: 1, user: 1 }, { unique: true });
pollVoteSchema.index({ post: 1, optionId: 1 });

module.exports = mongoose.model('PollVote', pollVoteSchema);
