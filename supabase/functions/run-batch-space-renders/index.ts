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
 * STRICT A→B SEQUENTIAL EXECUTION MODEL
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * For each panorama point (camera marker):
 *   1) Camera A is generated FIRST
 *   2) Camera B waits for A to complete
 *   3) Camera B uses A's output as a visual anchor (mandatory)
 *   4) If Camera A fails → Camera B is BLOCKED (does not run)
 * 
 * This ensures Camera B is always grounded in Camera A's output.
 */

serve(async (req) => {
  // Generate unique batch request ID for tracing
  const batchRequestId = crypto.randomUUID().substring(0, 8);
  
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

    const { pipeline_id, styled_image_upload_id } = await req.json();
    
    console.log(`[batch-renders][${batchRequestId}] Request received: pipeline_id=${pipeline_id}`);

    if (!pipeline_id || !styled_image_upload_id) {
      return new Response(
        JSON.stringify({ error: "Missing pipeline_id or styled_image_upload_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Fetch pipeline and check if enabled
    const { data: pipeline } = await serviceClient
      .from("floorplan_pipelines")
      .select("is_enabled, run_state, floor_plan_upload_id, camera_intent_confirmed_at, aspect_ratio, quality_post_step4")
      .eq("id", pipeline_id)
      .single();

    if (pipeline?.is_enabled === false) {
      console.log(`[batch-renders] Pipeline ${pipeline_id} is paused - skipping`);
      return new Response(
        JSON.stringify({
          success: false,
          paused: true,
          message: "Pipeline is paused. Resume to continue processing.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if camera intent is confirmed - required for camera-aware rendering
    if (!pipeline?.camera_intent_confirmed_at) {
      console.log(`[batch-renders] Camera intent not confirmed for pipeline ${pipeline_id}`);
      return new Response(
        JSON.stringify({
          success: false,
          message: "Camera intent must be confirmed before generating renders. Please complete Camera Intent selection first.",
          error_code: "CAMERA_INTENT_REQUIRED"
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ANCHOR GATE: Check that all camera markers have ready anchors
    const { data: cameraMarkersForGate } = await serviceClient
      .from("pipeline_camera_markers")
      .select("id, label, anchor_status")
      .eq("pipeline_id", pipeline_id)
      .eq("owner_id", userId);

    const markersWithoutReadyAnchors = (cameraMarkersForGate || []).filter(
      m => m.anchor_status !== "ready"
    );

    if (markersWithoutReadyAnchors.length > 0) {
      console.log(`[batch-renders] BLOCKED: ${markersWithoutReadyAnchors.length} cameras missing ready anchors`);
      return new Response(
        JSON.stringify({
          success: false,
          message: `${markersWithoutReadyAnchors.length} camera(s) missing anchor screenshots. Create anchors in Camera Planning first.`,
          error_code: "ANCHOR_GATE_BLOCKED",
          blocked_cameras: markersWithoutReadyAnchors.map(m => ({
            id: m.id,
            label: m.label,
            anchor_status: m.anchor_status || "not_created"
          }))
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const floorPlanUploadId = pipeline?.floor_plan_upload_id;

    // Update pipeline phase
    await serviceClient
      .from("floorplan_pipelines")
      .update({ 
        whole_apartment_phase: "renders_in_progress",
        status: "step4_running",
      })
      .eq("id", pipeline_id);

    // First, get ALL active spaces to ensure they all have render records
    const { data: activeSpaces, error: spacesError } = await serviceClient
      .from("floorplan_pipeline_spaces")
      .select("id, name, space_type")
      .eq("pipeline_id", pipeline_id)
      .eq("owner_id", userId)
      .or("is_excluded.is.null,is_excluded.eq.false")
      .or("include_in_generation.is.null,include_in_generation.eq.true");

    if (spacesError) {
      throw new Error(`Failed to fetch spaces: ${spacesError.message}`);
    }

    // Get camera markers for binding
    const { data: cameraMarkers } = await serviceClient
      .from("pipeline_camera_markers")
      .select("id, room_id, label")
      .eq("pipeline_id", pipeline_id)
      .eq("owner_id", userId);

    // Get existing renders to find spaces missing render records
    const { data: existingRenders } = await serviceClient
      .from("floorplan_space_renders")
      .select("space_id, kind")
      .eq("pipeline_id", pipeline_id)
      .eq("owner_id", userId);

    const existingRenderKeys = new Set(
      (existingRenders || []).map(r => `${r.space_id}-${r.kind}`)
    );

    // Create missing render records for any active space without A/B renders
    const missingRenders: Array<{
      space_id: string;
      pipeline_id: string;
      owner_id: string;
      kind: string;
      status: string;
      ratio: string;
      quality: string;
      camera_marker_id: string | null;
      camera_label: string | null;
    }> = [];

    for (const space of activeSpaces || []) {
      // Find camera marker bound to this space
      const marker = cameraMarkers?.find(m => m.room_id === space.id);
      
      for (const kind of ["A", "B"]) {
        const key = `${space.id}-${kind}`;
        if (!existingRenderKeys.has(key)) {
          missingRenders.push({
            space_id: space.id,
            pipeline_id: pipeline_id,
            owner_id: userId,
            kind,
            status: "pending",
            ratio: pipeline?.aspect_ratio || "16:9",
            quality: pipeline?.quality_post_step4 || "2K",
            camera_marker_id: marker?.id || null,
            camera_label: marker?.label || null,
          });
          console.log(`[batch-renders] Creating missing render ${kind} for space "${space.name}" (${space.id})`);
        }
      }
    }

    // Insert any missing renders
    if (missingRenders.length > 0) {
      const { error: insertError } = await serviceClient
        .from("floorplan_space_renders")
        .insert(missingRenders);

      if (insertError) {
        console.error(`[batch-renders] Failed to create missing renders: ${insertError.message}`);
      } else {
        console.log(`[batch-renders] Created ${missingRenders.length} missing render records`);
      }
    }

    // Now fetch ALL renders that need processing for active spaces
    const { data: renders, error: rendersError } = await serviceClient
      .from("floorplan_space_renders")
      .select(`
        *,
        space:floorplan_pipeline_spaces!inner(
          id, is_excluded, include_in_generation, name, space_type
        )
      `)
      .eq("pipeline_id", pipeline_id)
      .eq("owner_id", userId)
      .eq("locked_approved", false)
      .in("status", ["pending", "planned", "queued", "rejected", "failed", "skipped"]);

    if (rendersError) {
      throw new Error(`Failed to fetch renders: ${rendersError.message}`);
    }

    // Filter to only active spaces
    const pendingRenders = (renders || []).filter(
      r => !r.space?.is_excluded && r.space?.include_in_generation !== false
    );

    console.log(`[batch-renders] Found ${pendingRenders.length} pending renders`);

    if (pendingRenders.length === 0) {
      await serviceClient
        .from("floorplan_pipelines")
        .update({ whole_apartment_phase: "renders_review" })
        .eq("id", pipeline_id);

      return new Response(
        JSON.stringify({
          success: true,
          message: "No pending renders found",
          processed: 0,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Mark all as queued
    const renderIds = pendingRenders.map(r => r.id);
    await serviceClient
      .from("floorplan_space_renders")
      .update({ status: "queued" })
      .in("id", renderIds);

    // ═══════════════════════════════════════════════════════════════════════════
    // STRICT A→B DEPENDENCY: Group renders by space, process sequentially
    // ═══════════════════════════════════════════════════════════════════════════
    
    // Group pending renders by space_id
    const rendersBySpace = new Map<string, { A?: any; B?: any; spaceName: string }>();
    
    for (const render of pendingRenders) {
      const spaceId = render.space_id;
      if (!rendersBySpace.has(spaceId)) {
        rendersBySpace.set(spaceId, { spaceName: render.space?.name || "Room" });
      }
      const group = rendersBySpace.get(spaceId)!;
      if (render.kind === "A") group.A = render;
      if (render.kind === "B") group.B = render;
    }

    console.log(`[batch-renders] Grouped into ${rendersBySpace.size} spaces with A→B dependency`);

    // Process in background using waitUntil pattern
    const processRenders = async () => {
      let completedA = 0;
      let completedB = 0;
      let failedA = 0;
      let failedB = 0;

      // Helper to process a single render
      const processRender = async (render: any, cameraAOutputId?: string): Promise<{ success: boolean; outputUploadId?: string }> => {
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
                render_id: render.id,
                styled_image_upload_id,
                // CRITICAL: Pass Camera A's output for Camera B grounding
                first_render_upload_id: cameraAOutputId,
                floor_plan_upload_id: floorPlanUploadId,
                space_metadata: {
                  name: render.space?.name,
                  space_type: render.space?.space_type,
                },
              }),
            }
          );

          if (response.ok) {
            const result = await response.json();
            console.log(`[batch-renders] Render ${render.id} (${render.kind}) completed`);
            return { success: true, outputUploadId: result.output_upload_id };
          } else {
            const errorText = await response.text();
            console.error(`[batch-renders] Render ${render.id} failed: ${errorText}`);
            return { success: false };
          }
        } catch (error) {
          console.error(`[batch-renders] Render ${render.id} error:`, error);
          return { success: false };
        }
      };

      // ═══════════════════════════════════════════════════════════════════════════
      // SEQUENTIAL PER-SPACE EXECUTION: A must complete before B starts
      // ═══════════════════════════════════════════════════════════════════════════
      
      for (const [spaceId, group] of rendersBySpace) {
        const spaceName = group.spaceName;
        console.log(`[batch-renders] Processing space "${spaceName}" (${spaceId})`);
        
        let cameraAOutputId: string | undefined = undefined;
        let cameraASuccess = false;

        // STEP 1: Process Camera A (if pending)
        if (group.A) {
          console.log(`[batch-renders] → Camera A starting for "${spaceName}"`);
          const resultA = await processRender(group.A);
          
          if (resultA.success) {
            completedA++;
            cameraASuccess = true;
            
            // Get Camera A's output_upload_id from DB (processRender may not return it directly)
            const { data: updatedRenderA } = await serviceClient
              .from("floorplan_space_renders")
              .select("output_upload_id")
              .eq("id", group.A.id)
              .single();
            
            cameraAOutputId = updatedRenderA?.output_upload_id || undefined;
            console.log(`[batch-renders] ✓ Camera A completed for "${spaceName}", output: ${cameraAOutputId}`);
          } else {
            failedA++;
            console.log(`[batch-renders] ✗ Camera A FAILED for "${spaceName}" - Camera B will be BLOCKED`);
          }
        } else {
          // Camera A already approved - check if it has output
          const { data: existingA } = await serviceClient
            .from("floorplan_space_renders")
            .select("output_upload_id, status, locked_approved")
            .eq("space_id", spaceId)
            .eq("kind", "A")
            .single();
          
          if (existingA?.output_upload_id && (existingA.locked_approved || existingA.status === "needs_review")) {
            cameraAOutputId = existingA.output_upload_id;
            cameraASuccess = true;
            console.log(`[batch-renders] → Camera A already complete for "${spaceName}", output: ${cameraAOutputId}`);
          }
        }

        // STEP 2: Process Camera B ONLY if Camera A succeeded
        if (group.B) {
          if (!cameraASuccess || !cameraAOutputId) {
            // BLOCK Camera B - Camera A failed or has no output
            console.log(`[batch-renders] ✗ Camera B BLOCKED for "${spaceName}" - Camera A not available`);
            
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
              .eq("id", group.B.id);
            
            failedB++;
          } else {
            // Camera A succeeded - proceed with Camera B grounded in A's output
            console.log(`[batch-renders] → Camera B starting for "${spaceName}" (anchored to A: ${cameraAOutputId})`);
            const resultB = await processRender(group.B, cameraAOutputId);
            
            if (resultB.success) {
              completedB++;
              console.log(`[batch-renders] ✓ Camera B completed for "${spaceName}"`);
            } else {
              failedB++;
              console.log(`[batch-renders] ✗ Camera B FAILED for "${spaceName}"`);
            }
          }
        }
      }

      // Update pipeline phase after all complete
      const { data: allRenders } = await serviceClient
        .from("floorplan_space_renders")
        .select("status, locked_approved")
        .eq("pipeline_id", pipeline_id);

      const allApproved = allRenders?.every(r => r.locked_approved);
      const anyNeedsReview = allRenders?.some(r => r.status === "needs_review");

      if (allApproved) {
        await serviceClient
          .from("floorplan_pipelines")
          .update({ whole_apartment_phase: "panoramas_pending" })
          .eq("id", pipeline_id);
      } else if (anyNeedsReview || (completedA + completedB) > 0) {
        await serviceClient
          .from("floorplan_pipelines")
          .update({ whole_apartment_phase: "renders_review" })
          .eq("id", pipeline_id);
      }

      console.log(`[batch-renders] Summary: A (completed: ${completedA}, failed: ${failedA}), B (completed: ${completedB}, failed/blocked: ${failedB})`);
    };

    // Start background processing
    EdgeRuntime.waitUntil(processRenders());

    const kindACount = pendingRenders.filter(r => r.kind === "A").length;
    const kindBCount = pendingRenders.filter(r => r.kind === "B").length;

    return new Response(
      JSON.stringify({
        success: true,
        message: `Started processing ${pendingRenders.length} renders (${kindACount} A → ${kindBCount} B sequential)`,
        total_renders: pendingRenders.length,
        execution_model: "strict_a_then_b",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[batch-renders] Error: ${message}`);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
