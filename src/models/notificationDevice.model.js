const mongoose = require('mongoose');

const notificationDeviceSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    token: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      maxlength: 4096,
    },
    platform: {
      type: String,
      enum: ['android', 'ios', 'web'],
      required: true,
    },
    deviceId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    appVersion: {
      type: String,
      default: null,
      trim: true,
      maxlength: 50,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    lastSeenAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

notificationDeviceSchema.index({ user: 1, deviceId: 1 }, { unique: true });
notificationDeviceSchema.index({ user: 1, isActive: 1 });

module.exports = mongoose.model('NotificationDevice', notificationDeviceSchema);
