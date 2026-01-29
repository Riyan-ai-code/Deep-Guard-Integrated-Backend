const express = require('express');
const router = express.Router();
const supportController = require('../controllers/support');

router.post('/bug-report', supportController.sendBugReport);

module.exports = router;
