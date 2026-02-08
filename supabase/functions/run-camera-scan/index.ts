import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import {
  ensurePipelineTrace,
  wrapModelGeneration,
  logSimpleGeneration,
  flushLangfuse,
} from "../_shared/langfuse-generation-wrapper.ts";
import { STEP_3_2_GENERATIONS } from "../_shared/langfuse-constants.ts";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CAMERA SCAN - AI-POWERED LABEL DETECTION + CROP GENERATION
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * This scan now uses AI vision (Gemini) to:
 * 1. Detect room labels/text from the floor plan image near each marker
 * 2. Generate temporary crop images centered on each marker's target area
 * 3. Store crops in storage + scan_items table
 * 
 * The crops are used as visual anchors for Nano Banana generation.
 * Crops are temporary and deleted after renders are approved.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const API_NANOBANANA = Deno.env.get("API_NANOBANANA");

interface PanoramaPoint {
  id: string;
  x_norm: number;
  y_norm: number;
  yaw_deg: number;
  fov_deg: number;
  label: string;
  room_id: string | null;
  room_name: string | null;
}

interface RoomInfo {
  id: string;
  name: string;
  space_type: string;
  bounds_note?: string;
}

interface EmbeddedCameraContext {
  camera_slot: "A" | "B";
  yaw_deg: number;
  direction_context: {
    primary_view_target: string;
    likely_visible_adjacent_rooms: Array<{ room_id: string; room_name: string; confidence: number }>;
    likely_visible_openings: Array<{ type: string; side: string; confidence: number }>;
  };
  prompt_hints: string[];
  warnings: string[];
}

interface PanoramaPointScanResult {
  panorama_point_id: string;
  panorama_point_label: string;
  normalized_position: { x_norm: number; y_norm: number };
  fov_deg: number;
  room_validation: {
    bound_room_id: string | null;
    ai_room_id: string | null;
    match: boolean;
    confidence: number;
  };
  embedded_cameras: [EmbeddedCameraContext, EmbeddedCameraContext];
  global_rules: {
    forbid_new_rooms: boolean;
    forbid_new_openings: boolean;
    allowed_adjacent_rooms: string[];
  };
  // New: OCR/label detection results
  detected_label?: {
    text: string;
    confidence: number;
    bbox_norm?: { x: number; y: number; w: number; h: number };
  };
  crop_url?: string;
}

interface LabelDetectionResult {
  marker_id: string;
  detected_label: string | null;
  confidence: number;
  bbox_norm: { x: number; y: number; w: number; h: number } | null;
  prompt_hint: string;
}

async function computeVersionHash(points: PanoramaPoint[]): Promise<string> {
  const sortedPoints = [...points].sort((a, b) => a.id.localeCompare(b.id));
  const hashInput = JSON.stringify(sortedPoints.map(p => ({
    id: p.id,
    x_norm: p.x_norm,
    y_norm: p.y_norm,
    yaw_deg: p.yaw_deg,
    fov_deg: p.fov_deg,
    room_id: p.room_id,
  })));
  const encoder = new TextEncoder();
  const data = encoder.encode(hashInput);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("").substring(0, 32);
}

function getDirectionFromYaw(yaw: number): string {
  const normalizedYaw = ((yaw % 360) + 360) % 360;
  
  if (normalizedYaw >= 337.5 || normalizedYaw < 22.5) return "right (east)";
  if (normalizedYaw >= 22.5 && normalizedYaw < 67.5) return "down-right (southeast)";
  if (normalizedYaw >= 67.5 && normalizedYaw < 112.5) return "down (south)";
  if (normalizedYaw >= 112.5 && normalizedYaw < 157.5) return "down-left (southwest)";
  if (normalizedYaw >= 157.5 && normalizedYaw < 202.5) return "left (west)";
  if (normalizedYaw >= 202.5 && normalizedYaw < 247.5) return "up-left (northwest)";
  if (normalizedYaw >= 247.5 && normalizedYaw < 292.5) return "up (north)";
  return "up-right (northeast)";
}

