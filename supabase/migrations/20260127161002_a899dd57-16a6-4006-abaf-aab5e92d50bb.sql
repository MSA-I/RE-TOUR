-- ═══════════════════════════════════════════════════════════════════════════
-- PIPELINE RECOVERY PLAN: State Integrity Tracking & Phase-Step Consistency
-- ═══════════════════════════════════════════════════════════════════════════

-- Task 2: Add state integrity tracking columns
ALTER TABLE floorplan_pipelines ADD COLUMN IF NOT EXISTS
  last_state_integrity_fix_at timestamptz DEFAULT NULL;

ALTER TABLE floorplan_pipelines ADD COLUMN IF NOT EXISTS
  last_state_integrity_fix_reason text DEFAULT NULL;

-- Task 3: Create Phase-Step Consistency Trigger with Guard
-- The trigger ONLY fires when whole_apartment_phase or current_step actually change.
-- ⚠️ PHASE → STEP CONTRACT must match _shared/pipeline-phase-step-contract.ts

CREATE OR REPLACE FUNCTION enforce_phase_step_consistency()
RETURNS TRIGGER AS $$
DECLARE
  expected_step integer;
  -- PHASE → STEP CONTRACT (must match supabase/functions/_shared/pipeline-phase-step-contract.ts)
  phase_map jsonb := '{
    "upload": 0,
    "space_analysis_pending": 0, "space_analysis_running": 0, "space_analysis_complete": 0,
    "top_down_3d_pending": 1, "top_down_3d_running": 1, "top_down_3d_review": 1,
    "style_pending": 2, "style_running": 2, "style_review": 2,
    "camera_plan_pending": 3, "camera_plan_confirmed": 3,
    "detect_spaces_pending": 4, "detecting_spaces": 4, "spaces_detected": 4,
    "renders_pending": 5, "renders_in_progress": 5, "renders_review": 5,
    "panoramas_pending": 6, "panoramas_in_progress": 6, "panoramas_review": 6,
    "merging_pending": 7, "merging_in_progress": 7, "merging_review": 7,
    "completed": 7, "failed": 0
  }'::jsonb;
BEGIN
  -- GUARD: Only run when phase or current_step changes (prevents noise from metadata updates)
  IF TG_OP = 'UPDATE' THEN
    IF NEW.whole_apartment_phase IS NOT DISTINCT FROM OLD.whole_apartment_phase
       AND NEW.current_step IS NOT DISTINCT FROM OLD.current_step THEN
      -- No relevant change, skip validation
      RETURN NEW;
    END IF;
  END IF;

  expected_step := (phase_map ->> NEW.whole_apartment_phase)::integer;
  
  IF expected_step IS NOT NULL AND NEW.current_step != expected_step THEN
    -- Log the correction (never silent)
    RAISE WARNING '[StateIntegrity] Auto-correcting: phase=% expects step=%, got step=%.',
      NEW.whole_apartment_phase, expected_step, NEW.current_step;
    
    -- Store fix metadata for observability
    NEW.last_state_integrity_fix_at := now();
    NEW.last_state_integrity_fix_reason := format(
      'phase=%s expected step=%s but found step=%s',
      NEW.whole_apartment_phase, expected_step, NEW.current_step
    );
    
    -- Apply correction
    NEW.current_step := expected_step;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Drop existing trigger if exists, then recreate
DROP TRIGGER IF EXISTS trg_enforce_phase_step_consistency ON floorplan_pipelines;

CREATE TRIGGER trg_enforce_phase_step_consistency
BEFORE INSERT OR UPDATE ON floorplan_pipelines
FOR EACH ROW EXECUTE FUNCTION enforce_phase_step_consistency();

-- Task 4: Create Event Logging Trigger for State Corrections
-- Logs STATE_INTEGRITY_AUTO_CORRECTED events when corrections occur.

