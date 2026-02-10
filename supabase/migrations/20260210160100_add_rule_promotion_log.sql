-- Rule Promotion Log
-- Tracks when qa_policy_rules are promoted (pending -> active) or escalated (body -> critical -> system)

CREATE TABLE public.qa_rule_promotion_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  rule_id UUID NOT NULL REFERENCES public.qa_policy_rules(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL,
  promotion_type TEXT NOT NULL CHECK (promotion_type IN ('activation', 'escalation')),
  from_status TEXT, -- For activation: 'pending' -> 'active'
  to_status TEXT,
  from_level TEXT, -- For escalation: 'body' -> 'critical' -> 'system'
  to_level TEXT,
  trigger_reason TEXT NOT NULL, -- e.g., "15% failure rate", "4th violation", "3rd support"
  rule_text TEXT NOT NULL, -- Snapshot of rule text at promotion time
  category TEXT NOT NULL,
  support_count INTEGER,
  violation_count INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.qa_rule_promotion_log ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own rule promotion logs"
  ON public.qa_rule_promotion_log FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Service role can insert rule promotion logs"
  ON public.qa_rule_promotion_log FOR INSERT
  WITH CHECK (true);

-- Indexes for efficient querying
CREATE INDEX idx_qa_rule_promotion_log_owner_created
  ON public.qa_rule_promotion_log(owner_id, created_at DESC);

CREATE INDEX idx_qa_rule_promotion_log_rule_id
  ON public.qa_rule_promotion_log(rule_id);

CREATE INDEX idx_qa_rule_promotion_log_type
  ON public.qa_rule_promotion_log(promotion_type, created_at DESC);

-- Comments
COMMENT ON TABLE public.qa_rule_promotion_log IS
  'Audit log tracking when QA policy rules are activated or escalated. Shows the "brain changing" over time.';

COMMENT ON COLUMN public.qa_rule_promotion_log.promotion_type IS
  'Type of promotion: activation (pending->active) or escalation (body->critical->system)';

COMMENT ON COLUMN public.qa_rule_promotion_log.trigger_reason IS
  'Human-readable reason for promotion, e.g., "15% failure rate", "4th violation", "3rd user confirmation"';
