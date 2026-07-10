const Project = require('../models/project.model');
const Application = require('../models/application.model');
const User = require('../models/user.model');
const { uploadFile, deleteFile, getSignedUrl } = require('../services/supabase.service');
const { createNotification } = require('../services/notification.service');
const multer = require('multer');
const path = require('path');

// Configure multer for CV upload (memory storage)
const cvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = /pdf|doc|docx/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (mimetype && extname) return cb(null, true);
    cb(new Error('Only PDF, DOC, DOCX files are allowed'));
  },
});

// Helper to generate CV path
const generateCVPath = (userId, projectId, originalName) => {
  const timestamp = Date.now();
  const ext = path.extname(originalName);
  return `resumes/${userId}/${projectId}/cv_${timestamp}${ext}`;
};

// ==============================
// PROJECT CRUD
// ==============================

const isRoleAvailable = (project, roleName) => {
  const role = project.roles.find(r => r.roleName === roleName);
  return role && role.currentCount < role.requiredCount;
};

// @desc    Create a new project
// @route   POST /api/projects
// @access  Private
const createProject = async (req, res) => {
  try {
    const { title, description, requiredSkills, techStack, stage, roles } = req.body;

    if (!roles || !Array.isArray(roles) || roles.length === 0) {
      return res.status(400).json({ message: 'At least one role is required' });
    }

    // Validate each role
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

    // Search (title, description, requiredSkills, techStack, roleName)
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

    // If both $or from search and tag exist, combine them
    if (filter.$or && filter.$or.length > 0) {
      // Merge with existing $or (if any)
    }

    const projects = await Project.find(filter)
      .populate('owner', 'firstName lastName profilePhoto email')
      .sort('-createdAt')
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit))
      .lean();

    // Convert profilePhoto to signed URL if needed
    for (let p of projects) {
      if (p.owner?.profilePhoto && p.owner.profilePhoto.startsWith('users/')) {
        p.owner.profilePhoto = await getSignedUrl(process.env.SUPABASE_BUCKET_AVATAR, p.owner.profilePhoto);
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
      .populate('owner', 'firstName lastName profilePhoto email')
      .populate('teamMembers', 'firstName lastName profilePhoto email')
      .lean();

    if (!project) return res.status(404).json({ message: 'Project not found' });

    // Convert profile photos to signed URLs
    if (project.owner?.profilePhoto && project.owner.profilePhoto.startsWith('users/')) {
      project.owner.profilePhoto = await getSignedUrl(process.env.SUPABASE_BUCKET_AVATAR, project.owner.profilePhoto);
    }
    for (let member of project.teamMembers) {
      if (member.profilePhoto && member.profilePhoto.startsWith('users/')) {
        member.profilePhoto = await getSignedUrl(process.env.SUPABASE_BUCKET_AVATAR, member.profilePhoto);
      }
    }

    res.json(project);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get featured projects (sorted by number of applications + recency)
// @route   GET /api/projects/featured
// @access  Public
const getFeaturedProjects = async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    // Aggregate: project with application count
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
      { $unwind: '$owner' }
    ]);

    // Convert profile photos to signed URLs
    for (let p of featured) {
      if (p.owner?.profilePhoto && p.owner.profilePhoto.startsWith('users/')) {
        p.owner.profilePhoto = await getSignedUrl(process.env.SUPABASE_BUCKET_AVATAR, p.owner.profilePhoto);
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
  try {
    const user = await User.findById(req.user.id).select('skills role');
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Get IDs of projects user already applied to or is a member of
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
      .populate('owner', 'firstName lastName profilePhoto email')
      .sort('-createdAt')
      .limit(20)
      .lean();

    for (let p of projects) {
      if (p.owner?.profilePhoto && p.owner.profilePhoto.startsWith('users/')) {
        p.owner.profilePhoto = await getSignedUrl(process.env.SUPABASE_BUCKET_AVATAR, p.owner.profilePhoto);
      }
    }

    res.json(projects);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
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

    const { title, description, requiredSkills, techStack, stage, roles } = req.body;

    if (title) project.title = title;
    if (description) project.description = description;
    if (requiredSkills) project.requiredSkills = Array.isArray(requiredSkills) ? requiredSkills : requiredSkills.split(',');
    if (techStack) project.techStack = Array.isArray(techStack) ? techStack : techStack.split(',');
    if (stage) project.stage = stage;
    if (roles) {
      // Validate roles: cannot reduce requiredCount below currentCount if there are existing applications
      for (let newRole of roles) {
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
      return res.status(403).json({ message: 'Not authorized to delete this project' });
    }

    // Delete all associated applications (optional)
    await Application.deleteMany({ project: project._id });

    // Delete project
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
// @desc    Apply to project (with CV)
// @route   POST /api/projects/:id/apply
// @access  Private
const applyToProject = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const { message, portfolioLink, role } = req.body;
    if (!message) return res.status(400).json({ message: 'Application message is required' });
    if (!role) return res.status(400).json({ message: 'Role is required' });

    // Check if role exists and has capacity
    const roleObj = project.roles.find(r => r.roleName === role);
    if (!roleObj) {
      return res.status(400).json({ message: 'Invalid role for this project' });
    }
    if (roleObj.currentCount >= roleObj.requiredCount) {
      return res.status(400).json({ message: 'This role is already filled' });
    }

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

    // Notify project owner
    await createNotification({
      user: project.owner,
      type: 'NEW_APPLICATION',
      message: `New application from ${req.user.firstName} ${req.user.lastName} for role "${role}" in project "${project.title}".`,
      relatedProject: project._id,
      relatedApplication: application._id,
    });

    res.status(201).json({
      message: `Application sent to ${project.title}`,
      application,
    });
  } catch (error) {
    console.error(error);
    if (error.code === 11000) {
      return res.status(400).json({ message: 'You have already applied to this project' });
    }
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get applications for a project (owner only)
// @route   GET /api/projects/:id/applications
// @access  Private
const getProjectApplications = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ message: 'Project not found' });

    if (project.owner.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const applications = await Application.find({ project: project._id })
      .populate('applicant', 'firstName lastName email profilePhoto')
      .sort('-createdAt');

    // Generate signed URLs for CVs and profile photos
    for (let app of applications) {
      if (app.cvPath) {
        app.cvUrl = await getSignedUrl('resumes', app.cvPath, 3600);
      }
      if (app.applicant?.profilePhoto && app.applicant.profilePhoto.startsWith('users/')) {
        app.applicant.profilePhoto = await getSignedUrl(process.env.SUPABASE_BUCKET_AVATAR, app.applicant.profilePhoto);
      }
    }

    res.json(applications);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Update application status (accept/reject)
// @route   PUT /api/applications/:id
// @access  Private (project owner only)
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
      // Increment currentCount
      project.roles[roleIndex].currentCount += 1;
      await project.save();

      // Add user to teamMembers
      if (!project.teamMembers.includes(application.applicant)) {
        project.teamMembers.push(application.applicant);
        await project.save();
      }

      // Notify applicant
      await createNotification({
        user: application.applicant,
        type: 'APPLICATION_STATUS',
        message: `Your application for role "${application.role}" in project "${project.title}" has been accepted.`,
        relatedProject: project._id,
        relatedApplication: application._id,
      });

      // If role is now filled, notify owner
      const role = project.roles[roleIndex];
      if (role.currentCount === role.requiredCount) {
        await createNotification({
          user: project.owner,
          type: 'ROLE_FILLED',
          message: `Role "${role.roleName}" in project "${project.title}" is now filled.`,
          relatedProject: project._id,
        });
      }
    } 
    else if (status === 'REJECTED' && oldStatus === 'ACCEPTED') {
      // Decrement currentCount (if previously accepted)
      project.roles[roleIndex].currentCount -= 1;
      await project.save();

      // Remove from teamMembers
      project.teamMembers = project.teamMembers.filter(id => id.toString() !== application.applicant.toString());
      await project.save();

      // Notify applicant
      await createNotification({
        user: application.applicant,
        type: 'APPLICATION_STATUS',
        message: `Your application for role "${application.role}" in project "${project.title}" has been rejected.`,
        relatedProject: project._id,
        relatedApplication: application._id,
      });
    }
    else if (status === 'REJECTED' && oldStatus !== 'ACCEPTED') {
      // No capacity change, just notify
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
// @access  Public (or private)
const getProjectTeam = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id)
      .populate('owner', 'firstName lastName profilePhoto email')
      .populate('teamMembers', 'firstName lastName profilePhoto email');
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const ownerObj = project.owner.toObject();
    if (ownerObj.profilePhoto && ownerObj.profilePhoto.startsWith('users/')) {
      ownerObj.profilePhoto = await getSignedUrl(process.env.SUPABASE_BUCKET_AVATAR, ownerObj.profilePhoto);
    }
    const members = await Promise.all(project.teamMembers.map(async (member) => {
      const m = member.toObject();
      if (m.profilePhoto && m.profilePhoto.startsWith('users/')) {
        m.profilePhoto = await getSignedUrl(process.env.SUPABASE_BUCKET_AVATAR, m.profilePhoto);
      }
      return m;
    }));

    res.json({ owner: ownerObj, members });
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
  cvUpload,// export for use in routes
};