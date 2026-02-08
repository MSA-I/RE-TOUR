-- Drop the conflicting constraints and create a single comprehensive one
ALTER TABLE floorplan_pipelines DROP CONSTRAINT IF EXISTS valid_status_values;
ALTER TABLE floorplan_pipelines DROP CONSTRAINT IF EXISTS floorplan_pipelines_status_check;

-- Add a single comprehensive check constraint with ALL valid statuses
ALTER TABLE floorplan_pipelines ADD CONSTRAINT valid_status_values CHECK (
  status = ANY (ARRAY[
    -- Base states
    'draft',
    'initialized',
    'pending',
    'running',
    'completed',
    'failed',
    'cancelled',
    
    -- QA states
    'waiting_qa',
    'ai_qa_fail',
    'ai_qa_pass',
    'retrying',
    'blocked_for_human',
    
    -- Step 0 (Analysis)
    'step0_pending',
    'step0_running',
    'step0_waiting_approval',
    'step0_rejected',
    'step0_qa_fail',
    'step0_blocked_for_human',
    
    -- Step 1 (Top-Down)
    'step1_pending',
    'step1_running',
    'step1_waiting_approval',
    'step1_rejected',
    'step1_qa_fail',
    'step1_blocked_for_human',
    
    -- Step 2 (Style)
    'step2_pending',
    'step2_running',
    'step2_waiting_approval',
    'step2_rejected',
    'step2_qa_fail',
    'step2_blocked_for_human',
    
    -- Step 3 (Spaces/Renders)
    'step3_pending',
    'step3_running',
    'step3_waiting_approval',
    'step3_rejected',
    'step3_qa_fail',
    'step3_blocked_for_human',
    'spaces_detected',
    'spaces_detected_waiting_approval',
    
    -- Step 4 (Panoramas)
    'step4_pending',
    'step4_running',
    'step4_waiting_approval',
    'step4_rejected',
    'step4_qa_fail',
    'step4_blocked_for_human',
    
    -- Step 5 (Merge)
    'step5_pending',
    'step5_running',
    'step5_waiting_approval',
    'step5_rejected',
    'step5_qa_fail',
    'step5_blocked_for_human',
    
    -- Whole apartment phase-related
    'top_down_3d_review',
    'style_review',
    'space_analysis_pending',
    'space_analysis_running',
    'space_analysis_review',
    'space_analysis_failed'
  ])
);