-- Drop existing constraint if it exists
ALTER TABLE floorplan_pipelines DROP CONSTRAINT IF EXISTS valid_status_values;

-- Add updated status check constraint with new QA fail and blocked states for Steps 1-3
ALTER TABLE floorplan_pipelines ADD CONSTRAINT valid_status_values CHECK (
  status IN (
    -- Core states
    'draft', 'initialized', 'running', 'waiting_qa', 'ai_qa_fail', 'ai_qa_pass',
    'retrying', 'stalled', 'blocked_for_human', 'completed', 'failed', 'cancelled',
    -- Step 1 states
    'step1_pending', 'step1_running', 'step1_waiting_approval', 'step1_rejected',
    'step1_qa_fail', 'step1_blocked_for_human',
    -- Step 2 states
    'step2_pending', 'step2_running', 'step2_waiting_approval', 'step2_rejected',
    'step2_qa_fail', 'step2_blocked_for_human',
    -- Step 3 states
    'step3_pending', 'step3_running', 'step3_waiting_approval', 'step3_rejected',
    'step3_qa_fail', 'step3_blocked_for_human',
    'spaces_detected', 'spaces_detected_waiting_approval',
    -- Step 4-6 states
    'step4_pending', 'step4_running', 'step4_waiting_approval',
    'step5_pending', 'step5_running', 'step5_waiting_approval',
    'step6_pending', 'step6_running', 'step6_waiting_approval'
  )
);