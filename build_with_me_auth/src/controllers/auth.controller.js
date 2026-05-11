const User = require('../models/user.model');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const axios = require('axios');

const {
  registerValidation,
  loginValidation,
  forgotPasswordValidation,
  resetPasswordValidation,
  verifyEmailValidation,
  resendOTPValidation,
} = require('../validation/auth.validation');

const { verifyFirebaseToken } = require('../services/firebase.service');
const { generateNumericOTP, hashOTP } = require('../utils/otp.util');

// ==============================
// TOKEN HELPERS
// ==============================

const generateTokens = (user) => {
  const accessToken = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
  });

  const refreshToken = jwt.sign({ id: user._id }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  });

  return { accessToken, refreshToken };
};

const storeRefreshToken = async (userId, refreshToken) => {
  const hashed = crypto.createHash('sha256').update(refreshToken).digest('hex');
  await User.findByIdAndUpdate(userId, { refreshToken: hashed });
};

const verifyRefreshTokenFromDB = async (userId, refreshToken) => {
  const user = await User.findById(userId).select('+refreshToken');
  if (!user || !user.refreshToken) return false;

  const hashed = crypto.createHash('sha256').update(refreshToken).digest('hex');
  return hashed === user.refreshToken;
};

const clearRefreshToken = async (userId) => {
  await User.findByIdAndUpdate(userId, { refreshToken: null });
};

// ==============================
// EMAIL SETUP
// ==============================



// Configure Brevo API client
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
// REGISTER
// ==============================

