const express = require('express');
const router = express.Router();
const githubController = require('../controllers/github');

router.get('/repo', githubController.getRepoStats);
router.get('/contributors', githubController.getContributors);
router.get('/pulls', githubController.getPulls);

module.exports = router;
