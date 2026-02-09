-- ═══════════════════════════════════════════════════════════════
-- Step 0 Diagnostic Queries
-- Run these to diagnose "Empty response from model" errors
-- ═══════════════════════════════════════════════════════════════

-- Replace with your pipeline ID
\set PIPELINE_ID 'c0d8ac86-8d49-45a8-90e9-8deee01e640f'

-- ═══════════════════════════════════════════════════════════════
-- 1. Check Pipeline State
-- ═══════════════════════════════════════════════════════════════
SELECT
  fp.id as pipeline_id,
  fp.floor_plan_upload_id,
  fp.current_step,
  fp.whole_apartment_phase,
  fp.status,
  fp.last_error,
  fp.step_outputs -> 'design_reference_ids' as design_refs,
  fp.step_outputs -> 'space_analysis_error' as error_debug,
  fp.created_at,
  fp.updated_at
FROM floorplan_pipelines fp
WHERE fp.id = :'PIPELINE_ID';

-- ═══════════════════════════════════════════════════════════════
-- 2. Check Floor Plan File Size
-- ═══════════════════════════════════════════════════════════════
SELECT
  u.id,
  u.original_filename,
  u.size_bytes,
  ROUND(u.size_bytes::numeric / 1024 / 1024, 2) as size_mb,
  u.original_width,
  u.original_height,
  u.mime_type,
  u.bucket,
  u.path,
  u.created_at
FROM floorplan_pipelines fp
JOIN uploads u ON fp.floor_plan_upload_id = u.id
WHERE fp.id = :'PIPELINE_ID';

-- ═══════════════════════════════════════════════════════════════
-- 3. Check Design References (if any)
-- ═══════════════════════════════════════════════════════════════
SELECT
  u.id,
  u.original_filename,
  u.size_bytes,
  ROUND(u.size_bytes::numeric / 1024 / 1024, 2) as size_mb,
  u.kind,
  u.bucket,
  u.path,
  u.created_at
FROM uploads u
WHERE u.project_id = (
  SELECT project_id FROM floorplan_pipelines
  WHERE id = :'PIPELINE_ID'
)
AND u.kind = 'design_ref'
ORDER BY u.created_at DESC;

-- ═══════════════════════════════════════════════════════════════
-- 4. Check Total Upload Sizes for Project
-- ═══════════════════════════════════════════════════════════════
SELECT
  u.kind,
  COUNT(*) as file_count,
  ROUND(SUM(u.size_bytes)::numeric / 1024 / 1024, 2) as total_mb,
  ROUND(AVG(u.size_bytes)::numeric / 1024 / 1024, 2) as avg_mb,
  ROUND(MAX(u.size_bytes)::numeric / 1024 / 1024, 2) as max_mb
FROM uploads u
WHERE u.project_id = (
  SELECT project_id FROM floorplan_pipelines
  WHERE id = :'PIPELINE_ID'
)
GROUP BY u.kind
ORDER BY total_mb DESC;

-- ═══════════════════════════════════════════════════════════════
-- ANALYSIS GUIDE
-- ═══════════════════════════════════════════════════════════════

/*
WHAT TO LOOK FOR:

1. Pipeline State (Query 1):
   - last_error: Shows error message
   - design_refs: If NOT NULL/empty, Step 0.1 (Style Analysis) will run
   - error_debug: Contains parse debug info if parse failed

2. Floor Plan Size (Query 2):
   - If size_mb > 15MB: Transformations are CRITICAL
   - If size_mb > 30MB: Even with transforms, may be too large

3. Design References (Query 3):
   - If no rows returned: Only Step 0.2 runs (floor plan analysis)
   - If rows exist: BOTH Step 0.1 (style) AND Step 0.2 (floor plan) run
   - Check size_mb for each reference: If > 15MB, transformations needed

4. Total Sizes (Query 4):
   - Shows aggregate upload sizes by type
   - If design_ref total_mb is high, likely cause of memory issues

NEXT STEPS:

If design references exist (Query 3 returns rows):
  → Step 0.1 (Style Analysis) is running
  → Before fix: Uses download() without transforms → Memory exceeded
  → After fix: Uses createSignedUrl() with transforms → Should work

If no design references (Query 3 returns nothing):
  → Only Step 0.2 (Floor Plan Analysis) runs
  → Already uses transforms (fetchImageAsBase64)
  → If failing, check Supabase Storage transformations enabled

TO RESET PIPELINE TO STEP 0:
-- Run this to retry Step 0
UPDATE floorplan_pipelines
SET
  status = 'step0_pending',
  whole_apartment_phase = 'space_analysis_pending',
  current_step = 0,
  last_error = NULL
WHERE id = :'PIPELINE_ID';
*/
