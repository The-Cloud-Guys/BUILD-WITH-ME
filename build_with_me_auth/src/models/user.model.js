const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const userSchema = new mongoose.Schema(
  {
    // =========================
    // Authentication
    // =========================
    email: {
      type: String,
      required: [true, 'Please add an email'],
      unique: true,
      lowercase: true,
      trim: true,
    },

    password: {
      type: String,
      required: [true, 'Please add a password'],
      minlength: 6,
      select: false,
    },

    // =========================
    // Onboarding / Profile
    // =========================
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

    bio: {
      type: String,
      maxlength: [500, 'Bio cannot exceed 500 characters'],
      default: '',
    },

    profilePhoto: {
      type: String,
      default: null,
    },

    // External link (GitHub / Portfolio / LinkedIn etc.)
    externalLink: {
      type: String,
      trim: true,
      default: '',
      validate: {
        validator: function (v) {
          if (!v) return true;
          return /^https?:\/\/.+/.test(v);
        },
        message: 'External link must be a valid URL starting with http:// or https://',
      },
    },

    // =========================
    // Role & Skills
    // =========================
   role: {
  type: String,
  default: null,
  // Validation of allowed roles is done in onboarding.controller.js
},

    skills: {
      type: [String],
      default: [],
    },

    // =========================
    // Onboarding Progress
    // =========================
    /**
     * 0 = Email verified (entry point to onboarding)
     * 1 = Role completed
     * 2 = Skills completed
     * 3 = Profile completed
     */
    onboardingStep: {
      type: Number,
      default: 0,
      min: 0,
      max: 3,
    },

    // =========================
    // Email Verification
    // =========================
emailVerified: {
  type: Boolean,
  default: false,
},
emailVerificationOTP: {
  type: String,
  default: null,
},
emailVerificationExpires: {
  type: Date,
  default: null,
},


// =========================
// Password Reset (OTP based)
// =========================
resetPasswordOTP: {
  type: String,
  default: null,
},
resetPasswordExpires: {
  type: Date,
  default: null,
},


    // =========================
    // Firebase / Social Auth
    // =========================
    firebaseUid: {
      type: String,
      unique: true,
      sparse: true,
    },

    providers: {
      type: [String],
      enum: ['local', 'google', 'facebook', 'apple', 'github'],
      default: ['local'],
    },

    // =========================
    // Refresh Token
    // =========================
    refreshToken: {
      type: String,
      select: false,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual: full name
userSchema.virtual('fullName').get(function () {
  return `${this.firstName} ${this.lastName}`.trim();
});

// Hash password before saving
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare password
userSchema.methods.matchPassword = async function (enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password);
};



module.exports = mongoose.model('User', userSchema);