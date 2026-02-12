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
  status_running?: string;
}> = {
  0: { pending: "space_analysis_pending", running: "space_analysis_running", status_pending: "step0_pending", status_running: "step0_running" },
  1: { pending: "top_down_3d_pending", running: "top_down_3d_running", status_pending: "step1_pending", status_running: "step1_running" },
  2: { pending: "style_pending", running: "style_running", status_pending: "step2_pending", status_running: "step2_running" },
  3: { pending: "detect_spaces_pending", running: "detecting_spaces", status_pending: "step3_pending", status_running: "step3_running" },
  4: { pending: "camera_intent_pending", status_pending: "step4_pending", status_running: "step4_pending" }, // Camera intent is decision-only (no running state)
  5: { pending: "renders_pending", running: "renders_in_progress", status_pending: "step5_pending", status_running: "step5_running" },
  6: { pending: "panoramas_pending", running: "panoramas_in_progress", status_pending: "step6_pending", status_running: "step6_running" },
  7: { pending: "merging_pending", running: "merging_in_progress", status_pending: "step7_pending", status_running: "step7_running" },
};

/**
 * restart-pipeline-step: Authoritative backend function for restarting a pipeline step.
 * 
 * This function:
 * 1. Increments reset_counter for race-safety (prevents late callbacks from attaching outputs)
 * 2. Cancels any in-progress jobs for this step and downstream steps
 * 3. Deletes ALL outputs, events, reviews, attempts for the target step and downstream steps
 * 4. Resets pipeline state to the target step
 * 5. Optionally auto-starts the step generation (for steps 0-3)
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

    const { pipeline_id, step_number, auto_start = false } = await req.json();

    if (!pipeline_id) {
      throw new Error("pipeline_id is required");
    }
    if (typeof step_number !== "number" || step_number < 0 || step_number > 7) {
      throw new Error("step_number must be between 0 and 7");
    }

    console.log(`[RESTART_STEP] Starting restart for pipeline ${pipeline_id}, step ${step_number}, user ${user.id}, auto_start=${auto_start}`);

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
    console.log(`[RESTART_STEP] Incrementing reset counter from ${currentResetCounter} to ${newResetCounter}`);

    // 3. Collect ALL upload IDs to delete (from step_number onwards)
    const uploadIdsToDelete = new Set<string>();
    const stepOutputs = (pipeline.step_outputs as Record<string, any>) || {};
    const stepRetryState = (pipeline.step_retry_state as Record<string, any>) || {};

    // Collect from step_outputs for steps >= step_number
    for (let s = step_number; s <= 7; s++) {
      const stepKey = `step${s}`;
      const stepData = stepOutputs[stepKey];

      // Single output format
      if (stepData?.output_upload_id && stepData.output_upload_id !== pipeline.floor_plan_upload_id) {
        uploadIdsToDelete.add(stepData.output_upload_id);
      }

      // Multiple outputs format
      if (stepData?.outputs && Array.isArray(stepData.outputs)) {
        for (const output of stepData.outputs) {
          if (output?.output_upload_id && output.output_upload_id !== pipeline.floor_plan_upload_id) {
            uploadIdsToDelete.add(output.output_upload_id);
          }
        }
      }
    }

    // Handle step 0 (space_analysis) separately
    if (step_number === 0 && stepOutputs.space_analysis) {
      // Space analysis doesn't have upload IDs, just clear the data
      console.log(`[RESTART_STEP] Clearing space_analysis data`);
    }

    // Collect from step_retry_state for steps >= step_number
    for (let s = step_number; s <= 7; s++) {
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
      .gte("step_number", step_number);

    for (const row of attemptRows || []) {
      const id = (row as any).output_upload_id as string | null;
      if (id && id !== pipeline.floor_plan_upload_id) {
        uploadIdsToDelete.add(id);
      }
    }

    console.log(`[RESTART_STEP] Found ${uploadIdsToDelete.size} uploads to delete from step ${step_number} onwards`);

    // 4. Delete step attempts from DB
    const { error: deleteAttemptsError } = await supabaseAdmin
      .from("floorplan_pipeline_step_attempts")
      .delete()
      .eq("pipeline_id", pipeline_id)
      .gte("step_number", step_number);

    if (deleteAttemptsError) {
      console.warn(`[RESTART_STEP] Failed to delete step attempts:`, deleteAttemptsError);
    } else {
      console.log(`[RESTART_STEP] Deleted step attempts for steps >= ${step_number}`);
    }

    // 5. Delete pipeline events for steps >= step_number
    const { error: deleteEventsError } = await supabaseAdmin
      .from("floorplan_pipeline_events")
      .delete()
      .eq("pipeline_id", pipeline_id)
      .gte("step_number", step_number);

    if (deleteEventsError) {
      console.warn(`[RESTART_STEP] Failed to delete events:`, deleteEventsError);
    } else {
      console.log(`[RESTART_STEP] Deleted events for steps >= ${step_number}`);
    }

    // 6. Delete pipeline reviews for steps >= step_number
    const { error: deleteReviewsError } = await supabaseAdmin
      .from("floorplan_pipeline_reviews")
      .delete()
      .eq("pipeline_id", pipeline_id)
      .gte("step_number", step_number);

    if (deleteReviewsError) {
      console.warn(`[RESTART_STEP] Failed to delete reviews:`, deleteReviewsError);
    } else {
      console.log(`[RESTART_STEP] Deleted reviews for steps >= ${step_number}`);
    }

    // 7. Delete space-level outputs for steps 5+ (renders, panoramas, merges)
    if (step_number <= 3) {
      // Deleting spaces also cascades to renders/panoramas/final360s
      console.log(`[RESTART_STEP] Deleting detected spaces (step ${step_number} <= 3)`);
      await supabaseAdmin
        .from("floorplan_pipeline_spaces")
        .delete()
        .eq("pipeline_id", pipeline_id);

      // Also delete camera markers for step <= 4
      await supabaseAdmin
        .from("pipeline_camera_markers")
        .delete()
        .eq("pipeline_id", pipeline_id);
    } else if (step_number <= 4) {
      // Delete camera markers
      await supabaseAdmin
        .from("pipeline_camera_markers")
        .delete()
        .eq("pipeline_id", pipeline_id);
    }

    if (step_number <= 5) {
      // Delete renders
      await supabaseAdmin
        .from("floorplan_space_renders")
        .delete()
        .eq("pipeline_id", pipeline_id);
    }
    if (step_number <= 6) {
      // Delete panoramas
      await supabaseAdmin
        .from("floorplan_space_panoramas")
        .delete()
        .eq("pipeline_id", pipeline_id);
    }
    if (step_number <= 7) {
      // Delete final360s
      await supabaseAdmin
        .from("floorplan_space_final360")
        .delete()
        .eq("pipeline_id", pipeline_id);
    }

    // DISABLED: Pipeline-generated uploads are now PRESERVED for Creations
    /*
    const uploadIdList = Array.from(uploadIdsToDelete);
    let deletedCount = 0;
    
    for (const uploadId of uploadIdList) {
      try {
        const { data: upload } = await supabaseAdmin
          .from("uploads")
          .select("bucket, path")
          .eq("id", uploadId)
          .single();

        if (upload) {
          // Delete from storage
          const { error: storageError } = await supabaseAdmin.storage
            .from(upload.bucket)
            .remove([upload.path]);
          
          if (storageError) {
            console.warn(`[RESTART_STEP] Storage delete failed for ${uploadId}:`, storageError);
          }

          // Delete from uploads table
          const { error: dbError } = await supabaseAdmin
            .from("uploads")
            .delete()
            .eq("id", uploadId);

          if (!dbError) {
            deletedCount++;
          }
        }
      } catch (err) {
        console.warn(`[RESTART_STEP] Error deleting upload ${uploadId}:`, err);
      }
    }
    */
    const deletedCount = 0;
    console.log(`[RESTART_STEP] Preserving ${uploadIdsToDelete.size} uploads for Creations`);

    // 9. Clear step_outputs and step_retry_state for steps >= step_number
    const cleanedStepOutputs = { ...stepOutputs };
    const cleanedStepRetryState = { ...stepRetryState };

    for (let s = step_number; s <= 7; s++) {
      delete cleanedStepOutputs[`step${s}`];
      delete cleanedStepRetryState[`step${s}`];
      delete cleanedStepRetryState[`step_${s}`];
    }

    // Clear space_analysis if step 0
    if (step_number === 0) {
      delete cleanedStepOutputs.space_analysis;
    }

    // 10. Determine target phase and status
    const targetPhase = PHASE_MAP[step_number];
    if (!targetPhase) {
      throw new Error(`Unsupported step number: ${step_number}`);
    }

    // 11. Decide whether to auto-start (only for steps 0-3 that have run-pipeline-step support)
    const canAutoStart = step_number >= 1 && step_number <= 3 && auto_start;

    // 12. Reset pipeline state
    const { error: updateError } = await supabaseAdmin
      .from("floorplan_pipelines")
      .update({
        current_step: step_number,
        whole_apartment_phase: canAutoStart && targetPhase.running ? targetPhase.running : targetPhase.pending,
        status: canAutoStart && targetPhase.status_running ? targetPhase.status_running : targetPhase.status_pending,
        step_outputs: cleanedStepOutputs,
        step_retry_state: cleanedStepRetryState,
        total_retry_count: newResetCounter,
        last_error: null,
        updated_at: new Date().toISOString(),
        // Clear relevant timestamps when rolling back
        ...(step_number <= 3 ? { spaces_approved_at: null } : {}),
        ...(step_number <= 4 ? { camera_intent_confirmed_at: null } : {}),
        ...(step_number <= 5 ? { renders_approved_at: null } : {}),
        ...(step_number <= 6 ? { panoramas_approved_at: null } : {}),
      })
      .eq("id", pipeline_id);

    if (updateError) {
      throw new Error(`Failed to reset pipeline state: ${updateError.message}`);
    }

    console.log(`[RESTART_STEP] Pipeline reset to step ${step_number}, phase ${canAutoStart && targetPhase.running ? targetPhase.running : targetPhase.pending}`);

    // 13. Log restart event
    await supabaseAdmin.from("floorplan_pipeline_events").insert({
      pipeline_id,
      owner_id: user.id,
      step_number,
      type: "STEP_RESTART",
      message: `Step ${step_number} restarted by user. Cleared ${deletedCount} outputs. Reset counter: ${newResetCounter}`,
      progress_int: 0,
    });

    // 14. Auto-start the step if requested (only for supported steps)
    let runResult = null;
    if (canAutoStart && step_number >= 1 && step_number <= 3) {
      console.log(`[RESTART_STEP] Auto-starting step ${step_number}`);

      const { data: runData, error: runError } = await supabaseAdmin.functions.invoke("run-pipeline-step", {
        body: {
          pipeline_id,
          step_number,
          floor_plan_upload_id: pipeline.floor_plan_upload_id,
          aspect_ratio: pipeline.aspect_ratio || "16:9",
          output_resolution: pipeline.output_resolution || "2K",
          reset_counter: newResetCounter,
        },
      });

      if (runError) {
        console.error(`[RESTART_STEP] Auto-start failed:`, runError);
        // Revert to pending state if auto-start fails
        await supabaseAdmin
          .from("floorplan_pipelines")
          .update({
            whole_apartment_phase: targetPhase.pending,
            status: targetPhase.status_pending,
          })
          .eq("id", pipeline_id);

        runResult = { error: runError.message };
      } else {
        runResult = { success: true, data: runData };
      }
    }

    return new Response(JSON.stringify({
      success: true,
      message: `Step ${step_number} restarted successfully`,
      deleted_uploads: deletedCount,
      reset_counter: newResetCounter,
      auto_started: canAutoStart,
      run_result: runResult,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("[RESTART_STEP] Error:", error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Unknown error",
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
