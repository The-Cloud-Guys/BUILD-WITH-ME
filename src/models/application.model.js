const mongoose = require('mongoose');

const applicationSchema = new mongoose.Schema(
  {
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
    },
    applicant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    role: {
      type: String,
      required: true, // the specific role name the applicant applies for
    },
    message: {
      type: String,
      required: true,
      maxlength: 1000,
    },
    portfolioLink: {
      type: String,
      trim: true,
      default: '',
    },
    cvPath: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: ['PENDING', 'ACCEPTED', 'REJECTED'],
      default: 'PENDING',
    },
  },
  {
    timestamps: true,
  }
);

applicationSchema.index({ project: 1, applicant: 1 }, { unique: true });

module.exports = mongoose.model('Application', applicationSchema);