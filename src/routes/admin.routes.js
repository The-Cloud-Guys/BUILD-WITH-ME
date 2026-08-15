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
  removeAdmin,
  getAdminActions,
  performAdminAction,
  getPermissionPresets
} = require('../controllers/admin.controller');

const router = express.Router();

router.use(protect);
router.use(isAdmin);

router.get('/dashboard', getDashboardStats);
router.get('/activities', getActivities);
router.get('/reports', getReports);
router.put('/reports/:reportId', resolveReport);

router.get('/admins', getAdminUsers);
router.post('/admins', addAdmin);
router.get('/permissions', getPermissionPresets);
router.delete('/admins/:userId', removeAdmin);

router.get('/actions', getAdminActions);
router.post('/action', performAdminAction);

module.exports = router;