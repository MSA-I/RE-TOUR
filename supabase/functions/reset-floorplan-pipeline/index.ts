import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    // Verify user auth
    const supabaseUser = createClient(
      SUPABASE_URL,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      throw new Error("Unauthorized");
    }

    const { pipeline_id } = await req.json();

    if (!pipeline_id) {
      throw new Error("pipeline_id is required");
    }

    // Get pipeline and verify ownership
    const { data: pipeline, error: pipelineError } = await supabaseAdmin
      .from("floorplan_pipelines")
      .select("*")
      .eq("id", pipeline_id)
      .eq("owner_id", user.id)
      .single();

    if (pipelineError || !pipeline) {
      throw new Error("Pipeline not found or access denied");
    }

    console.log(`Resetting pipeline ${pipeline_id} for user ${user.id}`);
    console.log(`Floor plan upload ID (WILL NOT BE DELETED): ${pipeline.floor_plan_upload_id}`);

    // Collect ALL pipeline-generated upload IDs we should delete.
    // "Start Over" must remove these from both storage and the Creations library.
    const stepOutputs = (pipeline.step_outputs as Record<string, any>) || {};
    const outputUploadIds = new Set<string>();

    for (const key of Object.keys(stepOutputs)) {
      if (key.startsWith("step")) {
        const stepData = stepOutputs[key];
        
        // Single output format
        if (stepData?.output_upload_id && stepData.output_upload_id !== pipeline.floor_plan_upload_id) {
          outputUploadIds.add(stepData.output_upload_id);
        }
        
        // Multi-output array format
        if (stepData?.outputs && Array.isArray(stepData.outputs)) {
          for (const output of stepData.outputs) {
            if (output?.output_upload_id && output.output_upload_id !== pipeline.floor_plan_upload_id) {
              outputUploadIds.add(output.output_upload_id);
            }
          }
        }
      }
    }

    // Step attempts outputs (covers Step 1 retry grids)
    const { data: attemptRows, error: attemptRowsErr } = await supabaseAdmin
      .from("floorplan_pipeline_step_attempts")
      .select("output_upload_id")
      .eq("pipeline_id", pipeline_id);

    if (attemptRowsErr) {
      console.warn("Failed to load step attempt outputs:", attemptRowsErr);
    } else {
      for (const r of attemptRows || []) {
        const id = (r as any).output_upload_id as string | null;
        if (id && id !== pipeline.floor_plan_upload_id) outputUploadIds.add(id);
      }
    }

    // Space outputs
    const [rendersRes, panosRes, finalRes] = await Promise.all([
      supabaseAdmin.from("floorplan_space_renders").select("output_upload_id").eq("pipeline_id", pipeline_id),
      supabaseAdmin.from("floorplan_space_panoramas").select("output_upload_id").eq("pipeline_id", pipeline_id),
      supabaseAdmin.from("floorplan_space_final360").select("output_upload_id").eq("pipeline_id", pipeline_id),
    ]);

    if (rendersRes.error) console.warn("Failed to load render outputs:", rendersRes.error);
    if (panosRes.error) console.warn("Failed to load panorama outputs:", panosRes.error);
    if (finalRes.error) console.warn("Failed to load final360 outputs:", finalRes.error);

    for (const r of rendersRes.data || []) {
      const id = (r as any).output_upload_id as string | null;
      if (id && id !== pipeline.floor_plan_upload_id) outputUploadIds.add(id);
    }
    for (const r of panosRes.data || []) {
      const id = (r as any).output_upload_id as string | null;
      if (id && id !== pipeline.floor_plan_upload_id) outputUploadIds.add(id);
    }
    for (const r of finalRes.data || []) {
      const id = (r as any).output_upload_id as string | null;
      if (id && id !== pipeline.floor_plan_upload_id) outputUploadIds.add(id);
    }

    // New pipeline engine (runs/artifacts)
    const { data: runs, error: runsErr } = await supabaseAdmin
      .from("pipeline_runs")
      .select("id")
      .eq("pipeline_id", pipeline_id);
    if (runsErr) {
      console.warn("Failed to load pipeline runs:", runsErr);
    }

    const runIds = (runs || []).map((r: any) => r.id).filter(Boolean);
    if (runIds.length > 0) {
      const { data: artifacts, error: artErr } = await supabaseAdmin
        .from("pipeline_artifacts")
        .select("upload_id")
        .in("run_id", runIds);

      if (artErr) {
        console.warn("Failed to load pipeline artifacts:", artErr);
      } else {
        for (const a of artifacts || []) {
          const id = (a as any).upload_id as string | null;
          if (id && id !== pipeline.floor_plan_upload_id) outputUploadIds.add(id);
        }
      }
    }

    const outputUploadIdList = Array.from(outputUploadIds);
    console.log(`Found ${outputUploadIdList.length} pipeline-generated uploads to DELETE`);
    
    // Delete new pipeline engine rows first (they may reference uploads)
    if (runIds.length > 0) {
      await supabaseAdmin.from("pipeline_artifacts").delete().in("run_id", runIds);
      await supabaseAdmin.from("pipeline_jobs").delete().in("run_id", runIds);
      await supabaseAdmin.from("pipeline_decisions").delete().in("run_id", runIds);
      await supabaseAdmin.from("worker_outputs").delete().in("run_id", runIds);
      await supabaseAdmin.from("pipeline_runs").delete().in("id", runIds);
    }

    // Delete space tables
    await supabaseAdmin.from("floorplan_space_final360").delete().eq("pipeline_id", pipeline_id);
    await supabaseAdmin.from("floorplan_space_panoramas").delete().eq("pipeline_id", pipeline_id);
    await supabaseAdmin.from("floorplan_space_renders").delete().eq("pipeline_id", pipeline_id);
    await supabaseAdmin.from("floorplan_pipeline_spaces").delete().eq("pipeline_id", pipeline_id);
    await supabaseAdmin.from("global_qa_results").delete().eq("pipeline_id", pipeline_id);
    await supabaseAdmin.from("pipeline_spatial_maps").delete().eq("pipeline_id", pipeline_id);

    // Delete step attempts (they reference output uploads)
    const { error: attemptsError } = await supabaseAdmin
      .from("floorplan_pipeline_step_attempts")
      .delete()
      .eq("pipeline_id", pipeline_id);

    if (attemptsError) {
      console.warn("Failed to delete step attempts:", attemptsError);
    }

    // Delete pipeline-generated uploads from storage and database
    for (const uploadId of outputUploadIdList) {
      try {
        // Get upload details
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
            console.warn(`Failed to delete storage file for ${uploadId}:`, storageError);
          }

          // Delete from uploads table
          const { error: dbError } = await supabaseAdmin
            .from("uploads")
            .delete()
            .eq("id", uploadId);

          if (dbError) {
            console.warn(`Failed to delete upload record ${uploadId}:`, dbError);
          } else {
            console.log(`Deleted upload ${uploadId}`);
          }
        }
      } catch (err) {
        console.warn(`Error deleting upload ${uploadId}:`, err);
      }
    }

    // Delete pipeline events
    const { error: eventsError } = await supabaseAdmin
      .from("floorplan_pipeline_events")
      .delete()
      .eq("pipeline_id", pipeline_id);

    if (eventsError) {
      console.warn("Failed to delete pipeline events:", eventsError);
    }

    // Delete pipeline reviews
    const { error: reviewsError } = await supabaseAdmin
      .from("floorplan_pipeline_reviews")
      .delete()
      .eq("pipeline_id", pipeline_id);

    if (reviewsError) {
      console.warn("Failed to delete pipeline reviews:", reviewsError);
    }

    // Reset pipeline to step 0 pending state (Space Analysis)
    const { error: updateError } = await supabaseAdmin
      .from("floorplan_pipelines")
      .update({
        status: "step0_pending",
        current_step: 0,
        whole_apartment_phase: "space_analysis_pending",
        step_outputs: {},
        step_retry_state: {},
        last_error: null,
        camera_position: null,
        forward_direction: null,
        global_3d_render_id: null,
        global_style_bible: null,
        global_phase: null,
        spaces_approved_at: null,
        camera_plan_confirmed_at: null, // Clear camera plan confirmation (revert to draft)
        renders_approved_at: null,
        panoramas_approved_at: null,
        step3_job_id: null,
        step4_job_id: null,
        step5_job_id: null,
        step6_job_id: null,
        step3_last_backend_event_at: null,
        step3_attempt_count: 0,
        current_step_last_heartbeat_at: null,
        paused_at: null,
        resumed_at: null,
        pause_reason: null,
        run_state: "active",
        is_enabled: true,
        ratio_locked: false,
        updated_at: new Date().toISOString()
      })
      .eq("id", pipeline_id);

    if (updateError) {
      throw new Error(`Failed to reset pipeline: ${updateError.message}`);
    }

    console.log(`Pipeline ${pipeline_id} reset successfully`);

    return new Response(JSON.stringify({ 
      success: true, 
      message: "Pipeline reset to step 0 (Space Analysis)",
      deleted_outputs: outputUploadIdList.length
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error("Reset pipeline error:", error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : "Unknown error" 
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
