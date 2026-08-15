const { Admin, Report, AuditLog } = require('../models/admin.model');
const User = require('../models/user.model');
const Project = require('../models/project.model');
const Post = require('../models/post.model');
const Notification = require('../models/notification.model');
const { createNotification } = require('../services/notification.service');

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

// src/controllers/admin.controller.js - FIXED resolveReport
const resolveReport = async (req, res) => {
  try {
    const { reportId } = req.params;
    const { action, resolution } = req.body;

    // ✅ Validate action
    const validActions = ['none', 'warning', 'suspend', 'delete_content', 'terminate_account'];
    if (!validActions.includes(action)) {
      return res.status(400).json({ 
        message: `Invalid action. Must be one of: ${validActions.join(', ')}` 
      });
    }

    const report = await Report.findById(reportId);
    if (!report) return res.status(404).json({ message: 'Report not found' });

    // ✅ Check if user has permission for this action
    const requiresUserAction = ['suspend', 'terminate_account'].includes(action);
    if (requiresUserAction && !req.admin.permissions.includes('manage_users')) {
      return res.status(403).json({ message: 'Insufficient permissions to take this action on users' });
    }

    report.status = 'resolved';
    report.actionTaken = action;
    report.resolution = resolution || 'No resolution provided';
    report.reviewedBy = req.user.id;
    report.reviewedAt = new Date();

    await report.save();

    // ✅ Log the action
    await AuditLog.create({
      admin: req.user.id,
      action: `resolved_report_${action}`,
      targetType: 'report',
      targetId: report._id,
      details: { reportId: report.reportId, action, resolution }
    });

    // ✅ Handle user actions with notification
    if (action === 'suspend' || action === 'terminate_account') {
      const user = await User.findById(report.reportedUser);
      if (user) {
        user.isSuspended = action === 'suspend';
        user.isActive = action !== 'terminate_account';
        
        if (action === 'suspend') {
          user.suspendReason = resolution || 'Violation of community guidelines';
          user.suspendedAt = new Date();
          user.suspendDuration = '30 days';
        }
        if (action === 'terminate_account') {
          user.terminatedAt = new Date();
          user.terminationReason = resolution || 'Repeated violations';
        }
        await user.save();

        // ✅ Send notification
        try {
          await createNotification({
            user: user._id,
            type: 'SYSTEM_ANNOUNCEMENT',
            message: action === 'suspend' 
              ? `Your account has been suspended: ${resolution || 'Policy violation'}`
              : `Your account has been terminated: ${resolution || 'Policy violation'}`
          });
        } catch (notifError) {
          console.error('Failed to send notification:', notifError.message);
          // Continue even if notification fails
        }
      }
    }

    // ✅ If action is delete_content, delete the target
    if (action === 'delete_content') {
      const targetModel = getTargetModel(report.targetType);
      if (targetModel) {
        await targetModel.findByIdAndDelete(report.targetId);
      }
    }

    res.json({ 
      message: `Report ${report.reportId} resolved successfully`, 
      report 
    });
  } catch (error) {
    console.error('Error resolving report:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};


function getTargetModel(targetType) {
  switch (targetType) {
    case 'project': return Project;
    case 'post': return Post;
    case 'comment': return Comment;
    default: return null;
  }
}

// ==============================
// ADMIN MANAGEMENT
// ==============================

// @desc Get admin users (all admins)
// @route GET /api/admin/admins
// @access Private (Admin only)
const getAdminUsers = async (req, res) => {
  try {
    // Get ALL admins (not just active ones)
    const admins = await Admin.find()
      .populate('user', 'firstName lastName profilePhoto email role')
      .populate('addedBy', 'firstName lastName')
      .sort('-createdAt')
      .lean();

    res.json(admins);
  } catch (error) {
    console.error('Error getting admin users:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc Add admin user
// @route POST /api/admin/admins
// @access Private (Super Admin only)
const addAdmin = async (req, res) => {
  try {
    const { userId, role = 'admin', permissions = [] } = req.body;

    //  Check if current user is super admin
    const currentAdmin = await Admin.findOne({ user: req.user.id });
    if (currentAdmin.role !== 'super_admin') {
      return res.status(403).json({ 
        message: 'Only super admins can add new admins' 
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    //  Check if user is already an admin (including soft-deleted)
    const existing = await Admin.findOne({ user: userId });
    if (existing) {
      return res.status(400).json({ 
        message: 'User is already an admin. If you recently removed them, the removal was not hard deleted.' 
      });
    }

    //  Validate permissions
    const validPermissions = [
      'manage_users',
      'manage_projects',
      'manage_reports',
      'manage_admins',
      'view_analytics',
      'manage_settings',
      'delete_content'
    ];
    
    const invalidPermissions = permissions.filter(p => !validPermissions.includes(p));
    if (invalidPermissions.length > 0) {
      return res.status(400).json({
        message: `Invalid permissions: ${invalidPermissions.join(', ')}`,
        validPermissions
      });
    }

    const admin = await Admin.create({
      user: userId,
      role,
      permissions: permissions.length > 0 ? permissions : getDefaultPermissions(role),
      addedBy: req.user.id,
      isActive: true
    });

    await AuditLog.create({
      admin: req.user.id,
      action: 'add_admin',
      targetType: 'admin',
      targetId: admin._id,
      details: { user: userId, role, permissions }
    });

    // Send notification to new admin
    await createNotification({
      user: userId,
      type: 'SYSTEM_ANNOUNCEMENT',
      message: `You have been added as a ${role} on Build With Me`
    });

    const populatedAdmin = await Admin.findById(admin._id)
      .populate('user', 'firstName lastName email profilePhoto')
      .lean();

    res.json({ 
      message: 'Admin added successfully', 
      admin: populatedAdmin 
    });
  } catch (error) {
    console.error('Error adding admin:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Helper: Get default permissions based on role
const getDefaultPermissions = (role) => {
  const defaults = {
    super_admin: [
      'manage_users',
      'manage_projects',
      'manage_reports',
      'manage_admins',
      'view_analytics',
      'manage_settings',
      'delete_content'
    ],
    admin: [
      'manage_users',
      'manage_projects',
      'manage_reports',
      'view_analytics',
      'delete_content'
    ],
    moderator: [
      'manage_reports',
      'delete_content'
    ]
  };
  return defaults[role] || defaults.admin;
};

// @desc Remove admin user (HARD DELETE)
// @route DELETE /api/admin/admins/:userId
// @access Private (Super Admin only)
const removeAdmin = async (req, res) => {
  try {
    const { userId } = req.params;

    //  Find the admin
    const admin = await Admin.findOne({ user: userId });
    if (!admin) {
      return res.status(404).json({ message: 'Admin not found' });
    }

    //  Prevent removing the last super admin
    if (admin.role === 'super_admin') {
      const superAdmins = await Admin.countDocuments({ role: 'super_admin' });
      if (superAdmins <= 1) {
        return res.status(400).json({ 
          message: 'Cannot remove the last super admin' 
        });
      }
    }

    //  Prevent self-removal
    if (admin.user.toString() === req.user.id) {
      return res.status(400).json({ 
        message: 'You cannot remove yourself as admin' 
      });
    }

    //  HARD DELETE - Remove the document completely
    await Admin.findByIdAndDelete(admin._id);

    // Log the action
    await AuditLog.create({
      admin: req.user.id,
      action: 'remove_admin_hard_delete',
      targetType: 'admin',
      targetId: admin._id,
      details: { 
        userId: userId, 
        role: admin.role,
        permissions: admin.permissions,
        removedBy: req.user.id
      }
    });

    res.json({ 
      message: 'Admin removed successfully (hard delete)',
      removedAdmin: {
        userId: userId,
        role: admin.role,
        removedAt: new Date()
      }
    });
  } catch (error) {
    console.error('Error removing admin:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// src/controllers/admin.controller.js - ADD PERMISSION PRESETS

const PERMISSION_PRESETS = {
  SUPER_ADMIN: [
    'manage_users',
    'manage_projects',
    'manage_reports',
    'manage_admins',
    'view_analytics',
    'manage_settings',
    'delete_content'
  ],
  FULL_ADMIN: [
    'manage_users',
    'manage_projects',
    'manage_reports',
    'view_analytics',
    'delete_content'
  ],
  MODERATOR: [
    'manage_reports',
    'delete_content'
  ],
  CONTENT_MANAGER: [
    'manage_projects',
    'delete_content'
  ],
  USER_MANAGER: [
    'manage_users'
  ],
  VIEWER: [
    'view_analytics'
  ]
};

// @desc Get available permission presets
// @route GET /api/admin/permissions
// @access Private (Admin only)
const getPermissionPresets = async (req, res) => {
  try {
    res.json({
      presets: PERMISSION_PRESETS,
      descriptions: {
        manage_users: 'Create, suspend, and manage user accounts',
        manage_projects: 'Create, edit, and delete projects',
        manage_reports: 'View and resolve user reports',
        manage_admins: 'Add and remove admin users',
        view_analytics: 'View platform analytics and statistics',
        manage_settings: 'Change platform settings and configurations',
        delete_content: 'Delete posts, comments, and other content'
      }
    });
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
// PRESET ADMIN ACTIONS
// ==============================

const ADMIN_ACTIONS = {
  USER: {
    SUSPEND: 'suspend_user',
    UNSUSPEND: 'unsuspend_user',
    TERMINATE: 'terminate_user',
    WARN: 'warn_user',
    VIEW_DETAILS: 'view_user_details'
  },
  PROJECT: {
    DELETE: 'delete_project',
    HIDE: 'hide_project',
    UNHIDE: 'unhide_project',
    REVIEW: 'review_project'
  },
  REPORT: {
    RESOLVE: 'resolve_report',
    DISMISS: 'dismiss_report',
    ESCALATE: 'escalate_report'
  },
  CONTENT: {
    DELETE_POST: 'delete_post',
    DELETE_COMMENT: 'delete_comment',
    HIDE_POST: 'hide_post'
  },
  ADMIN: {
    ADD: 'add_admin',
    REMOVE: 'remove_admin',
    CHANGE_PERMISSIONS: 'change_admin_permissions'
  }
};

// @desc Get available admin actions
// @route GET /api/admin/actions
// @access Private (Admin only)
const getAdminActions = async (req, res) => {
  try {
    res.json({
      actions: ADMIN_ACTIONS,
      descriptions: {
        suspend_user: 'Temporarily suspend a user account',
        unsuspend_user: 'Reactivate a suspended user account',
        terminate_user: 'Permanently terminate a user account',
        warn_user: 'Issue a warning to a user',
        view_user_details: 'View full user details',
        delete_project: 'Delete a project',
        hide_project: 'Hide a project from public view',
        unhide_project: 'Unhide a previously hidden project',
        review_project: 'Review a project for compliance',
        resolve_report: 'Mark a report as resolved',
        dismiss_report: 'Dismiss a report as invalid',
        escalate_report: 'Escalate a report to super admin',
        delete_post: 'Delete a community post',
        delete_comment: 'Delete a comment',
        hide_post: 'Hide a post from public view',
        add_admin: 'Add a new admin user',
        remove_admin: 'Remove an admin user',
        change_admin_permissions: 'Change admin user permissions'
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc Perform admin action
// @route POST /api/admin/action
// @access Private (Admin only)
const performAdminAction = async (req, res) => {
  try {
    const { action, targetId, targetType, data } = req.body;
    
    // Validate action
    const allActions = Object.values(ADMIN_ACTIONS).flatMap(obj => Object.values(obj));
    if (!allActions.includes(action)) {
      return res.status(400).json({ message: 'Invalid admin action' });
    }
    
    // Check if admin has permission for this action
    const hasPermission = req.admin.permissions.includes('manage_users') || 
                         req.admin.permissions.includes('manage_projects') ||
                         req.admin.permissions.includes('manage_reports');
    
    if (!hasPermission && req.admin.role !== 'super_admin') {
      return res.status(403).json({ message: 'Insufficient permissions for this action' });
    }
    
    let result = { success: true, message: '' };
    
    // Execute action based on type
    switch (action) {
      // USER ACTIONS
      case ADMIN_ACTIONS.USER.SUSPEND:
        result = await suspendUser(targetId, req.user.id, data);
        break;
      case ADMIN_ACTIONS.USER.UNSUSPEND:
        result = await unsuspendUser(targetId, req.user.id);
        break;
      case ADMIN_ACTIONS.USER.TERMINATE:
        result = await terminateUser(targetId, req.user.id, data);
        break;
      case ADMIN_ACTIONS.USER.WARN:
        result = await warnUser(targetId, req.user.id, data);
        break;
      case ADMIN_ACTIONS.USER.VIEW_DETAILS:
        result = await viewUserDetails(targetId);
        break;
        
      // PROJECT ACTIONS
      case ADMIN_ACTIONS.PROJECT.DELETE:
        result = await deleteProject(targetId, req.user.id);
        break;
      case ADMIN_ACTIONS.PROJECT.HIDE:
        result = await hideProject(targetId, req.user.id);
        break;
      case ADMIN_ACTIONS.PROJECT.UNHIDE:
        result = await unhideProject(targetId, req.user.id);
        break;
      case ADMIN_ACTIONS.PROJECT.REVIEW:
        result = await reviewProject(targetId, req.user.id, data);
        break;
        
      // REPORT ACTIONS
      case ADMIN_ACTIONS.REPORT.RESOLVE:
        result = await resolveReportAction(targetId, req.user.id, data);
        break;
      case ADMIN_ACTIONS.REPORT.DISMISS:
        result = await dismissReport(targetId, req.user.id, data);
        break;
      case ADMIN_ACTIONS.REPORT.ESCALATE:
        result = await escalateReport(targetId, req.user.id);
        break;
        
      // CONTENT ACTIONS
      case ADMIN_ACTIONS.CONTENT.DELETE_POST:
        result = await deletePost(targetId, req.user.id);
        break;
      case ADMIN_ACTIONS.CONTENT.DELETE_COMMENT:
        result = await deleteComment(targetId, req.user.id);
        break;
      case ADMIN_ACTIONS.CONTENT.HIDE_POST:
        result = await hidePost(targetId, req.user.id);
        break;
        
      default:
        return res.status(400).json({ message: 'Action not implemented yet' });
    }
    
    // Log the action
    await AuditLog.create({
      admin: req.user.id,
      action: action,
      targetType: targetType || 'unknown',
      targetId: targetId,
      details: { action, data, result }
    });
    
    res.json(result);
  } catch (error) {
    console.error('Action error:', error);
    res.status(500).json({ message: 'Failed to perform action', error: error.message });
  }
};

// ==============================
// ACTION HANDLERS
// ==============================

// User Actions
async function suspendUser(userId, adminId, data) {
  const user = await User.findById(userId);
  if (!user) return { success: false, message: 'User not found' };
  
  user.isSuspended = true;
  user.suspendReason = data?.reason || 'No reason provided';
  user.suspendedAt = new Date();
  user.suspendedBy = adminId;
  user.suspendDuration = data?.duration || '30 days';
  await user.save();
  
  // Notify user
  await createNotification({
    user: userId,
    type: 'SYSTEM_ANNOUNCEMENT',
    message: `Your account has been suspended for ${user.suspendDuration}`
  });
  
  return { success: true, message: `User ${user.email} suspended successfully` };
}

async function unsuspendUser(userId, adminId) {
  const user = await User.findById(userId);
  if (!user) return { success: false, message: 'User not found' };
  
  user.isSuspended = false;
  user.suspendReason = undefined;
  user.suspendedAt = undefined;
  user.suspendedBy = undefined;
  user.suspendDuration = undefined;
  await user.save();
  
  await createNotification({
    user: userId,
    type: 'SYSTEM_ANNOUNCEMENT',
    message: 'Your account has been unsuspended'
  });
  
  return { success: true, message: `User ${user.email} unsuspended successfully` };
}

async function terminateUser(userId, adminId, data) {
  const user = await User.findById(userId);
  if (!user) return { success: false, message: 'User not found' };
  
  user.isActive = false;
  user.terminatedAt = new Date();
  user.terminatedBy = adminId;
  user.terminationReason = data?.reason || 'No reason provided';
  await user.save();
  
  await createNotification({
    user: userId,
    type: 'SYSTEM_ANNOUNCEMENT',
    message: 'Your account has been terminated'
  });
  
  return { success: true, message: `User ${user.email} terminated successfully` };
}

async function warnUser(userId, adminId, data) {
  const user = await User.findById(userId);
  if (!user) return { success: false, message: 'User not found' };
  
  await createNotification({
    user: userId,
    type: 'SYSTEM_ANNOUNCEMENT',
    message: data?.message || 'You have received a warning from the admin team'
  });
  
  return { success: true, message: `Warning sent to ${user.email}` };
}

async function viewUserDetails(userId) {
  const user = await User.findById(userId)
    .select('-password -refreshToken')
    .lean();
  if (!user) return { success: false, message: 'User not found' };
  return { success: true, data: user };
}

// Project Actions
async function deleteProject(projectId, adminId) {
  const project = await Project.findById(projectId);
  if (!project) return { success: false, message: 'Project not found' };
  
  await project.deleteOne();
  return { success: true, message: `Project "${project.title}" deleted successfully` };
}

async function hideProject(projectId, adminId) {
  const project = await Project.findById(projectId);
  if (!project) return { success: false, message: 'Project not found' };
  
  project.status = 'HIDDEN';
  await project.save();
  return { success: true, message: `Project "${project.title}" hidden successfully` };
}

async function unhideProject(projectId, adminId) {
  const project = await Project.findById(projectId);
  if (!project) return { success: false, message: 'Project not found' };
  
  project.status = 'OPEN';
  await project.save();
  return { success: true, message: `Project "${project.title}" unhidden successfully` };
}

async function reviewProject(projectId, adminId, data) {
  const project = await Project.findById(projectId);
  if (!project) return { success: false, message: 'Project not found' };
  
  project.reviewed = true;
  project.reviewedBy = adminId;
  project.reviewedAt = new Date();
  project.reviewNotes = data?.notes || '';
  project.reviewStatus = data?.status || 'approved';
  await project.save();
  
  return { success: true, message: `Project "${project.title}" reviewed successfully` };
}

// Report Actions
async function resolveReportAction(reportId, adminId, data) {
  const report = await Report.findById(reportId);
  if (!report) return { success: false, message: 'Report not found' };
  
  report.status = 'resolved';
  report.resolution = data?.resolution || 'Resolved by admin';
  report.reviewedBy = adminId;
  report.reviewedAt = new Date();
  await report.save();
  
  return { success: true, message: `Report ${report.reportId} resolved successfully` };
}

async function dismissReport(reportId, adminId, data) {
  const report = await Report.findById(reportId);
  if (!report) return { success: false, message: 'Report not found' };
  
  report.status = 'dismissed';
  report.resolution = data?.reason || 'Dismissed by admin';
  report.reviewedBy = adminId;
  report.reviewedAt = new Date();
  await report.save();
  
  return { success: true, message: `Report ${report.reportId} dismissed successfully` };
}

async function escalateReport(reportId, adminId) {
  const report = await Report.findById(reportId);
  if (!report) return { success: false, message: 'Report not found' };
  
  report.escalated = true;
  report.status = 'reviewed';
  await report.save();
  
  return { success: true, message: `Report ${report.reportId} escalated successfully` };
}

// Content Actions
async function deletePost(postId, adminId) {
  const post = await Post.findById(postId);
  if (!post) return { success: false, message: 'Post not found' };
  
  await post.deleteOne();
  return { success: true, message: 'Post deleted successfully' };
}

async function deleteComment(commentId, adminId) {
  const comment = await Comment.findById(commentId);
  if (!comment) return { success: false, message: 'Comment not found' };
  
  await comment.deleteOne();
  return { success: true, message: 'Comment deleted successfully' };
}

async function hidePost(postId, adminId) {
  const post = await Post.findById(postId);
  if (!post) return { success: false, message: 'Post not found' };
  
  post.isHidden = true;
  await post.save();
  return { success: true, message: 'Post hidden successfully' };
}

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
  removeAdmin,
  getAdminActions,
  performAdminAction,
  getPermissionPresets 
};