-- Add camera scan status columns to floorplan_pipelines
ALTER TABLE public.floorplan_pipelines 
ADD COLUMN IF NOT EXISTS camera_scan_status text DEFAULT 'needs_scan',
ADD COLUMN IF NOT EXISTS camera_scan_updated_at timestamp with time zone;

-- Create pipeline_camera_scans table
CREATE TABLE IF NOT EXISTS public.pipeline_camera_scans (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pipeline_id uuid NOT NULL REFERENCES public.floorplan_pipelines(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'running',
  model_used text,
  results_json jsonb,
  version_hash text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  
  CONSTRAINT pipeline_camera_scans_status_check CHECK (status IN ('running', 'completed', 'failed'))
);

-- Enable RLS
ALTER TABLE public.pipeline_camera_scans ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own camera scans"
ON public.pipeline_camera_scans
FOR SELECT
USING (auth.uid() = owner_id);

CREATE POLICY "Users can insert their own camera scans"
ON public.pipeline_camera_scans
FOR INSERT
WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update their own camera scans"
ON public.pipeline_camera_scans
FOR UPDATE
USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete their own camera scans"
ON public.pipeline_camera_scans
FOR DELETE
USING (auth.uid() = owner_id);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_pipeline_camera_scans_pipeline_id ON public.pipeline_camera_scans(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_camera_scans_status ON public.pipeline_camera_scans(status);