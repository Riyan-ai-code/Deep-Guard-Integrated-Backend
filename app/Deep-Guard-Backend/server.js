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
dotenv.config(); // Reload env variables if needed

/* ---------------------- ROUTES IMPORTS ---------------------- */
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

// 🔥 UPDATE: CORS Configuration to allow Vercel Frontend
const allowedOrigins = [
  "http://localhost:3000",                        // Local Development
  "https://deep-guard-frontend-omega.vercel.app", // Production Frontend
];

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps, curl, or Postman)
      if (!origin) return callback(null, true);
      
      if (allowedOrigins.indexOf(origin) === -1) {
        const msg = `The CORS policy for this site does not allow access from the specified Origin: ${origin}`;
        return callback(new Error(msg), false);
      }
      return callback(null, true);
    },
    credentials: true, // Required for cookies/sessions to work across domains
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  })
);

app.use(logger);
app.use(cookieParser());

// Parse incoming JSON and URL-encoded data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from public directory
app.use(express.static(path.join(__dirname, "public")));

/* ---------------------- ROUTE DEFINITIONS ---------------------- */

// AUTH (Public access - no auth middleware)
app.use("/auth", authRoutes);

// TRIAL ROUTES (Public access)
app.use("/api/trial", trialRoutes);
app.use("/api/trial", trialAuthRoutes);

// ACCOUNT ROUTES (Protected)
app.use("/api/account", authMiddleware, accountRoutes);

// IMAGE UPLOAD (Storage Logic - Protected)
app.use("/api/analysis/image", authMiddleware, imageAnalysisRoutes);

// ANALYSIS ROUTES (Video upload - Protected)
app.use("/api/analysis", authMiddleware, analysisRouter);

// ************* IMPORTANT ORDER ************* //
// ML ROUTES (Protected)
// Image ML routes
app.use("/api/ml/images", authMiddleware, mlServiceImagesRoutes);
// Video ML routes
app.use("/api/ml/analyze", authMiddleware, mlServices);
// ******************************************* //

// GitHub Integration
app.use("/api/github", githubRoutes);

// Support & Bug Reporting
app.use("/api/support", supportRoutes);

// Root Check / Keep Alive
app.get("/", (req, res) => {
  res.json({ 
    status: "Backend running 🚀",
    cors_allowed: allowedOrigins
  });
});

// Global Error Handler (Must be the last middleware)
app.use(errorHandler);

/* --------------------- START SERVER --------------------- */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌍 CORS enabled for: ${allowedOrigins.join(", ")}`);

  // Start Trial Cleanup Job (Run every 1 minute)
  const { cleanupExpiredTrials } = require("./controllers/trial");
  try {
    cleanupExpiredTrials(); // Run immediately on startup
    setInterval(cleanupExpiredTrials, 60 * 1000);
  } catch (err) {
    console.error("⚠️ Failed to start trial cleanup job:", err.message);
  }
});