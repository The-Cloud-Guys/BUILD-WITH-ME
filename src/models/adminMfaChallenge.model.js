const mongoose = require('mongoose');

const adminMfaChallengeSchema = new mongoose.Schema(
  {
    admin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AdminAccount',
      required: true,
      index: true,
    },
    jtiHash: {
      type: String,
      required: true,
      unique: true,
      select: false,
    },
    authMethod: {
      type: String,
      enum: ['password', 'google', 'microsoft'],
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    usedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

adminMfaChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('AdminMfaChallenge', adminMfaChallengeSchema);