const register = async (req, res) => {
  try {
    if (req.body.email) req.body.email = req.body.email.toLowerCase().trim();
    const { error } = registerValidation(req.body);
    if (error) return res.status(400).json({ message: error.details[0].message });

    const { email, password } = req.body;
    const userExists = await User.findOne({ email });
    if (userExists) return res.status(400).json({ message: 'Email already exists' });

    const user = await User.create({
      email,
      password,
      emailVerified: false,
      onboardingStep: 0,
    });

    const otp = generateNumericOTP(6);
    const hashedOTP = hashOTP(otp);
    user.emailVerificationOTP = hashedOTP;
    user.emailVerificationExpires = Date.now() + 10 * 60 * 1000;
    await user.save();

    await sendEmail({
      email: user.email,
      subject: 'Verify Your Email',
      html: `<p>Your OTP is <b>${otp}</b>. Expires in 10 minutes.</p>`,
    });

    res.status(201).json({
      message: 'Registration successful. Verify OTP sent.',
      email: user.email,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ==============================
// VERIFY EMAIL
// ==============================

const verifyEmail = async (req, res) => {
  try {
    if (req.body.email) req.body.email = req.body.email.toLowerCase().trim();
    const { error } = verifyEmailValidation(req.body);
    if (error) return res.status(400).json({ message: error.details[0].message });

    const { email, otp } = req.body;
    const user = await User.findOne({ email }).select('+emailVerificationOTP');

    if (!user || user.emailVerified || !user.emailVerificationOTP || user.emailVerificationExpires < Date.now()) {
      return res.status(400).json({ message: 'Invalid or expired OTP' });
    }
    if (hashOTP(otp) !== user.emailVerificationOTP) {
      return res.status(400).json({ message: 'Invalid OTP' });
    }

    user.emailVerified = true;
    user.emailVerificationOTP = undefined;
    user.emailVerificationExpires = undefined;
    await user.save();

    const { accessToken, refreshToken } = generateTokens(user);
    await storeRefreshToken(user._id, refreshToken);

    res.cookie('accessToken', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 15 * 60 * 1000,
      path: '/',
    });
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });

    res.json({
      message: 'Email verified successfully',
      user: { _id: user._id, email: user.email, onboardingStep: user.onboardingStep },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ==============================
// RESEND OTP
// ==============================

const resendVerificationOTP = async (req, res) => {
  try {
    if (req.body.email) req.body.email = req.body.email.toLowerCase().trim();
    const { error } = resendOTPValidation(req.body);
    if (error) return res.status(400).json({ message: error.details[0].message });

    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user || user.emailVerified) {
      return res.status(400).json({ message: 'Invalid request' });
    }

    const otp = generateNumericOTP(6);
    const hashedOTP = hashOTP(otp);
    user.emailVerificationOTP = hashedOTP;
    user.emailVerificationExpires = Date.now() + 10 * 60 * 1000;
    await user.save();

    await sendEmail({
      email: user.email,
      subject: 'Resend OTP',
      html: `<p>Your new OTP is <b>${otp}</b>. Expires in 10 minutes.</p>`,
    });

    res.json({ message: 'New OTP sent to your email.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ==============================
// LOGIN
// ==============================

const login = async (req, res) => {
  try {
    if (req.body.email) req.body.email = req.body.email.toLowerCase().trim();
    const { error } = loginValidation(req.body);
    if (error) return res.status(400).json({ message: error.details[0].message });

    const { email, password } = req.body;
    const user = await User.findOne({ email }).select('+password');
    if (!user || !(await user.matchPassword(password))) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    if (!user.emailVerified) {
      return res.status(401).json({ message: 'Please verify your email before logging in.' });
    }

    const { accessToken, refreshToken } = generateTokens(user);
    await storeRefreshToken(user._id, refreshToken);

    res.cookie('accessToken', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 15 * 60 * 1000,
      path: '/',
    });
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });

    res.json({
      message: 'Login successful',
      user: { _id: user._id, email: user.email, onboardingStep: user.onboardingStep },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ==============================
// REFRESH TOKEN
// ==============================

const refreshToken = async (req, res) => {
  try {
    const refreshTokenCookie = req.cookies.refreshToken;
    if (!refreshTokenCookie) return res.status(401).json({ message: 'No refresh token' });

    let decoded;
    try {
      decoded = jwt.verify(refreshTokenCookie, process.env.JWT_REFRESH_SECRET);
    } catch (err) {
      return res.status(401).json({ message: 'Invalid refresh token' });
    }

    const isValid = await verifyRefreshTokenFromDB(decoded.id, refreshTokenCookie);
    if (!isValid) return res.status(401).json({ message: 'Refresh token revoked' });

    const user = await User.findById(decoded.id);
    if (!user) return res.status(401).json({ message: 'User not found' });

    const { accessToken: newAccessToken, refreshToken: newRefreshToken } = generateTokens(user);
    await storeRefreshToken(user._id, newRefreshToken);

    res.cookie('accessToken', newAccessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 15 * 60 * 1000,
      path: '/',
    });
    res.cookie('refreshToken', newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });

    res.json({ message: 'Token refreshed' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ==============================
// LOGOUT
// ==============================

const logout = async (req, res) => {
  try {
    const refreshTokenCookie = req.cookies.refreshToken;
    if (refreshTokenCookie) {
      try {
        const decoded = jwt.verify(refreshTokenCookie, process.env.JWT_REFRESH_SECRET);
        await clearRefreshToken(decoded.id);
      } catch (err) {}
    }
    res.clearCookie('accessToken');
    res.clearCookie('refreshToken');
    res.json({ message: 'Logged out' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ==============================
// GET CURRENT USER (PROTECTED)
// ==============================

const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select(
      '-password -refreshToken -emailVerificationOTP -resetPasswordToken -resetPasswordExpires'
    );
    res.json(user);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ==============================
// FORGOT PASSWORD
// ==============================

const forgotPassword = async (req, res) => {
  try {
    if (req.body.email) req.body.email = req.body.email.toLowerCase().trim();
    const { error } = forgotPasswordValidation(req.body);
    if (error) return res.status(400).json({ message: error.details[0].message });

    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) {
      // For security, don't reveal whether email exists
      return res.status(200).json({ message: 'If that email exists, we have sent a reset OTP.' });
    }

    // Generate 6-digit numeric OTP
    const otp = generateNumericOTP(6);
    const hashedOTP = hashOTP(otp);
    user.resetPasswordOTP = hashedOTP;
    user.resetPasswordExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
    await user.save();

    // Send OTP via email (using Brevo)
    const html = `<p>Your password reset OTP is: <strong>${otp}</strong>. It expires in 10 minutes.</p>`;
    try {
      await sendEmail({ email: user.email, subject: 'Password Reset OTP', html });
      res.status(200).json({ message: 'Password reset OTP sent to your email.' });
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
// RESET PASSWORD (RETURNS COOKIES)
// ==============================

const resetPassword = async (req, res) => {
  try {
    if (req.body.email) req.body.email = req.body.email.toLowerCase().trim();
    const { error } = resetPasswordValidation(req.body);
    if (error) return res.status(400).json({ message: error.details[0].message });

    const { email, otp, newPassword } = req.body;
    const user = await User.findOne({ email }).select('+password +resetPasswordOTP');
    if (!user || !user.resetPasswordOTP || user.resetPasswordExpires < Date.now()) {
      return res.status(400).json({ message: 'Invalid or expired OTP' });
    }

    // Compare OTP
    if (hashOTP(otp) !== user.resetPasswordOTP) {
      return res.status(400).json({ message: 'Invalid OTP' });
    }

    // Update password
    user.password = newPassword;
    user.resetPasswordOTP = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    // Generate new tokens and set cookies (auto-login)
    const { accessToken, refreshToken } = generateTokens(user);
    await storeRefreshToken(user._id, refreshToken);

    res.cookie('accessToken', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 15 * 60 * 1000,
      path: '/',
    });
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });

    res.json({
      message: 'Password reset successful',
      user: { _id: user._id, email: user.email },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ==============================
// FIREBASE AUTH (NO PROFILE PHOTO SYNC)
// ==============================

const firebaseAuth = async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ message: 'ID token required' });

    const decoded = await verifyFirebaseToken(idToken);
    let { uid, email } = decoded;
    email = email.toLowerCase().trim();

    let user = await User.findOne({ firebaseUid: uid });

    if (!user) {
      user = await User.findOne({ email });
      if (user) {
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
          // profilePhoto is NOT set from Google – user must upload later
        });
      }
    }

    const { accessToken, refreshToken } = generateTokens(user);
    await storeRefreshToken(user._id, refreshToken);

    res.cookie('accessToken', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 15 * 60 * 1000,
      path: '/',
    });
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });

    res.json({
      message: 'Firebase login successful',
      user: { _id: user._id, email: user.email }, // no profilePhoto field returned
    });
  } catch (error) {
    console.error(error);
    res.status(401).json({ message: 'Firebase auth failed' });
  }
};

// ==============================
// EXPORTS
// ==============================

module.exports = {
  register,
  verifyEmail,
  resendVerificationOTP,
  login,
  refreshToken,
  logout,
  getMe,
  forgotPassword,
  resetPassword,
  firebaseAuth,
};