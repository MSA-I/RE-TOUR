import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/**
 * PHASE → STEP CONTRACT (must match pipeline-phase-step-contract.ts)
 * Step 0: Space Analysis
 * Step 1: Top-Down 3D
 * Step 2: Style
 * Step 3: Detect Spaces
 * Step 4: Camera Planning
 * Step 5: Renders
 * Step 6: Panoramas
 * Step 7: Merge/Final 360
 */
const PHASE_MAP: Record<number, { 
  pending: string; 
  running?: string;
  status_pending: string; 
}> = {
  0: { pending: "space_analysis_pending", running: "space_analysis_running", status_pending: "step0_pending" },
  1: { pending: "top_down_3d_pending", running: "top_down_3d_running", status_pending: "step1_pending" },
  2: { pending: "style_pending", running: "style_running", status_pending: "step2_pending" },
  3: { pending: "detect_spaces_pending", running: "detecting_spaces", status_pending: "step3_pending" },
  4: { pending: "camera_plan_pending", status_pending: "step4_pending" },
  5: { pending: "renders_pending", running: "renders_in_progress", status_pending: "step5_pending" },
  6: { pending: "panoramas_pending", running: "panoramas_in_progress", status_pending: "step6_pending" },
  7: { pending: "merging_pending", running: "merging_in_progress", status_pending: "step7_pending" },
};

