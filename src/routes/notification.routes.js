const express = require('express');
const { protect } = require('../middleware/auth.middleware');
const {
  getNotifications,
  markAsRead,
  markAllAsRead,
  dismissNotification,
  registerDevice,
  unregisterDevice,
} = require('../controllers/notification.controller');

const router = express.Router();

router.use(protect);
router.post('/devices', registerDevice);
router.delete('/devices/:deviceId', unregisterDevice);
router.get('/', getNotifications);
router.patch('/:id/read', markAsRead);
router.patch('/read-all', markAllAsRead);
router.patch('/:id/dismiss', dismissNotification);

module.exports = router;
