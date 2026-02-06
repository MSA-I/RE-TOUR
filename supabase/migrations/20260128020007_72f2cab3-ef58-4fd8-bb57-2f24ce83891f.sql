-- ═══════════════════════════════════════════════════════════════════════════
-- SWAP STEP 3 AND STEP 4: Detect Spaces ↔ Camera Planning
-- ═══════════════════════════════════════════════════════════════════════════
-- 
-- NEW ORDER:
-- Step 3: Detect Spaces (was Step 4)
-- Step 4: Camera Planning (was Step 3)
--
-- This requires updating:
-- 1. enforce_phase_step_consistency trigger function
-- 2. manual_approve_floorplan_pipeline_step RPC function
-- 3. recover_pipeline_state RPC function
-- ═══════════════════════════════════════════════════════════════════════════

-- Update the enforce_phase_step_consistency trigger function
CREATE OR REPLACE FUNCTION public.enforce_phase_step_consistency()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  expected_step integer;
  -- PHASE → STEP CONTRACT (SWAPPED: Step 3 = Detect Spaces, Step 4 = Camera Planning)
  phase_map jsonb := '{
    "upload": 0,
    "space_analysis_pending": 0, "space_analysis_running": 0, "space_analysis_complete": 0,
    "top_down_3d_pending": 1, "top_down_3d_running": 1, "top_down_3d_review": 1,
    "style_pending": 2, "style_running": 2, "style_review": 2,
    "detect_spaces_pending": 3, "detecting_spaces": 3, "spaces_detected": 3,
    "camera_plan_pending": 4, "camera_plan_confirmed": 4,
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
$function$;

-- Update the manual_approve_floorplan_pipeline_step RPC function
CREATE OR REPLACE FUNCTION public.manual_approve_floorplan_pipeline_step(
  p_pipeline_id uuid, 
  p_step_number integer, 
  p_owner_id uuid, 
  p_output_upload_id uuid DEFAULT NULL::uuid, 
  p_notes jsonb DEFAULT '{}'::jsonb
)
 RETURNS floorplan_pipelines
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pipeline public.floorplan_pipelines;
  v_now timestamptz := now();
  v_next_step integer := p_step_number + 1;
  v_next_phase text;
  v_updated_step_retry_state jsonb;
  v_updated_step_outputs jsonb;
  v_step_key text := 'step_' || p_step_number::text;
  v_step_outputs_key text := 'step' || p_step_number::text;
BEGIN
  -- Lock row and validate ownership
  SELECT * INTO v_pipeline
  FROM public.floorplan_pipelines
  WHERE id = p_pipeline_id
    AND owner_id = p_owner_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pipeline not found or not owned by user';
  END IF;

  -- Determine next phase (SWAPPED: Step 3 = Detect Spaces, Step 4 = Camera Planning)
  IF p_step_number = 0 THEN
    v_next_phase := 'top_down_3d_pending';
  ELSIF p_step_number = 1 THEN
    v_next_phase := 'style_pending';
  ELSIF p_step_number = 2 THEN
    v_next_phase := 'detect_spaces_pending'; -- CHANGED: was camera_plan_pending
  ELSIF p_step_number = 3 THEN
    v_next_phase := 'camera_plan_pending'; -- CHANGED: was detect_spaces_pending
  ELSIF p_step_number = 4 THEN
    v_next_phase := 'renders_pending'; -- CHANGED: was step 3 → renders
  ELSE
    -- For later steps, keep phase as-is; orchestration may be handled elsewhere
    v_next_phase := COALESCE(v_pipeline.whole_apartment_phase, 'upload');
  END IF;

  -- Update step_retry_state to reflect manual approval
  v_updated_step_retry_state := COALESCE(v_pipeline.step_retry_state, '{}'::jsonb);
  v_updated_step_retry_state := jsonb_set(
    v_updated_step_retry_state,
    ARRAY[v_step_key],
    COALESCE(v_updated_step_retry_state->v_step_key, '{}'::jsonb)
      || jsonb_build_object(
        'status', 'qa_pass',
        'manual_approved_after_exhaustion', true,
        'manual_approved_at', v_now
      ),
    true
  );

  -- Update step_outputs to reflect manual approval
  v_updated_step_outputs := COALESCE(v_pipeline.step_outputs, '{}'::jsonb);
  v_updated_step_outputs := jsonb_set(
    v_updated_step_outputs,
    ARRAY[v_step_outputs_key],
    COALESCE(v_updated_step_outputs->v_step_outputs_key, '{}'::jsonb)
      || jsonb_build_object(
        'output_upload_id', p_output_upload_id,
        'manual_approved', true,
        'manual_approved_at', v_now,
        'manual_approved_output_upload_id', p_output_upload_id
      ),
    true
  );

  -- Persist review decision using lowercase 'approved' to match check constraint
  INSERT INTO public.floorplan_pipeline_reviews (
    pipeline_id,
    owner_id,
    step_number,
    decision,
    notes,
    created_at
  ) VALUES (
    p_pipeline_id,
    p_owner_id,
    p_step_number,
    'approved',
    jsonb_build_object(
      'reviewer', 'HUMAN',
      'output_upload_id', p_output_upload_id,
      'source', 'manual_approval_modal',
      'meta', p_notes
    )::text,
    v_now
  );

  -- Emit pipeline event
  INSERT INTO public.floorplan_pipeline_events (
    pipeline_id,
    owner_id,
    step_number,
    type,
    message,
    progress_int,
    ts
  ) VALUES (
    p_pipeline_id,
    p_owner_id,
    p_step_number,
    'STEP_MANUAL_APPROVED',
    jsonb_build_object(
      'from_step', p_step_number,
      'to_step', v_next_step,
      'output_upload_id', p_output_upload_id,
      'owner_id', p_owner_id
    )::text,
    100,
    v_now
  );

  -- Advance pipeline state (approval != auto-run)
  UPDATE public.floorplan_pipelines
  SET
    step_retry_state = v_updated_step_retry_state,
    step_outputs = v_updated_step_outputs,
    current_step = GREATEST(v_pipeline.current_step, v_next_step),
    whole_apartment_phase = v_next_phase,
    status = ('step' || v_next_step::text || '_pending'),
    last_error = NULL,
    updated_at = v_now
  WHERE id = p_pipeline_id
    AND owner_id = p_owner_id
  RETURNING * INTO v_pipeline;

  RETURN v_pipeline;
END;
$function$;

-- Update the recover_pipeline_state RPC function
CREATE OR REPLACE FUNCTION public.recover_pipeline_state(p_pipeline_id uuid, p_owner_id uuid)
 RETURNS floorplan_pipelines
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pipeline floorplan_pipelines;
  v_expected_step integer;
  v_previous_phase text;
  v_previous_step integer;
  -- PHASE → STEP CONTRACT (SWAPPED: Step 3 = Detect Spaces, Step 4 = Camera Planning)
  phase_map jsonb := '{
    "upload": 0,
    "space_analysis_pending": 0, "space_analysis_running": 0, "space_analysis_complete": 0,
    "top_down_3d_pending": 1, "top_down_3d_running": 1, "top_down_3d_review": 1,
    "style_pending": 2, "style_running": 2, "style_review": 2,
    "detect_spaces_pending": 3, "detecting_spaces": 3, "spaces_detected": 3,
    "camera_plan_pending": 4, "camera_plan_confirmed": 4,
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
$function$;