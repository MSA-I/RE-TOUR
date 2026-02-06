-- Drop the existing constraint and recreate with step0 statuses included
ALTER TABLE public.floorplan_pipelines DROP CONSTRAINT IF EXISTS valid_status_values;

ALTER TABLE public.floorplan_pipelines
ADD CONSTRAINT valid_status_values CHECK (
  status IN (
    'pending', 'running', 'completed', 'failed',
    'step0_pending', 'step0_running', 'step0_rejected', 'step0_qa_fail', 'step0_blocked_for_human',
    'step1_pending', 'step1_running', 'step1_rejected', 'step1_qa_fail', 'step1_blocked_for_human',
    'step2_pending', 'step2_running', 'step2_rejected', 'step2_qa_fail', 'step2_blocked_for_human',
    'step3_pending', 'step3_running', 'step3_rejected', 'step3_qa_fail', 'step3_blocked_for_human',
    'step4_pending', 'step4_running', 'step4_rejected', 'step4_qa_fail', 'step4_blocked_for_human',
    'step5_pending', 'step5_running', 'step5_rejected', 'step5_qa_fail', 'step5_blocked_for_human',
    'spaces_detected', 'spaces_detected_waiting_approval',
    'top_down_3d_review', 'style_review',
    'blocked_for_human',
    'space_analysis_pending', 'space_analysis_running', 'space_analysis_review', 'space_analysis_failed'
  )
);