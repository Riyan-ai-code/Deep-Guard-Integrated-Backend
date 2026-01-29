// routes/analysis.js - COMPLETE with download
const express = require('express');
const router = express.Router();
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { supabaseAdmin } = require('../config/supabase');
const authMiddleware = require('../middleware/auth');

const upload = multer({ storage: multer.memoryStorage() });

// ✅ DOWNLOAD route - MOST SPECIFIC - FIRST
// ✅ GET ORIGINAL FILE route (for display)
router.get('/:id/file', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    // ---------------------------------------------------------
    // TRIAL USER FLOW
    // ---------------------------------------------------------
    if (req.user?.isTrial) {
      try {
        const decoded = Buffer.from(id, 'base64').toString('utf8');
        if (decoded.startsWith('trial|')) {
          const parts = decoded.split('|');
          const type = parts[1];
          const bucket = parts[2];
          let filePath = '';

          if (type === 'image') {
            // trial|image|bucket|[paths] -> paths[0] is original?
            // Actually in upload logic: paths[0] is stored as full path in array?
            // Let's check upload logic: `const filePath = ...` -> pushed to paths.
            // Yes.
            const paths = JSON.parse(parts.slice(3).join('|'));
            filePath = paths[0]; // Original image is typically the first or only path
          } else {
            return res.status(400).json({ message: 'Not an image analysis' });
          }

          if (bucket && filePath) {
            const { data, error } = await supabaseAdmin.storage.from(bucket).download(filePath);
            if (error) throw error;
            const buffer = Buffer.from(await data.arrayBuffer());
            res.set('Content-Type', 'image/jpeg'); // Or detect from file ext
            return res.send(buffer);
          }
        }
      } catch (e) {
        console.error('Trial file fetch error:', e);
      }
      return res.status(404).json({ message: 'File not found' });
    }

    // ---------------------------------------------------------
    // STANDARD USER FLOW
    // ---------------------------------------------------------
    const { data: analysis, error } = await supabaseAdmin
      .from('analyses')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (error || !analysis) {
      return res.status(404).json({ message: 'Analysis not found' });
    }

    // Original file path is stored in `file_path` column
    if (!analysis.file_path) {
      return res.status(404).json({ message: 'File path missing' });
    }

    // Fix: For images, file_path is a JSON array string ["path"] or an actual Array (if JSONB)
    let filePath = analysis.file_path;

    if (Array.isArray(filePath) && filePath.length > 0) {
      filePath = filePath[0];
    } else if (typeof filePath === 'string' && filePath.trim().startsWith('[')) {
      try {
        const paths = JSON.parse(filePath);
        if (Array.isArray(paths) && paths.length > 0) {
          filePath = paths[0]; // Take the first image
        }
      } catch (e) {
        console.warn('Failed to parse file_path JSON:', e);
      }
    }

    // Determine bucket: Default to 'video_analyses' only if not clearly an image
    let bucket = analysis.bucket;
    if (!bucket) {
      const isImage = analysis.filename?.match(/\.(jpg|jpeg|png|webp|gif)$/i) || analysis.file_type?.startsWith('image/');
      bucket = isImage ? 'image_analyses' : 'video_analyses';
    }

    const { data, error: dlError } = await supabaseAdmin.storage
      .from(bucket)
      .download(filePath);

    if (dlError) {
      console.error('❌ Storage download error:', dlError); // Log full object
      throw dlError;
    }

    const buffer = Buffer.from(await data.arrayBuffer());
    res.set('Content-Type', analysis.file_type || 'application/octet-stream');
    res.send(buffer);

  } catch (error) {
    console.error('File fetch error:', error);
    res.status(500).json({ message: 'Error fetching file', error: error.message || error });
  }
});

