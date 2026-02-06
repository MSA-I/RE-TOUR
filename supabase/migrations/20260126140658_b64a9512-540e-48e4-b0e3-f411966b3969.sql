-- Add missing columns to pipeline_spatial_maps for full space graph support
ALTER TABLE public.pipeline_spatial_maps 
ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS locks_json JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now();

-- Create index for efficient querying
CREATE INDEX IF NOT EXISTS idx_pipeline_spatial_maps_pipeline_id 
ON public.pipeline_spatial_maps(pipeline_id);

CREATE INDEX IF NOT EXISTS idx_pipeline_camera_markers_pipeline_id 
ON public.pipeline_camera_markers(pipeline_id);

-- Add trigger for updated_at on pipeline_spatial_maps
CREATE OR REPLACE TRIGGER update_pipeline_spatial_maps_updated_at
BEFORE UPDATE ON public.pipeline_spatial_maps
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();