const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    type: {
  type: String,
  enum: [
    'PROJECT_MATCH',
    'APPLICATION_STATUS',
    'NEW_APPLICATION',
    'ROLE_FILLED',
    'TEAM_REMOVED',
    'SYSTEM_ANNOUNCEMENT',
  ],
  required: true,
},
    message: {
      type: String,
      required: true,
    },
    relatedProject: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      default: null,
    },
    relatedApplication: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Application',
      default: null,
    },
    read: {
      type: Boolean,
      default: false,
    },
    dismissed: {
    type: Boolean,
    default: false,
},
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Notification', notificationSchema);