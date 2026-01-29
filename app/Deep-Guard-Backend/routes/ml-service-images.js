// routes/ml-service-images.js
const express = require("express");
const router = express.Router();
const axios = require("axios");
const FormData = require("form-data");
const AdmZip = require("adm-zip");
const multer = require("multer");
const { supabaseAdmin } = require("../config/supabase");
const authMiddleware = require("../middleware/auth");

// Multer only to satisfy Express, WE DO NOT USE req.files
const upload = multer({ storage: multer.memoryStorage() });

// FASTAPI endpoint
const ML_URL = process.env.ML_IMAGE_URL;

if (!ML_URL) {
  console.error("❌ FATAL ERROR: ML_IMAGE_URL missing in .env");
}

console.log("🔥 IMAGE ML ENDPOINT =", ML_URL);

// ------------------------------------------------------
//              IMAGE ANALYSIS (FINAL VERSION)
// ------------------------------------------------------
router.post(
  "/:analysisId",
  authMiddleware,
  upload.none(), // FRONTEND DOES NOT SEND FILES
  async (req, res) => {
    try {
      const { analysisId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({ success: false, message: "Not authenticated" });
      }

      let analysis = {};
      let isTrialStateless = false;
      let paths = [];

      // CHECK FOR TRIAL STATELESS ID "trial|image|..."
      if (req.user?.isTrial) {
        try {
          const decoded = Buffer.from(analysisId, 'base64').toString('utf8');
          if (decoded.startsWith('trial|image|')) {
            console.log('🧪 Processing TRIAL IMAGE analysis (Stateless)');
            isTrialStateless = true;
            // Format: trial|image|bucket|["path1","path2"]
            // The 4th part is the JSON array. Join the rest in case paths have |
            const parts = decoded.split('|');
            const bucket = parts[2];
            const jsonPaths = parts.slice(3).join('|');

            analysis = {
              id: analysisId,
              bucket: bucket,
              // We don't need file_path here, we decode the array directly
            };

            paths = JSON.parse(jsonPaths);
            console.log(`🧪 Decoded ${paths.length} image paths for trial`);
          }
        } catch (e) {
          console.log('Not a stateless ID, proceeding normally:', e.message);
        }
      }

      if (!isTrialStateless) {
        // ------------------ 1. GET ANALYSIS ------------------
        const { data: dbAnalysis, error: fetchErr } = await supabaseAdmin
          .from("analyses")
          .select("*")
          .eq("id", analysisId)
          .eq("user_id", userId)
          .single();

        if (!dbAnalysis || fetchErr) {
          return res.status(404).json({ success: false, message: "Analysis not found" });
        }
        analysis = dbAnalysis;

        // Update status
        await supabaseAdmin
          .from("analyses")
          .update({ status: "processing" })
          .eq("id", analysisId);

        // ------------------ 2. GET IMAGE PATHS ------------------
        try {
          paths = JSON.parse(analysis.file_path); // multiple images
        } catch {
          paths = [analysis.file_path]; // single image
        }
      }

      // ------------------ 3. PREP FORM DATA ------------------
      const form = new FormData();

      for (const p of paths) {
        const { data: dl, error: dlErr } = await supabaseAdmin.storage
          .from(analysis.bucket || "image_analyses")
          .download(p);


        if (dlErr) throw new Error("Failed downloading image from storage");

        const buffer = Buffer.from(await dl.arrayBuffer());
        const filename = p.split("/").pop();

        form.append("files", buffer, {
          filename,
          contentType: "image/jpeg",
        });
      }

      // ------------------ 4. SEND TO FASTAPI ------------------
      // ------------------ 4. SEND TO FASTAPI ------------------

      // The screenshot shows FastAPI expects POST /detect/deepfake/images
      // with multipart/form-data under the "files" field.

      // Ensure ML_ENDPOINT includes the expected path. If ML_URL already points
      // directly to the `/detect/deepfake/images` endpoint, use it as-is.
      const ML_ENDPOINT = ML_URL && ML_URL.endsWith("/detect/deepfake/images")
        ? ML_URL
        : `${ML_URL}/detect/deepfake/images`;

      console.log("📤 SENDING IMAGES →", ML_ENDPOINT);

      let mlResponse;
      try {
        mlResponse = await axios.post(ML_ENDPOINT, form, {
          headers: form.getHeaders(),    // MUST forward form-data headers
          responseType: "arraybuffer",   // FastAPI returns ZIP
          timeout: 600000,               // 10 min
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
        });
      } catch (err) {
        console.error("❌ FASTAPI IMAGE ERROR:", err.response?.data?.toString() || err.message);
        throw new Error("FastAPI failed during image processing");
      }

      const zipBuffer = mlResponse.data;


      // Detect JSON error instead of ZIP
      const textCheck = zipBuffer.toString("utf8");
      if (textCheck.startsWith("{") || textCheck.startsWith("<")) {
        console.error("❌ ML ERROR RESPONSE:", textCheck);
        throw new Error("ML returned error instead of ZIP file");
      }

      // ------------------ 5. PARSE ZIP ------------------
      let confidenceReport = null;

      try {
        const zip = new AdmZip(zipBuffer);
        const entry = zip.getEntries().find((e) => e.entryName === "confidence_report.json");

        if (entry) {
          confidenceReport = JSON.parse(entry.getData().toString("utf8"));
        }
      } catch (err) {
        console.warn("⚠️ Could not parse confidence_report.json:", err.message);
      }

      // Fallback if JSON file missing
      if (!confidenceReport) {
        confidenceReport = {
          batch_id: mlResponse.headers["x-batch-id"] || "",
          average_confidence: parseFloat(mlResponse.headers["x-average-confidence"] || 0),
        };
      }

      const score = confidenceReport.average_confidence || 0;
      const isDeepfake = score >= 0.5;

      // ------------------ 6. SAVE ZIP TO STORAGE ------------------
      // ------------------ 6. SAVE ZIP TO STORAGE ------------------
      let zipPath = `${userId}/${analysisId}/annotated_images.zip`;
      let storageBucket = analysis.bucket || "image_analyses";
      let trialFolder = null;

      if (isTrialStateless) {
        storageBucket = analysis.bucket;
        // paths[0] is e.g. sessionId/analysisId/timestamp_filename
        // folder is sessionId/analysisId
        const folder = paths[0].split('/').slice(0, 2).join('/');
        trialFolder = folder;
        zipPath = `${folder}/annotated_images.zip`;
      }

      await supabaseAdmin.storage
        .from(storageBucket)
        .upload(zipPath, zipBuffer, {
          upsert: true,
          contentType: "application/zip",
        });

      // ------------------ 7. UPDATE DB ------------------
      if (!isTrialStateless) {
        await supabaseAdmin
          .from("analyses")
          .update({
            status: "completed",
            is_deepfake: isDeepfake,
            confidence_score: score,
            annotated_images_path: zipPath,
            analysis_result: confidenceReport,
            updated_at: new Date().toISOString(),
          })
          .eq("id", analysisId);
      } else {
        console.log(`\n📊 SAVING RESULT TO STORAGE (Trial Stateless)`);
        const trialResult = {
          id: analysisId,
          status: 'completed',
          is_deepfake: isDeepfake,
          confidence_score: score,
          annotated_images_path: zipPath,
          analysis_result: confidenceReport,
          filename: "Trial Images",
          bucket: storageBucket,
          file_path: JSON.stringify(paths),
          user_id: userId,
          created_at: new Date().toISOString()
        };

        const resultPath = `${trialFolder}/analysis_result.json`;

        const { error: saveErr } = await supabaseAdmin.storage
          .from(storageBucket)
          .upload(resultPath, JSON.stringify(trialResult), {
            contentType: 'application/json',
            upsert: true
          });

        if (saveErr) console.error('❌ Failed to save trial result to storage:', saveErr);
        else console.log(`✅ Result JSON saved to ${resultPath}`);
      }

      return res.json({
        success: true,
        data: {
          analysis_id: analysisId,
          confidence_score: score,
          is_deepfake: isDeepfake,
        },
      });

    } catch (err) {
      console.error("❌ IMAGE ML ERROR:", err.message);

      await supabaseAdmin
        .from("analyses")
        .update({ status: "failed" })
        .eq("id", req.params.analysisId);

      return res.status(500).json({
        success: false,
        message: "ML processing failed",
        error: err.message,
      });
    }
  }
);

module.exports = router;
