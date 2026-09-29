const Notification = require('../models/notification.model');
const NotificationDevice = require('../models/notificationDevice.model');

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

const registerDevice = async (req, res) => {
  try {
    const { token, platform, deviceId, appVersion } = req.body;
    if (
      typeof token !== 'string' || !token.trim() || token.length > 4096 ||
      typeof deviceId !== 'string' || !deviceId.trim() || deviceId.length > 200 ||
      (appVersion != null && (typeof appVersion !== 'string' || appVersion.length > 50)) ||
      !['android', 'ios', 'web'].includes(platform)
    ) {
      return res.status(400).json({ message: 'token, deviceId and a valid platform are required' });
    }
    await NotificationDevice.deleteMany({
      $or: [
        { token: token.trim(), user: { $ne: req.user._id } },
        { token: token.trim(), deviceId: { $ne: deviceId.trim() } },
        { user: req.user._id, deviceId: deviceId.trim(), token: { $ne: token.trim() } },
      ],
    });
    const device = await NotificationDevice.findOneAndUpdate(
      { user: req.user._id, deviceId: deviceId.trim() },
      { $set: {
        token: token.trim(),
        platform,
        appVersion: appVersion?.trim() || null,
        isActive: true,
        lastSeenAt: new Date(),
      } },
      { upsert: true, new: true, runValidators: true }
    ).select('platform deviceId appVersion isActive lastSeenAt');
    return res.status(201).json({ success: true, message: 'Notification device registered', device });
  } catch (error) {
    console.error('Device registration failed:', error.message);
    return res.status(500).json({ message: 'Server error' });
  }
};

const unregisterDevice = async (req, res) => {
  try {
    const device = await NotificationDevice.findOneAndUpdate(
      { user: req.user._id, deviceId: req.params.deviceId },
      { $set: { isActive: false } },
      { new: true }
    );
    if (!device) return res.status(404).json({ message: 'Notification device not found' });
    return res.json({ success: true, message: 'Notification device unregistered' });
  } catch (error) {
    console.error('Device unregistration failed:', error.message);
    return res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  getNotifications,
  markAsRead,
  markAllAsRead,
  dismissNotification,
  registerDevice,
  unregisterDevice,
};
