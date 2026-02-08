-- Create qa_attempt_feedback table for Like/Dislike feedback on individual QA attempts
CREATE TABLE public.qa_attempt_feedback (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL,
  pipeline_id UUID NOT NULL,
  owner_id UUID NOT NULL,
  step_id INTEGER NOT NULL,
  attempt_number INTEGER NOT NULL,
  image_id UUID,
  qa_decision TEXT NOT NULL CHECK (qa_decision IN ('approved', 'rejected')),
  qa_reasons JSONB DEFAULT '[]'::jsonb,
  user_vote TEXT NOT NULL CHECK (user_vote IN ('like', 'dislike')),
  user_category TEXT NOT NULL CHECK (user_category IN ('furniture_scale', 'extra_furniture', 'structural_change', 'flooring_mismatch', 'other')),
  user_comment_short TEXT,
  context_snapshot JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Unique constraint to prevent duplicate votes on same attempt
  CONSTRAINT unique_attempt_feedback UNIQUE (pipeline_id, step_id, attempt_number, image_id)
);

-- Enable Row Level Security
ALTER TABLE public.qa_attempt_feedback ENABLE ROW LEVEL SECURITY;

-- Create RLS policies (owner-only access)
CREATE POLICY "Users can view their own QA attempt feedback"
  ON public.qa_attempt_feedback
  FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can insert their own QA attempt feedback"
  ON public.qa_attempt_feedback
  FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update their own QA attempt feedback"
  ON public.qa_attempt_feedback
  FOR UPDATE
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete their own QA attempt feedback"
  ON public.qa_attempt_feedback
  FOR DELETE
  USING (auth.uid() = owner_id);

-- Create index for efficient lookups
CREATE INDEX idx_qa_attempt_feedback_pipeline ON public.qa_attempt_feedback(pipeline_id, step_id);
CREATE INDEX idx_qa_attempt_feedback_owner ON public.qa_attempt_feedback(owner_id, step_id, user_category);