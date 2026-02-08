-- Add progress tracking to render_jobs table
ALTER TABLE public.render_jobs ADD COLUMN IF NOT EXISTS progress INTEGER DEFAULT 0;
ALTER TABLE public.render_jobs ADD COLUMN IF NOT EXISTS progress_message TEXT DEFAULT NULL;

-- Enable realtime for progress updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.render_jobs;