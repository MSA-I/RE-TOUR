-- Add pause/resume control fields to floorplan_pipelines
ALTER TABLE floorplan_pipelines
ADD COLUMN IF NOT EXISTS is_enabled boolean NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS run_state text DEFAULT 'active',
ADD COLUMN IF NOT EXISTS paused_at timestamptz,
ADD COLUMN IF NOT EXISTS resumed_at timestamptz,
ADD COLUMN IF NOT EXISTS pause_reason text;

-- Add constraint for run_state values
ALTER TABLE floorplan_pipelines 
DROP CONSTRAINT IF EXISTS valid_run_state_values;

ALTER TABLE floorplan_pipelines
ADD CONSTRAINT valid_run_state_values 
CHECK (run_state IN ('active', 'paused', 'completed', 'failed', 'cancelled'));

-- Create index for efficient filtering by is_enabled
CREATE INDEX IF NOT EXISTS idx_floorplan_pipelines_is_enabled 
ON floorplan_pipelines(is_enabled);

-- Create index for run_state filtering
CREATE INDEX IF NOT EXISTS idx_floorplan_pipelines_run_state 
ON floorplan_pipelines(run_state);