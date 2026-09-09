const express = require('express');
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
  getAdminActions,
  performAdminAction,
  getPermissionPresets
} = require('../controllers/admin.controller');
const {
  createAdminInvitation,
  deactivateDedicatedAdmin,
  getAdminInvitations,
  getDedicatedAdmins,
  revokeAdminInvitation,
  updateDedicatedAdmin,
} = require('../controllers/adminManagement.controller');

const router = express.Router();

// Every admin route now uses the independent admin identity and session.
router.use(authenticateAdmin);
router.use(verifyAdminRequestOrigin);

// Dedicated admin management and invitations
router.get('/admins', requireAdminPermission('manage_admins'), getDedicatedAdmins);
router.post('/admins/invitations', requireAdminPermission('manage_admins'), createAdminInvitation);
router.get('/admins/invitations', requireAdminPermission('manage_admins'), getAdminInvitations);
router.delete('/admins/invitations/:inviteId', requireAdminPermission('manage_admins'), revokeAdminInvitation);
router.patch('/admins/:adminId', requireAdminPermission('manage_admins'), updateDedicatedAdmin);
router.delete('/admins/:adminId', requireAdminPermission('manage_admins'), deactivateDedicatedAdmin);

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
