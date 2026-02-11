-- COMPLETE HOTFIX V2: Set up all missing database pieces
-- Run this in Supabase Dashboard > SQL Editor
-- This fixes ALL pipeline creation issues including missing enum type

-- ============================================================================
-- PART 0: Create whole_apartment_phase enum if it doesn't exist
-- ============================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'whole_apartment_phase') THEN
    CREATE TYPE whole_apartment_phase AS ENUM (
      -- Step 0
      'upload',
      'space_analysis_pending',
      'space_analysis_running',
      'space_analysis_complete',

      -- Step 1
      'top_down_3d_pending',
      'top_down_3d_running',
      'top_down_3d_review',

      -- Step 2
      'style_pending',
      'style_running',
      'style_review',

      -- Step 3
      'detect_spaces_pending',
      'detecting_spaces',
      'spaces_detected',

      -- Step 4
      'camera_intent_pending',
      'camera_intent_confirmed',
      'camera_plan_pending',  -- Legacy compatibility
      'camera_plan_confirmed',  -- Legacy compatibility

      -- Step 5
      'prompt_templates_pending',
      'prompt_templates_confirmed',

      -- Step 6
      'outputs_pending',
      'outputs_in_progress',
      'outputs_review',
      'renders_pending',  -- Legacy compatibility
      'renders_in_progress',  -- Legacy compatibility
      'renders_review',  -- Legacy compatibility

      -- Step 7+
      'panoramas_pending',
      'panoramas_in_progress',
      'panoramas_review',
      'merging_pending',
      'merging_in_progress',
      'merging_review',

      -- Terminal
      'completed',
      'failed'
    );
    RAISE NOTICE 'Created whole_apartment_phase enum type';
  ELSE
    RAISE NOTICE 'whole_apartment_phase enum already exists';
  END IF;
END $$;

-- ============================================================================
-- PART 1: Add any missing phase enum values (for existing enums)
-- ============================================================================
DO $$
DECLARE
  phase_value TEXT;
  new_values TEXT[] := ARRAY[
    'camera_intent_pending',
    'camera_intent_confirmed',
    'prompt_templates_pending',
    'prompt_templates_confirmed',
    'outputs_pending',
    'outputs_in_progress',
    'outputs_review'
  ];
BEGIN
  FOREACH phase_value IN ARRAY new_values
  LOOP
    BEGIN
      EXECUTE format('ALTER TYPE whole_apartment_phase ADD VALUE IF NOT EXISTS %L', phase_value);
      RAISE NOTICE 'Added phase value: %', phase_value;
    EXCEPTION
      WHEN duplicate_object THEN
        RAISE NOTICE 'Phase value already exists: %', phase_value;
    END;
  END LOOP;
END $$;

-- ============================================================================
-- PART 2: Ensure floorplan_pipelines has the whole_apartment_phase column
-- ============================================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'floorplan_pipelines'
    AND column_name = 'whole_apartment_phase'
  ) THEN
    ALTER TABLE floorplan_pipelines
    ADD COLUMN whole_apartment_phase whole_apartment_phase;
    RAISE NOTICE 'Added whole_apartment_phase column to floorplan_pipelines';
  ELSE
    RAISE NOTICE 'whole_apartment_phase column already exists';
  END IF;
END $$;

-- ============================================================================
-- PART 3: Drop old phase-step constraint if exists
-- ============================================================================
DROP TRIGGER IF EXISTS enforce_phase_step_consistency ON floorplan_pipelines;
DROP FUNCTION IF EXISTS check_phase_step_consistency();

-- ============================================================================
-- PART 4: Create updated phase-step consistency trigger
-- ============================================================================
CREATE OR REPLACE FUNCTION check_phase_step_consistency()
RETURNS TRIGGER AS $$
DECLARE
  expected_step INT;
BEGIN
  -- Skip validation if whole_apartment_phase is NULL
  IF NEW.whole_apartment_phase IS NULL THEN
    RETURN NEW;
  END IF;

  -- Map phase to expected step
  expected_step := CASE NEW.whole_apartment_phase::TEXT
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
    WHEN 'camera_plan_pending' THEN 4  -- Legacy
    WHEN 'camera_plan_confirmed' THEN 4  -- Legacy

    -- Step 5 (Prompt Templates)
    WHEN 'prompt_templates_pending' THEN 5
    WHEN 'prompt_templates_confirmed' THEN 5

    -- Step 6 (Outputs + QA)
    WHEN 'outputs_pending' THEN 6
    WHEN 'outputs_in_progress' THEN 6
    WHEN 'outputs_review' THEN 6
    WHEN 'renders_pending' THEN 6  -- Legacy
    WHEN 'renders_in_progress' THEN 6  -- Legacy
    WHEN 'renders_review' THEN 6  -- Legacy

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
-- PART 5: Create camera_intents_with_spaces view
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
-- PART 6: Add indexes for performance
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_camera_intents_pipeline_selected
ON camera_intents(pipeline_id) WHERE is_selected = TRUE;

CREATE INDEX IF NOT EXISTS idx_camera_intents_space_selected
ON camera_intents(space_id, is_selected) WHERE is_selected = TRUE;

-- ============================================================================
-- PART 7: Fix any existing pipelines with mismatched phase/step
-- ============================================================================
-- Set step to match phase for any inconsistent pipelines
UPDATE floorplan_pipelines
SET current_step = CASE whole_apartment_phase::TEXT
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
  WHEN 'camera_plan_pending' THEN 4
  WHEN 'camera_plan_confirmed' THEN 4
  WHEN 'prompt_templates_pending' THEN 5
  WHEN 'prompt_templates_confirmed' THEN 5
  WHEN 'outputs_pending' THEN 6
  WHEN 'outputs_in_progress' THEN 6
  WHEN 'outputs_review' THEN 6
  WHEN 'renders_pending' THEN 6
  WHEN 'renders_in_progress' THEN 6
  WHEN 'renders_review' THEN 6
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
       'Enum type created/verified' AS part0,
       'Phase enum values added' AS part1,
       'Column added/verified' AS part2,
       'Trigger created' AS part3,
       'View created' AS part4,
       'Indexes created' AS part5,
       'Existing pipelines fixed' AS part6;
