const User = require('../models/user.model');
const PendingRegistration = require('../models/pendingRegistration.model');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const axios = require('axios');
const bcrypt = require('bcryptjs');

const {
  registerValidation,
  loginValidation,
  forgotPasswordValidation,
  verifyResetOtpValidation,  
  resetPasswordValidation,
  verifyEmailValidation,
  resendOTPValidation,
} = require('../validation/auth.validation');

const { verifyFirebaseToken } = require('../services/firebase.service');
const { generateNumericOTP, hashOTP } = require('../utils/otp.util');
const { getOnboardingStatus } = require('../utils/onboardingStatus');
const { getSignedUrl } = require('../services/supabase.service');

const {
  issueTokenPair,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllUserSessions,
} = require('../services/authSession.service');

// ==============================
// COOKIE HELPER
// ==============================

const setAuthCookies = (res, accessToken, refreshToken) => {
  const isProduction = process.env.NODE_ENV === 'production';

  const sharedOptions = {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    path: '/',
  };

  res.cookie('accessToken', accessToken, {
    ...sharedOptions,
    maxAge: 5 * 60 * 60 * 1000, // 5 hours
  });

  res.cookie('refreshToken', refreshToken, {
    ...sharedOptions,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
};

// ==============================
// TOKEN HELPERS (KEPT)
// ==============================

// ==============================
// EMAIL SETUP (KEPT)
// ==============================

const sendEmail = async ({ email, subject, html }) => {
  try {
    const response = await axios.post(
      'https://api.brevo.com/v3/smtp/email',
      {
        sender: {
          email: process.env.EMAIL_FROM,
          name: 'Build With Me',
        },
        to: [{ email }],
        subject,
        htmlContent: html,
      },
      {
        headers: {
          'api-key': process.env.BREVO_API_KEY,
          'Content-Type': 'application/json',
        },
      }
    );
    return response.data;
  } catch (error) {
    console.error('Brevo email error:', error.response?.data || error.message);
    throw new Error('Email sending failed');
  }
};

// ==============================
// OTP HELPERS (KEPT - for password reset)
// ==============================

const OTP = require('../models/otp.model');

const generateAndStoreOTP = async (email, type) => {
  // Delete any existing OTP for this email and type
  await OTP.deleteMany({ email, type });

  const otp = generateNumericOTP(6);
  const hashedOTP = hashOTP(otp);
  
  const otpDoc = await OTP.create({
    email,
    otp: hashedOTP,
    type,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
  });

  return { otp, otpDoc };
};

const verifyOTP = async (email, otp, type) => {
  const otpDoc = await OTP.findOne({ 
    email, 
    type,
    expiresAt: { $gt: new Date() }
  });

  if (!otpDoc) {
    return { valid: false, message: 'OTP not found or expired' };
  }

  if (hashOTP(otp) !== otpDoc.otp) {
    return { valid: false, message: 'Invalid OTP' };
  }

  // Delete OTP after successful verification
  await OTP.deleteOne({ _id: otpDoc._id });
  return { valid: true, otpDoc };
};

const cleanupExpiredOTPs = async () => {
  await OTP.deleteMany({ expiresAt: { $lt: new Date() } });
};

// ==============================
// REGISTER (UPDATED)
// ==============================

const register = async (req, res) => {
  try {
    if (req.body.email) req.body.email = req.body.email.toLowerCase().trim();

    const { error } = registerValidation(req.body);
    if (error) {
      return res.status(400).json({ message: error.details[0].message });
    }

    const { email, password } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'Email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const otp = generateNumericOTP(6);
    const otpHash = hashOTP(otp);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    // Re-registering replaces pending credentials + OTP, invalidating the old OTP.
    await PendingRegistration.findOneAndUpdate(
      { email },
      {
        $set: {
          passwordHash,
          otpHash,
          attempts: 0,
          lastSentAt: new Date(),
          expiresAt,
        },
      },
      {
        upsert: true,
        new: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      }
    );

    await sendEmail({
      email,
      subject: 'Verify Your Email',
      html: `<p>Your OTP is <b>${otp}</b>. It expires in 10 minutes.</p>`,
    });

    return res.status(201).json({
      message: 'Registration successful. Verify OTP sent.',
      email,
    });
  } catch (error) {
    console.error('Register error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ==============================
// VERIFY EMAIL (UPDATED)
// ==============================

const verifyEmail = async (req, res) => {
  try {
    if (req.body.email) req.body.email = req.body.email.toLowerCase().trim();

    const { error } = verifyEmailValidation(req.body);
    if (error) {
      return res.status(400).json({ message: error.details[0].message });
    }

    const { email, otp } = req.body;

    const pending = await PendingRegistration.findOne({ email })
      .select('+passwordHash +otpHash');

    if (!pending) {
      return res.status(400).json({
        message: 'Registration expired or not found. Please register again.',
      });
    }

    if (pending.expiresAt <= new Date()) {
      await PendingRegistration.deleteOne({ _id: pending._id });
      return res.status(400).json({
        message: 'OTP expired. Please register again.',
      });
    }

    if (hashOTP(otp) !== pending.otpHash) {
      pending.attempts += 1;
      await pending.save();
      return res.status(400).json({ message: 'Invalid OTP' });
    }

    let user = await User.findOne({ email });

    if (!user) {
      user = new User({
        email,
        password: pending.passwordHash,
        emailVerified: true,
        onboardingStep: 0,
        providers: ['local'],
      });

      user.$locals.passwordAlreadyHashed = true;
      await user.save();
    }

    await PendingRegistration.deleteOne({ _id: pending._id });

    const { accessToken, refreshToken } = await issueTokenPair(user, req);
    user.lastLogin = new Date();
    await user.save();
    setAuthCookies(res, accessToken, refreshToken);

    return res.json({
      message: 'Email verified successfully',
      accessToken,
      refreshToken,
      user: {
        _id: user._id,
        email: user.email,
        role: user.role,
        onboardingStep: user.onboardingStep,
        onboardingCompleted: user.onboardingCompleted,
      },
      onboardingCompleted: user.onboardingCompleted,
      onboardingStatus: getOnboardingStatus(user.onboardingStep),
    });
  } catch (error) {
    console.error('Verify email error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ==============================
// RESEND VERIFICATION OTP (UPDATED)
// ==============================

const resendVerificationOTP = async (req, res) => {
  try {
    if (req.body.email) req.body.email = req.body.email.toLowerCase().trim();

    const { error } = resendOTPValidation(req.body);
    if (error) {
      return res.status(400).json({ message: error.details[0].message });
    }

    const { email } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        message: 'Email is already registered. Please login.',
      });
    }

    const pending = await PendingRegistration.findOne({ email })
      .select('+passwordHash +otpHash');

    if (!pending || pending.expiresAt <= new Date()) {
      if (pending) await PendingRegistration.deleteOne({ _id: pending._id });
      return res.status(400).json({
        message: 'Registration expired. Please register again.',
      });
    }

    const otp = generateNumericOTP(6);

    pending.otpHash = hashOTP(otp);
    pending.attempts = 0;
    pending.lastSentAt = new Date();
    pending.expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await pending.save();

    await sendEmail({
      email,
      subject: 'Resend OTP',
      html: `<p>Your new OTP is <b>${otp}</b>. It expires in 10 minutes.</p>`,
    });

    return res.json({ message: 'New OTP sent to your email.' });
  } catch (error) {
    console.error('Resend verification error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ==============================
// RESEND RESET PASSWORD OTP (KEPT)
// ==============================

const resendResetPasswordOTP = async (req, res) => {
  try {
    if (req.body.email) req.body.email = req.body.email.toLowerCase().trim();
    const { error } = resendOTPValidation(req.body);
    if (error) return res.status(400).json({ message: error.details[0].message });

    const { email } = req.body;
    const user = await User.findOne({ email });

    if (!user || !user.emailVerified) {
      return res.status(200).json({ message: 'If that email exists and is verified, we have sent a reset OTP.' });
    }

    // Generate new OTP (invalidates old one)
    const { otp } = await generateAndStoreOTP(email, 'password_reset');

    await sendEmail({
      email: user.email,
      subject: 'Password Reset OTP',
      html: `<p>Your password reset OTP is <b>${otp}</b>. Expires in 10 minutes.</p>`,
    });

    res.status(200).json({ message: 'If that email exists and is verified, we have sent a reset OTP.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ==============================
// LOGIN (UPDATED)
// ==============================

const login = async (req, res) => {
  try {
    if (req.body.email) req.body.email = req.body.email.toLowerCase().trim();

    const { error } = loginValidation(req.body);
    if (error) {
      return res.status(400).json({ message: error.details[0].message });
    }

    const { email, password } = req.body;
    const user = await User.findOne({ email }).select('+password');

    if (!user || !(await user.matchPassword(password))) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    if (user.isActive === false || user.isSuspended === true) {
      await revokeAllUserSessions(user._id);
      return res.status(401).json({ message: 'Account unavailable' });
    }

    if (!user.emailVerified) {
      return res.status(401).json({
        message: 'Please verify your email before logging in.',
      });
    }

    const { accessToken, refreshToken } = await issueTokenPair(user, req);
    user.lastLogin = new Date();
    await user.save();
    setAuthCookies(res, accessToken, refreshToken);

    return res.json({
      message: 'Login successful',
      accessToken,
      refreshToken,
      user: {
        _id: user._id,
        email: user.email,
        role: user.role,
        onboardingStep: user.onboardingStep,
        onboardingCompleted: user.onboardingCompleted,
      },
      onboardingCompleted: user.onboardingCompleted,
      onboardingStatus: getOnboardingStatus(user.onboardingStep),
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ==============================
// REFRESH TOKEN (UPDATED)
// ==============================

const refreshToken = async (req, res) => {
  try {
    const suppliedRefreshToken =
      req.cookies?.refreshToken || req.body?.refreshToken;

    if (!suppliedRefreshToken) {
      return res.status(401).json({ message: 'No refresh token provided' });
    }

    const rotated = await rotateRefreshToken(suppliedRefreshToken, req);

    setAuthCookies(res, rotated.accessToken, rotated.refreshToken);

    return res.json({
      message: 'Token refreshed',
      accessToken: rotated.accessToken,
      refreshToken: rotated.refreshToken,
    });
  } catch (error) {
    console.error('Refresh error:', error.message);
    return res
      .status(error.statusCode || 401)
      .json({ message: error.message || 'Invalid refresh token' });
  }
};

// ==============================
// LOGOUT (UPDATED)
// ==============================

const logout = async (req, res) => {
  try {
    const suppliedRefreshToken =
      req.cookies?.refreshToken || req.body?.refreshToken;

    await revokeRefreshToken(suppliedRefreshToken);

    res.clearCookie('accessToken', { path: '/' });
    res.clearCookie('refreshToken', { path: '/' });

    return res.json({ message: 'Logged out' });
  } catch (error) {
    console.error('Logout error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ==============================
// GET CURRENT USER (KEPT)
// ==============================

const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select(
      '-password -refreshToken -emailVerificationOTP -resetPasswordToken -resetPasswordExpires'
    );

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userObj = user.toObject();

    if (userObj.profilePhoto && typeof userObj.profilePhoto === 'string' && userObj.profilePhoto.startsWith('users/')) {
      try {
        const signedUrl = await getSignedUrl(process.env.SUPABASE_BUCKET_AVATAR, userObj.profilePhoto);
        userObj.profilePhoto = signedUrl;
      } catch (err) {
        console.error('Signed URL generation failed:', err.message);
      }
    }

    res.json(userObj);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ==============================
// FORGOT PASSWORD (KEPT)
// ==============================

const forgotPassword = async (req, res) => {
  try {
    if (req.body.email) req.body.email = req.body.email.toLowerCase().trim();
    const { error } = forgotPasswordValidation(req.body);
    if (error) return res.status(400).json({ message: error.details[0].message });

    const { email } = req.body;
    const user = await User.findOne({ email });

    const genericMessage =
      'If that email exists and is verified, we have sent a reset OTP.';

    if (!user || !user.emailVerified) {
      return res.status(200).json({ message: genericMessage });
    }

    const { otp } = await generateAndStoreOTP(email, 'password_reset');

    const html = `<p>Your password reset OTP is: <strong>${otp}</strong>. It expires in 10 minutes.</p>`;
    try {
      await sendEmail({ email: user.email, subject: 'Password Reset OTP', html });
      res.status(200).json({ message: genericMessage });
    } catch (emailError) {
      console.error('Email failed:', emailError);
      res.status(500).json({ message: 'Failed to send OTP. Try again later.' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ==============================
// VERIFY RESET OTP (KEPT)
// ==============================

const verifyResetOtp = async (req, res) => {
  try {
    if (req.body.email) req.body.email = req.body.email.toLowerCase().trim();
    const { error } = verifyResetOtpValidation(req.body);
    if (error) return res.status(400).json({ message: error.details[0].message });

    const { email, otp } = req.body;

    const result = await verifyOTP(email, otp, 'password_reset');
    if (!result.valid) {
      return res.status(400).json({ message: result.message });
    }

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: 'User not found' });

    const resetToken = jwt.sign(
      { id: user._id, purpose: 'reset' },
      process.env.JWT_RESET_SECRET,
      { expiresIn: '5m' }
    );

    res.json({
      message: 'OTP verified. You may now reset your password.',
      resetToken,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ==============================
// RESET PASSWORD (UPDATED)
// ==============================

const resetPassword = async (req, res) => {
  try {
    const { error } = resetPasswordValidation(req.body);
    if (error) return res.status(400).json({ message: error.details[0].message });

    const { token, newPassword } = req.body;

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_RESET_SECRET);
    } catch (err) {
      return res.status(400).json({ message: 'Invalid or expired reset token' });
    }

    if (decoded.purpose !== 'reset') {
      return res.status(400).json({ message: 'Invalid token purpose' });
    }

    const user = await User.findById(decoded.id).select('+password');
    if (!user) return res.status(400).json({ message: 'User not found' });

    user.password = newPassword;
    await user.save();

    // Revoke all existing sessions
    await revokeAllUserSessions(user._id);

    // Issue new token pair
    const { accessToken, refreshToken } = await issueTokenPair(user, req);
    setAuthCookies(res, accessToken, refreshToken);

    res.json({
      message: 'Password reset successful',
      accessToken,
      refreshToken,
      user: { _id: user._id, email: user.email, role: user.role },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ==============================
// FIREBASE AUTH (UPDATED)
// ==============================

const firebaseAuth = async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ message: 'ID token required' });

    const decoded = await verifyFirebaseToken(idToken);
    let { uid, email } = decoded;
    if (!uid || !email || typeof email !== 'string') {
      return res.status(400).json({ message: 'Firebase account must provide an email' });
    }
    email = email.toLowerCase().trim();

    let user = await User.findOne({ firebaseUid: uid });

    if (!user) {
      user = await User.findOne({ email });
      if (user) {
        // Check account status before linking
        if (user.isActive === false || user.isSuspended === true) {
          return res.status(401).json({ message: 'Account unavailable' });
        }
        user.firebaseUid = uid;
        if (!user.providers.includes('google')) user.providers.push('google');
        await user.save();
      } else {
        const dummyPassword = crypto.randomBytes(20).toString('hex');
        user = await User.create({
          email,
          firebaseUid: uid,
          providers: ['google'],
          password: dummyPassword,
          emailVerified: true,
        });
      }
    }

    // Check account status before issuing tokens
    if (user.isActive === false || user.isSuspended === true) {
      await revokeAllUserSessions(user._id);
      return res.status(401).json({ message: 'Account unavailable' });
    }

    const { accessToken, refreshToken } = await issueTokenPair(user, req);
    user.lastLogin = new Date();
    await user.save();
    setAuthCookies(res, accessToken, refreshToken);

    const isProfileCompleted = user.onboardingStep === 3;

    res.json({
      message: 'Firebase login successful',
      accessToken,
      refreshToken,
      isProfileCompleted,
      user: {
        id: user._id,
        email: user.email,
        role: user.role,
        onboardingStep: user.onboardingStep,
        onboardingCompleted: user.onboardingCompleted
      },
      onboardingCompleted: user.onboardingCompleted,
      onboardingStatus: getOnboardingStatus(user.onboardingStep)
    });
  } catch (error) {
    console.error(error);
    res.status(401).json({ message: 'Firebase auth failed' });
  }
};

// ==============================
// CLEANUP JOB (KEPT)
// ==============================

setInterval(async () => {
  try {
    await cleanupExpiredOTPs();
  } catch (error) {
    console.error('OTP cleanup error:', error);
  }
}, 60000);

// ==============================
// EXPORTS
// ==============================

module.exports = {
  register,
  verifyEmail,
  resendVerificationOTP,
  resendResetPasswordOTP,
  login,
  refreshToken,
  logout,
  getMe,
  forgotPassword,
  verifyResetOtp,
  resetPassword,
  firebaseAuth,
  cleanupExpiredOTPs
};
