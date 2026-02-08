-- Add ratio_locked and quality_post_step4 fields to floorplan_pipelines
-- These support the new quality policy where Steps 1-4 always run at 2K,
-- and the user can select quality for Steps 4+ only

ALTER TABLE public.floorplan_pipelines 
ADD COLUMN IF NOT EXISTS ratio_locked boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS quality_post_step4 text DEFAULT '2K';

-- Add constraint to ensure valid quality values
ALTER TABLE public.floorplan_pipelines
ADD CONSTRAINT check_quality_post_step4_valid 
CHECK (quality_post_step4 IS NULL OR quality_post_step4 IN ('1K', '2K', '4K'));

-- Add comment for documentation
COMMENT ON COLUMN public.floorplan_pipelines.ratio_locked IS 'Once true, the aspect_ratio cannot be changed for this pipeline';
COMMENT ON COLUMN public.floorplan_pipelines.quality_post_step4 IS 'Quality setting for Steps 4+ (Renders, Panoramas, Merge). Steps 1-3 always use 2K.';