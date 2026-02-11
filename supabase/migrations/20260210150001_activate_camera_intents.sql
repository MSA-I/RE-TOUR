-- Migration: Activate Camera Intents (Step 3 - Templates A-H)
-- Date: 2026-02-10
-- Purpose: Unfreeze camera_intents table for NEW Step 3 implementation

-- Update table comment to indicate activation
COMMENT ON TABLE camera_intents IS 'Step 3 Camera Intent selections using Templates A-H (ACTIVE)';

-- Add helper view for UI queries
CREATE OR REPLACE VIEW camera_intents_with_spaces AS
SELECT
  ci.*,
  ss.name AS standing_space_name,
  ss.space_type AS standing_space_type,
  ts.name AS target_space_name,
  ts.space_type AS target_space_type
FROM camera_intents ci
JOIN floorplan_pipeline_spaces ss ON ci.standing_space_id = ss.id
LEFT JOIN floorplan_pipeline_spaces ts ON ci.target_space_id = ts.id;

-- Add index for fast pipeline lookup
CREATE INDEX IF NOT EXISTS idx_camera_intents_pipeline_selected
ON camera_intents(pipeline_id) WHERE is_selected = TRUE;

-- Add index for template queries
CREATE INDEX IF NOT EXISTS idx_camera_intents_template
ON camera_intents(pipeline_id, template_id) WHERE is_selected = TRUE;

-- Add index for generation order
CREATE INDEX IF NOT EXISTS idx_camera_intents_generation_order
ON camera_intents(pipeline_id, generation_order) WHERE is_selected = TRUE;

-- Migrate existing camera_plan phases → camera_intent phases
UPDATE floorplan_pipelines
SET whole_apartment_phase = CASE
  WHEN whole_apartment_phase = 'camera_plan_pending' THEN 'camera_intent_pending'
  WHEN whole_apartment_phase = 'camera_plan_confirmed' THEN 'camera_intent_confirmed'
  ELSE whole_apartment_phase
END
WHERE whole_apartment_phase IN ('camera_plan_pending', 'camera_plan_confirmed');

-- Add timestamp field for camera intent confirmation
ALTER TABLE floorplan_pipelines
ADD COLUMN IF NOT EXISTS camera_intent_confirmed_at TIMESTAMPTZ;

-- Migrate existing camera_plan_confirmed_at → camera_intent_confirmed_at
UPDATE floorplan_pipelines
SET camera_intent_confirmed_at = camera_plan_confirmed_at
WHERE camera_plan_confirmed_at IS NOT NULL
  AND camera_intent_confirmed_at IS NULL;

-- Add comment
COMMENT ON COLUMN floorplan_pipelines.camera_intent_confirmed_at IS 'Step 3 Camera Intent confirmation timestamp (Templates A-H)';
