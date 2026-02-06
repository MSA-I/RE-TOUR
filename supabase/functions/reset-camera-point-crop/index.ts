import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/**
 * Reset Camera Point Crop Edge Function
 * 
 * Deletes an existing crop screenshot for a camera marker and clears DB references.
 * This ensures the old crop can never be used in the final Nano Banana prompt.
 * 
 * After reset:
 * - Storage file is deleted
 * - DB crop fields are cleared (crop_storage_path, crop_public_url, etc.)
 * - Anchor status is set to "outdated" to require regeneration
 * - User can then generate a fresh screenshot/crop
 */

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getUser(token);
    if (claimsError || !claimsData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.user.id;

    const { pipeline_id, marker_id, scan_id } = await req.json();

    if (!pipeline_id || !marker_id) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: pipeline_id, marker_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[reset-camera-point-crop] Resetting crop for marker ${marker_id} in pipeline ${pipeline_id}`);

    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Verify pipeline ownership
    const { data: pipeline, error: pipelineError } = await serviceClient
      .from("floorplan_pipelines")
      .select("id, owner_id")
      .eq("id", pipeline_id)
      .single();

    if (pipelineError || !pipeline) {
      return new Response(
        JSON.stringify({ error: "Pipeline not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (pipeline.owner_id !== userId) {
      return new Response(
        JSON.stringify({ error: "Not authorized to modify this pipeline" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify marker exists and belongs to the pipeline
    const { data: marker, error: markerError } = await serviceClient
      .from("pipeline_camera_markers")
      .select("id, label, anchor_status")
      .eq("id", marker_id)
      .eq("pipeline_id", pipeline_id)
      .single();

    if (markerError || !marker) {
      return new Response(
        JSON.stringify({ error: "Marker not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Find the scan item with the crop data
    let scanItemQuery = serviceClient
      .from("pipeline_camera_scan_items")
      .select("id, scan_id, crop_storage_path, crop_public_url")
      .eq("marker_id", marker_id);

    if (scan_id) {
      scanItemQuery = scanItemQuery.eq("scan_id", scan_id);
    }

    const { data: scanItems, error: scanItemError } = await scanItemQuery;

    if (scanItemError) {
      console.error(`[reset-camera-point-crop] Error fetching scan items: ${scanItemError.message}`);
      return new Response(
        JSON.stringify({ error: "Failed to fetch scan items" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let deletedFiles = 0;
    let updatedItems = 0;
    const errors: string[] = [];

    // Process each scan item (usually just one per marker)
    for (const item of scanItems || []) {
      // 1. Delete storage file if exists
      if (item.crop_storage_path) {
        console.log(`[reset-camera-point-crop] Deleting storage file: ${item.crop_storage_path}`);
        
        const { error: deleteError } = await serviceClient.storage
          .from("outputs")
          .remove([item.crop_storage_path]);

        if (deleteError) {
          console.error(`[reset-camera-point-crop] Storage delete failed: ${deleteError.message}`);
          errors.push(`Failed to delete file: ${deleteError.message}`);
          // Continue anyway to clear DB references
        } else {
          deletedFiles++;
        }
      }

      // 2. Clear DB references for this scan item
      const { error: updateError } = await serviceClient
        .from("pipeline_camera_scan_items")
        .update({
          crop_storage_path: null,
          crop_public_url: null,
          crop_width: null,
          crop_height: null,
          crop_expires_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", item.id);

      if (updateError) {
        console.error(`[reset-camera-point-crop] Failed to clear scan item: ${updateError.message}`);
        errors.push(`Failed to update scan item: ${updateError.message}`);
      } else {
        updatedItems++;
      }
    }

    // 3. Set marker anchor status to "outdated" so renders won't use stale data
    const { error: markerUpdateError } = await serviceClient
      .from("pipeline_camera_markers")
      .update({
        anchor_status: "outdated",
        updated_at: new Date().toISOString(),
      })
      .eq("id", marker_id);

    if (markerUpdateError) {
      console.error(`[reset-camera-point-crop] Failed to update marker status: ${markerUpdateError.message}`);
      errors.push(`Failed to update marker status: ${markerUpdateError.message}`);
    }

    // 4. Also try to delete any temp files matching the marker pattern
    // This catches any orphaned files
    const tempPatterns = [
      `temp/camera-planning/${pipeline_id}/${marker_id}`,
      `temp/camera-planning/${pipeline_id}/*/${marker_id}`,
    ];

    // List files in the temp directory
    try {
      const { data: fileList } = await serviceClient.storage
        .from("outputs")
        .list(`temp/camera-planning/${pipeline_id}`);

      if (fileList) {
        // Look for subdirectories (scan IDs)
        for (const folder of fileList) {
          if (folder.id) {
            // Skip non-folder entries
            continue;
          }
          const { data: subFiles } = await serviceClient.storage
            .from("outputs")
            .list(`temp/camera-planning/${pipeline_id}/${folder.name}`);

          if (subFiles) {
            const filesToDelete = subFiles
              .filter(f => f.name.startsWith(marker_id))
              .map(f => `temp/camera-planning/${pipeline_id}/${folder.name}/${f.name}`);

            if (filesToDelete.length > 0) {
              const { error: cleanupError } = await serviceClient.storage
                .from("outputs")
                .remove(filesToDelete);

              if (!cleanupError) {
                deletedFiles += filesToDelete.length;
                console.log(`[reset-camera-point-crop] Cleaned up ${filesToDelete.length} additional files`);
              }
            }
          }
        }
      }
    } catch (cleanupErr) {
      // Non-critical, log and continue
      console.log(`[reset-camera-point-crop] Additional cleanup skipped: ${cleanupErr}`);
    }

    const success = errors.length === 0;
    const message = success
      ? `Reset complete: ${deletedFiles} files deleted, ${updatedItems} items cleared`
      : `Reset completed with warnings: ${errors.join("; ")}`;

    console.log(`[reset-camera-point-crop] ${message}`);

    return new Response(
      JSON.stringify({
        success,
        message,
        deleted_files: deletedFiles,
        updated_items: updatedItems,
        marker_id,
        marker_label: marker.label,
        new_anchor_status: "outdated",
        errors: errors.length > 0 ? errors : undefined,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[reset-camera-point-crop] Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
