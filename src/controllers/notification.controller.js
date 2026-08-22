const Notification = require('../models/notification.model');

const CATEGORY_TYPES = {
  projects: ['PROJECT_MATCH', 'NEW_APPLICATION', 'ROLE_FILLED', 'TEAM_REMOVED'],
  applications: ['APPLICATION_STATUS'],
  system: ['SYSTEM_ANNOUNCEMENT'],
};

// @desc    Get user's notifications
// @route   GET /api/notifications
// @access  Private
const getNotifications = async (req, res) => {
  try {
    const filter = { user: req.user.id, dismissed: { $ne: true } };
    if (req.query.category && req.query.category !== 'all') {
      const types = CATEGORY_TYPES[req.query.category];
      if (!types) return res.status(400).json({ message: 'Invalid notification category' });
      filter.type = { $in: types };
    }

    const notifications = await Notification.find(filter)
      .sort('-createdAt')
      .limit(50);
    const [unread, total] = await Promise.all([
      Notification.countDocuments({ ...filter, read: false }),
      Notification.countDocuments(filter),
    ]);
    res.json({ notifications, counts: { total, unread } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Mark notification as read
// @route   PATCH /api/notifications/:id/read
// @access  Private
const markAsRead = async (req, res) => {
  try {
    const notification = await Notification.findOne({ _id: req.params.id, user: req.user.id });
    if (!notification) return res.status(404).json({ message: 'Notification not found' });
    notification.read = true;
    await notification.save();
    res.json({ message: 'Notification marked as read' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Mark all notifications as read
// @route   PATCH /api/notifications/read-all
// @access  Private
const markAllAsRead = async (req, res) => {
  try {
    await Notification.updateMany({ user: req.user.id, read: false }, { read: true });
    res.json({ message: 'All notifications marked as read' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

const dismissNotification = async (req, res) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: req.user.id },
      { $set: { dismissed: true } },
      { new: true }
    );
    if (!notification) return res.status(404).json({ message: 'Notification not found' });
    return res.json({ message: 'Notification dismissed' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

module.exports = { getNotifications, markAsRead, markAllAsRead, dismissNotification };
