-- Migration: Update database trigger to enforce new phase-step contract
-- This migration ensures database-level consistency between pipeline phases and steps

-- Drop old trigger if exists
DROP TRIGGER IF EXISTS enforce_phase_step_consistency ON floorplan_pipelines;
DROP FUNCTION IF EXISTS check_phase_step_consistency();

-- Create updated trigger function
CREATE OR REPLACE FUNCTION check_phase_step_consistency()
RETURNS TRIGGER AS $$
DECLARE
  expected_step INT;
BEGIN
  -- Map phase to expected step (aligns with PHASE_STEP_MAP in frontend)
  expected_step := CASE NEW.whole_apartment_phase
    -- Step 0
    WHEN 'upload' THEN 0
    WHEN 'space_analysis_pending' THEN 0
    WHEN 'space_analysis_running' THEN 0
    WHEN 'space_analysis_complete' THEN 0
    
    -- Step 1
    WHEN 'top_down_3d_pending' THEN 1
    WHEN 'top_down_3d_running' THEN 1
    WHEN 'top_down_3d_review' THEN 1
    
    -- Step 2
    WHEN 'style_pending' THEN 2
    WHEN 'style_running' THEN 2
    WHEN 'style_review' THEN 2
    
    -- Step 3 (Internal) = Space Scan (Spec Step 0.2)
    WHEN 'detect_spaces_pending' THEN 3
    WHEN 'detecting_spaces' THEN 3
    WHEN 'spaces_detected' THEN 3
    
    -- Step 4 (Internal) = Camera Intent (Spec Step 3)
    WHEN 'camera_intent_pending' THEN 4
    WHEN 'camera_intent_confirmed' THEN 4
    
    -- Step 5 (Internal) = Prompt Templates (Spec Step 4)
    WHEN 'prompt_templates_pending' THEN 5
    WHEN 'prompt_templates_confirmed' THEN 5
    
    -- Step 6 (Internal) = Outputs + QA (Spec Step 5)
    WHEN 'outputs_pending' THEN 6
    WHEN 'outputs_in_progress' THEN 6
    WHEN 'outputs_review' THEN 6
    
    -- Step 7+ (Future / Panoramas / Merging)
    WHEN 'panoramas_pending' THEN 7
    WHEN 'panoramas_in_progress' THEN 7
    WHEN 'panoramas_review' THEN 7
    WHEN 'merging_pending' THEN 7
    WHEN 'merging_in_progress' THEN 7
    WHEN 'merging_review' THEN 7
    
    -- Step 8 (Final Approval)
    WHEN 'completed' THEN 8
    WHEN 'failed' THEN 0
    
    ELSE NULL
  END;
  
  IF expected_step IS NULL THEN
    RAISE EXCEPTION 'Unknown phase: %', NEW.whole_apartment_phase;
  END IF;
  
  -- Auto-populate current_step if not set
  IF NEW.current_step IS NULL THEN
    NEW.current_step := expected_step;
  END IF;
  
  -- Validate consistency
  IF NEW.current_step != expected_step THEN
    RAISE EXCEPTION 'Phase % expects step % but current_step is %',
      NEW.whole_apartment_phase, expected_step, NEW.current_step;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
CREATE TRIGGER enforce_phase_step_consistency
  BEFORE INSERT OR UPDATE OF whole_apartment_phase, current_step
  ON floorplan_pipelines
  FOR EACH ROW
  EXECUTE FUNCTION check_phase_step_consistency();

-- Log migration for audit
INSERT INTO public.migration_log (migration_name, applied_at)
VALUES ('20250211_update_phase_step_constraint', NOW());
