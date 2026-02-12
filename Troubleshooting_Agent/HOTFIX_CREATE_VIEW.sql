-- HOTFIX: Create camera_intents_with_spaces view
-- Run this in Supabase Dashboard > SQL Editor
-- This fixes the 404 error when creating pipelines

-- Create the view
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

-- Grant access to authenticated and anon roles
GRANT SELECT ON camera_intents_with_spaces TO authenticated;
GRANT SELECT ON camera_intents_with_spaces TO anon;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_camera_intents_pipeline_selected
ON camera_intents(pipeline_id) WHERE is_selected = TRUE;

CREATE INDEX IF NOT EXISTS idx_camera_intents_template
ON camera_intents(pipeline_id, template_id) WHERE is_selected = TRUE;

CREATE INDEX IF NOT EXISTS idx_camera_intents_generation_order
ON camera_intents(pipeline_id, generation_order) WHERE is_selected = TRUE;

-- Verify the view was created
SELECT 'View created successfully!' AS status;
