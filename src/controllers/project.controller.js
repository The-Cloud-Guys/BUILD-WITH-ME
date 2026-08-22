const mongoose = require('mongoose');
const path = require('path');
const multer = require('multer');
const Project = require('../models/project.model');
const Application = require('../models/application.model');
const User = require('../models/user.model');
const Notification = require('../models/notification.model');
const { createNotification } = require('../services/notification.service');
const { uploadFile, deleteFile, getSignedUrl } = require('../services/supabase.service');
const { syncProjectTeamRoom } = require('../services/projectTeamRoom.service');

// ==============================
// CV MULTER CONFIGURATION (UPDATED)
// ==============================

const CV_TYPES = {
  '.pdf': ['application/pdf', 'application/octet-stream'],
  '.doc': [
    'application/msword',
    'application/x-ole-storage',
    'application/octet-stream',
  ],
  '.docx': [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/zip',
    'application/x-zip-compressed',
    'application/octet-stream',
  ],
  '.txt': ['text/plain', 'application/octet-stream'],
};

const CV_STORAGE_CONTENT_TYPES = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain',
};

const getCvStorageContentType = (filename) =>
  CV_STORAGE_CONTENT_TYPES[path.extname(filename).toLowerCase()];

const invalidCvTypeError = () => {
  const error = new Error('Only PDF, DOC, DOCX, and TXT files are allowed');
  error.statusCode = 400;
  error.code = 'INVALID_CV_FILE_TYPE';
  return error;
};

const cvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedMimeTypes = CV_TYPES[ext];
    const mimeType = String(file.mimetype || '').toLowerCase().split(';')[0].trim();

    if (!allowedMimeTypes || !allowedMimeTypes.includes(mimeType)) {
      return cb(invalidCvTypeError());
    }

    return cb(null, true);
  },
});

// ==============================
// HELPER FUNCTIONS
// ==============================

const generateCVPath = (userId, projectId, originalName) => {
  const timestamp = Date.now();
  const ext = path.extname(originalName);
  return `users/${userId}/projects/${projectId}/cv_${timestamp}${ext}`;
};

const getSignedUrlForFile = async (bucket, filePath) => {
  try {
    if (!filePath) return null;
    return await getSignedUrl(bucket, filePath);
  } catch (error) {
    console.error('Signed URL generation failed:', error.message);
    return null;
  }
};

// ==============================
// PROJECT CRUD (KEPT)
// ==============================

