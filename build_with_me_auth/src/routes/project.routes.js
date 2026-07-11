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

// STATIC ROUTES (must come BEFORE dynamic :id routes)
router.get('/', getProjects);
router.get('/featured', getFeaturedProjects);
router.get('/:id/team', getProjectTeam);

// DYNAMIC ROUTE (comes LAST in the public section)
router.get('/:id', getProjectById);

// ==============================
// PROTECTED ROUTES
// ==============================
router.use(protect);

// STATIC ROUTES inside protected section (must come BEFORE :id)
router.post('/', createProject);
router.get('/recommended', getRecommendedProjects); 
router.put('/:id', updateProject);
router.delete('/:id', deleteProject);
router.post('/:id/apply', cvUpload.single('cv'), applyToProject);
router.get('/:id/applications', getProjectApplications);
router.delete('/:id/team/:userId', removeTeamMember);


module.exports = router;