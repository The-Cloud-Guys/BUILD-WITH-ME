const mongoose = require('mongoose');

const {
  ADMIN_AUTH_METHODS,
  ADMIN_PERMISSIONS,
  ADMIN_ROLES,
} = require('../constants/admin.constants');

const adminAccountSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: [true, 'Please add an admin email'],
      unique: true,
      lowercase: true,
      trim: true,
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
      default: 'admin',
    },
    permissions: [{
      type: String,
      enum: ADMIN_PERMISSIONS,
    }],
    authMethods: [{
      type: String,
      enum: ADMIN_AUTH_METHODS,
    }],
    firebaseUid: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    emailVerified: {
      type: Boolean,
      default: false,
    },
    mfaEnabled: {
      type: Boolean,
      default: false,
    },
    mfaSecretEncrypted: {
      type: String,
      select: false,
      default: null,
    },
    mfaPendingSecretEncrypted: {
      type: String,
      select: false,
      default: null,
    },
    tokenVersion: {
      type: Number,
      default: 0,
      min: 0,
    },
    bootstrapOwner: {
      type: Boolean,
      default: false,
      select: false,
    },
    migrationPending: {
      type: Boolean,
      default: false,
    },
    addedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AdminAccount',
      default: null,
    },
    legacyUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      unique: true,
      sparse: true,
      default: null,
    },
    lastLoginAt: {
      type: Date,
      default: null,
    },
    lastActivityAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

adminAccountSchema.virtual('fullName').get(function getFullName() {
  return `${this.firstName} ${this.lastName}`.trim();
});

adminAccountSchema.index({ role: 1, isActive: 1 });
adminAccountSchema.index(
  { bootstrapOwner: 1 },
  {
    unique: true,
    partialFilterExpression: { bootstrapOwner: true },
  }
);

adminAccountSchema.set('toJSON', {
  virtuals: true,
  transform: (_document, result) => {
    delete result.bootstrapOwner;
    delete result.tokenVersion;
    return result;
  },
});

module.exports = mongoose.model('AdminAccount', adminAccountSchema);
