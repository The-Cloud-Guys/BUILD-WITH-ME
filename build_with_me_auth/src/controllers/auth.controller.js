const User = require('../models/user.model');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { verifyFirebaseToken } = require('../services/firebase.service');
const {
  registerValidation,
  loginValidation,
  forgotPasswordValidation,
  resetPasswordValidation,
} = require('../validation/auth.validation');

// Generate JWT Token
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });
};

// Configure Nodemailer transporter (use environment variables)
const createTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: process.env.EMAIL_PORT,
    secure: process.env.EMAIL_SECURE === 'true', // true for 465, false for other ports
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
};

// @desc    Register a new user
// @route   POST /api/auth/register
// @access  Public
const register = async (req, res) => {
  try {
    // Validate request body
    const { error } = registerValidation(req.body);
    if (error) {
      return res.status(400).json({ message: error.details[0].message });
    }

    const { name, email, password } = req.body;

    // Check if user already exists
    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // Create user
    const user = await User.create({ name, email, password });

    // Generate token
    const token = generateToken(user._id);

    res.status(201).json({
      _id: user._id,
      name: user.name,
      email: user.email,
      token,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
const login = async (req, res) => {
  try {
    // Validate request body
    const { error } = loginValidation(req.body);
    if (error) {
      return res.status(400).json({ message: error.details[0].message });
    }

    const { email, password } = req.body;

    // Check for user
    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Check password
    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Generate token
    const token = generateToken(user._id);

    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      token,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get current logged in user
// @route   GET /api/auth/me
// @access  Private
const getMe = async (req, res) => {
  try {
    // req.user is set by the protect middleware (add it if needed)
    const user = await User.findById(req.user.id).select('-password');
    res.json(user);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Send password reset email
// @route   POST /api/auth/forgot-password
// @access  Public
const forgotPassword = async (req, res) => {
  try {
    const { error } = forgotPasswordValidation(req.body);
    if (error) {
      return res.status(400).json({ message: error.details[0].message });
    }

    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) {
      // For security, don't reveal that user doesn't exist
      return res.status(200).json({ message: 'If that email exists, we have sent a reset link.' });
    }

    // Generate reset token
    const plainToken = user.generateResetToken();
    await user.save({ validateBeforeSave: false });

    // Create reset URL (frontend URL)
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${plainToken}`;

    // Send email
    const transporter = createTransporter();
    const mailOptions = {
      from: `"Build With Me" <${process.env.EMAIL_FROM}>`,
      to: user.email,
      subject: 'Password Reset Request',
      html: `
        <p>You requested a password reset.</p>
        <p>Click this <a href="${resetUrl}">link</a> to reset your password.</p>
        <p>The link expires in 10 minutes.</p>
        <p>If you didn't request this, please ignore this email.</p>
      `,
    };

    await transporter.sendMail(mailOptions);

    res.status(200).json({ message: 'Password reset email sent' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Reset password using token
// @route   POST /api/auth/reset-password
// @access  Public
const resetPassword = async (req, res) => {
  try {
    const { error } = resetPasswordValidation(req.body);
    if (error) {
      return res.status(400).json({ message: error.details[0].message });
    }

    const { token, newPassword } = req.body;

    // Hash the token from request to compare with stored hash
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: Date.now() },
    }).select('+password');

    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    // Update password
    user.password = newPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    // Optionally generate new JWT and return it
    const jwtToken = generateToken(user._id);

    res.status(200).json({
      message: 'Password reset successful',
      token: jwtToken,
      _id: user._id,
      name: user.name,
      email: user.email,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Authenticate with Firebase (Google Sign-In)
// @route   POST /api/auth/firebase
// @access  Public
const firebaseAuth = async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) {
      return res.status(400).json({ message: 'ID token is required' });
    }

    // Verify token using Firebase Admin SDK
    const decodedToken = await verifyFirebaseToken(idToken);
    const { uid, email, name, picture } = decodedToken;

    // Find or create user in MongoDB
    let user = await User.findOne({ firebaseUid: uid });
    if (!user) {
      // Check if email already exists (local user)
      user = await User.findOne({ email });
      if (user) {
        // Link existing local user to Firebase
        user.firebaseUid = uid;
        if (!user.providers.includes('google')) user.providers.push('google');
        await user.save();
      } else {
        // Create new user with dummy password (never used for login)
        const crypto = require('crypto');
        const dummyPassword = crypto.randomBytes(20).toString('hex');
        user = await User.create({
          name: name || email.split('@')[0],
          email,
          firebaseUid: uid,
          providers: ['google'],
          password: dummyPassword,
        });
      }
    }

    // Generate your own JWT for this user
    const token = generateToken(user._id);

    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      token,
    });
  } catch (error) {
    console.error('Firebase auth error:', error);
    res.status(401).json({ message: 'Invalid Firebase token' });
  }
};

module.exports = { register, login, getMe, forgotPassword, resetPassword, firebaseAuth };
