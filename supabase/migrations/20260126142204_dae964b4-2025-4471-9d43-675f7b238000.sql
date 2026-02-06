-- Add camera_marker_id to link renders to specific camera markers
ALTER TABLE public.floorplan_space_renders
ADD COLUMN IF NOT EXISTS camera_marker_id UUID REFERENCES public.pipeline_camera_markers(id) ON DELETE SET NULL;

-- Add camera_label for display (stored after generation so we don't need joins)
ALTER TABLE public.floorplan_space_renders
ADD COLUMN IF NOT EXISTS camera_label TEXT;

-- Add final_composed_prompt to store the full prompt used for debugging/QA
ALTER TABLE public.floorplan_space_renders
ADD COLUMN IF NOT EXISTS final_composed_prompt TEXT;

-- Add adjacency_context to store the adjacency info used in prompt
ALTER TABLE public.floorplan_space_renders
ADD COLUMN IF NOT EXISTS adjacency_context JSONB;

-- Index for efficient lookup by camera marker
CREATE INDEX IF NOT EXISTS idx_space_renders_camera_marker 
ON public.floorplan_space_renders(camera_marker_id) 
WHERE camera_marker_id IS NOT NULL;

-- Add similar fields to panoramas for consistency
ALTER TABLE public.floorplan_space_panoramas
ADD COLUMN IF NOT EXISTS camera_marker_id UUID REFERENCES public.pipeline_camera_markers(id) ON DELETE SET NULL;

ALTER TABLE public.floorplan_space_panoramas
ADD COLUMN IF NOT EXISTS camera_label TEXT;

ALTER TABLE public.floorplan_space_panoramas
ADD COLUMN IF NOT EXISTS final_composed_prompt TEXT;

ALTER TABLE public.floorplan_space_panoramas
ADD COLUMN IF NOT EXISTS adjacency_context JSONB;

-- Index for panoramas too
CREATE INDEX IF NOT EXISTS idx_space_panoramas_camera_marker 
ON public.floorplan_space_panoramas(camera_marker_id) 
WHERE camera_marker_id IS NOT NULL;