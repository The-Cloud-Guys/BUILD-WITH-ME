const express = require('express');
const { protect } = require('../middleware/auth.middleware');

const {
  createProject,
  getProjects,
  getProjectById,
  getProjectStats,
  getUserProjects,
  updateProject,
  deleteProject,
  applyToProject,
  getProjectApplications,
  cvUpload,
  getFeaturedProjects,
  getRecommendedProjects,
  getProjectTeam,
  removeTeamMember,
} = require('../controllers/project.controller');

const router = express.Router();

// ============================================
// PUBLIC STATIC ROUTES (BEFORE /:id)
// ============================================

router.get('/', getProjects);
router.get('/stats', getProjectStats);
router.get('/featured', getFeaturedProjects); // Restore when available

// ============================================
// PROTECTED STATIC ROUTES (BEFORE /:id)
// ============================================

router.get('/my', protect, getUserProjects);
router.get('/recommended', protect, getRecommendedProjects); // Restore when available

// ============================================
// CREATE PROJECT
// ============================================

router.post('/', protect, createProject);

// ============================================
// APPLICATIONS
// ============================================

router.post('/:id/apply', protect, cvUpload.single('cv'), applyToProject);

// Canonical endpoint
router.get('/:id/applications', protect, getProjectApplications);

// Temporary compatibility alias
router.get('/:id/applications/filtered', protect, getProjectApplications);

// ============================================
// TEAM 
// ============================================

router.get('/:id/team', getProjectTeam);
router.delete('/:id/team/:userId', protect, removeTeamMember);

// ============================================
// UPDATE PROJECT
// ============================================

// Canonical update
router.put('/:id', protect, updateProject);

// ============================================
// DELETE
// ============================================

router.delete('/:id', protect, deleteProject);

// ============================================
// PUBLIC DYNAMIC ROUTE (KEEP LAST)
// ============================================

router.get('/:id', getProjectById);

module.exports = router;
