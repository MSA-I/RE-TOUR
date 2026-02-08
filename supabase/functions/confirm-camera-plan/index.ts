import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  ensurePipelineTrace,
  logPipelineEvent,
  flushLangfuse,
} from "../_shared/langfuse-generation-wrapper.ts";
import { STEP_3_2_GENERATIONS } from "../_shared/langfuse-constants.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Confirm Camera Plan and Generate Prompts
 * 
 * When CONFIRM is clicked:
 * 1. Validate all markers have room bindings
 * 2. Generate Camera A + B prompts for each marker→space pair
 * 3. Store prompts in floorplan_space_renders (pre-filled drafts)
 * 4. Update pipeline phase to camera_plan_confirmed
 * 5. Log all changes for debugging
 */

interface MarkerData {
  id: string;
  label: string;
  room_id: string;
  x_norm: number;
  y_norm: number;
  yaw_deg: number;
  fov_deg: number;
}

interface SpaceData {
  id: string;
  name: string;
  space_type: string;
}

function buildCameraAPrompt(marker: MarkerData, space: SpaceData): string {
  const yawDeg = marker.yaw_deg;
  const fovDeg = marker.fov_deg;
  const posPercent = { x: Math.round(marker.x_norm * 100), y: Math.round(marker.y_norm * 100) };
  
  // Cardinal direction approximation
  const cardinal = getCardinalDirection(yawDeg);
  
  return `Generate a photorealistic interior render of "${space.name}" (${space.space_type}).

=== PRIMARY VISUAL ANCHOR: CAMERA SCREENSHOT ===
A camera location screenshot with an arrow overlay is provided.
This screenshot DEFINES the exact camera position and viewing direction.
The arrow in the screenshot shows where the camera is standing and exactly what direction it is facing.

AUTHORITY RULE:
- The camera screenshot is the PRIMARY authority for orientation.
- This render MUST strictly follow the camera screenshot with the arrow overlay.
- Do NOT reinterpret or guess the viewpoint.
- If there is any ambiguity between textual specs and the screenshot, THE SCREENSHOT WINS.

CAMERA SPECIFICATIONS (supportive metadata only):
- Position: (${posPercent.x}%, ${posPercent.y}%) on floor plan
- Direction: ${yawDeg}° (${cardinal})
- Field of View: ${fovDeg}°
- Camera Label: ${marker.label} (A)

MANDATORY CONSTRAINTS:
- Only render what is visible from the viewpoint shown in the screenshot
- Do NOT invent rooms, openings, or furniture not shown in the floor plan
- Respect architectural adjacency and wall boundaries
- Match the style and materials from the Step 2 styled reference image

OUTPUT REQUIREMENTS:
- High-resolution interior visualization
- Consistent lighting with the overall apartment style
- Accurate perspective matching the camera screenshot exactly`;
}

function buildCameraBPrompt(marker: MarkerData, space: SpaceData): string {
  const yawDegB = (marker.yaw_deg + 180) % 360;
  const fovDeg = marker.fov_deg;
  const posPercent = { x: Math.round(marker.x_norm * 100), y: Math.round(marker.y_norm * 100) };
  
  // Cardinal direction approximation
  const cardinal = getCardinalDirection(yawDegB);
  
  return `Generate the OPPOSITE VIEW of "${space.name}" (${space.space_type}).

=== PRIMARY VISUAL ANCHOR: CAMERA A OUTPUT IMAGE ===
A rendered image from Camera A is provided as the PRIMARY visual reference.
Use the provided Camera A image as the main visual reference.
Generate the same space from the opposite viewing direction, as if the camera turned 180 degrees in place.
This is a mirrored viewpoint of the same location.

EXPLICIT PROHIBITION:
- Do NOT use the floor plan image for this render.
- Do NOT reinterpret geometry from scratch.
- Do NOT invent new viewpoints or perspectives.

MIRRORING LOGIC:
- You are rendering the EXACT SAME space from Camera A, but facing the opposite direction.
- Imagine standing at the same position and turning around 180°.
- The floor, ceiling, materials, lighting, and furniture style MUST match Camera A exactly.
- Doorways and openings visible in Camera A may now be behind the camera.

CAMERA SPECIFICATIONS (supportive metadata only):
- Position: (${posPercent.x}%, ${posPercent.y}%) on floor plan (same as Camera A)
- Direction: ${yawDegB}° (${cardinal}) - EXACTLY 180° opposite of Camera A
- Field of View: ${fovDeg}°
- Camera Label: ${marker.label} (B)

OUTPUT REQUIREMENTS:
- Visual continuity with Camera A render (same room, same style)
- Same lighting conditions and materials
- Accurate opposite perspective from the same standing position`;
}

