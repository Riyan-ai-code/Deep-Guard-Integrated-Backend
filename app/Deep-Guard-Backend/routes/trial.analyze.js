// routes/trial.analyze.js
const express = require("express");
const multer = require("multer");
const { supabase } = require("../config/supabase");
const trialMiddleware = require("../middleware/trial");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

const TRIAL_BUCKET = "trial_analyses";
const TRIAL_MAX_UPLOADS = 3;

router.post("/upload", trialMiddleware, upload.single("file"), async (req, res) => {
  const session = req.trial;

  if (session.analysis_count >= TRIAL_MAX_UPLOADS) {
    return res.status(403).json({
      requireSignIn: true,
      message: "Your trial limit (3 analyses) is used. Sign in to continue.",
    });
  }

  if (!req.file) {
    return res.status(400).json({
      message: "No file uploaded",
    });
  }

  const nextIndex = session.analysis_count + 1;
  const folder = `${session.id}/analysis_${nextIndex}`;
  const fileName = `${folder}/${Date.now()}_${req.file.originalname}`;

  const { data, error } = await supabase.storage
    .from(TRIAL_BUCKET)
    .upload(fileName, req.file.buffer, {
      contentType: req.file.mimetype,
      upsert: false,
    });

  if (error) {
    return res.status(500).json({ message: "Upload failed", error });
  }

  await supabase
    .from("trial_sessions")
    .update({ analysis_count: nextIndex })
    .eq("id", session.id);

  return res.json({
    ok: true,
    analysisCount: nextIndex,
    filePath: fileName,
  });
});

module.exports = router;
