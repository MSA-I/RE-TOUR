import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey);
    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: authError,
    } = await supabaseClient.auth.getUser(token);

    if (authError || !user) {
      throw new Error("Unauthorized");
    }

    const { upload_id, force_db_only } = await req.json();

    if (!upload_id) {
      throw new Error("Missing upload_id");
    }

    console.log(`Deleting upload: ${upload_id}, force_db_only: ${force_db_only}`);

    // Get upload details and verify ownership
    const { data: upload, error: uploadError } = await supabaseClient
      .from("uploads")
      .select("*")
      .eq("id", upload_id)
      .eq("owner_id", user.id)
      .single();

    if (uploadError || !upload) {
      console.error("Upload not found or unauthorized:", uploadError);
      throw new Error("Upload not found or unauthorized");
    }

    console.log(`Found upload: ${upload.bucket}/${upload.path}, kind: ${upload.kind}`);

    // Handle floor_plan deletion - check for pipelines first
    if (upload.kind === "floor_plan") {
      // Check if there are any pipelines using this floor plan
      const { data: pipelinesUsingFloorPlan, error: pipelineCheckError } = await supabaseClient
        .from("floorplan_pipelines")
        .select("id, status, step_outputs")
        .eq("floor_plan_upload_id", upload_id)
        .eq("owner_id", user.id);

      if (pipelineCheckError) {
        console.warn("Error checking pipelines:", pipelineCheckError);
      }

      if (pipelinesUsingFloorPlan && pipelinesUsingFloorPlan.length > 0) {
        console.log(`Found ${pipelinesUsingFloorPlan.length} pipelines using this floor plan`);
        console.log(`CRITICAL: ALL output files will be PRESERVED in Creations (never deleted)`);
        
        // Delete pipelines but ABSOLUTELY PRESERVE their output files (Creations assets)
        for (const pipeline of pipelinesUsingFloorPlan) {
          console.log(`Deleting pipeline ${pipeline.id} (preserving ALL outputs for Creations)...`);
          
          // Log preserved outputs - collect all output IDs including multi-output arrays
          const stepOutputs = (pipeline.step_outputs as Record<string, any>) || {};
          const preservedOutputIds: string[] = [];
          
          for (const key of Object.keys(stepOutputs)) {
            if (key.startsWith("step")) {
              const stepData = stepOutputs[key];
              // Single output format
              if (stepData?.output_upload_id) {
                preservedOutputIds.push(stepData.output_upload_id);
              }
              // Multi-output array format
              if (stepData?.outputs && Array.isArray(stepData.outputs)) {
                for (const output of stepData.outputs) {
                  if (output?.output_upload_id) {
                    preservedOutputIds.push(output.output_upload_id);
                  }
                }
              }
            }
          }
          
          if (preservedOutputIds.length > 0) {
            console.log(`PRESERVING ${preservedOutputIds.length} output files for Creations:`);
            preservedOutputIds.forEach(id => console.log(`  - ${id} (KEPT in Creations)`));
          }
          
          // ONLY delete pipeline events (NOT output uploads)
          await supabaseClient.from("floorplan_pipeline_events").delete().eq("pipeline_id", pipeline.id);
          console.log(`Deleted pipeline events for ${pipeline.id}`);
          
          // ONLY delete pipeline reviews (NOT output uploads)
          await supabaseClient.from("floorplan_pipeline_reviews").delete().eq("pipeline_id", pipeline.id);
          console.log(`Deleted pipeline reviews for ${pipeline.id}`);
          
          // Delete the pipeline record itself (but NEVER the output uploads - they remain in Creations)
          await supabaseClient.from("floorplan_pipelines").delete().eq("id", pipeline.id);
          console.log(`Pipeline ${pipeline.id} deleted - ALL ${preservedOutputIds.length} outputs PRESERVED in Creations`);
        }
      }
    }
    // Handle panorama deletion differently
    else if (upload.kind === "panorama") {
      // Check if there are any jobs using this panorama
      const { data: jobsWithPanorama, error: panoramaJobsError } = await supabaseClient
        .from("render_jobs")
        .select("id, status, output_upload_id")
        .eq("panorama_upload_id", upload_id)
        .eq("owner_id", user.id);

      if (panoramaJobsError) {
        console.warn("Error finding jobs with panorama:", panoramaJobsError);
      }

      if (jobsWithPanorama && jobsWithPanorama.length > 0) {
        console.log(`Found ${jobsWithPanorama.length} render jobs using this panorama`);

        // Separate jobs into those with outputs (completed) and those without
        const completedJobs = jobsWithPanorama.filter(j => j.output_upload_id !== null);
        const pendingJobs = jobsWithPanorama.filter(j => j.output_upload_id === null);

        console.log(`- ${completedJobs.length} jobs with outputs (will keep, mark panorama_deleted)`);
        console.log(`- ${pendingJobs.length} jobs without outputs (will delete)`);

        // For completed jobs: mark panorama as deleted but keep the job
        if (completedJobs.length > 0) {
          const { error: markError } = await supabaseClient
            .from("render_jobs")
            .update({ panorama_deleted: true })
            .in("id", completedJobs.map(j => j.id))
            .eq("owner_id", user.id);

          if (markError) {
            console.error("Error marking panorama_deleted:", markError);
          } else {
            console.log(`Marked ${completedJobs.length} jobs with panorama_deleted=true`);
          }
        }

        // For pending jobs (no output): delete them entirely
        if (pendingJobs.length > 0) {
          const { error: deleteJobsError } = await supabaseClient
            .from("render_jobs")
            .delete()
            .in("id", pendingJobs.map(j => j.id))
            .eq("owner_id", user.id);

          if (deleteJobsError) {
            console.error("Error deleting pending jobs:", deleteJobsError);
          } else {
            console.log(`Deleted ${pendingJobs.length} pending render jobs`);
          }
        }
      }
    } else {
      // For non-panorama uploads (design refs, outputs), use original logic
      
      // Clean up output references in render_jobs
      if (upload.kind === "output") {
        const { error: outputRefError } = await supabaseClient
          .from("render_jobs")
          .update({ output_upload_id: null })
          .eq("output_upload_id", upload_id)
          .eq("owner_id", user.id);

        if (outputRefError) {
          console.warn("Error cleaning render_jobs output references:", outputRefError);
        }
        
        // Also clean up batch_jobs_items output references
        const { error: batchItemsOutputError } = await supabaseClient
          .from("batch_jobs_items")
          .update({ output_upload_id: null })
          .eq("output_upload_id", upload_id)
          .eq("owner_id", user.id);

        if (batchItemsOutputError) {
          console.warn("Error cleaning batch_jobs_items output references:", batchItemsOutputError);
        } else {
          console.log(`Cleaned batch_jobs_items output references for upload ${upload_id}`);
        }
      }

      // Clean up design_ref references (stored as JSONB array)
      if (upload.kind === "design_ref") {
        const { data: jobsWithDesignRef, error: designRefJobsError } = await supabaseClient
          .from("render_jobs")
          .select("id, design_ref_upload_ids")
          .eq("owner_id", user.id);

        if (!designRefJobsError && jobsWithDesignRef) {
          for (const job of jobsWithDesignRef) {
            const designRefs = job.design_ref_upload_ids as string[] | null;
            if (designRefs && Array.isArray(designRefs) && designRefs.includes(upload_id)) {
              const updatedRefs = designRefs.filter(id => id !== upload_id);
              await supabaseClient
                .from("render_jobs")
                .update({ design_ref_upload_ids: updatedRefs })
                .eq("id", job.id);
              console.log(`Removed design ref from job ${job.id}`);
            }
          }
        }
      }
    }
    
    // Always clean up batch_jobs_items references regardless of upload kind
    // (in case an upload was used as output for batch jobs)
    const { error: batchCleanupError } = await supabaseClient
      .from("batch_jobs_items")
      .update({ output_upload_id: null })
      .eq("output_upload_id", upload_id)
      .eq("owner_id", user.id);

    if (batchCleanupError) {
      console.warn("Error in final batch_jobs_items cleanup:", batchCleanupError);
    }

    // Delete from storage (unless force_db_only)
    if (!force_db_only) {
      const { error: storageError } = await supabaseClient.storage
        .from(upload.bucket)
        .remove([upload.path]);

      if (storageError) {
        console.warn("Storage delete error (file may already be missing):", storageError.message);
        // Continue with DB deletion even if storage fails
      } else {
        console.log(`Deleted file from storage: ${upload.bucket}/${upload.path}`);
      }
    } else {
      console.log("Skipping storage deletion (force_db_only=true)");
    }

    // Delete from database
    const { error: dbError } = await supabaseClient
      .from("uploads")
      .delete()
      .eq("id", upload_id)
      .eq("owner_id", user.id);

    if (dbError) {
      console.error("Database delete error:", dbError);
      throw new Error("Failed to delete upload record");
    }

    console.log(`Upload ${upload_id} deleted successfully`);

    return new Response(
      JSON.stringify({
        success: true,
        message: "Upload deleted successfully",
        deleted_id: upload_id,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
