const jwt = require('jsonwebtoken');
const User = require('../models/user.model');

// 🧪 Temporary middleware to log cookies (for debugging)
const logCookies = (req, res, next) => {
  console.log('Cookies received:', req.cookies);
  next();
};

// 🔐 Main authentication middleware
const protect = async (req, res, next) => {
  let token;

  // 1. Check Authorization Header (Bearer token)
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    token = req.headers.authorization.split(' ')[1];
  }

  // 2. Check Cookies (fallback)
  if (!token && req.cookies && req.cookies.accessToken) {
    token = req.cookies.accessToken;
  }

  // No token found
  if (!token) {
    return res.status(401).json({ message: 'Not authorized, no token' });
  }

  try {
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Get user
    const user = await User.findById(decoded.id).select('-password');

    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error(error);
    res.status(401).json({ message: 'Not authorized, token failed' });
  }
};

module.exports = { protect, logCookies };