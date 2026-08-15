const { Admin, Report, AuditLog } = require('../models/admin.model');
const User = require('../models/user.model');
const Project = require('../models/project.model');
const Post = require('../models/post.model');
const Notification = require('../models/notification.model');

// ==============================
// DASHBOARD
// ==============================

// @desc Admin Dashboard stats
const getDashboardStats = async (req, res) => {
  try {
    const now = new Date();
    const oneMonthAgo = new Date(now);
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    const twoMonthsAgo = new Date(now);
    twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);

    const [totalUsers, totalProjects, totalReports, newRegistrations] = await Promise.all([
      User.countDocuments(),
      Project.countDocuments(),
      Report.countDocuments({ status: 'pending' }),
      User.countDocuments({ createdAt: { $gte: oneMonthAgo } })
    ]);

    const previousRegistrations = await User.countDocuments({
      createdAt: { $gte: twoMonthsAgo, $lt: oneMonthAgo }
    });

    const registrationGrowth = previousRegistrations > 0
      ? ((newRegistrations - previousRegistrations) / previousRegistrations) * 100
      : 0;

    const recentActivities = await getRecentActivities(5);

    res.json({
      greeting: getGreeting(),
      stats: {
        totalUsers,
        activeUsers: totalUsers,
        activeProjects: totalProjects,
        totalProjects,
        reportsFiled: totalReports,
        newRegistrations,
        registrationGrowth: Math.round(registrationGrowth),
        platformGrowth: totalUsers * 1000
      },
      recentActivities
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ==============================
// ACTIVITIES
// ==============================

// @desc Get activities with filters
const getActivities = async (req, res) => {
  try {
    const { type = 'all', search = '', page = 1, limit = 20 } = req.query;
    
    let filter = {};
    if (type === 'user') filter.targetType = 'user';
    else if (type === 'project') filter.targetType = 'project';
    else if (type === 'report') filter.targetType = 'report';

    if (search) {
      filter.$or = [
        { action: { $regex: search, $options: 'i' } },
        { 'details.reason': { $regex: search, $options: 'i' } }
      ];
    }

    const activities = await AuditLog.find(filter)
      .populate('admin', 'firstName lastName profilePhoto')
      .sort('-createdAt')
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    const total = await AuditLog.countDocuments(filter);
    
    const counts = {
      all: await AuditLog.countDocuments(),
      user: await AuditLog.countDocuments({ targetType: 'user' }),
      project: await AuditLog.countDocuments({ targetType: 'project' }),
      report: await AuditLog.countDocuments({ targetType: 'report' })
    };

    res.json({
      activities,
      counts,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ==============================
// REPORTS
// ==============================

// @desc Get reports with filters
const getReports = async (req, res) => {
  try {
    const { status = 'all', search = '', page = 1, limit = 20 } = req.query;
    
    let filter = {};
    if (status !== 'all') filter.status = status;
    
    if (search) {
      filter.$or = [
        { reportId: { $regex: search, $options: 'i' } },
        { reason: { $regex: search, $options: 'i' } }
      ];
    }

    const reports = await Report.find(filter)
      .populate('reporter', 'firstName lastName profilePhoto')
      .populate('reportedUser', 'firstName lastName profilePhoto')
      .sort('-createdAt')
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    const counts = {
      all: await Report.countDocuments(),
      users: await Report.countDocuments({ targetType: 'user' }),
      projects: await Report.countDocuments({ targetType: 'project' })
    };

    res.json({
      reports,
      counts,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: await Report.countDocuments(filter)
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc Resolve a report
const resolveReport = async (req, res) => {
  try {
    const { reportId } = req.params;
    const { action, resolution } = req.body;

    const report = await Report.findById(reportId);
    if (!report) return res.status(404).json({ message: 'Report not found' });

    report.status = 'resolved';
    report.actionTaken = action;
    report.resolution = resolution;
    report.reviewedBy = req.user.id;
    report.reviewedAt = new Date();

    await report.save();

    await AuditLog.create({
      admin: req.user.id,
      action: `resolved_report_${action}`,
      targetType: 'report',
      targetId: report._id,
      details: { reportId: report.reportId, action, resolution }
    });

    if (action === 'suspend' || action === 'terminate_account') {
      const user = await User.findById(report.reportedUser);
      if (user) {
        user.isSuspended = action === 'suspend';
        user.isActive = action !== 'terminate_account';
        await user.save();
      }
    }

    res.json({ message: 'Report resolved successfully', report });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ==============================
// ADMIN MANAGEMENT
// ==============================

// @desc Get admin users
const getAdminUsers = async (req, res) => {
  try {
    const admins = await Admin.find({ isActive: true })
      .populate('user', 'firstName lastName profilePhoto email role')
      .populate('addedBy', 'firstName lastName')
      .lean();

    res.json(admins);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc Add admin user
const addAdmin = async (req, res) => {
  try {
    const { userId, role = 'admin', permissions = [] } = req.body;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const existing = await Admin.findOne({ user: userId });
    if (existing) return res.status(400).json({ message: 'User is already an admin' });

    const admin = await Admin.create({
      user: userId,
      role,
      permissions,
      addedBy: req.user.id
    });

    await AuditLog.create({
      admin: req.user.id,
      action: 'add_admin',
      targetType: 'admin',
      targetId: admin._id,
      details: { user: userId, role, permissions }
    });

    res.json({ message: 'Admin added successfully', admin });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc Remove admin user
const removeAdmin = async (req, res) => {
  try {
    const { userId } = req.params;

    const admin = await Admin.findOne({ user: userId });
    if (!admin) return res.status(404).json({ message: 'Admin not found' });

    if (admin.role === 'super_admin') {
      const superAdmins = await Admin.countDocuments({ role: 'super_admin' });
      if (superAdmins <= 1) {
        return res.status(400).json({ message: 'Cannot remove the last super admin' });
      }
    }

    admin.isActive = false;
    await admin.save();

    await AuditLog.create({
      admin: req.user.id,
      action: 'remove_admin',
      targetType: 'admin',
      targetId: admin._id,
      details: { user: userId }
    });

    res.json({ message: 'Admin removed successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ==============================
// HELPER FUNCTIONS
// ==============================

const getGreeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
};

const getRecentActivities = async (limit = 5) => {
  const activities = await AuditLog.find()
    .populate('admin', 'firstName lastName')
    .sort('-createdAt')
    .limit(limit)
    .lean();

  return activities.map(a => ({
    action: a.action,
    admin: a.admin ? `${a.admin.firstName} ${a.admin.lastName}` : 'System',
    targetType: a.targetType,
    targetId: a.targetId,
    details: a.details,
    timestamp: a.createdAt,
    timeAgo: getTimeAgo(a.createdAt)
  }));
};

const getTimeAgo = (date) => {
  const diff = new Date() - new Date(date);
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m`;
  if (hours < 24) return `${hours}h`;
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
};

// ==============================
// EXPORTS
// ==============================

module.exports = {
  getDashboardStats,
  getActivities,
  getReports,
  resolveReport,
  getAdminUsers,
  addAdmin,
  removeAdmin
};