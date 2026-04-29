const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Please add a name'],
      trim: true,
    },

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

    //  Password Reset
    resetPasswordToken: String,
    resetPasswordExpires: Date,

    //  Firebase / Social Auth
    firebaseUid: {
      type: String,
      unique: true,
      sparse: true, // allows multiple nulls
    },


providers: {
  type: [String],
  enum: ['local', 'google', 'facebook', 'apple', 'github'],
  default: ['local']
},

    //  Email Verification
    emailVerified: {
      type: Boolean,
      default: false,
    },

   emailVerificationOTP: String,
    emailVerificationExpires: Date,

    // 🔁 Refresh Token (hashed)
    refreshToken: {
      type: String,
      select: false,
    },
  },
  { timestamps: true }
);

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

userSchema.methods.generateResetToken = function () {
  const resetToken = crypto.randomBytes(32).toString('hex');

  this.resetPasswordToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');

  this.resetPasswordExpires = Date.now() + 10 * 60 * 1000; // 10 mins

  return resetToken;
};


module.exports = mongoose.model('User', userSchema);