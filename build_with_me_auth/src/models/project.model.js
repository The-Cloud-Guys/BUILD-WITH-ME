const mongoose = require('mongoose');

const roleSchema = new mongoose.Schema({
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
}, { _id: false });

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
      required: true,
    },
    techStack: {
      type: [String],
      required: true,
    },
    stage: {
      type: String,
      enum: ['IDEA', 'PROTOTYPE', 'MVP'],
      required: true,
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
    roles: [roleSchema],
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual to compute total developers needed
projectSchema.virtual('totalDevelopersNeeded').get(function () {
  return this.roles.reduce((sum, role) => sum + role.requiredCount, 0);
});

module.exports = mongoose.model('Project', projectSchema);