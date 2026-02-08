-- Create batch_job_events table for real-time progress streaming (similar to render_job_events)
CREATE TABLE public.batch_job_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  batch_job_id UUID NOT NULL REFERENCES public.batch_jobs(id) ON DELETE CASCADE,
  item_id UUID REFERENCES public.batch_jobs_items(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL,
  ts TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  progress_int INTEGER NOT NULL DEFAULT 0
);

-- Add indexes for efficient querying
CREATE INDEX idx_batch_job_events_batch_job_id ON public.batch_job_events(batch_job_id);
CREATE INDEX idx_batch_job_events_item_id ON public.batch_job_events(item_id);
CREATE INDEX idx_batch_job_events_ts ON public.batch_job_events(ts);

-- Enable RLS
ALTER TABLE public.batch_job_events ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can insert their own batch events"
ON public.batch_job_events
FOR INSERT
WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can view their own batch events"
ON public.batch_job_events
FOR SELECT
USING (auth.uid() = owner_id);

-- Add QA fields to batch_jobs_items for per-item QA tracking
ALTER TABLE public.batch_jobs_items
ADD COLUMN IF NOT EXISTS qa_decision TEXT,
ADD COLUMN IF NOT EXISTS qa_reason TEXT,
ADD COLUMN IF NOT EXISTS attempt_number INTEGER DEFAULT 1;

-- Enable realtime for batch_job_events
ALTER PUBLICATION supabase_realtime ADD TABLE public.batch_job_events;