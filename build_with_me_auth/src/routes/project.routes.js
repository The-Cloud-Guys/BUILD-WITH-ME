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

// ==============================
// PUBLIC ROUTES
// ==============================
router.get('/', getProjects);
router.get('/featured', getFeaturedProjects);
router.get('/:id/team', getProjectTeam);
router.get('/:id', getProjectById);   // <-- dynamic route must be AFTER static ones

// ==============================
// PROTECTED ROUTES
// ==============================
router.use(protect);

router.post('/', createProject);
router.get('/recommended', getRecommendedProjects);
router.put('/:id', updateProject);
router.delete('/:id', deleteProject);
router.post('/:id/apply', cvUpload.single('cv'), applyToProject);
router.get('/:id/applications', getProjectApplications);
router.put('/applications/:id', updateApplicationStatus);
router.delete('/:id/team/:userId', removeTeamMember);

module.exports = router;