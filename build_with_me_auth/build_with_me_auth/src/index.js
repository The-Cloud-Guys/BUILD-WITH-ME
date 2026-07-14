const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const helmet = require('helmet');
const path = require('path');

const connectDB = require('./db');
const authRoutes = require('./routes/auth.routes');
const onboardingRoutes = require('./routes/onboarding.routes');
const profileRoutes = require('./routes/profile.routes');
const projectRoutes = require('./routes/project.routes');
const notificationRoutes = require('./routes/notification.routes');
const communityRoutes = require('./routes/community.routes');
const applicationRoutes = require('./routes/application.routes');

dotenv.config();
connectDB();

const app = express();

app.set('trust proxy', 1);

// =============================
// Helper Route (Development Only)
// Placed BEFORE helmet() to avoid CSP blocking external scripts.
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
    limit: '10mb',
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: '10mb',
  })
);

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

app.use('/api/auth', authRoutes);
app.use('/api/onboarding', onboardingRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/community', communityRoutes);
app.use('/api/applications', applicationRoutes);



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

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});