// routes/ml-service.js - CLEAN (no download here)
const express = require('express');
const router = express.Router();
const axios = require('axios');
const FormData = require('form-data');
const AdmZip = require('adm-zip');
const { supabaseAdmin } = require('../config/supabase');
const authMiddleware = require('../middleware/auth');

const ML_API_URL = process.env.ML_API_URL || 'http://localhost:8000';

console.log('✅ ML-SERVICE ROUTES LOADED');

// ✅ POST analyze - Send video to FastAPI
router.post('/:analysisId', authMiddleware, async (req, res) => {
  let mlResponse;

  try {
    console.log(`\n🔴 ML ROUTE HIT: ${req.method} ${req.path}`);

    const { analysisId } = req.params;
    const userId = req.user?.id;
    const { frames_to_analyze } = req.body;

    console.log('userId:', userId);
    console.log('analysisId:', analysisId);

    if (!userId) {
      console.error('❌ userId is missing');
      return res.status(401).json({ message: 'User not authenticated' });
    }

    // ---------------------------------------------------------
    // TRIAL / STATELESS FLOW
    // ---------------------------------------------------------
    let analysis = {};
    let isTrialStateless = false;

    // Check if ID is encoded (starts with "dHJpYWw") 'trial' in base64 is 'dHJpYWw='
    // But better to check req.user.isTrial AND try to decode.
    if (req.user?.isTrial) {
      try {
        const decoded = Buffer.from(analysisId, 'base64').toString('utf8');
        if (decoded.startsWith('trial|video|')) {
          console.log('🧪 Processing TRIAL VIDEO analysis (Stateless)');
          isTrialStateless = true;
          const parts = decoded.split('|');
          // Format: trial|video|bucket|path
          const bucket = parts[2];
          const path = parts.slice(3).join('|'); // Join back in case path has pipes (unlikely but safe)

          analysis = {
            id: analysisId,
            bucket: bucket,
            file_path: path,
            filename: path.split('/').pop(),
          };
        }
      } catch (e) {
        console.log('Not a stateless ID, proceeding normally...');
      }
    }

    if (!isTrialStateless) {
      // STANDARD FLOW
      // Get analysis record
      const { data: dbAnalysis, error: selectError } = await supabaseAdmin
        .from('analyses')
        .select('*')
        .eq('id', analysisId)
        .eq('user_id', userId)
        .single();

      if (selectError || !dbAnalysis) {
        console.error('❌ Analysis not found:', selectError);
        return res.status(404).json({ message: 'Analysis not found' });
      }
      analysis = dbAnalysis;
      console.log(`✅ Found analysis`);

      // Update status to processing
      await supabaseAdmin
        .from('analyses')
        .update({ status: 'processing' })
        .eq('id', analysisId);
    }

    console.log(`⏳ Status: processing`);

    // Download video
    console.log(`\n📥 DOWNLOADING VIDEO:`);
    const videoDataResponse = await supabaseAdmin
      .storage
      .from(analysis.bucket || process.env.SUPABASE_BUCKET_NAME || 'video_analyses')
      .download(analysis.file_path);

    const videoData = videoDataResponse?.data || videoDataResponse;

    if (!videoData || !(videoData instanceof Blob)) {
      throw new Error('Invalid video data from Supabase');
    }

    const videoBuffer = Buffer.from(await videoData.arrayBuffer());
    console.log(`✅ Downloaded: ${videoBuffer.length} bytes`);

    if (!videoBuffer || videoBuffer.length === 0) {
      throw new Error('Video buffer is empty!');
    }

    // Send to FastAPI ML endpoint
    const formData = new FormData();
    formData.append('file', videoBuffer, {
      filename: analysis.filename,
      contentType: 'video/mp4'
    });

    const framesToSend = frames_to_analyze || 50;

    console.log(`\n📤 SENDING TO FASTAPI:`);
    console.log(`📤 URL: ${ML_API_URL}/detect/deepfake/video?frames=${framesToSend}`);

    mlResponse = await axios.post(
      `${ML_API_URL}/detect/deepfake/video?frames=${framesToSend}`,
      formData,
      {
        headers: formData.getHeaders(),
        timeout: 600000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        responseType: 'arraybuffer'
      }
    );

    console.log(`\n✅ FastAPI Response received, status: ${mlResponse.status}`);

    // ✅ EXTRACT confidence_report.json from ZIP FIRST
    let confidenceReport = null;
    const zipBuffer = mlResponse.data;

    try {
      const zip = new AdmZip(zipBuffer);
      const zipEntries = zip.getEntries();

      console.log(`📦 ZIP contains ${zipEntries.length} files`);

      // ✅ FIND confidence_report.json
      for (const entry of zipEntries) {
        if (entry.entryName === 'confidence_report.json') {
          try {
            const jsonContent = entry.getData().toString('utf8');
            console.log(`📄 Raw JSON:`, jsonContent.substring(0, 500));

            confidenceReport = JSON.parse(jsonContent);
            console.log(`✅ Extracted confidence_report.json with ${confidenceReport.frame_wise_confidences?.length || 0} frames`);
            console.log(`📊 Average confidence from report: ${confidenceReport.average_confidence}`);
            break;
          } catch (parseErr) {
            console.warn(`⚠️ Failed to parse confidence_report.json:`, parseErr.message);
          }
        }
      }

      if (!confidenceReport) {
        console.warn('⚠️ confidence_report.json not found in ZIP, using fallback');
        const framesAnalyzed = parseInt(mlResponse.headers['x-frames-analyzed'] || framesToSend || 0);
        confidenceReport = {
          video_id: mlResponse.headers['x-video-id'] || '',
          total_frames: framesAnalyzed,
          frames_analyzed: framesAnalyzed,
          average_confidence: 0,
          frame_wise_confidences: []
        };
      }
    } catch (zipError) {
      console.warn('⚠️ Could not extract from ZIP:', zipError.message);
      confidenceReport = {
        video_id: '',
        total_frames: 0,
        frames_analyzed: 0,
        average_confidence: 0,
        frame_wise_confidences: []
      };
    }

    // ✅ USE average_confidence from the extracted report (not headers!)
    const confidenceScore = confidenceReport.average_confidence || 0;
    const framesAnalyzed = confidenceReport.frames_analyzed || confidenceReport.total_frames || 0;
    const isDeepfake = confidenceScore >= 0.5;

    console.log(`\n✅ FINAL VERDICT:`);
    console.log(`   Confidence Score: ${(confidenceScore * 100).toFixed(2)}%`);
    console.log(`   Is Deepfake: ${isDeepfake ? 'YES (RED)' : 'NO (GREEN)'}`);
    console.log(`   Frames: ${framesAnalyzed}`);

    // Save ZIP file
    let zipPath = `${userId}/${analysisId}/annotated_frames.zip`;
    let storageBucket = analysis.bucket || process.env.SUPABASE_BUCKET_NAME || 'video_analyses';
    let trialFolder = null;

    if (isTrialStateless) {
      storageBucket = analysis.bucket;
      // analysis.file_path for trial usually includes folder: sessionId/analysisId/file
      const folder = analysis.file_path.split('/').slice(0, -1).join('/');
      trialFolder = folder;
      zipPath = `${folder}/annotated_frames.zip`;
    }

    console.log(`\n💾 SAVING ZIP FILE:`);
    try {
      await supabaseAdmin
        .storage
        .from(storageBucket)
        .upload(zipPath, zipBuffer, {
          contentType: 'application/zip',
          upsert: true
        });

      console.log(`✅ ZIP uploaded: ${zipPath}`);
    } catch (zipError) {
      console.error(`⚠️ Warning: Could not save ZIP:`, zipError.message);
    }

    // ✅ SAVE to database
    if (!isTrialStateless) {
      console.log(`\n📊 SAVING TO DATABASE:`);
      const { error: updateError } = await supabaseAdmin
        .from('analyses')
        .update({
          status: 'completed',
          is_deepfake: isDeepfake,
          confidence_score: confidenceScore,
          frames_to_analyze: framesAnalyzed,
          annotated_frames_path: zipPath,
          analysis_result: confidenceReport
        })
        .eq('id', analysisId)
        .eq('user_id', userId);

      if (updateError) {
        console.error('❌ Database update error:', updateError);
        throw updateError;
      }
      console.log(`✅ Database updated`);
    } else {
      console.log(`\n📊 SAVING RESULT TO STORAGE (Trial Stateless)`);
      // Construct the result object that GET /:id would normally return
      const trialResult = {
        id: analysisId,
        status: 'completed',
        is_deepfake: isDeepfake,
        confidence_score: confidenceScore,
        frames_to_analyze: framesAnalyzed,
        annotated_frames_path: zipPath,
        analysis_result: confidenceReport,
        filename: analysis.filename || 'Trial Video',
        file_path: analysis.file_path,
        bucket: storageBucket,
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

    console.log(`✅ Analysis COMPLETE\n`);

    res.json({
      success: true,
      data: {
        analysis_id: analysisId,
        is_deepfake: isDeepfake,
        confidence_score: confidenceScore,
        frames_analyzed: framesAnalyzed,
        confidence_report: confidenceReport,
        annotated_frames_path: zipPath,
        created_at: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error(`\n❌ ERROR: ${error.message}\n`);

    if (error.response) {
      console.error(`❌ FastAPI Error Status: ${error.response.status}`);
    }

    if (error.code === 'ECONNREFUSED') {
      return res.status(503).json({
        success: false,
        message: 'ML service unavailable',
        debug: ML_API_URL
      });
    }

    try {
      await supabaseAdmin
        .from('analyses')
        .update({ status: 'failed' })
        .eq('id', req.params.analysisId);
    } catch (updateErr) {
      console.error('Failed to update failed status:', updateErr.message);
    }

    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
