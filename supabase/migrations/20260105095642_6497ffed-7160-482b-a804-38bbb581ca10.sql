-- CHANGE 3: Create render_job_attempts table for QA tracking
CREATE TABLE public.render_job_attempts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES public.render_jobs(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL,
  attempt_number INTEGER NOT NULL DEFAULT 1,
  nano_prompt_used TEXT,
  qa_decision TEXT, -- 'approved' | 'rejected' | 'pending'
  qa_reason TEXT,
  output_upload_id UUID REFERENCES public.uploads(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.render_job_attempts ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view their own job attempts" 
ON public.render_job_attempts 
FOR SELECT 
USING (auth.uid() = owner_id);

CREATE POLICY "Users can insert their own job attempts" 
ON public.render_job_attempts 
FOR INSERT 
WITH CHECK (auth.uid() = owner_id);

-- Add qa_status and qa_reason to render_jobs (Change 3)
ALTER TABLE public.render_jobs 
ADD COLUMN IF NOT EXISTS qa_status TEXT DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS qa_reason TEXT,
ADD COLUMN IF NOT EXISTS max_attempts INTEGER DEFAULT 3;

-- Add panorama_deleted flag to render_jobs (Change 2)
ALTER TABLE public.render_jobs 
ADD COLUMN IF NOT EXISTS panorama_deleted BOOLEAN DEFAULT false;

-- Create index for efficient job_id lookups
CREATE INDEX idx_render_job_attempts_job_id ON public.render_job_attempts(job_id);

-- Enable realtime for attempts table
ALTER PUBLICATION supabase_realtime ADD TABLE public.render_job_attempts;