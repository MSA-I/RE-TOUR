-- Add heartbeat column for comprehensive step tracking
ALTER TABLE floorplan_pipelines 
ADD COLUMN IF NOT EXISTS current_step_last_heartbeat_at timestamptz;