// Download route (unchanged)
router.get('/:id/download', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    console.log(`\n📥 DOWNLOAD REPORT: ${req.method} ${req.path}`);
    console.log('analysisId:', id);

    // ---------------------------------------------------------
    // TRIAL USER FLOW (Stateless Download)
    // ---------------------------------------------------------
    if (req.user?.isTrial) {
      try {
        const decoded = Buffer.from(id, 'base64').toString('utf8');
        if (decoded.startsWith('trial|')) {
          console.log('🧪 Downloading TRIAL analysis (Stateless)');
          const parts = decoded.split('|');
          const type = parts[1];
          const bucket = parts[2];
          let zipPath = '';

          if (type === 'video') {
            // trial|video|bucket|path
            const fullPath = parts.slice(3).join('|');
            const folder = fullPath.split('/').slice(0, -1).join('/');
            zipPath = `${folder}/annotated_frames.zip`;
          } else if (type === 'image') {
            // trial|image|bucket|[paths]
            try {
              const paths = JSON.parse(parts.slice(3).join('|'));
              const folder = paths[0].split('/').slice(0, 2).join('/');
              zipPath = `${folder}/annotated_images.zip`;
            } catch (e) { console.error('Error parsing image paths for download', e); }
          }

          if (bucket && zipPath) {
            console.log(`Downloading zip from: ${zipPath}`);
            const { data: zipData, error: downloadError } = await supabaseAdmin
              .storage
              .from(bucket)
              .download(zipPath);

            if (downloadError) throw downloadError;

            const zipBuffer = Buffer.from(await zipData.arrayBuffer());
            console.log(`✅ Downloaded ZIP: ${zipBuffer.length} bytes`);

            res.set('Content-Type', 'application/zip');
            res.set('Content-Disposition', `attachment; filename="analysis_${id}_report.zip"`);
            return res.send(zipBuffer);
          }
        }
      } catch (e) {
        console.error('Trial download error:', e);
      }
      return res.status(404).json({ message: 'Trial report not found' });
    }

    if (!userId) {
      console.error('❌ userId is missing');
      return res.status(401).json({ message: 'User not authenticated' });
    }

    // Get analysis record
    const { data: analysis, error } = await supabaseAdmin
      .from('analyses')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (error || !analysis) {
      console.error('❌ Analysis not found or DB error');
      return res.status(404).json({ message: 'Report not found' });
    }

    // Determine ZIP path
    // Video: annotated_frames_path
    // Image: annotated_images_path
    const zipPath = analysis.annotated_frames_path || analysis.annotated_images_path;

    if (!zipPath) {
      console.error('❌ No ZIP path in record');
      return res.status(404).json({ message: 'Report ZIP not generated yet' });
    }

    console.log(`✅ Found analysis, downloading ZIP: ${zipPath}`);

    // Download the ZIP file from Supabase
    const { data: zipData, error: downloadError } = await supabaseAdmin
      .storage
      .from(analysis.bucket || process.env.SUPABASE_BUCKET_NAME || 'video_analyses')
      .download(zipPath);

    if (downloadError) {
      throw downloadError;
    }

    const zipBuffer = Buffer.from(await zipData.arrayBuffer());
    console.log(`✅ Downloaded ZIP: ${zipBuffer.length} bytes`);

    // Return ZIP to frontend
    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', `attachment; filename="analysis_${id}_report.zip"`);
    res.send(zipBuffer);

  } catch (error) {
    console.error('❌ Download error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ✅ UPLOAD route
router.post('/upload', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    const userId = req.user?.id;

    console.log('📝 Upload request');
    console.log('👤 User ID:', userId);
    console.log('📁 File:', req.file?.originalname);

    if (!userId) {
      console.error('❌ No user ID');
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }

    if (!req.file) {
      console.error('❌ No file');
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    // ---------------------------------------------------------
    // TRIAL USER FLOW
    // ---------------------------------------------------------
    if (req.user.isTrial) {
      console.log('🧪 Processing TRIAL upload');
      const sessionId = req.user.trialSessionId;

      // 1. Check Limits
      const { data: session, error: sessionErr } = await supabaseAdmin
        .from('trial_sessions')
        .select('*')
        .eq('id', sessionId)
        .single();

      if (sessionErr || !session) {
        return res.status(401).json({ success: false, message: "Trial session not found" });
      }

      // Hard limit 100 as per requested update
      if (session.analysis_count >= 100) {
        return res.status(403).json({ success: false, message: "Trial limit reached." });
      }

      // 2. Upload to Trial Bucket
      const analysisId = uuidv4();
      const fileName = `${sessionId}/${analysisId}/${req.file.originalname}`;
      const bucketName = 'trial_analyses'; // User existing bucket or new? assuming 'trial_analyses' from trial.analyze.js

      const { error: uploadError } = await supabaseAdmin.storage
        .from(bucketName)
        .upload(fileName, req.file.buffer, {
          contentType: req.file.mimetype,
        });

      if (uploadError) {
        // If bucket doesn't exist, might fail. Assuming it exists since trial.js works.
        console.error('Trial upload failed:', uploadError);
        return res.status(500).json({ success: false, message: 'Upload failed' });
      }

      // 3. Increment Count
      await supabaseAdmin
        .from('trial_sessions')
        .update({ analysis_count: session.analysis_count + 1 })
        .eq('id', sessionId);

      // 4. Construct Stateless ID (Base64)
      // Format: trial|video|<bucket>|<path>
      const rawId = `trial|video|${bucketName}|${fileName}`;
      const encodedId = Buffer.from(rawId).toString('base64');

      console.log('✅ Trial upload success. Stateless ID:', encodedId);

      return res.json({
        success: true,
        message: 'Trial file uploaded',
        data: {
          analysis_id: encodedId,
          filename: req.file.originalname,
          file_path: fileName,
        }
      });
    }
    // ---------------------------------------------------------

    const analysisId = uuidv4();
    const fileName = `${userId}/${analysisId}/${req.file.originalname}`;

    console.log('📤 Uploading to Supabase storage...');

    const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
      .from('video_analyses')
      .upload(fileName, req.file.buffer, {
        contentType: req.file.mimetype,
      });

    if (uploadError) {
      console.error('❌ Storage error:', uploadError.message);
      return res.status(500).json({ success: false, message: 'Storage upload failed', error: uploadError.message });
    }

    console.log('✅ File stored:', fileName);
    console.log('💾 Inserting to database...');

    const { data: analysis, error: dbError } = await supabaseAdmin
      .from('analyses')
      .insert([{
        id: analysisId,
        user_id: userId,
        filename: req.file.originalname,
        file_path: fileName,
        bucket: 'video_analyses',
        file_size: req.file.size,
        file_type: req.file.mimetype,
        status: 'pending'
      }])
      .select()
      .single();

    if (dbError) {
      console.error('❌ Database error:', dbError.message);
      try {
        await supabaseAdmin.storage.from('video_analyses').remove([fileName]);
        console.log('🧹 Cleaned up uploaded file');
      } catch (cleanupErr) {
        console.warn('⚠️ Cleanup failed:', cleanupErr.message);
      }
      return res.status(500).json({ success: false, message: 'Database insert failed', error: dbError.message });
    }

    console.log('✅ Analysis record created:', analysisId);

    res.json({
      success: true,
      message: 'File uploaded successfully',
      data: {
        analysis_id: analysisId,
        filename: req.file.originalname,
        file_path: fileName,
      }
    });

  } catch (error) {
    console.error('❌ Upload error:', error.message);
    res.status(500).json({ success: false, message: 'Upload failed', error: error.message });
  }
});

// ✅ GET all analyses
router.get('/', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id;
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;

    console.log('📋 Fetching analyses for user:', userId);

    // TRIAL USER CHECK
    // TRIAL USER CHECK
    if (req.user?.isTrial) {
      console.log('⚠️ Trial user - history restricted');
      // Return 200 so frontend doesn't treat as error, but include restricted flag
      return res.json({
        success: true,
        trial_restricted: true,
        data: [],
        message: 'Analysis history is not available for trial users.'
      });
    }

    const { data: analyses, error } = await supabaseAdmin
      .from('analyses')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('❌ Fetch error:', error);
      return res.status(500).json({ success: false, message: 'Failed to fetch analyses' });
    }

    console.log('✅ Found analyses:', analyses?.length || 0);
    res.json({ success: true, data: analyses, count: analyses?.length || 0 });
  } catch (error) {
    console.error('❌ Error:', error.message);
    res.status(500).json({ success: false, message: 'Error fetching analyses' });
  }
});

