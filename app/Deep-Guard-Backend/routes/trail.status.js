// routes/trial.status.js
const express = require("express");
const trialMiddleware = require("../middleware/trial");

const router = express.Router();

router.get("/status", trialMiddleware, async (req, res) => {
  const session = req.trial;

  res.json({
    sessionId: session.id,
    analysis_count: session.analysis_count,
    expires_at: session.expires_at,
    limit: 3,
  });
});

module.exports = router;
