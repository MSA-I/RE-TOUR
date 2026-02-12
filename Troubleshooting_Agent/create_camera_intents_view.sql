-- Create proper camera_intents view for NEW architecture
-- This view joins camera_intents with their associated spaces
-- Compatible with the actual table structure (space_id, suggestion_text)

CREATE OR REPLACE VIEW camera_intents_with_spaces AS
SELECT
  ci.id,
  ci.pipeline_id,
  ci.space_id,
  ci.owner_id,
  ci.suggestion_text,
  ci.suggestion_index,
  ci.space_size_category,
  ci.is_selected,
  ci.selected_at,
  ci.created_at,
  ci.updated_at,
  s.name AS space_name,
  s.space_type,
  s.area_sqm,
  s.bounds_geojson
FROM camera_intents ci
JOIN floorplan_pipeline_spaces s ON ci.space_id = s.id;

-- Grant access to authenticated users
GRANT SELECT ON camera_intents_with_spaces TO authenticated;

-- Add comment
COMMENT ON VIEW camera_intents_with_spaces IS
'Helper view for querying camera intents with space details.
Shows AI-generated suggestions with associated space information.';