// ✅ GET single analysis - LAST
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    console.log('🔍 Fetching analysis:', id);

    // ---------------------------------------------------------
    // TRIAL USER FLOW (Stateless Read)
    // ---------------------------------------------------------
    if (req.user?.isTrial) {
      try {
        const decoded = Buffer.from(id, 'base64').toString('utf8');
        // video ID: trial|video|bucket|path
        // image ID: trial|image|bucket|[paths]
        if (decoded.startsWith('trial|')) {
          console.log('🧪 Fetching TRIAL analysis (Stateless)');
          const parts = decoded.split('|');
          const type = parts[1];
          const bucket = parts[2];
          let folder = '';

          if (type === 'video') {
            // path is parts[3]... (join rest)
            const fullPath = parts.slice(3).join('|');
            folder = fullPath.split('/').slice(0, -1).join('/');
          } else if (type === 'image') {
            // path is JSON array
            try {
              const paths = JSON.parse(parts.slice(3).join('|'));
              folder = paths[0].split('/').slice(0, 2).join('/');
            } catch (e) { console.error('Error parsing image paths', e); }
          }

          if (bucket && folder) {
            const resultPath = `${folder}/analysis_result.json`;
            const { data, error } = await supabaseAdmin.storage
              .from(bucket)
              .download(resultPath);

            if (data) {
              const jsonStr = await data.text();
              const result = JSON.parse(jsonStr);
              return res.json({ success: true, data: result });
            } else {
              // File not found -> Analysis likely still processing (or failed)
              // Return a mock pending object so frontend waits
              return res.json({
                success: true,
                data: {
                  id: id,
                  status: 'processing',
                  filename: 'Processing...',
                  created_at: new Date().toISOString()
                }
              });
            }
          }
        }
      } catch (e) {
        console.log('Not a stateless ID or error reading:', e.message);
      }
      // Fallback: If decoding fails or not trial format, return 404 to avoid DB crash
      return res.status(404).json({ success: false, message: 'Trial analysis not found' });
    }

    // STANDARD FLOW
    const { data: analysis, error } = await supabaseAdmin
      .from('analyses')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (error || !analysis) {
      console.error('❌ Not found:', error?.message);
      return res.status(404).json({ success: false, message: 'Analysis not found' });
    }

    console.log('✅ Found analysis:', id);
    res.json({ success: true, data: analysis });
  } catch (error) {
    console.error('❌ Error:', error.message);
    // Invalid UUID is common if we passed a trial ID to non-trial logic, catches here too
    if (error.message.includes('invalid input syntax for type uuid')) {
      return res.status(404).json({ success: false, message: 'Analysis not found' });
    }
    res.status(500).json({ success: false, message: 'Error fetching analysis' });
  }
});

