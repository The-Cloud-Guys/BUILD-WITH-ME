const express = require('express');
const { protect } = require('../middleware/auth.middleware');
const {
  getNotifications,
  markAsRead,
  markAllAsRead,
  dismissNotification,
} = require('../controllers/notification.controller');

const router = express.Router();

router.use(protect);
router.get('/', getNotifications);
router.patch('/:id/read', markAsRead);
router.patch('/read-all', markAllAsRead);
router.patch('/:id/dismiss', dismissNotification);

module.exports = router;