// @desc Create a new project
// @route POST /api/projects
// @access Private
const createProject = async (req, res) => {
  try {
    const {
      title,
      description,
      requiredSkills,
      techStack,
      roles,
      stage,
      status,
    } = req.body;

    if (!title || !description) {
      return res.status(400).json({ message: 'Title and description are required' });
    }

    let parsedRoles = roles;
    if (typeof roles === 'string') {
      try {
        parsedRoles = JSON.parse(roles);
      } catch (err) {
        return res.status(400).json({ message: 'Invalid roles format' });
      }
    }

    if (!Array.isArray(parsedRoles) || parsedRoles.length === 0) {
      return res.status(400).json({ message: 'At least one role is required' });
    }

    const project = await Project.create({
      title: title.trim(),
      description: description.trim(),
      requiredSkills: Array.isArray(requiredSkills)
        ? requiredSkills.map(s => String(s).trim())
        : String(requiredSkills || '')
            .split(',')
            .map(s => s.trim())
            .filter(Boolean),
      techStack: Array.isArray(techStack)
        ? techStack.map(s => String(s).trim())
        : String(techStack || '')
            .split(',')
            .map(s => s.trim())
            .filter(Boolean),
      stage: stage || 'IDEA',
      status: status || 'OPEN',
      owner: req.user.id,
      teamMembers: [], // Owner is not automatically a team member
      roles: parsedRoles.map(role => ({
        roleName: role.roleName.trim(),
        requiredCount: parseInt(role.requiredCount) || 1,
        currentCount: 0,
        description: role.description?.trim() || '',
      })),
    });

    await project.populate('owner', 'firstName lastName profilePhoto email');

    res.status(201).json({
      message: 'Project created successfully',
      project,
    });
  } catch (error) {
    console.error('Create project error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc Get all projects (with filters)
// @route GET /api/projects
// @access Public
const getProjects = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      search = '', 
      stage = 'all',
      status = 'all',
      techStack = 'all'
    } = req.query;

    const filter = { isHidden: { $ne: true } };

    // Search
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { techStack: { $regex: search, $options: 'i' } }
      ];
    }

    // Stage filter
    if (stage !== 'all') filter.stage = stage;

    // Status filter
    if (status !== 'all') filter.status = status;

    // Tech stack filter
    if (techStack !== 'all') {
      filter.techStack = { $in: [techStack] };
    }

    const projects = await Project.find(filter)
      .populate('owner', 'firstName lastName profilePhoto email')
      .populate('teamMembers', 'firstName lastName profilePhoto email')
      .sort('-createdAt')
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .lean();

    // Get signed URLs for profile photos
    const projectsWithUrls = await Promise.all(
      projects.map(async (project) => ({
        ...project,
        owner: {
          ...project.owner,
          profilePhoto: project.owner?.profilePhoto ? 
            await getSignedUrlForFile(process.env.SUPABASE_BUCKET_AVATAR, project.owner.profilePhoto) : 
            null
        },
        teamMembers: await Promise.all(
          project.teamMembers.map(async (member) => ({
            ...member,
            profilePhoto: member?.profilePhoto ? 
              await getSignedUrlForFile(process.env.SUPABASE_BUCKET_AVATAR, member.profilePhoto) : 
              null
          }))
        )
      }))
    );

    const total = await Project.countDocuments(filter);

    res.json({
      projects: projectsWithUrls,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total
      }
    });
  } catch (error) {
    console.error('Get projects error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc Get single project
// @route GET /api/projects/:id
// @access Public
const getProjectById = async (req, res) => {
  try {
    const project = await Project.findOneAndUpdate(
      { _id: req.params.id, isHidden: { $ne: true } },
      { $inc: { views: 1 } },
      { new: true }
    )
      .populate('owner', 'firstName lastName profilePhoto email')
      .populate('teamMembers', 'firstName lastName profilePhoto email')
      .lean();

    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    // Get signed URLs
    const projectWithUrls = {
      ...project,
      owner: {
        ...project.owner,
        profilePhoto: project.owner?.profilePhoto ? 
          await getSignedUrlForFile(process.env.SUPABASE_BUCKET_AVATAR, project.owner.profilePhoto) : 
          null
      },
      teamMembers: await Promise.all(
        project.teamMembers.map(async (member) => ({
          ...member,
          profilePhoto: member?.profilePhoto ? 
            await getSignedUrlForFile(process.env.SUPABASE_BUCKET_AVATAR, member.profilePhoto) : 
            null
        }))
      )
    };

    res.json(projectWithUrls);
  } catch (error) {
    console.error('Get project error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc Update project
// @route PUT /api/projects/:id
// @access Private
const updateProject = async (req, res) => {
  try {
    const project = await Project.findOne({
      _id: req.params.id,
      isHidden: { $ne: true },
    });

    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    if (project.owner.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized to update this project' });
    }

    const {
      title,
      description,
      requiredSkills,
      techStack,
      roles,
      stage,
      status,
    } = req.body;

    // Basic fields
    if (title) project.title = title.trim();
    if (description) project.description = description.trim();

    if (requiredSkills) {
      project.requiredSkills = Array.isArray(requiredSkills)
        ? requiredSkills.map(s => String(s).trim())
        : String(requiredSkills)
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);
    }

    if (techStack) {
      project.techStack = Array.isArray(techStack)
        ? techStack.map(s => String(s).trim())
        : String(techStack)
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);
    }

    if (stage) project.stage = stage;

    if (status) {
      const allowedStatuses = ['OPEN', 'ACTIVE', 'CLOSED', 'COMPLETED'];
      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({ message: 'Invalid project status' });
      }
      project.status = status;
    }

    // Roles - server-controlled currentCount
    if (roles) {
      let parsedRoles = roles;
      if (typeof roles === 'string') {
        try {
          parsedRoles = JSON.parse(roles);
        } catch {
          return res.status(400).json({ message: 'Invalid roles format' });
        }
      }

      if (!Array.isArray(parsedRoles) || parsedRoles.length === 0) {
        return res.status(400).json({ message: 'At least one role is required' });
      }

      // Get existing role counts
      const existingRoles = new Map(
        project.roles.map(role => [
          role.roleName.trim().toLowerCase(),
          { currentCount: role.currentCount || 0, requiredCount: role.requiredCount },
        ])
      );

      // Prevent deleting occupied roles
      const incomingNames = new Set(
        parsedRoles.map(role => role.roleName.trim().toLowerCase())
      );

      for (const oldRole of project.roles) {
        if (oldRole.currentCount > 0 && !incomingNames.has(oldRole.roleName.trim().toLowerCase())) {
          return res.status(409).json({
            message: `Cannot remove "${oldRole.roleName}" because it has accepted team members`,
          });
        }
      }

      const updatedRoles = [];
      for (const role of parsedRoles) {
        const roleName = String(role.roleName || '').trim();
        if (!roleName) {
          return res.status(400).json({ message: 'Every role must have a roleName' });
        }

        const requiredCount = parseInt(role.requiredCount, 10) || 1;
        const previous = existingRoles.get(roleName.toLowerCase());
        const currentCount = previous?.currentCount || 0;

        if (requiredCount < currentCount) {
          return res.status(409).json({
            message: `"${roleName}" already has ${currentCount} accepted member(s); requiredCount cannot be reduced below that`,
          });
        }

        updatedRoles.push({
          roleName,
          requiredCount,
          currentCount, // Server-controlled
          description: String(role.description || '').trim(),
        });
      }

      project.roles = updatedRoles;
    }

    await project.save();
    await project.populate('owner', 'firstName lastName profilePhoto email');

    res.json({
      message: 'Project updated successfully',
      project,
    });
  } catch (error) {
    console.error('Update project error:', error);
    res.status(500).json({ message: error.message || 'Server error' });
  }
};

// @desc Delete project
// @route DELETE /api/projects/:id
// @access Private
const deleteProject = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);

    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    // Check ownership
    if (project.owner.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized to delete this project' });
    }

    await project.deleteOne();

    res.json({ message: 'Project deleted successfully' });
  } catch (error) {
    console.error('Delete project error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ==============================
// APPLY TO PROJECT (UPDATED)
// ==============================

const applyToProject = async (req, res) => {
  try {
    const project = await Project.findOne({
      _id: req.params.id,
      isHidden: { $ne: true },
    });
    if (!project) return res.status(404).json({ message: 'Project not found' });

    if (project.status === 'CLOSED' || project.status === 'COMPLETED') {
      return res.status(400).json({
        message: 'This project is not accepting applications',
      });
    }

    if (project.owner.toString() === req.user.id) {
      return res.status(400).json({
        message: 'Project owner cannot apply to their own project',
      });
    }

    if (project.teamMembers.some((id) => id.toString() === req.user.id)) {
      return res.status(409).json({
        message: 'You are already a member of this project',
      });
    }

    const { message, portfolioLink, role } = req.body;

    if (!message?.trim()) {
      return res.status(400).json({
        message: 'Application message is required',
      });
    }

    if (!role?.trim()) {
      return res.status(400).json({ message: 'Role is required' });
    }

    const selectedRole = project.roles.find(
      (r) => r.roleName.toLowerCase() === role.trim().toLowerCase()
    );

    if (!selectedRole) {
      return res.status(400).json({
        message: 'Invalid role for this project',
      });
    }

    if (selectedRole.currentCount >= selectedRole.requiredCount) {
      return res.status(400).json({ message: 'Role is filled' });
    }

    const existing = await Application.findOne({
      project: project._id,
      applicant: req.user.id,
    });

    if (existing) {
      return res.status(409).json({
        message: 'You have already applied to this project',
      });
    }

    let cvPath = null;

    if (req.file) {
      const filePath = generateCVPath(
        req.user.id,
        project._id,
        req.file.originalname
      );

      await uploadFile(
        process.env.SUPABASE_BUCKET_RESUMES,
        filePath,
        req.file.buffer,
        getCvStorageContentType(req.file.originalname)
      );

      cvPath = filePath;
    }

    const application = await Application.create({
      project: project._id,
      applicant: req.user.id,
      role: selectedRole.roleName,
      message: message.trim(),
      portfolioLink: portfolioLink?.trim() || '',
      cvPath,
      status: 'PENDING',
    });

    await createNotification({
      user: project.owner,
      type: 'NEW_APPLICATION',
      message: `New application for role "${selectedRole.roleName}" in project "${project.title}".`,
      relatedProject: project._id,
      relatedApplication: application._id,
    });

    return res.status(201).json({
      message: `Application sent to ${project.title}`,
      application,
    });
  } catch (error) {
    console.error('Apply error:', error);

    if (error.code === 11000) {
      return res.status(409).json({
        message: 'You have already applied to this project',
      });
    }

    return res.status(500).json({ message: 'Server error' });
  }
};

// ==============================
// UPDATE APPLICATION STATUS
// ==============================

const updateApplicationStatus = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const requestedStatus = String(req.body.status || '').toUpperCase();

    if (!['ACCEPTED', 'REJECTED'].includes(requestedStatus)) {
      return res.status(400).json({
        message: 'Status must be ACCEPTED or REJECTED',
      });
    }

    let applicationForResponse;
    let statusChanged = false;

    await session.withTransaction(async () => {
      const application = await Application.findById(req.params.id)
        .session(session);

      if (!application) {
        const err = new Error('Application not found');
        err.statusCode = 404;
        throw err;
      }

      const project = await Project.findById(application.project)
        .session(session);

      if (!project) {
        const err = new Error('Project not found');
        err.statusCode = 404;
        throw err;
      }

      if (project.owner.toString() !== req.user.id) {
        const err = new Error('Not authorized');
        err.statusCode = 403;
        throw err;
      }

      const roleIndex = project.roles.findIndex(
        (r) => r.roleName === application.role
      );

      if (roleIndex === -1) {
        const err = new Error(
          'Application role no longer exists on this project'
        );
        err.statusCode = 409;
        throw err;
      }

      const oldStatus = application.status;

      if (oldStatus === requestedStatus) {
        applicationForResponse = application;
        return;
      }

      const role = project.roles[roleIndex];
      const applicantId = application.applicant.toString();
      const memberIndex = project.teamMembers.findIndex(
        (id) => id.toString() === applicantId
      );

      if (requestedStatus === 'ACCEPTED' && oldStatus !== 'ACCEPTED') {
        if (role.currentCount >= role.requiredCount) {
          const err = new Error('Role is filled');
          err.statusCode = 409;
          throw err;
        }

        role.currentCount += 1;

        if (memberIndex === -1) {
          project.teamMembers.push(application.applicant);
        }
      }

      if (requestedStatus === 'REJECTED' && oldStatus === 'ACCEPTED') {
        role.currentCount = Math.max(0, role.currentCount - 1);

        if (memberIndex !== -1) {
          project.teamMembers.splice(memberIndex, 1);
        }
      }

      application.status = requestedStatus;
      statusChanged = true;

      await project.save({ session });
      await application.save({ session });
      await syncProjectTeamRoom(project, session);

      applicationForResponse = application;
    });

    if (!statusChanged) {
      return res.json({
        message: `Application ${applicationForResponse.status.toLowerCase()} successfully`,
        application: applicationForResponse,
      });
    }

    const application = await Application.findById(req.params.id);
    const project = await Project.findById(application.project);

    await createNotification({
      user: application.applicant,
      type: 'APPLICATION_STATUS',
      message: `Your application for "${application.role}" in "${project.title}" was ${application.status.toLowerCase()}.`,
      relatedProject: project._id,
      relatedApplication: application._id,
    });

    const role = project.roles.find((r) => r.roleName === application.role);

    if (
      application.status === 'ACCEPTED' &&
      role &&
      role.currentCount >= role.requiredCount
    ) {
      await createNotification({
        user: project.owner,
        type: 'ROLE_FILLED',
        message: `Role "${role.roleName}" in "${project.title}" is now filled.`,
        relatedProject: project._id,
        relatedApplication: application._id,
      });
    }

    return res.json({
      message: `Application ${application.status.toLowerCase()} successfully`,
      application: applicationForResponse,
    });
  } catch (error) {
    console.error('Update application status error:', error);

    return res
      .status(error.statusCode || 500)
      .json({ message: error.message || 'Server error' });
  } finally {
    await session.endSession();
  }
};

