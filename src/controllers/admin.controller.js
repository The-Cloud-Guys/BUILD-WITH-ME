const { Admin, Report, AuditLog } = require('../models/admin.model');
const User = require('../models/user.model');
const Project = require('../models/project.model');
const Post = require('../models/post.model');
const Application = require('../models/application.model');
const Notification = require('../models/notification.model');
const Comment = require('../models/comment.model'); 
const { createNotification } = require('../services/notification.service');
const { getSignedUrl } = require('../services/supabase.service');
const {
  buildProjectMemberRoleMap,
  attachAppliedProjectRoles,
} = require('../services/projectMemberRole.service');

// ==============================
// HELPER FUNCTIONS
// ==============================

const getGreeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
};

const getTimeAgo = (date) => {
  const diff = new Date() - new Date(date);
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m`;
  if (hours < 24) return `${hours}h`;
  if (days < 7) return `${days}d`;
  if (weeks < 4) return `${weeks}w`;
  if (months < 12) return `${months}mo`;
  return `${years}y`;
};

const getActivityStats = async () => {
  const startYear = 2020;
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentYearStart = new Date(currentYear, 0, 1);
  const nextYearStart = new Date(currentYear + 1, 0, 1);
  const timezone = 'Africa/Lagos';

  const [activity = {}] = await User.aggregate([
    {
      $facet: {
        year: [
          { $match: { createdAt: { $gte: new Date(startYear, 0, 1) } } },
          {
            $group: {
              _id: { $year: { date: '$createdAt', timezone } },
              value: { $sum: 1 }
            }
          }
        ],
        month: [
          { $match: { createdAt: { $gte: currentYearStart, $lt: nextYearStart } } },
          {
            $group: {
              _id: { $month: { date: '$createdAt', timezone } },
              value: { $sum: 1 }
            }
          }
        ],
        week: [
          { $match: { createdAt: { $gte: currentYearStart, $lt: nextYearStart } } },
          {
            $project: {
              week: {
                $min: [
                  52,
                  {
                    $ceil: {
                      $divide: [
                        { $dayOfYear: { date: '$createdAt', timezone } },
                        7
                      ]
                    }
                  }
                ]
              }
            }
          },
          { $group: { _id: '$week', value: { $sum: 1 } } }
        ]
      }
    }
  ]);

  const toCountMap = (rows = []) => new Map(
    rows.map(({ _id, value }) => [Number(_id), value])
  );
  const yearCounts = toCountMap(activity.year);
  const monthCounts = toCountMap(activity.month);
  const weekCounts = toCountMap(activity.week);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  return {
    year: Array.from({ length: currentYear - startYear + 1 }, (_, index) => {
      const year = startYear + index;
      return { label: year.toString(), value: yearCounts.get(year) || 0 };
    }),
    month: months.map((month, index) => ({
      label: `${month} ${currentYear}`,
      value: monthCounts.get(index + 1) || 0
    })),
    week: Array.from({ length: 52 }, (_, index) => ({
      label: `Week ${index + 1}`,
      value: weekCounts.get(index + 1) || 0
    }))
  };
};

const getProjectStats = async () => {
  const counts = await Project.aggregate([
    { $match: { status: { $in: ['OPEN', 'ACTIVE', 'COMPLETED'] } } },
    { $group: { _id: '$status', value: { $sum: 1 } } }
  ]);
  const countByStatus = new Map(
    counts.map(({ _id, value }) => [_id, value])
  );
  const stats = {
    launched: countByStatus.get('OPEN') || 0,
    inProgress: countByStatus.get('ACTIVE') || 0,
    completed: countByStatus.get('COMPLETED') || 0
  };
  
  const total = stats.launched + stats.inProgress + stats.completed || 1;
  
  return {
    ...stats,
    percentages: {
      launched: Math.round((stats.launched / total) * 100),
      inProgress: Math.round((stats.inProgress / total) * 100),
      completed: Math.round((stats.completed / total) * 100)
    }
  };
};

const getRecentActivities = async (userId, limit = 10) => {
  const activities = [];

  // Get projects created
  const projects = await Project.find({ owner: userId })
    .sort('-createdAt')
    .limit(3)
    .select('title createdAt');

  projects.forEach(p => {
    activities.push({
      type: 'project_created',
      title: `Created project "${p.title}"`,
      createdAt: p.createdAt,
      details: { projectTitle: p.title }
    });
  });

  // Get projects joined
  const joinedProjects = await Project.find({ teamMembers: userId })
    .sort('-updatedAt')
    .limit(3)
    .select('title updatedAt');

  joinedProjects.forEach(p => {
    activities.push({
      type: 'project_joined',
      title: `Joined project "${p.title}"`,
      createdAt: p.updatedAt,
      details: { projectTitle: p.title }
    });
  });

  // Get applications
  const applications = await Application.find({ applicant: userId })
    .populate('project', 'title')
    .sort('-createdAt')
    .limit(3);

  applications.forEach(a => {
    activities.push({
      type: 'application_submitted',
      title: `Applied to "${a.project?.title || 'Unknown'}"`,
      createdAt: a.createdAt,
      details: { projectTitle: a.project?.title || 'Unknown' }
    });
  });

  activities.sort((a, b) => b.createdAt - a.createdAt);
  return activities.slice(0, limit);
};

const getTargetModel = (targetType) => {
  switch (targetType) {
    case 'project': return Project;
    case 'post': return Post;
    case 'comment': return Comment;
    default: return null;
  }
};

// ==============================
// DASHBOARD STATS
// ==============================

const getDashboardStats = async (req, res) => {
  try {
    const now = new Date();
    const twentyFourHoursAgo = new Date(now);
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);
    
    const oneMonthAgo = new Date(now);
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

    // Get counts
    const [totalUsers, totalProjects, totalReports, activeUsers, pendingUsers] = await Promise.all([
      User.countDocuments(),
      Project.countDocuments(),
      Report.countDocuments(),
      User.countDocuments({ isActive: true, isSuspended: false }),
      User.countDocuments({ emailVerified: true, onboardingStep: { $lt: 3 } })
    ]);

    // 24-hour changes
    const [usersLast24h, projectsLast24h, reportsLast24h, registrationsLast24h] = await Promise.all([
      User.countDocuments({ createdAt: { $gte: twentyFourHoursAgo } }),
      Project.countDocuments({ createdAt: { $gte: twentyFourHoursAgo } }),
      Report.countDocuments({ createdAt: { $gte: twentyFourHoursAgo } }),
      User.countDocuments({ createdAt: { $gte: twentyFourHoursAgo } })
    ]);

    // Previous 24-hour for comparison
    const previousDay = new Date(twentyFourHoursAgo);
    previousDay.setDate(previousDay.getDate() - 1);
    
    const usersPrev24h = await User.countDocuments({ 
      createdAt: { $gte: previousDay, $lt: twentyFourHoursAgo } 
    });

    // Calculate percentage changes
    const calcPercentage = (current, previous) => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return Math.round(((current - previous) / previous) * 100);
    };

    // Get user activity by year (for chart)
    const activityStats = await getActivityStats();
    const userActivityByYear = activityStats.year;
    const userActivityByMonth = activityStats.month;
    const userActivityByWeek = activityStats.week;

    // Get project stats for donut chart
    const projectStats = await getProjectStats();

    // Get recent reports
    const recentReports = await Report.find()
      .populate('reporter', 'firstName lastName profilePhoto')
      .populate('reportedUser', 'firstName lastName profilePhoto')
      .sort('-createdAt')
      .limit(5)
      .lean();

    const response = {
      greeting: getGreeting(),
      admin: {
        id: req.user.id,
        firstName: req.user.firstName,
        lastName: req.user.lastName,
        profilePhoto: req.user.profilePhoto ? await getSignedUrl(process.env.SUPABASE_BUCKET_AVATAR, req.user.profilePhoto) : null
      },
      stats: {
        totalUsers,
        activeUsers,
        pendingUsers,
        suspendedUsers: totalUsers - activeUsers - pendingUsers,
        totalProjects,
        totalReports,
        newRegistrations24h: registrationsLast24h,
        usersGrowth: calcPercentage(usersLast24h, usersPrev24h),
        projectsGrowth: calcPercentage(projectsLast24h, 0),
        reportsGrowth: calcPercentage(reportsLast24h, 0),
        registrationsGrowth: calcPercentage(registrationsLast24h, 0)
      },
      charts: {
        userActivity: {
          byYear: userActivityByYear,
          byMonth: userActivityByMonth,
          byWeek: userActivityByWeek
        },
        projectStats: projectStats
      },
      recentReports
    };

    res.json(response);
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ==============================
// USER MANAGEMENT (ADMIN)
// ==============================

const getUsers = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      search = '', 
      status = 'all', 
      role = 'all',
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const filter = {};

    // Search
    if (search) {
      filter.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    // Status filter - FIX B
    if (status !== 'all') {
      switch (status) {
        case 'active':
          filter.isActive = true;
          filter.isSuspended = false;
          break;
        case 'suspended':
          filter.isSuspended = true;
          break;
        case 'terminated':
          filter.isActive = false;
          break;
        case 'pending':
          filter.emailVerified = true;
          filter.onboardingStep = { $lt: 3 };
          break;
        default:
          return res.status(400).json({ message: 'Invalid user status filter' });
      }
    }

    // Role filter
    if (role !== 'all') filter.role = role;

    const users = await User.find(filter)
      .select('-password -refreshToken -emailVerificationOTP -resetPasswordToken -resetPasswordExpires')
      .sort({ [sortBy]: sortOrder === 'desc' ? -1 : 1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .lean();

    // Get project counts and reports for each user
    const usersWithDetails = await Promise.all(users.map(async (user) => {
      const projectCount = await Project.countDocuments({
        $or: [{ owner: user._id }, { teamMembers: user._id }]
      });
      
      const reportCount = await Report.countDocuments({ reportedUser: user._id });
      
      const lastLogin = user.lastLogin || user.createdAt;

      return {
        ...user,
        projectCount,
        reportCount,
        lastLogin,
        profilePhoto: user.profilePhoto ? 
          await getSignedUrl(process.env.SUPABASE_BUCKET_AVATAR, user.profilePhoto) : 
          null
      };
    }));

    // Counts - FIX B (updated conditions)
    const [total, active, suspended, pending] = await Promise.all([
      User.countDocuments(filter),
      User.countDocuments({ isActive: true, isSuspended: false }),
      User.countDocuments({ isSuspended: true }),
      User.countDocuments({ emailVerified: true, onboardingStep: { $lt: 3 } }),
    ]);

    res.json({
      users: usersWithDetails,
      counts: {
        total,
        active,
        suspended,
        pending
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total
      }
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const getUserDetails = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId)
      .select('-password -refreshToken -emailVerificationOTP -resetPasswordToken -resetPasswordExpires')
      .lean();

    if (!user) return res.status(404).json({ message: 'User not found' });

    // Get projects
    const projects = await Project.find({
      $or: [{ owner: userId }, { teamMembers: userId }]
    })
    .select('title stage status createdAt updatedAt roles')
    .lean();

    const collaborationsCount = await Project.countDocuments({ teamMembers: userId });

    // Get posts count
    const postsCount = await Post.countDocuments({ author: userId });

    // Get recent activities
    const recentActivities = await getRecentActivities(userId, 10);

    // Get reports against user
    const reports = await Report.find({ reportedUser: userId })
      .populate('reporter', 'firstName lastName profilePhoto email')
      .sort('-createdAt')
      .lean();

    res.json({
      user: {
        ...user,
        profilePhoto: user.profilePhoto ? 
          await getSignedUrl(process.env.SUPABASE_BUCKET_AVATAR, user.profilePhoto) : 
          null
      },
      stats: {
        projects: projects.length,
        collaborations: collaborationsCount,
        posts: postsCount,
        reports: reports.length
      },
      projects,
      recentActivities: recentActivities.map(a => ({
        ...a,
        timeAgo: getTimeAgo(a.createdAt)
      })),
      reports
    });
  } catch (error) {
    console.error('Get user details error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ==============================
// PROJECT MANAGEMENT (ADMIN)
// ==============================

const getAdminProjects = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      search = '', 
      status = 'all', 
      role = 'all',
      stage = 'all'
    } = req.query;

    const filter = {};

    // Search
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { techStack: { $regex: search, $options: 'i' } },
        { requiredSkills: { $regex: search, $options: 'i' } }
      ];
    }

    // Status filter
    if (status !== 'all') {
      if (status === 'open') filter.status = 'OPEN';
      if (status === 'active') filter.status = 'ACTIVE';
      if (status === 'closed') filter.status = 'CLOSED';
      if (status === 'completed') filter.status = 'COMPLETED';
      if (status === 'flagged') filter.isFlagged = true;
    }

    // Stage filter
    if (stage !== 'all') filter.stage = stage;

    // Role filter (check if any role matches)
    if (role !== 'all') {
      filter['roles.roleName'] = { $regex: role, $options: 'i' };
    }

    const projects = await Project.find(filter)
      .populate('owner', 'firstName lastName profilePhoto email role skills')
      .populate('teamMembers', 'firstName lastName profilePhoto email role')
      .sort('-createdAt')
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .lean();

    // Get additional stats for each project
    const projectsWithStats = await Promise.all(projects.map(async (project) => {
      const applications = await Application.find({ project: project._id });
      const memberRoleMap = buildProjectMemberRoleMap(
        applications.filter((application) => application.status === 'ACCEPTED')
      );
      const openRoles = project.roles.filter(r => r.currentCount < r.requiredCount).length;
      
      return {
        ...project,
        owner: {
          ...project.owner,
          profilePhoto: project.owner?.profilePhoto ? 
            await getSignedUrl(process.env.SUPABASE_BUCKET_AVATAR, project.owner.profilePhoto) : 
            null
        },
        teamMembers: attachAppliedProjectRoles(
          project._id,
          await Promise.all(project.teamMembers.map(async (member) => ({
            ...member,
            profilePhoto: member.profilePhoto
              ? await getSignedUrl(process.env.SUPABASE_BUCKET_AVATAR, member.profilePhoto)
              : null
          }))),
          memberRoleMap
        ),
        stats: {
          applications: applications.length,
          openRoles,
          teamCount: project.teamMembers.length
        }
      };
    }));

    const total = await Project.countDocuments(filter);
    const totalActive = await Project.countDocuments({ status: 'OPEN' });
    const totalCompleted = await Project.countDocuments({ status: 'COMPLETED' });
    const totalFlagged = await Project.countDocuments({ isFlagged: true });

    res.json({
      projects: projectsWithStats,
      counts: {
        total,
        active: totalActive,
        completed: totalCompleted,
        flagged: totalFlagged
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total
      }
    });
  } catch (error) {
    console.error('Get admin projects error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ==============================
// REPORT MANAGEMENT (ADMIN)
// ==============================

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

const getAdminReports = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      search = '', 
      status = 'all', 
      type = 'all',
      role = 'all'
    } = req.query;

    const filter = {};

    // Search by ID, reason, reporter, reported user
    if (search) {
      filter.$or = [
        { reportId: { $regex: search, $options: 'i' } },
        { reason: { $regex: search, $options: 'i' } }
      ];
    }

    // Status filter
    if (status !== 'all') filter.status = status;

    // Type filter - FIX C: use targetType instead of type
    if (type !== 'all') filter.targetType = type;

    // Role filter on reported user
    if (role !== 'all') {
      const users = await User.find({ role }).select('_id');
      filter.reportedUser = { $in: users.map(u => u._id) };
    }

    const reports = await Report.find(filter)
      .populate('reporter', 'firstName lastName profilePhoto email role')
      .populate('reportedUser', 'firstName lastName profilePhoto email role')
      .sort('-createdAt')
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .lean();

    // Process reports with async operations using Promise.all
    const reportsWithSignedUrls = await Promise.all(
      reports.map(async (r) => ({
        ...r,
        timeAgo: getTimeAgo(r.createdAt),
        reporter: {
          ...r.reporter,
          profilePhoto: r.reporter?.profilePhoto ? 
            await getSignedUrl(process.env.SUPABASE_BUCKET_AVATAR, r.reporter.profilePhoto) : 
            null
        },
        reportedUser: {
          ...r.reportedUser,
          profilePhoto: r.reportedUser?.profilePhoto ? 
            await getSignedUrl(process.env.SUPABASE_BUCKET_AVATAR, r.reportedUser.profilePhoto) : 
            null
        }
      }))
    );

    // Get counts for dashboard
    const totalReports = await Report.countDocuments();
    const openReports = await Report.countDocuments({ status: 'pending' });
    const underReview = await Report.countDocuments({ status: 'reviewed' });
    const resolved = await Report.countDocuments({ status: 'resolved' });

    res.json({
      reports: reportsWithSignedUrls,
      counts: {
        total: totalReports,
        open: openReports,
        underReview,
        resolved
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: await Report.countDocuments(filter)
      }
    });
  } catch (error) {
    console.error('Get admin reports error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const resolveReport = async (req, res) => {
  try {
    const { reportId } = req.params;
    const { action, resolution } = req.body;

    // Validate action
    const validActions = ['none', 'warning', 'suspend', 'delete_content', 'terminate_account'];
    if (!validActions.includes(action)) {
      return res.status(400).json({ 
        message: `Invalid action. Must be one of: ${validActions.join(', ')}` 
      });
    }

    const report = await Report.findById(reportId);
    if (!report) return res.status(404).json({ message: 'Report not found' });

    // Check if user has permission for this action
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

    // Log the action
    await AuditLog.create({
      admin: req.user.id,
      action: `resolved_report_${action}`,
      targetType: 'report',
      targetId: report._id,
      details: { reportId: report.reportId, action, resolution }
    });

    // Handle user actions with notification
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

        // Send notification
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
        }
      }
    }

    // If action is delete_content, delete the target
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

// ==============================
// ADMIN MANAGEMENT
// ==============================

const getAdminUsers = async (req, res) => {
  try {
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

const addAdmin = async (req, res) => {
  try {
    const { userId, role = 'admin', permissions = [] } = req.body;

    // Check if current user is super admin
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

    // Check if user is already an admin
    const existing = await Admin.findOne({ user: userId });
    if (existing) {
      return res.status(400).json({ 
        message: 'User is already an admin. If you recently removed them, the removal was not hard deleted.' 
      });
    }

    // Validate permissions
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

const removeAdmin = async (req, res) => {
  try {
    const { userId } = req.params;

    if (req.admin.role !== 'super_admin') {
      return res.status(403).json({ message: 'Super admin access required' });
    }

    // Find the admin
    const admin = await Admin.findOne({ user: userId });
    if (!admin) {
      return res.status(404).json({ message: 'Admin not found' });
    }

    // Prevent removing the last super admin
    if (admin.role === 'super_admin') {
      const superAdmins = await Admin.countDocuments({ role: 'super_admin' });
      if (superAdmins <= 1) {
        return res.status(400).json({ 
          message: 'Cannot remove the last super admin' 
        });
      }
    }

    // Prevent self-removal
    if (admin.user.toString() === req.user.id) {
      return res.status(400).json({ 
        message: 'You cannot remove yourself as admin' 
      });
    }

    // HARD DELETE - Remove the document completely
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

// ==============================
// ADMIN PERMISSIONS & ACTIONS
// ==============================

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
// ADMIN ACTIONS
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
  }
};

// FIX E: Permission mapping for each action
const ACTION_PERMISSION = {
  suspend_user: 'manage_users',
  unsuspend_user: 'manage_users',
  terminate_user: 'manage_users',
  warn_user: 'manage_users',
  view_user_details: 'manage_users',
  delete_project: 'manage_projects',
  hide_project: 'manage_projects',
  unhide_project: 'manage_projects',
  review_project: 'manage_projects',
  resolve_report: 'manage_reports',
  dismiss_report: 'manage_reports',
  escalate_report: 'manage_reports',
  delete_post: 'delete_content',
  delete_comment: 'delete_content',
  hide_post: 'delete_content',
};

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
        hide_post: 'Hide a post from public view'
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

const performAdminAction = async (req, res) => {
  try {
    const { action, targetId, data } = req.body;
    
    // Validate action
    const allActions = Object.values(ADMIN_ACTIONS).flatMap(obj => Object.values(obj));
    if (!allActions.includes(action)) {
      return res.status(400).json({ message: 'Invalid admin action' });
    }

    // FIX E: Check permission using ACTION_PERMISSION mapping
    const requiredPermission = ACTION_PERMISSION[action];
    if (!requiredPermission) {
      return res.status(400).json({ message: 'Unsupported admin action' });
    }

    const authorized =
      req.admin.role === 'super_admin' ||
      req.admin.permissions.includes(requiredPermission);

    if (!authorized) {
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
    
    const auditTargetType = action.endsWith('_user') || action === 'warn_user'
      ? 'user'
      : action.includes('project')
        ? 'project'
        : action.includes('report')
          ? 'report'
          : action.includes('comment')
            ? 'comment'
            : 'post';

    // Log the action
    await AuditLog.create({
      admin: req.user.id,
      action: action,
      targetType: auditTargetType,
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

// FIX D: Use isHidden instead of changing status
async function hideProject(projectId, adminId) {
  const project = await Project.findById(projectId);
  if (!project) return { success: false, message: 'Project not found' };

  project.isHidden = true;
  await project.save();

  return { success: true, message: `Project "${project.title}" hidden successfully` };
}

async function unhideProject(projectId, adminId) {
  const project = await Project.findById(projectId);
  if (!project) return { success: false, message: 'Project not found' };

  project.isHidden = false;
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
// ACTIVITY LOGS
// ==============================

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

const getAdminActivities = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      search = '', 
      type = 'all',
      status = 'all',
      role = 'all'
    } = req.query;

    const filter = {};

    // Search
    if (search) {
      filter.$or = [
        { action: { $regex: search, $options: 'i' } },
        { 'details.reportId': { $regex: search, $options: 'i' } }
      ];
    }

    // Type filter
    if (type !== 'all') filter.targetType = type;

    const activities = await AuditLog.find(filter)
      .populate('admin', 'firstName lastName profilePhoto email role')
      .sort('-createdAt')
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .lean();

    const activitiesWithDetails = await Promise.all(
      activities.map(async (a) => ({
        ...a,
        logId: `ACT-${String(a._id).substring(0, 8).toUpperCase()}`,
        timeAgo: getTimeAgo(a.createdAt),
        admin: {
          ...a.admin,
          profilePhoto: a.admin?.profilePhoto ? 
            await getSignedUrl(process.env.SUPABASE_BUCKET_AVATAR, a.admin.profilePhoto) : 
            null
        }
      }))
    );

    // Get counts
    const totalActivities = await AuditLog.countDocuments();
    const adminActions = await AuditLog.countDocuments({ 
      action: { $in: ['add_admin', 'remove_admin', 'change_admin_permissions'] }
    });
    const reportReviewed = await AuditLog.countDocuments({ 
      action: { $regex: 'resolved_report', $options: 'i' }
    });
    const suspendedUsers = await AuditLog.countDocuments({ 
      action: { $in: ['suspend_user', 'terminate_user'] }
    });

    res.json({
      activities: activitiesWithDetails,
      counts: {
        total: totalActivities,
        adminActions,
        reportReviewed,
        suspendedUsers
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: await AuditLog.countDocuments(filter)
      }
    });
  } catch (error) {
    console.error('Get activities error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ==============================
// EXPORTS
// ==============================

module.exports = {
  // Dashboard
  getDashboardStats,
  
  // User Management
  getUsers,
  getUserDetails,
  
  // Project Management (Admin)
  getAdminProjects,
  
  // Report Management
  getReports,
  getAdminReports,
  resolveReport,
  
  // Admin Management
  getAdminUsers,
  addAdmin,
  removeAdmin,
  getPermissionPresets,
  getAdminActions,
  performAdminAction,
  
  // Activity Logs
  getActivities,
  getAdminActivities
};
