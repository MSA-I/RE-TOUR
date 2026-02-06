import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import { buildCameraContext, CameraMarker, SpatialMap } from "../_shared/camera-context-builder.ts";
import { 
  buildCameraAnchorPromptText, 
  createCameraOverlayDescription,
  CameraMarkerData 
} from "../_shared/camera-visual-anchor.ts";
import { 
  getOppositeViewTemplate, 
  instantiateOppositeViewTemplate 
} from "../_shared/template-loader.ts";
import {
  wrapModelGeneration,
  flushLangfuse,
} from "../_shared/langfuse-generation-wrapper.ts";
import { STEP_5_GENERATIONS } from "../_shared/langfuse-constants.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const API_NANOBANANA = Deno.env.get("API_NANOBANANA")!;

// ═══════════════════════════════════════════════════════════════════════════════
// PROMPT TEMPLATE FOR KIND A (First angle - uses VISUAL CAMERA ANCHORS)
// ═══════════════════════════════════════════════════════════════════════════════
const RENDER_PROMPT_TEMPLATE_A = `Generate a photorealistic eye-level interior render based on the styled top-down 3D view and VISUAL CAMERA ANCHORS provided.

{VISUAL_CAMERA_ANCHOR}

CRITICAL REQUIREMENTS:
- Camera height: 1.5-1.7 meters (human eye level)
- Perspective: Natural field of view matching the FOV cone shown in the camera overlay
- Direction: Generate the view EXACTLY in the direction shown by the arrow in the camera overlay
- Position: The camera is placed EXACTLY where the marker circle is shown on the plan
- Lighting: Consistent with the styled reference (preserve natural/artificial light sources)
- Materials: Exactly match the materials, colors, and textures from the styled top-down view
- Geometry: Preserve exact room proportions and furniture placement
- Style: Photorealistic, architectural visualization quality

SPACE CONTEXT:
Space Name: {space_name}
Space Type: {space_type}

{CAMERA_CONTEXT}

{SCALE_CONSTRAINTS}

{ROOM_TYPE_RULES}

FURNITURE SCALE RULES:
- All furniture must be realistically proportioned to the room dimensions.
- Do NOT place oversized furniture in small rooms.
- Do NOT place miniature furniture in large rooms.
- Standard door height: ~2.1m (7 ft).
- Standard ceiling height: 2.4-2.7m (8-9 ft).
- Kitchen counter height: ~0.9m (3 ft).
- Dining table height: ~0.75m (2.5 ft).

Generate a single high-quality image that could be used in a real estate listing or architectural portfolio.`;

// ═══════════════════════════════════════════════════════════════════════════════
// PROMPT TEMPLATE FOR KIND B (Opposite angle - MANDATORY GROUNDING in Camera A's output)
// ═══════════════════════════════════════════════════════════════════════════════
const RENDER_PROMPT_TEMPLATE_B = `Generate the OPPOSITE-FACING VIEW from the EXACT SAME camera position shown in Camera A.

═══════════════════════════════════════════════════════════════
CRITICAL: CAMERA B IS ANCHORED TO CAMERA A
═══════════════════════════════════════════════════════════════
This is NOT an independent generation. Camera B must be:
- The 180° opposite view of Camera A
- From the EXACT same position (x, y coordinates)
- In the SAME room/space as Camera A
- Consistent in style, lighting, and materials with Camera A

{VISUAL_CAMERA_ANCHOR}

SPACE CONTEXT:
Space Name: {space_name}
Space Type: {space_type}

{CAMERA_CONTEXT}

HARD CONSTRAINTS FOR CAMERA B:
1. SAME SPACE: You are looking at the OTHER SIDE of the same room shown in Camera A
2. OPPOSITE DIRECTION: Camera B yaw = Camera A yaw + 180°
3. SAME POSITION: Camera B is at the exact same (x_norm, y_norm) as Camera A
4. STYLE CONSISTENCY: All furniture, materials, and lighting must match Camera A
5. NO ROOM CHANGES: Do NOT change the room type or add/remove architectural features
6. ADJACENCY RESPECT: Any visible openings must lead to rooms from the floor plan adjacency graph

{ROOM_TYPE_RULES}

EXPLICIT VERIFICATION:
- If Camera A shows a bedroom → Camera B MUST show the opposite side of that bedroom
- If Camera A shows a living room → Camera B MUST show the opposite side of that living room
- Do NOT generate a different room type

{SCALE_CONSTRAINTS}

Generate the opposite-facing view that completes the 360° coverage of this exact space.`;

// Room-type specific rules to prevent misclassification
function getRoomTypeRules(spaceType: string): string {
  const normalizedType = spaceType.toLowerCase();
  
  if (normalizedType.includes("bedroom") || normalizedType.includes("master")) {
    return `ROOM TYPE RULES (BEDROOM):
- MUST contain: bed, possibly nightstands, wardrobe or closet
- MUST NOT contain: toilet, shower, bathtub, bathroom sink, urinal
- This is a sleeping space - do NOT add bathroom fixtures`;
  }
  
  if (normalizedType.includes("bathroom") || normalizedType.includes("wc") || normalizedType.includes("toilet")) {
    return `ROOM TYPE RULES (BATHROOM):
- MUST contain at least one of: toilet, shower, bathtub, bathroom sink
- This is a bathroom - appropriate sanitary fixtures are required`;
  }
  
  if (normalizedType.includes("kitchen")) {
    return `ROOM TYPE RULES (KITCHEN):
- MUST contain: kitchen counter, cabinets, possibly stove/oven, sink
- MUST NOT contain: bed, toilet, shower, bathtub
- This is a cooking space`;
  }
  
  if (normalizedType.includes("living") || normalizedType.includes("lounge")) {
    return `ROOM TYPE RULES (LIVING ROOM):
- MUST contain: seating (sofa, chairs), possibly coffee table, TV area
- MUST NOT contain: bed, toilet, shower, bathtub, kitchen appliances
- This is a living/relaxation space`;
  }
  
  if (normalizedType.includes("closet") || normalizedType.includes("wardrobe") || normalizedType.includes("dressing")) {
    return `ROOM TYPE RULES (CLOSET/DRESSING):
- MUST contain: storage shelves, hanging rails, possibly drawers
- MUST NOT contain: toilet, shower, bathtub, bed
- This is a storage/dressing space`;
  }
  
  if (normalizedType.includes("dining")) {
    return `ROOM TYPE RULES (DINING):
- MUST contain: dining table, chairs
- MUST NOT contain: bed, toilet, shower, bathtub
- This is an eating space`;
  }
  
  return `ROOM TYPE RULES:
- Maintain appropriate furniture for a ${spaceType}
- Do NOT add bathroom fixtures unless this is explicitly a bathroom`;
}