function getCardinalDirection(yawDeg: number): string {
  const normalized = ((yawDeg % 360) + 360) % 360;
  if (normalized >= 337.5 || normalized < 22.5) return "North";
  if (normalized >= 22.5 && normalized < 67.5) return "Northeast";
  if (normalized >= 67.5 && normalized < 112.5) return "East";
  if (normalized >= 112.5 && normalized < 157.5) return "Southeast";
  if (normalized >= 157.5 && normalized < 202.5) return "South";
  if (normalized >= 202.5 && normalized < 247.5) return "Southwest";
  if (normalized >= 247.5 && normalized < 292.5) return "West";
  return "Northwest";
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    // Get auth user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      console.log("[confirm-camera-plan] Auth error:", userError?.message);
      return new Response(
        JSON.stringify({ success: false, error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = user.id;

    // Parse request body
    const { pipeline_id } = await req.json();
    if (!pipeline_id) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing pipeline_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[confirm-camera-plan] User ${userId} confirming camera plan for pipeline ${pipeline_id}`);

    // ═══════════════════════════════════════════════════════════════════════════
    // LANGFUSE TRACING: Ensure pipeline_run trace exists
    // ═══════════════════════════════════════════════════════════════════════════
    await ensurePipelineTrace(pipeline_id, "", userId);

    // Fetch pipeline with row lock
    const { data: pipeline, error: pipelineError } = await serviceClient
      .from("floorplan_pipelines")
      .select("*")
      .eq("id", pipeline_id)
      .eq("owner_id", userId)
      .single();

    if (pipelineError || !pipeline) {
      console.log("[confirm-camera-plan] Pipeline not found or not owned:", pipelineError?.message);
      return new Response(
        JSON.stringify({ success: false, error: "Pipeline not found or access denied" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate phase is compatible - allow spaces_detected since camera planning follows space detection
    const validPhases = ["camera_plan_pending", "style_review", "camera_plan_confirmed", "spaces_detected"];
    if (!validPhases.includes(pipeline.whole_apartment_phase || "")) {
      console.log(`[confirm-camera-plan] Invalid phase: ${pipeline.whole_apartment_phase}`);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `Cannot confirm camera plan in phase: ${pipeline.whole_apartment_phase}. Expected: camera_plan_pending` 
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch camera markers with room binding info and anchor status
    const { data: markers, error: markersError } = await serviceClient
      .from("pipeline_camera_markers")
      .select("id, label, room_id, x_norm, y_norm, yaw_deg, fov_deg, anchor_status")
      .eq("pipeline_id", pipeline_id)
      .order("sort_order", { ascending: true });

    if (markersError) {
      console.log("[confirm-camera-plan] Error fetching markers:", markersError.message);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to fetch camera markers" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate at least one marker exists
    if (!markers || markers.length === 0) {
      console.log("[confirm-camera-plan] No markers found, blocking confirmation");
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "At least one camera marker is required before confirming the camera plan" 
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate all markers have room bindings
    const unboundMarkers = markers.filter((m) => !m.room_id);
    if (unboundMarkers.length > 0) {
      console.log(`[confirm-camera-plan] ${unboundMarkers.length} markers without room binding`);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `${unboundMarkers.length} camera marker(s) do not have a room assigned. Please assign a room to each marker.`,
          unbound_markers: unboundMarkers.map((m) => m.label)
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ============= SCREENSHOT DEPENDENCY VALIDATION (MANDATORY) =============
    // Camera A prompt generation REQUIRES a valid camera screenshot with arrow overlay
    const markersWithoutScreenshot = markers.filter((m) => m.anchor_status !== "ready");
    if (markersWithoutScreenshot.length > 0) {
      console.log(`[confirm-camera-plan] ${markersWithoutScreenshot.length} markers missing screenshots (anchor_status != ready)`);
      console.log(`[confirm-camera-plan] Markers without screenshots: ${markersWithoutScreenshot.map((m) => m.label).join(", ")}`);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `${markersWithoutScreenshot.length} camera marker(s) do not have screenshots captured. Camera screenshots are REQUIRED before confirming the camera plan.`,
          markers_missing_screenshots: markersWithoutScreenshot.map((m) => ({ 
            label: m.label, 
            anchor_status: m.anchor_status 
          }))
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[confirm-camera-plan] Found ${markers.length} markers, all bound to rooms with valid screenshots`);

    // Fetch spaces for name lookup
    const { data: spaces, error: spacesError } = await serviceClient
      .from("floorplan_pipeline_spaces")
      .select("id, name, space_type")
      .eq("pipeline_id", pipeline_id);

    if (spacesError) {
      console.log("[confirm-camera-plan] Error fetching spaces:", spacesError.message);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to fetch spaces" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const spaceMap = new Map<string, SpaceData>();
    for (const space of (spaces || [])) {
      spaceMap.set(space.id, space);
    }

    // ============= PROMPT GENERATION =============
    console.log(`[confirm-camera-plan] Generating prompts for ${markers.length} markers...`);
    
    // Emit initial event
    await serviceClient.from("floorplan_pipeline_events").insert({
      pipeline_id,
      owner_id: userId,
      step_number: 4,
      type: "PROMPT_GENERATION_STARTED",
      message: `Starting prompt generation for ${markers.length} camera markers...`,
      progress_int: 0,
      ts: new Date().toISOString(),
    });
    
    const promptsGenerated: { marker: string; space: string; kind: string }[] = [];
    const promptsUpdated: { marker: string; space: string; kind: string }[] = [];
    const promptErrors: { marker: string; error: string }[] = [];
    let processedCount = 0;

    for (const marker of markers) {
      const space = spaceMap.get(marker.room_id!);
      if (!space) {
        promptErrors.push({ marker: marker.label, error: `Space not found for room_id: ${marker.room_id}` });
        continue;
      }

      const markerData: MarkerData = {
        id: marker.id,
        label: marker.label,
        room_id: marker.room_id!,
        x_norm: marker.x_norm,
        y_norm: marker.y_norm,
        yaw_deg: marker.yaw_deg,
        fov_deg: marker.fov_deg,
      };

      // Generate prompts
      const promptA = buildCameraAPrompt(markerData, space);
      const promptB = buildCameraBPrompt(markerData, space);

      console.log(`[confirm-camera-plan] Composing prompt for ${space.name} – Camera A (${marker.label})`);

      // ============= RENDER A: Find existing or create =============
      // First, look for existing render with this camera_marker_id
      let existingRenderA = await serviceClient
        .from("floorplan_space_renders")
        .select("id, prompt_text, camera_marker_id")
        .eq("pipeline_id", pipeline_id)
        .eq("space_id", space.id)
        .eq("kind", "A")
        .eq("camera_marker_id", marker.id)
        .maybeSingle();

      // If not found, look for placeholder (camera_marker_id is null, status is 'planned')
      if (!existingRenderA.data) {
        existingRenderA = await serviceClient
          .from("floorplan_space_renders")
          .select("id, prompt_text, camera_marker_id")
          .eq("pipeline_id", pipeline_id)
          .eq("space_id", space.id)
          .eq("kind", "A")
          .is("camera_marker_id", null)
          .eq("status", "planned")
          .maybeSingle();
      }

      if (existingRenderA.data) {
        // Update existing render (either matched by marker or placeholder)
        const { error: updateAError } = await serviceClient
          .from("floorplan_space_renders")
          .update({ 
            prompt_text: promptA,
            camera_label: `${marker.label} (A)`,
            camera_marker_id: marker.id,
            status: "pending", // Upgrade from 'planned' to 'pending'
            updated_at: new Date().toISOString(),
          })
          .eq("id", existingRenderA.data.id);
        
        if (updateAError) {
          promptErrors.push({ marker: marker.label, error: `Render A update failed: ${updateAError.message}` });
        } else {
          console.log(`[confirm-camera-plan] ✓ Prompt composed for ${space.name} – Camera A`);
          promptsUpdated.push({ marker: marker.label, space: space.name, kind: "A" });
        }
      } else {
        // Create new render record
        const { error: insertAError } = await serviceClient
          .from("floorplan_space_renders")
          .insert({
            pipeline_id,
            space_id: space.id,
            owner_id: userId,
            kind: "A",
            status: "pending",
            camera_marker_id: marker.id,
            camera_label: `${marker.label} (A)`,
            prompt_text: promptA,
          });

        if (insertAError) {
          promptErrors.push({ marker: marker.label, error: `Render A insert failed: ${insertAError.message}` });
        } else {
          console.log(`[confirm-camera-plan] ✓ Prompt created for ${space.name} – Camera A`);
          promptsGenerated.push({ marker: marker.label, space: space.name, kind: "A" });
        }
      }

      console.log(`[confirm-camera-plan] Composing prompt for ${space.name} – Camera B (${marker.label})`);

      // ============= RENDER B: Find existing or create =============
      let existingRenderB = await serviceClient
        .from("floorplan_space_renders")
        .select("id, prompt_text, camera_marker_id")
        .eq("pipeline_id", pipeline_id)
        .eq("space_id", space.id)
        .eq("kind", "B")
        .eq("camera_marker_id", marker.id)
        .maybeSingle();

      // If not found, look for placeholder
      if (!existingRenderB.data) {
        existingRenderB = await serviceClient
          .from("floorplan_space_renders")
          .select("id, prompt_text, camera_marker_id")
          .eq("pipeline_id", pipeline_id)
          .eq("space_id", space.id)
          .eq("kind", "B")
          .is("camera_marker_id", null)
          .eq("status", "planned")
          .maybeSingle();
      }

      if (existingRenderB.data) {
        // Update existing render (either matched by marker or placeholder)
        const { error: updateBError } = await serviceClient
          .from("floorplan_space_renders")
          .update({ 
            prompt_text: promptB,
            camera_label: `${marker.label} (B)`,
            camera_marker_id: marker.id,
            status: "pending",
            updated_at: new Date().toISOString(),
          })
          .eq("id", existingRenderB.data.id);
        
        if (updateBError) {
          promptErrors.push({ marker: marker.label, error: `Render B update failed: ${updateBError.message}` });
        } else {
          console.log(`[confirm-camera-plan] ✓ Prompt composed for ${space.name} – Camera B`);
          promptsUpdated.push({ marker: marker.label, space: space.name, kind: "B" });
        }
      } else {
        // Create new render record
        const { error: insertBError } = await serviceClient
          .from("floorplan_space_renders")
          .insert({
            pipeline_id,
            space_id: space.id,
            owner_id: userId,
            kind: "B",
            status: "pending",
            camera_marker_id: marker.id,
            camera_label: `${marker.label} (B)`,
            prompt_text: promptB,
          });

        if (insertBError) {
          promptErrors.push({ marker: marker.label, error: `Render B insert failed: ${insertBError.message}` });
        } else {
          console.log(`[confirm-camera-plan] ✓ Prompt created for ${space.name} – Camera B`);
          promptsGenerated.push({ marker: marker.label, space: space.name, kind: "B" });
        }
      }
      
      // Emit per-marker progress event
      processedCount++;
      const progress = Math.round((processedCount / markers.length) * 100);
      await serviceClient.from("floorplan_pipeline_events").insert({
        pipeline_id,
        owner_id: userId,
        step_number: 4,
        type: "PROMPT_GENERATION_PROGRESS",
        message: `✓ Prompts composed for ${space.name} (${marker.label} A+B)`,
        progress_int: progress,
        ts: new Date().toISOString(),
      });
    }

    console.log(`[confirm-camera-plan] Prompts generated: ${promptsGenerated.length}, updated: ${promptsUpdated.length}, errors: ${promptErrors.length}`);
    
    // Emit completion event with summary
    await serviceClient.from("floorplan_pipeline_events").insert({
      pipeline_id,
      owner_id: userId,
      step_number: 4,
      type: "PROMPT_GENERATION_COMPLETE",
      message: `Prompt generation complete: ${promptsGenerated.length} created, ${promptsUpdated.length} updated, ${promptErrors.length} errors`,
      progress_int: 100,
      ts: new Date().toISOString(),
    });

    if (promptErrors.length > 0) {
      console.warn(`[confirm-camera-plan] Prompt errors:`, promptErrors);
    }

    const now = new Date().toISOString();

    // Update pipeline phase to camera_plan_confirmed
    const { data: updatedPipeline, error: updateError } = await serviceClient
      .from("floorplan_pipelines")
      .update({
        whole_apartment_phase: "camera_plan_confirmed",
        camera_plan_confirmed_at: now,
        updated_at: now,
      })
      .eq("id", pipeline_id)
      .eq("owner_id", userId)
      .select()
      .single();

    if (updateError) {
      console.log("[confirm-camera-plan] Update error:", updateError.message);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to update pipeline" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Log CAMERA_PLAN_CONFIRMED event with prompt generation details
    const eventMessage = JSON.stringify({
      marker_count: markers.length,
      marker_labels: markers.map((m) => m.label),
      prompts_generated: promptsGenerated.length,
      prompts_updated: promptsUpdated.length,
      prompt_errors: promptErrors.length,
      action: "confirm-camera-plan",
      confirmed_at: now,
    });

    const { error: eventError } = await serviceClient
      .from("floorplan_pipeline_events")
      .insert({
        pipeline_id,
        owner_id: userId,
        step_number: 4, // Camera Planning is Step 4
        type: "CAMERA_PLAN_CONFIRMED",
        message: eventMessage,
        progress_int: 100,
        ts: now,
      });

    if (eventError) {
      console.log("[confirm-camera-plan] Event logging error (non-fatal):", eventError.message);
      // Don't fail the request for event logging errors
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // LANGFUSE: Log camera_prompts_approved event
    // ═══════════════════════════════════════════════════════════════════════════
    await logPipelineEvent({
      traceId: pipeline_id,
      eventName: STEP_3_2_GENERATIONS.CAMERA_PROMPTS_APPROVED,
      metadata: {
        project_id: "",
        pipeline_id,
        step_number: 3,
        sub_step: "3.2",
      },
      input: {
        marker_count: markers.length,
        marker_labels: markers.map((m: any) => m.label),
        action: "confirm-camera-plan",
      },
      output: {
        prompts_generated: promptsGenerated.length,
        prompts_updated: promptsUpdated.length,
        prompt_errors: promptErrors.length,
        confirmed_at: now,
        phase_after: "camera_plan_confirmed",
      },
    });

    console.log(`[confirm-camera-plan] Successfully confirmed camera plan for pipeline ${pipeline_id}`);
    console.log(`[confirm-camera-plan] Terminal log: ${markers.length} markers processed, ${promptsGenerated.length + promptsUpdated.length} prompts updated/created`);

    // CRITICAL: Flush Langfuse events before returning
    await flushLangfuse();

    return new Response(
      JSON.stringify({
        success: true,
        pipeline: updatedPipeline,
        marker_count: markers.length,
        prompts_generated: promptsGenerated.length,
        prompts_updated: promptsUpdated.length,
        prompt_errors: promptErrors.length,
        changes: {
          created: promptsGenerated,
          updated: promptsUpdated,
          errors: promptErrors,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[confirm-camera-plan] Unexpected error:", error);
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    
    // Flush Langfuse even on error
    await flushLangfuse();
    
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
