-- Create render_job_events table for real-time progress tracking
CREATE TABLE public.render_job_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES public.render_jobs(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL,
  ts TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  progress_int INTEGER NOT NULL DEFAULT 0 CHECK (progress_int >= 0 AND progress_int <= 100)
);

-- Enable Row Level Security
ALTER TABLE public.render_job_events ENABLE ROW LEVEL SECURITY;

-- Create policies for user access
CREATE POLICY "Users can view their own job events" 
ON public.render_job_events 
FOR SELECT 
USING (auth.uid() = owner_id);

CREATE POLICY "Users can insert their own job events" 
ON public.render_job_events 
FOR INSERT 
WITH CHECK (auth.uid() = owner_id);

-- Create index for efficient queries by job_id
CREATE INDEX idx_render_job_events_job_id ON public.render_job_events(job_id);
CREATE INDEX idx_render_job_events_ts ON public.render_job_events(job_id, ts);

-- Enable realtime for this table
ALTER PUBLICATION supabase_realtime ADD TABLE public.render_job_events;

-- Add progress_int column to render_jobs if it doesn't exist (for caching latest progress)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'render_jobs' AND column_name = 'progress_int') THEN
    ALTER TABLE public.render_jobs ADD COLUMN progress_int INTEGER DEFAULT 0;
  END IF;
END $$;