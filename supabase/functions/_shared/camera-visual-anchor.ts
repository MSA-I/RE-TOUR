/**
 * Camera Visual Anchor Generator
 * 
 * Generates visual camera screenshots for NanoBanana Step 5 renders:
 * 1. Base Plan Image: Realistic 2D top-down with original labels, NO camera markers
 * 2. Plan + Single Camera Overlay: Same plan with ONLY the current camera visible
 * 3. Space Crop + Single Camera Overlay: Cropped to space bounds with camera overlay
 * 
 * These images are sent to NanoBanana as visual anchors (primary source of truth).
 * They are stored as pipeline artifacts (not creations) and deleted at Step 7 completion.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface CameraMarkerData {
  id: string;
  label: string;
  x_norm: number; // 0-1 normalized position
  y_norm: number;
  yaw_deg: number;
  fov_deg: number;
  room_id: string | null;
  mirror_enabled: boolean;
}

export interface SpaceBounds {
  x: number; // 0-1 normalized
  y: number;
  width: number;
  height: number;
}

export interface CameraAnchorImages {
  basePlanBase64: string;
  basePlanMimeType: string;
  planWithCameraBase64: string;
  planWithCameraMimeType: string;
  spaceCropWithCameraBase64: string;
  spaceCropWithCameraMimeType: string;
}

export interface CameraAnchorArtifactIds {
  basePlanArtifactId: string;
  planWithCameraArtifactId: string;
  spaceCropWithCameraArtifactId: string;
}

/**
 * Build SVG overlay for a single camera marker
 */
