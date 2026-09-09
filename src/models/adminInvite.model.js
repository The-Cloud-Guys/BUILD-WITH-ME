const mongoose = require('mongoose');

const {
  ADMIN_PERMISSIONS,
  ADMIN_ROLES,
} = require('../constants/admin.constants');

const adminInviteSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    firstName: {
      type: String,
      trim: true,
      default: '',
    },
    lastName: {
      type: String,
      trim: true,
      default: '',
    },
    role: {
      type: String,
      enum: ADMIN_ROLES,
      required: true,
    },
    permissions: [{
      type: String,
      enum: ADMIN_PERMISSIONS,
    }],
    tokenHash: {
      type: String,
      required: true,
      unique: true,
      select: false,
    },
    invitedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AdminAccount',
      required: true,
    },
    existingAdmin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AdminAccount',
      default: null,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    acceptedAt: {
      type: Date,
      default: null,
    },
    revokedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

adminInviteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
adminInviteSchema.index({ email: 1, acceptedAt: 1, revokedAt: 1 });

module.exports = mongoose.model('AdminInvite', adminInviteSchema);
