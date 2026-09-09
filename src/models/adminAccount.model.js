const mongoose = require('mongoose');

const {
  ADMIN_AUTH_METHODS,
  ADMIN_PERMISSIONS,
  ADMIN_ROLES,
} = require('../constants/admin.constants');

const ssoIdentitySchema = new mongoose.Schema(
  {
    provider: {
      type: String,
      enum: ['google', 'microsoft'],
      required: true,
    },
    subject: {
      type: String,
      required: true,
      trim: true,
    },
  },
  { _id: false }
);

const adminAccountSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: [true, 'Please add an admin email'],
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      select: false,
      default: null,
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
    ssoIdentities: {
      type: [ssoIdentitySchema],
      default: [],
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
  { 'ssoIdentities.provider': 1, 'ssoIdentities.subject': 1 },
  { unique: true, sparse: true }
);
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
    delete result.passwordHash;
    delete result.bootstrapOwner;
    delete result.tokenVersion;
    return result;
  },
});

module.exports = mongoose.model('AdminAccount', adminAccountSchema);
