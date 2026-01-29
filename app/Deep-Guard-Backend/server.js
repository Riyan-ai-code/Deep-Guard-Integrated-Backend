const dotenv = require("dotenv");
dotenv.config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const cookieParser = require("cookie-parser");
const logger = require("./middleware/logger");
const errorHandler = require("./middleware/errorHandler");
const authMiddleware = require("./middleware/auth");

const trialRoutes = require("./routes/trial.analyze");
const trialAuthRoutes = require("./routes/trial");
dotenv.config();

/* ---------------------- ROUTES ---------------------- */
const authRoutes = require("./routes/auth");
const accountRoutes = require("./routes/update_profile");
const mlServices = require("./routes/ml-service");
const analysisRouter = require("./routes/analysis");
const imageAnalysisRoutes = require("./routes/analysis-image-upload");
const mlServiceImagesRoutes = require("./routes/ml-service-images");
const githubRoutes = require("./routes/github");
const supportRoutes = require("./routes/support");

const app = express();

/* ------------------ GLOBAL MIDDLEWARE ------------------ */
app.use(
  cors({
    origin: "http://localhost:3000",
    credentials: true,
  })
);

app.use(logger);
app.use(cookieParser());
app.use("/api/analysis/image", authMiddleware, imageAnalysisRoutes);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

/* ---------------------- ROUTES ---------------------- */

// AUTH (no auth middleware here)
app.use("/auth", authRoutes);
app.use("/api/trial", trialRoutes);
app.use("/api/trial", trialAuthRoutes);
// ACCOUNT ROUTES
app.use("/api/account", authMiddleware, accountRoutes);

// IMAGE UPLOAD (NOT ML)
app.use("/api/analysis/image", authMiddleware, imageAnalysisRoutes);

// ANALYSIS ROUTES (video upload)
app.use("/api/analysis", authMiddleware, analysisRouter);

// ************* IMPORTANT ORDER ************* //
// IMAGE ML must come before VIDEO ML
app.use("/api/ml/images", authMiddleware, mlServiceImagesRoutes);
app.use("/api/ml/analyze", authMiddleware, mlServices);
// ******************************************* //

// GitHub Integration
app.use("/api/github", githubRoutes);

// Support & Bug Reporting
app.use("/api/support", supportRoutes);
// Keep Alive

app.get("/", (req, res) => {
  res.json({ status: "Backend running 🚀" });
});

app.use(errorHandler);

/* --------------------- START SERVER --------------------- */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);

  // Start Trial Cleanup Job (Run every 1 minute)
  const { cleanupExpiredTrials } = require("./controllers/trial");
  cleanupExpiredTrials(); // Run immediately on startup
  setInterval(cleanupExpiredTrials, 60 * 1000);
});
