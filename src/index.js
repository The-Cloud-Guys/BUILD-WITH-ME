const express = require('express');
const dotenv = require('dotenv');
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

const SocketManager = require('./socket');

dotenv.config();
connectDB();

const app = express();

app.set('trust proxy', 1);

// =============================
// Helper Route (Development Only)
// =============================
if (process.env.NODE_ENV !== 'production') {
  app.get('/firebase-token', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'firebase-token.html'));
  });
}

// =============================
// Security & Global Middleware
// =============================
app.use(helmet());
app.use(morgan('dev'));

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

// Debug middleware (remove in production)
app.use((req, res, next) => {
  console.log(' Body:', req.body);
  console.log(' Files:', req.files);
  console.log(' Headers:', req.headers);
  next();
});

app.use(cookieParser());

// =============================
// Health Check Route
// =============================
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'API is running successfully',
  });
});

// =============================
// Routes
// =============================
app.use('/api/auth', authRoutes);
app.use('/api/onboarding', onboardingRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/community', communityRoutes);
app.use('/api/applications', applicationRoutes);
app.use('/api/chat', chatRoutes);

// =============================
// 404 Route Handler
// =============================
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
  });
});

// =============================
// Global Error Handler
// =============================
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || 'Something went wrong!',
  });
});

const PORT = process.env.PORT || 5050;
const server = createServer(app);
const socketManager = new SocketManager(server);
console.log(' Socket.io initialized');
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});