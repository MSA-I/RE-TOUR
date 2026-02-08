-- Create table to store per-attempt history for pipeline steps
-- This enables showing all 5 failed attempts with their QA reasons in the manual review UI

CREATE TABLE IF NOT EXISTS public.floorplan_pipeline_step_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id uuid NOT NULL REFERENCES public.floorplan_pipelines(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL,
  step_number integer NOT NULL,
  attempt_index integer NOT NULL DEFAULT 1,
  output_upload_id uuid REFERENCES public.uploads(id) ON DELETE SET NULL,
  qa_status text NOT NULL DEFAULT 'pending',
  qa_reason_short text,
  qa_reason_full text,
  qa_result_json jsonb DEFAULT '{}'::jsonb,
  prompt_used text,
  model_used text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT valid_attempt_index CHECK (attempt_index >= 1 AND attempt_index <= 10),
  CONSTRAINT valid_qa_status CHECK (qa_status IN ('pending', 'approved', 'rejected', 'error'))
);

-- Create unique constraint on pipeline + step + attempt to prevent duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_step_attempts_unique 
ON public.floorplan_pipeline_step_attempts(pipeline_id, step_number, attempt_index);

-- Create index for fast lookup by pipeline and step
CREATE INDEX IF NOT EXISTS idx_step_attempts_lookup 
ON public.floorplan_pipeline_step_attempts(pipeline_id, step_number);

-- Enable RLS
ALTER TABLE public.floorplan_pipeline_step_attempts ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view their own step attempts"
ON public.floorplan_pipeline_step_attempts FOR SELECT
USING (auth.uid() = owner_id);

CREATE POLICY "Users can insert their own step attempts"
ON public.floorplan_pipeline_step_attempts FOR INSERT
WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update their own step attempts"
ON public.floorplan_pipeline_step_attempts FOR UPDATE
USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete their own step attempts"
ON public.floorplan_pipeline_step_attempts FOR DELETE
USING (auth.uid() = owner_id);