const mongoose = require('mongoose');

const projectSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Please add a project title'],
      trim: true,
      maxlength: [100, 'Title cannot exceed 100 characters'],
    },
    description: {
      type: String,
      required: [true, 'Please add a project description'],
      trim: true,
      maxlength: [2000, 'Description cannot exceed 2000 characters'],
    },
    requiredSkills: {
      type: [String],
      required: [true, 'Please specify required skills'],
      validate: {
        validator: (v) => Array.isArray(v) && v.length > 0,
        message: 'At least one required skill is needed',
      },
    },
    techStack: {
      type: [String],
      required: [true, 'Please specify tech stack'],
      validate: {
        validator: (v) => Array.isArray(v) && v.length > 0,
        message: 'At least one technology is needed',
      },
    },
    stage: {
      type: String,
      enum: ['IDEA', 'PROTOTYPE', 'MVP'],
      required: true,
      default: 'IDEA',
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
    developersNeeded: {
      type: Number,
      required: true,
      min: 1,
      max: 50,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual to get current team size (owner + members)
projectSchema.virtual('currentTeamSize').get(function () {
  return 1 + (this.teamMembers ? this.teamMembers.length : 0);
});

module.exports = mongoose.model('Project', projectSchema);