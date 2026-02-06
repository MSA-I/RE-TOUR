import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encodeBase64, decodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import { Image, decode } from "https://deno.land/x/imagescript@1.3.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/**
 * Camera Anchor Generation Edge Function
 * 
 * Creates deterministic anchor metadata for camera markers AND generates crop images.
 * This unified approach ensures "Anchors Created" always means crops exist.
 * 
 * For each marker, this function:
 * 1. Creates anchor metadata (position, yaw, fov, room context)
 * 2. Generates a TIGHT CROP image centered on the marker position from the Step 2 image
 * 3. Draws ONLY this marker's A+B camera indicators on the crop
 * 4. Stores the crop in temp storage with signed URL
 * 5. Creates/updates scan item record with crop data
 */

interface CameraMarker {
  id: string;
  pipeline_id: string;
  owner_id: string;
  x_norm: number;
  y_norm: number;
  yaw_deg: number;
  fov_deg: number;
  label: string;
  room_id: string | null;
  mirror_enabled: boolean;
  anchor_status: string;
}

interface Space {
  id: string;
  name: string;
  space_type: string;
}

// Compute hash for transform fingerprint (matches DB function)
function computeTransformHash(marker: CameraMarker): string {
  const data = `${marker.x_norm}:${marker.y_norm}:${marker.yaw_deg}:${marker.fov_deg}:${marker.room_id || ""}`;
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}

// Get cardinal direction from yaw
function getCardinalDirection(yawDeg: number): string {
  const directions = ["N (up)", "NE", "E (right)", "SE", "S (down)", "SW", "W (left)", "NW"];
  const normalizedYaw = ((yawDeg % 360) + 360) % 360;
  const index = Math.round(normalizedYaw / 45) % 8;
  return directions[index];
}

// Build camera context metadata
function buildCameraContextMetadata(
  marker: CameraMarker,
  space: Space | null,
  cameraKind: "A" | "B"
): Record<string, any> {
  const xPercent = Math.round(marker.x_norm * 100);
  const yPercent = Math.round(marker.y_norm * 100);
  
  const yawDeg = cameraKind === "B" ? (marker.yaw_deg + 180) % 360 : marker.yaw_deg;
  const direction = getCardinalDirection(yawDeg);
  const mirrorNote = cameraKind === "B" && marker.mirror_enabled 
    ? "Camera B = Camera A + 180°" 
    : null;
  
  return {
    camera_kind: cameraKind,
    camera_label: marker.label,
    space_name: space?.name || "Unassigned",
    space_type: space?.space_type || "room",
    position: {
      x_percent: xPercent,
      y_percent: yPercent,
      x_norm: marker.x_norm,
      y_norm: marker.y_norm,
    },
    orientation: {
      yaw_deg: yawDeg,
      fov_deg: marker.fov_deg,
      direction: direction,
    },
    mirror_note: mirrorNote,
  };
}

/**
 * Draw camera marker arrow on an image
 * Draws ONLY Camera A (blue) arrow - Camera B is NOT rendered in crop images
 * The same crop is reused for both A and B renders, but only shows Camera A marker
 */
function drawCameraMarkers(
  img: Image,
  marker: CameraMarker,
  cropOffsetX: number,
  cropOffsetY: number,
  markerPixelX: number,
  markerPixelY: number
): void {
  // Calculate marker position relative to crop
  const relX = markerPixelX - cropOffsetX;
  const relY = markerPixelY - cropOffsetY;
  
  // Skip if marker is outside crop bounds
  if (relX < 0 || relX >= img.width || relY < 0 || relY >= img.height) {
    return;
  }
  
  const markerRadius = Math.min(img.width, img.height) * 0.08; // 8% of smaller dimension
  const arrowLength = markerRadius * 1.5;
  
  // Color: Camera A = Blue (ONLY Camera A is rendered in crop)
  const colorA = 0x3B82F6FF; // Blue
  const colorCenter = 0xFFFFFFFF; // White center
  
  // Draw center circle (white)
  drawFilledCircle(img, relX, relY, markerRadius * 0.4, colorCenter);
  
  // Draw Camera A arrow ONLY (primary direction)
  // Camera B is NOT drawn - the same crop is used for both renders
  const yawARad = (marker.yaw_deg - 90) * Math.PI / 180;
  drawArrow(img, relX, relY, yawARad, arrowLength, colorA, "A");
  
  // Draw outer ring
  drawCircleOutline(img, relX, relY, markerRadius, 0x000000FF, 3);
  drawCircleOutline(img, relX, relY, markerRadius - 2, 0xFFFFFFFF, 2);
}

