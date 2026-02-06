import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface DeleteResult {
  success: boolean;
  deleted_run_id: string;
  deleted_outputs_count: number;
  deleted_storage_objects_count: number;
  deleted_events_count: number;
  deleted_reviews_count: number;
  deleted_attempts_count: number;
  deleted_spaces_count: number;
  deleted_renders_count: number;
  deleted_panoramas_count: number;
  deleted_final360_count: number;
  deleted_camera_markers_count: number;
  warnings: string[];
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const warnings: string[] = [];
  let result: Partial<DeleteResult> = {
    deleted_outputs_count: 0,
    deleted_storage_objects_count: 0,
    deleted_events_count: 0,
    deleted_reviews_count: 0,
    deleted_attempts_count: 0,
    deleted_spaces_count: 0,
    deleted_renders_count: 0,
    deleted_panoramas_count: 0,
    deleted_final360_count: 0,
    deleted_camera_markers_count: 0,
    warnings: [],
  };

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey);
    
    // Use getUser to validate JWT and get user ID
    const userClient = createClient(supabaseUrl, supabaseServiceKey, {
      global: { headers: { Authorization: authHeader } }
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();

    if (userError || !userData?.user?.id) {
      console.error("[delete-pipeline-run] Auth error:", userError);
      throw new Error("Unauthorized");
    }

    const userId = userData.user.id;
    const { pipeline_id, force_delete_running } = await req.json();

    if (!pipeline_id) {
      throw new Error("Missing pipeline_id");
    }

    console.log(`[delete-pipeline-run] Starting deletion for pipeline: ${pipeline_id}, user: ${userId}`);

    // 1. Verify ownership and get pipeline details
    const { data: pipeline, error: pipelineError } = await supabaseClient
      .from("floorplan_pipelines")
      .select("*, floor_plan:uploads!floorplan_pipelines_floor_plan_upload_id_fkey(id, bucket, path)")
      .eq("id", pipeline_id)
      .eq("owner_id", userId)
      .maybeSingle();

    if (pipelineError) {
      console.error("Pipeline query error:", pipelineError);
      throw new Error("Failed to query pipeline");
    }

    // Handle orphaned outputs - pipeline may have been deleted but assets remain
    if (!pipeline) {
      console.log(`[delete-pipeline-run] Pipeline ${pipeline_id} not found - may be orphaned. Cleaning up orphaned assets.`);
      
      // Try to delete orphaned uploads that reference this pipeline_id in their path
      const { data: orphanedUploads } = await supabaseClient
        .from("uploads")
        .select("id, bucket, path")
        .eq("owner_id", userId)
        .like("path", `%pipeline_${pipeline_id}%`);

      if (orphanedUploads && orphanedUploads.length > 0) {
        console.log(`[delete-pipeline-run] Found ${orphanedUploads.length} orphaned uploads to clean up`);
        
        // Delete from storage
        const bucketGroups: Record<string, string[]> = {};
        for (const upload of orphanedUploads) {
          if (!bucketGroups[upload.bucket]) bucketGroups[upload.bucket] = [];
          bucketGroups[upload.bucket].push(upload.path);
        }

        for (const [bucket, paths] of Object.entries(bucketGroups)) {
          try {
            await supabaseClient.storage.from(bucket).remove(paths);
            result.deleted_storage_objects_count! += paths.length;
          } catch (e) {
            warnings.push(`Orphaned storage cleanup failed for ${bucket}`);
          }
        }

        // Delete upload records
        const uploadIds = orphanedUploads.map(u => u.id);
        await supabaseClient.from("uploads").delete().in("id", uploadIds);
        result.deleted_outputs_count = uploadIds.length;
      }

      result.success = true;
      result.deleted_run_id = pipeline_id;
      result.warnings = warnings;
      
      return new Response(
        JSON.stringify(result),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Check if pipeline is running (safety check)
    const runningPhases = ["space_analysis_running", "top_down_3d_running", "style_running", 
      "detecting_spaces", "renders_in_progress", "panoramas_in_progress", "merging_in_progress"];
    
    if (runningPhases.includes(pipeline.whole_apartment_phase || "") && !force_delete_running) {
      throw new Error("Pipeline is currently running. Wait for it to complete or use force_delete_running=true");
    }

    console.log(`[delete-pipeline-run] Pipeline found: phase=${pipeline.whole_apartment_phase}, status=${pipeline.status}`);

    // =========================================================================
    // STEP A: Collect all output upload IDs to delete from storage
    // =========================================================================
    const uploadIdsToDelete: string[] = [];
    const storagePathsToDelete: { bucket: string; path: string }[] = [];

    // A1. Step attempts outputs
    const { data: stepAttempts } = await supabaseClient
      .from("floorplan_pipeline_step_attempts")
      .select("id, output_upload_id")
      .eq("pipeline_id", pipeline_id);

    if (stepAttempts) {
      result.deleted_attempts_count = stepAttempts.length;
      for (const attempt of stepAttempts) {
        if (attempt.output_upload_id) {
          uploadIdsToDelete.push(attempt.output_upload_id);
        }
      }
    }

    // A2. Space renders outputs
    const { data: spaceRenders } = await supabaseClient
      .from("floorplan_space_renders")
      .select("id, output_upload_id, source_image_upload_id")
      .eq("pipeline_id", pipeline_id);

    if (spaceRenders) {
      result.deleted_renders_count = spaceRenders.length;
      for (const render of spaceRenders) {
        if (render.output_upload_id) uploadIdsToDelete.push(render.output_upload_id);
        if (render.source_image_upload_id) uploadIdsToDelete.push(render.source_image_upload_id);
      }
    }

    // A3. Space panoramas outputs
    const { data: spacePanoramas } = await supabaseClient
      .from("floorplan_space_panoramas")
      .select("id, output_upload_id, source_image_upload_id")
      .eq("pipeline_id", pipeline_id);

    if (spacePanoramas) {
      result.deleted_panoramas_count = spacePanoramas.length;
      for (const panorama of spacePanoramas) {
        if (panorama.output_upload_id) uploadIdsToDelete.push(panorama.output_upload_id);
        if (panorama.source_image_upload_id) uploadIdsToDelete.push(panorama.source_image_upload_id);
      }
    }

    // A4. Final 360 merges
    const { data: final360s } = await supabaseClient
      .from("floorplan_space_final360")
      .select("id, output_upload_id, source_image_upload_id")
      .eq("pipeline_id", pipeline_id);

    if (final360s) {
      result.deleted_final360_count = final360s.length;
      for (const final360 of final360s) {
        if (final360.output_upload_id) uploadIdsToDelete.push(final360.output_upload_id);
        if (final360.source_image_upload_id) uploadIdsToDelete.push(final360.source_image_upload_id);
      }
    }

    // A5. Step outputs from pipeline.step_outputs JSONB
    const stepOutputs = (pipeline.step_outputs as Record<string, any>) || {};
    for (const key of Object.keys(stepOutputs)) {
      if (key.startsWith("step")) {
        const stepData = stepOutputs[key];
        if (stepData?.output_upload_id) {
          uploadIdsToDelete.push(stepData.output_upload_id);
        }
        if (stepData?.outputs && Array.isArray(stepData.outputs)) {
          for (const output of stepData.outputs) {
            if (output?.output_upload_id) {
              uploadIdsToDelete.push(output.output_upload_id);
            }
          }
        }
      }
    }

    // A6. Pipeline artifacts
    const { data: artifacts } = await supabaseClient
      .from("pipeline_artifacts")
      .select("id, upload_id, storage_bucket, storage_path")
      .eq("run_id", pipeline_id);

    if (artifacts) {
      for (const artifact of artifacts) {
        if (artifact.upload_id) uploadIdsToDelete.push(artifact.upload_id);
        if (artifact.storage_bucket && artifact.storage_path) {
          storagePathsToDelete.push({ bucket: artifact.storage_bucket, path: artifact.storage_path });
        }
      }
    }

    // Remove duplicates
    const uniqueUploadIds = [...new Set(uploadIdsToDelete)];
    console.log(`[delete-pipeline-run] Found ${uniqueUploadIds.length} unique uploads to delete`);

    // =========================================================================
    // STEP B: Get storage paths for all upload IDs
    // =========================================================================
    if (uniqueUploadIds.length > 0) {
      const { data: uploads } = await supabaseClient
        .from("uploads")
        .select("id, bucket, path")
        .in("id", uniqueUploadIds);

      if (uploads) {
        for (const upload of uploads) {
          storagePathsToDelete.push({ bucket: upload.bucket, path: upload.path });
        }
      }
    }

    console.log(`[delete-pipeline-run] Total storage paths to delete: ${storagePathsToDelete.length}`);

    // =========================================================================
    // STEP C: Delete storage objects first
    // =========================================================================
    const bucketGroups: Record<string, string[]> = {};
    for (const { bucket, path } of storagePathsToDelete) {
      if (!bucketGroups[bucket]) bucketGroups[bucket] = [];
      bucketGroups[bucket].push(path);
    }

    for (const [bucket, paths] of Object.entries(bucketGroups)) {
      try {
        const { error: storageError } = await supabaseClient.storage
          .from(bucket)
          .remove(paths);

        if (storageError) {
          console.warn(`[delete-pipeline-run] Storage delete warning for ${bucket}:`, storageError.message);
          warnings.push(`Storage cleanup partial for ${bucket}: ${storageError.message}`);
        } else {
          result.deleted_storage_objects_count! += paths.length;
          console.log(`[delete-pipeline-run] Deleted ${paths.length} files from ${bucket}`);
        }
      } catch (e) {
        console.warn(`[delete-pipeline-run] Storage delete exception for ${bucket}:`, e);
        warnings.push(`Storage cleanup failed for ${bucket}`);
      }
    }

    // =========================================================================
    // STEP D: Delete DB records in order (respecting foreign keys)
    // =========================================================================

    // D1. Delete floorplan_space_final360
    const { error: final360Error } = await supabaseClient
      .from("floorplan_space_final360")
      .delete()
      .eq("pipeline_id", pipeline_id);
    if (final360Error) {
      console.warn("[delete-pipeline-run] final360 delete warning:", final360Error);
      warnings.push("Failed to delete final360 records");
    }

    // D2. Delete floorplan_space_panoramas
    const { error: panoramasError } = await supabaseClient
      .from("floorplan_space_panoramas")
      .delete()
      .eq("pipeline_id", pipeline_id);
    if (panoramasError) {
      console.warn("[delete-pipeline-run] panoramas delete warning:", panoramasError);
      warnings.push("Failed to delete panorama records");
    }

    // D3. Delete floorplan_space_renders
    const { error: rendersError } = await supabaseClient
      .from("floorplan_space_renders")
      .delete()
      .eq("pipeline_id", pipeline_id);
    if (rendersError) {
      console.warn("[delete-pipeline-run] renders delete warning:", rendersError);
      warnings.push("Failed to delete render records");
    }

    // D4. Delete pipeline_camera_markers
    const { data: deletedMarkers } = await supabaseClient
      .from("pipeline_camera_markers")
      .delete()
      .eq("pipeline_id", pipeline_id)
      .select("id");
    result.deleted_camera_markers_count = deletedMarkers?.length || 0;

    // D5. Delete floorplan_pipeline_spaces
    const { data: deletedSpaces } = await supabaseClient
      .from("floorplan_pipeline_spaces")
      .delete()
      .eq("pipeline_id", pipeline_id)
      .select("id");
    result.deleted_spaces_count = deletedSpaces?.length || 0;

    // D6. Delete floorplan_pipeline_step_attempts
    const { error: attemptsError } = await supabaseClient
      .from("floorplan_pipeline_step_attempts")
      .delete()
      .eq("pipeline_id", pipeline_id);
    if (attemptsError) {
      console.warn("[delete-pipeline-run] attempts delete warning:", attemptsError);
      warnings.push("Failed to delete step attempts");
    }

    // D7. Delete pipeline_artifacts
    const { error: artifactsError } = await supabaseClient
      .from("pipeline_artifacts")
      .delete()
      .eq("run_id", pipeline_id);
    if (artifactsError) {
      console.warn("[delete-pipeline-run] artifacts delete warning:", artifactsError);
      warnings.push("Failed to delete artifacts");
    }

    // D8. Delete floorplan_pipeline_events
    const { data: deletedEvents } = await supabaseClient
      .from("floorplan_pipeline_events")
      .delete()
      .eq("pipeline_id", pipeline_id)
      .select("id");
    result.deleted_events_count = deletedEvents?.length || 0;

    // D9. Delete floorplan_pipeline_reviews
    const { data: deletedReviews } = await supabaseClient
      .from("floorplan_pipeline_reviews")
      .delete()
      .eq("pipeline_id", pipeline_id)
      .select("id");
    result.deleted_reviews_count = deletedReviews?.length || 0;

    // D10. Delete global_qa_results
    await supabaseClient
      .from("global_qa_results")
      .delete()
      .eq("pipeline_id", pipeline_id);

    // D11. Delete room_sub_pipelines events first
    const { data: roomSubPipelines } = await supabaseClient
      .from("room_sub_pipelines")
      .select("id")
      .eq("pipeline_id", pipeline_id);

    if (roomSubPipelines && roomSubPipelines.length > 0) {
      const subPipelineIds = roomSubPipelines.map(r => r.id);
      await supabaseClient
        .from("room_sub_pipeline_events")
        .delete()
        .in("room_sub_pipeline_id", subPipelineIds);
    }

    // D12. Delete room_sub_pipelines
    await supabaseClient
      .from("room_sub_pipelines")
      .delete()
      .eq("pipeline_id", pipeline_id);

    // D13. Delete pipeline_spatial_maps
    await supabaseClient
      .from("pipeline_spatial_maps")
      .delete()
      .eq("pipeline_id", pipeline_id);

    // D14. Delete upload records for outputs (NOT the floor plan itself)
    if (uniqueUploadIds.length > 0) {
      const { data: deletedUploads, error: uploadsError } = await supabaseClient
        .from("uploads")
        .delete()
        .in("id", uniqueUploadIds)
        .select("id");

      if (uploadsError) {
        console.warn("[delete-pipeline-run] uploads delete warning:", uploadsError);
        warnings.push("Failed to delete some upload records");
      } else {
        result.deleted_outputs_count = deletedUploads?.length || 0;
      }
    }

    // D15. Finally, delete the pipeline itself
    const { error: pipelineDeleteError } = await supabaseClient
      .from("floorplan_pipelines")
      .delete()
      .eq("id", pipeline_id)
      .eq("owner_id", userId);

    if (pipelineDeleteError) {
      console.error("[delete-pipeline-run] pipeline delete error:", pipelineDeleteError);
      throw new Error("Failed to delete pipeline record");
    }

    const processingTime = Date.now() - startTime;
    console.log(`[delete-pipeline-run] Deletion complete in ${processingTime}ms`);

    result.success = true;
    result.deleted_run_id = pipeline_id;
    result.warnings = warnings;

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[delete-pipeline-run] Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ success: false, error: message, warnings }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