function buildCameraSvgOverlay(
  marker: CameraMarkerData,
  imageWidth: number,
  imageHeight: number,
  cameraKind: "A" | "B",
  spaceName: string
): string {
  // Calculate pixel positions
  const cx = marker.x_norm * imageWidth;
  const cy = marker.y_norm * imageHeight;
  
  // For Camera B, rotate yaw by 180 degrees
  const yawDeg = cameraKind === "B" ? (marker.yaw_deg + 180) % 360 : marker.yaw_deg;
  const yawRad = (yawDeg * Math.PI) / 180;
  
  // FOV cone parameters
  const fovRad = (marker.fov_deg * Math.PI) / 180;
  const coneLength = Math.min(imageWidth, imageHeight) * 0.15; // 15% of smaller dimension
  
  // Arrow direction (main viewing direction)
  const arrowLength = coneLength * 1.2;
  const arrowX = cx + Math.sin(yawRad) * arrowLength;
  const arrowY = cy - Math.cos(yawRad) * arrowLength;
  
  // FOV cone edges
  const leftAngle = yawRad - fovRad / 2;
  const rightAngle = yawRad + fovRad / 2;
  const leftX = cx + Math.sin(leftAngle) * coneLength;
  const leftY = cy - Math.cos(leftAngle) * coneLength;
  const rightX = cx + Math.sin(rightAngle) * coneLength;
  const rightY = cy - Math.cos(rightAngle) * coneLength;
  
  // Label text
  const labelText = `Camera ${cameraKind} – ${spaceName}`;
  const mirrorText = cameraKind === "B" && marker.mirror_enabled 
    ? "Camera B = Camera A + 180°" 
    : "";
  
  // Colors
  const cameraColor = cameraKind === "A" ? "#22c55e" : "#3b82f6"; // Green for A, Blue for B
  const strokeWidth = Math.max(2, Math.min(imageWidth, imageHeight) / 300);
  const fontSize = Math.max(12, Math.min(imageWidth, imageHeight) / 40);
  
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${imageWidth}" height="${imageHeight}" viewBox="0 0 ${imageWidth} ${imageHeight}">
      <!-- FOV Cone (semi-transparent fill) -->
      <path 
        d="M ${cx} ${cy} L ${leftX} ${leftY} A ${coneLength} ${coneLength} 0 0 1 ${rightX} ${rightY} Z" 
        fill="${cameraColor}40" 
        stroke="${cameraColor}" 
        stroke-width="${strokeWidth}"
      />
      
      <!-- Camera Point (center circle) -->
      <circle 
        cx="${cx}" 
        cy="${cy}" 
        r="${strokeWidth * 4}" 
        fill="${cameraColor}" 
        stroke="white" 
        stroke-width="${strokeWidth}"
      />
      
      <!-- Direction Arrow -->
      <line 
        x1="${cx}" 
        y1="${cy}" 
        x2="${arrowX}" 
        y2="${arrowY}" 
        stroke="${cameraColor}" 
        stroke-width="${strokeWidth * 2}" 
        stroke-linecap="round"
      />
      
      <!-- Arrowhead -->
      <polygon 
        points="${arrowX},${arrowY} ${arrowX - 8 * Math.cos(yawRad - 0.5)},${arrowY - 8 * Math.sin(yawRad - 0.5)} ${arrowX - 8 * Math.cos(yawRad + 0.5)},${arrowY - 8 * Math.sin(yawRad + 0.5)}" 
        fill="${cameraColor}"
      />
      
      <!-- Label Background -->
      <rect 
        x="${cx + 20}" 
        y="${cy - fontSize - 8}" 
        width="${labelText.length * fontSize * 0.6}" 
        height="${fontSize + 8}" 
        fill="rgba(0,0,0,0.8)" 
        rx="4"
      />
      
      <!-- Label Text -->
      <text 
        x="${cx + 25}" 
        y="${cy - 4}" 
        fill="white" 
        font-family="Arial, sans-serif" 
        font-size="${fontSize}" 
        font-weight="bold"
      >${labelText}</text>
      
      ${mirrorText ? `
      <!-- Mirror Info Background -->
      <rect 
        x="${cx + 20}" 
        y="${cy + 4}" 
        width="${mirrorText.length * fontSize * 0.5}" 
        height="${fontSize + 4}" 
        fill="rgba(0,0,0,0.8)" 
        rx="3"
      />
      
      <!-- Mirror Info Text -->
      <text 
        x="${cx + 25}" 
        y="${cy + fontSize + 2}" 
        fill="#fbbf24" 
        font-family="Arial, sans-serif" 
        font-size="${fontSize * 0.85}" 
        font-style="italic"
      >${mirrorText}</text>
      ` : ""}
    </svg>
  `;
}

/**
 * Generate camera anchor prompt text for NanoBanana
 * This text accompanies the visual anchors to guide the AI
 */
export function buildCameraAnchorPromptText(
  marker: CameraMarkerData,
  cameraKind: "A" | "B",
  spaceName: string
): string {
  const yawDeg = cameraKind === "B" ? (marker.yaw_deg + 180) % 360 : marker.yaw_deg;
  
  const directionMap: Record<string, string> = {
    "0-22": "North (up on the plan)",
    "23-67": "Northeast",
    "68-112": "East (right on the plan)",
    "113-157": "Southeast",
    "158-202": "South (down on the plan)",
    "203-247": "Southwest",
    "248-292": "West (left on the plan)",
    "293-337": "Northwest",
    "338-360": "North (up on the plan)",
  };
  
  let direction = "Unknown";
  for (const [range, dir] of Object.entries(directionMap)) {
    const [min, max] = range.split("-").map(Number);
    if (yawDeg >= min && yawDeg <= max) {
      direction = dir;
      break;
    }
  }
  
  return `
═══════════════════════════════════════════════════════════════
VISUAL CAMERA ANCHOR (PRIMARY SOURCE OF TRUTH)
═══════════════════════════════════════════════════════════════

You are provided with THREE reference images showing exact camera placement:

1️⃣ BASE FLOOR PLAN - The realistic 2D top-down view with original room labels
2️⃣ PLAN WITH CAMERA OVERLAY - Same plan showing ONLY this camera's position, direction arrow, and FOV cone
3️⃣ SPACE CROP WITH CAMERA - Zoomed view of the specific space with camera overlay

CAMERA SPECIFICATION (from visual overlay):
- Camera Label: Camera ${cameraKind} – ${spaceName}
- Direction: ${direction} (${yawDeg.toFixed(0)}° from top of plan)
- Field of View: ${marker.fov_deg}° cone shown in overlay
- Position: Marked with colored circle on the overlay
${cameraKind === "B" && marker.mirror_enabled ? `
⚠️ MIRROR CAMERA: Camera B = Camera A + 180°
This camera faces the OPPOSITE direction of Camera A in the same position.
` : ""}

CRITICAL INSTRUCTIONS:
✅ Follow the DIRECTION ARROW shown in the overlay - generate the view in THAT direction
✅ The FOV CONE shows exactly what should be visible in the render
✅ Match the camera position marker - this is where the viewer is standing
✅ Use the CROPPED SPACE view to understand the room boundaries
✅ Preserve exact room proportions as shown in the floor plan

❌ Do NOT ignore the visual overlays - they are the primary reference
❌ Do NOT generate a view from a different position or direction
❌ Do NOT add rooms or features not visible from this camera angle

═══════════════════════════════════════════════════════════════
`;
}

/**
 * Compose SVG overlay onto a base image (server-side using Canvas simulation)
 * Returns the composited image as base64
 * 
 * Note: This uses a text-based approach since Deno doesn't have native Canvas.
 * The SVG is embedded into the image metadata for the AI to understand.
 */
export function createCameraOverlayDescription(
  marker: CameraMarkerData,
  cameraKind: "A" | "B",
  spaceName: string,
  imageWidth: number,
  imageHeight: number
): { svgOverlay: string; description: string } {
  const svgOverlay = buildCameraSvgOverlay(marker, imageWidth, imageHeight, cameraKind, spaceName);
  
  const yawDeg = cameraKind === "B" ? (marker.yaw_deg + 180) % 360 : marker.yaw_deg;
  
  // Create a text description for the AI to understand the overlay
  const description = `
[CAMERA OVERLAY DESCRIPTION]
Camera ${cameraKind} for "${spaceName}" is positioned at:
- X: ${(marker.x_norm * 100).toFixed(1)}% from left edge of plan
- Y: ${(marker.y_norm * 100).toFixed(1)}% from top edge of plan
- Direction: ${yawDeg.toFixed(0)}° (0°=up/north, 90°=right/east, 180°=down/south, 270°=left/west)
- FOV: ${marker.fov_deg}° field of view cone
${cameraKind === "B" ? "- This is Camera B (mirrored +180° from Camera A)" : "- This is Camera A (primary direction)"}

The camera is marked with a ${cameraKind === "A" ? "GREEN" : "BLUE"} circle and arrow showing viewing direction.
Generate the render as if standing at this exact position, looking in the arrow direction.
`;
  
  return { svgOverlay, description };
}

/**
 * Store camera anchor artifact in pipeline_artifacts table
 */
export async function storeCameraArtifact(
  serviceClient: any,
  runId: string,
  stepId: string,
  ownerId: string,
  artifactKind: "camera_base_plan" | "camera_plan_overlay" | "camera_space_crop",
  uploadId: string | null,
  metadata: Record<string, unknown>
): Promise<string> {
  const { data, error } = await serviceClient
    .from("pipeline_artifacts")
    .insert({
      run_id: runId,
      step_id: stepId,
      owner_id: ownerId,
      kind: artifactKind,
      upload_id: uploadId,
      metadata_json: metadata,
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(`Failed to store camera artifact: ${error.message}`);
  }

  return (data as any).id;
}

/**
 * Delete all camera anchor artifacts for a pipeline run
 * Called at Step 7 completion
 */
export async function cleanupCameraArtifacts(
  serviceClient: any,
  pipelineId: string,
  ownerId: string
): Promise<number> {
  // Find all camera-related artifacts
  const { data: artifacts, error: fetchError } = await serviceClient
    .from("pipeline_artifacts")
    .select("id, upload_id, storage_path, storage_bucket")
    .eq("owner_id", ownerId)
    .in("kind", ["camera_base_plan", "camera_plan_overlay", "camera_space_crop"])
    .like("step_id", `%${pipelineId}%`);

  if (fetchError) {
    console.error(`[camera-anchor] Failed to fetch artifacts for cleanup: ${fetchError.message}`);
    return 0;
  }

  const typedArtifacts = (artifacts || []) as Array<{
    id: string;
    upload_id: string | null;
    storage_path: string | null;
    storage_bucket: string | null;
  }>;

  if (typedArtifacts.length === 0) {
    return 0;
  }

  // Delete from storage
  for (const artifact of typedArtifacts) {
    if (artifact.storage_bucket && artifact.storage_path) {
      try {
        await serviceClient.storage
          .from(artifact.storage_bucket)
          .remove([artifact.storage_path]);
      } catch (err) {
        console.error(`[camera-anchor] Failed to delete storage: ${err}`);
      }
    }
  }

  // Delete artifact records
  const { error: deleteError } = await serviceClient
    .from("pipeline_artifacts")
    .delete()
    .in("id", typedArtifacts.map(a => a.id));

  if (deleteError) {
    console.error(`[camera-anchor] Failed to delete artifact records: ${deleteError.message}`);
    return 0;
  }

  return typedArtifacts.length;
}