/**
 * All drawing functions use ImageScript which has 1-based pixel indexing.
 * We work in 0-based coordinates internally and convert to 1-based when calling setPixelAt.
 */
function drawFilledCircle(img: Image, cx: number, cy: number, radius: number, color: number): void {
  const r2 = radius * radius;
  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) {
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
      // Check 0-based bounds
      if (x >= 0 && x < img.width && y >= 0 && y < img.height) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= r2) {
          // Convert to 1-based for ImageScript
          img.setPixelAt(x + 1, y + 1, color);
        }
      }
    }
  }
}

function drawCircleOutline(img: Image, cx: number, cy: number, radius: number, color: number, thickness: number): void {
  for (let angle = 0; angle < 360; angle += 1) {
    const rad = angle * Math.PI / 180;
    for (let t = 0; t < thickness; t++) {
      const r = radius - t;
      const x = Math.round(cx + r * Math.cos(rad));
      const y = Math.round(cy + r * Math.sin(rad));
      // Check 0-based bounds, convert to 1-based for setPixelAt
      if (x >= 0 && x < img.width && y >= 0 && y < img.height) {
        img.setPixelAt(x + 1, y + 1, color);
      }
    }
  }
}

function drawArrow(img: Image, cx: number, cy: number, angleRad: number, length: number, color: number, label: string): void {
  // Draw main arrow line from center point outward
  const tipX = cx + Math.cos(angleRad) * length;
  const tipY = cy + Math.sin(angleRad) * length;
  
  drawLine(img, cx, cy, tipX, tipY, color, 4);
  
  // Draw arrowhead
  const headAngle = 0.4; // ~23 degrees
  const headLength = length * 0.35;
  
  const head1X = tipX - Math.cos(angleRad - headAngle) * headLength;
  const head1Y = tipY - Math.sin(angleRad - headAngle) * headLength;
  const head2X = tipX - Math.cos(angleRad + headAngle) * headLength;
  const head2Y = tipY - Math.sin(angleRad + headAngle) * headLength;
  
  drawLine(img, tipX, tipY, head1X, head1Y, color, 3);
  drawLine(img, tipX, tipY, head2X, head2Y, color, 3);
}

function drawLine(img: Image, x1: number, y1: number, x2: number, y2: number, color: number, thickness: number): void {
  const dx = Math.abs(x2 - x1);
  const dy = Math.abs(y2 - y1);
  const steps = Math.max(dx, dy, 1);
  
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = Math.round(x1 + (x2 - x1) * t);
    const y = Math.round(y1 + (y2 - y1) * t);
    
    // Draw with thickness, centered on the line
    const halfT = Math.floor(thickness / 2);
    for (let tx = -halfT; tx <= halfT; tx++) {
      for (let ty = -halfT; ty <= halfT; ty++) {
        const px = x + tx;
        const py = y + ty;
        // Check 0-based bounds, convert to 1-based for setPixelAt
        if (px >= 0 && px < img.width && py >= 0 && py < img.height) {
          img.setPixelAt(px + 1, py + 1, color);
        }
      }
    }
  }
}

/**
 * Generate FULL FLOOR PLAN with ONLY the selected marker overlaid.
 * REPLACES the old tight crop logic per user requirement.
 * 
 * This sends the FULL floor plan image with a single camera marker overlay
 * at the exact position of the selected camera point. No cropping.
 */
