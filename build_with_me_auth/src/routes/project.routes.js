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
// PUBLIC STATIC ROUTES
// ==============================
router.get('/', getProjects);
router.get('/featured', getFeaturedProjects);
router.get('/:id/team', getProjectTeam);

// ==============================
// PROTECTED ROUTES
// ==============================
router.use(protect);

router.post('/', createProject);
router.get('/recommended', getRecommendedProjects);  // protected
router.put('/:id', updateProject);
router.delete('/:id', deleteProject);
router.post('/:id/apply', cvUpload.single('cv'), applyToProject);
router.get('/:id/applications', getProjectApplications);
router.delete('/:id/team/:userId', removeTeamMember);

// ==============================
// DYNAMIC ROUTE (MUST BE LAST)
// ==============================
router.get('/:id', getProjectById);  // <-- MOVED TO THE VERY END

module.exports = router;