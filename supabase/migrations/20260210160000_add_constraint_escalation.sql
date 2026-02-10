-- Add constraint escalation tracking to qa_policy_rules
-- This enables the system to promote frequently violated rules to higher attention levels

-- Add violation tracking columns
ALTER TABLE public.qa_policy_rules
  ADD COLUMN IF NOT EXISTS violation_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS escalation_level TEXT NOT NULL DEFAULT 'body'
    CHECK (escalation_level IN ('body', 'critical', 'system'));

-- Add index for efficient escalation queries
CREATE INDEX IF NOT EXISTS idx_qa_policy_rules_escalation
  ON public.qa_policy_rules(escalation_level, violation_count DESC);

-- Add comment explaining the escalation system
COMMENT ON COLUMN public.qa_policy_rules.violation_count IS
  'Tracks how many times this rule has been violated. Used to trigger escalation.';

COMMENT ON COLUMN public.qa_policy_rules.escalation_level IS
  'Prompt section where this rule appears: body (default), critical (violated 2+ times), system (violated 4+ times)';
