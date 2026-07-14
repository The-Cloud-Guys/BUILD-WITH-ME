const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema(
  {
    reporter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    post: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Post',
      required: true,
    },
    reason: {
      type: String,
      maxlength: 500,
      default: '',
    },
  },
  { timestamps: true }
);

reportSchema.index({ reporter: 1, post: 1 }, { unique: true });

module.exports = mongoose.model('Report', reportSchema);