function buildCameraContext(
  point: PanoramaPoint,
  cameraSlot: "A" | "B",
  yaw: number,
  roomInfo: RoomInfo | null,
  adjacentRooms: Array<{ id: string; name: string }>,
  edges: Array<{ from: string; to: string; connection_type: string }>,
  detectedLabel?: string
): EmbeddedCameraContext {
  const directionDesc = getDirectionFromYaw(yaw);
  const warnings: string[] = [];
  const promptHints: string[] = [];

  // Use detected label if available
  const labelToUse = detectedLabel || roomInfo?.name;

  if (roomInfo) {
    const roomType = roomInfo.space_type.toLowerCase();
    
    if (roomType.includes("bedroom")) {
      promptHints.push("Bedroom interior with bed, wardrobe, and personal items");
      promptHints.push("Cozy residential sleeping area");
    } else if (roomType.includes("living") || roomType.includes("lounge")) {
      promptHints.push("Living room with seating area and entertainment");
      promptHints.push("Main social gathering space");
    } else if (roomType.includes("kitchen")) {
      promptHints.push("Kitchen with cabinets, appliances, and countertops");
      promptHints.push("Functional cooking and food preparation area");
    } else if (roomType.includes("bathroom") || roomType.includes("wc") || roomType.includes("toilet")) {
      promptHints.push("Bathroom with sanitary fixtures");
      promptHints.push("Tiled wet room with appropriate fixtures");
    } else if (roomType.includes("dining")) {
      promptHints.push("Dining area with table and chairs");
      promptHints.push("Eating and gathering space");
    } else if (roomType.includes("hall") || roomType.includes("corridor") || roomType.includes("entry")) {
      promptHints.push("Hallway or corridor connecting rooms");
      promptHints.push("Transition space with doors and pathways");
    } else if (roomType.includes("office") || roomType.includes("study")) {
      promptHints.push("Home office or study with desk and shelving");
      promptHints.push("Work or reading space");
    } else {
      promptHints.push(`Interior view of ${labelToUse || roomInfo.name}`);
    }
  } else {
    promptHints.push("Interior space view");
    warnings.push("Room binding is missing - prompt generation may be less specific");
  }

  // Add detected label hint
  if (detectedLabel) {
    promptHints.push(`Focus on the area labeled "${detectedLabel}" on the floor plan`);
  }

  promptHints.push(`Camera facing ${directionDesc}`);

  const visibleAdjacentRooms: Array<{ room_id: string; room_name: string; confidence: number }> = [];
  for (const adj of adjacentRooms) {
    visibleAdjacentRooms.push({
      room_id: adj.id,
      room_name: adj.name,
      confidence: 0.6,
    });
  }

  const likelyOpenings: Array<{ type: string; side: string; confidence: number }> = [];
  const roomId = point.room_id;
  if (roomId) {
    const connectedEdges = edges.filter(e => e.from === roomId || e.to === roomId);
    for (const edge of connectedEdges) {
      const openingType = edge.connection_type || "door";
      likelyOpenings.push({
        type: openingType,
        side: "unknown",
        confidence: 0.7,
      });
    }
  }

  if (point.x_norm < 0.05 || point.x_norm > 0.95) {
    warnings.push("Camera is very close to apartment edge - may see outside walls");
  }
  if (point.y_norm < 0.05 || point.y_norm > 0.95) {
    warnings.push("Camera is very close to apartment edge - may see outside walls");
  }

  return {
    camera_slot: cameraSlot,
    yaw_deg: yaw,
    direction_context: {
      primary_view_target: roomInfo ? `Interior of ${labelToUse || roomInfo.name} facing ${directionDesc}` : `Facing ${directionDesc}`,
      likely_visible_adjacent_rooms: visibleAdjacentRooms.slice(0, 3),
      likely_visible_openings: likelyOpenings.slice(0, 3),
    },
    prompt_hints: promptHints,
    warnings: warnings,
  };
}

/**
 * Use Gemini Vision to detect room labels near each marker position
 * Wrapped with Langfuse tracing
 */
