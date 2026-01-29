const express = require("express");
const trialController = require("../controllers/trial");

const router = express.Router();

router.post("/join", trialController.joinTrial);

module.exports = router;
