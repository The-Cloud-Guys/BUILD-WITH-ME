const express = require('express');
const { protect } = require('../middleware/auth.middleware');
const { isAdmin, isSuperAdmin } = require('../middleware/admin.middleware');
const {
  authenticateAdmin,
  requireAdminPermission,
  verifyAdminRequestOrigin,
} = require('../middleware/adminAuth.middleware');
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

// Legacy admin provisioning remains available to existing user-linked super
// admins until Phase 4 replaces it with dedicated admin invitations.
router.get('/admins', protect, isAdmin, isSuperAdmin, getAdminUsers);
router.post('/admins', protect, isAdmin, isSuperAdmin, addAdmin);
router.delete('/admins/:userId', protect, isAdmin, isSuperAdmin, removeAdmin);

// Dashboard and moderation operations now require dedicated admin sessions.
router.use(authenticateAdmin);
router.use(verifyAdminRequestOrigin);

// Dashboard
router.get('/dashboard', requireAdminPermission('view_analytics'), getDashboardStats);

// User Management
router.get('/users', requireAdminPermission('manage_users'), getUsers);
router.get('/users/:userId', requireAdminPermission('manage_users'), getUserDetails);

// Project Management
router.get('/projects', requireAdminPermission('manage_projects'), getAdminProjects);

// Reports
router.get('/reports', requireAdminPermission('manage_reports'), getAdminReports);
router.put('/reports/:reportId', requireAdminPermission('manage_reports'), resolveReport);

// Activity Logs
router.get('/activities', requireAdminPermission('view_analytics'), getAdminActivities);

// Admin Actions
router.get('/actions', getAdminActions);
router.post('/action', performAdminAction);
router.get('/permissions', requireAdminPermission('manage_admins'), getPermissionPresets);

module.exports = router;
