-- Diagnostic SQL: Check if AI suggestions are actually being generated
-- Run this in Supabase SQL Editor to understand the current state

-- 1. Find recent pipelines
SELECT
  id,
  created_at,
  whole_apartment_phase,
  step_outputs->'step2'->'output_upload_id' as has_step2_image,
  step_outputs->'space_analysis' as has_space_analysis
FROM floorplan_pipelines
ORDER BY created_at DESC
LIMIT 5;

-- 2. Check camera_intents for the most recent pipeline
-- Copy the pipeline ID from above and paste it below
WITH latest_pipeline AS (
  SELECT id FROM floorplan_pipelines ORDER BY created_at DESC LIMIT 1
)
SELECT
  ci.created_at,
  ci.updated_at,
  s.name as space_name,
  s.space_type,
  ci.space_size_category,
  ci.suggestion_index,
  ci.suggestion_text,
  LENGTH(ci.suggestion_text) as text_length
FROM camera_intents ci
JOIN floorplan_pipeline_spaces s ON ci.space_id = s.id
WHERE ci.pipeline_id = (SELECT id FROM latest_pipeline)
ORDER BY s.name, ci.suggestion_index;

-- 3. Check if suggestions are unique (AI-powered) or repetitive (templates)
WITH latest_pipeline AS (
  SELECT id FROM floorplan_pipelines ORDER BY created_at DESC LIMIT 1
)
SELECT
  COUNT(*) as total_suggestions,
  COUNT(DISTINCT suggestion_text) as unique_suggestions,
  AVG(LENGTH(suggestion_text)) as avg_length,
  CASE
    WHEN COUNT(DISTINCT suggestion_text) = COUNT(*) THEN 'LIKELY AI-POWERED (all unique)'
    WHEN AVG(LENGTH(suggestion_text)) > 100 THEN 'LIKELY AI-POWERED (detailed)'
    ELSE 'LIKELY TEMPLATES (generic/short)'
  END as assessment
FROM camera_intents
WHERE pipeline_id = (SELECT id FROM latest_pipeline);

-- 4. Show actual suggestion patterns to identify if they're generic
WITH latest_pipeline AS (
  SELECT id FROM floorplan_pipelines ORDER BY created_at DESC LIMIT 1
)
SELECT
  suggestion_text,
  COUNT(*) as occurrences,
  CASE
    WHEN suggestion_text LIKE '%Standard%' OR suggestion_text LIKE '%capturing the%' THEN 'GENERIC TEMPLATE'
    WHEN LENGTH(suggestion_text) > 100 THEN 'DETAILED (likely AI)'
    ELSE 'UNKNOWN'
  END as pattern_type
FROM camera_intents
WHERE pipeline_id = (SELECT id FROM latest_pipeline)
GROUP BY suggestion_text
ORDER BY occurrences DESC, LENGTH(suggestion_text) DESC;
