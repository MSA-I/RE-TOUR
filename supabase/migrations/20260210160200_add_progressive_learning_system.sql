-- Progressive QA Learning System
-- Implements three-tier learning with progressive rule strength and health decay

-- ============================================================================
-- 1. PIPELINE INSTANCE RULES (Level 1: Temporary)
-- ============================================================================
-- Tracks rules that only apply to the current pipeline run
CREATE TABLE public.qa_pipeline_instance_rules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pipeline_id UUID NOT NULL REFERENCES public.floorplan_pipelines(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL,
  step_id INTEGER NOT NULL,
  category TEXT NOT NULL,
  rule_text TEXT NOT NULL CHECK (char_length(rule_text) <= 500),
  trigger_count INTEGER NOT NULL DEFAULT 1, -- How many times violated in this pipeline
  first_triggered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_triggered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.qa_pipeline_instance_rules ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own pipeline instance rules"
  ON public.qa_pipeline_instance_rules FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Service role can manage pipeline instance rules"
  ON public.qa_pipeline_instance_rules FOR ALL
  USING (true);

-- Indexes
CREATE INDEX idx_qa_pipeline_instance_rules_pipeline
  ON public.qa_pipeline_instance_rules(pipeline_id, step_id);

CREATE INDEX idx_qa_pipeline_instance_rules_owner
  ON public.qa_pipeline_instance_rules(owner_id, created_at DESC);

-- ============================================================================
-- 2. EXTEND QA_POLICY_RULES FOR PROGRESSIVE STRENGTH
-- ============================================================================

-- Add strength stage column (Nudge -> Check -> Guard -> Law)
ALTER TABLE public.qa_policy_rules
  ADD COLUMN IF NOT EXISTS strength_stage TEXT NOT NULL DEFAULT 'nudge'
    CHECK (strength_stage IN ('nudge', 'check', 'guard', 'law'));

-- Add health bar for decay system (0-100)
ALTER TABLE public.qa_policy_rules
  ADD COLUMN IF NOT EXISTS health INTEGER NOT NULL DEFAULT 100
    CHECK (health >= 0 AND health <= 100);

-- Add confidence score (0-1.0)
ALTER TABLE public.qa_policy_rules
  ADD COLUMN IF NOT EXISTS confidence_score NUMERIC(5,4) NOT NULL DEFAULT 1.0
    CHECK (confidence_score >= 0 AND confidence_score <= 1.0);

-- Add context conditions (JSONB for flexible conditionals)
ALTER TABLE public.qa_policy_rules
  ADD COLUMN IF NOT EXISTS context_conditions JSONB DEFAULT NULL;

-- Add rejection/approval tracking for confidence calculation
ALTER TABLE public.qa_policy_rules
  ADD COLUMN IF NOT EXISTS triggered_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS approved_despite_trigger INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rejected_due_to_trigger INTEGER NOT NULL DEFAULT 0;

-- Add user control flags
ALTER TABLE public.qa_policy_rules
  ADD COLUMN IF NOT EXISTS user_muted BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS user_locked BOOLEAN NOT NULL DEFAULT false;

-- Add last triggered timestamp for decay calculation
ALTER TABLE public.qa_policy_rules
  ADD COLUMN IF NOT EXISTS last_triggered_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS last_health_decay_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Add index for health decay queries
CREATE INDEX IF NOT EXISTS idx_qa_policy_rules_health_decay
  ON public.qa_policy_rules(health, last_health_decay_at)
  WHERE rule_status = 'active' AND user_muted = false;

-- ============================================================================
-- 3. RULE OVERRIDE TRACKING
-- ============================================================================
-- Tracks when users override blocking rules
CREATE TABLE public.qa_rule_overrides (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  rule_id UUID REFERENCES public.qa_policy_rules(id) ON DELETE CASCADE,
  pipeline_id UUID NOT NULL REFERENCES public.floorplan_pipelines(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL,
  step_id INTEGER NOT NULL,
  override_reason TEXT CHECK (char_length(override_reason) <= 500),
  rule_strength_stage TEXT NOT NULL,
  was_approved_by_qa BOOLEAN DEFAULT NULL, -- Null = pending, true = QA approved, false = QA rejected
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.qa_rule_overrides ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own overrides"
  ON public.qa_rule_overrides FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Service role can manage overrides"
  ON public.qa_rule_overrides FOR ALL
  USING (true);

-- Indexes
CREATE INDEX idx_qa_rule_overrides_rule
  ON public.qa_rule_overrides(rule_id, created_at DESC);

CREATE INDEX idx_qa_rule_overrides_owner
  ON public.qa_rule_overrides(owner_id, created_at DESC);

-- ============================================================================
-- 4. USER LEARNING PROFILE
-- ============================================================================
-- Stores per-user learning preferences
CREATE TABLE public.qa_user_learning_profile (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  learning_enabled BOOLEAN NOT NULL DEFAULT true,
  auto_promote_enabled BOOLEAN NOT NULL DEFAULT true,
  last_profile_reset_at TIMESTAMPTZ DEFAULT NULL,
  custom_thresholds JSONB DEFAULT NULL, -- Override default thresholds
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.qa_user_learning_profile ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own learning profile"
  ON public.qa_user_learning_profile FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own learning profile"
  ON public.qa_user_learning_profile FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage learning profiles"
  ON public.qa_user_learning_profile FOR ALL
  USING (true);

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE public.qa_pipeline_instance_rules IS
  'Level 1 learning: Temporary rules that only apply to current pipeline run. Cleared when pipeline completes.';

COMMENT ON COLUMN public.qa_policy_rules.strength_stage IS
  'Progressive rule strength: nudge (hint) -> check (confirmation) -> guard (soft block) -> law (hard block)';

COMMENT ON COLUMN public.qa_policy_rules.health IS
  'Health bar (0-100). Rules decay over time and from good behavior. Dies at 0.';

COMMENT ON COLUMN public.qa_policy_rules.confidence_score IS
  'Confidence score (0-1) based on consistency. Low confidence rules stay at nudge stage.';

COMMENT ON COLUMN public.qa_policy_rules.context_conditions IS
  'JSONB conditions for when this rule applies. Enables context-specific rules (e.g., "only when room_type = bedroom")';

COMMENT ON TABLE public.qa_rule_overrides IS
  'Tracks when users click "Proceed Anyway" to override blocking rules.';

COMMENT ON TABLE public.qa_user_learning_profile IS
  'Per-user learning preferences. Supports "Fresh Start" reset and custom thresholds.';
