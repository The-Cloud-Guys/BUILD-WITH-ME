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
  cvUpload,
  getUserProjects,
  getProjectApplicationsFiltered,
  getApplicationDetails
} = require('../controllers/project.controller');

const router = express.Router();

router.get('/', getProjects);
router.get('/featured', getFeaturedProjects);
router.get('/:id/team', getProjectTeam);

router.use(protect);

router.get('/my', getUserProjects);
router.get('/recommended', getRecommendedProjects);

router.post('/', createProject);
router.delete('/:id', deleteProject);

router.post('/:id/apply', cvUpload.single('cv'), applyToProject);
router.get('/:id/applications', getProjectApplications);
router.get('/:id/applications/filtered', getProjectApplicationsFiltered);
router.delete('/:id/team/:userId', removeTeamMember);
router.put('/applications/:id', updateApplicationStatus);
router.get('/applications/:id', getApplicationDetails);

router.get('/:id', getProjectById);
router.put('/:id', updateProject);

module.exports = router;