async function generateFullPlanWithSingleMarker(
  serviceClient: any,
  uploadId: string,
  marker: CameraMarker,
  opts?: { debugOverlay?: boolean }
): Promise<{ uint8Array: Uint8Array; width: number; height: number } | null> {
  console.log(`[create-camera-anchor] Starting FULL PLAN overlay generation for marker ${marker.label}`);
  
  try {
    // Fetch the upload record
    const { data: upload, error: uploadError } = await serviceClient
      .from("uploads")
      .select("*")
      .eq("id", uploadId)
      .single();

    if (uploadError || !upload) {
      console.error(`[create-camera-anchor] Upload not found: ${uploadId}`);
      return null;
    }

    // Download the source image
    const { data: fileData, error: downloadError } = await serviceClient.storage
      .from(upload.bucket)
      .download(upload.path);

    if (downloadError || !fileData) {
      console.error(`[create-camera-anchor] Failed to download: ${downloadError?.message}`);
      return null;
    }

    const arrayBuffer = await fileData.arrayBuffer();
    const sourceBytes = new Uint8Array(arrayBuffer);
    
    // Decode the source image (cast to Image, not GIF)
    let sourceImage: Image;
    try {
      const decoded = await decode(sourceBytes);
      if (!(decoded instanceof Image)) {
        console.error(`[create-camera-anchor] Decoded result is not a static Image (might be GIF)`);
        return null;
      }
      sourceImage = decoded;
    } catch (decodeErr) {
      console.error(`[create-camera-anchor] Failed to decode image: ${decodeErr}`);
      return null;
    }
    
    const imageWidth = sourceImage.width;
    const imageHeight = sourceImage.height;
    
    console.log(`[create-camera-anchor] Source image (FULL): ${imageWidth}x${imageHeight}`);

    // Calculate marker center in pixels on the FULL image
    const markerPixelX = Math.round(marker.x_norm * imageWidth);
    const markerPixelY = Math.round(marker.y_norm * imageHeight);
    
    console.log(`[create-camera-anchor] Marker position on full plan: (${markerPixelX}, ${markerPixelY})`);

    // Clone the full image - NO CROPPING
    const overlayImage = sourceImage.clone();

    // Optional debug overlay: crosshair at the exact marker position
    if (opts?.debugOverlay) {
      drawCrosshair(overlayImage, markerPixelX, markerPixelY, 20, 0xEC4899FF /* pink */);
    }
    
    // Draw ONLY this marker's Camera A arrow on the FULL plan
    // Note: We pass 0,0 as crop offsets since we're using the full image
    drawSingleMarkerOnFullPlan(overlayImage, marker, markerPixelX, markerPixelY);
    
    // Encode to PNG
    const overlayBytes = await overlayImage.encode();
    
    console.log(`[create-camera-anchor] Generated FULL PLAN overlay: ${imageWidth}x${imageHeight}, ${overlayBytes.length} bytes`);

    return {
      uint8Array: overlayBytes,
      width: imageWidth,
      height: imageHeight,
    };
  } catch (error) {
    console.error(`[create-camera-anchor] Full plan overlay generation error: ${error}`);
    return null;
  }
}

/**
 * Draw a SINGLE camera marker (Camera A only - blue arrow) on the full floor plan.
 * No other markers, no Camera B, no mirror arrows.
 */
function drawSingleMarkerOnFullPlan(
  img: Image,
  marker: CameraMarker,
  markerPixelX: number,
  markerPixelY: number
): void {
  // Calculate marker size relative to image dimensions (larger for full plan visibility)
  const markerRadius = Math.min(img.width, img.height) * 0.04; // 4% of smaller dimension
  const arrowLength = markerRadius * 2.0;
  
  // Color: Camera A = Blue ONLY (no orange B marker)
  const colorA = 0x3B82F6FF; // Blue
  const colorCenter = 0xFFFFFFFF; // White center
  const colorRing = 0x000000FF; // Black outline
  
  // Draw outer ring (black)
  drawCircleOutline(img, markerPixelX, markerPixelY, markerRadius, colorRing, 4);
  
  // Draw inner ring (white)
  drawCircleOutline(img, markerPixelX, markerPixelY, markerRadius - 3, 0xFFFFFFFF, 2);
  
  // Draw center circle (white fill)
  drawFilledCircle(img, markerPixelX, markerPixelY, markerRadius * 0.35, colorCenter);
  
  // Draw Camera A arrow ONLY (primary direction)
  // yaw_deg 0 = up, so we need to adjust by -90 degrees for canvas coordinates
  const yawARad = (marker.yaw_deg - 90) * Math.PI / 180;
  drawArrow(img, markerPixelX, markerPixelY, yawARad, arrowLength, colorA, "A");
  
  // Add a small label "A" near the arrow tip for clarity
  // (We can't easily draw text in ImageScript, so we rely on the blue color being distinctive)
  
  console.log(`[create-camera-anchor] Drew single marker at (${markerPixelX}, ${markerPixelY}) yaw=${marker.yaw_deg}°`);
}

