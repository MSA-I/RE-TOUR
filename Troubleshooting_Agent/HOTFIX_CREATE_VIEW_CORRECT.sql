-- HOTFIX: Create camera_intents_with_spaces view (CORRECTED VERSION)
-- Run this in Supabase Dashboard > SQL Editor
-- This fixes the 404 error when creating pipelines
-- This version works with the SIMPLE camera_intents table structure (space_id)

-- Create the view
CREATE OR REPLACE VIEW camera_intents_with_spaces AS
SELECT
  ci.*,
  s.name AS space_name,
  s.space_type AS space_type
FROM camera_intents ci
JOIN floorplan_pipeline_spaces s ON ci.space_id = s.id;

-- Grant access to authenticated and anon roles
GRANT SELECT ON camera_intents_with_spaces TO authenticated;
GRANT SELECT ON camera_intents_with_spaces TO anon;

-- Add indexes for performance (if they don't already exist)
CREATE INDEX IF NOT EXISTS idx_camera_intents_pipeline_selected
ON camera_intents(pipeline_id) WHERE is_selected = TRUE;

CREATE INDEX IF NOT EXISTS idx_camera_intents_space_selected
ON camera_intents(space_id, is_selected) WHERE is_selected = TRUE;

-- Verify the view was created
SELECT 'View created successfully!' AS status;
