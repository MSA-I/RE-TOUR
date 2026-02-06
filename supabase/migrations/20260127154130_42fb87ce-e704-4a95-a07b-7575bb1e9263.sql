CREATE OR REPLACE FUNCTION public.manual_approve_floorplan_pipeline_step(p_pipeline_id uuid, p_step_number integer, p_owner_id uuid, p_output_upload_id uuid DEFAULT NULL::uuid, p_notes jsonb DEFAULT '{}'::jsonb)
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

  -- Determine next phase (kept in sync with frontend PHASE_STEP_MAP expectations)
  IF p_step_number = 0 THEN
    v_next_phase := 'top_down_3d_pending';
  ELSIF p_step_number = 1 THEN
    v_next_phase := 'style_pending';
  ELSIF p_step_number = 2 THEN
    v_next_phase := 'camera_plan_pending';
  ELSIF p_step_number = 3 THEN
    v_next_phase := 'detect_spaces_pending';
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
  -- CRITICAL: Set BOTH output_upload_id (for run-pipeline-step to find) AND manual_approved metadata
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