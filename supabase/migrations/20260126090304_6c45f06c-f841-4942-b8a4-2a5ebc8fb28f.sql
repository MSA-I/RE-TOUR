-- Add retry tracking fields to floorplan_pipelines
ALTER TABLE public.floorplan_pipelines
ADD COLUMN IF NOT EXISTS step_retry_state JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS auto_retry_enabled BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS total_retry_count INTEGER DEFAULT 0;

-- Add comment explaining the step_retry_state structure
COMMENT ON COLUMN public.floorplan_pipelines.step_retry_state IS 
'Tracks retry state per step: { "step_1": { "attempt_count": 2, "max_attempts": 5, "last_qa_result": {...} } }';

-- Add structured QA fields to pipeline_runs
ALTER TABLE public.pipeline_runs
ADD COLUMN IF NOT EXISTS auto_retry_enabled BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS step_qa_results JSONB DEFAULT '{}'::jsonb;

-- Add comment explaining step_qa_results
COMMENT ON COLUMN public.pipeline_runs.step_qa_results IS
'Stores structured QA results per step with full schema: { "step_0": { "status": "FAIL", "reason_short": "...", ... } }';

-- Add structured QA to space renders
ALTER TABLE public.floorplan_space_renders
ADD COLUMN IF NOT EXISTS structured_qa_result JSONB,
ADD COLUMN IF NOT EXISTS attempt_count INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS auto_retry_enabled BOOLEAN DEFAULT true;

-- Add structured QA to space panoramas
ALTER TABLE public.floorplan_space_panoramas
ADD COLUMN IF NOT EXISTS structured_qa_result JSONB,
ADD COLUMN IF NOT EXISTS attempt_count INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS auto_retry_enabled BOOLEAN DEFAULT true;

-- Add structured QA to final 360
ALTER TABLE public.floorplan_space_final360
ADD COLUMN IF NOT EXISTS structured_qa_result JSONB,
ADD COLUMN IF NOT EXISTS attempt_count INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS auto_retry_enabled BOOLEAN DEFAULT true;

-- Create index for faster QA status lookups
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_status ON public.pipeline_runs(status);
CREATE INDEX IF NOT EXISTS idx_floorplan_pipelines_status ON public.floorplan_pipelines(status);

-- Add check constraint for valid QA statuses
ALTER TABLE public.floorplan_pipelines
DROP CONSTRAINT IF EXISTS valid_status_values;

ALTER TABLE public.floorplan_pipelines
ADD CONSTRAINT valid_status_values CHECK (
  status IN (
    'pending', 'running', 'completed', 'failed',
    'step1_pending', 'step1_running', 'step1_rejected', 'step1_qa_fail', 'step1_blocked_for_human',
    'step2_pending', 'step2_running', 'step2_rejected', 'step2_qa_fail', 'step2_blocked_for_human',
    'step3_pending', 'step3_running', 'step3_rejected', 'step3_qa_fail', 'step3_blocked_for_human',
    'step4_pending', 'step4_running', 'step4_rejected', 'step4_qa_fail', 'step4_blocked_for_human',
    'spaces_detected', 'spaces_detected_waiting_approval',
    'top_down_3d_review', 'style_review',
    'blocked_for_human'
  )
);