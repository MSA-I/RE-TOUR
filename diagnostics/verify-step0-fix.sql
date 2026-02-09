-- ═══════════════════════════════════════════════════════════════════════════
-- Step 0 Stability Fix - Verification Queries
-- Version: 2.2.0-stability-fix
-- ═══════════════════════════════════════════════════════════════════════════

-- QUERY 1: Check Pipeline State
-- Run this BEFORE triggering Step 0
SELECT
  id,
  whole_apartment_phase,
  status,
  current_step,
  last_error,
  floor_plan_upload_id,
  project_id,
  created_at,
  updated_at
FROM floorplan_pipelines
WHERE id = 'c0d8ac86-8d49-45a8-90e9-8deee01e640f';

-- QUERY 2: Check Floor Plan Upload
-- Verify the upload exists and check size
SELECT
  id,
  original_filename,
  mime_type,
  size_bytes,
  ROUND(size_bytes / 1024.0 / 1024.0, 2) as size_mb,
  bucket,
  path,
  created_at
FROM uploads
WHERE id = (
  SELECT floor_plan_upload_id
  FROM floorplan_pipelines
  WHERE id = 'c0d8ac86-8d49-45a8-90e9-8deee01e640f'
);

-- QUERY 3: Check Design References (if any)
-- Verify design references exist and check sizes
SELECT
  u.id,
  u.original_filename,
  u.mime_type,
  ROUND(u.size_bytes / 1024.0 / 1024.0, 2) as size_mb,
  u.bucket,
  u.path,
  u.created_at
FROM uploads u
WHERE u.id = ANY(
  SELECT jsonb_array_elements_text(step_outputs->'design_reference_ids')::uuid
  FROM floorplan_pipelines
  WHERE id = 'c0d8ac86-8d49-45a8-90e9-8deee01e640f'
    AND step_outputs->'design_reference_ids' IS NOT NULL
);

-- QUERY 4: Reset Pipeline to Step 0 (Use if needed)
-- Run this to reset the pipeline to test again
/*
UPDATE floorplan_pipelines
SET
  whole_apartment_phase = 'space_analysis_pending',
  status = 'step0_pending',
  current_step = 0,
  last_error = NULL
WHERE id = 'c0d8ac86-8d49-45a8-90e9-8deee01e640f';
*/

-- QUERY 5: Check Step 0 Outputs (After Running)
-- Run this AFTER Step 0 completes to verify outputs
SELECT
  id,
  whole_apartment_phase,
  status,
  last_error,
  (step_outputs->'space_analysis'->>'rooms_count')::int as rooms_count,
  (step_outputs->'space_analysis'->>'zones_count')::int as zones_count,
  (step_outputs->'space_analysis'->>'analyzed_at') as analyzed_at,
  (step_outputs->'space_analysis'->>'pipeline_id') as output_pipeline_id,
  CASE
    WHEN step_outputs->'reference_style_analysis' IS NOT NULL THEN 'Yes'
    ELSE 'No'
  END as has_style_analysis,
  updated_at
FROM floorplan_pipelines
WHERE id = 'c0d8ac86-8d49-45a8-90e9-8deee01e640f';

-- QUERY 6: Check Room Names (Validation)
-- Verify room names are human-readable
SELECT
  jsonb_array_elements(step_outputs->'space_analysis'->'rooms')->>'room_name' as room_name,
  jsonb_array_elements(step_outputs->'space_analysis'->'rooms')->>'room_id' as room_id,
  (jsonb_array_elements(step_outputs->'space_analysis'->'rooms')->>'confidence')::numeric as confidence
FROM floorplan_pipelines
WHERE id = 'c0d8ac86-8d49-45a8-90e9-8deee01e640f'
  AND step_outputs->'space_analysis'->'rooms' IS NOT NULL;

-- QUERY 7: Check Recent Step 0 Success Rate
-- Monitor overall success rate for Step 0
SELECT
  COUNT(*) as total_runs,
  COUNT(*) FILTER (WHERE whole_apartment_phase = 'space_analysis_complete') as successful,
  COUNT(*) FILTER (WHERE last_error IS NOT NULL AND current_step = 0) as failed,
  ROUND(
    COUNT(*) FILTER (WHERE whole_apartment_phase = 'space_analysis_complete') * 100.0 / NULLIF(COUNT(*), 0),
    2
  ) as success_rate_percent
FROM floorplan_pipelines
WHERE created_at > NOW() - INTERVAL '24 hours'
  AND current_step >= 0;

-- QUERY 8: Check Recent Errors (If Any)
-- See what errors are occurring
SELECT
  id,
  whole_apartment_phase,
  current_step,
  last_error,
  updated_at
FROM floorplan_pipelines
WHERE last_error IS NOT NULL
  AND current_step = 0
  AND updated_at > NOW() - INTERVAL '24 hours'
ORDER BY updated_at DESC
LIMIT 10;

-- ═══════════════════════════════════════════════════════════════════════════
-- EXPECTED RESULTS AFTER FIX
-- ═══════════════════════════════════════════════════════════════════════════

-- Query 1 (Before):
-- whole_apartment_phase: 'space_analysis_pending'
-- status: 'step0_pending'
-- current_step: 0
-- last_error: NULL

-- Query 1 (After):
-- whole_apartment_phase: 'space_analysis_complete'
-- status: 'step0_complete' or 'step1_pending'
-- current_step: 0 or 1
-- last_error: NULL

-- Query 5 (After):
-- rooms_count: > 0 (e.g., 4)
-- zones_count: >= 0 (e.g., 2)
-- analyzed_at: Recent timestamp
-- output_pipeline_id: Matches pipeline ID
-- has_style_analysis: 'Yes' if design refs attached, 'No' otherwise

-- Query 6 (After):
-- room_name: Human-readable names like "Kitchen", "Living Room", "Bedroom 1"
-- NOT: "room_1", "space_2", "1", "2", etc.

-- Query 7:
-- success_rate_percent: Should be > 95% after fix
-- Before fix: ~50% or lower

-- ═══════════════════════════════════════════════════════════════════════════
-- TROUBLESHOOTING QUERIES
-- ═══════════════════════════════════════════════════════════════════════════

-- Check if transformations are working (look at Edge Function logs):
-- Expected log messages:
-- [fetchImageAsBase64] Original file: floorplan.png (28.50 MB)
-- [fetchImageAsBase64] Transformed size: 3.45 MB
-- [fetchImageAsBase64] Size reduction: 28.50 MB → 3.45 MB (87.9% reduction)

-- If you see:
-- [fetchImageAsBase64] Failed to create signed URL
-- → Transformations are not enabled

-- If you see:
-- [fetchImageAsBase64] Transformed image still too large: 18.45 MB
-- → Transformations are not working correctly

-- ═══════════════════════════════════════════════════════════════════════════
