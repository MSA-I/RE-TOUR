-- ═══════════════════════════════════════════════════════════════
-- Diagnose 500 Error in Step 0
-- ═══════════════════════════════════════════════════════════════

-- 1. Find your most recent pipeline
SELECT
  id,
  whole_apartment_phase,
  status,
  current_step,
  last_error,
  floor_plan_upload_id,
  created_at,
  updated_at
FROM floorplan_pipelines
ORDER BY created_at DESC
LIMIT 1;

-- Copy the pipeline ID from above, then use it below:

-- 2. Check if the floor plan upload exists
SELECT
  p.id as pipeline_id,
  p.floor_plan_upload_id,
  u.id as upload_id,
  u.original_filename,
  u.bucket,
  u.path,
  ROUND(u.size_bytes / 1024.0 / 1024.0, 2) as size_mb,
  u.mime_type,
  CASE
    WHEN u.id IS NULL THEN '❌ UPLOAD NOT FOUND'
    WHEN u.size_bytes > 50 * 1024 * 1024 THEN '⚠️ FILE TOO LARGE (> 50 MB)'
    WHEN u.size_bytes IS NULL THEN '❌ SIZE IS NULL'
    ELSE '✅ OK'
  END as status
FROM floorplan_pipelines p
LEFT JOIN uploads u ON u.id = p.floor_plan_upload_id
ORDER BY p.created_at DESC
LIMIT 1;

-- 3. Check recent pipeline events for clues
SELECT
  pipeline_id,
  step_number,
  type,
  message,
  progress_int,
  created_at
FROM floorplan_pipeline_events
WHERE pipeline_id = (
  SELECT id FROM floorplan_pipelines ORDER BY created_at DESC LIMIT 1
)
ORDER BY created_at DESC
LIMIT 20;

-- 4. Check if you have any successful Step 0 runs
SELECT
  COUNT(*) FILTER (WHERE whole_apartment_phase = 'space_analysis_complete') as successful,
  COUNT(*) FILTER (WHERE last_error IS NOT NULL AND current_step = 0) as failed_at_step_0,
  COUNT(*) as total
FROM floorplan_pipelines
WHERE created_at > NOW() - INTERVAL '24 hours';

-- ═══════════════════════════════════════════════════════════════
-- INTERPRETATION
-- ═══════════════════════════════════════════════════════════════

-- Query 2 Results:
-- If status = '❌ UPLOAD NOT FOUND':
--   → Pipeline references deleted/invalid upload
--   → Need to re-upload floor plan

-- If status = '⚠️ FILE TOO LARGE (> 50 MB)':
--   → Floor plan is too large
--   → Need to compress before uploading

-- If status = '✅ OK':
--   → Upload exists and is valid
--   → Issue is likely transformations or function not deployed

-- Query 3 Results:
-- Look for the last message before error
-- Common patterns:
--   - "Analyzing floor plan structure..." then nothing
--     → Function crashed during image loading
--   - "[SPACE_ANALYSIS_START] Edge function error"
--     → Function returned 500

-- Query 4 Results:
-- If successful = 0 and failed_at_step_0 > 0:
--   → Step 0 is consistently failing
--   → Check Edge Function logs for actual error