async function detectLabelsWithVision(
  imageBase64: string,
  mimeType: string,
  markers: PanoramaPoint[],
  pipelineId: string
): Promise<Map<string, LabelDetectionResult>> {
  if (!API_NANOBANANA) {
    console.log("[run-camera-scan] No API key, skipping label detection");
    return new Map();
  }

  const markerDescriptions = markers.map((m, i) => 
    `Marker ${i + 1} (id: ${m.id}): Position (${Math.round(m.x_norm * 100)}% from left, ${Math.round(m.y_norm * 100)}% from top), bound to room "${m.room_name || 'Unassigned'}"`
  ).join("\n");

  const prompt = `Analyze this floor plan image and detect room labels/text near each camera marker position.

CAMERA MARKERS TO ANALYZE:
${markerDescriptions}

For each marker position, identify:
1. The nearest visible room label/text on the floor plan
2. Your confidence (0-1) that this label corresponds to the marker's target room
3. The approximate bounding box of the label (as normalized 0-1 coordinates)

Respond ONLY with valid JSON in this exact format:
{
  "detections": [
    {
      "marker_id": "uuid-here",
      "detected_label": "Living Room" or null if none found,
      "confidence": 0.85,
      "bbox_norm": {"x": 0.3, "y": 0.4, "w": 0.1, "h": 0.05} or null,
      "prompt_hint": "Focus on the Living Room area in the center-left of the plan"
    }
  ]
}

Important:
- Return null for detected_label if no clear label is found near that position
- Be precise with bbox_norm coordinates
- prompt_hint should describe where to focus for rendering`;

  try {
    // Wrap the model call with Langfuse tracing
    const result = await wrapModelGeneration<{ candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }>(
      {
        traceId: pipelineId,
        generationName: STEP_3_2_GENERATIONS.CAMERA_PLANNING,
        model: "gemini-2.0-flash",
        metadata: {
          project_id: "",
          pipeline_id: pipelineId,
          step_number: 3,
          sub_step: "3.2",
        },
        promptInfo: {
          name: "camera_label_detection",
          source: "code",
        },
        finalPromptText: prompt,
        variables: {
          marker_count: markers.length,
          marker_ids: markers.map(m => m.id),
        },
        requestParams: {
          temperature: 0.2,
          maxOutputTokens: 4096,
        },
        imageCount: 1,
      },
      async () => {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_NANOBANANA}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{
                parts: [
                  { text: prompt },
                  { inlineData: { mimeType, data: imageBase64 } }
                ]
              }],
              generationConfig: {
                temperature: 0.2,
                maxOutputTokens: 4096,
              },
            }),
          }
        );

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Label detection API error: ${response.status} - ${errorText}`);
        }

        return await response.json();
      }
    );

    if (!result.success || !result.data) {
      console.error("[run-camera-scan] Label detection failed:", result.error?.message);
      return new Map();
    }

    const textContent = result.data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    
    // Extract JSON from response
    const jsonMatch = textContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("[run-camera-scan] No JSON found in label detection response");
      return new Map();
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const detections = parsed.detections || [];
    
    const resultMap = new Map<string, LabelDetectionResult>();
    for (const detection of detections) {
      resultMap.set(detection.marker_id, detection);
    }
    
    console.log(`[run-camera-scan] Detected labels for ${resultMap.size}/${markers.length} markers`);
    return resultMap;
  } catch (error) {
    console.error(`[run-camera-scan] Label detection error: ${error}`);
    return new Map();
  }
}

/**
 * Generate a crop image centered on a marker position
 */
async function generateMarkerCrop(
  imageBase64: string,
  mimeType: string,
  marker: PanoramaPoint,
  imageWidth: number,
  imageHeight: number,
  detectedBbox?: { x: number; y: number; w: number; h: number } | null
): Promise<{ base64: string; width: number; height: number } | null> {
  if (!API_NANOBANANA) {
    return null;
  }

  // Calculate crop region - use detected bbox if available, otherwise center on marker
  const cropSize = 0.25; // 25% of image in each direction
  let centerX = marker.x_norm;
  let centerY = marker.y_norm;
  
  if (detectedBbox) {
    // Center on the detected label's bbox center
    centerX = detectedBbox.x + detectedBbox.w / 2;
    centerY = detectedBbox.y + detectedBbox.h / 2;
  }

  // Calculate crop bounds in pixels
  const cropW = Math.round(imageWidth * cropSize * 2);
  const cropH = Math.round(imageHeight * cropSize * 2);
  const cropX = Math.max(0, Math.round(centerX * imageWidth - cropW / 2));
  const cropY = Math.max(0, Math.round(centerY * imageHeight - cropH / 2));

  const prompt = `Crop this floor plan image to show a focused view of the area around the camera marker.

