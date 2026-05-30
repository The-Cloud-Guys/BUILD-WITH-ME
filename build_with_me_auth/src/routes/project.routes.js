const express = require('express');
const { protect } = require('../middleware/auth.middleware');
const {
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
  cvUpload,
} = require('../controllers/project.controller');

const router = express.Router();

// Public routes (but authentication optional for listing)
router.get('/', getProjects);
router.get('/:id', getProjectById);
router.get('/:id/team', getProjectTeam);

// Protected routes
router.use(protect); // all routes below require authentication

router.post('/', createProject);
router.put('/:id', updateProject);
router.delete('/:id', deleteProject);

router.post('/:id/apply', cvUpload.single('cv'), applyToProject);
router.get('/:id/applications', getProjectApplications);
router.put('/applications/:id', updateApplicationStatus);

router.delete('/:id/team/:userId', removeTeamMember);

module.exports = router;