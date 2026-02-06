import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Cleanup temporary camera scan crops after render approval.
 * 
 * This function:
 * 1. Deletes temp crop images from storage (temp/camera-planning/{pipeline_id}/{scan_id}/)
 * 2. Marks scan items as non-temporary or deletes them
 * 3. Optionally keeps label metadata for traceability
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

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify user
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const { pipeline_id, scan_id, keep_metadata = false } = await req.json();

    if (!pipeline_id) {
      return new Response(JSON.stringify({ error: "pipeline_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    // Verify pipeline ownership
    const { data: pipeline, error: pipelineError } = await serviceClient
      .from("floorplan_pipelines")
      .select("id")
      .eq("id", pipeline_id)
      .eq("owner_id", userId)
      .single();

    if (pipelineError || !pipeline) {
      return new Response(JSON.stringify({ error: "Pipeline not found or not owned by user" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Find scans to clean up
    let scansToClean: string[] = [];
    
    if (scan_id) {
      // Clean specific scan
      scansToClean = [scan_id];
    } else {
      // Clean all scans for this pipeline
      const { data: scans } = await serviceClient
        .from("pipeline_camera_scans")
        .select("id")
        .eq("pipeline_id", pipeline_id);
      
      scansToClean = (scans || []).map(s => s.id);
    }

    if (scansToClean.length === 0) {
      return new Response(JSON.stringify({ 
        success: true, 
        message: "No scans to clean",
        deleted_items: 0,
        deleted_files: 0,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[cleanup-crops] Cleaning ${scansToClean.length} scan(s) for pipeline ${pipeline_id}`);

    let totalDeletedItems = 0;
    let totalDeletedFiles = 0;

    for (const scanId of scansToClean) {
      // Get scan items with temp crops
      const { data: scanItems } = await serviceClient
        .from("pipeline_camera_scan_items")
        .select("*")
        .eq("scan_id", scanId)
        .eq("is_temporary", true);

      if (!scanItems || scanItems.length === 0) {
        continue;
      }

      // Delete crop files from storage
      const storagePaths = scanItems
        .map(item => item.crop_storage_path)
        .filter((path): path is string => !!path);

      if (storagePaths.length > 0) {
        const { error: deleteError } = await serviceClient.storage
          .from("outputs")
          .remove(storagePaths);

        if (deleteError) {
          console.error(`[cleanup-crops] Failed to delete files: ${deleteError.message}`);
        } else {
          totalDeletedFiles += storagePaths.length;
          console.log(`[cleanup-crops] Deleted ${storagePaths.length} crop files for scan ${scanId}`);
        }
      }

      // Also try to clean the entire temp folder
      const tempFolderPath = `temp/camera-planning/${pipeline_id}/${scanId}`;
      try {
        const { data: folderFiles } = await serviceClient.storage
          .from("outputs")
          .list(tempFolderPath);
        
        if (folderFiles && folderFiles.length > 0) {
          const filesToDelete = folderFiles.map(f => `${tempFolderPath}/${f.name}`);
          await serviceClient.storage
            .from("outputs")
            .remove(filesToDelete);
          totalDeletedFiles += filesToDelete.length;
        }
      } catch (folderError) {
        // Folder might not exist, that's ok
        console.log(`[cleanup-crops] No temp folder to clean for scan ${scanId}`);
      }

      // Update or delete scan items
      if (keep_metadata) {
        // Keep metadata but clear crop references
        await serviceClient
          .from("pipeline_camera_scan_items")
          .update({
            is_temporary: false,
            crop_storage_path: null,
            crop_public_url: null,
            crop_width: null,
            crop_height: null,
            crop_expires_at: null,
          })
          .eq("scan_id", scanId);
        
        totalDeletedItems += scanItems.length;
      } else {
        // Delete scan items entirely
        const { error: deleteItemsError } = await serviceClient
          .from("pipeline_camera_scan_items")
          .delete()
          .eq("scan_id", scanId);

        if (deleteItemsError) {
          console.error(`[cleanup-crops] Failed to delete scan items: ${deleteItemsError.message}`);
        } else {
          totalDeletedItems += scanItems.length;
        }
      }
    }

    // Optionally delete the scan records themselves if not keeping metadata
    if (!keep_metadata) {
      await serviceClient
        .from("pipeline_camera_scans")
        .delete()
        .in("id", scansToClean);
    }

    console.log(`[cleanup-crops] Cleanup complete: ${totalDeletedItems} items, ${totalDeletedFiles} files`);

    return new Response(JSON.stringify({
      success: true,
      deleted_items: totalDeletedItems,
      deleted_files: totalDeletedFiles,
      scans_cleaned: scansToClean.length,
      metadata_kept: keep_metadata,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("[cleanup-crops] Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