function drawCrosshair(img: Image, cx: number, cy: number, size: number, color: number): void {
  // Horizontal
  drawLine(img, cx - size, cy, cx + size, cy, color, 2);
  // Vertical
  drawLine(img, cx, cy - size, cx, cy + size, color, 2);
  // Center dot
  drawFilledCircle(img, cx, cy, 2, color);
}

/**
 * Upload crop to storage and return signed URL
 */
async function uploadCropToStorage(
  serviceClient: any,
  ownerId: string,
  pipelineId: string,
  scanId: string,
  markerId: string,
  base64Data: string,
  mimeType: string = "image/png"
): Promise<{ path: string; publicUrl: string; expiresAt: string }> {
  const path = `temp/camera-planning/${pipelineId}/${scanId}/${markerId}.png`;
  
  // Decode base64
  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  // Upload to storage
  const { error } = await serviceClient.storage
    .from("outputs")
    .upload(path, bytes, {
      contentType: mimeType,
      upsert: true,
    });

  if (error) {
    throw new Error(`Failed to upload crop: ${error.message}`);
  }

  // Generate signed URL (7 days)
  const expiresIn = 7 * 24 * 60 * 60; // 7 days in seconds
  const { data: signedData } = await serviceClient.storage
    .from("outputs")
    .createSignedUrl(path, expiresIn);

  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

  return {
    path,
    publicUrl: signedData?.signedUrl || "",
    expiresAt,
  };
}

/**
 * Get or create a scan record for this pipeline
 */
