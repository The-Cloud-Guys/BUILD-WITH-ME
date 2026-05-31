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

// All routes below require authentication except GET /projects and GET /projects/:id and GET /projects/:id/team
router.get('/projects', getProjects);                           // public
router.get('/projects/:id', getProjectById);                   // public
router.get('/projects/:id/team', getProjectTeam);              // public

// Protected routes
router.use(protect);

router.post('/projects', createProject);
router.put('/projects/:id', updateProject);
router.delete('/projects/:id', deleteProject);

router.post('/projects/:id/apply', cvUpload.single('cv'), applyToProject);
router.get('/projects/:id/applications', getProjectApplications);
router.put('/applications/:id', updateApplicationStatus);      // now matches /api/applications/:id

router.delete('/projects/:id/team/:userId', removeTeamMember);

module.exports = router;