// ==============================
// GET APPLICATIONS
// ==============================

// @desc Get applications for a project
// @route GET /api/projects/:id/applications
// @access Private (Project owner only)
// ==============================
// GET PROJECT APPLICATIONS
// ==============================

const getProjectApplications = async (req, res) => {
  try {
    const { id } = req.params;
    const { status = 'all', search = '', page = 1, limit = 20 } = req.query;

    // Validate ID
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: 'Invalid project ID' });
    }

    // Find project
    const project = await Project.findById(id)
      .populate('teamMembers', 'firstName lastName profilePhoto email role')
      .lean();

    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    // Owner authorization
    if (project.owner.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized to view applications' });
    }

    // Pagination
    const pageNumber = Math.max(parseInt(page, 10) || 1, 1);
    const pageLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

    // Build filter
    const filter = { project: project._id };

    const normalizedStatus = String(status).toUpperCase();
    if (normalizedStatus !== 'ALL') {
      const allowedStatuses = ['PENDING', 'ACCEPTED', 'REJECTED'];
      if (!allowedStatuses.includes(normalizedStatus)) {
        return res.status(400).json({
          message: 'Status must be all, PENDING, ACCEPTED, or REJECTED',
        });
      }
      filter.status = normalizedStatus;
    }

    if (search.trim()) {
      filter.$or = [
        { message: { $regex: search.trim(), $options: 'i' } },
        { role: { $regex: search.trim(), $options: 'i' } },
      ];
    }

    // Query + counts
    const [applications, filteredTotal, all, pending, accepted, rejected] = await Promise.all([
      Application.find(filter)
        .populate(
          'applicant',
          'firstName lastName profilePhoto email bio externalLink skills role'
        )
        .sort('-createdAt')
        .skip((pageNumber - 1) * pageLimit)
        .limit(pageLimit)
        .lean(),

      Application.countDocuments(filter),
      Application.countDocuments({ project: project._id }),
      Application.countDocuments({ project: project._id, status: 'PENDING' }),
      Application.countDocuments({ project: project._id, status: 'ACCEPTED' }),
      Application.countDocuments({ project: project._id, status: 'REJECTED' }),
    ]);

    // Signed URLs
    const applicationsWithUrls = await Promise.all(
      applications.map(async (app) => ({
        ...app,
        applicant: app.applicant
          ? {
              ...app.applicant,
              profilePhoto: app.applicant.profilePhoto
                ? await getSignedUrlForFile(
                    process.env.SUPABASE_BUCKET_AVATAR,
                    app.applicant.profilePhoto
                  )
                : null,
            }
          : null,
        cvUrl: app.cvPath
          ? await getSignedUrlForFile(process.env.SUPABASE_BUCKET_RESUMES, app.cvPath)
          : null,
        cvName: app.cvPath ? app.cvPath.split('/').pop() : null,
      }))
    );

    res.json({
      applications: applicationsWithUrls,
      counts: { all, pending, accepted, rejected },
      projectDetails: {
        _id: project._id,
        title: project.title,
        status: project.status || 'OPEN',
        teamMembers: project.teamMembers || [],
        roles: project.roles || [],
      },
      pagination: {
        page: pageNumber,
        limit: pageLimit,
        total: filteredTotal,
        totalPages: Math.ceil(filteredTotal / pageLimit),
      },
    });
  } catch (error) {
    console.error('Get project applications error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc Get user's applications
// @route GET /api/projects/applications/me
// @access Private
const getMyApplications = async (req, res) => {
  try {
    const applications = await Application.find({ applicant: req.user.id })
      .populate('project', 'title description stage status owner')
      .populate('applicant', 'firstName lastName profilePhoto')
      .sort('-createdAt')
      .lean();

    res.json(applications);
  } catch (error) {
    console.error('Get my applications error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ==============================
// GET PROJECT TEAM (RESTORE)
// ==============================

// @desc Get project team members
// @route GET /api/projects/:id/team
// @access Public
const getProjectTeam = async (req, res) => {
  try {
    const project = await Project.findOne({
      _id: req.params.id,
      isHidden: { $ne: true },
    })
      .populate('owner', 'firstName lastName profilePhoto email role skills')
      .populate('teamMembers', 'firstName lastName profilePhoto email role skills')
      .lean();

    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    // Get signed URLs for owner and team member photos
    const ownerWithPhoto = {
      ...project.owner,
      profilePhoto: project.owner?.profilePhoto ? 
        await getSignedUrlForFile(process.env.SUPABASE_BUCKET_AVATAR, project.owner.profilePhoto) : 
        null
    };

    const membersWithPhotos = await Promise.all(
      project.teamMembers.map(async (member) => ({
        ...member,
        profilePhoto: member?.profilePhoto ? 
          await getSignedUrlForFile(process.env.SUPABASE_BUCKET_AVATAR, member.profilePhoto) : 
          null
      }))
    );

    res.json({
      owner: ownerWithPhoto,
      members: membersWithPhotos,
      count: membersWithPhotos.length
    });
  } catch (error) {
    console.error('Get project team error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ==============================
// REMOVE TEAM MEMBER (RESTORE WITH ROLE COUNT FIX)
// ==============================

// @desc Remove a team member from project
// @route DELETE /api/projects/:id/team/:userId
// @access Private (Project owner only)
const removeTeamMember = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    let project;
    await session.withTransaction(async () => {
      project = await Project.findById(req.params.id).session(session);
      if (!project) {
        const error = new Error('Project not found');
        error.statusCode = 404;
        throw error;
      }
      if (project.owner.toString() !== req.user.id) {
        const error = new Error('Not authorized to remove team members');
        error.statusCode = 403;
        throw error;
      }
      if (req.params.userId === project.owner.toString()) {
        const error = new Error('Cannot remove the project owner');
        error.statusCode = 400;
        throw error;
      }

      const memberIndex = project.teamMembers.findIndex(
        (id) => id.toString() === req.params.userId
      );
      if (memberIndex === -1) {
        const error = new Error('Team member not found');
        error.statusCode = 404;
        throw error;
      }

      const application = await Application.findOne({
        project: project._id,
        applicant: req.params.userId,
        status: 'ACCEPTED',
      }).session(session);

      project.teamMembers.splice(memberIndex, 1);
      if (application) {
        const role = project.roles.find((item) => item.roleName === application.role);
        if (role) role.currentCount = Math.max(0, role.currentCount - 1);
        application.status = 'REJECTED';
        await application.save({ session });
      }
      await project.save({ session });
      await syncProjectTeamRoom(project, session);
    });

    await createNotification({
      user: req.params.userId,
      type: 'TEAM_REMOVED',
      message: `You have been removed from project "${project.title}"`,
      relatedProject: project._id,
    });

    res.json({ 
      message: 'Team member removed successfully',
      teamMembers: project.teamMembers,
      roles: project.roles
    });
  } catch (error) {
    console.error('Remove team member error:', error);
    res.status(error.statusCode || 500).json({ message: error.message || 'Server error' });
  } finally {
    await session.endSession();
  }
};

// ==============================
// GET USER PROJECTS
// ==============================
const getUserProjects = async (req, res) => {
  try {
    const projects = await Project.find({ owner: req.user.id })
      .populate('owner', 'firstName lastName profilePhoto email')
      .populate('teamMembers', 'firstName lastName profilePhoto email role')
      .sort('-createdAt')
      .lean();

    const projectsWithDetails = await Promise.all(
      projects.map(async (project) => {
        const [applicants, pending, accepted] = await Promise.all([
          Application.countDocuments({ project: project._id }),
          Application.countDocuments({ project: project._id, status: 'PENDING' }),
          Application.countDocuments({ project: project._id, status: 'ACCEPTED' }),
        ]);

        return {
          ...project,
          status: project.status || 'OPEN', // ✅ Critical fallback
          owner: project.owner
            ? {
                ...project.owner,
                profilePhoto: project.owner.profilePhoto
                  ? await getSignedUrlForFile(
                      process.env.SUPABASE_BUCKET_AVATAR,
                      project.owner.profilePhoto
                    )
                  : null,
              }
            : null,
          teamMembers: await Promise.all(
            (project.teamMembers || []).map(async (member) => ({
              ...member,
              profilePhoto: member.profilePhoto
                ? await getSignedUrlForFile(
                    process.env.SUPABASE_BUCKET_AVATAR,
                    member.profilePhoto
                  )
                : null,
            }))
          ),
          stats: {
            members: project.teamMembers?.length || 0,
            applicants,
            pending,
            accepted,
            views: project.views || 0,
          },
        };
      })
    );

    res.json(projectsWithDetails);
  } catch (error) {
    console.error('Get user projects error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};


// ==============================
// GET FEATURED PROJECTS
// ==============================

// @desc Get featured projects ranked by application count
// @route GET /api/projects/featured
// @access Public
const getFeaturedProjects = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;

    // Aggregate to get projects with application count
    const featuredProjects = await Project.aggregate([
      { $match: { status: 'OPEN', isHidden: { $ne: true } } },
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
      { $sort: { applicationCount: -1, createdAt: -1 } },
      { $limit: limit },
      {
        $project: {
          _id: 1,
          title: 1,
          description: 1,
          techStack: 1,
          requiredSkills: 1,
          roles: 1,
          stage: 1,
          status: 1,
          owner: 1,
          teamMembers: 1,
          applicationCount: 1,
          createdAt: 1
        }
      }
    ]);

    // Populate owner and team members
    const projectIds = featuredProjects.map(p => p._id);
    const populatedProjects = await Project.find({ _id: { $in: projectIds } })
      .populate('owner', 'firstName lastName profilePhoto email')
      .populate('teamMembers', 'firstName lastName profilePhoto email')
      .lean();

    // Merge aggregated data with populated data
    const result = await Promise.all(
      populatedProjects.map(async (project) => {
        const aggData = featuredProjects.find(p => p._id.toString() === project._id.toString());
        
        return {
          ...project,
          applicationCount: aggData?.applicationCount || 0,
          owner: {
            ...project.owner,
            profilePhoto: project.owner?.profilePhoto ? 
              await getSignedUrlForFile(process.env.SUPABASE_BUCKET_AVATAR, project.owner.profilePhoto) : 
              null
          },
          teamMembers: await Promise.all(
            project.teamMembers.map(async (member) => ({
              ...member,
              profilePhoto: member?.profilePhoto ? 
                await getSignedUrlForFile(process.env.SUPABASE_BUCKET_AVATAR, member.profilePhoto) : 
                null
            }))
          )
        };
      })
    );

    res.json(result);
  } catch (error) {
    console.error('Get featured projects error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ==============================
// GET RECOMMENDED PROJECTS (RESTORE)
// ==============================

// @desc Get personalized project recommendations
// @route GET /api/projects/recommended
// @access Private
const getRecommendedProjects = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    
    // Get projects user has already applied to or is a member of
    const userApplications = await Application.find({ 
      applicant: req.user.id 
    }).select('project');
    
    const userProjects = await Project.find({ 
      teamMembers: req.user.id 
    }).select('_id');
    
    const excludedProjectIds = [
      ...userApplications.map(a => a.project.toString()),
      ...userProjects.map(p => p._id.toString()),
    ];

    // Build match criteria
    const matchCriteria = {
      status: 'OPEN',
      isHidden: { $ne: true },
      owner: { $ne: req.user.id },
      _id: { $nin: excludedProjectIds.map(id => new mongoose.Types.ObjectId(id)) }
    };

    // Match by user skills
    const relevanceConditions = [];
    if (user.skills && user.skills.length > 0) {
      relevanceConditions.push(
        { requiredSkills: { $in: user.skills } },
        { techStack: { $in: user.skills } }
      );
    }

    // Match by user role if they have one
    if (user.role) {
      relevanceConditions.push({
        'roles.roleName': { $regex: user.role, $options: 'i' },
      });
    }
    if (relevanceConditions.length > 0) matchCriteria.$or = relevanceConditions;

    const projects = await Project.find(matchCriteria)
      .populate('owner', 'firstName lastName profilePhoto email')
      .populate('teamMembers', 'firstName lastName profilePhoto email')
      .sort('-createdAt')
      .limit(10)
      .lean();

    const projectsWithUrls = await Promise.all(
      projects.map(async (project) => ({
        ...project,
        owner: {
          ...project.owner,
          profilePhoto: project.owner?.profilePhoto ? 
            await getSignedUrlForFile(process.env.SUPABASE_BUCKET_AVATAR, project.owner.profilePhoto) : 
            null
        },
        teamMembers: await Promise.all(
          project.teamMembers.map(async (member) => ({
            ...member,
            profilePhoto: member?.profilePhoto ? 
              await getSignedUrlForFile(process.env.SUPABASE_BUCKET_AVATAR, member.profilePhoto) : 
              null
          }))
        ),
        relevanceScore: calculateRelevanceScore(project, user)
      }))
    );

    // Sort by relevance score
    projectsWithUrls.sort((a, b) => b.relevanceScore - a.relevanceScore);

    res.json(projectsWithUrls);
  } catch (error) {
    console.error('Get recommended projects error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Helper: Calculate relevance score
const calculateRelevanceScore = (project, user) => {
  let score = 0;
  
  if (user.skills) {
    const skillMatches = project.requiredSkills?.filter(s => user.skills.includes(s)) || [];
    score += skillMatches.length * 2;
    
    const techMatches = project.techStack?.filter(s => user.skills.includes(s)) || [];
    score += techMatches.length;
  }
  
  if (user.role) {
    const roleMatches = project.roles?.filter(r => 
      r.roleName.toLowerCase().includes(user.role.toLowerCase())
    ) || [];
    score += roleMatches.length * 3;
  }
  
  return score;
};

// ==============================
// GET APPLICATION DETAILS (RESTORE)
// ==============================

// @desc Get single application details
// @route GET /api/applications/:id
// @access Private
const getApplicationDetails = async (req, res) => {
  try {
    const application = await Application.findById(req.params.id)
      .populate('project', 'title description stage status owner roles')
      .populate('applicant', 'firstName lastName profilePhoto email skills')
      .lean();

    if (!application) {
      return res.status(404).json({ message: 'Application not found' });
    }

    // Check if user is the applicant or project owner
    const isApplicant = application.applicant._id.toString() === req.user.id;
    const isOwner = application.project.owner.toString() === req.user.id;

    if (!isApplicant && !isOwner) {
      return res.status(403).json({ message: 'Not authorized to view this application' });
    }

    const applicationWithUrls = {
      ...application,
      applicant: {
        ...application.applicant,
        profilePhoto: application.applicant?.profilePhoto ? 
          await getSignedUrlForFile(process.env.SUPABASE_BUCKET_AVATAR, application.applicant.profilePhoto) : 
          null
      },
      cvUrl: application.cvPath ? 
        await getSignedUrlForFile(process.env.SUPABASE_BUCKET_RESUMES, application.cvPath) : 
        null
    };

    res.json(applicationWithUrls);
  } catch (error) {
    console.error('Get application details error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ==============================
// GET PROJECT STATS
// ==============================

// @desc Get project statistics
// @route GET /api/projects/stats
// @access Public
const getProjectStats = async (req, res) => {
  try {
    const visible = { isHidden: { $ne: true } };
    const total = await Project.countDocuments(visible);
    const open = await Project.countDocuments({ ...visible, status: 'OPEN' });
    const active = await Project.countDocuments({ ...visible, status: 'ACTIVE' });
    const completed = await Project.countDocuments({ ...visible, status: 'COMPLETED' });
    const closed = await Project.countDocuments({ ...visible, status: 'CLOSED' });

    const stageStats = await Project.aggregate([
      { $match: visible },
      { $group: { _id: '$stage', count: { $sum: 1 } } }
    ]);

    const techStackStats = await Project.aggregate([
      { $match: visible },
      { $unwind: '$techStack' },
      { $group: { _id: '$techStack', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);

    res.json({
      total,
      open,
      active,
      completed,
      closed,
      stages: stageStats.reduce((acc, curr) => {
        acc[curr._id] = curr.count;
        return acc;
      }, {}),
      topTechStacks: techStackStats
    });
  } catch (error) {
    console.error('Get project stats error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};


// ==============================
// EXPORTS
// ==============================

module.exports = {
  // Project CRUD
  createProject,
  getProjects,
  getProjectById,
  updateProject,
  deleteProject,
  
  // Project features
  getFeaturedProjects,
  getRecommendedProjects,
  getUserProjects,
  getProjectTeam,
  removeTeamMember,
  getProjectStats,
  
  // Applications
  applyToProject,
  updateApplicationStatus,
  getProjectApplications,
  getMyApplications,
  getApplicationDetails,
  
  // Multer middleware
  cvUpload,
};
