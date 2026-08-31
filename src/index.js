const dotenv = require('dotenv');
// ✅ dotenv.config() MUST be first
dotenv.config();

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const helmet = require('helmet');
const path = require('path');
const { createServer } = require('http');

const connectDB = require('./db');

const authRoutes = require('./routes/auth.routes');
const onboardingRoutes = require('./routes/onboarding.routes');
const profileRoutes = require('./routes/profile.routes');
const projectRoutes = require('./routes/project.routes');
const notificationRoutes = require('./routes/notification.routes');
const communityRoutes = require('./routes/community.routes');
const applicationRoutes = require('./routes/application.routes');
const chatRoutes = require('./routes/chat.routes');
const adminRoutes = require('./routes/admin.routes');
const shareRoutes = require('./routes/share.routes');

const SocketManager = require('./socket');

// Connect to database
connectDB();

const app = express();

// Trust proxy for production
app.set('trust proxy', 1);

// ============================================
// DEVELOPMENT ONLY HELPERS
// ============================================

if (process.env.NODE_ENV !== 'production') {
  app.get('/firebase-token', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'firebase-token.html'));
  });
}

// ============================================
// SECURITY & GLOBAL MIDDLEWARE
// ============================================

app.use(helmet());

// ✅ Safe logging - no request body/headers
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  })
);

app.use(
  express.json({
    limit: '50mb',
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: '50mb',
  })
);

app.use(cookieParser());

// ============================================
// ANDROID DIGITAL ASSET LINKS
// ============================================

const assetLinksPath = path.join(
  __dirname,
  '..',
  'public',
  '.well-known',
  'assetlinks.json'
);

app.get('/.well-known/assetlinks.json', (req, res, next) => {
  res.type('application/json');
  res.set('Cache-Control', 'public, max-age=3600');
  res.sendFile(assetLinksPath, (error) => {
    if (error) next(error);
  });
});

// ============================================
// HEALTH CHECK
// ============================================

app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'API is running successfully',
  });
});

// ============================================
// ROUTES - MOUNTED ONCE
// ============================================

app.use('/api/auth', authRoutes);
app.use('/api/onboarding', onboardingRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/applications', applicationRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/community', communityRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/admin', adminRoutes);

// Public HTTPS share fallback. Verified mobile app/universal links can intercept
// these paths before the browser reaches this route.
app.use('/share', shareRoutes);

// ============================================
// 404 HANDLER
// ============================================

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
  });
});

// ============================================
// GLOBAL ERROR HANDLER
// ============================================

app.use((err, req, res, next) => {
  console.error(err.stack);
  const isProduction = process.env.NODE_ENV === 'production';
  res.status(err.statusCode || 500).json({
    success: false,
    message:
      isProduction && !err.statusCode
        ? 'Something went wrong!'
        : err.message || 'Something went wrong!',
  });
});

// ============================================
// START SERVER
// ============================================

const PORT = process.env.PORT || 5050;
const server = createServer(app);
const socketManager = new SocketManager(server);

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
