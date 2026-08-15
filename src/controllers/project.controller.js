const Project = require('../models/project.model');
const Application = require('../models/application.model');
const User = require('../models/user.model');
const { uploadFile, deleteFile, getSignedUrl } = require('../services/supabase.service');
const { createNotification } = require('../services/notification.service');
const multer = require('multer');
const path = require('path');

const cvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    console.log(' CV File received:', file.originalname, file.mimetype);
    const allowedTypes = /pdf|doc|docx|txt/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    console.log('   Extname check:', extname);
    console.log('   Mimetype check:', mimetype);
    
    if (mimetype && extname) return cb(null, true);
    cb(new Error('Only PDF, DOC, DOCX, and TXT files are allowed'));
  },
});

// Helper to generate CV path
const generateCVPath = (userId, projectId, originalName) => {
  const timestamp = Date.now();
  const ext = path.extname(originalName);
  return `resumes/${userId}/${projectId}/cv_${timestamp}${ext}`;
};

// Helper to check if a role still has capacity
const isRoleAvailable = (project, roleName) => {
  const role = project.roles.find(r => r.roleName === roleName);
  return role && role.currentCount < role.requiredCount;
};

// ==============================
// PROJECT CRUD
// ==============================

// @desc    Create a new project
// @route   POST /api/projects
// @access  Private
const createProject = async (req, res) => {
  try {
    const { title, description, requiredSkills, techStack, stage, roles } = req.body;

    if (!roles || !Array.isArray(roles) || roles.length === 0) {
      return res.status(400).json({ message: 'At least one role is required' });
    }

    for (let role of roles) {
      if (!role.roleName || !role.requiredCount || role.requiredCount < 1) {
        return res.status(400).json({ message: 'Each role must have a name and required count (>=1)' });
      }
    }

    const project = await Project.create({
      title,
      description,
      requiredSkills: Array.isArray(requiredSkills) ? requiredSkills : requiredSkills.split(','),
      techStack: Array.isArray(techStack) ? techStack : techStack.split(','),
      stage,
      owner: req.user.id,
      roles: roles.map(r => ({ roleName: r.roleName, requiredCount: r.requiredCount, currentCount: 0 })),
      status: 'OPEN',
    });

    // Notify users whose skills match this project's requiredSkills
    const users = await User.find({ skills: { $in: requiredSkills } }).select('_id');
    for (let user of users) {
      if (user._id.toString() !== req.user.id) {
        await createNotification({
          user: user._id,
          type: 'PROJECT_MATCH',
          message: `New project "${title}" matches your skills.`,
          relatedProject: project._id,
        });
      }
    }

    res.status(201).json({ message: 'Project created successfully', project });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get all projects with filters
// @route   GET /api/projects
// @access  Public
const getProjects = async (req, res) => {
  try {
    const { page = 1, limit = 10, search, skill, tech, stage, tag, role, owner } = req.query;
    const filter = {};

    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { requiredSkills: { $regex: search, $options: 'i' } },
        { techStack: { $regex: search, $options: 'i' } },
        { 'roles.roleName': { $regex: search, $options: 'i' } }
      ];
    }

    if (skill) filter.requiredSkills = { $in: [skill] };
    if (tech) filter.techStack = { $in: [tech] };
    if (stage) filter.stage = stage;
    if (tag) {
      filter.$or = [
        { requiredSkills: { $in: [tag] } },
        { techStack: { $in: [tag] } }
      ];
    }
    if (role) {
      filter['roles.roleName'] = { $regex: role, $options: 'i' };
    }
    if (owner) {
      filter.owner = owner;
    }

    const projects = await Project.find(filter)
      .populate({
        path: 'owner',
        select: 'firstName lastName profilePhoto email role'
      })
      .populate({
        path: 'teamMembers',
        select: 'firstName lastName profilePhoto email role'
      })
      .sort('-createdAt')
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit))
      .lean();

    // Convert profilePhoto to signed URL if needed
    for (let p of projects) {
      if (p.owner?.profilePhoto && p.owner.profilePhoto.startsWith('users/')) {
        p.owner.profilePhoto = await getSignedUrl(process.env.SUPABASE_BUCKET_AVATAR, p.owner.profilePhoto);
      }
      if (p.teamMembers && p.teamMembers.length > 0) {
        for (let member of p.teamMembers) {
          if (member.profilePhoto && member.profilePhoto.startsWith('users/')) {
            member.profilePhoto = await getSignedUrl(process.env.SUPABASE_BUCKET_AVATAR, member.profilePhoto);
          }
        }
      }
    }

    const total = await Project.countDocuments(filter);

    res.json({
      projects,
      totalPages: Math.ceil(total / parseInt(limit)),
      currentPage: parseInt(page),
      total,
    });
  } catch (error) {
    console.error('Error in getProjects:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Get single project by ID
// @route   GET /api/projects/:id
// @access  Public
const getProjectById = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id)
      .populate({
        path: 'owner',
        select: 'firstName lastName profilePhoto email role'
      })
      .populate({
        path: 'teamMembers',
        select: 'firstName lastName profilePhoto email role'
      })
      .lean();

    if (!project) return res.status(404).json({ message: 'Project not found' });

    // Convert profile photos to signed URLs
    if (project.owner?.profilePhoto && project.owner.profilePhoto.startsWith('users/')) {
      project.owner.profilePhoto = await getSignedUrl(process.env.SUPABASE_BUCKET_AVATAR, project.owner.profilePhoto);
    }
    if (project.teamMembers && project.teamMembers.length > 0) {
      for (let member of project.teamMembers) {
        if (member.profilePhoto && member.profilePhoto.startsWith('users/')) {
          member.profilePhoto = await getSignedUrl(process.env.SUPABASE_BUCKET_AVATAR, member.profilePhoto);
        }
      }
    }

    res.json(project);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get featured projects (sorted by application count + recency)
// @route   GET /api/projects/featured
// @access  Public
const getFeaturedProjects = async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const featured = await Project.aggregate([
      {
        $lookup: {
          from: 'applications',
          localField: '_id',
          foreignField: 'project',
          as: 'applications'
        }
      },
      {
        $addFields: {
          applicationCount: { $size: '$applications' }
        }
      },
      {
        $sort: { applicationCount: -1, createdAt: -1 }
      },
      {
        $limit: parseInt(limit)
      },
      {
        $lookup: {
          from: 'users',
          localField: 'owner',
          foreignField: '_id',
          as: 'owner'
        }
      },
      { $unwind: '$owner' },
      {
        $lookup: {
          from: 'users',
          localField: 'teamMembers',
          foreignField: '_id',
          as: 'teamMembers'
        }
      }
    ]);

    for (let p of featured) {
      if (p.owner?.profilePhoto && p.owner.profilePhoto.startsWith('users/')) {
        p.owner.profilePhoto = await getSignedUrl(process.env.SUPABASE_BUCKET_AVATAR, p.owner.profilePhoto);
      }
      if (p.teamMembers && p.teamMembers.length > 0) {
        for (let member of p.teamMembers) {
          if (member.profilePhoto && member.profilePhoto.startsWith('users/')) {
            member.profilePhoto = await getSignedUrl(process.env.SUPABASE_BUCKET_AVATAR, member.profilePhoto);
          }
        }
      }
    }

    res.json(featured);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get recommended projects for logged-in user
// @route   GET /api/projects/recommended
// @access  Private
const getRecommendedProjects = async (req, res) => {
  console.log('🔹 getRecommendedProjects called');
  try {
    const user = await User.findById(req.user.id).select('skills role');
    if (!user) return res.status(404).json({ message: 'User not found' });

    const appliedProjects = await Application.distinct('project', { applicant: req.user.id });
    const memberProjects = await Project.distinct('_id', { teamMembers: req.user.id });
    const excluded = [...appliedProjects, ...memberProjects];

    const filter = {
      _id: { $nin: excluded },
      $or: [
        { requiredSkills: { $in: user.skills } },
        { techStack: { $in: user.skills } },
        { 'roles.roleName': { $regex: user.role || '', $options: 'i' } }
      ]
    };

    const projects = await Project.find(filter)
      .populate({
        path: 'owner',
        select: 'firstName lastName profilePhoto email role'
      })
      .populate({
        path: 'teamMembers',
        select: 'firstName lastName profilePhoto email role'
      })
      .sort('-createdAt')
      .limit(20)
      .lean();

    for (let p of projects) {
      if (p.owner?.profilePhoto && p.owner.profilePhoto.startsWith('users/')) {
        p.owner.profilePhoto = await getSignedUrl(process.env.SUPABASE_BUCKET_AVATAR, p.owner.profilePhoto);
      }
      if (p.teamMembers && p.teamMembers.length > 0) {
        for (let member of p.teamMembers) {
          if (member.profilePhoto && member.profilePhoto.startsWith('users/')) {
            member.profilePhoto = await getSignedUrl(process.env.SUPABASE_BUCKET_AVATAR, member.profilePhoto);
          }
        }
      }
    }

    res.json(projects);
  } catch (error) {
    console.error('Error in getRecommendedProjects:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Update project (owner only)
// @route   PUT /api/projects/:id
// @access  Private
const updateProject = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ message: 'Project not found' });
    if (project.owner.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const { 
      title, 
      description, 
      requiredSkills, 
      techStack, 
      stage, 
      status, 
      roles 
    } = req.body;

    // Update basic fields
    if (title) project.title = title;
    if (description) project.description = description;
    if (stage) project.stage = stage;
    if (status) project.status = status;

    // Update skills with proper trimming
    if (requiredSkills) {
      project.requiredSkills = Array.isArray(requiredSkills) 
        ? requiredSkills.map(s => s.trim()).filter(Boolean)
        : requiredSkills.split(',').map(s => s.trim()).filter(Boolean);
    }

    // Update tech stack with proper trimming
    if (techStack) {
      project.techStack = Array.isArray(techStack) 
        ? techStack.map(s => s.trim()).filter(Boolean)
        : techStack.split(',').map(s => s.trim()).filter(Boolean);
    }

    // Update roles with validation
    if (roles) {
      // Validate: cannot reduce requiredCount below currentCount
      for (const newRole of roles) {
        const existingRole = project.roles.find(r => r.roleName === newRole.roleName);
        if (existingRole && newRole.requiredCount < existingRole.currentCount) {
          return res.status(400).json({
            message: `Cannot reduce required count for role "${newRole.roleName}" below already filled positions (${existingRole.currentCount}).`
          });
        }
      }

      project.roles = roles.map(r => ({
        roleName: r.roleName,
        requiredCount: r.requiredCount,
        currentCount: project.roles.find(old => old.roleName === r.roleName)?.currentCount || 0,
      }));
    }

    await project.save();
    res.json({ message: 'Project updated successfully', project });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Delete project (owner only)
// @route   DELETE /api/projects/:id
// @access  Private
const deleteProject = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ message: 'Project not found' });
    if (project.owner.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    await Application.deleteMany({ project: project._id });
    await project.deleteOne();

    res.json({ message: 'Project deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ==============================
// APPLICATIONS
// ==============================

const applyToProject = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const { message, portfolioLink, role } = req.body;
    if (!message) return res.status(400).json({ message: 'Application message is required' });
    if (!role) return res.status(400).json({ message: 'Role is required' });

    const existing = await Application.findOne({ project: project._id, applicant: req.user.id });
    if (existing) {
      return res.status(400).json({ message: 'You have already applied to this project' });
    }

    let cvPath = null;
    if (req.file) {
      const filePath = generateCVPath(req.user.id, project._id, req.file.originalname);
      await uploadFile(process.env.SUPABASE_BUCKET_RESUMES, filePath, req.file.buffer, req.file.mimetype);
      cvPath = filePath;
    }

    const application = await Application.create({
      project: project._id,
      applicant: req.user.id,
      role,
      message,
      portfolioLink: portfolioLink || '',
      cvPath,
    });

    await createNotification({
      user: project.owner,
      type: 'NEW_APPLICATION',
      message: `New application from ${req.user.firstName} ${req.user.lastName} for role "${role}" in project "${project.title}".`,
      relatedProject: project._id,
      relatedApplication: application._id,
    });

    // Convert to object and generate signed URL (like profile photo)
    const appObj = application.toObject();
    if (appObj.cvPath) {
      appObj.cvUrl = await getSignedUrl(
        process.env.SUPABASE_BUCKET_RESUMES,
        appObj.cvPath,
        3600 // 1 hour expiry (same as profile photos)
      );
    }

    res.status(201).json({
      message: `Application sent to ${project.title}`,
      application: appObj,
    });
  } catch (error) {
    console.error(error);
    if (error.code === 11000) {
      return res.status(400).json({ message: 'You have already applied to this project' });
    }
    res.status(500).json({ message: 'Server error' });
  }
};

const getProjectApplications = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ message: 'Project not found' });
    if (project.owner.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const applications = await Application.find({ project: project._id })
      .populate({
        path: 'applicant',
        select: 'firstName lastName email profilePhoto bio externalLink skills role'
      })
      .sort('-createdAt')
      .lean();

    // Generate signed URLs for CVs and profile photos (same pattern)
    for (let app of applications) {
      // ✅ Generate CV URL (like profile photo)
      if (app.cvPath) {
        app.cvUrl = await getSignedUrl(
          process.env.SUPABASE_BUCKET_RESUMES,
          app.cvPath,
          3600
        );
      }
      // Generate profile photo URL
      if (app.applicant?.profilePhoto && app.applicant.profilePhoto.startsWith('users/')) {
        app.applicant.profilePhoto = await getSignedUrl(
          process.env.SUPABASE_BUCKET_AVATAR,
          app.applicant.profilePhoto,
          3600
        );
      }
    }

    // Get team members list for context
    const teamMembers = await User.find(
      { _id: { $in: project.teamMembers } },
      'firstName lastName profilePhoto email role'
    ).lean();

    for (let member of teamMembers) {
      if (member.profilePhoto && member.profilePhoto.startsWith('users/')) {
        member.profilePhoto = await getSignedUrl(
          process.env.SUPABASE_BUCKET_AVATAR,
          member.profilePhoto,
          3600
        );
      }
    }

    res.json({
      applications,
      teamMembers,
      projectDetails: {
        title: project.title,
        status: project.status || 'OPEN',
        roles: project.roles,
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Update application status (accept/reject) – owner only
// @route   PUT /api/applications/:id
// @access  Private
const updateApplicationStatus = async (req, res) => {
  try {
    const application = await Application.findById(req.params.id).populate('project');
    if (!application) return res.status(404).json({ message: 'Application not found' });

    const project = application.project;
    if (project.owner.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const { status } = req.body;
    if (!['ACCEPTED', 'REJECTED'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const oldStatus = application.status;
    application.status = status;
    await application.save();

    // Update role capacity
    const roleIndex = project.roles.findIndex(r => r.roleName === application.role);
    if (roleIndex === -1) {
      return res.status(400).json({ message: 'Role no longer exists in project' });
    }

    if (status === 'ACCEPTED' && oldStatus !== 'ACCEPTED') {
      project.roles[roleIndex].currentCount += 1;
      await project.save();

      if (!project.teamMembers.includes(application.applicant)) {
        project.teamMembers.push(application.applicant);
        await project.save();
      }

      await createNotification({
        user: application.applicant,
        type: 'APPLICATION_STATUS',
        message: `Your application for role "${application.role}" in project "${project.title}" has been accepted.`,
        relatedProject: project._id,
        relatedApplication: application._id,
      });

      const role = project.roles[roleIndex];
      if (role.currentCount === role.requiredCount) {
        await createNotification({
          user: project.owner,
          type: 'ROLE_FILLED',
          message: `Role "${role.roleName}" in project "${project.title}" is now filled.`,
          relatedProject: project._id,
        });
      }
    } else if (status === 'REJECTED' && oldStatus === 'ACCEPTED') {
      project.roles[roleIndex].currentCount -= 1;
      await project.save();

      project.teamMembers = project.teamMembers.filter(id => id.toString() !== application.applicant.toString());
      await project.save();

      await createNotification({
        user: application.applicant,
        type: 'APPLICATION_STATUS',
        message: `Your application for role "${application.role}" in project "${project.title}" has been rejected.`,
        relatedProject: project._id,
        relatedApplication: application._id,
      });
    } else if (status === 'REJECTED' && oldStatus !== 'ACCEPTED') {
      await createNotification({
        user: application.applicant,
        type: 'APPLICATION_STATUS',
        message: `Your application for role "${application.role}" in project "${project.title}" has been rejected.`,
        relatedProject: project._id,
        relatedApplication: application._id,
      });
    }

    res.json({ message: `Application ${status.toLowerCase()} successfully`, application });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ==============================
// TEAM MANAGEMENT
// ==============================

// @desc    Get project team (owner + members)
// @route   GET /api/projects/:id/team
// @access  Public
const getProjectTeam = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id)
      .populate({
        path: 'owner',
        select: 'firstName lastName profilePhoto email role'
      })
      .populate({
        path: 'teamMembers',
        select: 'firstName lastName profilePhoto email role'
      })
      .lean();

    if (!project) return res.status(404).json({ message: 'Project not found' });

    if (project.owner?.profilePhoto && project.owner.profilePhoto.startsWith('users/')) {
      project.owner.profilePhoto = await getSignedUrl(process.env.SUPABASE_BUCKET_AVATAR, project.owner.profilePhoto);
    }
    if (project.teamMembers && project.teamMembers.length > 0) {
      for (let member of project.teamMembers) {
        if (member.profilePhoto && member.profilePhoto.startsWith('users/')) {
          member.profilePhoto = await getSignedUrl(process.env.SUPABASE_BUCKET_AVATAR, member.profilePhoto);
        }
      }
    }

    res.json({ owner: project.owner, members: project.teamMembers });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Remove a team member (owner only)
// @route   DELETE /api/projects/:id/team/:userId
// @access  Private
const removeTeamMember = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ message: 'Project not found' });
    if (project.owner.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized' });
    }
    const userId = req.params.userId;
    if (!project.teamMembers.includes(userId)) {
      return res.status(400).json({ message: 'User is not a team member' });
    }
    project.teamMembers = project.teamMembers.filter(id => id.toString() !== userId);
    await project.save();
    res.json({ message: 'Team member removed successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ==============================
// ✅ NEW FUNCTIONS (ADDED)
// ==============================

// @desc    Get user's projects (creator view with stats)
// @route   GET /api/projects/my
// @access  Private
const getUserProjects = async (req, res) => {
  try {
    const userId = req.user.id;
    
    const projects = await Project.find({ owner: userId })
      .populate('teamMembers', 'firstName lastName profilePhoto email role')
      .sort('-createdAt')
      .lean();

    const projectsWithStats = await Promise.all(projects.map(async (project) => {
      const applicants = await Application.find({ project: project._id });
      const acceptedCount = applicants.filter(a => a.status === 'ACCEPTED').length;
      const pendingCount = applicants.filter(a => a.status === 'PENDING').length;
      const views = project.views || 0;
      
      return {
        ...project,
        stats: {
          members: project.teamMembers.length,
          applicants: applicants.length,
          pending: pendingCount,
          accepted: acceptedCount,
          views
        }
      };
    }));

    res.json(projectsWithStats);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get project applications (with filtering)
// @route   GET /api/projects/:projectId/applications/filtered
// @access  Private
const getProjectApplicationsFiltered = async (req, res) => {
  try {
    const { projectId } = req.params;
    const { status = 'all' } = req.query;
    
    const project = await Project.findById(projectId);
    if (!project) return res.status(404).json({ message: 'Project not found' });
    if (project.owner.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    let filter = { project: projectId };
    if (status === 'pending') filter.status = 'PENDING';
    else if (status === 'reviewed') filter.status = { $in: ['ACCEPTED', 'REJECTED'] };

    const applications = await Application.find(filter)
      .populate('applicant', 'firstName lastName profilePhoto email bio externalLink skills role')
      .sort('-createdAt')
      .lean();

    const counts = {
      all: await Application.countDocuments({ project: projectId }),
      pending: await Application.countDocuments({ project: projectId, status: 'PENDING' }),
      reviewed: await Application.countDocuments({ 
        project: projectId, 
        status: { $in: ['ACCEPTED', 'REJECTED'] } 
      })
    };

    for (const app of applications) {
      if (app.cvPath) {
        app.cvUrl = await getSignedUrl(process.env.SUPABASE_BUCKET_RESUMES, app.cvPath, 3600);
        app.cvSize = app.cvPath ? '2.5 MB' : null;
        app.cvName = app.cvPath ? app.cvPath.split('/').pop() : null;
      }
    }

    res.json({
      applications,
      counts,
      projectDetails: {
        title: project.title,
        status: project.status,
        teamMembers: project.teamMembers
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get single application (for detailed view)
// @route   GET /api/applications/:applicationId
// @access  Private
const getApplicationDetails = async (req, res) => {
  try {
    const { applicationId } = req.params;
    
    const application = await Application.findById(applicationId)
      .populate('applicant', 'firstName lastName profilePhoto email bio externalLink skills role')
      .populate('project', 'title status owner')
      .lean();

    if (!application) return res.status(404).json({ message: 'Application not found' });

    const project = await Project.findById(application.project._id);
    if (project.owner.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    // Generate signed URL for CV (like profile photo)
    if (application.cvPath) {
      application.cvUrl = await getSignedUrl(
        process.env.SUPABASE_BUCKET_RESUMES,
        application.cvPath,
        3600
      );
    }

    // Generate signed URL for applicant profile photo
    if (application.applicant?.profilePhoto && application.applicant.profilePhoto.startsWith('users/')) {
      application.applicant.profilePhoto = await getSignedUrl(
        process.env.SUPABASE_BUCKET_AVATAR,
        application.applicant.profilePhoto,
        3600
      );
    }

    res.json(application);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  createProject,
  getProjects,
  getProjectById,
  getFeaturedProjects,
  getRecommendedProjects,
  updateProject,
  deleteProject,
  applyToProject,
  getProjectApplications,
  updateApplicationStatus,
  getProjectTeam,
  removeTeamMember,
  cvUpload,
  getUserProjects,
  getProjectApplicationsFiltered,
  getApplicationDetails
};