// Build scale constraints for render prompts based on dimension analysis
function buildRenderScaleConstraints(
  dimensionAnalysis: any | null, 
  spaceType: string
): string {
  if (!dimensionAnalysis?.dimensions_found) {
    return `SCALE CONSISTENCY:
- Maintain realistic furniture and fixture proportions.
- Door heights: ~2.1m (7 ft)
- Standard ceiling heights: 2.4-2.7m (8-9 ft)
- Furniture should appear natural scale relative to room size.`;
  }

  const units = dimensionAnalysis.units || "unknown";
  
  // Extract room-specific dimensions if available
  const roomDimensions = (dimensionAnalysis.extracted_dimensions || [])
    .filter((d: any) => 
      d.label?.toLowerCase().includes(spaceType.toLowerCase()) ||
      d.label?.toLowerCase().includes("room") ||
      d.label?.toLowerCase().includes("width") ||
      d.label?.toLowerCase().includes("length")
    )
    .slice(0, 3);

  const dimensionNotes = roomDimensions.length > 0
    ? `\nRelevant room dimensions:\n${roomDimensions.map((d: any) => `  - ${d.label}: ${d.raw_text}`).join("\n")}`
    : "";

  return `SCALE CONSISTENCY (LOCKED FROM PLAN DIMENSIONS):
- scale_locked: TRUE
- Units: ${units}${dimensionNotes}

CRITICAL - Furniture must fit realistically within the measured room dimensions.
- A small room (e.g., 2.5m x 3m) should NOT contain oversized furniture.
- A large room should NOT have miniature-looking furniture.
- Door and window proportions must match the floor plan measurements.`;
}

async function fetchImageAsBase64(supabase: any, uploadId: string): Promise<{ base64: string; mimeType: string }> {
  const { data: upload, error: uploadError } = await supabase
    .from("uploads")
    .select("*")
    .eq("id", uploadId)
    .single();

  if (uploadError || !upload) {
    throw new Error(`Upload not found: ${uploadId}`);
  }

  const { data: fileData, error: downloadError } = await supabase.storage
    .from(upload.bucket)
    .download(upload.path);

  if (downloadError || !fileData) {
    throw new Error(`Failed to download image: ${downloadError?.message}`);
  }

  const arrayBuffer = await fileData.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  const base64 = encodeBase64(uint8Array);
  const mimeType = upload.mime_type || "image/jpeg";

  return { base64, mimeType };
}

// Helper to emit pipeline events for terminal visibility
async function emitPipelineEvent(
  serviceClient: any,
  pipelineId: string,
  ownerId: string,
  type: string,
  message: string,
  progressInt: number = 0
) {
  try {
    await serviceClient
      .from("floorplan_pipeline_events")
      .insert({
        pipeline_id: pipelineId,
        owner_id: ownerId,
        step_number: 4, // Space renders are Step 4
        type,
        message,
        progress_int: progressInt,
      });
  } catch (err) {
    console.error(`[space-render] Failed to emit event: ${err}`);
  }
}

