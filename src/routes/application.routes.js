const express = require('express');
const { protect } = require('../middleware/auth.middleware');

const {
  getMyApplications,
  getApplicationDetails,
  updateApplicationStatus,
} = require('../controllers/project.controller');

const router = express.Router();

// All application routes require authentication
router.use(protect);

// ==============================
// STATIC ROUTE (BEFORE :id)
// ==============================

router.get('/me', getMyApplications);

// ==============================
// DYNAMIC ROUTES
// ==============================

router.get('/:id', getApplicationDetails);
router.put('/:id', updateApplicationStatus);

module.exports = router;