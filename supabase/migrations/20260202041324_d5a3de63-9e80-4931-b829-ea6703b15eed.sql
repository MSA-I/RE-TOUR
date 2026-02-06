-- Create qa_judge_results table to persist QA judge outputs
-- This table stores the result of every QA evaluation attempt

CREATE TABLE public.qa_judge_results (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pipeline_id UUID NOT NULL,
  project_id UUID NOT NULL,
  owner_id UUID NOT NULL,
  step_number INTEGER NOT NULL,
  sub_step TEXT, -- nullable, for Step 3.1/3.2 differentiation
  output_id UUID, -- FK to uploads or space renders/panoramas
  attempt_index INTEGER NOT NULL DEFAULT 1,
  
  -- QA Result fields
  pass BOOLEAN NOT NULL,
  score NUMERIC(5,2), -- 0.00 to 100.00
  confidence NUMERIC(5,4), -- 0.0000 to 1.0000
  reasons TEXT[] NOT NULL DEFAULT '{}',
  violated_rules TEXT[] NOT NULL DEFAULT '{}',
  full_result JSONB NOT NULL DEFAULT '{}',
  
  -- Model/Prompt tracking
  judge_model TEXT NOT NULL,
  prompt_name TEXT,
  prompt_version TEXT,
  ab_bucket TEXT, -- 'A' or 'B' for A/B testing
  
  -- Timing
  processing_time_ms INTEGER,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Add comments for documentation
COMMENT ON TABLE public.qa_judge_results IS 'Stores QA judge evaluation results for every pipeline step attempt';
COMMENT ON COLUMN public.qa_judge_results.sub_step IS 'Sub-step identifier for Step 3 (3.1=space detection, 3.2=camera planning)';
COMMENT ON COLUMN public.qa_judge_results.pass IS 'Whether the output passed QA (true) or failed (false)';
COMMENT ON COLUMN public.qa_judge_results.score IS 'Numeric QA score from 0-100';
COMMENT ON COLUMN public.qa_judge_results.confidence IS 'Model confidence in the decision (0-1)';
COMMENT ON COLUMN public.qa_judge_results.reasons IS 'Array of human-readable rejection/approval reasons';
COMMENT ON COLUMN public.qa_judge_results.violated_rules IS 'Array of specific rule violations that caused rejection';
COMMENT ON COLUMN public.qa_judge_results.full_result IS 'Complete JSON result from the QA judge model';
COMMENT ON COLUMN public.qa_judge_results.ab_bucket IS 'A/B testing bucket assignment for this evaluation';

-- Create indexes for common query patterns
CREATE INDEX idx_qa_judge_results_pipeline_id ON public.qa_judge_results(pipeline_id);
CREATE INDEX idx_qa_judge_results_project_id ON public.qa_judge_results(project_id);
CREATE INDEX idx_qa_judge_results_owner_id ON public.qa_judge_results(owner_id);
CREATE INDEX idx_qa_judge_results_step ON public.qa_judge_results(pipeline_id, step_number, sub_step);
CREATE INDEX idx_qa_judge_results_output ON public.qa_judge_results(output_id);
CREATE INDEX idx_qa_judge_results_pass ON public.qa_judge_results(pass);
CREATE INDEX idx_qa_judge_results_ab ON public.qa_judge_results(ab_bucket) WHERE ab_bucket IS NOT NULL;
CREATE INDEX idx_qa_judge_results_created ON public.qa_judge_results(created_at DESC);

-- Composite index for fetching all attempts for a step
CREATE INDEX idx_qa_judge_results_step_attempts ON public.qa_judge_results(pipeline_id, step_number, attempt_index);

-- Enable Row Level Security
ALTER TABLE public.qa_judge_results ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can only access their own QA results
CREATE POLICY "Users can view their own QA judge results"
  ON public.qa_judge_results
  FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can insert their own QA judge results"
  ON public.qa_judge_results
  FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update their own QA judge results"
  ON public.qa_judge_results
  FOR UPDATE
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete their own QA judge results"
  ON public.qa_judge_results
  FOR DELETE
  USING (auth.uid() = owner_id);