CROP SPECIFICATIONS:
- Center the crop on position: ${Math.round(centerX * 100)}% from left, ${Math.round(centerY * 100)}% from top
- Include approximately 25% of the image width and height around this center point
- The resulting crop should clearly show the room/space at this location
- Preserve the original image quality and all labels/text in the cropped area

Do NOT modify the floor plan content - only crop it.
Output a high-quality cropped image.`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_NANOBANANA}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inlineData: { mimeType, data: imageBase64 } }
            ]
          }],
          generationConfig: {
            responseModalities: ["IMAGE"],
            temperature: 0.1,
          },
        }),
      }
    );

    if (!response.ok) {
      console.error(`[run-camera-scan] Crop generation failed: ${response.status}`);
      return null;
    }

    const result = await response.json();
    const candidate = result.candidates?.[0];
    
    for (const part of candidate?.content?.parts || []) {
      if (part.inlineData?.data) {
        return {
          base64: part.inlineData.data,
          width: cropW,
          height: cropH,
        };
      }
    }

    return null;
  } catch (error) {
    console.error(`[run-camera-scan] Crop generation error: ${error}`);
    return null;
  }
}

/**
 * Fetch image as base64 from upload record
 */
async function fetchImageAsBase64(
  serviceClient: any,
  uploadId: string
): Promise<{ base64: string; mimeType: string; width: number; height: number }> {
  const { data: upload, error: uploadError } = await serviceClient
    .from("uploads")
    .select("*")
    .eq("id", uploadId)
    .single();

  if (uploadError || !upload) {
    throw new Error(`Upload not found: ${uploadId}`);
  }

  const { data: fileData, error: downloadError } = await serviceClient.storage
    .from(upload.bucket)
    .download(upload.path);

  if (downloadError || !fileData) {
    throw new Error(`Failed to download image: ${downloadError?.message}`);
  }

  const arrayBuffer = await fileData.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  const base64 = encodeBase64(uint8Array);
  const mimeType = upload.mime_type || "image/png";

  return {
    base64,
    mimeType,
    width: upload.original_width || 1920,
    height: upload.original_height || 1080,
  };
}

/**
 * Upload crop to storage and return public URL
 */
async function uploadCropToStorage(
  serviceClient: any,
  ownerId: string,
  pipelineId: string,
  scanId: string,
  markerId: string,
  cropBase64: string
): Promise<{ path: string; publicUrl: string }> {
  const path = `temp/camera-planning/${pipelineId}/${scanId}/${markerId}.png`;
  
  // Decode base64
  const binaryString = atob(cropBase64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  const { error } = await serviceClient.storage
    .from("outputs")
    .upload(path, bytes, {
      contentType: "image/png",
      upsert: true,
    });

  if (error) {
    throw new Error(`Failed to upload crop: ${error.message}`);
  }

  // Generate signed URL (valid for 7 days)
  const { data: signedData } = await serviceClient.storage
    .from("outputs")
    .createSignedUrl(path, 604800); // 7 days

  return {
    path,
    publicUrl: signedData?.signedUrl || "",
  };
}

/**
 * Clean up old scan items and crops for a pipeline
 */
async function cleanupOldScanItems(
  serviceClient: any,
  pipelineId: string,
  excludeScanId?: string
): Promise<void> {
  // Find old scans
  const { data: oldScans } = await serviceClient
    .from("pipeline_camera_scans")
    .select("id")
    .eq("pipeline_id", pipelineId)
    .neq("id", excludeScanId || "");

  if (!oldScans || oldScans.length === 0) return;

  const oldScanIds = oldScans.map((s: any) => s.id);

  // Get old scan items to delete their crops
  const { data: oldItems } = await serviceClient
    .from("pipeline_camera_scan_items")
    .select("crop_storage_path")
    .in("scan_id", oldScanIds);

  // Delete crops from storage
  if (oldItems) {
    const pathsToDelete = oldItems
      .filter((i: any) => i.crop_storage_path)
      .map((i: any) => i.crop_storage_path);
    
    if (pathsToDelete.length > 0) {
      await serviceClient.storage
        .from("outputs")
        .remove(pathsToDelete);
    }
  }

  // Delete old scan items (cascades from scan deletion)
  // Old scans are kept for history but items are deleted
  await serviceClient
    .from("pipeline_camera_scan_items")
    .delete()
    .in("scan_id", oldScanIds);

  console.log(`[run-camera-scan] Cleaned up ${oldScanIds.length} old scan(s)`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const userClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } }
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();

    if (userError || !userData?.user?.id) {
      console.error("[run-camera-scan] Auth error:", userError);
      return new Response(
        JSON.stringify({ success: false, error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = userData.user.id;
    const { pipeline_id } = await req.json();

    if (!pipeline_id) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing pipeline_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[run-camera-scan] Starting AI-powered scan for pipeline ${pipeline_id}`);

    // ═══════════════════════════════════════════════════════════════════════════
    // LANGFUSE TRACING: Ensure pipeline_run trace exists
    // ═══════════════════════════════════════════════════════════════════════════
    await ensurePipelineTrace(pipeline_id, "", userId);

    // Fetch pipeline
    const { data: pipeline, error: pipelineError } = await supabaseClient
      .from("floorplan_pipelines")
      .select("*, step_outputs")
      .eq("id", pipeline_id)
      .eq("owner_id", userId)
      .single();

    if (pipelineError || !pipeline) {
      console.error("[run-camera-scan] Pipeline not found:", pipelineError);
      return new Response(
        JSON.stringify({ success: false, error: "Pipeline not found or unauthorized" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate Step 2 is approved
    const stepOutputs = pipeline.step_outputs as Record<string, unknown> || {};
    const step2Output = stepOutputs["step2"] as Record<string, unknown> | undefined;
    const step2UploadId = step2Output?.output_upload_id as string | undefined;
    
    if (!step2UploadId && !step2Output?.manual_approved) {
      return new Response(
        JSON.stringify({ success: false, error: "Step 2 must be approved before scanning cameras" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update pipeline status to scanning
    await supabaseClient
      .from("floorplan_pipelines")
      .update({
        camera_scan_status: "running",
        camera_scan_updated_at: new Date().toISOString(),
      })
      .eq("id", pipeline_id);

    // Fetch panorama points (camera markers)
    const { data: markers, error: markersError } = await supabaseClient
      .from("pipeline_camera_markers")
      .select("*")
      .eq("pipeline_id", pipeline_id)
      .order("sort_order", { ascending: true });

    if (markersError || !markers || markers.length === 0) {
      await supabaseClient
        .from("floorplan_pipelines")
        .update({ camera_scan_status: "failed" })
        .eq("id", pipeline_id);
      return new Response(
        JSON.stringify({ success: false, error: "No panorama points found" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate all markers have room bindings
    const unboundMarkers = markers.filter(m => !m.room_id);
    if (unboundMarkers.length > 0) {
      await supabaseClient
        .from("floorplan_pipelines")
        .update({ camera_scan_status: "failed" })
        .eq("id", pipeline_id);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `${unboundMarkers.length} panorama point(s) need a room assigned: ${unboundMarkers.map(m => m.label).join(", ")}` 
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch spaces/rooms
    const { data: spaces, error: spacesError } = await supabaseClient
      .from("floorplan_pipeline_spaces")
      .select("id, name, space_type, bounds_note, confidence")
      .eq("pipeline_id", pipeline_id)
      .eq("is_excluded", false);

    if (spacesError) {
      console.error("[run-camera-scan] Error fetching spaces:", spacesError);
    }

    const roomsMap = new Map<string, RoomInfo>();
    (spaces || []).forEach(s => roomsMap.set(s.id, s));

    // Fetch spatial map for connectivity
    const { data: spatialMap } = await supabaseClient
      .from("pipeline_spatial_maps")
      .select("rooms, adjacency_graph, locks_json")
      .eq("pipeline_id", pipeline_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const adjacencyGraph = (spatialMap?.adjacency_graph as Array<{ from: string; to: string; connection_type: string }>) || [];
    
    const adjacencyMap = new Map<string, string[]>();
    for (const edge of adjacencyGraph) {
      if (!adjacencyMap.has(edge.from)) adjacencyMap.set(edge.from, []);
      if (!adjacencyMap.has(edge.to)) adjacencyMap.set(edge.to, []);
      adjacencyMap.get(edge.from)!.push(edge.to);
      adjacencyMap.get(edge.to)!.push(edge.from);
    }

    // Prepare panorama point data
    const panoramaPoints: PanoramaPoint[] = markers.map(m => ({
      id: m.id,
      x_norm: parseFloat(m.x_norm),
      y_norm: parseFloat(m.y_norm),
      yaw_deg: parseFloat(m.yaw_deg),
      fov_deg: parseFloat(m.fov_deg),
      label: m.label,
      room_id: m.room_id,
      room_name: m.room_id ? roomsMap.get(m.room_id)?.name || null : null,
    }));

    const versionHash = await computeVersionHash(panoramaPoints);

    // Create scan record
    const { data: scanRecord, error: scanRecordError } = await supabaseClient
      .from("pipeline_camera_scans")
      .insert({
        pipeline_id,
        owner_id: userId,
        status: "running",
        version_hash: versionHash,
      })
      .select()
      .single();

    if (scanRecordError) {
      console.error("[run-camera-scan] Error creating scan record:", scanRecordError);
      await supabaseClient
        .from("floorplan_pipelines")
        .update({ camera_scan_status: "failed" })
        .eq("id", pipeline_id);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to create scan record" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Clean up old scans
    await cleanupOldScanItems(supabaseClient, pipeline_id, scanRecord.id);

    console.log(`[run-camera-scan] Processing ${panoramaPoints.length} panorama points`);

    // Fetch Step 2 image for AI analysis
    let imageData: { base64: string; mimeType: string; width: number; height: number } | null = null;
    let labelDetections = new Map<string, LabelDetectionResult>();
    
    if (step2UploadId && API_NANOBANANA) {
      try {
        imageData = await fetchImageAsBase64(supabaseClient, step2UploadId);
        console.log(`[run-camera-scan] Fetched Step 2 image: ${imageData.width}x${imageData.height}`);
        
        // Detect labels using AI vision (with Langfuse tracing)
        labelDetections = await detectLabelsWithVision(
          imageData.base64,
          imageData.mimeType,
          panoramaPoints,
          pipeline_id
        );
      } catch (error) {
        console.error(`[run-camera-scan] Failed to load image for AI analysis: ${error}`);
      }
    }

    // Build scan results and generate crops
    const scanResults: PanoramaPointScanResult[] = [];
    const scanItems: any[] = [];

    for (const point of panoramaPoints) {
      const roomInfo = point.room_id ? roomsMap.get(point.room_id) || null : null;
      const labelDetection = labelDetections.get(point.id);
      
      const adjacentRoomIds = point.room_id ? (adjacencyMap.get(point.room_id) || []) : [];
      const adjacentRooms = adjacentRoomIds
        .map(id => roomsMap.get(id))
        .filter((r): r is RoomInfo => r !== undefined)
        .map(r => ({ id: r.id, name: r.name }));

      const cameraAYaw = point.yaw_deg;
      const cameraBYaw = (point.yaw_deg + 180) % 360;

      const detectedLabel = labelDetection?.detected_label || undefined;
      const cameraA = buildCameraContext(point, "A", cameraAYaw, roomInfo, adjacentRooms, adjacencyGraph, detectedLabel);
      const cameraB = buildCameraContext(point, "B", cameraBYaw, roomInfo, adjacentRooms, adjacencyGraph, detectedLabel);

      // Generate crop if we have image data
      let cropUrl: string | undefined;
      let cropPath: string | undefined;
      let cropWidth: number | undefined;
      let cropHeight: number | undefined;
      
      if (imageData && API_NANOBANANA) {
        try {
          const cropResult = await generateMarkerCrop(
            imageData.base64,
            imageData.mimeType,
            point,
            imageData.width,
            imageData.height,
            labelDetection?.bbox_norm
          );
          
          if (cropResult) {
            const uploaded = await uploadCropToStorage(
              supabaseClient,
              userId,
              pipeline_id,
              scanRecord.id,
              point.id,
              cropResult.base64
            );
            cropPath = uploaded.path;
            cropUrl = uploaded.publicUrl;
            cropWidth = cropResult.width;
            cropHeight = cropResult.height;
            console.log(`[run-camera-scan] Generated crop for marker ${point.label}`);
          }
        } catch (error) {
          console.error(`[run-camera-scan] Failed to generate crop for ${point.label}: ${error}`);
        }
      }

      const result: PanoramaPointScanResult = {
        panorama_point_id: point.id,
        panorama_point_label: point.label,
        normalized_position: { x_norm: point.x_norm, y_norm: point.y_norm },
        fov_deg: point.fov_deg,
        room_validation: {
          bound_room_id: point.room_id,
          ai_room_id: point.room_id,
          match: true,
          confidence: labelDetection?.confidence ?? (roomInfo ? 1.0 : 0.0),
        },
        embedded_cameras: [cameraA, cameraB],
        global_rules: {
          forbid_new_rooms: true,
          forbid_new_openings: true,
          allowed_adjacent_rooms: adjacentRoomIds,
        },
        detected_label: labelDetection ? {
          text: labelDetection.detected_label || "",
          confidence: labelDetection.confidence,
          bbox_norm: labelDetection.bbox_norm || undefined,
        } : undefined,
        crop_url: cropUrl,
      };

      scanResults.push(result);

      // Prepare scan item for DB
      scanItems.push({
        scan_id: scanRecord.id,
        marker_id: point.id,
        owner_id: userId,
        detected_room_label: labelDetection?.detected_label || null,
        detected_label_confidence: labelDetection?.confidence || 0,
        detected_label_bbox_norm: labelDetection?.bbox_norm || null,
        crop_storage_path: cropPath || null,
        crop_public_url: cropUrl || null,
        crop_width: cropWidth || null,
        crop_height: cropHeight || null,
        crop_expires_at: cropUrl ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() : null,
        prompt_hint_text: labelDetection?.prompt_hint || cameraA.prompt_hints.join(". "),
        is_temporary: true,
      });
    }

    // Insert scan items
    if (scanItems.length > 0) {
      const { error: itemsError } = await supabaseClient
        .from("pipeline_camera_scan_items")
        .insert(scanItems);
      
      if (itemsError) {
        console.error("[run-camera-scan] Error inserting scan items:", itemsError);
      }
    }

    console.log(`[run-camera-scan] Built ${scanResults.length} panorama point results with ${scanItems.filter(i => i.crop_public_url).length} crops`);

    // Update scan record with results
    const { error: updateScanError } = await supabaseClient
      .from("pipeline_camera_scans")
      .update({
        status: "completed",
        model_used: API_NANOBANANA ? "gemini-2.0-flash" : "deterministic-logic-v1",
        results_json: scanResults,
        updated_at: new Date().toISOString(),
      })
      .eq("id", scanRecord.id);

    if (updateScanError) {
      console.error("[run-camera-scan] Error updating scan record:", updateScanError);
    }

    // Update pipeline status
    await supabaseClient
      .from("floorplan_pipelines")
      .update({
        camera_scan_status: "completed",
        camera_scan_updated_at: new Date().toISOString(),
      })
      .eq("id", pipeline_id);

    // Log event
    await supabaseClient
      .from("floorplan_pipeline_events")
      .insert({
        pipeline_id,
        owner_id: userId,
        step_number: 4,
        type: "PANORAMA_POINT_SCAN_COMPLETED",
        message: JSON.stringify({
          scan_id: scanRecord.id,
          points_scanned: scanResults.length,
          total_cameras: scanResults.length * 2,
          crops_generated: scanItems.filter(i => i.crop_public_url).length,
          labels_detected: scanItems.filter(i => i.detected_room_label).length,
          version_hash: versionHash,
          model_used: API_NANOBANANA ? "gemini-2.0-flash" : "deterministic",
        }),
        progress_int: 100,
      });

    console.log(`[run-camera-scan] AI-powered scan completed for pipeline ${pipeline_id}`);

    // CRITICAL: Flush Langfuse events before returning
    await flushLangfuse();

    return new Response(
      JSON.stringify({
        success: true,
        scan_id: scanRecord.id,
        results: scanResults,
        version_hash: versionHash,
        crops_generated: scanItems.filter(i => i.crop_public_url).length,
        labels_detected: scanItems.filter(i => i.detected_room_label).length,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[run-camera-scan] Unexpected error:", error);
    
    // Flush Langfuse even on error
    await flushLangfuse();
    
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