// ✅ DELETE analysis
router.delete('/:id', authMiddleware, async (req, res) => {
  let analysisId;
  let userId;

  try {
    analysisId = req.params.id;
    userId = req.user?.id;

    console.log(`\n🗑️ DELETE REQUEST: ${req.method} ${req.path}`);
    console.log('analysisId:', analysisId);
    console.log('userId:', userId);

    if (!userId) {
      console.error('❌ userId is missing');
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    if (!analysisId) {
      console.error('❌ analysisId is missing');
      return res.status(400).json({ success: false, message: 'Analysis ID is required' });
    }

    // ---------------------------------------------------------
    // TRIAL USER FLOW (Stateless Delete)
    // ---------------------------------------------------------
    if (req.user?.isTrial) {
      try {
        const decoded = Buffer.from(analysisId, 'base64').toString('utf8');
        if (decoded.startsWith('trial|')) {
          console.log('🧪 Deleting TRIAL analysis (Stateless)');
          const parts = decoded.split('|');
          const type = parts[1];
          const bucket = parts[2];

          let folder = '';
          if (type === 'video') {
            // trial|video|bucket|path -> folder is path's parent
            const fullPath = parts.slice(3).join('|');
            folder = fullPath.split('/').slice(0, -1).join('/');
          } else if (type === 'image') {
            // trial|image|bucket|[paths] -> folder is first path's parent
            try {
              const paths = JSON.parse(parts.slice(3).join('|'));
              folder = paths[0].split('/').slice(0, 2).join('/');
            } catch (e) { }
          }

          if (bucket && folder) {
            console.log(`🗑️ Deleting trial folder: ${folder} from ${bucket}`);
            const { data: list, error: listErr } = await supabaseAdmin.storage.from(bucket).list(folder);

            if (list && list.length > 0) {
              const filesToRemove = list.map(f => `${folder}/${f.name}`);
              await supabaseAdmin.storage.from(bucket).remove(filesToRemove);
              console.log(`✅ Deleted ${filesToRemove.length} trial files`);
            }
            return res.json({ success: true, message: "Trial analysis deleted" });
          }
        }
      } catch (e) {
        console.log('Trial delete error:', e);
      }
      return res.status(404).json({ success: false, message: "Trial analysis not found" });
    }

    console.log(`\n📊 FETCHING ANALYSIS RECORD:`);
    const { data: analysis, error: selectError } = await supabaseAdmin
      .from('analyses')
      .select('*')
      .eq('id', analysisId)
      .eq('user_id', userId)
      .single();

    if (selectError || !analysis) {
      console.error('❌ Analysis not found:', selectError?.message);
      return res.status(404).json({ success: false, message: 'Analysis not found' });
    }

    console.log(`✅ Found analysis:`, {
      id: analysis.id,
      filename: analysis.filename,
      file_path: analysis.file_path,
      annotated_frames_path: analysis.annotated_frames_path
    });

    const bucketName = analysis.bucket || process.env.SUPABASE_BUCKET_NAME || 'video_analyses';
    const filesToDelete = [];

    if (analysis.file_path) {
      // Handle array of paths for images
      try {
        const paths = JSON.parse(analysis.file_path);
        if (Array.isArray(paths)) filesToDelete.push(...paths);
        else filesToDelete.push(analysis.file_path);
      } catch {
        filesToDelete.push(analysis.file_path);
      }
      console.log(`\n📝 Will delete source file(s)`);
    }

    if (analysis.annotated_frames_path || analysis.annotated_images_path) {
      const zip = analysis.annotated_frames_path || analysis.annotated_images_path;
      filesToDelete.push(zip);
      console.log(`📝 Will delete ZIP: ${zip}`);
    }

    if (filesToDelete.length > 0) {
      console.log(`\n🗑️ DELETING FILES FROM STORAGE:`);
      try {
        const { error: deleteError } = await supabaseAdmin
          .storage
          .from(bucketName)
          .remove(filesToDelete);

        if (deleteError) {
          console.warn(`⚠️ Warning deleting files:`, deleteError.message);
        } else {
          console.log(`✅ Successfully deleted ${filesToDelete.length} file(s) from storage`);
        }
      } catch (storageErr) {
        console.warn(`⚠️ Storage deletion error:`, storageErr.message);
      }
    }

    console.log(`\n📊 DELETING DATABASE RECORD:`);
    const { error: deleteDbError } = await supabaseAdmin
      .from('analyses')
      .delete()
      .eq('id', analysisId)
      .eq('user_id', userId);

    if (deleteDbError) {
      console.error('❌ Database delete error:', deleteDbError);
      throw deleteDbError;
    }

    console.log(`✅ Database record deleted\n`);

    res.json({
      success: true,
      message: 'Analysis and all associated files deleted successfully',
      data: {
        analysisId,
        filesDeleted: filesToDelete.length,
        deletedFiles: filesToDelete
      }
    });

  } catch (error) {
    console.error(`\n❌ DELETE ERROR: ${error.message}\n`);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to delete analysis'
    });
  }
});

