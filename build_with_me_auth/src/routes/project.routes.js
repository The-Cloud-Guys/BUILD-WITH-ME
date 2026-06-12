const express = require('express');
const { protect } = require('../middleware/auth.middleware');
const {
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
  cvUpload
} = require('../controllers/project.controller');

const router = express.Router();

// All routes below require authentication except GET /projects and GET /projects/:id and GET /projects/:id/team
router.get('/', getProjects);
router.get('/featured', getFeaturedProjects);
router.get('/:id', getProjectById);
router.get('/:id/team', getProjectTeam);

// Protected routes
router.use(protect);

router.get('/recommended', getRecommendedProjects);
router.post('/', createProject);
router.put('/:id', updateProject);
router.delete('/:id', deleteProject);
router.post('/:id/apply', cvUpload.single('cv'), applyToProject);
router.get('/:id/applications', getProjectApplications);
router.put('/applications/:id', updateApplicationStatus);
router.delete('/:id/team/:userId', removeTeamMember);

router.post('/projects/:id/apply', cvUpload.single('cv'), applyToProject);
router.get('/projects/:id/applications', getProjectApplications);
router.put('/applications/:id', updateApplicationStatus);      // now matches /api/applications/:id

router.delete('/projects/:id/team/:userId', removeTeamMember);

module.exports = router;