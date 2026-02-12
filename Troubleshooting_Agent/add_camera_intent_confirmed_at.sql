-- Add camera_intent_confirmed_at column to floorplan_pipelines table
-- This tracks when user confirms their camera intent selections

ALTER TABLE floorplan_pipelines
ADD COLUMN IF NOT EXISTS camera_intent_confirmed_at TIMESTAMPTZ;

-- Add comment
COMMENT ON COLUMN floorplan_pipelines.camera_intent_confirmed_at IS
'Timestamp when user confirmed camera intent selections (Step 4)';

-- Verify column was added
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'floorplan_pipelines'
  AND column_name = 'camera_intent_confirmed_at';
