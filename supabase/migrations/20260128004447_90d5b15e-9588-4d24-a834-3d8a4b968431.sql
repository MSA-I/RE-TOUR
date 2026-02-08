-- QA Learning System Tables
-- Stores user feedback on QA decisions for learning

-- 1) qa_human_feedback - Core feedback storage
CREATE TABLE public.qa_human_feedback (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  pipeline_id UUID NOT NULL REFERENCES public.floorplan_pipelines(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL,
  step_id INTEGER NOT NULL,
  attempt_number INTEGER NOT NULL DEFAULT 1,
  image_id UUID REFERENCES public.uploads(id) ON DELETE SET NULL,
  user_decision TEXT NOT NULL CHECK (user_decision IN ('approved', 'rejected')),
  user_category TEXT NOT NULL CHECK (user_category IN ('furniture_scale', 'extra_furniture', 'structural_change', 'flooring_mismatch', 'other')),
  user_reason_short TEXT NOT NULL CHECK (char_length(user_reason_short) <= 200),
  qa_original_status TEXT CHECK (qa_original_status IN ('approved', 'rejected', 'pending')),
  qa_original_reasons JSONB DEFAULT '[]'::jsonb,
  context_snapshot JSONB DEFAULT '{}'::jsonb,
  qa_was_wrong BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.qa_human_feedback ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own QA feedback"
  ON public.qa_human_feedback FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can insert their own QA feedback"
  ON public.qa_human_feedback FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update their own QA feedback"
  ON public.qa_human_feedback FOR UPDATE
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete their own QA feedback"
  ON public.qa_human_feedback FOR DELETE
  USING (auth.uid() = owner_id);

-- Indexes for feedback retrieval
CREATE INDEX idx_qa_human_feedback_pipeline ON public.qa_human_feedback(pipeline_id);
CREATE INDEX idx_qa_human_feedback_step ON public.qa_human_feedback(step_id);
CREATE INDEX idx_qa_human_feedback_category ON public.qa_human_feedback(user_category);
CREATE INDEX idx_qa_human_feedback_project ON public.qa_human_feedback(project_id);

-- 2) qa_policy_rules - Learned rules from user feedback
CREATE TABLE public.qa_policy_rules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL,
  scope_level TEXT NOT NULL CHECK (scope_level IN ('global', 'project', 'step')),
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  step_id INTEGER,
  category TEXT NOT NULL CHECK (category IN ('furniture_scale', 'extra_furniture', 'structural_change', 'flooring_mismatch', 'other', 'general')),
  rule_text TEXT NOT NULL CHECK (char_length(rule_text) <= 500),
  rule_status TEXT NOT NULL DEFAULT 'pending' CHECK (rule_status IN ('active', 'pending', 'disabled')),
  support_count INTEGER NOT NULL DEFAULT 1,
  last_supported_at TIMESTAMPTZ DEFAULT now(),
  created_from_feedback_id UUID REFERENCES public.qa_human_feedback(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.qa_policy_rules ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own QA policy rules"
  ON public.qa_policy_rules FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can insert their own QA policy rules"
  ON public.qa_policy_rules FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update their own QA policy rules"
  ON public.qa_policy_rules FOR UPDATE
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete their own QA policy rules"
  ON public.qa_policy_rules FOR DELETE
  USING (auth.uid() = owner_id);

-- Indexes for rule retrieval
CREATE INDEX idx_qa_policy_rules_scope ON public.qa_policy_rules(scope_level, rule_status);
CREATE INDEX idx_qa_policy_rules_step ON public.qa_policy_rules(step_id);
CREATE INDEX idx_qa_policy_rules_category ON public.qa_policy_rules(category);
CREATE INDEX idx_qa_policy_rules_project ON public.qa_policy_rules(project_id);

-- 3) qa_case_index - Searchable index for similar case retrieval
CREATE TABLE public.qa_case_index (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  feedback_id UUID NOT NULL REFERENCES public.qa_human_feedback(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL,
  step_id INTEGER NOT NULL,
  category TEXT NOT NULL,
  searchable_text TEXT NOT NULL,
  outcome_type TEXT NOT NULL CHECK (outcome_type IN ('false_reject', 'false_approve', 'confirmed_correct')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.qa_case_index ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own QA case index"
  ON public.qa_case_index FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can insert their own QA case index"
  ON public.qa_case_index FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can delete their own QA case index"
  ON public.qa_case_index FOR DELETE
  USING (auth.uid() = owner_id);

-- Indexes for similarity search
CREATE INDEX idx_qa_case_index_step ON public.qa_case_index(step_id);
CREATE INDEX idx_qa_case_index_category ON public.qa_case_index(category);
CREATE INDEX idx_qa_case_index_feedback ON public.qa_case_index(feedback_id);
CREATE INDEX idx_qa_case_index_outcome ON public.qa_case_index(outcome_type);
CREATE INDEX idx_qa_case_index_text ON public.qa_case_index USING gin(to_tsvector('english', searchable_text));

-- 4) qa_calibration_stats - Aggregated calibration metrics (materialized view alternative)
CREATE TABLE public.qa_calibration_stats (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL,
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  step_id INTEGER NOT NULL,
  category TEXT NOT NULL,
  false_reject_count INTEGER NOT NULL DEFAULT 0,
  false_approve_count INTEGER NOT NULL DEFAULT 0,
  confirmed_correct_count INTEGER NOT NULL DEFAULT 0,
  last_updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(owner_id, project_id, step_id, category)
);

-- Enable RLS
ALTER TABLE public.qa_calibration_stats ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own calibration stats"
  ON public.qa_calibration_stats FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can insert their own calibration stats"
  ON public.qa_calibration_stats FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update their own calibration stats"
  ON public.qa_calibration_stats FOR UPDATE
  USING (auth.uid() = owner_id);

-- Index for stats retrieval
CREATE INDEX idx_qa_calibration_stats_lookup ON public.qa_calibration_stats(owner_id, project_id, step_id, category);