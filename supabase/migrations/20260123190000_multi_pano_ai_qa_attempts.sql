-- Multi-Pano: AI QA + per-attempt persistence

-- Expand allowed statuses
ALTER TABLE public.multi_image_panorama_jobs
  DROP CONSTRAINT IF EXISTS multi_image_panorama_jobs_status_check;

ALTER TABLE public.multi_image_panorama_jobs
  ADD CONSTRAINT multi_image_panorama_jobs_status_check
  CHECK (
    status IN (
      'pending',
      'running',
      'qa_running',
      'completed',
      'approved',
      'needs_review',
      'failed'
    )
  );

-- Add QA summary fields (latest attempt)
ALTER TABLE public.multi_image_panorama_jobs
  ADD COLUMN IF NOT EXISTS qa_summary TEXT,
  ADD COLUMN IF NOT EXISTS qa_issues JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;

-- Attempt history table
CREATE TABLE IF NOT EXISTS public.multi_image_panorama_attempts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES public.multi_image_panorama_jobs(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL,
  attempt_number INTEGER NOT NULL,
  nano_request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  prompt_used TEXT,
  output_upload_id UUID REFERENCES public.uploads(id),
  qa_pass BOOLEAN NOT NULL DEFAULT FALSE,
  qa_issues JSONB NOT NULL DEFAULT '[]'::jsonb,
  qa_summary TEXT,
  corrective_instruction TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (job_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS idx_multi_image_panorama_attempts_job_id
  ON public.multi_image_panorama_attempts(job_id);

ALTER TABLE public.multi_image_panorama_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own multi-image panorama attempts"
ON public.multi_image_panorama_attempts
FOR SELECT
USING (auth.uid() = owner_id);

CREATE POLICY "Users can insert their own multi-image panorama attempts"
ON public.multi_image_panorama_attempts
FOR INSERT
WITH CHECK (auth.uid() = owner_id);