/**
 * rollback-to-previous-step: Safely rewinds the pipeline by one step.
 * 
 * This function:
 * 1. Resets the CURRENT step (clears outputs, jobs, events)
 * 2. Moves the pipeline pointer back to the PREVIOUS step
 * 3. Leaves the previous step in its completed/approved state
 * 4. Does NOT modify any steps earlier than the target
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    // Authenticate user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    const supabaseUser = createClient(
      SUPABASE_URL,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      throw new Error("Unauthorized");
    }

    const { pipeline_id, current_step_number } = await req.json();

    if (!pipeline_id) {
      throw new Error("pipeline_id is required");
    }
    if (typeof current_step_number !== "number" || current_step_number < 1 || current_step_number > 7) {
      throw new Error("current_step_number must be between 1 and 7 (cannot go back from Step 0)");
    }

    const targetStep = current_step_number - 1;
    console.log(`[ROLLBACK_STEP] Rolling back from step ${current_step_number} to step ${targetStep}, pipeline ${pipeline_id}`);

    // 1. Fetch and verify pipeline ownership
    const { data: pipeline, error: pipelineError } = await supabaseAdmin
      .from("floorplan_pipelines")
      .select("*")
      .eq("id", pipeline_id)
      .eq("owner_id", user.id)
      .single();

    if (pipelineError || !pipeline) {
      throw new Error("Pipeline not found or access denied");
    }

    // 2. Generate new reset counter to invalidate any in-flight operations
    const currentResetCounter = (pipeline.total_retry_count || 0);
    const newResetCounter = currentResetCounter + 1;
    console.log(`[ROLLBACK_STEP] Incrementing reset counter from ${currentResetCounter} to ${newResetCounter}`);

    // 3. Collect upload IDs to delete (ONLY from current_step_number, not target step)
    const uploadIdsToDelete = new Set<string>();
    const stepOutputs = (pipeline.step_outputs as Record<string, any>) || {};
    const stepRetryState = (pipeline.step_retry_state as Record<string, any>) || {};

    // Collect from step_outputs for steps >= current_step_number
    for (let s = current_step_number; s <= 7; s++) {
      const stepKey = `step${s}`;
      const stepData = stepOutputs[stepKey];
      
      if (stepData?.output_upload_id && stepData.output_upload_id !== pipeline.floor_plan_upload_id) {
        uploadIdsToDelete.add(stepData.output_upload_id);
      }
      
      if (stepData?.outputs && Array.isArray(stepData.outputs)) {
        for (const output of stepData.outputs) {
          if (output?.output_upload_id && output.output_upload_id !== pipeline.floor_plan_upload_id) {
            uploadIdsToDelete.add(output.output_upload_id);
          }
        }
      }
    }

    // Collect from step_retry_state for steps >= current_step_number
    for (let s = current_step_number; s <= 7; s++) {
      const stateKey = `step_${s}`;
      const stateData = stepRetryState[stateKey];
      
      if (stateData?.attempts && Array.isArray(stateData.attempts)) {
        for (const attempt of stateData.attempts) {
          if (attempt?.output_upload_ids && Array.isArray(attempt.output_upload_ids)) {
            for (const id of attempt.output_upload_ids) {
              if (id && id !== pipeline.floor_plan_upload_id) {
                uploadIdsToDelete.add(id);
              }
            }
          }
          if (attempt?.output_upload_id && attempt.output_upload_id !== pipeline.floor_plan_upload_id) {
            uploadIdsToDelete.add(attempt.output_upload_id);
          }
        }
      }
    }

    // Collect from floorplan_pipeline_step_attempts table
    const { data: attemptRows } = await supabaseAdmin
      .from("floorplan_pipeline_step_attempts")
      .select("output_upload_id")
      .eq("pipeline_id", pipeline_id)
      .gte("step_number", current_step_number);

    for (const row of attemptRows || []) {
      const id = (row as any).output_upload_id as string | null;
      if (id && id !== pipeline.floor_plan_upload_id) {
        uploadIdsToDelete.add(id);
      }
    }

    console.log(`[ROLLBACK_STEP] Found ${uploadIdsToDelete.size} uploads to delete from step ${current_step_number}+`);

    // 4. Delete step attempts from DB for current step and beyond
    await supabaseAdmin
      .from("floorplan_pipeline_step_attempts")
      .delete()
      .eq("pipeline_id", pipeline_id)
      .gte("step_number", current_step_number);

    // 5. Delete pipeline events for steps >= current_step_number
    await supabaseAdmin
      .from("floorplan_pipeline_events")
      .delete()
      .eq("pipeline_id", pipeline_id)
      .gte("step_number", current_step_number);

    // 6. Delete pipeline reviews for steps >= current_step_number
    await supabaseAdmin
      .from("floorplan_pipeline_reviews")
      .delete()
      .eq("pipeline_id", pipeline_id)
      .gte("step_number", current_step_number);

    // 7. Delete space-level outputs for steps 5+ (renders, panoramas, merges)
    if (current_step_number <= 5) {
      // Delete renders
      await supabaseAdmin
        .from("floorplan_space_renders")
        .delete()
        .eq("pipeline_id", pipeline_id);
    }
    if (current_step_number <= 6) {
      // Delete panoramas
      await supabaseAdmin
        .from("floorplan_space_panoramas")
        .delete()
        .eq("pipeline_id", pipeline_id);
    }
    if (current_step_number <= 7) {
      // Delete final360s
      await supabaseAdmin
        .from("floorplan_space_final360")
        .delete()
        .eq("pipeline_id", pipeline_id);
    }

    // 8. Delete actual files from storage
    let deletedCount = 0;
    for (const uploadId of Array.from(uploadIdsToDelete)) {
      try {
        const { data: upload } = await supabaseAdmin
          .from("uploads")
          .select("bucket, path")
          .eq("id", uploadId)
          .single();

        if (upload) {
          await supabaseAdmin.storage.from(upload.bucket).remove([upload.path]);
          await supabaseAdmin.from("uploads").delete().eq("id", uploadId);
          deletedCount++;
        }
      } catch (err) {
        console.warn(`[ROLLBACK_STEP] Error deleting upload ${uploadId}:`, err);
      }
    }

    console.log(`[ROLLBACK_STEP] Deleted ${deletedCount} uploads from storage`);

    // 9. Clear step_outputs and step_retry_state for steps >= current_step_number
    const cleanedStepOutputs = { ...stepOutputs };
    const cleanedStepRetryState = { ...stepRetryState };

    for (let s = current_step_number; s <= 7; s++) {
      delete cleanedStepOutputs[`step${s}`];
      delete cleanedStepRetryState[`step${s}`];
      delete cleanedStepRetryState[`step_${s}`];
    }

    // 10. Determine target phase (previous step's completed/pending state)
    // We want the previous step to be in a "ready" state, not running
    const targetPhaseData = PHASE_MAP[targetStep];
    if (!targetPhaseData) {
      throw new Error(`Invalid target step: ${targetStep}`);
    }

    // For most steps, we set to the pending phase of the target step
    // This allows the user to re-run or review that step
    const targetPhase = targetPhaseData.pending;

    // 11. Update pipeline state to target step
    const { error: updateError } = await supabaseAdmin
      .from("floorplan_pipelines")
      .update({
        current_step: targetStep,
        whole_apartment_phase: targetPhase,
        status: targetPhaseData.status_pending,
        step_outputs: cleanedStepOutputs,
        step_retry_state: cleanedStepRetryState,
        total_retry_count: newResetCounter,
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", pipeline_id);

    if (updateError) {
      throw new Error(`Failed to rollback pipeline state: ${updateError.message}`);
    }

    console.log(`[ROLLBACK_STEP] Pipeline rolled back to step ${targetStep}, phase ${targetPhase}`);

    // 12. Log rollback event
    await supabaseAdmin.from("floorplan_pipeline_events").insert({
      pipeline_id,
      owner_id: user.id,
      step_number: targetStep,
      type: "STEP_ROLLBACK",
      message: `Rolled back from step ${current_step_number} to step ${targetStep}. Cleared ${deletedCount} outputs. Reset counter: ${newResetCounter}`,
      progress_int: 0,
    });

    return new Response(JSON.stringify({
      success: true,
      message: `Rolled back to step ${targetStep} successfully`,
      from_step: current_step_number,
      to_step: targetStep,
      target_phase: targetPhase,
      deleted_uploads: deletedCount,
      reset_counter: newResetCounter,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("[ROLLBACK_STEP] Error:", error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Unknown error",
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
