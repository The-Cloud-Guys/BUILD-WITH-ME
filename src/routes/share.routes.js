const express = require('express');
const { getSharedResource } = require('../controllers/share.controller');

const router = express.Router();

router.get('/:resourceType/:resourceId', getSharedResource);

module.exports = router;
