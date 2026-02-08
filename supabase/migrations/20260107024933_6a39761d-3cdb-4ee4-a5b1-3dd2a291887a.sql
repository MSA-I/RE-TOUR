-- Create image_edit_jobs table for tracking image editing jobs
CREATE TABLE public.image_edit_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  source_upload_id UUID NOT NULL REFERENCES public.uploads(id) ON DELETE CASCADE,
  output_upload_id UUID REFERENCES public.uploads(id) ON DELETE SET NULL,
  change_description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  progress_int INTEGER DEFAULT 0,
  progress_message TEXT,
  last_error TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.image_edit_jobs ENABLE ROW LEVEL SECURITY;

-- RLS policies for image_edit_jobs
CREATE POLICY "Users can view their own image edit jobs"
  ON public.image_edit_jobs
  FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can create their own image edit jobs"
  ON public.image_edit_jobs
  FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update their own image edit jobs"
  ON public.image_edit_jobs
  FOR UPDATE
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete their own image edit jobs"
  ON public.image_edit_jobs
  FOR DELETE
  USING (auth.uid() = owner_id);

-- Create trigger for updated_at
CREATE TRIGGER update_image_edit_jobs_updated_at
  BEFORE UPDATE ON public.image_edit_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create image_edit_job_events for real-time progress tracking
CREATE TABLE public.image_edit_job_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES public.image_edit_jobs(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  progress_int INTEGER DEFAULT 0,
  ts TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.image_edit_job_events ENABLE ROW LEVEL SECURITY;

-- RLS policies for events
CREATE POLICY "Users can view their own image edit job events"
  ON public.image_edit_job_events
  FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can insert their own image edit job events"
  ON public.image_edit_job_events
  FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

-- Enable realtime for progress tracking
ALTER PUBLICATION supabase_realtime ADD TABLE public.image_edit_jobs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.image_edit_job_events;