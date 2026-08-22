const express = require('express');
const { protect } = require('../middleware/auth.middleware');
const { isAdmin, isSuperAdmin } = require('../middleware/admin.middleware');
const {
  getDashboardStats,
  getUsers,
  getUserDetails,
  getAdminProjects,
  getAdminReports,
  getAdminActivities,
  getReports,
  resolveReport,
  getAdminUsers,
  addAdmin,
  removeAdmin,
  getAdminActions,
  performAdminAction,
  getPermissionPresets
} = require('../controllers/admin.controller');

const router = express.Router();

// All admin routes require authentication and admin privileges
router.use(protect);
router.use(isAdmin);

// Dashboard
router.get('/dashboard', getDashboardStats);

// User Management
router.get('/users', getUsers);
router.get('/users/:userId', getUserDetails);

// Project Management
router.get('/projects', getAdminProjects);

// Reports
router.get('/reports', getAdminReports);
router.put('/reports/:reportId', resolveReport);

// Activity Logs
router.get('/activities', getAdminActivities);

// Admin Management
router.get('/admins', isSuperAdmin, getAdminUsers);
router.post('/admins', isSuperAdmin, addAdmin);
router.delete('/admins/:userId', isSuperAdmin, removeAdmin);

// Admin Actions
router.get('/actions', getAdminActions);
router.post('/action', performAdminAction);
router.get('/permissions', getPermissionPresets);

module.exports = router;