CREATE OR REPLACE FUNCTION log_state_integrity_correction()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.last_state_integrity_fix_at IS DISTINCT FROM OLD.last_state_integrity_fix_at
     AND NEW.last_state_integrity_fix_at IS NOT NULL THEN
    INSERT INTO floorplan_pipeline_events (
      pipeline_id, owner_id, step_number, type, message, progress_int, ts
    ) VALUES (
      NEW.id,
      NEW.owner_id,
      NEW.current_step,
      'STATE_INTEGRITY_AUTO_CORRECTED',
      jsonb_build_object(
        'reason', NEW.last_state_integrity_fix_reason,
        'phase', NEW.whole_apartment_phase,
        'corrected_step', NEW.current_step
      )::text,
      0,
      NEW.last_state_integrity_fix_at
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_log_state_integrity_correction ON floorplan_pipelines;

CREATE TRIGGER trg_log_state_integrity_correction
AFTER UPDATE ON floorplan_pipelines
FOR EACH ROW EXECUTE FUNCTION log_state_integrity_correction();

-- Task 7: Create Recovery RPC
-- Owner-only, requires valid approved outputs, logs PIPELINE_RECOVERY_APPLIED.

CREATE OR REPLACE FUNCTION recover_pipeline_state(
  p_pipeline_id uuid,
  p_owner_id uuid
)
RETURNS floorplan_pipelines
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pipeline floorplan_pipelines;
  v_expected_step integer;
  v_previous_phase text;
  v_previous_step integer;
  -- PHASE → STEP CONTRACT (must match supabase/functions/_shared/pipeline-phase-step-contract.ts)
  phase_map jsonb := '{
    "upload": 0,
    "space_analysis_pending": 0, "space_analysis_running": 0, "space_analysis_complete": 0,
    "top_down_3d_pending": 1, "top_down_3d_running": 1, "top_down_3d_review": 1,
    "style_pending": 2, "style_running": 2, "style_review": 2,
    "camera_plan_pending": 3, "camera_plan_confirmed": 3,
    "detect_spaces_pending": 4, "detecting_spaces": 4, "spaces_detected": 4,
    "renders_pending": 5, "renders_in_progress": 5, "renders_review": 5,
    "panoramas_pending": 6, "panoramas_in_progress": 6, "panoramas_review": 6,
    "merging_pending": 7, "merging_in_progress": 7, "merging_review": 7,
    "completed": 7, "failed": 0
  }'::jsonb;
BEGIN
  -- Lock row and validate ownership
  SELECT * INTO v_pipeline
  FROM floorplan_pipelines
  WHERE id = p_pipeline_id AND owner_id = p_owner_id
  FOR UPDATE;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pipeline not found or not owned by user';
  END IF;
  
  -- Store previous state for logging
  v_previous_phase := v_pipeline.whole_apartment_phase;
  v_previous_step := v_pipeline.current_step;
  v_expected_step := (phase_map ->> v_pipeline.whole_apartment_phase)::integer;
  
  -- VALIDATION: Cannot advance past a step without approved output
  IF v_expected_step >= 2 THEN
    IF NOT COALESCE((v_pipeline.step_outputs->'step1'->>'manual_approved')::boolean, false) THEN
      RAISE EXCEPTION 'Cannot recover: Step 1 not approved';
    END IF;
  END IF;
  IF v_expected_step >= 3 THEN
    IF NOT COALESCE((v_pipeline.step_outputs->'step2'->>'manual_approved')::boolean, false) THEN
      RAISE EXCEPTION 'Cannot recover: Step 2 not approved';
    END IF;
  END IF;
  
  -- Apply correction (phase stays, current_step aligns)
  UPDATE floorplan_pipelines
  SET 
    current_step = v_expected_step,
    last_state_integrity_fix_at = now(),
    last_state_integrity_fix_reason = 'Manual recovery applied via recover_pipeline_state'
  WHERE id = p_pipeline_id
  RETURNING * INTO v_pipeline;
  
  -- Log recovery event with full payload
  INSERT INTO floorplan_pipeline_events (
    pipeline_id, owner_id, step_number, type, message, progress_int, ts
  ) VALUES (
    p_pipeline_id,
    p_owner_id,
    v_expected_step,
    'PIPELINE_RECOVERY_APPLIED',
    jsonb_build_object(
      'previous_phase', v_previous_phase,
      'previous_step', v_previous_step,
      'recovered_to_step', v_expected_step,
      'step1_approved', v_pipeline.step_outputs->'step1'->>'manual_approved',
      'step2_approved', v_pipeline.step_outputs->'step2'->>'manual_approved'
    )::text,
    0,
    now()
  );
  
  RETURN v_pipeline;
END;
$$;