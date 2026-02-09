-- ═══════════════════════════════════════════════════════════════
-- Verify Style Analysis Integration
-- Run this to check if design references are flowing into Step 2
-- ═══════════════════════════════════════════════════════════════

-- QUERY 1: Check if style analysis exists for your pipeline
SELECT
  id as pipeline_id,
  whole_apartment_phase,
  current_step,
  -- Check if design references were attached
  (step_outputs->'design_reference_ids') IS NOT NULL as has_design_refs,
  jsonb_array_length(COALESCE(step_outputs->'design_reference_ids', '[]'::jsonb)) as ref_count,
  -- Check if style analysis was generated
  (step_outputs->'reference_style_analysis') IS NOT NULL as has_style_analysis,
  -- Extract style summary if available
  step_outputs->'reference_style_analysis'->>'summary' as style_summary,
  -- Check analyzed timestamp
  step_outputs->'reference_style_analysis'->>'analyzed_at' as analyzed_at,
  -- Check style constraints block length (for Step 2 injection)
  length(step_outputs->'reference_style_analysis'->>'style_constraints_block') as constraints_length
FROM floorplan_pipelines
WHERE id = '<your-pipeline-id>' -- Replace with your pipeline ID
  OR created_at > NOW() - INTERVAL '24 hours' -- Or check recent pipelines
ORDER BY created_at DESC
LIMIT 5;

-- EXPECTED RESULTS:
-- has_design_refs: true (if you attached design references)
-- ref_count: 1-3 (number of design reference images)
-- has_style_analysis: true (should be true if has_design_refs is true)
-- style_summary: Short description like "Modern minimalist aesthetic..."
-- analyzed_at: Recent timestamp
-- constraints_length: 500-1500 characters

-- ═══════════════════════════════════════════════════════════════

-- QUERY 2: View full style analysis data
SELECT
  id,
  step_outputs->'reference_style_analysis' as full_style_analysis
FROM floorplan_pipelines
WHERE id = '<your-pipeline-id>'
  AND (step_outputs->'reference_style_analysis') IS NOT NULL;

-- This shows the complete style analysis structure:
-- {
--   "analyzed_at": "...",
--   "design_ref_ids": ["..."],
--   "style_data": {
--     "design_style": {...},
--     "color_palette": {...},
--     "materials": {...},
--     ...
--   },
--   "style_constraints_block": "STYLE PROFILE (for Step 2)...",
--   "summary": "..."
-- }

-- ═══════════════════════════════════════════════════════════════

-- QUERY 3: Check Step 2 events for style injection
SELECT
  pipeline_id,
  step_number,
  type,
  message,
  created_at
FROM floorplan_pipeline_events
WHERE pipeline_id = '<your-pipeline-id>'
  AND step_number = 2
  AND (
    message LIKE '%style%'
    OR message LIKE '%reference%'
    OR type = 'style_constraints_injected'
  )
ORDER BY created_at DESC;

-- EXPECTED EVENTS:
-- "Applying style from N reference image(s) (pre-analyzed)"
-- "Style analysis injected: Modern Minimalist" (or similar)
-- Type: "style_constraints_injected"

-- ═══════════════════════════════════════════════════════════════

-- QUERY 4: Verify design reference images exist
SELECT
  u.id,
  u.original_filename,
  ROUND(u.size_bytes / 1024.0 / 1024.0, 2) as size_mb,
  u.mime_type,
  u.created_at
FROM uploads u
WHERE u.id = ANY(
  SELECT jsonb_array_elements_text(step_outputs->'design_reference_ids')::uuid
  FROM floorplan_pipelines
  WHERE id = '<your-pipeline-id>'
)
ORDER BY u.created_at;

-- This shows all design reference images attached to the pipeline

-- ═══════════════════════════════════════════════════════════════

-- QUERY 5: Quick status check
SELECT
  CASE
    WHEN (step_outputs->'design_reference_ids') IS NULL THEN
      '❌ NO DESIGN REFERENCES - Style analysis will not run'
    WHEN (step_outputs->'reference_style_analysis') IS NULL THEN
      '⚠️ DESIGN REFS EXIST BUT NO STYLE ANALYSIS - Check Step 0 logs'
    WHEN length(step_outputs->'reference_style_analysis'->>'style_constraints_block') > 500 THEN
      '✅ STYLE ANALYSIS COMPLETE - Ready for Step 2'
    ELSE
      '⚠️ STYLE ANALYSIS EXISTS BUT MAY BE INCOMPLETE'
  END as status,
  jsonb_array_length(COALESCE(step_outputs->'design_reference_ids', '[]'::jsonb)) as ref_count,
  step_outputs->'reference_style_analysis'->>'summary' as style_summary
FROM floorplan_pipelines
WHERE id = '<your-pipeline-id>';

-- ═══════════════════════════════════════════════════════════════
-- INTERPRETATION
-- ═══════════════════════════════════════════════════════════════

-- ✅ WORKING CORRECTLY IF:
-- 1. has_design_refs = true AND ref_count > 0
-- 2. has_style_analysis = true
-- 3. constraints_length > 500
-- 4. Step 2 events show "style_constraints_injected"

-- ⚠️ ISSUE IF:
-- 1. has_design_refs = true BUT has_style_analysis = false
--    → Style analysis failed in Step 0
--    → Check Step 0 logs for errors

-- 2. has_style_analysis = true BUT constraints_length < 100
--    → Style analysis incomplete or malformed
--    → May need to re-run Step 0

-- 3. No Step 2 events about style
--    → Step 2 hasn't run yet, OR
--    → Style injection logic not working

-- ═══════════════════════════════════════════════════════════════
