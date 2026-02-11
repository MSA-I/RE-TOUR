-- Migration: Split Step 0 into 0.1 (Design Reference Scan) and 0.2 (Space Scan)
-- Date: 2026-02-10
-- Purpose: Isolate Step 0.1 and 0.2 outputs to prevent overwrites

-- Add completion flags for Step 0 substeps
ALTER TABLE floorplan_pipelines
ADD COLUMN IF NOT EXISTS design_reference_scan_complete BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS space_scan_complete BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS design_reference_analyzed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS space_scan_analyzed_at TIMESTAMPTZ;

-- Migrate existing data: Rename JSON keys in step_outputs
UPDATE floorplan_pipelines
SET step_outputs = jsonb_set(
  jsonb_set(
    COALESCE(step_outputs, '{}'::jsonb),
    '{space_scan}',
    COALESCE(step_outputs->'space_analysis', '{}'::jsonb),
    TRUE
  ),
  '{design_reference_scan}',
  COALESCE(step_outputs->'reference_style_analysis', '{}'::jsonb),
  TRUE
)
WHERE step_outputs IS NOT NULL
  AND (
    step_outputs ? 'space_analysis' OR
    step_outputs ? 'reference_style_analysis'
  );

-- Remove old keys after migration
UPDATE floorplan_pipelines
SET step_outputs = step_outputs - 'space_analysis' - 'reference_style_analysis'
WHERE step_outputs ? 'space_analysis' OR step_outputs ? 'reference_style_analysis';

-- Set completion flags based on existing data
UPDATE floorplan_pipelines
SET
  space_scan_complete = TRUE,
  space_scan_analyzed_at = COALESCE(
    (step_outputs->'space_scan'->>'analyzed_at')::timestamptz,
    updated_at
  )
WHERE step_outputs->'space_scan' IS NOT NULL
  AND (step_outputs->'space_scan'->>'rooms_count') IS NOT NULL;

UPDATE floorplan_pipelines
SET
  design_reference_scan_complete = TRUE,
  design_reference_analyzed_at = COALESCE(
    (step_outputs->'design_reference_scan'->>'analyzed_at')::timestamptz,
    updated_at
  )
WHERE step_outputs->'design_reference_scan' IS NOT NULL
  AND (step_outputs->'design_reference_scan'->>'style_data') IS NOT NULL;

-- Migrate phases: space_analysis_* → space_scan_*
UPDATE floorplan_pipelines
SET whole_apartment_phase = CASE
  WHEN whole_apartment_phase = 'space_analysis_pending' THEN 'space_scan_pending'
  WHEN whole_apartment_phase = 'space_analysis_running' THEN 'space_scan_running'
  WHEN whole_apartment_phase = 'space_analysis_complete' THEN 'space_scan_complete'
  WHEN whole_apartment_phase = 'space_analysis_review' THEN 'space_scan_review'
  WHEN whole_apartment_phase = 'space_analysis_failed' THEN 'space_scan_failed'
  ELSE whole_apartment_phase
END
WHERE whole_apartment_phase LIKE 'space_analysis_%';

-- Add index for fast completion flag queries
CREATE INDEX IF NOT EXISTS idx_floorplan_pipelines_step_0_completion
ON floorplan_pipelines(design_reference_scan_complete, space_scan_complete)
WHERE design_reference_scan_complete IS TRUE OR space_scan_complete IS TRUE;

-- Add comments
COMMENT ON COLUMN floorplan_pipelines.design_reference_scan_complete IS 'Step 0.1 completion flag';
COMMENT ON COLUMN floorplan_pipelines.space_scan_complete IS 'Step 0.2 completion flag';
COMMENT ON COLUMN floorplan_pipelines.design_reference_analyzed_at IS 'Step 0.1 completion timestamp';
COMMENT ON COLUMN floorplan_pipelines.space_scan_analyzed_at IS 'Step 0.2 completion timestamp';
