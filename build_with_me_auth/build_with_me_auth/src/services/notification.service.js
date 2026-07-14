const Notification = require('../models/notification.model');

const createNotification = async ({ user, type, message, relatedProject = null, relatedApplication = null }) => {
  try {
    await Notification.create({
      user,
      type,
      message,
      relatedProject,
      relatedApplication,
      read: false,
    });
  } catch (error) {
    console.error('Failed to create notification:', error);
  }
};

module.exports = { createNotification };