async function getOrCreateScanRecord(
  serviceClient: any,
  pipelineId: string,
  ownerId: string,
  versionHash: string
): Promise<{ id: string; isNew: boolean }> {
  // Check for existing scan
  const { data: existingScan } = await serviceClient
    .from("pipeline_camera_scans")
    .select("id, version_hash")
    .eq("pipeline_id", pipelineId)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingScan) {
    return { id: existingScan.id, isNew: false };
  }

  // Create new scan record
  const { data: newScan, error } = await serviceClient
    .from("pipeline_camera_scans")
    .insert({
      pipeline_id: pipelineId,
      owner_id: ownerId,
      status: "completed",
      version_hash: versionHash,
      model_used: "deterministic-anchor-v2",
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create scan record: ${error.message}`);
  }

  return { id: newScan.id, isNew: true };
}

/**
 * Create or update scan item for a marker with crop data
 */
async function upsertScanItem(
  serviceClient: any,
  scanId: string,
  markerId: string,
  ownerId: string,
  cropData: {
    path: string | null;
    publicUrl: string | null;
    expiresAt: string | null;
    width: number | null;
    height: number | null;
  },
  promptHint: string
): Promise<void> {
  // Check for existing item
  const { data: existingItem } = await serviceClient
    .from("pipeline_camera_scan_items")
    .select("id")
    .eq("scan_id", scanId)
    .eq("marker_id", markerId)
    .maybeSingle();

  const itemData = {
    scan_id: scanId,
    marker_id: markerId,
    owner_id: ownerId,
    crop_storage_path: cropData.path,
    crop_public_url: cropData.publicUrl,
    crop_expires_at: cropData.expiresAt,
    crop_width: cropData.width,
    crop_height: cropData.height,
    prompt_hint_text: promptHint,
    is_temporary: true,
    updated_at: new Date().toISOString(),
  };

  if (existingItem) {
    await serviceClient
      .from("pipeline_camera_scan_items")
      .update(itemData)
      .eq("id", existingItem.id);
  } else {
    await serviceClient
      .from("pipeline_camera_scan_items")
      .insert(itemData);
  }
}

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

    const {
      marker_id,
      pipeline_id,
      camera_kind = "A",
      create_all = false,
      debug_overlay = false,
    } = await req.json();

    if (!pipeline_id) {
      return new Response(
        JSON.stringify({ error: "Missing pipeline_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Fetch pipeline
    const { data: pipeline, error: pipelineError } = await serviceClient
      .from("floorplan_pipelines")
      .select("floor_plan_upload_id, step_outputs")
      .eq("id", pipeline_id)
      .eq("owner_id", userId)
      .single();

    if (pipelineError || !pipeline?.floor_plan_upload_id) {
      return new Response(
        JSON.stringify({ error: "Pipeline or floor plan not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get Step 2 styled image upload ID
    const stepOutputs = (pipeline.step_outputs as Record<string, any>) || {};
    const step2UploadId = stepOutputs.step2?.output_upload_id;

    if (!step2UploadId) {
      return new Response(
        JSON.stringify({ error: "Step 2 styled image not found - complete style step first" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch markers to process
    let markersQuery = serviceClient
      .from("pipeline_camera_markers")
      .select("*")
      .eq("pipeline_id", pipeline_id)
      .eq("owner_id", userId);

    if (!create_all && marker_id) {
      markersQuery = markersQuery.eq("id", marker_id);
    }

    const { data: markers, error: markersError } = await markersQuery;

    if (markersError || !markers || markers.length === 0) {
      return new Response(JSON.stringify({ error: "No camera markers found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[create-camera-anchor] Processing ${markers.length} marker(s) for pipeline ${pipeline_id}`);

    // Fetch spaces for context
    const spaceIds = [...new Set(markers.filter(m => m.room_id).map(m => m.room_id))];
    const spacesMap = new Map<string, Space>();
    
    if (spaceIds.length > 0) {
      const { data: spaces } = await serviceClient
        .from("floorplan_pipeline_spaces")
        .select("id, name, space_type")
        .in("id", spaceIds);
      
      (spaces || []).forEach(s => spacesMap.set(s.id, s as Space));
    }

    // Create version hash from markers
    const versionHash = await computeVersionHashFromMarkers(markers);

    // Get or create scan record
    const scanRecord = await getOrCreateScanRecord(serviceClient, pipeline_id, userId, versionHash);
    console.log(`[create-camera-anchor] Using scan ${scanRecord.id} (new: ${scanRecord.isNew})`);

    // Process each marker
    const results: Array<{
      marker_id: string;
      marker_label: string;
      anchor_status: string;
      crop_url: string | null;
      error?: string;
    }> = [];

    for (const marker of markers) {
      try {
        // Update status to generating
        await serviceClient
          .from("pipeline_camera_markers")
          .update({ 
            anchor_status: "generating",
            anchor_error_message: null,
          })
          .eq("id", marker.id);

        const space = marker.room_id ? spacesMap.get(marker.room_id) || null : null;
        const cameraKindTyped = camera_kind as "A" | "B";
        const cameraContext = buildCameraContextMetadata(marker as CameraMarker, space, cameraKindTyped);

        // Generate FULL FLOOR PLAN with ONLY this marker overlaid (replaces old crop logic)
        console.log(`[create-camera-anchor] Generating full plan overlay for marker ${marker.label}...`);
        const overlayResult = await generateFullPlanWithSingleMarker(
          serviceClient,
          step2UploadId,
          marker as CameraMarker,
          { debugOverlay: !!debug_overlay }
        );

        let cropData = {
          path: null as string | null,
          publicUrl: null as string | null,
          expiresAt: null as string | null,
          width: null as number | null,
          height: null as number | null,
        };

        if (overlayResult) {
          try {
            // Convert Uint8Array to base64 for upload
            const base64Data = encodeBase64(overlayResult.uint8Array);
            const uploaded = await uploadCropToStorage(
              serviceClient,
              userId,
              pipeline_id,
              scanRecord.id,
              marker.id,
              base64Data,
              "image/png"
            );
            cropData = {
              path: uploaded.path,
              publicUrl: uploaded.publicUrl,
              expiresAt: uploaded.expiresAt,
              width: overlayResult.width,
              height: overlayResult.height,
            };
            console.log(`[create-camera-anchor] ✓ Generated FULL PLAN overlay for marker ${marker.label}: ${overlayResult.width}x${overlayResult.height}`);
            console.log(`[create-camera-anchor] Overlay saved to: ${uploaded.publicUrl?.substring(0, 80)}...`);
          } catch (uploadError) {
            console.error(`[create-camera-anchor] Overlay upload failed for ${marker.label}: ${uploadError}`);
          }
        } else {
          console.error(`[create-camera-anchor] Failed to generate overlay for marker ${marker.label}`);
        }

        // Create prompt hint
        const promptHint = `Focus on the ${space?.name || "room"} area at position (${Math.round(marker.x_norm * 100)}%, ${Math.round(marker.y_norm * 100)}%). ${cameraContext.orientation.direction} view.`;

        // Upsert scan item with crop data
        await upsertScanItem(
          serviceClient,
          scanRecord.id,
          marker.id,
          userId,
          cropData,
          promptHint
        );

        // Store anchor metadata references
        const basePlanRef = `ref:upload:${step2UploadId}`;
        const singleOverlayRef = `ref:upload:${step2UploadId}:marker:${marker.id}`;
        const cropOverlayRef = cropData.path || `ref:upload:${step2UploadId}:crop:${marker.id}`;
        const transformHash = computeTransformHash(marker as CameraMarker);
        const now = new Date().toISOString();

        // Update marker with anchor data
        await serviceClient
          .from("pipeline_camera_markers")
          .update({
            anchor_status: "ready",
            anchor_base_plan_path: basePlanRef,
            anchor_single_overlay_path: singleOverlayRef,
            anchor_crop_overlay_path: cropOverlayRef,
            anchor_created_at: now,
            anchor_transform_hash: transformHash,
            anchor_error_message: null,
          })
          .eq("id", marker.id);

        results.push({
          marker_id: marker.id,
          marker_label: marker.label,
          anchor_status: "ready",
          crop_url: cropData.publicUrl,
        });

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[create-camera-anchor] Failed for marker ${marker.label}: ${errorMessage}`);
        
        await serviceClient
          .from("pipeline_camera_markers")
          .update({ 
            anchor_status: "failed",
            anchor_error_message: errorMessage,
          })
          .eq("id", marker.id);

        results.push({
          marker_id: marker.id,
          marker_label: marker.label,
          anchor_status: "failed",
          crop_url: null,
          error: errorMessage,
        });
      }
    }

    // Update pipeline scan status
    await serviceClient
      .from("floorplan_pipelines")
      .update({
        camera_scan_status: "completed",
        camera_scan_updated_at: new Date().toISOString(),
      })
      .eq("id", pipeline_id);

    // Log event
    await serviceClient
      .from("floorplan_pipeline_events")
      .insert({
        pipeline_id,
        owner_id: userId,
        step_number: 4,
        type: "CAMERA_ANCHORS_CREATED",
        message: JSON.stringify({
          scan_id: scanRecord.id,
          markers_processed: markers.length,
          successful: results.filter(r => r.anchor_status === "ready").length,
          failed: results.filter(r => r.anchor_status === "failed").length,
          crops_generated: results.filter(r => r.crop_url).length,
        }),
        progress_int: 100,
      });

    const successCount = results.filter(r => r.anchor_status === "ready").length;
    const cropCount = results.filter(r => r.crop_url).length;

    console.log(`[create-camera-anchor] Completed: ${successCount}/${markers.length} anchors, ${cropCount} crops`);

    return new Response(
      JSON.stringify({
        success: true,
        scan_id: scanRecord.id,
        markers_processed: markers.length,
        anchors_created: successCount,
        crops_generated: cropCount,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[create-camera-anchor] Error: ${message}`);
    
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function computeVersionHashFromMarkers(markers: any[]): Promise<string> {
  const sortedMarkers = [...markers].sort((a, b) => a.id.localeCompare(b.id));
  const hashInput = JSON.stringify(sortedMarkers.map(m => ({
    id: m.id,
    x_norm: m.x_norm,
    y_norm: m.y_norm,
    yaw_deg: m.yaw_deg,
    fov_deg: m.fov_deg,
    room_id: m.room_id,
  })));
  const encoder = new TextEncoder();
  const data = encoder.encode(hashInput);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("").substring(0, 32);
}