// ✅ UPDATE analysis
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    const {
      status,
      confidence_score,
      is_deepfake,
      analysis_result,
      frames_to_analyze,
      annotated_frames_path
    } = req.body;

    console.log('✏️ Updating analysis:', id);

    const updatePayload = { updated_at: new Date().toISOString() };

    if (status !== undefined) updatePayload.status = status;
    if (confidence_score !== undefined) updatePayload.confidence_score = confidence_score;
    if (is_deepfake !== undefined) updatePayload.is_deepfake = is_deepfake;
    if (analysis_result !== undefined) updatePayload.analysis_result = analysis_result;
    if (frames_to_analyze !== undefined) updatePayload.frames_to_analyze = frames_to_analyze;
    if (annotated_frames_path !== undefined) updatePayload.annotated_frames_path = annotated_frames_path;

    const { data: analysis, error: updateError } = await supabaseAdmin
      .from('analyses')
      .update(updatePayload)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();

    if (updateError) {
      console.error('❌ Update error:', updateError);
      return res.status(500).json({ success: false, message: 'Update failed' });
    }

    console.log('✅ Analysis updated:', id);
    res.json({ success: true, data: analysis });
  } catch (error) {
    console.error('❌ Error:', error.message);
    res.status(500).json({ success: false, message: 'Error updating analysis' });
  }
});

module.exports = router;
