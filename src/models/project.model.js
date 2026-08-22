const mongoose = require('mongoose');

const roleSchema = new mongoose.Schema(
  {
    roleName: {
      type: String,
      required: true,
      trim: true,
    },
    requiredCount: {
      type: Number,
      required: true,
      min: 1,
    },
    currentCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    description: {
      type: String,
      default: '',
      trim: true,
    },
  },
  {
    _id: false,
  }
);

const projectSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },
    requiredSkills: {
      type: [String],
      default: [],
    },
    techStack: {
      type: [String],
      default: [],
    },
    stage: {
      type: String,
      enum: ['IDEA', 'IDEATION', 'PROTOTYPE', 'MVP', 'BETA', 'PRODUCTION'],
      default: 'IDEA',
    },
    status: {
      type: String,
      enum: ['OPEN', 'ACTIVE', 'CLOSED', 'COMPLETED'],
      default: 'OPEN',
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    teamMembers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    roles: {
      type: [roleSchema],
      default: [],
    },
    views: {
      type: Number,
      default: 0,
      min: 0,
    },
    isHidden: {
      type: Boolean,
      default: false,
    },
    isFlagged: {
      type: Boolean,
      default: false,
    },
    reviewed: {
      type: Boolean,
      default: false,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    reviewNotes: {
      type: String,
      default: '',
    },
    reviewStatus: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

projectSchema.virtual('totalDevelopersNeeded').get(function () {
  return this.roles.reduce((sum, role) => sum + role.requiredCount, 0);
});

module.exports = mongoose.model('Project', projectSchema);