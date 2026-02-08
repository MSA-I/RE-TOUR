-- Create table for multi-image panorama jobs (experimental feature)
CREATE TABLE public.multi_image_panorama_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  input_upload_ids JSONB NOT NULL DEFAULT '[]'::jsonb, -- Array of upload IDs used as input sources
  output_upload_id UUID REFERENCES public.uploads(id),
  camera_position TEXT,
  forward_direction TEXT,
  output_resolution TEXT DEFAULT '2K',
  aspect_ratio TEXT DEFAULT '2:1', -- Equirectangular default
  progress_int INTEGER DEFAULT 0,
  progress_message TEXT,
  last_error TEXT,
  prompt_used TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.multi_image_panorama_jobs ENABLE ROW LEVEL SECURITY;

-- RLS policies for multi_image_panorama_jobs
CREATE POLICY "Users can view their own multi-image panorama jobs"
ON public.multi_image_panorama_jobs
FOR SELECT
USING (auth.uid() = owner_id);

CREATE POLICY "Users can create their own multi-image panorama jobs"
ON public.multi_image_panorama_jobs
FOR INSERT
WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update their own multi-image panorama jobs"
ON public.multi_image_panorama_jobs
FOR UPDATE
USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete their own multi-image panorama jobs"
ON public.multi_image_panorama_jobs
FOR DELETE
USING (auth.uid() = owner_id);

-- Create events table for real-time logging
CREATE TABLE public.multi_image_panorama_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES public.multi_image_panorama_jobs(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  progress_int INTEGER DEFAULT 0,
  ts TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS for events
ALTER TABLE public.multi_image_panorama_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own multi-image panorama events"
ON public.multi_image_panorama_events
FOR SELECT
USING (auth.uid() = owner_id);

CREATE POLICY "Users can insert their own multi-image panorama events"
ON public.multi_image_panorama_events
FOR INSERT
WITH CHECK (auth.uid() = owner_id);

-- Enable realtime for events
ALTER PUBLICATION supabase_realtime ADD TABLE public.multi_image_panorama_events;

-- Add updated_at trigger
CREATE TRIGGER update_multi_image_panorama_jobs_updated_at
BEFORE UPDATE ON public.multi_image_panorama_jobs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();