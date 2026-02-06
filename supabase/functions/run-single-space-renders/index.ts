import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * RUN-SINGLE-SPACE-RENDERS
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Triggers render generation for a SINGLE space only, without affecting other spaces.
 * Respects the A→B sequential dependency.
 * 
 * Parameters:
 *   - pipeline_id: The pipeline ID
 *   - space_id: The specific space to render
 *   - styled_image_upload_id: The Step 2 styled top-down image
 *   - reference_image_ids: Optional per-space reference images from Step 4+
 * 
 * Behavior:
 *   1) Validates the space exists and is not excluded
 *   2) Fetches or creates render records for this space (A and B)
 *   3) Runs Camera A first, waits for completion
 *   4) Runs Camera B with A's output as anchor (if A succeeded)
 *   5) Returns immediately, processes in background
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

    const { pipeline_id, space_id, styled_image_upload_id, reference_image_ids } = await req.json();

    if (!pipeline_id || !space_id) {
      return new Response(
        JSON.stringify({ error: "Missing pipeline_id or space_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!styled_image_upload_id) {
      return new Response(
        JSON.stringify({ error: "Missing styled_image_upload_id - Step 2 must be completed first" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Validate pipeline exists and is enabled
    const { data: pipeline, error: pipelineError } = await serviceClient
      .from("floorplan_pipelines")
      .select("id, is_enabled, floor_plan_upload_id, camera_plan_confirmed_at, aspect_ratio, quality_post_step4")
      .eq("id", pipeline_id)
      .eq("owner_id", userId)
      .single();

    if (pipelineError || !pipeline) {
      return new Response(
        JSON.stringify({ error: "Pipeline not found or not owned by user" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!pipeline.is_enabled) {
      return new Response(
        JSON.stringify({ error: "Pipeline is paused", paused: true }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!pipeline.camera_plan_confirmed_at) {
      return new Response(
        JSON.stringify({ 
          error: "Camera plan must be confirmed before generating renders",
          error_code: "CAMERA_PLAN_REQUIRED"
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate space exists and is not excluded
    const { data: space, error: spaceError } = await serviceClient
      .from("floorplan_pipeline_spaces")
      .select("id, name, space_type, is_excluded, include_in_generation")
      .eq("id", space_id)
      .eq("pipeline_id", pipeline_id)
      .eq("owner_id", userId)
      .single();

    if (spaceError || !space) {
      return new Response(
        JSON.stringify({ error: "Space not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (space.is_excluded || space.include_in_generation === false) {
      return new Response(
        JSON.stringify({ error: "Space is excluded from generation" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get camera marker bound to this space
    const { data: cameraMarker } = await serviceClient
      .from("pipeline_camera_markers")
      .select("id, label, anchor_status")
      .eq("pipeline_id", pipeline_id)
      .eq("room_id", space_id)
      .eq("owner_id", userId)
      .maybeSingle();

    if (!cameraMarker || cameraMarker.anchor_status !== "ready") {
      return new Response(
        JSON.stringify({ 
          error: "Camera marker not found or anchor not ready for this space",
          error_code: "ANCHOR_NOT_READY",
          camera_marker_id: cameraMarker?.id,
          anchor_status: cameraMarker?.anchor_status || "not_found"
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update reference images on the space if provided
    if (reference_image_ids && Array.isArray(reference_image_ids)) {
      await serviceClient
        .from("floorplan_pipeline_spaces")
        .update({ reference_image_ids })
        .eq("id", space_id);
      console.log(`[single-space-renders] Updated reference_image_ids for space "${space.name}": ${reference_image_ids.length} images`);
    }

    // Get or create render records for this space
    const { data: existingRenders } = await serviceClient
      .from("floorplan_space_renders")
      .select("id, kind, status, output_upload_id, locked_approved")
      .eq("space_id", space_id)
      .eq("pipeline_id", pipeline_id)
      .eq("owner_id", userId);

    const existingA = existingRenders?.find(r => r.kind === "A");
    const existingB = existingRenders?.find(r => r.kind === "B");

    // Create missing render records
    const newRenders: Array<{
      space_id: string;
      pipeline_id: string;
      owner_id: string;
      kind: string;
      status: string;
      ratio: string;
      quality: string;
      camera_marker_id: string;
      camera_label: string;
    }> = [];

    if (!existingA) {
      newRenders.push({
        space_id: space_id,
        pipeline_id: pipeline_id,
        owner_id: userId,
        kind: "A",
        status: "pending",
        ratio: pipeline.aspect_ratio || "16:9",
        quality: pipeline.quality_post_step4 || "2K",
        camera_marker_id: cameraMarker.id,
        camera_label: cameraMarker.label,
      });
    }

    if (!existingB) {
      newRenders.push({
        space_id: space_id,
        pipeline_id: pipeline_id,
        owner_id: userId,
        kind: "B",
        status: "pending",
        ratio: pipeline.aspect_ratio || "16:9",
        quality: pipeline.quality_post_step4 || "2K",
        camera_marker_id: cameraMarker.id,
        camera_label: cameraMarker.label,
      });
    }

    if (newRenders.length > 0) {
      await serviceClient.from("floorplan_space_renders").insert(newRenders);
      console.log(`[single-space-renders] Created ${newRenders.length} new render records for space "${space.name}"`);
    }

    // Refetch to get all render IDs
    const { data: renders } = await serviceClient
      .from("floorplan_space_renders")
      .select("id, kind, status, output_upload_id, locked_approved")
      .eq("space_id", space_id)
      .eq("pipeline_id", pipeline_id)
      .eq("owner_id", userId);

    const renderA = renders?.find(r => r.kind === "A");
    const renderB = renders?.find(r => r.kind === "B");

    // Determine what needs to run
    // Include "planned" status - this is the initial state after confirm-camera-plan creates records
    const STARTABLE_STATUSES = ["pending", "planned", "queued", "rejected", "failed", "blocked"];
    
    // DEBUG: Log render record states
    console.log(`[single-space-renders] RENDER_A: ${renderA ? `id=${renderA.id}, status=${renderA.status}, locked=${renderA.locked_approved}` : "null"}`);
    console.log(`[single-space-renders] RENDER_B: ${renderB ? `id=${renderB.id}, status=${renderB.status}, locked=${renderB.locked_approved}` : "null"}`);
    
    const needsRenderA = renderA && !renderA.locked_approved && 
      STARTABLE_STATUSES.includes(renderA.status);
    const needsRenderB = renderB && !renderB.locked_approved && 
      STARTABLE_STATUSES.includes(renderB.status);

    console.log(`[single-space-renders] needsRenderA=${needsRenderA}, needsRenderB=${needsRenderB}`);

    if (!needsRenderA && !needsRenderB) {
      console.log(`[single-space-renders] EARLY EXIT: No renders need to run for "${space.name}"`);
      return new Response(
        JSON.stringify({
          success: true,
          message: "No pending renders for this space",
          already_complete: true,
          debug: {
            renderA: renderA ? { id: renderA.id, status: renderA.status, locked: renderA.locked_approved } : null,
            renderB: renderB ? { id: renderB.id, status: renderB.status, locked: renderB.locked_approved } : null,
            STARTABLE_STATUSES,
          },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Mark pending renders as queued
    const idsToQueue = [
      needsRenderA ? renderA.id : null,
      needsRenderB ? renderB.id : null,
    ].filter(Boolean);

    await serviceClient
      .from("floorplan_space_renders")
      .update({ status: "queued" })
      .in("id", idsToQueue);

    console.log(`[single-space-renders] Queued ${idsToQueue.length} renders for space "${space.name}"`);

    // Process in background using waitUntil
    const processSpaceRenders = async () => {
      let cameraAOutputId: string | undefined = undefined;
      let cameraASuccess = false;

      // Helper to process a single render
      const processRender = async (renderId: string, firstRenderUploadId?: string): Promise<{ success: boolean; outputUploadId?: string }> => {
        try {
          const response = await fetch(
            `${SUPABASE_URL}/functions/v1/run-space-render`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: authHeader,
              },
              body: JSON.stringify({
                render_id: renderId,
                styled_image_upload_id,
                first_render_upload_id: firstRenderUploadId,
                floor_plan_upload_id: pipeline.floor_plan_upload_id,
                space_metadata: {
                  name: space.name,
                  space_type: space.space_type,
                },
                reference_image_ids: reference_image_ids || [],
              }),
            }
          );

          if (response.ok) {
            const result = await response.json();
            console.log(`[single-space-renders] Render ${renderId} completed`);
            return { success: true, outputUploadId: result.output_upload_id };
          } else {
            const errorText = await response.text();
            console.error(`[single-space-renders] Render ${renderId} failed: ${errorText}`);
            return { success: false };
          }
        } catch (error) {
          console.error(`[single-space-renders] Render ${renderId} error:`, error);
          return { success: false };
        }
      };

      // STEP 1: Process Camera A (if needed)
      if (needsRenderA && renderA) {
        console.log(`[single-space-renders] → Camera A starting for "${space.name}"`);
        const resultA = await processRender(renderA.id);

        if (resultA.success) {
          cameraASuccess = true;
          
          // Get Camera A's output from DB
          const { data: updatedRenderA } = await serviceClient
            .from("floorplan_space_renders")
            .select("output_upload_id")
            .eq("id", renderA.id)
            .single();
          
          cameraAOutputId = updatedRenderA?.output_upload_id || undefined;
          console.log(`[single-space-renders] ✓ Camera A completed for "${space.name}", output: ${cameraAOutputId}`);
        } else {
          console.log(`[single-space-renders] ✗ Camera A FAILED for "${space.name}" - Camera B will be BLOCKED`);
        }
      } else if (renderA?.output_upload_id && (renderA.locked_approved || renderA.status === "needs_review")) {
        // Camera A already complete
        cameraAOutputId = renderA.output_upload_id;
        cameraASuccess = true;
        console.log(`[single-space-renders] → Camera A already complete for "${space.name}", output: ${cameraAOutputId}`);
      }

      // STEP 2: Process Camera B ONLY if Camera A succeeded
      if (needsRenderB && renderB) {
        if (!cameraASuccess || !cameraAOutputId) {
          // BLOCK Camera B
          console.log(`[single-space-renders] ✗ Camera B BLOCKED for "${space.name}" - Camera A not available`);
          
          await serviceClient
            .from("floorplan_space_renders")
            .update({
              status: "blocked",
              qa_report: {
                error: "CAMERA_A_DEPENDENCY_FAILED",
                message: "Camera B cannot run because Camera A failed or has no output. Retry Camera A first.",
                requires_camera_a: true,
              }
            })
            .eq("id", renderB.id);
        } else {
          // Camera A succeeded - proceed with Camera B
          console.log(`[single-space-renders] → Camera B starting for "${space.name}" (anchored to A: ${cameraAOutputId})`);
          const resultB = await processRender(renderB.id, cameraAOutputId);

          if (resultB.success) {
            console.log(`[single-space-renders] ✓ Camera B completed for "${space.name}"`);
          } else {
            console.log(`[single-space-renders] ✗ Camera B FAILED for "${space.name}"`);
          }
        }
      }

      console.log(`[single-space-renders] Finished processing space "${space.name}"`);
    };

    // Run in background
    EdgeRuntime.waitUntil(processSpaceRenders());

    return new Response(
      JSON.stringify({
        success: true,
        message: `Started rendering for space "${space.name}"`,
        space_id: space_id,
        space_name: space.name,
        renders_queued: idsToQueue.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("[single-space-renders] Error:", message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
