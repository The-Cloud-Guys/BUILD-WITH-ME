const mongoose = require('mongoose');

const pollOptionSchema = new mongoose.Schema({
  text: { type: String, required: true, trim: true, maxlength: 200 },
  voteCount: { type: Number, default: 0, min: 0 },
}, { _id: true });

const pollSchema = new mongoose.Schema({
  question: { type: String, required: true, trim: true, maxlength: 500 },
  options: {
    type: [pollOptionSchema],
    validate: {
      validator: (options) => options.length >= 2 && options.length <= 10,
      message: 'A poll must have between 2 and 10 options',
    },
  },
  expiresAt: { type: Date, required: true },
  totalVotes: { type: Number, default: 0, min: 0 },
}, { _id: false });

const postSchema = new mongoose.Schema(
  {
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    content: {
      type: String,
      default: '',
      maxlength: 1000,
    },
    postType: {
      type: String,
      enum: ['text', 'code', 'link', 'poll', 'photo'],
      default: 'text',
      index: true,
    },
    code: {
      type: new mongoose.Schema({
        language: { type: String, required: true, trim: true, maxlength: 50 },
        snippet: { type: String, required: true, maxlength: 20000 },
      }, { _id: false }),
      default: null,
    },
    link: {
      type: new mongoose.Schema({
        url: { type: String, required: true, trim: true },
        title: { type: String, trim: true, maxlength: 300, default: '' },
        description: { type: String, maxlength: 1000, default: '' },
        previewImage: { type: String, trim: true, default: '' },
      }, { _id: false }),
      default: null,
    },
    poll: {
      type: pollSchema,
      default: null,
    },
    tags: {
      type: [String],
      default: [],
    },
    media: {
      type: [String], // URLs from Supabase
      default: [],
    },
    likeCount: {
      type: Number,
      default: 0,
    },
    commentCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    isHidden: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Post', postSchema);
