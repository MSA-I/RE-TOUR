-- Add Step 3 retry tracking fields to floorplan_pipelines
ALTER TABLE public.floorplan_pipelines
ADD COLUMN IF NOT EXISTS step3_job_id uuid,
ADD COLUMN IF NOT EXISTS step3_last_backend_event_at timestamptz,
ADD COLUMN IF NOT EXISTS step3_attempt_count integer DEFAULT 0;