serve(async (req) => {
  // Generate unique request ID for tracing
  const requestId = crypto.randomUUID().substring(0, 8);
  
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

    const { 
      render_id, 
      styled_image_upload_id, 
      custom_prompt,
      // NEW: Grounding context for Kind B renders
      first_render_upload_id,
      floor_plan_upload_id,
      space_metadata,
      // NEW: Edit/Inpaint mode
      is_edit_inpaint,
      user_correction_text,
    } = await req.json();
    
    console.log(`[space-render][${requestId}] Request received: render_id=${render_id}, step=5`);

    if (!render_id) {
      return new Response(
        JSON.stringify({ error: "Missing render_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // For inpaint mode, styled_image is optional (we use source_image instead)
    if (!is_edit_inpaint && !styled_image_upload_id) {
      return new Response(
        JSON.stringify({ error: "Missing styled_image_upload_id for generation mode" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Fetch render record with space info (include inpaint fields)
    const { data: render, error: renderError } = await serviceClient
      .from("floorplan_space_renders")
      .select(`
        *,
        space:floorplan_pipeline_spaces(*),
        source_upload:uploads!floorplan_space_renders_source_image_upload_id_fkey(*)
      `)
      .eq("id", render_id)
      .eq("owner_id", userId)
      .single();

    if (renderError || !render) {
      console.log(`[space-render][${requestId}] Render not found: ${render_id}`);
      return new Response(JSON.stringify({ error: "Render not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if already locked
    if (render.locked_approved) {
      console.log(`[space-render][${requestId}] Render is locked: ${render_id}`);
      return new Response(
        JSON.stringify({ error: "Render is locked and cannot be regenerated" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // IDEMPOTENCY CHECK: Prevent duplicate generation for same render
    // Key: (pipeline_id, space_id, camera_kind, step=5)
    // If this render is already generating/running, return early
    // ═══════════════════════════════════════════════════════════════════════════
    const IN_PROGRESS_STATUSES = ["generating", "running", "queued"];
    if (IN_PROGRESS_STATUSES.includes(render.status)) {
      console.log(`[space-render][${requestId}] IDEMPOTENCY: Render ${render_id} already in status '${render.status}' - returning existing`);
      return new Response(
        JSON.stringify({
          success: true,
          render_id,
          message: `Render already in progress (${render.status})`,
          idempotent: true,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    // Additional check: Any other render for same space/kind already generating?
    const { data: duplicateRenders } = await serviceClient
      .from("floorplan_space_renders")
      .select("id, status")
      .eq("space_id", render.space_id)
      .eq("kind", render.kind)
      .in("status", IN_PROGRESS_STATUSES)
      .neq("id", render_id);
    
    if (duplicateRenders && duplicateRenders.length > 0) {
      console.log(`[space-render][${requestId}] IDEMPOTENCY: Found ${duplicateRenders.length} duplicate(s) in-progress for space ${render.space_id} kind ${render.kind}:`, duplicateRenders.map(r => r.id));
      return new Response(
        JSON.stringify({
          success: false,
          error: "DUPLICATE_IN_PROGRESS",
          message: `Another render for this space/camera is already in progress`,
          existing_render_id: duplicateRenders[0].id,
        }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    console.log(`[space-render][${requestId}] Starting generation for render ${render_id} (${render.kind}) space=${render.space_id}`);

    // ═══════════════════════════════════════════════════════════════════════════
    // CAMERA B DEPENDENCY GATE: Block if no Camera A anchor available
    // CRITICAL: Also auto-fetch Camera A output_upload_id if not provided
    // ═══════════════════════════════════════════════════════════════════════════
    const isKindB = render.kind === "B";
    const isInpaintMode = is_edit_inpaint && render.source_image_upload_id;
    
    // Track Camera A's output for Camera B grounding (may be passed in or fetched from DB)
    let resolvedCameraAOutputId: string | null = first_render_upload_id || null;
    
    if (isKindB && !isInpaintMode) {
      // Always check DB for Camera A output - even if first_render_upload_id was provided
      const { data: cameraARender } = await serviceClient
        .from("floorplan_space_renders")
        .select("output_upload_id, status, locked_approved")
        .eq("space_id", render.space_id)
        .eq("kind", "A")
        .single();
      
      const cameraAReady = cameraARender?.output_upload_id && 
        (cameraARender.locked_approved || cameraARender.status === "needs_review");
      
      if (!cameraAReady && !resolvedCameraAOutputId) {
        // HARD BLOCK: Camera B cannot run without Camera A's output
        console.error(`[space-render] BLOCKED: Camera B cannot run without Camera A output`);
        
        await serviceClient
          .from("floorplan_space_renders")
          .update({ 
            status: "blocked",
            qa_report: {
              error: "CAMERA_A_DEPENDENCY_REQUIRED",
              message: "Camera B cannot generate without Camera A's output. Camera A must complete first.",
              requires_camera_a: true,
            }
          })
          .eq("id", render_id);
        
        return new Response(
          JSON.stringify({ 
            error: "CAMERA_A_DEPENDENCY_REQUIRED",
            message: "Camera B cannot generate without Camera A's output. Generate Camera A first.",
            requires_camera_a: true,
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      // AUTO-RESOLVE: If first_render_upload_id wasn't provided but Camera A has output, use it
      if (!resolvedCameraAOutputId && cameraARender?.output_upload_id) {
        resolvedCameraAOutputId = cameraARender.output_upload_id;
        console.log(`[space-render] AUTO-RESOLVED Camera A output from DB: ${resolvedCameraAOutputId}`);
      }
      
      // FINAL VALIDATION: Camera B MUST have a resolved Camera A anchor
      if (!resolvedCameraAOutputId) {
        console.error(`[space-render] CRITICAL ERROR: Camera B has no Camera A anchor after all checks`);
        
        await serviceClient
          .from("floorplan_space_renders")
          .update({ 
            status: "blocked",
            qa_report: {
              error: "CAMERA_B_ANCHOR_MISSING",
              message: "Camera B prompt requires Camera A's output but none was found. This is a system error.",
              requires_camera_a: true,
            }
          })
          .eq("id", render_id);
        
        return new Response(
          JSON.stringify({ 
            error: "CAMERA_B_ANCHOR_MISSING",
            message: "Camera B requires Camera A's output but none was resolved. Please ensure Camera A is complete.",
            requires_camera_a: true,
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      console.log(`[space-render] ✓ Camera B will use Camera A anchor: ${resolvedCameraAOutputId}`);
    }

    // Update status based on mode
    await serviceClient
      .from("floorplan_space_renders")
      .update({ status: isInpaintMode ? "editing" : "generating" })
      .eq("id", render_id);

    // Update space status
    const statusField = render.kind === "A" ? "render_a_status" : "render_b_status";
    await serviceClient
      .from("floorplan_pipeline_spaces")
      .update({ [statusField]: isInpaintMode ? "editing" : "generating" })
      .eq("id", render.space_id);

    const spaceName = render.space?.name || space_metadata?.name || "Room";
    const spaceType = render.space?.space_type || space_metadata?.space_type || "room";
    const pipelineId = render.pipeline_id;
    
    console.log(`[space-render] ${isInpaintMode ? "EDITING (Inpaint)" : "Generating"} render ${render_id} (${render.kind}) for space ${spaceName}`);
    console.log(`[space-render] Space type: ${spaceType}`);
    if (isInpaintMode) {
      console.log(`[space-render] Source image: ${render.source_image_upload_id}`);
      console.log(`[space-render] User correction: ${user_correction_text || render.user_correction_text}`);
    }
    if (isKindB && resolvedCameraAOutputId) {
      console.log(`[space-render] Kind B grounded with Camera A output: ${resolvedCameraAOutputId}`);
    }
    
    // Emit start event
    await emitPipelineEvent(
      serviceClient, pipelineId, userId,
      isInpaintMode ? "edit_inpaint_started" : "render_start", 
      isInpaintMode 
        ? `✏ Editing render ${render.kind} for ${spaceName}...`
        : `Generating render ${render.kind} for ${spaceName}...`,
      10
    );

    // Fetch pipeline to get dimension analysis and quality settings
    const { data: pipeline } = await serviceClient
      .from("floorplan_pipelines")
      .select("step_outputs, output_resolution, aspect_ratio, quality_post_step4, floor_plan_upload_id")
      .eq("id", render.pipeline_id)
      .single();
    
    const stepOutputs = (pipeline?.step_outputs as Record<string, any>) || {};
    const dimensionAnalysis = stepOutputs.dimension_analysis || null;
    const actualFloorPlanId = floor_plan_upload_id || pipeline?.floor_plan_upload_id;
    
    // Quality settings
    const qualityPostStep4 = pipeline?.quality_post_step4 || pipeline?.output_resolution || "2K";
    const aspectRatio = pipeline?.aspect_ratio || "16:9";
    const validSizes = ["1K", "2K", "4K"];
    const imageSize = validSizes.includes(qualityPostStep4) ? qualityPostStep4 : "2K";
    
    console.log(`[space-render] Quality: ${imageSize}, Aspect: ${aspectRatio}`);

    // ═══════════════════════════════════════════════════════════════════════════
    // LOAD CAMERA MARKER + SPATIAL MAP FOR CONTEXT
    // ═══════════════════════════════════════════════════════════════════════════
    let cameraMarker: CameraMarker | null = null;
    let spatialMap: SpatialMap | null = null;
    
    // Load camera marker if linked to this render
    if (render.camera_marker_id) {
      const { data: marker } = await serviceClient
        .from("pipeline_camera_markers")
        .select("*")
        .eq("id", render.camera_marker_id)
        .single();
      
      if (marker) {
        cameraMarker = marker as CameraMarker;
        console.log(`[space-render] Loaded camera marker: ${cameraMarker.label}`);
        
        // ═══════════════════════════════════════════════════════════════════════════
        // MANDATORY ANCHOR SANITY GATE - Block if anchors not ready
        // ═══════════════════════════════════════════════════════════════════════════
        const typedMarker = marker as {
          anchor_status: string;
          anchor_base_plan_path: string | null;
          anchor_single_overlay_path: string | null;
          anchor_crop_overlay_path: string | null;
        };
        
        if (typedMarker.anchor_status !== "ready") {
          console.error(`[space-render] BLOCKED: Camera ${cameraMarker.label} anchor_status = ${typedMarker.anchor_status}`);
          
          await emitPipelineEvent(
            serviceClient, pipelineId, userId,
            "ANCHOR_GATE_BLOCKED", 
            `❌ Camera ${cameraMarker.label} anchor not ready (status: ${typedMarker.anchor_status})`,
            0
          );
          
          await serviceClient
            .from("floorplan_space_renders")
            .update({ 
              status: "blocked",
              qa_report: { 
                error: "ANCHOR_GATE_BLOCKED",
                message: `Camera anchor not ready. Status: ${typedMarker.anchor_status}`,
                required_action: "Create camera anchor before generating render",
              },
            })
            .eq("id", render_id);
          
          return new Response(
            JSON.stringify({ 
              error: "ANCHOR_GATE_BLOCKED",
              message: `Camera ${cameraMarker.label} anchor not ready (status: ${typedMarker.anchor_status})`,
              anchor_status: typedMarker.anchor_status,
              required_action: "Create camera anchor using the 'Create Anchor' button in Step 4",
            }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        
        // Verify all 3 anchor artifacts exist
        const missingArtifacts: string[] = [];
        if (!typedMarker.anchor_base_plan_path) missingArtifacts.push("base_plan_image");
        if (!typedMarker.anchor_single_overlay_path) missingArtifacts.push("plan_single_camera_overlay");
        if (!typedMarker.anchor_crop_overlay_path) missingArtifacts.push("space_crop_single_camera_overlay");
        
        if (missingArtifacts.length > 0) {
          console.error(`[space-render] BLOCKED: Missing anchor artifacts: ${missingArtifacts.join(", ")}`);
          
          await emitPipelineEvent(
            serviceClient, pipelineId, userId,
            "ANCHOR_ARTIFACTS_MISSING", 
            `❌ Camera ${cameraMarker.label} missing anchor artifacts: ${missingArtifacts.join(", ")}`,
            0
          );
          
          await serviceClient
            .from("floorplan_space_renders")
            .update({ 
              status: "blocked",
              qa_report: { 
                error: "ANCHOR_ARTIFACTS_MISSING",
                missing_artifacts: missingArtifacts,
                required_action: "Regenerate camera anchor",
              },
            })
            .eq("id", render_id);
          
          return new Response(
            JSON.stringify({ 
              error: "ANCHOR_ARTIFACTS_MISSING",
              message: `Camera ${cameraMarker.label} missing ${missingArtifacts.length} anchor artifact(s)`,
              missing_artifacts: missingArtifacts,
              required_action: "Regenerate camera anchor using the 'Create Anchor' button",
            }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        
        console.log(`[space-render] ✓ Anchor sanity gate passed for ${cameraMarker.label}`);
      }
    }
    
    // Load spatial map for adjacency context
    const { data: spatialMapData } = await serviceClient
      .from("pipeline_spatial_maps")
      .select("*")
      .eq("pipeline_id", pipelineId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    
    if (spatialMapData) {
      spatialMap = {
        id: spatialMapData.id,
        pipeline_id: spatialMapData.pipeline_id,
        version: spatialMapData.version || 1,
        rooms: (spatialMapData.rooms as any[]) || [],
        adjacency_graph: (spatialMapData.adjacency_graph as any[]) || [],
        locks_json: (spatialMapData.locks_json as any) || {},
      } as SpatialMap;
      console.log(`[space-render] Loaded spatial map v${spatialMap.version} with ${spatialMap.rooms.length} rooms`);
    }
    
    // Build camera context using the helper
    const cameraContext = buildCameraContext(
      cameraMarker,
      spatialMap,
      render.space_id,
      spaceName,
      spaceType
    );
    
    console.log(`[space-render] Camera context built:`, {
      hasMarker: !!cameraMarker,
      hasSpatialMap: !!spatialMap,
      adjacentRooms: cameraContext.adjacencyJson
    });
    
    // ═══════════════════════════════════════════════════════════════════════════
    // LOAD ANCHOR IMAGES FOR NANOBANANA PROMPT
    // ═══════════════════════════════════════════════════════════════════════════
    let anchorBasePlanBase64: string | null = null;
    let anchorSingleOverlayBase64: string | null = null;
    let anchorCropOverlayBase64: string | null = null;
    
    if (cameraMarker) {
      const typedMarker = cameraMarker as unknown as {
        anchor_base_plan_path: string | null;
        anchor_single_overlay_path: string | null;
        anchor_crop_overlay_path: string | null;
      };
      
      // Load anchor images from storage
      try {
        const loadAnchorImage = async (path: string | null): Promise<string | null> => {
          if (!path) return null;
          try {
            const { data, error } = await serviceClient.storage
              .from("outputs")
              .download(path);
            if (error || !data) return null;
            const arrayBuffer = await data.arrayBuffer();
            const bytes = new Uint8Array(arrayBuffer);
            // Convert to base64
            let binary = '';
            for (let i = 0; i < bytes.length; i++) {
              binary += String.fromCharCode(bytes[i]);
            }
            return btoa(binary);
          } catch {
            return null;
          }
        };
        
        [anchorBasePlanBase64, anchorSingleOverlayBase64, anchorCropOverlayBase64] = await Promise.all([
          loadAnchorImage(typedMarker.anchor_base_plan_path),
          loadAnchorImage(typedMarker.anchor_single_overlay_path),
          loadAnchorImage(typedMarker.anchor_crop_overlay_path),
        ]);
        
        console.log(`[space-render] Anchor images loaded: base=${!!anchorBasePlanBase64}, overlay=${!!anchorSingleOverlayBase64}, crop=${!!anchorCropOverlayBase64}`);
      } catch (anchorLoadError) {
        console.error(`[space-render] Failed to load anchor images: ${anchorLoadError}`);
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // LOAD SCAN CROP IMAGE (label-detected region crop from Camera Scan)
    // ═══════════════════════════════════════════════════════════════════════════
    let scanCropBase64: string | null = null;
    let scanCropPromptHint: string | null = null;
    let scanDetectedLabel: string | null = null;
    
    if (render.camera_marker_id) {
      try {
        // Get latest scan for this pipeline
        const { data: latestScan } = await serviceClient
          .from("pipeline_camera_scans")
          .select("id")
          .eq("pipeline_id", pipelineId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        
        if (latestScan) {
          // Get scan item for this marker
          const { data: scanItem } = await serviceClient
            .from("pipeline_camera_scan_items")
            .select("*")
            .eq("scan_id", latestScan.id)
            .eq("marker_id", render.camera_marker_id)
            .maybeSingle();
          
          if (scanItem) {
            scanDetectedLabel = scanItem.detected_room_label || null;
            scanCropPromptHint = scanItem.prompt_hint_text || null;
            
            // Load crop image if available
            if (scanItem.crop_storage_path) {
              try {
                const { data: cropData, error: cropError } = await serviceClient.storage
                  .from("outputs")
                  .download(scanItem.crop_storage_path);
                
                if (!cropError && cropData) {
                  const arrayBuffer = await cropData.arrayBuffer();
                  const bytes = new Uint8Array(arrayBuffer);
                  let binary = '';
                  for (let i = 0; i < bytes.length; i++) {
                    binary += String.fromCharCode(bytes[i]);
                  }
                  scanCropBase64 = btoa(binary);
                  console.log(`[space-render] Scan crop loaded for marker ${render.camera_marker_id}`);
                }
              } catch (cropLoadError) {
                console.log(`[space-render] Could not load scan crop: ${cropLoadError}`);
              }
            }
            
            if (scanDetectedLabel) {
              console.log(`[space-render] Detected label from scan: "${scanDetectedLabel}"`);
            }
          }
        }
      } catch (scanError) {
        console.log(`[space-render] Could not fetch scan data: ${scanError}`);
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // INPAINT MODE: Load source image and build edit prompt
    // ═══════════════════════════════════════════════════════════════════════════
    let contentParts: any[] = [];
    let finalPrompt: string;

    if (isInpaintMode) {
      console.log(`[space-render] INPAINT MODE - Loading source image...`);
      
      await emitPipelineEvent(
        serviceClient, pipelineId, userId,
        "edit_inpaint_fetching", 
        `Loading source image for editing ${spaceName} (${render.kind})...`,
        15
      );

      // Fetch the source image (the one we're editing)
      const sourceImageId = render.source_image_upload_id;
      const { base64: sourceImageBase64, mimeType: sourceMimeType } = await fetchImageAsBase64(serviceClient, sourceImageId);

      await emitPipelineEvent(
        serviceClient, pipelineId, userId,
        "edit_inpaint_fetching", 
        `Source image loaded for ${spaceName} (${render.kind})`,
        20
      );

      // Build minimal-change edit prompt
      const correctionText = user_correction_text || render.user_correction_text || "";
      finalPrompt = `Edit this interior render image according to the following instructions:

USER REQUESTED CHANGE: ${correctionText}

CRITICAL CONSTRAINTS - YOU MUST FOLLOW THESE:
- Apply ONLY the requested changes - nothing else
- Preserve the EXACT camera angle and perspective
- Maintain all furniture positions and styles NOT mentioned in the change request
- Keep the same lighting conditions and style
- Do NOT change the room layout or architecture
- Do NOT add or remove walls, doors, or windows
- Preserve all materials and colors NOT mentioned

ROOM CONTEXT:
Space Name: ${spaceName}
Space Type: ${spaceType}

Generate a high-quality edited image that applies ONLY the requested changes while preserving everything else.`;

      contentParts = [
        { text: finalPrompt },
        { text: "\n\nSOURCE IMAGE (Apply edits to this image):" },
        { inlineData: { mimeType: sourceMimeType, data: sourceImageBase64 } },
      ];

      await emitPipelineEvent(
        serviceClient, pipelineId, userId,
        "edit_inpaint_api_call", 
        `Sending edit request for ${spaceName} (${render.kind}) to AI...`,
        30
      );

    } else {
      // ═══════════════════════════════════════════════════════════════════════════
      // NORMAL GENERATION MODE
      // ═══════════════════════════════════════════════════════════════════════════
      
      // Fetch styled image (required for generation)
      await emitPipelineEvent(
        serviceClient, pipelineId, userId,
        "download_start", 
        `Loading styled image for ${spaceName}...`,
        15
      );
      const { base64: styledImageBase64, mimeType: styledMimeType } = await fetchImageAsBase64(serviceClient, styled_image_upload_id);
      
      await emitPipelineEvent(
        serviceClient, pipelineId, userId,
        "download_complete", 
        `Styled image loaded for ${spaceName}`,
        20
      );

      // Build scale constraints and room-type rules
      const scaleConstraints = buildRenderScaleConstraints(dimensionAnalysis, spaceType);
      const roomTypeRules = getRoomTypeRules(spaceType);

      // ═══════════════════════════════════════════════════════════════════════════
      // BUILD VISUAL CAMERA ANCHOR (mandatory for all camera renders)
      // ═══════════════════════════════════════════════════════════════════════════
      let visualCameraAnchorPrompt = "";
      let cameraOverlayDescription = "";
      
      if (cameraMarker) {
        const cameraKind = render.kind as "A" | "B";
        
        // Build the visual anchor prompt text
        visualCameraAnchorPrompt = buildCameraAnchorPromptText(
          cameraMarker as unknown as CameraMarkerData,
          cameraKind,
          spaceName
        );
        
        // Get overlay description (text-based since we can't do image compositing in Deno)
        // This describes exactly where the camera is positioned
        const overlayInfo = createCameraOverlayDescription(
          cameraMarker as unknown as CameraMarkerData,
          cameraKind,
          spaceName,
          1920, // Assume standard image dimensions
          1080
        );
        cameraOverlayDescription = overlayInfo.description;
        
        console.log(`[space-render] Visual camera anchor built for ${cameraKind}: ${cameraMarker.label}`);
      } else {
        visualCameraAnchorPrompt = `
═══════════════════════════════════════════════════════════════
CAMERA CONTEXT (No camera marker available)
═══════════════════════════════════════════════════════════════
Generate a natural eye-level view of ${spaceName}.
Camera height: 1.5-1.7 meters
Direction: Looking into the main area of the space
═══════════════════════════════════════════════════════════════
`;
      }

      if (isKindB && resolvedCameraAOutputId) {
        // ═══════════════════════════════════════════════════════════════════════════
        // KIND B: MANDATORY GROUNDING in Camera A's output + floor plan + VISUAL ANCHORS
        // Camera B CANNOT run without Camera A's output - enforced by dependency gate above
        // CRITICAL: This is the ONLY valid path for Camera B generation
        // ═══════════════════════════════════════════════════════════════════════════
        console.log(`[space-render] Building ANCHORED Kind B prompt (grounded in Camera A: ${resolvedCameraAOutputId})`);
        
        await emitPipelineEvent(
          serviceClient, pipelineId, userId,
          "grounding_start", 
          `Loading Camera A output for anchoring ${spaceName} (B)...`,
          25
        );

        // Fetch Camera A's output image (MANDATORY anchor)
        const { base64: cameraAOutputBase64, mimeType: cameraAMimeType } = await fetchImageAsBase64(serviceClient, resolvedCameraAOutputId);
        console.log(`[space-render] ✓ Camera A output loaded as visual anchor`);
        
        // Optionally fetch floor plan for additional grounding
        let floorPlanBase64: string | null = null;
        let floorPlanMimeType: string = "image/jpeg";
        if (actualFloorPlanId) {
          try {
            const fpData = await fetchImageAsBase64(serviceClient, actualFloorPlanId);
            floorPlanBase64 = fpData.base64;
            floorPlanMimeType = fpData.mimeType;
            console.log(`[space-render] Floor plan loaded for grounding`);
          } catch (e) {
            console.log(`[space-render] Could not load floor plan: ${e}`);
          }
        }

        await emitPipelineEvent(
          serviceClient, pipelineId, userId,
          "grounding_complete", 
          `Camera A anchor loaded for ${spaceName} (B) - generating opposite view`,
          30
        );

        // ═══════════════════════════════════════════════════════════════════════════
        // LOAD CENTRALIZED OPPOSITE-VIEW TEMPLATE FROM DATABASE
        // This template is generated once by AI and reused for all Camera B renders
        // ═══════════════════════════════════════════════════════════════════════════
        console.log(`[space-render] Loading centralized opposite-view template...`);
        const oppositeViewTemplate = await getOppositeViewTemplate(serviceClient);
        
        // Extract camera position data for template instantiation
        const cameraPosition = cameraMarker 
          ? `(${cameraMarker.x_norm.toFixed(4)}, ${cameraMarker.y_norm.toFixed(4)})` 
          : "(center of space)";
        const yawDeg = cameraMarker?.yaw_deg || 0;
        const cameraAYaw = (yawDeg + 180) % 360; // Camera A was opposite
        const yawOppositeDesc = `${yawDeg.toFixed(1)}° (Camera A was ${cameraAYaw.toFixed(1)}°)`;
        
        // Instantiate template with runtime values
        finalPrompt = instantiateOppositeViewTemplate(oppositeViewTemplate, {
          camera_position: cameraPosition,
          yaw_opposite: yawOppositeDesc,
          floor_plan: "See attached styled top-down image and floor plan overlays below",
          image_A: "See CAMERA A OUTPUT image below - YOUR PRIMARY VISUAL ANCHOR",
          constraints: roomTypeRules + "\n\n" + scaleConstraints + "\n\n" + cameraContext.fullContextBlock,
          space_name: spaceName,
          space_type: spaceType,
        });
        
        // Append visual camera anchor info and camera overlay description
        finalPrompt += `\n\n${visualCameraAnchorPrompt}\n\n${cameraOverlayDescription}`;
        
        console.log(`[space-render] ✓ Opposite-view template instantiated for ${spaceName} (B)`);

        // Build content parts - Camera A output is FIRST and MOST IMPORTANT
        contentParts = [
          { text: finalPrompt },
        ];
        
        // ═══════════════════════════════════════════════════════════════════════════
        // CAMERA A OUTPUT - PRIMARY ANCHOR (Must be first image for maximum grounding)
        // ═══════════════════════════════════════════════════════════════════════════
        contentParts.push({ text: `
═══════════════════════════════════════════════════════════════
🎯 CAMERA A OUTPUT - YOUR PRIMARY ANCHOR (MANDATORY)
═══════════════════════════════════════════════════════════════
This is the view from Camera A. You MUST generate the 180° opposite
view of this EXACT room. Study this image carefully:
- Same furniture items (visible from opposite angle)
- Same materials and colors
- Same lighting conditions
- Same room type and architecture

Generate the view as if you turned around 180° from this position.` });
        contentParts.push({ inlineData: { mimeType: cameraAMimeType, data: cameraAOutputBase64 } });
        
        // ═══════════════════════════════════════════════════════════════════════════
        // ADD CAMERA ANCHOR SCREENSHOTS (SECONDARY - for position/direction)
        // ═══════════════════════════════════════════════════════════════════════════
        if (anchorBasePlanBase64) {
          contentParts.push({ text: "\n\n📍 VISUAL ANCHOR #1 - BASE FLOOR PLAN (Clean plan with room labels):" });
          contentParts.push({ inlineData: { mimeType: "image/png", data: anchorBasePlanBase64 } });
        }
        
        if (anchorSingleOverlayBase64) {
          contentParts.push({ text: "\n\n📍 VISUAL ANCHOR #2 - CAMERA B OVERLAY (Follow this direction EXACTLY - 180° from A):" });
          contentParts.push({ inlineData: { mimeType: "image/png", data: anchorSingleOverlayBase64 } });
        }
        
        if (anchorCropOverlayBase64) {
          contentParts.push({ text: "\n\n📍 VISUAL ANCHOR #3 - SPACE CROP (Same space as Camera A, opposite direction):" });
          contentParts.push({ inlineData: { mimeType: "image/png", data: anchorCropOverlayBase64 } });
        }
        
        // Add scan crop (label-detected region from Camera Scan)
        if (scanCropBase64) {
          const labelNote = scanDetectedLabel 
            ? `Focus on the "${scanDetectedLabel}" area - ` 
            : "";
          contentParts.push({ text: `\n\n🎯 SCAN CROP - TARGET AREA (${labelNote}Same space as Camera A):` });
          contentParts.push({ inlineData: { mimeType: "image/png", data: scanCropBase64 } });
          if (scanCropPromptHint) {
            contentParts.push({ text: `\n   Prompt hint: ${scanCropPromptHint}` });
          }
        }
        
        // Add styled image reference
        contentParts.push({ text: "\n\n🎨 STYLED TOP-DOWN VIEW (Reference for materials and layout):" });
        contentParts.push({ inlineData: { mimeType: styledMimeType, data: styledImageBase64 } });

      } else if (!isKindB) {
        // ═══════════════════════════════════════════════════════════════════════════
        // KIND A ONLY: Standard generation with VISUAL CAMERA ANCHORS
        // CRITICAL: This branch is NEVER used for Camera B - Camera B is handled above
        // ═══════════════════════════════════════════════════════════════════════════
        
        // Fetch floor plan for visual anchor
        let floorPlanBase64: string | null = null;
        let floorPlanMimeType: string = "image/jpeg";
        if (actualFloorPlanId) {
          try {
            const fpData = await fetchImageAsBase64(serviceClient, actualFloorPlanId);
            floorPlanBase64 = fpData.base64;
            floorPlanMimeType = fpData.mimeType;
            console.log(`[space-render] Floor plan loaded for visual anchor`);
          } catch (e) {
            console.log(`[space-render] Could not load floor plan: ${e}`);
          }
        }
        
        finalPrompt = RENDER_PROMPT_TEMPLATE_A
          .replace("{space_name}", spaceName)
          .replace("{space_type}", spaceType)
          .replace("{VISUAL_CAMERA_ANCHOR}", visualCameraAnchorPrompt)
          .replace("{CAMERA_CONTEXT}", cameraContext.fullContextBlock + "\n" + cameraOverlayDescription)
          .replace("{SCALE_CONSTRAINTS}", scaleConstraints)
          .replace("{ROOM_TYPE_RULES}", roomTypeRules);

        contentParts = [
          { text: finalPrompt },
        ];
        
        // ═══════════════════════════════════════════════════════════════════════════
        // ADD CAMERA ANCHOR SCREENSHOTS (MANDATORY - PRIMARY SOURCE OF TRUTH)
        // ═══════════════════════════════════════════════════════════════════════════
        if (anchorBasePlanBase64) {
          contentParts.push({ text: "\n\n📍 VISUAL ANCHOR #1 - BASE FLOOR PLAN (Clean plan with room labels, NO camera markers):" });
          contentParts.push({ inlineData: { mimeType: "image/png", data: anchorBasePlanBase64 } });
        }
        
        if (anchorSingleOverlayBase64) {
          contentParts.push({ text: "\n\n📍 VISUAL ANCHOR #2 - CAMERA OVERLAY (ONLY Camera A visible - follow this direction EXACTLY):" });
          contentParts.push({ inlineData: { mimeType: "image/png", data: anchorSingleOverlayBase64 } });
        }
        
        if (anchorCropOverlayBase64) {
          contentParts.push({ text: "\n\n📍 VISUAL ANCHOR #3 - SPACE CROP (Target space with camera position - render this view):" });
          contentParts.push({ inlineData: { mimeType: "image/png", data: anchorCropOverlayBase64 } });
        }
        
        // Add scan crop (label-detected region from Camera Scan)
        if (scanCropBase64) {
          const labelNote = scanDetectedLabel 
            ? `Focus on the "${scanDetectedLabel}" area - ` 
            : "";
          contentParts.push({ text: `\n\n🎯 SCAN CROP - TARGET AREA (${labelNote}This is the specific region to render):` });
          contentParts.push({ inlineData: { mimeType: "image/png", data: scanCropBase64 } });
          if (scanCropPromptHint) {
            contentParts.push({ text: `\n   Prompt hint: ${scanCropPromptHint}` });
          }
        }
        
        // Add styled image reference (for materials and layout)
        contentParts.push({ text: "\n\n🎨 STYLED TOP-DOWN VIEW (Reference for materials, layout, and furniture positions):" });
        contentParts.push({ inlineData: { mimeType: styledMimeType, data: styledImageBase64 } });
      } else {
        // ═══════════════════════════════════════════════════════════════════════════
        // UNREACHABLE: Camera B without anchor should have been blocked earlier
        // This is a safety net - should never execute if dependency gate works correctly
        // ═══════════════════════════════════════════════════════════════════════════
        console.error(`[space-render] CRITICAL ERROR: Camera B (${render_id}) reached prompt building without anchor`);
        
        await serviceClient
          .from("floorplan_space_renders")
          .update({ 
            status: "failed",
            qa_report: {
              error: "CAMERA_B_TEMPLATE_VIOLATION",
              message: "Camera B prompt building reached without Camera A anchor. This is a system error.",
            }
          })
          .eq("id", render_id);
        
        return new Response(
          JSON.stringify({ 
            error: "CAMERA_B_TEMPLATE_VIOLATION",
            message: "Camera B cannot be rendered without Camera A anchor. This should not happen.",
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } // End of normal generation mode

    // ═══════════════════════════════════════════════════════════════════════════
    // LOG THE 3-IMAGE BUNDLE FOR TRACEABILITY
    // ═══════════════════════════════════════════════════════════════════════════
    const imageBundle = {
      anchor_base_plan: !!anchorBasePlanBase64,
      anchor_single_overlay: !!anchorSingleOverlayBase64,
      anchor_crop_overlay: !!anchorCropOverlayBase64,
      scan_crop: !!scanCropBase64,
      scan_detected_label: scanDetectedLabel,
      camera_marker_id: render.camera_marker_id,
      camera_label: cameraMarker?.label || null,
      camera_kind: render.kind,
      yaw_deg: cameraMarker?.yaw_deg,
      fov_deg: cameraMarker?.fov_deg,
    };
    
    console.log(`[space-render] 📦 IMAGE BUNDLE for ${spaceName} (${render.kind}):`, JSON.stringify(imageBundle, null, 2));
    
    // Count total images being sent
    const imageCount = [
      anchorBasePlanBase64,
      anchorSingleOverlayBase64,
      anchorCropOverlayBase64,
      scanCropBase64,
    ].filter(Boolean).length + 1; // +1 for styled image
    
    console.log(`[space-render] Total images in request: ${imageCount} (anchors: ${[anchorBasePlanBase64, anchorSingleOverlayBase64, anchorCropOverlayBase64].filter(Boolean).length}, scan crop: ${scanCropBase64 ? 1 : 0}, styled: 1)`);

    // ═══════════════════════════════════════════════════════════════════════
    // LANGFUSE: Wrap image generation with generation logging
    // ═══════════════════════════════════════════════════════════════════════
    console.log(`[space-render] API Request: Model=gemini-3-pro-image-preview, Size=${imageSize}, Ratio=${aspectRatio}`);

    await emitPipelineEvent(
      serviceClient, pipelineId, userId,
      "api_request", 
      `Sending ${spaceName} (${render.kind}) to AI (${imageSize})...`,
      40
    );

    const attemptIdx = render.attempt_count || 1;
    
    const generationResult = await wrapModelGeneration({
      traceId: pipelineId,
      generationName: STEP_5_GENERATIONS.RENDER_GEN,
      model: "gemini-3-pro-image-preview",
      metadata: {
        project_id: pipelineId,
        pipeline_id: pipelineId,
        step_number: 5,
        sub_step: `render_${render.kind}`,
        room_id: render.space_id,
        room_name: spaceName,
        camera_id: cameraMarker?.id || undefined,
        attempt_index: attemptIdx,
        model_name: "gemini-3-pro-image-preview",
      },
      promptInfo: {
        name: render.kind === "A" ? "render_prompt_template_a" : "render_prompt_template_b",
        source: "code",
      },
      finalPromptText: finalPrompt || "Render generation",
      variables: {
        space_name: spaceName,
        space_type: spaceType,
        render_kind: render.kind,
        image_size: imageSize,
        aspect_ratio: aspectRatio,
        image_count: imageCount,
      },
      requestParams: {
        temperature: 0.7,
        imageSize,
        aspectRatio,
      },
      imageCount,
    }, async () => {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${API_NANOBANANA}`;
      
      const geminiResponse = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: contentParts }],
          generationConfig: {
            responseModalities: ["IMAGE"],
            temperature: 0.7,
            imageConfig: {
              aspectRatio: aspectRatio,
              imageSize: imageSize,
            },
          },
        }),
      });

      if (!geminiResponse.ok) {
        const errorText = await geminiResponse.text();
        throw new Error(`Gemini API error: ${geminiResponse.status} - ${errorText}`);
      }

      return await geminiResponse.json();
    });
    
    if (!generationResult.success || !generationResult.data) {
      console.error(`[space-render] Gemini error: ${generationResult.error?.message}`);
      
      await emitPipelineEvent(
        serviceClient, pipelineId, userId,
        "api_error", 
        `AI error for ${spaceName} (${render.kind}): ${generationResult.error?.message || "Unknown error"}`,
        0
      );
      
      await serviceClient
        .from("floorplan_space_renders")
        .update({ status: "failed", qa_report: { error: generationResult.error?.message } })
        .eq("id", render_id);
      
      throw generationResult.error || new Error("Image generation failed");
    }

    const geminiData = generationResult.data as any;
    console.log(`[space-render] Gemini response received (${generationResult.timingMs}ms, gen_id: ${generationResult.generationId})`);
    
    await emitPipelineEvent(
      serviceClient, pipelineId, userId,
      "api_complete", 
      `AI generated render for ${spaceName} (${render.kind})`,
      60
    );

    // Extract generated image
    let generatedImageData: string | null = null;
    let generatedMimeType = "image/png";

    const candidates = geminiData.candidates || [];
    for (const candidate of candidates) {
      for (const part of candidate.content?.parts || []) {
        if (part.inlineData?.data) {
          generatedImageData = part.inlineData.data;
          generatedMimeType = part.inlineData.mimeType || "image/png";
          break;
        }
      }
      if (generatedImageData) break;
    }

    if (!generatedImageData) {
      console.error(`[space-render] No image in response`);
      await emitPipelineEvent(
        serviceClient, pipelineId, userId,
        "api_error", 
        `No image generated for ${spaceName} (${render.kind})`,
        0
      );
      await serviceClient
        .from("floorplan_space_renders")
        .update({ status: "failed", qa_report: { error: "No image generated" } })
        .eq("id", render_id);
      throw new Error("No image generated by Gemini");
    }

    // Upload to storage
    const ext = generatedMimeType.includes("png") ? "png" : "jpg";
    const outputPath = `${userId}/space_renders/${render_id}_${Date.now()}.${ext}`;
    const imageBytes = Uint8Array.from(atob(generatedImageData), (c) => c.charCodeAt(0));
    const fileSizeMB = (imageBytes.length / 1024 / 1024).toFixed(2);
    
    console.log(`[space-render] Output: ${fileSizeMB} MB, ${generatedMimeType}`);
    
    await emitPipelineEvent(
      serviceClient, pipelineId, userId,
      "upload_start", 
      `Saving render for ${spaceName} (${render.kind})...`,
      70
    );

    const { error: uploadError } = await serviceClient.storage
      .from("outputs")
      .upload(outputPath, imageBytes, {
        contentType: generatedMimeType,
        upsert: true,
      });

    if (uploadError) {
      await emitPipelineEvent(
        serviceClient, pipelineId, userId,
        "upload_error", 
        `Failed to save render for ${spaceName}: ${uploadError.message}`,
        0
      );
      throw new Error(`Failed to upload: ${uploadError.message}`);
    }

    // Create upload record
    const { data: uploadRecord, error: uploadRecordError } = await serviceClient
      .from("uploads")
      .insert({
        project_id: render.space?.pipeline_id ? 
          (await serviceClient.from("floorplan_pipelines").select("project_id").eq("id", render.pipeline_id).single()).data?.project_id : 
          null,
        owner_id: userId,
        kind: "output",
        bucket: "outputs",
        path: outputPath,
        original_filename: `space_render_${spaceName}_${render.kind}.${ext}`,
        mime_type: generatedMimeType,
        size_bytes: imageBytes.length,
      })
      .select()
      .single();

    if (uploadRecordError) {
      throw new Error(`Failed to create upload record: ${uploadRecordError.message}`);
    }
    
    await emitPipelineEvent(
      serviceClient, pipelineId, userId,
      "upload_complete", 
      `Render saved for ${spaceName} (${render.kind}) - ${fileSizeMB} MB`,
      85
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // RUN QA CHECK with visual validation and auto-retry support
    // ═══════════════════════════════════════════════════════════════════════════
    await emitPipelineEvent(
      serviceClient, pipelineId, userId,
      "qa_start", 
      `Running QA for ${spaceName} (${render.kind})...`,
      90
    );

    let qaPass = false;
    let qaResult: Record<string, unknown> = {};
    const currentAttempt = render.attempt_count || 1;

    try {
      const qaResponse = await fetch(`${SUPABASE_URL}/functions/v1/run-qa-check`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          upload_id: uploadRecord.id,
          qa_type: "render",
          source_upload_id: isKindB && first_render_upload_id ? first_render_upload_id : null,
          floor_plan_upload_id: actualFloorPlanId,
          // CRITICAL: Step 3 output for mandatory structural comparison
          step3_output_upload_id: styled_image_upload_id,
          space_type: spaceType,
          space_name: spaceName,
          render_kind: render.kind,
          change_request: `Verify this is a ${spaceType} with appropriate fixtures. Room type MUST match. Structure MUST match Step 3.`,
          // Asset tracking for auto-retry
          asset_id: render_id,
          asset_type: "render",
          current_attempt: currentAttempt,
        }),
      });

      if (qaResponse.ok) {
        qaResult = await qaResponse.json();
        qaPass = qaResult.pass as boolean || false;
        console.log(`[space-render] QA Result: pass=${qaPass}, score=${qaResult.score}`);
        console.log(`[space-render] Room type violation: ${qaResult.room_type_violation}`);
        console.log(`[space-render] Structural violation: ${qaResult.structural_violation}`);
        
        const qaStatus = qaPass ? "passed" : "failed";
        
        await serviceClient
          .from("floorplan_space_renders")
          .update({
            qa_status: qaStatus,
            structured_qa_result: qaResult,
            qa_report: qaResult,
            // Store camera context for debugging/QA
            camera_label: cameraMarker?.label || null,
            final_composed_prompt: finalPrompt?.substring(0, 4000), // Truncate for safety
            adjacency_context: cameraContext.adjacencyJson,
          })
          .eq("id", render_id);

        await emitPipelineEvent(
          serviceClient, pipelineId, userId,
          qaPass ? "qa_passed" : "qa_failed", 
          qaPass 
            ? `✓ QA passed for ${spaceName} (${render.kind}): Score ${qaResult.score}`
            : `✗ QA failed for ${spaceName} (${render.kind}): ${(qaResult.issues as Array<{description: string}>)?.[0]?.description || "Quality issues detected"}`,
          95
        );

        // Check if auto-retry was triggered
        if (!qaPass && qaResult.auto_retry) {
          const autoRetry = qaResult.auto_retry as { triggered: boolean; blocked_for_human: boolean; message: string };
          if (autoRetry.triggered) {
            await emitPipelineEvent(
              serviceClient, pipelineId, userId,
              "auto_retry_triggered", 
              `↻ Auto-retry triggered for ${spaceName} (${render.kind}): ${autoRetry.message}`,
              0
            );
          } else if (autoRetry.blocked_for_human) {
            await emitPipelineEvent(
              serviceClient, pipelineId, userId,
              "blocked_for_human", 
              `⚠ ${spaceName} (${render.kind}) blocked after max attempts - manual review required`,
              0
            );
          }
        }
      } else {
        console.log(`[space-render] QA call failed, continuing without QA`);
      }
    } catch (qaError) {
      console.error(`[space-render] QA error: ${qaError}`);
    }

    // Update render record with camera info
    await serviceClient
      .from("floorplan_space_renders")
      .update({
        status: "needs_review",
        output_upload_id: uploadRecord.id,
        prompt_text: custom_prompt || render.prompt_text,
        model: "gemini-3-pro-image-preview",
        quality: imageSize,
        ratio: aspectRatio,
        attempt_index: (render.attempt_index || 0) + 1,
        // Camera and context fields
        camera_marker_id: cameraMarker?.id || null,
        camera_label: cameraMarker?.label || null,
        final_composed_prompt: finalPrompt?.substring(0, 4000), // Truncate for safety
        adjacency_context: cameraContext.adjacencyJson,
      })
      .eq("id", render_id);

    // Update space status
    await serviceClient
      .from("floorplan_pipeline_spaces")
      .update({ [statusField]: "needs_review" })
      .eq("id", render.space_id);

    console.log(`[space-render] Render ${render_id} completed successfully`);
    
    await emitPipelineEvent(
      serviceClient, pipelineId, userId,
      "render_complete", 
      `✓ ${spaceName} (${render.kind}) render complete`,
      100
    );

    return new Response(
      JSON.stringify({
        success: true,
        render_id,
        output_upload_id: uploadRecord.id,
        status: "needs_review",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[space-render] Error: ${message}`);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
