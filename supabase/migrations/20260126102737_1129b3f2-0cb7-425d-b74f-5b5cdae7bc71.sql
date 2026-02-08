-- Add fields for space exclusion/deletion
ALTER TABLE public.floorplan_pipeline_spaces 
ADD COLUMN IF NOT EXISTS is_excluded boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS include_in_generation boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS excluded_reason text,
ADD COLUMN IF NOT EXISTS excluded_at timestamp with time zone;