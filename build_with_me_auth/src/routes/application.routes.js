const express = require('express');
const { protect } = require('../middleware/auth.middleware');
const { updateApplicationStatus } = require('../controllers/project.controller');

const router = express.Router();

router.use(protect);
router.put('/:id', updateApplicationStatus);

module.exports = router;