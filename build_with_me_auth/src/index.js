const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const helmet = require('helmet');
const path = require('path');

const connectDB = require('./db');
const authRoutes = require('./routes/auth.routes');

dotenv.config();
connectDB();

const app = express();

// =============================
// Helper route (dev only) – NO HELMET
// =============================
if (process.env.NODE_ENV !== 'production') {
  app.get('/firebase-token', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'firebase-token.html'));
  });
}

// =============================
// Security & middleware (applies to everything after)
// =============================
app.use(helmet());               
app.use(morgan('dev'));
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());


app.use('/api/auth', authRoutes);

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Something went wrong!' });
});

const PORT = process.env.PORT || 5050;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));