const rateLimit = require('express-rate-limit');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 requests per windowMs
  message: { message: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const adminAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { message: 'Too many admin authentication attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const adminBootstrapLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: { message: 'Too many admin bootstrap attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { adminAuthLimiter, adminBootstrapLimiter, authLimiter };
