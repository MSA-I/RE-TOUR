-- Add reference_image_ids to floorplan_pipeline_spaces for per-space reference selection
ALTER TABLE public.floorplan_pipeline_spaces 
ADD COLUMN reference_image_ids JSONB DEFAULT '[]'::jsonb;

-- Add comment
COMMENT ON COLUMN public.floorplan_pipeline_spaces.reference_image_ids IS 
'Array of upload IDs from Step 4+ outputs to use as style references for this specific space';