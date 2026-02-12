-- COMPLETE HOTFIX: Set up all missing database pieces
-- Run this in Supabase Dashboard > SQL Editor
-- This fixes ALL pipeline creation issues

-- ============================================================================
-- PART 1: Add missing phase enum values
-- ============================================================================
DO $$ BEGIN
  ALTER TYPE whole_apartment_phase ADD VALUE IF NOT EXISTS 'camera_intent_pending';
  ALTER TYPE whole_apartment_phase ADD VALUE IF NOT EXISTS 'camera_intent_confirmed';
  ALTER TYPE whole_apartment_phase ADD VALUE IF NOT EXISTS 'prompt_templates_pending';
  ALTER TYPE whole_apartment_phase ADD VALUE IF NOT EXISTS 'prompt_templates_confirmed';
  ALTER TYPE whole_apartment_phase ADD VALUE IF NOT EXISTS 'outputs_pending';
  ALTER TYPE whole_apartment_phase ADD VALUE IF NOT EXISTS 'outputs_in_progress';
  ALTER TYPE whole_apartment_phase ADD VALUE IF NOT EXISTS 'outputs_review';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- PART 2: Drop old phase-step constraint if exists
-- ============================================================================
DROP TRIGGER IF EXISTS enforce_phase_step_consistency ON floorplan_pipelines;
DROP FUNCTION IF EXISTS check_phase_step_consistency();

-- ============================================================================
-- PART 3: Create updated phase-step consistency trigger
-- ============================================================================
CREATE OR REPLACE FUNCTION check_phase_step_consistency()
RETURNS TRIGGER AS $$
DECLARE
  expected_step INT;
BEGIN
  -- Map phase to expected step
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

    -- Step 3 (Space Scan)
    WHEN 'detect_spaces_pending' THEN 3
    WHEN 'detecting_spaces' THEN 3
    WHEN 'spaces_detected' THEN 3

    -- Step 4 (Camera Intent)
    WHEN 'camera_intent_pending' THEN 4
    WHEN 'camera_intent_confirmed' THEN 4

    -- Step 5 (Prompt Templates)
    WHEN 'prompt_templates_pending' THEN 5
    WHEN 'prompt_templates_confirmed' THEN 5

    -- Step 6 (Outputs + QA)
    WHEN 'outputs_pending' THEN 6
    WHEN 'outputs_in_progress' THEN 6
    WHEN 'outputs_review' THEN 6

    -- Step 7+ (Panoramas / Merging)
    WHEN 'panoramas_pending' THEN 7
    WHEN 'panoramas_in_progress' THEN 7
    WHEN 'panoramas_review' THEN 7
    WHEN 'merging_pending' THEN 7
    WHEN 'merging_in_progress' THEN 7
    WHEN 'merging_review' THEN 7

    -- Step 8 (Completion)
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

CREATE TRIGGER enforce_phase_step_consistency
  BEFORE INSERT OR UPDATE OF whole_apartment_phase, current_step
  ON floorplan_pipelines
  FOR EACH ROW
  EXECUTE FUNCTION check_phase_step_consistency();

-- ============================================================================
-- PART 4: Create camera_intents_with_spaces view
-- ============================================================================
CREATE OR REPLACE VIEW camera_intents_with_spaces AS
SELECT
  ci.*,
  s.name AS space_name,
  s.space_type AS space_type
FROM camera_intents ci
JOIN floorplan_pipeline_spaces s ON ci.space_id = s.id;

GRANT SELECT ON camera_intents_with_spaces TO authenticated;
GRANT SELECT ON camera_intents_with_spaces TO anon;

-- ============================================================================
-- PART 5: Add indexes for performance
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_camera_intents_pipeline_selected
ON camera_intents(pipeline_id) WHERE is_selected = TRUE;

CREATE INDEX IF NOT EXISTS idx_camera_intents_space_selected
ON camera_intents(space_id, is_selected) WHERE is_selected = TRUE;

-- ============================================================================
-- PART 6: Fix any existing pipelines with mismatched phase/step
-- ============================================================================
-- Set step to match phase for any inconsistent pipelines
UPDATE floorplan_pipelines
SET current_step = CASE whole_apartment_phase
  WHEN 'upload' THEN 0
  WHEN 'space_analysis_pending' THEN 0
  WHEN 'space_analysis_running' THEN 0
  WHEN 'space_analysis_complete' THEN 0
  WHEN 'top_down_3d_pending' THEN 1
  WHEN 'top_down_3d_running' THEN 1
  WHEN 'top_down_3d_review' THEN 1
  WHEN 'style_pending' THEN 2
  WHEN 'style_running' THEN 2
  WHEN 'style_review' THEN 2
  WHEN 'detect_spaces_pending' THEN 3
  WHEN 'detecting_spaces' THEN 3
  WHEN 'spaces_detected' THEN 3
  WHEN 'camera_intent_pending' THEN 4
  WHEN 'camera_intent_confirmed' THEN 4
  WHEN 'prompt_templates_pending' THEN 5
  WHEN 'prompt_templates_confirmed' THEN 5
  WHEN 'outputs_pending' THEN 6
  WHEN 'outputs_in_progress' THEN 6
  WHEN 'outputs_review' THEN 6
  WHEN 'panoramas_pending' THEN 7
  WHEN 'panoramas_in_progress' THEN 7
  WHEN 'panoramas_review' THEN 7
  WHEN 'merging_pending' THEN 7
  WHEN 'merging_in_progress' THEN 7
  WHEN 'merging_review' THEN 7
  WHEN 'completed' THEN 8
  WHEN 'failed' THEN 0
  ELSE current_step
END
WHERE whole_apartment_phase IS NOT NULL;

-- ============================================================================
-- VERIFICATION
-- ============================================================================
SELECT 'All fixes applied successfully!' AS status,
       'Phase enum values added' AS part1,
       'Trigger created' AS part2,
       'View created' AS part3,
       'Indexes created' AS part4,
       'Existing pipelines fixed' AS part5;
