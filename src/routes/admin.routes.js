const express = require('express');
const { protect } = require('../middleware/auth.middleware');
const { isAdmin } = require('../middleware/admin.middleware');
const {
  getDashboardStats,
  getActivities,
  getReports,
  resolveReport,
  getAdminUsers,
  addAdmin,
  removeAdmin
} = require('../controllers/admin.controller');

const router = express.Router();

// All admin routes require authentication and admin privileges
router.use(protect);
router.use(isAdmin);

// Dashboard
router.get('/dashboard', getDashboardStats);

// Activities
router.get('/activities', getActivities);

// Reports
router.get('/reports', getReports);
router.put('/reports/:reportId', resolveReport);

// Admin management
router.get('/admins', getAdminUsers);
router.post('/admins', addAdmin);
router.delete('/admins/:userId', removeAdmin);

module.exports = router;