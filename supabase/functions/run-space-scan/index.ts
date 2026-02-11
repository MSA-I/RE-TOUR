// Edge Function: run-space-scan
// Purpose: Step 0.2 - Space Scan ONLY (isolated from Design Reference Scan)
// Date: 2026-02-10
// NOTE: This is a simplified version extracted from run-space-analysis
// For full implementation, extract the complete space detection logic from run-space-analysis

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing Authorization header");
    }

    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const userClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      throw new Error("Unauthorized");
    }

    const { pipeline_id, floor_plan_upload_id } = await req.json();

    if (!pipeline_id) {
      throw new Error("Missing pipeline_id");
    }

    if (!floor_plan_upload_id) {
      throw new Error("Missing floor_plan_upload_id");
    }

    console.log(`[run-space-scan] Starting for pipeline ${pipeline_id}, floor plan ${floor_plan_upload_id}`);

    // Validate pipeline exists and is in correct phase
    const { data: pipeline, error: pipelineError } = await serviceClient
      .from("floorplan_pipelines")
      .select("*")
      .eq("id", pipeline_id)
      .eq("owner_id", user.id)
      .single();

    if (pipelineError || !pipeline) {
      throw new Error("Pipeline not found or access denied");
    }

    // Allow phases: space_scan_pending, space_scan_failed (retry), design_reference_complete (sequential)
    const allowedPhases = ["space_scan_pending", "space_scan_failed", "design_reference_complete"];
    if (!allowedPhases.includes(pipeline.whole_apartment_phase)) {
      throw new Error(`Invalid phase for space scan: ${pipeline.whole_apartment_phase}. Expected: ${allowedPhases.join(", ")}`);
    }

    // Set phase to running
    await serviceClient
      .from("floorplan_pipelines")
      .update({ whole_apartment_phase: "space_scan_running" })
      .eq("id", pipeline_id);

    // TODO: Extract complete space detection logic from run-space-analysis/index.ts
    // This includes:
    // 1. Load floor plan image
    // 2. Call Gemini API for space detection
    // 3. Parse response into rooms and zones
    // 4. Create/update records in floorplan_pipeline_spaces table
    // 5. Build space_scan output

    // PLACEHOLDER: For now, return error indicating incomplete implementation
    throw new Error("run-space-scan: Space detection logic extraction is incomplete. Please complete extraction from run-space-analysis.");

    /*
    // TEMPLATE for complete implementation:

    // Load floor plan image
    const { data: upload, error: uploadError } = await serviceClient
      .from("uploads")
      .select("*")
      .eq("id", floor_plan_upload_id)
      .eq("owner_id", user.id)
      .single();

    if (uploadError || !upload) {
      throw new Error("Floor plan image not found");
    }

    // Download from storage
    const { data: fileData, error: downloadError } = await serviceClient.storage
      .from(upload.bucket)
      .download(upload.path);

    if (downloadError || !fileData) {
      throw new Error(`Failed to download floor plan: ${downloadError?.message}`);
    }

    const arrayBuffer = await fileData.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    const base64 = btoa(String.fromCharCode(...uint8Array));

    // Call Gemini API for space detection
    // ... (extract logic from run-space-analysis)

    // Parse response
    const rooms = []; // ... parsed rooms
    const zones = []; // ... parsed zones

    // Create/update space records
    for (const room of rooms) {
      await serviceClient
        .from("floorplan_pipeline_spaces")
        .upsert({
          pipeline_id: pipeline_id,
          name: room.name,
          space_type: room.type,
          // ... other fields
        });
    }

    // Build space_scan output
    const spaceScanOutput = {
      analyzed_at: new Date().toISOString(),
      rooms_count: rooms.length,
      zones_count: zones.length,
      rooms,
      zones,
      overall_notes: analysisData.overall_notes,
      _version: 1,
    };

    // CRITICAL: Use jsonb_set to ONLY update space_scan path (preserves design_reference_scan)
    const updatedOutputs = {
      ...(pipeline.step_outputs || {}),
      space_scan: spaceScanOutput,
    };

    await serviceClient
      .from("floorplan_pipelines")
      .update({
        whole_apartment_phase: "space_scan_complete",
        space_scan_complete: true,
        space_scan_analyzed_at: new Date().toISOString(),
        step_outputs: updatedOutputs,
      })
      .eq("id", pipeline_id);

    return new Response(
      JSON.stringify({
        success: true,
        rooms_count: rooms.length,
        zones_count: zones.length,
        rooms,
        zones,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
    */

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[run-space-scan] Error: ${message}`);

    // Try to update pipeline to failed state
    try {
      const { pipeline_id } = await req.json();
      if (pipeline_id) {
        const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const { data: existingPipeline } = await serviceClient
          .from("floorplan_pipelines")
          .select("step_outputs")
          .eq("id", pipeline_id)
          .single();

        await serviceClient.from("floorplan_pipelines").update({
          whole_apartment_phase: "space_scan_failed",
          last_error: message,
          step_outputs: {
            ...(existingPipeline?.step_outputs || {}),
            space_scan: {
              error: message,
              failed_at: new Date().toISOString(),
            },
          },
        }).eq("id", pipeline_id);
      }
    } catch {
      // Ignore errors in error handler
    }

    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
