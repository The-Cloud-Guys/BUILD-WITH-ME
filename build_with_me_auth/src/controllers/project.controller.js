const Project = require('../models/project.model');
const Application = require('../models/application.model');
const User = require('../models/user.model');
const { uploadFile, deleteFile, getSignedUrl } = require('../services/supabase.service');
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

// @desc    Create a new project
// @route   POST /api/projects
// @access  Private
const createProject = async (req, res) => {
  try {
    const { title, description, requiredSkills, techStack, stage, developersNeeded } = req.body;

    // Validate required fields
    if (!title || !description || !requiredSkills || !techStack || !developersNeeded) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    const project = await Project.create({
      title,
      description,
      requiredSkills: Array.isArray(requiredSkills) ? requiredSkills : requiredSkills.split(','),
      techStack: Array.isArray(techStack) ? techStack : techStack.split(','),
      stage,
      developersNeeded,
      owner: req.user.id,
      teamMembers: [],
    });

    res.status(201).json({
      message: 'Project created successfully',
      project,
    });
  } catch (error) {
    console.error(error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get all projects with filters
// @route   GET /api/projects
// @access  Public (or private? for MVP, public)
const getProjects = async (req, res) => {
  try {
    const { page = 1, limit = 10, search, skill, tech, stage, tag } = req.query;
    const filter = {};

    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
      ];
    }
    if (skill) filter.requiredSkills = { $in: [skill] };
    if (tech) filter.techStack = { $in: [tech] };
    if (stage) filter.stage = stage;
    if (tag) {
      // tag can be skill or tech – combine
      filter.$or = [
        { requiredSkills: { $in: [tag] } },
        { techStack: { $in: [tag] } },
      ];
    }

    const projects = await Project.find(filter)
      .populate('owner', 'firstName lastName profilePhoto')
      .sort('-createdAt')
      .limit(limit * 1)
      .skip((page - 1) * limit)
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
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
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

// @desc    Update project (owner only)
// @route   PUT /api/projects/:id
// @access  Private
const updateProject = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ message: 'Project not found' });

    if (project.owner.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized to update this project' });
    }

    const { title, description, requiredSkills, techStack, stage, developersNeeded } = req.body;

    if (title) project.title = title;
    if (description) project.description = description;
    if (requiredSkills) project.requiredSkills = Array.isArray(requiredSkills) ? requiredSkills : requiredSkills.split(',');
    if (techStack) project.techStack = Array.isArray(techStack) ? techStack : techStack.split(',');
    if (stage) project.stage = stage;
    if (developersNeeded) project.developersNeeded = developersNeeded;

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

// @desc    Apply to a project (with CV upload)
// @route   POST /api/projects/:id/apply
// @access  Private
const applyToProject = async (req, res) => {
  // Use multer middleware in route
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ message: 'Project not found' });

    // Check if user already applied
    const existing = await Application.findOne({ project: project._id, applicant: req.user.id });
    if (existing) return res.status(400).json({ message: 'You have already applied to this project' });

    const { message, portfolioLink } = req.body;
    if (!message) return res.status(400).json({ message: 'Application message is required' });

    let cvPath = null;
    if (req.file) {
      const filePath = generateCVPath(req.user.id, project._id, req.file.originalname);
      await uploadFile('resumes', filePath, req.file.buffer, req.file.mimetype);
      cvPath = filePath;
    }

    const application = await Application.create({
      project: project._id,
      applicant: req.user.id,
      message,
      portfolioLink: portfolioLink || '',
      cvPath,
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

    application.status = status;
    await application.save();

    // If accepted, add applicant to project teamMembers
    if (status === 'ACCEPTED') {
      if (!project.teamMembers.includes(application.applicant)) {
        project.teamMembers.push(application.applicant);
        await project.save();
      }
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
  updateProject,
  deleteProject,
  applyToProject,
  getProjectApplications,
  updateApplicationStatus,
  getProjectTeam,
  removeTeamMember,
  cvUpload, // export for use in routes
};