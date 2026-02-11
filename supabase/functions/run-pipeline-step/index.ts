import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";
import { encode as encodeBase64 } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { decode as decodeBase64 } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import {
  TEXT_OVERLAY_PRESERVATION_BLOCK,
  TEXT_OVERLAY_PRESERVATION_COMPACT,
  TEXT_OVERLAY_QA_PROMPT,
  shouldApplyTextPreservation,
  shouldApplyTextPreservationForGeneration,
  shouldApplyTextPreservationForQA,
  injectTextPreservation,
  injectTextPreservationForGeneration
} from "../_shared/text-overlay-preservation.ts";
import {
  wrapImageGeneration,
  type ImageGenerationRequest,
} from "../_shared/langfuse-image-wrapper.ts";
import {
  persistQAJudgeResult,
  normalizeScore,
} from "../_shared/qa-judge-persistence.ts";
// NOTE: imagescript removed - Image.decode() exceeds Edge Function memory limits for 4K images

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-retry, x-retry-user-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// API keys loaded at module level (optional, won't crash if undefined)
const API_NANOBANANA = Deno.env.get("API_NANOBANANA");

// CRITICAL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are loaded INSIDE serve()
// to prevent module initialization failures that would break OPTIONS handler

// ═══════════════════════════════════════════════════════════════════════════
// MEMORY OPTIMIZATION CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// MEMORY OPTIMIZATION STRATEGY (APPROVED)
// ═══════════════════════════════════════════════════════════════════════════
// Server-side downscaling with imagescript exceeds memory limits for 4K images.
// Instead, we generate Step 1 at 2K when the pipeline requests 4K.
// Steps 2+ can still generate 4K outputs using the 2K Step 1 as conditioning input.
// ═══════════════════════════════════════════════════════════════════════════

function encodeBase64FromBytes(bytes: Uint8Array): string {
  // Avoid ArrayBuffer|SharedArrayBuffer typing issues by copying into a fresh ArrayBuffer.
  const copy = new Uint8Array(bytes);
  return encodeBase64(copy.buffer);
}

/**
 * Log current memory usage for debugging
 */
function logMemory(label: string): void {
  try {
    const mem = Deno.memoryUsage();
    console.log(`[Memory ${label}] RSS: ${(mem.rss / 1024 / 1024).toFixed(1)}MB, Heap: ${(mem.heapUsed / 1024 / 1024).toFixed(1)}MB`);
  } catch {
    // Deno.memoryUsage may not be available in all environments
  }
}

/**
 * Emit a structured error event for pipeline step failures
 * This ensures all errors are logged and visible to the user
 *
 * @param supabase - Supabase admin client
 * @param pipelineId - Pipeline ID
 * @param ownerId - User ID
 * @param stepNumber - Step number (0-7)
 * @param errorCode - Structured error code (e.g., "PHASE_MISMATCH", "AUTH_INVALID")
 * @param errorMessage - Human-readable error description
 */
async function emitStepError(
  supabase: any,
  pipelineId: string,
  ownerId: string,
  stepNumber: number,
  errorCode: string,
  errorMessage: string
): Promise<void> {
  console.error(`[STEP_ERROR:${errorCode}] ${errorMessage}`);

  // Write error event to floorplan_pipeline_events
  try {
    await supabase.from("floorplan_pipeline_events").insert({
      pipeline_id: pipelineId,
      owner_id: ownerId,
      step_number: stepNumber,
      type: "step_error",
      message: `[${errorCode}] ${errorMessage}`,
      progress_int: 0
    });
  } catch (e) {
    console.error(`[CRITICAL] Could not write error event:`, e);
  }

  // Update pipeline.last_error for UI display
  try {
    await supabase.from("floorplan_pipelines").update({
      last_error: `[${errorCode}] ${errorMessage}`,
      updated_at: new Date().toISOString()
    }).eq("id", pipelineId);
  } catch (e) {
    console.error(`[CRITICAL] Could not update pipeline.last_error:`, e);
  }
}

/**
 * Check if an image needs downscaling based on dimensions
 * Returns the scale factor (1.0 = no scaling needed)
 */
function getDownscaleFactor(base64: string, maxDimension: number): { needsDownscale: boolean; dims: { width: number; height: number } | null; scale: number } {
  const dims = getImageDimensions(base64);
  if (!dims) {
    return { needsDownscale: false, dims: null, scale: 1.0 };
  }

  const longestSide = Math.max(dims.width, dims.height);

  if (longestSide <= maxDimension) {
    return { needsDownscale: false, dims, scale: 1.0 };
  }

  return { needsDownscale: true, dims, scale: maxDimension / longestSide };
}

/**
 * Log downscaling diagnostics for image processing
 *
 * NOTE: Actual server-side downscaling is now implemented at image load time
 * (see lines 1626-1680) using Supabase Storage transformations.
 * This function remains for diagnostic logging of images that would need downscaling.
 *
 * Steps 1-4 automatically apply downscaling via storage transformations to prevent
 * memory exhaustion in the Edge Function environment.
 */
function logDownscaleCheck(base64: string, maxDimension: number, label: string): void {
  const check = getDownscaleFactor(base64, maxDimension);
  if (check.needsDownscale && check.dims) {
    const newWidth = Math.round(check.dims.width * check.scale);
    const newHeight = Math.round(check.dims.height * check.scale);
    console.log(`[Downscale ${label}] Would resize ${check.dims.width}×${check.dims.height} → ${newWidth}×${newHeight} (scale: ${check.scale.toFixed(2)})`);
    console.log(`[Downscale ${label}] Current base64 size: ${(base64.length * 0.75 / 1024 / 1024).toFixed(2)}MB`);
  } else if (check.dims) {
    console.log(`[Downscale ${label}] Image ${check.dims.width}×${check.dims.height} already under ${maxDimension}px limit`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// IMAGE RESOLUTION VERIFICATION UTILITY
// ═══════════════════════════════════════════════════════════════════════════

interface ImageDimensions {
  width: number;
  height: number;
  format: string;
}

/**
 * Extract image dimensions from base64 encoded image data by reading headers
 * Supports JPEG and PNG formats
 */
function getImageDimensions(base64Data: string): ImageDimensions | null {
  try {
    // CPU-safe header decode:
    // Previous implementation repeatedly reallocated and copied buffers while growing `decoded`,
    // which can burn CPU and trip WORKER_LIMIT. Here we write into a fixed buffer.
    const MAX_SCAN_BYTES = 256 * 1024; // cap to avoid full decode of multi-MB images
    const BASE64_CHUNK = 8192; // chars, ~6KB decoded

    const buf = new Uint8Array(MAX_SCAN_BYTES);
    let len = 0;

    const append = (chunk: Uint8Array) => {
      if (len >= MAX_SCAN_BYTES) return;
      const remaining = MAX_SCAN_BYTES - len;
      const toCopy = chunk.length > remaining ? remaining : chunk.length;
      if (toCopy <= 0) return;
      buf.set(chunk.subarray(0, toCopy), len);
      len += toCopy;
    };

    // Decode enough to identify file type and (ideally) locate JPEG SOF marker
    for (let i = 0; i < base64Data.length && len < MAX_SCAN_BYTES; i += BASE64_CHUNK) {
      const slice = base64Data.slice(i, i + BASE64_CHUNK);
      try {
        append(decodeBase64(slice));
      } catch {
        // If decode fails at chunk boundaries, skip this chunk.
        continue;
      }

      if (len < 24) continue;

      // PNG signature: 89 50 4E 47 0D 0A 1A 0A
      if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
        const width = (buf[16] << 24) | (buf[17] << 16) | (buf[18] << 8) | buf[19];
        const height = (buf[20] << 24) | (buf[21] << 16) | (buf[22] << 8) | buf[23];
        return { width, height, format: "PNG" };
      }

      // JPEG signature: FF D8 FF
      if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
        // Scan for SOF0..SOF3 markers that contain dimensions
        let offset = 2;
        while (offset < len - 9) {
          if (buf[offset] !== 0xff) {
            offset++;
            continue;
          }
          const marker = buf[offset + 1];
          // SOF0..SOF3 contain dimensions
          if (marker >= 0xc0 && marker <= 0xc3) {
            const height = (buf[offset + 5] << 8) | buf[offset + 6];
            const width = (buf[offset + 7] << 8) | buf[offset + 8];
            return { width, height, format: "JPEG" };
          }
          // Segment length (includes the two length bytes)
          const segLen = (buf[offset + 2] << 8) | buf[offset + 3];
          if (!Number.isFinite(segLen) || segLen <= 0) break;
          offset += 2 + segLen;
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Verify that the generated image meets the expected resolution for the quality tier
 */
interface ResolutionCheckOptions {
  isPanoramaTask?: boolean;
  provider?: string;
}

function verifyResolution(dims: ImageDimensions | null, qualityTier: string, options: ResolutionCheckOptions = {}): {
  passed: boolean;
  actualPixels: number;
  expectedMin: number;
  message: string;
  isProviderLimitation?: boolean;
} {
  const { isPanoramaTask = false, provider = "nano_banana" } = options;

  const minPixels: Record<string, number> = {
    "1K": 900,    // At least 900px on shortest side
    "2K": 1800,   // At least 1800px on shortest side
    "4K": 3600,   // At least 3600px on shortest side (10% tolerance from 4096)
  };

  if (!dims) {
    return { passed: false, actualPixels: 0, expectedMin: minPixels[qualityTier] || 0, message: "Could not read image dimensions" };
  }

  const shortestSide = Math.min(dims.width, dims.height);
  const expectedMin = minPixels[qualityTier] || 0;
  const aspectRatio = dims.width / dims.height;

  // For panorama tasks with Nano Banana, relax the strict 2:1 requirement
  // Accept wider images (aspect >= 1.8) without failing, just log as info
  const isNanoBananaPanorama = isPanoramaTask && provider === "nano_banana";

  if (isNanoBananaPanorama) {
    // For Nano Banana panoramas, only check if it's reasonably wide (aspect >= 1.6)
    // Don't fail on resolution, just provide info
    const isWideEnough = aspectRatio >= 1.6;
    const isAcceptableResolution = shortestSide >= (minPixels["1K"] || 900); // Minimum 1K for any output

    if (isWideEnough && isAcceptableResolution) {
      return {
        passed: true,
        actualPixels: shortestSide,
        expectedMin,
        message: `Resolution OK (Nano Banana panorama): ${dims.width}×${dims.height}, aspect ${aspectRatio.toFixed(2)}:1`,
        isProviderLimitation: aspectRatio < 1.9 || shortestSide < expectedMin
      };
    }

    // If aspect ratio is too narrow, mark as low confidence but don't fail hard
    if (!isWideEnough) {
      return {
        passed: true, // Don't fail the job, just flag it
        actualPixels: shortestSide,
        expectedMin,
        message: `LOW_CONFIDENCE: Nano Banana output aspect ratio ${aspectRatio.toFixed(2)}:1 is narrow (expected >= 1.6:1)`,
        isProviderLimitation: true
      };
    }
  }

  // Standard resolution check for non-panorama tasks or other providers
  const passed = shortestSide >= expectedMin;

  return {
    passed,
    actualPixels: shortestSide,
    expectedMin,
    message: passed
      ? `Resolution OK: ${dims.width}×${dims.height} (${dims.format})`
      : `Resolution MISMATCH: Expected ${qualityTier} (min ${expectedMin}px), got ${dims.width}×${dims.height}`
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// DIMENSION EXTRACTION AND WALL GEOMETRY TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface ExtractedDimension {
  label: string;
  value: number;
  unit: string;
  confidence: number;
  raw_text: string;
}

interface WallGeometryResult {
  has_non_orthogonal_walls: boolean;
  has_curved_walls: boolean;
  has_diagonal_corners: boolean;
  has_chamfers: boolean;
  geometry_notes: string;
  confidence: number;
  detected_features: Array<{
    type: "angled_wall" | "curved_wall" | "diagonal_corner" | "chamfer" | "non_rectangular_room";
    location: string;
    description: string;
    confidence: number;
  }>;
}

interface DimensionAnalysisResult {
  dimensions_found: boolean;
  units: "metric" | "imperial" | "mixed" | "unknown";
  extracted_dimensions: ExtractedDimension[];
  scale_guidance_text: string;
  scale_locked: boolean;
  overall_dimensions?: {
    apartment_width?: string;
    apartment_length?: string;
    total_area?: string;
  };
  wall_geometry?: WallGeometryResult;
}

const DIMENSION_EXTRACTION_PROMPT = `You are an expert architectural analyst specializing in reading floor plans.

TASK: Extract ALL dimension annotations visible in this floor plan image.

WHAT TO LOOK FOR:
1. Linear dimensions (wall lengths, room widths/lengths)
   - Metric: "3.20m", "320cm", "3200mm", "3,20 m"
   - Imperial: "10'6"", "10ft 6in", "10'-6"", "126""
2. Area annotations (m², sq ft, sqm)
3. Scale indicators or scale bars
4. Overall apartment/building dimensions
5. Key spans (corridor widths, door widths)

EXTRACTION RULES:
- Extract ONLY dimensions that are clearly visible and legible
- Note the position/context (e.g., "bedroom width", "living room length")
- Identify the unit system used (metric/imperial)
- Estimate confidence based on clarity (0.0-1.0)
- Do NOT invent or estimate dimensions not shown

OUTPUT FORMAT (JSON only):
{
  "dimensions_found": true/false,
  "units": "metric" | "imperial" | "mixed" | "unknown",
  "extracted_dimensions": [
    {
      "label": "Living room width",
      "value": 5.2,
      "unit": "m",
      "confidence": 0.95,
      "raw_text": "5.20m"
    }
  ],
  "overall_dimensions": {
    "apartment_width": "12.5m",
    "apartment_length": "8.3m",
    "total_area": "85 m²"
  },
  "analysis_notes": "Brief notes on dimension clarity and coverage"
}

If NO dimensions are visible, return:
{
  "dimensions_found": false,
  "units": "unknown",
  "extracted_dimensions": [],
  "overall_dimensions": null,
  "analysis_notes": "No dimension annotations found in the floor plan"
}`;

const WALL_GEOMETRY_EXTRACTION_PROMPT = `You are an expert architectural analyst specializing in floor plan geometry.

TASK: Analyze this floor plan for NON-ORTHOGONAL wall geometry.

WHAT TO DETECT:
1. ANGLED WALLS: Walls that are NOT at 90° angles (non-perpendicular)
2. CURVED WALLS: Any walls that follow a curved or arc path
3. DIAGONAL CORNERS: Corners cut at 45° (chamfers) or other angles
4. NON-RECTANGULAR ROOMS: Rooms with irregular polygon shapes

For EACH detected feature, note:
- Type of geometry (angled, curved, diagonal corner, chamfer)
- Location in the floor plan (e.g., "north wall of living room", "entrance hallway")
- Brief description
- Confidence level (0.0-1.0)

CRITICAL RULES:
- Look carefully for ANY deviation from standard 90° orthogonal grid
- Even small angled sections or chamfers must be detected
- Bay windows with angled walls count as angled geometry
- Curved alcoves or rounded walls must be detected
- Do NOT assume all walls are straight if there's any visual evidence otherwise

OUTPUT FORMAT (JSON only):
{
  "has_non_orthogonal_walls": true/false,
  "has_curved_walls": true/false,
  "has_diagonal_corners": true/false,
  "has_chamfers": true/false,
  "geometry_notes": "Summary of detected non-standard geometry",
  "confidence": 0.0-1.0,
  "detected_features": [
    {
      "type": "angled_wall" | "curved_wall" | "diagonal_corner" | "chamfer" | "non_rectangular_room",
      "location": "north side of living room",
      "description": "45-degree angled wall section forming bay window",
      "confidence": 0.9
    }
  ]
}

If the plan has ONLY standard 90° orthogonal walls:
{
  "has_non_orthogonal_walls": false,
  "has_curved_walls": false,
  "has_diagonal_corners": false,
  "has_chamfers": false,
  "geometry_notes": "Standard orthogonal layout with only 90° corners",
  "confidence": 0.95,
  "detected_features": []
}`;

function buildScaleGuidanceBlock(analysis: DimensionAnalysisResult): string {
  let scaleBlock: string;

  if (!analysis.dimensions_found || analysis.extracted_dimensions.length === 0) {
    scaleBlock = `SCALE & PROPORTIONS:
- Preserve proportions exactly as shown in the floor plan.
- Maintain accurate room shapes and relative sizes.
- No dimension annotations detected; rely on visual proportions only.`;
  } else {
    const unitLabel = analysis.units === "metric" ? "meters/centimeters" :
      analysis.units === "imperial" ? "feet/inches" : "detected units";

    const keyDimensions = analysis.extracted_dimensions
      .filter(d => d.confidence >= 0.8)
      .slice(0, 6)
      .map(d => `  - ${d.label}: ${d.raw_text}`)
      .join("\n");

    let overallBlock = "";
    if (analysis.overall_dimensions) {
      const parts: string[] = [];
      if (analysis.overall_dimensions.apartment_width) {
        parts.push(`Overall width: ${analysis.overall_dimensions.apartment_width}`);
      }
      if (analysis.overall_dimensions.apartment_length) {
        parts.push(`Overall length: ${analysis.overall_dimensions.apartment_length}`);
      }
      if (analysis.overall_dimensions.total_area) {
        parts.push(`Total area: ${analysis.overall_dimensions.total_area}`);
      }
      if (parts.length > 0) {
        overallBlock = `\nOverall dimensions:\n  ${parts.join("\n  ")}`;
      }
    }

    scaleBlock = `SCALE & DIMENSIONS (LOCKED - DO NOT VIOLATE):
- Units: ${unitLabel}
- Scale locked from plan dimensions: YES

Key dimensions from floor plan:
${keyDimensions}${overallBlock}

CRITICAL SCALE REQUIREMENTS:
- Preserve EXACT room proportions and real-world scale based on these annotated dimensions.
- Do NOT alter wall lengths, room shapes, or overall proportions.
- Ensure all generated elements (furniture, fixtures, openings) are scaled correctly to match these dimensions.
- Door heights should be standard (~2.1m / 7ft).
- Window sizes should be proportionate to wall lengths.
- Furniture must fit realistically within the measured room dimensions.`;
  }

  // Add wall geometry preservation block if geometry was analyzed
  const geometryBlock = buildGeometryPreservationBlock(analysis.wall_geometry);

  return `${scaleBlock}

${geometryBlock}`;
}

function buildGeometryPreservationBlock(geometry: WallGeometryResult | undefined | null): string {
  if (!geometry || (!geometry.has_non_orthogonal_walls && !geometry.has_curved_walls && !geometry.has_diagonal_corners && !geometry.has_chamfers)) {
    return `WALL GEOMETRY:
- Preserve standard orthogonal wall layout.
- Maintain 90° corners and straight walls as shown in the plan.`;
  }

  const features = geometry.detected_features
    .filter(f => f.confidence >= 0.7)
    .map(f => `  - ${f.type.replace(/_/g, " ")}: ${f.location} - ${f.description}`)
    .join("\n");

  const geometryTypes: string[] = [];
  if (geometry.has_non_orthogonal_walls) geometryTypes.push("angled walls");
  if (geometry.has_curved_walls) geometryTypes.push("curved walls");
  if (geometry.has_diagonal_corners) geometryTypes.push("diagonal corners");
  if (geometry.has_chamfers) geometryTypes.push("chamfered corners");

  return `WALL GEOMETRY PRESERVATION (CRITICAL - DO NOT VIOLATE):
- geometry_locked: TRUE
- Non-standard geometry detected: ${geometryTypes.join(", ")}

Detected features:
${features}

CRITICAL GEOMETRY REQUIREMENTS:
- Preserve ALL non-orthogonal and/or curved walls EXACTLY as in the plan.
- Do NOT straighten walls that are angled.
- Do NOT remove or simplify curved walls.
- Do NOT invent new straight walls to replace angled/curved geometry.
- Maintain exact room shapes including all irregular polygon boundaries.

${geometry.geometry_notes}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// FURNITURE-AWARE PROMPTING TYPES & FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

interface DetectedItem {
  item_type: string;
  count: number;
  confidence: number;
  note?: string | null;
}

// Raw items from Gemini can be strings OR objects - normalize them
type RawDetectedItem = string | DetectedItem | { item_type?: string; type?: string; name?: string };

interface SpaceAnalysisEntry {
  space_id: string;
  space_class?: "room" | "zone";
  inferred_usage: string;
  confidence: number;
  dimensions_summary?: string | null;
  detected_items?: RawDetectedItem[];
}

interface SpaceAnalysisData {
  rooms?: SpaceAnalysisEntry[];
  zones?: SpaceAnalysisEntry[];
  rooms_count?: number;
  zones_count?: number;
  overall_notes?: string;
}

/**
 * Normalize detected items from various formats to consistent DetectedItem objects
 * Gemini sometimes returns simple strings like ["sofa", "bed"] or objects
 */
function normalizeDetectedItems(rawItems: RawDetectedItem[] | undefined | null): DetectedItem[] {
  if (!rawItems || !Array.isArray(rawItems)) return [];

  return rawItems.map(item => {
    // Handle simple string format: "sofa" or "bed"
    if (typeof item === "string") {
      return {
        item_type: item,
        count: 1,
        confidence: 0.8,
        note: null
      };
    }

    // Handle object format with various possible keys
    if (typeof item === "object" && item !== null) {
      const itemObj = item as Record<string, unknown>;
      const itemType = (itemObj.item_type || itemObj.type || itemObj.name || "unknown") as string;
      return {
        item_type: itemType,
        count: (typeof itemObj.count === "number" ? itemObj.count : 1),
        confidence: (typeof itemObj.confidence === "number" ? itemObj.confidence : 0.8),
        note: (typeof itemObj.note === "string" ? itemObj.note : null)
      };
    }

    // Fallback for unexpected formats
    return {
      item_type: String(item),
      count: 1,
      confidence: 0.5,
      note: null
    };
  });
}

/**
 * Determine if a room classification indicates a master bedroom
 */
function isMasterBedroom(usage: string | undefined | null): boolean {
  if (!usage) return false;
  const lowerUsage = usage.toLowerCase();
  return lowerUsage.includes("master") ||
    lowerUsage.includes("primary bedroom") ||
    lowerUsage.includes("main bedroom");
}

/**
 * Check if detected items include a specific bed type
 */
function getDetectedBedInfo(items: DetectedItem[]): { hasBed: boolean; isDouble: boolean; isSingle: boolean; confidence: number } {
  for (const item of items) {
    const itemType = item.item_type || "";
    if (itemType.toLowerCase().includes("bed")) {
      const note = (item.note || "").toLowerCase();
      const isDouble = note.includes("double") || note.includes("queen") || note.includes("king");
      const isSingle = note.includes("single") || note.includes("twin");
      return { hasBed: true, isDouble, isSingle, confidence: item.confidence };
    }
  }
  return { hasBed: false, isDouble: false, isSingle: false, confidence: 0 };
}

/**
 * Determine if a room is small based on dimensions summary
 */
function isSmallRoom(dimensionsSummary: string | null | undefined): boolean {
  if (!dimensionsSummary) return false;

  // Parse dimension strings like "approx. 3m x 3m" or "approx 2.5m x 3.5m"
  const match = dimensionsSummary.match(/(\d+(?:\.\d+)?)\s*m?\s*[x×]\s*(\d+(?:\.\d+)?)\s*m?/i);
  if (match) {
    const dim1 = parseFloat(match[1]);
    const dim2 = parseFloat(match[2]);
    const area = dim1 * dim2;
    // Rooms under 10 sqm are considered small for bed sizing
    return area < 10;
  }
  return false;
}

/**
 * Build furniture constraints block for a specific room based on space analysis
 */
function buildRoomFurnitureConstraints(room: SpaceAnalysisEntry): string {
  // Normalize items from various AI response formats
  const items = normalizeDetectedItems(room.detected_items);
  const usage = room.inferred_usage;
  const isMaster = isMasterBedroom(usage);
  const bedInfo = getDetectedBedInfo(items);
  const isSmall = isSmallRoom(room.dimensions_summary);

  // Format detected items list
  const itemsList = items
    .filter(i => i.confidence >= 0.6)
    .map(i => {
      let itemStr = `${i.item_type}`;
      if (i.count > 1) itemStr += ` (×${i.count})`;
      if (i.note) itemStr += ` [${i.note}]`;
      return itemStr;
    });

  let constraints = `\n  ${usage}:`;

  // Add detected furniture
  if (itemsList.length > 0) {
    constraints += `\n    - DETECTED FURNITURE: ${itemsList.join(", ")}`;
    constraints += `\n    - PRESERVE: Place these exact items as shown in the plan`;
  } else {
    constraints += `\n    - NO FURNITURE DETECTED: Use conservative defaults for room type`;
  }

  // Bed size rules for bedrooms
  if (usage.toLowerCase().includes("bedroom")) {
    if (isMaster) {
      // Master bedroom
      if (bedInfo.hasBed && bedInfo.isDouble) {
        constraints += `\n    - BED: Double/queen bed ALLOWED (detected in plan)`;
      } else if (bedInfo.hasBed && bedInfo.isSingle) {
        constraints += `\n    - BED: Single bed detected - use single bed`;
      } else if (!bedInfo.hasBed) {
        constraints += `\n    - BED: Double bed allowed for master if room is large enough`;
      }
    } else {
      // Non-master bedrooms (secondary, guest, child)
      if (bedInfo.hasBed && bedInfo.isDouble && bedInfo.confidence >= 0.8) {
        constraints += `\n    - BED: Double bed detected with high confidence - ALLOWED`;
      } else if (bedInfo.hasBed && bedInfo.isSingle) {
        constraints += `\n    - BED: Single/twin bed REQUIRED (detected in plan)`;
      } else if (isSmall) {
        constraints += `\n    - BED: SINGLE/TWIN ONLY (room too small for double bed)`;
        constraints += `\n    - ⚠️ PROHIBITED: Double/queen/king bed in this room`;
      } else {
        constraints += `\n    - BED: Default to SINGLE/TWIN bed unless clearly a large secondary bedroom`;
        constraints += `\n    - ⚠️ CAUTION: Avoid double beds in non-master bedrooms unless plan evidence exists`;
      }
    }
  }

  // Dimension guidance
  if (room.dimensions_summary) {
    constraints += `\n    - ROOM SIZE: ${room.dimensions_summary} - scale furniture accordingly`;
  }

  return constraints;
}

/**
 * Build the complete furniture constraints block from space analysis
 */
function buildFurnitureConstraintsBlock(spaceAnalysis: SpaceAnalysisData | null | undefined): string {
  if (!spaceAnalysis) {
    return `FURNITURE PLACEMENT:
- Use standard furniture appropriate to each room type.
- Scale all furniture realistically to room dimensions.`;
  }

  const rooms = spaceAnalysis.rooms || [];
  if (rooms.length === 0) {
    return `FURNITURE PLACEMENT:
- Use standard furniture appropriate to each room type.
- Scale all furniture realistically to room dimensions.`;
  }

  let block = `FURNITURE & LAYOUT CONSTRAINTS (LOCKED FROM SPACE ANALYSIS):
- furniture_constraints_locked: TRUE
- Source: AI Space Analysis detected ${rooms.length} room(s)

ROOM-SPECIFIC REQUIREMENTS:`;

  for (const room of rooms) {
    block += buildRoomFurnitureConstraints(room);
  }

  block += `

CRITICAL FURNITURE RULES:
- PRESERVE detected furniture types and approximate placement from the plan
- DO NOT add large furniture not shown in the plan (especially beds, sofas)
- DO NOT place double beds in small/secondary bedrooms unless explicitly detected
- Scale ALL furniture to fit realistically within measured room dimensions
- If no furniture detected for a room, use CONSERVATIVE defaults (smaller is safer)

BED SIZE DEFAULTS (if no detection):
- Master Bedroom: Double/Queen allowed
- Secondary/Child Bedroom: Single/Twin ONLY unless room is large (>12 sqm)
- Guest Bedroom: Single/Twin preferred`;

  return block;
}

/**
 * Build Step 2 layout preservation constraints
 */
function buildStep2LayoutPreservationBlock(spaceAnalysis: SpaceAnalysisData | null | undefined): string {
  if (!spaceAnalysis || !spaceAnalysis.rooms || spaceAnalysis.rooms.length === 0) {
    return `LAYOUT PRESERVATION (CRITICAL):
- KEEP LAYOUT AND FURNITURE TYPES/SIZES THE SAME
- ONLY CHANGE: Colors, materials, textures, lighting mood
- DO NOT CHANGE: Furniture positions, types, or sizes`;
  }

  const rooms = spaceAnalysis.rooms;
  let block = `LAYOUT & FURNITURE PRESERVATION (LOCKED - Step 2 is STYLING ONLY):

CRITICAL - WHAT MUST NOT CHANGE:
- Furniture TYPES (a single bed stays a single bed, NOT replaced with double)
- Furniture SIZES (no scaling up or down)
- Furniture POSITIONS (same locations as Step 1 output)
- Room proportions and layout
- Door and window positions

ROOM-BY-ROOM FURNITURE LOCKS:`;

  for (const room of rooms) {
    // Normalize items from various AI response formats
    const items = normalizeDetectedItems(room.detected_items);
    const itemNames = items.filter(i => i.confidence >= 0.6).map(i => i.item_type);
    if (itemNames.length > 0) {
      block += `\n  ${room.inferred_usage}: Keep ${itemNames.join(", ")}`;
    } else {
      block += `\n  ${room.inferred_usage}: Preserve all furniture from Step 1`;
    }
  }

  block += `

WHAT CAN CHANGE (STYLE ONLY):
- Material finishes and textures
- Color palette and color temperature
- Lighting mood and ambiance
- Decorative elements and accessories
- Wall/floor/ceiling finishes`;

  return block;
}

async function extractWallGeometryFromFloorPlan(
  imageBase64: string,
  apiKey: string
): Promise<WallGeometryResult> {
  console.log(`[GEOMETRY EXTRACTION] Analyzing floor plan for wall geometry...`);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: WALL_GEOMETRY_EXTRACTION_PROMPT },
              {
                type: "image_url",
                image_url: { url: `data:image/jpeg;base64,${imageBase64}`, detail: "high" }
              }
            ]
          }
        ],
        max_completion_tokens: 2000
      })
    });

    if (!response.ok) {
      console.warn(`[GEOMETRY EXTRACTION] API error: ${response.status}`);
      return {
        has_non_orthogonal_walls: false,
        has_curved_walls: false,
        has_diagonal_corners: false,
        has_chamfers: false,
        geometry_notes: "Geometry analysis failed - assuming standard orthogonal layout",
        confidence: 0,
        detected_features: []
      };
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content || "";

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn(`[GEOMETRY EXTRACTION] No JSON found in response`);
      return {
        has_non_orthogonal_walls: false,
        has_curved_walls: false,
        has_diagonal_corners: false,
        has_chamfers: false,
        geometry_notes: "Geometry analysis parse failed",
        confidence: 0,
        detected_features: []
      };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const geometryResult: WallGeometryResult = {
      has_non_orthogonal_walls: parsed.has_non_orthogonal_walls ?? false,
      has_curved_walls: parsed.has_curved_walls ?? false,
      has_diagonal_corners: parsed.has_diagonal_corners ?? false,
      has_chamfers: parsed.has_chamfers ?? false,
      geometry_notes: parsed.geometry_notes || "",
      confidence: parsed.confidence ?? 0.5,
      detected_features: parsed.detected_features || []
    };

    const hasNonStandard = geometryResult.has_non_orthogonal_walls ||
      geometryResult.has_curved_walls ||
      geometryResult.has_diagonal_corners ||
      geometryResult.has_chamfers;

    console.log(`[GEOMETRY EXTRACTION] Non-standard geometry: ${hasNonStandard}`);
    if (hasNonStandard) {
      console.log(`[GEOMETRY EXTRACTION] Features detected:`, geometryResult.detected_features.length);
      console.log(`[GEOMETRY EXTRACTION] Types: angled=${geometryResult.has_non_orthogonal_walls}, curved=${geometryResult.has_curved_walls}, diagonal=${geometryResult.has_diagonal_corners}, chamfer=${geometryResult.has_chamfers}`);
    }

    return geometryResult;
  } catch (error) {
    console.error(`[GEOMETRY EXTRACTION] Error:`, error);
    return {
      has_non_orthogonal_walls: false,
      has_curved_walls: false,
      has_diagonal_corners: false,
      has_chamfers: false,
      geometry_notes: "Geometry analysis error",
      confidence: 0,
      detected_features: []
    };
  }
}

async function extractDimensionsAndGeometryFromFloorPlan(
  imageBase64: string,
  apiKey: string
): Promise<DimensionAnalysisResult> {
  console.log(`[FLOOR PLAN ANALYSIS] Starting dimension and geometry extraction...`);

  // Run dimension extraction and geometry extraction in parallel
  const [dimensionResult, geometryResult] = await Promise.all([
    extractDimensionsOnly(imageBase64, apiKey),
    extractWallGeometryFromFloorPlan(imageBase64, apiKey)
  ]);

  // Combine results
  const analysisResult: DimensionAnalysisResult = {
    ...dimensionResult,
    wall_geometry: geometryResult
  };

  // Rebuild scale guidance with geometry info included
  analysisResult.scale_guidance_text = buildScaleGuidanceBlock(analysisResult);

  return analysisResult;
}

async function extractDimensionsOnly(
  imageBase64: string,
  apiKey: string
): Promise<DimensionAnalysisResult> {
  console.log(`[DIMENSION EXTRACTION] Starting dimension extraction from floor plan...`);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: DIMENSION_EXTRACTION_PROMPT },
              {
                type: "image_url",
                image_url: { url: `data:image/jpeg;base64,${imageBase64}`, detail: "high" }
              }
            ]
          }
        ],
        max_completion_tokens: 2000
      })
    });

    if (!response.ok) {
      console.warn(`[DIMENSION EXTRACTION] API error: ${response.status}`);
      return {
        dimensions_found: false,
        units: "unknown",
        extracted_dimensions: [],
        scale_guidance_text: "",
        scale_locked: false
      };
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content || "";

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn(`[DIMENSION EXTRACTION] No JSON found in response`);
      return {
        dimensions_found: false,
        units: "unknown",
        extracted_dimensions: [],
        scale_guidance_text: "",
        scale_locked: false
      };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const analysisResult: DimensionAnalysisResult = {
      dimensions_found: parsed.dimensions_found ?? false,
      units: parsed.units || "unknown",
      extracted_dimensions: parsed.extracted_dimensions || [],
      overall_dimensions: parsed.overall_dimensions,
      scale_guidance_text: "",
      scale_locked: parsed.dimensions_found ?? false
    };

    console.log(`[DIMENSION EXTRACTION] Found ${analysisResult.extracted_dimensions.length} dimensions`);
    console.log(`[DIMENSION EXTRACTION] Units: ${analysisResult.units}, Scale locked: ${analysisResult.scale_locked}`);
    if (analysisResult.dimensions_found) {
      console.log(`[DIMENSION EXTRACTION] Key dimensions:`, analysisResult.extracted_dimensions.slice(0, 3).map(d => d.raw_text));
    }

    return analysisResult;
  } catch (error) {
    console.error(`[DIMENSION EXTRACTION] Error:`, error);
    return {
      dimensions_found: false,
      units: "unknown",
      extracted_dimensions: [],
      scale_guidance_text: "",
      scale_locked: false
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// STEP TEMPLATES
// ═══════════════════════════════════════════════════════════════════════════

// Prompt templates for each step (4 steps now - removed Approval Gate)
// Step 1 base template - scale guidance is injected dynamically
// NOTE: Text overlay preservation IS applied to Step 1 generation prompts.
// The original room labels from the floor plan MUST be preserved in the output.
// However, QA for Step 1 does NOT check text - it focuses on structural/layout correctness.
const STEP_1_BASE_TEMPLATE = `Convert the uploaded 2D floor plan into a clean, top-down 3D render.

═══════════════════════════════════════════════════════════════════════════
TEXT & LABEL PRESERVATION (MANDATORY)
═══════════════════════════════════════════════════════════════════════════
CRITICAL: The original floor plan contains room name labels/text overlays.
These labels MUST be preserved EXACTLY as they appear in the source image.

- KEEP ALL ORIGINAL TEXT FROM THE UPLOADED FLOOR PLAN
- DO NOT REMOVE ANY TEXT
- DO NOT ADD ANY NEW TEXT
- DO NOT EDIT, REWRITE, OR TRANSLATE EXISTING TEXT
- PRESERVE THE ORIGINAL TEXT CONTENT AND POSITIONS EXACTLY
═══════════════════════════════════════════════════════════════════════════

STRICT REQUIREMENTS:
- KEEP THE LAYOUT EXACT.
- Do NOT change wall positions, room sizes, proportions, or orientation.
- Doors and openings must remain in the same locations as in the plan.
- No creative reinterpretation of geometry.

{SCALE_GUIDANCE_BLOCK}

{FURNITURE_CONSTRAINTS_BLOCK}

RENDER STYLE:
- Top-down 3D perspective (architectural axonometric feel).
- Simple, realistic furniture matching each room's function.
- Neutral modern materials.
- Soft, even daylight.
- Clean background, no clutter.

FURNITURE SCALE RULES:
- All furniture must be realistically proportioned to the room dimensions.
- Do NOT place oversized furniture in small rooms.
- Do NOT place miniature furniture in large rooms.
- Standard door height: ~2.1m (7 ft).
- Standard ceiling height: 2.4-2.7m (8-9 ft).

GOAL:
A clear and accurate 3D visualization that faithfully represents the original 2D floor plan with correctly scaled furniture, room-appropriate bed sizes, and ALL ORIGINAL ROOM LABELS PRESERVED.`;

const STEP_TEMPLATES = {
  1: STEP_1_BASE_TEMPLATE,

  2: `Apply a DESIGN STYLE CHANGE to the interior render based on the input image.

DESIGN STYLE FOCUS (Step 2 is strictly about design, not camera):
- Apply the desired interior design aesthetic
- Update materials, finishes, and textures as specified
- Adjust color palette and lighting mood
- Ensure furniture style consistency with the chosen aesthetic
- Maintain photorealistic quality throughout

{LAYOUT_PRESERVATION_BLOCK}

CRITICAL - DO NOT CHANGE:
- Room geometry, proportions, or layout
- Wall positions, doors, windows locations
- Camera angle or perspective (keep same as input)
- Furniture TYPES or SIZES (a single bed MUST remain a single bed)
- Furniture POSITIONS (same locations as input)

${TEXT_OVERLAY_PRESERVATION_COMPACT}

GOAL:
Transform the visual design style while preserving the exact spatial configuration, furniture types/sizes, and camera view from the input.`,

  4: (cameraPosition: string, forwardDirection: string) => `Using the provided image as the ONLY reference, generate a photorealistic 360° equirectangular interior panorama.

Camera:
- Height: standing eye level (~1.6m)
- Position: ${cameraPosition}

Primary forward direction (0° yaw):
- Facing ${forwardDirection}

Preserve exactly (no redesign, no replacements):
- All furniture visible in the reference image
- All fixed elements (windows, doors, columns)
- Floor material and wood plank direction
- Wall curvature, room proportions, ceiling height

Do NOT add, remove, or reinterpret any elements.

Lighting:
- Natural daylight from windows
- Physically correct light direction and realistic falloff
- No dramatic or artificial lighting

Panorama requirements:
- True 360° equirectangular panorama (2:1)
- No fisheye circle
- No warped geometry
- Straight verticals and correct perspective
- Suitable for virtual tour viewers

Style:
- Photorealistic interior
- Real-world scale and materials
- Neutral camera, human-eye perspective`
};

// Step 3 Camera Presets - EYE-LEVEL ONLY (no corner, top-down, or overview shots)
const STEP_3_CAMERA_PRESETS = [
  {
    id: "eye_level_living_room",
    name: "Eye-Level – Living Room",
    viewpoint: "eye-level",
    yaw_target: "living_room",
    framing: "normal",
    height: "eye-level",
    prompt: `Generate a photorealistic interior render from EYE-LEVEL in the living room.

CAMERA REQUIREMENTS:
- Position: Standing eye-level (150-160 cm) in the living room area
- Yaw: Looking toward the main seating arrangement and focal point
- Lens: Normal focal length (40-50mm equivalent) for natural perspective
- Height: MUST be eye-level (150-160 cm) - NOT top-down, NOT corner, NOT overhead

SCENE REQUIREMENTS:
- Maintain EXACT geometry, furniture placement, and proportions from the input
- DO NOT move, resize, or add any furniture
- Photorealistic lighting with natural daylight
- Clean, professional interior photography style

OUTPUT:
A single high-quality photorealistic interior photograph from eye-level in the living room.`
  },
  {
    id: "eye_level_kitchen",
    name: "Eye-Level – Kitchen",
    viewpoint: "eye-level",
    yaw_target: "kitchen",
    framing: "normal",
    height: "eye-level",
    prompt: `Generate a photorealistic interior render from EYE-LEVEL in the kitchen.

CAMERA REQUIREMENTS:
- Position: Standing eye-level (150-160 cm) in or near the kitchen
- Yaw: Looking toward the kitchen counter, island, or cooking area
- Lens: Normal focal length (40-50mm equivalent) for natural perspective
- Height: MUST be eye-level (150-160 cm) - NOT top-down, NOT corner, NOT overhead

SCENE REQUIREMENTS:
- Maintain EXACT geometry, furniture placement, and proportions from the input
- DO NOT move, resize, or add any furniture
- Photorealistic lighting with natural daylight
- Clean, professional interior photography style

OUTPUT:
A single high-quality photorealistic interior photograph from eye-level in the kitchen.`
  },
  {
    id: "eye_level_dining",
    name: "Eye-Level – Dining Area",
    viewpoint: "eye-level",
    yaw_target: "dining",
    framing: "normal",
    height: "eye-level",
    prompt: `Generate a photorealistic interior render from EYE-LEVEL at the dining area.

CAMERA REQUIREMENTS:
- Position: Standing eye-level (150-160 cm) near the dining table
- Yaw: Looking toward the dining setup with table and chairs visible
- Lens: Normal focal length (40-50mm equivalent) for natural perspective
- Height: MUST be eye-level (150-160 cm) - NOT top-down, NOT corner, NOT overhead

SCENE REQUIREMENTS:
- Maintain EXACT geometry, furniture placement, and proportions from the input
- DO NOT move, resize, or add any furniture
- Photorealistic lighting with natural daylight
- Clean, professional interior photography style

OUTPUT:
A single high-quality photorealistic interior photograph from eye-level at the dining area.`
  },
  {
    id: "eye_level_bedroom",
    name: "Eye-Level – Bedroom",
    viewpoint: "eye-level",
    yaw_target: "bedroom",
    framing: "normal",
    height: "eye-level",
    prompt: `Generate a photorealistic interior render from EYE-LEVEL in the bedroom.

CAMERA REQUIREMENTS:
- Position: Standing eye-level (150-160 cm) in the bedroom
- Yaw: Looking toward the bed and main sleeping area
- Lens: Normal focal length (40-50mm equivalent) for natural perspective
- Height: MUST be eye-level (150-160 cm) - NOT top-down, NOT corner, NOT overhead

SCENE REQUIREMENTS:
- Maintain EXACT geometry, furniture placement, and proportions from the input
- DO NOT move, resize, or add any furniture
- Photorealistic lighting with natural daylight
- Clean, professional interior photography style

OUTPUT:
A single high-quality photorealistic interior photograph from eye-level in the bedroom.`
  },
  {
    id: "eye_level_corridor",
    name: "Eye-Level – Corridor",
    viewpoint: "eye-level",
    yaw_target: "corridor",
    framing: "normal",
    height: "eye-level",
    prompt: `Generate a photorealistic interior render from EYE-LEVEL in the corridor/hallway.

CAMERA REQUIREMENTS:
- Position: Standing eye-level (150-160 cm) in the corridor or hallway
- Yaw: Looking down the length of the corridor
- Lens: Normal focal length (40-50mm equivalent) for natural perspective
- Height: MUST be eye-level (150-160 cm) - NOT top-down, NOT corner, NOT overhead

SCENE REQUIREMENTS:
- Maintain EXACT geometry, furniture placement, and proportions from the input
- DO NOT move, resize, or add any furniture
- Photorealistic lighting with natural daylight
- Clean, professional interior photography style

OUTPUT:
A single high-quality photorealistic interior photograph from eye-level in the corridor.`
  },
  {
    id: "eye_level_entrance",
    name: "Eye-Level – Entrance",
    viewpoint: "eye-level",
    yaw_target: "entrance",
    framing: "normal",
    height: "eye-level",
    prompt: `Generate a photorealistic interior render from EYE-LEVEL at the entrance.

CAMERA REQUIREMENTS:
- Position: Standing eye-level (150-160 cm) near the entrance/foyer
- Yaw: Looking into the main living space from the entrance perspective
- Lens: Normal focal length (40-50mm equivalent) for natural perspective
- Height: MUST be eye-level (150-160 cm) - NOT top-down, NOT corner, NOT overhead

SCENE REQUIREMENTS:
- Maintain EXACT geometry, furniture placement, and proportions from the input
- DO NOT move, resize, or add any furniture
- Photorealistic lighting with natural daylight
- Clean, professional interior photography style

OUTPUT:
A single high-quality photorealistic interior photograph from eye-level at the entrance.`
  }
];

// Parse rejection reason to determine camera adjustment strategy
function parseRejectionReason(reason: string): {
  changeViewpoint: boolean;
  changeYaw: boolean;
  changeFraming: boolean;
  suggestedChange: string;
} {
  const lower = reason.toLowerCase();

  if (lower.includes("same angle") || lower.includes("too similar") || lower.includes("identical")) {
    return { changeViewpoint: true, changeYaw: true, changeFraming: false, suggestedChange: "different_viewpoint" };
  }
  if (lower.includes("zoomed") || lower.includes("too close") || lower.includes("cramped")) {
    return { changeViewpoint: false, changeYaw: false, changeFraming: true, suggestedChange: "wider_framing" };
  }
  if (lower.includes("wrong focus") || lower.includes("facing wrong") || lower.includes("look at")) {
    return { changeViewpoint: false, changeYaw: true, changeFraming: false, suggestedChange: "different_yaw" };
  }
  if (lower.includes("not realistic") || lower.includes("distorted")) {
    return { changeViewpoint: false, changeYaw: false, changeFraming: true, suggestedChange: "normal_lens" };
  }

  // Default: change at least viewpoint and yaw
  return { changeViewpoint: true, changeYaw: true, changeFraming: false, suggestedChange: "full_change" };
}

// Select next camera preset avoiding previously used ones
function selectStep3CameraPreset(
  usedPresetIds: string[],
  rejectionReason?: string
): typeof STEP_3_CAMERA_PRESETS[0] | null {
  const availablePresets = STEP_3_CAMERA_PRESETS.filter(p => !usedPresetIds.includes(p.id));

  if (availablePresets.length === 0) {
    console.log("[Step 3] All presets exhausted, cycling with increased variation");
    // Reset and use first available with modified prompt
    return STEP_3_CAMERA_PRESETS[0];
  }

  if (rejectionReason) {
    const adjustments = parseRejectionReason(rejectionReason);
    console.log(`[Step 3] Rejection analysis:`, adjustments);

    // Find a preset that differs in the required ways
    const lastUsed = STEP_3_CAMERA_PRESETS.find(p => p.id === usedPresetIds[usedPresetIds.length - 1]);
    if (lastUsed) {
      for (const preset of availablePresets) {
        let changes = 0;
        if (adjustments.changeViewpoint && preset.viewpoint !== lastUsed.viewpoint) changes++;
        if (adjustments.changeYaw && preset.yaw_target !== lastUsed.yaw_target) changes++;
        if (adjustments.changeFraming && preset.framing !== lastUsed.framing) changes++;

        // Must change at least 2 parameters
        if (changes >= 2) {
          console.log(`[Step 3] Selected preset ${preset.id} with ${changes} changes from previous`);
          return preset;
        }
      }
    }
  }

  // Default: return first available
  console.log(`[Step 3] Using first available preset: ${availablePresets[0].id}`);
  return availablePresets[0];
}

// ═══════════════════════════════════════════════════════════════════════════
// ALLOWED PHASES FOR THIS FUNCTION (Steps 1-2 only)
// ═══════════════════════════════════════════════════════════════════════════
const ALLOWED_PHASES = [
  "space_analysis_complete",  // Allow starting Step 1 from completed space analysis
  "top_down_3d_pending", "top_down_3d_running", "top_down_3d_review",  // Added review phase for re-runs
  "style_pending", "style_running", "style_review",  // Added review phase for re-runs
];

serve(async (req) => {
  // Handle OPTIONS preflight FIRST (before any env var usage)
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,  // Explicit 200 status
      headers: corsHeaders
    });
  }

  // Load critical env vars AFTER OPTIONS handler (prevents init failures)
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("[STEP_ERROR:ENV_MISSING] Required environment variables not set");
    return new Response(JSON.stringify({
      error: "Server configuration error - missing environment variables",
      error_code: "ENV_MISSING"
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  const actionId = crypto.randomUUID();
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      console.error("[STEP_ERROR:AUTH_MISSING] Missing authorization header");
      return new Response(JSON.stringify({
        error: "Missing authorization header",
        error_code: "AUTH_MISSING"
      }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Check for internal retry (service-to-service call with service role key)
    const isInternalRetry = req.headers.get("x-internal-retry") === "true";
    const retryUserId = req.headers.get("x-retry-user-id");

    let user: { id: string } | null = null;

    if (isInternalRetry && retryUserId) {
      // Internal retry from auto-retry mechanism - trust the user ID header
      // This is safe because only service role key can set x-internal-retry header
      const token = authHeader.replace("Bearer ", "");
      if (token === SUPABASE_SERVICE_ROLE_KEY) {
        user = { id: retryUserId };
        console.log(`[run-pipeline-step] Internal retry for user ${retryUserId}`);
      } else {
        console.error("[STEP_ERROR:AUTH_INVALID] Unauthorized: Invalid service role key for internal retry");
        return new Response(JSON.stringify({
          error: "Unauthorized: Invalid service role key for internal retry",
          error_code: "AUTH_INVALID"
        }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    } else {
      // Normal user request - validate JWT
      const supabaseUser = createClient(
        SUPABASE_URL,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } }
      );
      const { data: authData, error: userError } = await supabaseUser.auth.getUser();
      if (userError || !authData?.user) {
        console.error("[STEP_ERROR:AUTH_INVALID] JWT validation failed:", userError);
        return new Response(JSON.stringify({
          error: "Unauthorized",
          error_code: "AUTH_INVALID"
        }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      user = authData.user;
    }

    if (!user) {
      console.error("[STEP_ERROR:AUTH_INVALID] User validation failed - user is null");
      return new Response(JSON.stringify({
        error: "Unauthorized",
        error_code: "AUTH_INVALID"
      }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const { pipeline_id, step_number, whole_apartment_mode, camera_position, forward_direction, design_ref_upload_ids, style_title, output_count, auto_rerender_attempt, step_3_preset_id, step_3_custom_prompt } = await req.json();

    if (!pipeline_id) {
      console.error("[STEP_ERROR:INVALID_REQUEST] pipeline_id is required");
      return new Response(JSON.stringify({
        error: "pipeline_id is required",
        error_code: "INVALID_REQUEST"
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP_START: Log every invocation for diagnostic purposes
    // ═══════════════════════════════════════════════════════════════════════════
    console.log(`[STEP_START] Function invoked`, {
      action_id: actionId,
      pipeline_id: pipeline_id,
      step_number: step_number,
      whole_apartment_mode: whole_apartment_mode,
      user_id: user.id,
      timestamp: new Date().toISOString()
    });

    // Emit invocation event (before any logic) - proves edge function was reached
    try {
      await supabaseAdmin.from("floorplan_pipeline_events").insert({
        pipeline_id: pipeline_id,
        owner_id: user.id,
        step_number: step_number ?? 0,
        type: "function_invoked",
        message: `Edge function run-pipeline-step invoked for step ${step_number ?? "auto"}`,
        progress_int: 0
      });
    } catch (eventError) {
      console.error(`[STEP_ERROR:EVENT_INSERT_FAILED] Could not write invocation event:`, eventError);
      // Continue anyway - don't fail the entire request due to event logging failure
    }

    // Style title for Step 2 (human-readable name from suggestion selection)
    const selectedStyleTitle: string | null = style_title || null;

    // Number of outputs to generate (1-4 for Steps 2, 3, 4; always 1 for Step 1)
    const requestedOutputCount = Math.max(1, Math.min(4, parseInt(output_count) || 1));

    // Auto-rerender tracking for panorama QA rejection
    const MAX_AUTO_RERENDER_ATTEMPTS = 4;
    const currentAutoAttempt = parseInt(auto_rerender_attempt) || 0;

    // Get pipeline with minimal JSON sub-fields to avoid memory blowup
    // NOTE: PostgREST returns JSON path selects as separate columns with the alias name
    const { data: pipelineData, error: pipelineError } = await supabaseAdmin
      .from("floorplan_pipelines")
      .select(`
        id,
        project_id,
        owner_id,
        floor_plan_upload_id,
        current_step,
        status,
        camera_position,
        forward_direction,
        output_resolution,
        aspect_ratio,
        architecture_version,
        pipeline_mode,
        whole_apartment_phase,
        step_outputs,
        floor_plan:uploads!floorplan_pipelines_floor_plan_upload_id_fkey(bucket,path,original_filename,mime_type)
      `)
      .eq("id", pipeline_id)
      .eq("owner_id", user.id)
      .single();

    if (pipelineError || !pipelineData) {
      console.error(`[RUN_PIPELINE_STEP] Failed to load pipeline: ${pipelineError?.message || 'No data'}`);
      throw new Error(`Failed to load pipeline: ${pipelineError?.message || 'Pipeline not found'}`);
    }

    const pipeline = pipelineData as any;

    // Parse step output IDs from step_outputs to avoid memory issues with large prompts later
    // We extract just what we need here and avoid using the full step_outputs until persistence
    const initialOutputs = (pipeline?.step_outputs || {}) as Record<string, any>;
    const step1OutputId = initialOutputs.step1?.output_upload_id || null;
    const step2OutputId = initialOutputs.step2?.output_upload_id || null;
    const step3OutputId = initialOutputs.step3?.output_upload_id || null;
    const step4OutputId = initialOutputs.step4?.output_upload_id || null;
    const step3CameraAngleFromDb = initialOutputs.step3?.camera_angle || null;
    const spaceAnalysis = initialOutputs.space_analysis || null;
    const dimensionAnalysis = initialOutputs.dimension_analysis || null;
    const designReferenceIds = initialOutputs.design_reference_ids || null;
    const referenceStyleAnalysis = initialOutputs.reference_style_analysis || null;

    // ═══════════════════════════════════════════════════════════════════════════
    // CRITICAL: Validate Step 1 approval before running Step 2
    // ═══════════════════════════════════════════════════════════════════════════
    if (currentStep === 2) {
      const step1Data = initialOutputs.step1 as any;
      const step1Approved = step1Data?.manual_approved === true;

      if (!step1Approved) {
        console.error(`[run-pipeline-step] Step 2 blocked: Step 1 not approved`);
        throw new Error(
          `Step 1 must be approved before running Step 2. ` +
          `Please approve Step 1 output before proceeding.`
        );
      }

      console.log(`[run-pipeline-step] Step 2: Step 1 approval verified ✓`);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // DESIGN REFERENCE DATA FLOW FIX: Ensure IDs are present for Step 2 logic
    // Priority: 1) Request body, 2) DB step_outputs, 3) referenceStyleAnalysis metadata
    // ═══════════════════════════════════════════════════════════════════════════
    let designRefIds: string[] = Array.isArray(design_ref_upload_ids) ? design_ref_upload_ids : [];

    if (designRefIds.length === 0) {
      if (Array.isArray(initialOutputs.design_reference_ids)) {
        designRefIds = initialOutputs.design_reference_ids;
        console.log(`[run-pipeline-step] Using ${designRefIds.length} design reference(s) from database (design_reference_ids)`);
      } else if (referenceStyleAnalysis?.design_ref_ids && Array.isArray(referenceStyleAnalysis.design_ref_ids)) {
        designRefIds = referenceStyleAnalysis.design_ref_ids;
        console.log(`[run-pipeline-step] Using ${designRefIds.length} design reference(s) from analysis metadata (design_ref_ids)`);
      }
    }

    // Clear reference to full step_outputs to free memory before heavy API calls
    delete pipeline.step_outputs;

    if (pipelineError || !pipeline) {
      await emitStepError(
        supabaseAdmin,
        pipeline_id,
        user.id,
        step_number ?? 0,
        "PIPELINE_NOT_FOUND",
        `Pipeline ${pipeline_id} not found or access denied`
      );
      return new Response(JSON.stringify({
        error: "Pipeline not found",
        error_code: "PIPELINE_NOT_FOUND",
        action_id: actionId,
      }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Helper: fetch full step_outputs ONLY when we must do a read-modify-write persistence.
    // Keeping this out of the hot path avoids Step 2 memory blowups.
    const fetchFullStepOutputs = async (): Promise<Record<string, any>> => {
      const { data, error } = await supabaseAdmin
        .from("floorplan_pipelines")
        .select("step_outputs")
        .eq("id", pipeline_id)
        .eq("owner_id", user.id)
        .single();
      if (error || !data) throw new Error("Failed to load step outputs");
      return (data.step_outputs as Record<string, any>) || {};
    };

    // Use step_number from request body if provided (for explicit step invocation),
    // otherwise fall back to pipeline.current_step
    console.log(`[RUN_PIPELINE_STEP] Request step_number: ${step_number}, Pipeline current_step: ${pipeline.current_step}`);
    const currentStep = step_number ?? pipeline.current_step;
    const currentPhase = pipeline.whole_apartment_phase ?? "upload";
    console.log(`[RUN_PIPELINE_STEP] Resolved currentStep: ${currentStep}, currentPhase: ${currentPhase}`);

    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE GUARD: Validate this function is allowed for current phase
    // ═══════════════════════════════════════════════════════════════════════════
    console.log(`[RUN_PIPELINE_STEP] Action ${actionId} - Pipeline ${pipeline_id} current phase: ${currentPhase}, step: ${currentStep}`);

    // Step 0 (Space Analysis) is handled by run-space-analysis, NOT this function
    if (currentStep === 0) {
      await emitStepError(
        supabaseAdmin,
        pipeline_id,
        user.id,
        currentStep,
        "STEP0_ROUTER_ERROR",
        `Step 0 should use run-space-analysis function, not run-pipeline-step. Current phase: "${currentPhase}"`
      );

      return new Response(
        JSON.stringify({
          error: "Step 0 (Space Analysis) should use run-space-analysis function, not run-pipeline-step. Please check frontend call routing.",
          error_code: "STEP0_ROUTER_ERROR",
          hint: "Frontend routing should detect phase 'upload' or 'space_analysis_*' and route to run-space-analysis",
          current_phase: currentPhase,
          action_id: actionId,
        }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Strict phase validation for Steps 1-2 only
    if (!ALLOWED_PHASES.includes(currentPhase)) {
      // Provide helpful hints based on the actual phase
      let hint = "Check frontend routing configuration";
      if (currentPhase.startsWith("space_analysis") || currentPhase === "upload") {
        hint = "This phase should use run-space-analysis";
      } else if (currentPhase.startsWith("detect_spaces") || currentPhase === "detecting_spaces" || currentPhase === "camera_plan_confirmed") {
        hint = "This phase should use run-detect-spaces";
      } else if (currentPhase.startsWith("renders") || currentPhase.startsWith("panoramas") || currentPhase.startsWith("merging")) {
        hint = "This phase should use run-batch-space-renders, run-batch-space-panoramas, or run-batch-space-merges";
      }

      await emitStepError(
        supabaseAdmin,
        pipeline_id,
        user.id,
        currentStep,
        "PHASE_MISMATCH",
        `Cannot run Step ${currentStep} in phase "${currentPhase}". Expected: ${ALLOWED_PHASES.join(", ")}`
      );

      return new Response(
        JSON.stringify({
          error: `Phase mismatch: run-pipeline-step handles Steps 1-2 only, but pipeline is at phase "${currentPhase}"`,
          error_code: "PHASE_MISMATCH",
          hint,
          expected_phases: ALLOWED_PHASES,
          current_phase: currentPhase,
          action_id: actionId,
        }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Determine action name for logging
    const actionName = currentStep === 1 ? "TOP_DOWN_3D_START" : "STYLE_START";
    console.log(`[${actionName}] Pipeline ${pipeline_id}: Starting step ${currentStep}`);

    // For step 4, derive camera position from previous step outputs or use sensible defaults
    let effectiveCameraPosition = camera_position || pipeline.camera_position;
    let effectiveForwardDirection = forward_direction || pipeline.forward_direction;

    if (currentStep === 4 && (!effectiveCameraPosition || !effectiveForwardDirection)) {
      // Derive from Step 3 output if available
      if (step3CameraAngleFromDb) {
        // Use camera angle info from Step 3 to derive position (now eye-level only)
        const cameraInfo = (step3CameraAngleFromDb || "").toLowerCase();
        console.log(`[Step 4] Deriving camera from Step 3 camera angle: ${cameraInfo}`);

        // Map eye-level room areas to panorama positions
        if (cameraInfo.includes("living")) {
          effectiveCameraPosition = effectiveCameraPosition || "center of the living room at eye-level";
          effectiveForwardDirection = effectiveForwardDirection || "toward the main seating area";
        } else if (cameraInfo.includes("kitchen")) {
          effectiveCameraPosition = effectiveCameraPosition || "center of the kitchen at eye-level";
          effectiveForwardDirection = effectiveForwardDirection || "toward the kitchen counter/island";
        } else if (cameraInfo.includes("dining")) {
          effectiveCameraPosition = effectiveCameraPosition || "near the dining table at eye-level";
          effectiveForwardDirection = effectiveForwardDirection || "toward the main living space";
        } else if (cameraInfo.includes("bedroom")) {
          effectiveCameraPosition = effectiveCameraPosition || "center of the bedroom at eye-level";
          effectiveForwardDirection = effectiveForwardDirection || "toward the bed and main area";
        } else if (cameraInfo.includes("corridor") || cameraInfo.includes("hallway")) {
          effectiveCameraPosition = effectiveCameraPosition || "midpoint of the corridor at eye-level";
          effectiveForwardDirection = effectiveForwardDirection || "down the length of the corridor";
        } else if (cameraInfo.includes("entrance")) {
          effectiveCameraPosition = effectiveCameraPosition || "near room entrance at eye-level";
          effectiveForwardDirection = effectiveForwardDirection || "straight into the main living space";
        } else {
          effectiveCameraPosition = effectiveCameraPosition || "center of the main room at eye-level";
          effectiveForwardDirection = effectiveForwardDirection || "toward the primary focal point";
        }
      } else {
        // Sensible defaults for panorama
        effectiveCameraPosition = effectiveCameraPosition || "center of the main living space at eye-level";
        effectiveForwardDirection = effectiveForwardDirection || "toward the main window or feature wall";
      }

      console.log(`[Step 4] Using camera position: ${effectiveCameraPosition}, forward: ${effectiveForwardDirection}`);
    }

    // Update pipeline status AND whole_apartment_phase to running
    // CRITICAL: Setting whole_apartment_phase enables the "Live" indicator in the UI terminal
    const runningPhase = currentStep === 1 ? "top_down_3d_running" :
      currentStep === 2 ? "style_running" :
        `step${currentStep}_running`;

    console.log(`[${actionName}] Setting whole_apartment_phase to: ${runningPhase}`);

    const { error: updateError } = await supabaseAdmin
      .from("floorplan_pipelines")
      .update({
        current_step: currentStep,
        status: `step${currentStep}_running`,
        whole_apartment_phase: runningPhase,
        camera_position: effectiveCameraPosition || pipeline.camera_position,
        forward_direction: effectiveForwardDirection || pipeline.forward_direction,
        updated_at: new Date().toISOString()
      })
      .eq("id", pipeline_id);

    if (updateError) {
      await emitStepError(
        supabaseAdmin,
        pipeline_id,
        user.id,
        currentStep,
        "DB_UPDATE_ERROR",
        `Failed to update pipeline status: ${updateError.message}`
      );
      return new Response(JSON.stringify({
        error: `Failed to update pipeline status: ${updateError.message}`,
        error_code: "DB_UPDATE_ERROR",
        action_id: actionId,
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    await emitEvent(supabaseAdmin, pipeline_id, user.id, currentStep, "step_start", `Step ${currentStep} started (phase: ${runningPhase})`, (currentStep - 1) * 25);

    // Get input image (floor plan for step 1, previous step output for others)
    let inputUploadId: string;
    if (currentStep === 1) {
      // Step 1 (Top-Down 3D) uses the floor plan as input
      inputUploadId = pipeline.floor_plan_upload_id;

      // ============= VALIDATE INPUT IMAGE EXISTS =============
      if (!inputUploadId) {
        await emitStepError(
          supabaseAdmin,
          pipeline_id,
          user.id,
          1,
          "INPUT_IMAGE_MISSING",
          "floor_plan_upload_id is null - cannot run Step 1"
        );
        return new Response(JSON.stringify({
          error: "Floor plan upload is missing - cannot run Step 1",
          error_code: "INPUT_IMAGE_MISSING",
          action_id: actionId,
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      console.log(`[run-pipeline-step] Step 1: Using floor plan upload ${inputUploadId}`);
    } else {
      // For step 2+, get the previous completed step's output
      // Handle skipped steps: walk backwards to find the most recent valid output
      const stepOutputIds: Record<string, string | null> = {
        step1: step1OutputId,
        step2: step2OutputId,
        step3: step3OutputId,
        step4: step4OutputId,
      };
      console.log(`[run-pipeline-step] Step ${currentStep}: Looking for previous step output in: ${Object.keys(stepOutputIds).join(', ')}`);

      let prevStepOutput: string | null = null;
      let usedStepNumber = 0;

      // Walk backwards from the previous step to find a valid output
      for (let stepNum = currentStep - 1; stepNum >= 1; stepNum--) {
        const key = `step${stepNum}`;
        const id = stepOutputIds[key];
        if (id) {
          prevStepOutput = id;
          usedStepNumber = stepNum;
          break;
        }
      }

      if (!prevStepOutput) {
        console.error(`[run-pipeline-step] No valid previous step output found for step ${currentStep}`);
        throw new Error(`No previous step output found. Please ensure at least step 1 has completed successfully.`);
      }

      inputUploadId = prevStepOutput;
      console.log(`[run-pipeline-step] Step ${currentStep}: Using step ${usedStepNumber} output ${inputUploadId}`);
    }

    // Get signed URL for input image
    const { data: inputUpload } = await supabaseAdmin
      .from("uploads")
      .select("bucket, path")
      .eq("id", inputUploadId)
      .single();

    if (!inputUpload) {
      throw new Error("Input image not found");
    }

    // ═══════════════════════════════════════════════════════════════
    // AGGRESSIVE SERVER-SIDE IMAGE DOWNSCALING (Steps 1-4)
    // ═══════════════════════════════════════════════════════════════
    // CRITICAL: Apply transformation WHEN creating signed URL (not after)
    // Supabase requires transform options passed to createSignedUrl()
    // Adding params to URL afterwards doesn't work with signed URLs
    // ═══════════════════════════════════════════════════════════════
    const shouldDownscale = currentStep >= 1 && currentStep <= 4;

    // Create signed URL with transformations for Steps 1-4
    const signedUrlOptions: any = {};
    if (shouldDownscale) {
      console.log(`[IMAGE_DOWNSCALE] Step ${currentStep}: Creating signed URL with AGGRESSIVE transformations`);
      // Note: Supabase Storage transformations support 'origin' (keeps format)
      // Don't specify format to preserve original format while applying resize/quality
      signedUrlOptions.transform = {
        width: 1600,
        height: 1600,
        quality: 60,
        // format not specified = use original format (webp stays webp, png stays png, etc)
      };
      console.log(`[IMAGE_DOWNSCALE] Transform options:`, signedUrlOptions.transform);
    }

    const { data: signedUrlData, error: signedUrlError } = await supabaseAdmin.storage
      .from(inputUpload.bucket)
      .createSignedUrl(inputUpload.path, 3600, signedUrlOptions);

    if (signedUrlError || !signedUrlData?.signedUrl) {
      console.error("[IMAGE_DOWNSCALE] Failed to create signed URL:", {
        error: signedUrlError,
        bucket: inputUpload.bucket,
        path: inputUpload.path,
        uploadId: inputUploadId,
      });
      throw new Error(
        `Failed to get signed URL for input image: ${signedUrlError?.message || "Unknown error"}. ` +
        `Bucket: ${inputUpload.bucket}, Path: ${inputUpload.path}. ` +
        `Check that the file exists in storage and storage is properly configured.`
      );
    }

    const imageUrl = signedUrlData.signedUrl;
    console.log(`[IMAGE_DOWNSCALE] Signed URL created: ${imageUrl.substring(0, 120)}...`);

    await emitEvent(supabaseAdmin, pipeline_id, user.id, currentStep, "download_complete", "Input image loaded", (currentStep - 1) * 25 + 5);

    // Keep the signed URL around so QA can use it without base64 duplication
    const inputSignedUrl = signedUrlData.signedUrl;

    logMemory("before-load-input");

    // Download image bytes (with transformations applied if Step 1-4)
    console.log(`[IMAGE_DOWNSCALE] Fetching image...`);
    const imageResponse = await fetch(imageUrl);

    if (!imageResponse.ok) {
      throw new Error(`Failed to fetch image: ${imageResponse.status} ${imageResponse.statusText}`);
    }

    // Check Content-Length header to verify size before loading
    const contentLength = imageResponse.headers.get('content-length');
    if (contentLength) {
      const sizeMB = parseInt(contentLength) / 1024 / 1024;
      console.log(`[IMAGE_DOWNSCALE] Content-Length: ${sizeMB.toFixed(2)}MB`);

      // HARD LIMIT: Reject images > 15MB even after transformation
      if (sizeMB > 15) {
        throw new Error(
          `Image too large: ${sizeMB.toFixed(2)}MB (max 15MB). ` +
          `Storage transformations may not be enabled. ` +
          `Enable image transformations in Supabase Storage settings.`
        );
      }
    }

    const imageBuffer = (await imageResponse.arrayBuffer()) as ArrayBuffer;
    const imageBytes: Uint8Array = new Uint8Array(imageBuffer);

    // Log actual downloaded size
    const imageSizeMB = (imageBytes.length / 1024 / 1024).toFixed(2);
    console.log(`[IMAGE_DOWNSCALE] Downloaded: ${imageSizeMB}MB (${imageBytes.length} bytes)`);

    // CRITICAL CHECK: If image is still too large, transformations didn't work
    if (imageBytes.length > 15 * 1024 * 1024 && shouldDownscale) {
      console.error(`[IMAGE_DOWNSCALE] CRITICAL: Image is ${imageSizeMB}MB after transformation!`);
      console.error(`[IMAGE_DOWNSCALE] Storage transformations are NOT working.`);
      console.error(`[IMAGE_DOWNSCALE] Please enable image transformations in Supabase Storage.`);
      throw new Error(
        `Image transformations failed: Downloaded ${imageSizeMB}MB (expected < 15MB). ` +
        `Enable image transformations in your Supabase Storage bucket settings. ` +
        `Go to Storage → Select bucket → Settings → Enable "Image Transformations".`
      );
    }

    // Encode to base64
    let base64Image = encodeBase64FromBytes(imageBytes);
    const base64SizeMB = (base64Image.length * 0.75 / 1024 / 1024).toFixed(2);
    console.log(`[IMAGE_DOWNSCALE] Base64: ${base64SizeMB}MB (${base64Image.length} chars)`);

    // Verify dimensions after downscaling
    const dims = getImageDimensions(base64Image);
    if (dims) {
      console.log(`[IMAGE_DOWNSCALE] Dimensions: ${dims.width}×${dims.height} (${dims.format})`);

      if (shouldDownscale) {
        const longestSide = Math.max(dims.width, dims.height);
        if (longestSide > 1800) {
          console.warn(`[IMAGE_DOWNSCALE] ⚠️  Image still large: ${longestSide}px (expected ≤1600px)`);
          console.warn(`[IMAGE_DOWNSCALE] ⚠️  Transformations may not be enabled or URL params ignored`);
        } else {
          console.log(`[IMAGE_DOWNSCALE] ✅ Successfully downscaled to ${longestSide}px`);
        }
      }
    }

    logMemory("after-base64-input");

    // Get prompt for current step
    let prompt: string;
    let selectedPresetId: string | null = null;

    if (currentStep === 4) {
      prompt = (STEP_TEMPLATES[4] as Function)(effectiveCameraPosition, effectiveForwardDirection);
    } else if (currentStep === 3) {
      // Step 3: Camera-Angle Render - EYE-LEVEL ONLY
      // Priority: 1) User-selected preset, 2) Custom prompt, 3) Auto-select from remaining presets
      const stepOutputs = pipeline.step_outputs as Record<string, any> || {};
      const step3Data = stepOutputs.step3 || {};
      const usedPresetIds: string[] = step3Data.used_preset_ids || [];
      const lastRejectionReason = step3Data.qa_reason;

      // Check if user explicitly selected a preset
      if (step_3_preset_id) {
        const userSelectedPreset = STEP_3_CAMERA_PRESETS.find(p => p.id === step_3_preset_id);
        if (userSelectedPreset) {
          prompt = userSelectedPreset.prompt;
          selectedPresetId = userSelectedPreset.id;
          console.log(`[Step 3] USER SELECTED preset: ${userSelectedPreset.name} (${userSelectedPreset.id})`);
          await emitEvent(supabaseAdmin, pipeline_id, user.id, currentStep, "preset_selected", `User selected: ${userSelectedPreset.name}`, (currentStep - 1) * 25 + 8);
        } else {
          // Invalid preset ID provided - reject rather than silently fallback
          throw new Error(`Invalid Step 3 preset ID: ${step_3_preset_id}. Available presets: ${STEP_3_CAMERA_PRESETS.map(p => p.id).join(", ")}`);
        }
      } else if (step_3_custom_prompt) {
        // User provided a custom prompt - use it directly
        prompt = `${step_3_custom_prompt}

CAMERA REQUIREMENTS (ENFORCED):
- Height: MUST be eye-level (150-160 cm) - NOT top-down, NOT corner, NOT overhead
- Lens: Normal focal length (40-50mm equivalent) for natural perspective
- This is an EYE-LEVEL interior photograph

SCENE REQUIREMENTS:
- Maintain EXACT geometry, furniture placement, and proportions from the input
- DO NOT move, resize, or add any furniture
- Photorealistic lighting with natural daylight`;
        selectedPresetId = "custom";
        console.log(`[Step 3] Using CUSTOM user prompt`);
        await emitEvent(supabaseAdmin, pipeline_id, user.id, currentStep, "custom_prompt", `Using custom camera prompt`, (currentStep - 1) * 25 + 8);
      } else {
        // No user selection - auto-select from available presets (avoiding used ones)
        const selectedPreset = selectStep3CameraPreset(usedPresetIds, lastRejectionReason);
        if (selectedPreset) {
          prompt = selectedPreset.prompt;
          selectedPresetId = selectedPreset.id;
          console.log(`[Step 3] Auto-selected preset: ${selectedPreset.name} (${selectedPreset.id})`);
          await emitEvent(supabaseAdmin, pipeline_id, user.id, currentStep, "preset_selected", `Auto-selected: ${selectedPreset.name}`, (currentStep - 1) * 25 + 8);
        } else {
          // Fallback to generic EYE-LEVEL prompt (no corner/wide views)
          prompt = `Generate a photorealistic interior render from EYE-LEVEL.

CAMERA REQUIREMENTS (MANDATORY):
- Height: MUST be eye-level (150-160 cm) - NOT top-down, NOT corner, NOT overhead
- Lens: Normal focal length (40-50mm equivalent) for natural perspective
- Position: Standing naturally in the room at human height

FORBIDDEN:
- NO corner views
- NO top-down/overhead views
- NO wide architectural shots
- NO bird's eye perspective

SCENE REQUIREMENTS:
- Maintain EXACT geometry, furniture placement, and proportions from the input
- Photorealistic lighting with natural daylight

OUTPUT: High-quality professional EYE-LEVEL interior photograph.`;
        }
      }
    } else if (currentStep === 1) {
      // ═══════════════════════════════════════════════════════════════
      // STEP 1: Dimension extraction (OpenAI-based feature removed)
      // ═══════════════════════════════════════════════════════════════
      // Note: Dimension and geometry extraction via OpenAI has been removed.
      // System now relies on visual proportions and Gemini's spatial understanding.
      await emitEvent(supabaseAdmin, pipeline_id, user.id, currentStep, "no_dimensions",
        "No dimension annotations - using visual proportions", (currentStep - 1) * 25 + 7);
      console.log(`[Step 1] Using visual proportions (dimension extraction via OpenAI removed)`);

      const dimensionAnalysis: DimensionAnalysisResult = {
        dimensions_found: false,
        units: "unknown",
        extracted_dimensions: [],
        scale_guidance_text: buildScaleGuidanceBlock({ dimensions_found: false, units: "unknown", extracted_dimensions: [], scale_guidance_text: "", scale_locked: false }),
        scale_locked: false
      };

      // Get space analysis for furniture constraints (use pre-extracted variable)
      const currentSpaceAnalysis = (spaceAnalysis as SpaceAnalysisData) || null;

      // Build furniture constraints block
      const furnitureConstraintsBlock = buildFurnitureConstraintsBlock(currentSpaceAnalysis);

      // Log furniture constraints usage
      console.log(`[Step 1] reference_image_provided: ${designRefIds.length > 0}`);
      console.log(`[Step 1] reference_image_applied_in_step: Step 2 only (NOT Step 1)`);
      console.log(`[Step 1] furniture_constraints_injected: ${currentSpaceAnalysis ? 'true' : 'false'}`);
      if (currentSpaceAnalysis?.rooms) {
        console.log(`[Step 1] rooms_with_constraints: ${currentSpaceAnalysis.rooms.length}`);
      }

      // Build Step 1 prompt with scale guidance, geometry constraints, AND furniture constraints injected
      prompt = STEP_1_BASE_TEMPLATE
        .replace("{SCALE_GUIDANCE_BLOCK}", dimensionAnalysis.scale_guidance_text)
        .replace("{FURNITURE_CONSTRAINTS_BLOCK}", furnitureConstraintsBlock);

      // Inject text preservation for Step 1
      console.log(`[Step 1] Injecting text preservation constraints`);
      prompt = injectTextPreservationForGeneration(prompt, currentStep, false);

      await emitEvent(supabaseAdmin, pipeline_id, user.id, currentStep, "furniture_constraints",
        `Furniture constraints applied from ${currentSpaceAnalysis?.rooms?.length || 0} room(s)`, (currentStep - 1) * 25 + 9);
    } else if (currentStep === 2) {
      // Step 2: Design Style Change - may include design references for style transfer
      // Get space analysis for layout preservation (use pre-extracted variable)
      const currentSpaceAnalysis = (spaceAnalysis as SpaceAnalysisData) || null;
      const layoutPreservationBlock = buildStep2LayoutPreservationBlock(currentSpaceAnalysis);

      // Get pre-analyzed style constraints (use pre-extracted variable)
      const currentReferenceStyleAnalysis = (referenceStyleAnalysis as {
        analyzed_at?: string;
        design_ref_ids?: string[];
        style_data?: Record<string, any>;
        style_constraints_block?: string;
        summary?: string;
      }) || null;

      // Log design reference scope
      console.log(`[Step 2] reference_image_provided: ${designRefIds.length > 0}`);
      console.log(`[Step 2] reference_image_applied_in_step: Step 2 only`);
      console.log(`[Step 2] layout_preservation_constraints: ${currentSpaceAnalysis ? 'true' : 'false'}`);
      console.log(`[Step 2] style_analysis_available: ${currentReferenceStyleAnalysis ? 'true' : 'false'}`);
      console.log(`[Step 2] style_constraints_block_length: ${currentReferenceStyleAnalysis?.style_constraints_block?.length || 0}`);

      if (designRefIds.length > 0) {
        console.log(`[run-pipeline-step] Step 2: Using ${designRefIds.length} design reference(s) for style transfer`);
        await emitEvent(supabaseAdmin, pipeline_id, user.id, currentStep, "style_transfer",
          `Applying style from ${designRefIds.length} reference image(s)${currentReferenceStyleAnalysis ? ' (pre-analyzed)' : ''}`, (currentStep - 1) * 25 + 7);

        // Build the style constraints injection block
        let styleConstraintsInjection = "";
        if (currentReferenceStyleAnalysis?.style_constraints_block) {
          // Use pre-analyzed style constraints
          styleConstraintsInjection = `

${currentReferenceStyleAnalysis.style_constraints_block}

STYLE SUMMARY: ${currentReferenceStyleAnalysis.summary || "Apply the style characteristics from the reference images."}

`;
          console.log(`[Step 2] Injecting pre-analyzed style constraints block`);
          await emitEvent(supabaseAdmin, pipeline_id, user.id, currentStep, "style_constraints_injected",
            `Style analysis injected: ${currentReferenceStyleAnalysis.style_data?.design_style?.primary || 'Custom style'}`, (currentStep - 1) * 25 + 7);
        }

        prompt = `Apply a STYLE TRANSFER to the interior using the provided reference images as design inspiration.

IMPORTANT: Apply ONLY style/material/color/lighting based on the reference style analysis below.
KEEP layout, room boundaries, wall geometry (angled/curved), room count, and furniture placement EXACTLY the same as the input image.
Do NOT add/remove rooms, doors, windows, or large furniture.
${styleConstraintsInjection}
STYLE TRANSFER FOCUS:
- Extract the design aesthetic, materials, color palette, and mood from the reference images
- Apply these visual characteristics to the input interior render
- Blend multiple reference styles harmoniously if multiple references provided
- Maintain photorealistic quality throughout

WHAT TO TRANSFER FROM REFERENCES:
- Color palette and color temperature
- Material finishes (wood tones, metal finishes, fabric textures)
- Lighting mood and ambiance
- Furniture and decor STYLE (but NOT type or size)
- Overall design aesthetic (modern, minimal, warm, industrial, etc.)

${layoutPreservationBlock}

CRITICAL - DO NOT CHANGE:
- Room geometry, proportions, or layout
- Wall positions, doors, windows locations  
- Camera angle or perspective (keep same as input)
- Furniture TYPES or SIZES (a single bed MUST remain a single bed)
- Furniture POSITIONS (same locations as input)

GOAL:
Transform the visual design style by borrowing from the reference images while preserving the exact spatial configuration, furniture types, and sizes.`;
      } else {
        prompt = STEP_TEMPLATES[2].replace("{LAYOUT_PRESERVATION_BLOCK}", layoutPreservationBlock);
      }

      // ═══════════════════════════════════════════════════════════════════════════
      // CRITICAL: Inject text preservation block for Step 2
      // This ensures room labels/text overlays from Step 1 are preserved
      // ═══════════════════════════════════════════════════════════════════════════
      console.log(`[Step 2] Injecting text preservation constraints`);
      prompt = injectTextPreservationForGeneration(prompt, currentStep, false);
    } else {
      throw new Error(`Invalid step number: ${currentStep}`);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // QUALITY POLICY: Steps 1-3 ALWAYS use 2K (enforced server-side)
    // Steps 4+ would use quality_post_step4 but run-pipeline-step only handles steps 1-2
    // ═══════════════════════════════════════════════════════════════════════════
    const aspectRatio = pipeline.aspect_ratio || "16:9";

    // Steps 1-2 always use 2K quality (policy enforced)
    const effectiveImageSize = "2K";

    console.log(`[QUALITY POLICY] Pipeline Step ${currentStep}:`);
    console.log(`  - output_resolution (original): ${pipeline.output_resolution}`);
    console.log(`  - Effective quality: ${effectiveImageSize} (Steps 1-3 always 2K)`);

    // For Step 2 with design references, load reference images
    // MEMORY OPTIMIZATION: Limit design refs for memory safety
    let referenceImagesBase64: string[] = [];
    if (currentStep === 2 && designRefIds.length > 0) {
      const maxRefs = 4; // Steps 1-2 always use 2K, so 4 refs is safe
      const refsToLoad = designRefIds.slice(0, maxRefs);

      if (designRefIds.length > maxRefs) {
        console.warn(`[Memory] Limiting design references from ${designRefIds.length} to ${maxRefs}`);
        await emitEvent(supabaseAdmin, pipeline_id, user.id, currentStep, "memory_optimization",
          `Using first ${maxRefs} references (memory limit)`, (currentStep - 1) * 25 + 8);
      }

      await emitEvent(supabaseAdmin, pipeline_id, user.id, currentStep, "loading_refs",
        `Loading ${refsToLoad.length} reference image(s)...`, (currentStep - 1) * 25 + 8);

      for (const refId of refsToLoad) {
        const { data: refUpload } = await supabaseAdmin
          .from("uploads")
          .select("bucket, path")
          .eq("id", refId)
          .single();

        if (refUpload) {
          const { data: refSignedUrl } = await supabaseAdmin.storage
            .from(refUpload.bucket)
            .createSignedUrl(refUpload.path, 3600);

          if (refSignedUrl?.signedUrl) {
            // Apply AGGRESSIVE downscaling to reference images
            let refUrl = refSignedUrl.signedUrl;
            if (currentStep >= 1 && currentStep <= 4) {
              const url = new URL(refUrl);
              url.searchParams.set('width', '1600');     // Aggressive: 1600px
              url.searchParams.set('height', '1600');    // Also limit height
              url.searchParams.set('quality', '60');      // Aggressive: 60 quality
              url.searchParams.set('format', 'webp');     // WebP compression
              refUrl = url.toString();
              console.log(`[IMAGE_DOWNSCALE] Ref ${referenceImagesBase64.length + 1}: Applying transformations (1600px, q60, webp)`);
            }

            const refResponse = await fetch(refUrl);

            // Check size before loading
            const refContentLength = refResponse.headers.get('content-length');
            if (refContentLength) {
              const refSizeMB = parseInt(refContentLength) / 1024 / 1024;
              if (refSizeMB > 15) {
                console.warn(`[IMAGE_DOWNSCALE] ⚠️  Skipping ref ${referenceImagesBase64.length + 1}: ${refSizeMB.toFixed(2)}MB (too large)`);
                continue; // Skip this reference image
              }
            }

            const refBuffer = (await refResponse.arrayBuffer()) as ArrayBuffer;
            const refBytes: Uint8Array = new Uint8Array(refBuffer);

            // Double-check actual size
            const refSizeMB = (refBytes.length / 1024 / 1024).toFixed(2);
            console.log(`[IMAGE_DOWNSCALE] Ref ${referenceImagesBase64.length + 1}: ${refSizeMB}MB`);

            if (refBytes.length > 15 * 1024 * 1024) {
              console.warn(`[IMAGE_DOWNSCALE] ⚠️  Skipping ref ${referenceImagesBase64.length + 1}: ${refSizeMB}MB (exceeds 15MB limit)`);
              continue; // Skip if too large
            }

            const refBase64 = encodeBase64FromBytes(refBytes);
            referenceImagesBase64.push(refBase64);
            logMemory(`after-load-ref-${referenceImagesBase64.length}`);
          }
        }
      }
      console.log(`[run-pipeline-step] Loaded ${referenceImagesBase64.length} reference images`);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // HEARTBEAT: After image loading complete
    // ═══════════════════════════════════════════════════════════════════════
    await supabaseAdmin
      .from("floorplan_pipelines")
      .update({ current_step_last_heartbeat_at: new Date().toISOString() })
      .eq("id", pipeline_id);

    // Determine actual output count (Step 1 always produces 1 output)
    const actualOutputCount = currentStep === 1 ? 1 : requestedOutputCount;
    console.log(`[run-pipeline-step] Generating ${actualOutputCount} output(s) for step ${currentStep}`);

    await emitEvent(supabaseAdmin, pipeline_id, user.id, currentStep, "api_request",
      actualOutputCount > 1
        ? `Generating ${actualOutputCount} outputs...`
        : referenceImagesBase64.length > 0
          ? `Sending to AI with ${referenceImagesBase64.length} style reference(s)...`
          : "Sending to AI...",
      (currentStep - 1) * 25 + 10);

    // Build message content: text prompt + main image + optional reference images
    const messageContent: any[] = [
      { type: "text", text: prompt },
      {
        type: "image_url",
        image_url: {
          url: `data:image/jpeg;base64,${base64Image}`
        }
      }
    ];

    // Add reference images for Step 2 style transfer
    if (currentStep === 2 && referenceImagesBase64.length > 0) {
      // Add a label for the reference images
      messageContent.push({
        type: "text",
        text: "DESIGN REFERENCE IMAGES (use these as style inspiration):"
      });

      for (let i = 0; i < referenceImagesBase64.length; i++) {
        messageContent.push({
          type: "image_url",
          image_url: {
            url: `data:image/jpeg;base64,${referenceImagesBase64[i]}`
          }
        });
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // MEMORY CLEANUP: Release raw base64 strings after embedding in messageContent
    // The base64 is now inside messageContent objects, so we can null the originals
    // ═══════════════════════════════════════════════════════════════════════════
    logMemory("before-memory-cleanup");

    // Clear the raw base64 strings - they're now embedded in messageContent
    base64Image = ""; // Can't use null because it's a string type
    referenceImagesBase64.length = 0;
    referenceImagesBase64 = []; // Reset array

    logMemory("after-memory-cleanup");
    console.log(`[Memory] Cleared raw base64 strings, messageContent contains ${messageContent.length} parts`);

    // Multi-output generation loop
    const generatedOutputs: Array<{
      output_upload_id: string;
      qa_decision: string;
      qa_reason: string;
      prompt_used: string;
      variation_index: number;
      camera_angle?: string;
      preset_id?: string;
    }> = [];

    // NOTE: Defer fetchFullStepOutputs() until AFTER generation to keep memory lower during API calls
    // We'll fetch step3 preset IDs via a lightweight query if needed
    let usedPresetIds: string[] = [];
    if (currentStep === 3) {
      // Lightweight fetch of just step3 presets
      const { data: presetData } = await supabaseAdmin
        .from("floorplan_pipelines")
        .select("step_outputs->step3->used_preset_ids")
        .eq("id", pipeline_id)
        .single();
      const rawPresets = (presetData as any)?.["used_preset_ids"];
      if (Array.isArray(rawPresets)) {
        usedPresetIds = rawPresets;
      }
    }
    let lastApiError: string | null = null;

    for (let outputIndex = 0; outputIndex < actualOutputCount; outputIndex++) {
      const isMultiOutput = actualOutputCount > 1;
      const outputLabel = isMultiOutput ? ` (${outputIndex + 1}/${actualOutputCount})` : "";

      await emitEvent(supabaseAdmin, pipeline_id, user.id, currentStep, "generating",
        `Generating output${outputLabel}...`, (currentStep - 1) * 25 + 11 + outputIndex);

      // For Step 3 with multiple outputs, select different camera presets
      let currentPrompt = prompt;
      let currentPresetId: string | null = selectedPresetId;

      if (currentStep === 3 && isMultiOutput && outputIndex > 0) {
        // Select a different camera preset for each additional output
        const nextPreset = selectStep3CameraPreset(usedPresetIds);
        if (nextPreset) {
          currentPrompt = nextPreset.prompt;
          currentPresetId = nextPreset.id;
          usedPresetIds.push(nextPreset.id);
          console.log(`[Step 3] Output ${outputIndex + 1}: Using camera preset ${nextPreset.name}`);
        }
      }

      // Build message for this specific output
      const outputMessageContent = [
        { type: "text", text: currentPrompt },
        ...messageContent.slice(1) // Keep the images
      ];

      // For multi-output, add variation instruction
      if (isMultiOutput && currentStep !== 3) {
        const variationInstruction = currentStep === 2
          ? `\n\nVARIATION ${outputIndex + 1}: Create a unique style interpretation. Vary color tones, material textures, or lighting mood while maintaining the same design direction.`
          : `\n\nVARIATION ${outputIndex + 1}: Create a unique panorama interpretation. Vary the specific details, lighting nuances, or subtle atmosphere changes.`;
        outputMessageContent[0] = { type: "text", text: currentPrompt + variationInstruction };
      }

      // ═══════════════════════════════════════════════════════════════════════
      // Call Gemini via Langfuse-wrapped image generation
      // ═══════════════════════════════════════════════════════════════════════
      if (!API_NANOBANANA) {
        throw new Error("API_NANOBANANA secret not configured");
      }

      // For step 4 (panorama), force 2:1 aspect ratio
      const effectiveAspectRatio = currentStep === 4 ? "2:1" : aspectRatio;

      console.log(`[QUALITY POLICY] Pipeline Step ${currentStep} Output ${outputIndex + 1} API Request:`);
      console.log(`  - Model: gemini-3-pro-image-preview`);
      console.log(`  - Effective imageSize: ${effectiveImageSize}`);
      console.log(`  - Requested aspectRatio: ${effectiveAspectRatio}`);

      // Build request with Gemini API format - includes imageConfig for 4K support
      // Extract images from outputMessageContent and convert to Gemini format
      const imageParts = outputMessageContent
        .filter((c: any) => c.type === "image_url")
        .map((c: any) => {
          const url = c.image_url.url;
          const base64Match = url.match(/^data:([^;]+);base64,(.+)$/);
          if (base64Match) {
            return { inlineData: { mimeType: base64Match[1] as string, data: base64Match[2] as string } };
          }
          return null;
        })
        .filter((p): p is { inlineData: { mimeType: string; data: string } } => p !== null);

      const geminiRequestBody: ImageGenerationRequest = {
        contents: [{
          role: "user",
          parts: [
            { text: outputMessageContent.find((c: any) => c.type === "text")?.text || currentPrompt },
            ...imageParts,
          ],
        }],
        generationConfig: {
          responseModalities: ["Image"],
          imageConfig: {
            aspectRatio: effectiveAspectRatio,
            imageSize: effectiveImageSize,
          },
        },
      };

      // Use Langfuse-wrapped image generation for full observability
      const genResult = await wrapImageGeneration(
        {
          pipelineId: pipeline_id,
          projectId: pipeline.project_id,
          ownerId: user.id,
          stepNumber: currentStep,
          attemptIndex: outputIndex,
          promptText: currentPrompt,
          imageSize: effectiveImageSize,
          aspectRatio: effectiveAspectRatio,
          variationIndex: outputIndex,
        },
        API_NANOBANANA,
        geminiRequestBody
      );

      if (!genResult.success || !genResult.imageData) {
        console.error(`[run-pipeline-step] Image generation failed for output ${outputIndex + 1}:`, genResult.error?.message);

        // Parse specific error types for better user feedback
        const errorMsg = genResult.error?.message || "Unknown error";
        if (errorMsg.includes("payment_required") || errorMsg.includes("credits")) {
          lastApiError = "Not enough AI credits. Please check your billing settings.";
        } else {
          lastApiError = errorMsg;
        }

        // Continue with other outputs if one fails
        continue;
      }

      let outputBase64 = genResult.imageData.base64;
      const outputMimeType = genResult.imageData.mimeType;

      console.log(`[run-pipeline-step] Image generated in ${genResult.timingMs}ms, generation ID: ${genResult.generationId}`);

      logMemory("after-api-response");

      // ═══════════════════════════════════════════════════════════════════════
      // HEARTBEAT: After AI API response received
      // ═══════════════════════════════════════════════════════════════════════
      await supabaseAdmin
        .from("floorplan_pipelines")
        .update({ current_step_last_heartbeat_at: new Date().toISOString() })
        .eq("id", pipeline_id);

      await emitEvent(supabaseAdmin, pipeline_id, user.id, currentStep, "api_complete",
        `AI generation complete${outputLabel}`, (currentStep - 1) * 25 + 13 + outputIndex);

      // Upload output - ORIGINAL quality, no post-processing compression
      // Decode base64 without creating a giant intermediate JS string (atob)
      const outputBuffer = decodeBase64(outputBase64);

      // RESOLUTION VERIFICATION: Check BEFORE clearing outputBase64
      const imageDims = getImageDimensions(outputBase64);

      // Step 4 is panorama generation - use relaxed validation for Nano Banana
      const isPanoramaStep = currentStep === 4;
      const resolutionCheck = verifyResolution(imageDims, effectiveImageSize, {
        isPanoramaTask: isPanoramaStep,
        provider: "nano_banana" // All pipeline steps currently use Nano Banana
      });

      console.log(`[QUALITY] Step ${currentStep} Output ${outputIndex + 1}:`);
      console.log(`  - Requested: ${effectiveImageSize} (${aspectRatio})`);
      console.log(`  - Actual dimensions: ${imageDims ? `${imageDims.width}×${imageDims.height}` : "UNKNOWN"}`);
      console.log(`  - Resolution check: ${resolutionCheck.message}`);
      if (resolutionCheck.isProviderLimitation) {
        console.log(`  - Provider limitation: Output may not meet strict resolution/aspect requirements`);
      }
      console.log(`  - File size: ${(outputBuffer.length / 1024 / 1024).toFixed(2)} MB`);
      console.log(`  - Mime type: ${outputMimeType}`);

      // MEMORY CLEANUP: Clear outputBase64 after dimension check
      outputBase64 = "";
      logMemory("after-output-decode");

      const fileExt = outputMimeType.includes("png") ? "png" : "jpg";
      const outputPath = `${user.id}/${pipeline.project_id}/pipeline_${pipeline_id}_step${currentStep}_v${outputIndex + 1}_${Date.now()}.${fileExt}`;

      // Quality check - for panorama tasks with Nano Banana, only log as INFO if it's a provider limitation
      if (!resolutionCheck.passed) {
        console.warn(`[QUALITY WARNING] Output resolution lower than expected`);
        await emitEvent(supabaseAdmin, pipeline_id, user.id, currentStep, "quality_warning",
          `Resolution lower than expected: ${imageDims?.width}×${imageDims?.height}`, (currentStep - 1) * 25 + 14 + outputIndex);
      } else if (resolutionCheck.isProviderLimitation && isPanoramaStep) {
        // For Nano Banana panoramas, log as INFO (non-blocking) instead of warning
        console.log(`[INFO] Nano Banana panorama output: ${imageDims?.width}×${imageDims?.height} (provider limitation, not a failure)`);
        await emitEvent(supabaseAdmin, pipeline_id, user.id, currentStep, "info",
          `Panorama output: ${imageDims?.width}×${imageDims?.height} (provider limitation)`, (currentStep - 1) * 25 + 14 + outputIndex);
      }

      const { error: uploadError } = await supabaseAdmin.storage
        .from("outputs")
        .upload(outputPath, outputBuffer, { contentType: outputMimeType });

      if (uploadError) {
        console.error(`Failed to upload output ${outputIndex + 1}:`, uploadError.message);
        continue;
      }

      // Create upload record with size for observability
      const { data: uploadRecord, error: recordError } = await supabaseAdmin
        .from("uploads")
        .insert({
          project_id: pipeline.project_id,
          owner_id: user.id,
          bucket: "outputs",
          path: outputPath,
          kind: "output",
          mime_type: outputMimeType,
          size_bytes: outputBuffer.length,
          original_filename: `pipeline_step${currentStep}_output_v${outputIndex + 1}.${fileExt}`
        })
        .select()
        .single();

      if (recordError) {
        console.error(`Failed to create upload record for output ${outputIndex + 1}:`, recordError.message);
        continue;
      }

      await emitEvent(supabaseAdmin, pipeline_id, user.id, currentStep, "upload_complete",
        `Output saved${outputLabel} (${(outputBuffer.length / 1024 / 1024).toFixed(2)} MB)`, (currentStep - 1) * 25 + 15 + outputIndex);

      // ═══════════════════════════════════════════════════════════════════════
      // HEARTBEAT: After output upload, before QA
      // ═══════════════════════════════════════════════════════════════════════
      await supabaseAdmin
        .from("floorplan_pipelines")
        .update({ current_step_last_heartbeat_at: new Date().toISOString() })
        .eq("id", pipeline_id);

      // Calculate attempt index BEFORE QA validation (needed for QA call)
      const attemptIndex = (currentAutoAttempt || 0) + 1;

      // Run QA validation
      await emitEvent(supabaseAdmin, pipeline_id, user.id, currentStep, "qa_start",
        `Running QA${outputLabel}...`, (currentStep - 1) * 25 + 17 + outputIndex);

      // Prefer signed URLs for QA to avoid holding BOTH input+output base64 in memory
      const { data: outputSignedUrlData } = await supabaseAdmin.storage
        .from("outputs")
        .createSignedUrl(outputPath, 3600);
      const outputSignedUrl = outputSignedUrlData?.signedUrl;
      const qaResult = await runQAValidation(
        { signedUrl: inputSignedUrl, base64: base64Image },
        { signedUrl: outputSignedUrl, base64: outputBase64 },
        currentStep,
        pipeline_id,
        pipeline.project_id,
        user.id,
        uploadRecord.id, // output_upload_id
        attemptIndex,
        authHeader!,
      );

      await emitEvent(supabaseAdmin, pipeline_id, user.id, currentStep, "qa_complete",
        `QA${outputLabel}: ${qaResult.decision}`, (currentStep - 1) * 25 + 19 + outputIndex);

      // deno-lint-ignore no-explicit-any
      const outputEntry: any = {
        output_upload_id: uploadRecord.id,
        qa_decision: qaResult.decision,
        qa_reason: qaResult.reason,
        qa_score: qaResult.qa_score, // NEW: Numeric score (0-100) from run-qa-check
        // Store full QA result for detailed rejection UI
        qa_result_full: qaResult,
        // Individual check fields for backward compatibility
        geometry_check: qaResult.geometry_check,
        scale_check: qaResult.scale_check,
        furniture_check: qaResult.furniture_check,
        furniture_type_check: qaResult.furniture_type_check,
        furniture_size_check: qaResult.furniture_size_check,
        structural_check: qaResult.structural_check,
        bed_size_issues: qaResult.bed_size_issues,
        furniture_issues: qaResult.furniture_issues,
        prompt_used: currentPrompt,
        variation_index: outputIndex,
      };

      if (currentStep === 3 && currentPresetId) {
        outputEntry.camera_angle = STEP_3_CAMERA_PRESETS.find(p => p.id === currentPresetId)?.name || currentPresetId;
        outputEntry.preset_id = currentPresetId;
      }

      generatedOutputs.push(outputEntry);

      // ═══════════════════════════════════════════════════════════════════════
      // STORE ATTEMPT IN floorplan_pipeline_step_attempts FOR FULL PROMPT TRACEABILITY
      // The prompt_used in step_outputs is truncated, but this table stores the FULL prompt
      // NOTE: attemptIndex is calculated earlier (before QA validation call)
      // ═══════════════════════════════════════════════════════════════════════
      try {
        const { error: attemptError } = await supabaseAdmin
          .from("floorplan_pipeline_step_attempts")
          .insert({
            pipeline_id,
            owner_id: user.id,
            step_number: currentStep,
            attempt_index: attemptIndex,
            output_upload_id: uploadRecord.id,
            prompt_used: currentPrompt, // FULL prompt, NOT truncated
            model_used: "gemini-2.0-flash-exp-image-generation",
            qa_status: qaResult.decision === "approved" ? "approved" : qaResult.decision === "rejected" ? "rejected" : "pending",
            qa_reason_short: typeof qaResult.reason === "string" ? qaResult.reason.slice(0, 500) : null,
            qa_reason_full: typeof qaResult.reason === "string" ? qaResult.reason : JSON.stringify(qaResult.reason),
            qa_result_json: qaResult,
          });

        if (attemptError) {
          console.error(`[run-pipeline-step] Failed to store attempt record:`, attemptError.message);
        } else {
          console.log(`[run-pipeline-step] Stored attempt ${attemptIndex} for step ${currentStep} with full prompt (${currentPrompt.length} chars)`);
        }

        // ═══════════════════════════════════════════════════════════════════════
        // PERSIST QA RESULT TO qa_judge_results FOR UI DISPLAY (MANDATORY)
        // ═══════════════════════════════════════════════════════════════════════
        try {
          const qaPass = qaResult.decision === "approved";
          const qaScore = qaResult.score ?? (qaPass ? 90 : 30); // Default scores if not provided
          const reasons: string[] = [];

          // Extract reasons from various formats
          if (qaResult.reason && typeof qaResult.reason === "string") {
            reasons.push(qaResult.reason);
          }
          if (Array.isArray(qaResult.reasons)) {
            for (const r of qaResult.reasons) {
              if (typeof r === "object" && r !== null && r.description) {
                reasons.push(`[${r.code || "CHECK"}] ${r.description}`);
              } else if (typeof r === "string") {
                reasons.push(r);
              }
            }
          }

          await persistQAJudgeResult({
            supabase: supabaseAdmin,
            pipeline_id,
            project_id: pipeline.project_id,
            owner_id: user.id,
            step_number: currentStep,
            sub_step: null,
            output_id: uploadRecord.id,
            attempt_index: attemptIndex,
            pass: qaPass,
            score: normalizeScore(qaScore),
            confidence: null,
            reasons: reasons,
            violated_rules: (qaResult.reasons?.map((r: { code?: string }) => r.code).filter((c): c is string => typeof c === "string") || []),
            full_result: qaResult,
            judge_model: "gpt-4o", // Local QA uses GPT-4o
            prompt_name: `step_${currentStep}_qa_local`,
            prompt_version: null,
            processing_time_ms: null,
          });
          console.log(`[run-pipeline-step] ✓ Persisted QA result to qa_judge_results`);
        } catch (qaPeristErr) {
          console.error(`[run-pipeline-step] Failed to persist QA result:`, qaPeristErr);
          // Non-fatal: don't block pipeline
        }
      } catch (attemptErr) {
        console.error(`[run-pipeline-step] Error storing attempt:`, attemptErr);
        // Non-fatal: don't block the pipeline for traceability failure
      }
    }

    // Check if we generated any outputs
    if (generatedOutputs.length === 0) {
      const errorMsg = lastApiError || "Failed to generate any outputs";
      await emitStepError(
        supabaseAdmin,
        pipeline_id,
        user.id,
        currentStep,
        "AI_API_ERROR",
        `Image generation failed: ${errorMsg}`
      );
      return new Response(JSON.stringify({
        error: errorMsg,
        error_code: "AI_API_ERROR",
        action_id: actionId,
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    await emitEvent(supabaseAdmin, pipeline_id, user.id, currentStep, "generation_complete",
      `Generated ${generatedOutputs.length} output(s)`, (currentStep - 1) * 25 + 22);

    // Auto-rerender for Step 4 (360° Panorama) QA rejection
    // Check if the primary output was rejected and we haven't hit max attempts
    const primaryOutput = generatedOutputs[0];
    const isPanoramaStep = currentStep === 4;
    const wasRejected = primaryOutput?.qa_decision === "rejected";
    const canAutoRerender = isPanoramaStep && wasRejected && currentAutoAttempt < MAX_AUTO_RERENDER_ATTEMPTS;

    if (canAutoRerender) {
      const nextAttempt = currentAutoAttempt + 1;
      console.log(`[Step 4] QA rejected - auto-rerender attempt ${nextAttempt}/${MAX_AUTO_RERENDER_ATTEMPTS}`);

      await emitEvent(supabaseAdmin, pipeline_id, user.id, currentStep, "auto_rerender",
        `QA rejected: "${primaryOutput.qa_reason?.slice(0, 50)}..." - auto-retry ${nextAttempt}/${MAX_AUTO_RERENDER_ATTEMPTS}`,
        (currentStep - 1) * 25 + 23);

      // Store the failed attempt in history
      const stepOutputs = await fetchFullStepOutputs();
      const currentStepHistory = (stepOutputs[`step${currentStep}_history`] as any[]) || [];
      currentStepHistory.push({
        attempt: nextAttempt,
        output_upload_id: primaryOutput.output_upload_id,
        qa_decision: primaryOutput.qa_decision,
        qa_reason: primaryOutput.qa_reason,
        timestamp: new Date().toISOString()
      });
      stepOutputs[`step${currentStep}_history`] = currentStepHistory;

      // Update pipeline to keep running state for retry
      await supabaseAdmin
        .from("floorplan_pipelines")
        .update({
          step_outputs: stepOutputs,
          updated_at: new Date().toISOString()
        })
        .eq("id", pipeline_id);

      // Return with auto-rerender flag so frontend can continue the loop
      return new Response(JSON.stringify({
        success: true,
        autoRerender: true,
        attempt: nextAttempt,
        maxAttempts: MAX_AUTO_RERENDER_ATTEMPTS,
        qaReason: primaryOutput.qa_reason,
        pipeline_id,
        camera_position,
        forward_direction
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Check if we hit max retries for panorama
    if (isPanoramaStep && wasRejected && currentAutoAttempt >= MAX_AUTO_RERENDER_ATTEMPTS) {
      console.log(`[Step 4] Max auto-rerender attempts (${MAX_AUTO_RERENDER_ATTEMPTS}) reached - manual review required`);

      await emitEvent(supabaseAdmin, pipeline_id, user.id, currentStep, "max_retries",
        `Max retries (${MAX_AUTO_RERENDER_ATTEMPTS}) reached - manual review required`,
        (currentStep - 1) * 25 + 24);

      // Create notification for manual review
      await supabaseAdmin.from("notifications").insert({
        owner_id: user.id,
        project_id: pipeline.project_id,
        type: "pipeline_max_retries",
        title: `Panorama Step - Manual Review Required`,
        message: `After ${MAX_AUTO_RERENDER_ATTEMPTS} attempts, manual intervention is needed`,
        target_route: `/projects/${pipeline.project_id}`,
        target_params: { tab: "floor-plan-jobs", pipelineId: pipeline_id }
      });
    }

    // Update pipeline with step outputs
    // For multi-output, store as an array; for single output, maintain backward compatibility
    const isSingleOutput = generatedOutputs.length === 1;

    // PARTIAL SUCCESS LOGIC: Count approved vs rejected outputs
    const approvedCount = generatedOutputs.filter(o => o.qa_decision === "approved").length;
    const rejectedCount = generatedOutputs.filter(o => o.qa_decision === "rejected").length;
    const totalCount = generatedOutputs.length;

    // Determine overall step QA decision:
    // - "approved" if ALL outputs are approved
    // - "partial_success" if at least ONE output is approved but some are rejected
    // - "rejected" ONLY if ALL outputs are rejected
    let overallQaDecision: string;
    let overallQaReason: string;

    if (rejectedCount === 0) {
      overallQaDecision = "approved";
      overallQaReason = `All ${totalCount} output(s) passed QA`;
    } else if (approvedCount > 0) {
      overallQaDecision = "partial_success";
      overallQaReason = `${approvedCount}/${totalCount} outputs passed QA, ${rejectedCount} rejected`;
    } else {
      overallQaDecision = "rejected";
      overallQaReason = `All ${totalCount} output(s) rejected by QA`;
    }

    console.log(`[run-pipeline-step] Step ${currentStep} QA summary: ${overallQaDecision} - ${overallQaReason}`);

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 1-3 AUTO-RETRY LOGIC: If QA fails for early steps, auto-retry up to 5 times
    // ═══════════════════════════════════════════════════════════════════════════
    const isEarlyStep = currentStep >= 1 && currentStep <= 3;
    const wasRejectedByQA = overallQaDecision === "rejected";

    if (isEarlyStep && wasRejectedByQA) {
      console.log(`[Step ${currentStep}] QA rejected - checking auto-retry eligibility`);

      // Fetch current step_retry_state
      const { data: currentPipeline } = await supabaseAdmin
        .from("floorplan_pipelines")
        .select("step_retry_state, total_retry_count, auto_retry_enabled")
        .eq("id", pipeline_id)
        .single();

      const stepKey = `step_${currentStep}`;
      const existingRetryState = (currentPipeline?.step_retry_state || {}) as Record<string, any>;
      let stepState = existingRetryState[stepKey] || {
        attempt_count: 0,
        max_attempts: 5,
        auto_retry_enabled: currentPipeline?.auto_retry_enabled ?? true,
        last_qa_result: null,
        status: "pending",
      };

      // Increment attempt count
      stepState.attempt_count = (stepState.attempt_count || 0) + 1;
      // Collect all output upload IDs from this failed attempt
      const failedOutputIds = generatedOutputs
        .filter((o: any) => o.output_upload_id)
        .map((o: any) => o.output_upload_id);

      // Get the first output with all QA details (cast to any for dynamic fields)
      // deno-lint-ignore no-explicit-any
      const firstOutput = generatedOutputs[0] as any;

      // Build specific reason from check fields if available (more useful than generic message)
      const buildSpecificReason = (output: any): string => {
        if (!output) return overallQaReason;

        // If we have a specific reason from GPT, use it
        if (output.qa_reason && !output.qa_reason.includes("rejected by QA")) {
          return output.qa_reason;
        }

        // Build from individual check fields
        const issues: string[] = [];
        if (output.geometry_check === "failed") issues.push("Wall geometry not preserved");
        if (output.scale_check === "failed") issues.push("Furniture scale mismatch");
        if (output.furniture_check === "failed") issues.push("Furniture placement issues");
        if (output.furniture_type_check === "failed") issues.push("Furniture types changed");
        if (output.furniture_size_check === "failed") issues.push("Furniture sizes incorrect");
        if (output.structural_check === "failed") issues.push("Structural elements changed");
        if (output.bed_size_issues?.length) issues.push(output.bed_size_issues[0]);
        if (output.furniture_issues?.length) issues.push(output.furniture_issues[0]);

        if (issues.length > 0) return issues.join("; ");

        // Fall back to whatever reason we have
        return output.qa_reason || overallQaReason;
      };

      const specificReason = buildSpecificReason(firstOutput);
      console.log(`[Step ${currentStep}] QA rejection reason: "${specificReason}"`);

      stepState.last_qa_result = {
        decision: overallQaDecision,
        // Use specific reason, not generic summary
        reason: specificReason,
        reason_short: specificReason,
        // Store full QA result from first output for structured display
        ...(firstOutput?.qa_result_full || {}),
        ...(firstOutput ? {
          geometry_check: firstOutput.geometry_check,
          scale_check: firstOutput.scale_check,
          furniture_check: firstOutput.furniture_check,
          furniture_type_check: firstOutput.furniture_type_check,
          furniture_size_check: firstOutput.furniture_size_check,
          bed_size_issues: firstOutput.bed_size_issues,
          furniture_issues: firstOutput.furniture_issues,
          structural_check: firstOutput.structural_check,
        } : {}),
        // Store output IDs for UI thumbnail display
        output_upload_ids: failedOutputIds,
      };
      stepState.updated_at = new Date().toISOString();

      // Build attempt history for this step - include actual QA reason
      const attemptNumber = stepState.attempt_count;
      const attemptRecord = {
        attempt_number: attemptNumber,
        output_upload_ids: failedOutputIds,
        qa_result: {
          decision: overallQaDecision,
          // Use specific reason for each attempt
          reason: specificReason,
          reason_short: specificReason,
          // Include full QA result for UI
          ...(firstOutput?.qa_result_full || {}),
          // Include individual checks
          geometry_check: firstOutput?.geometry_check,
          scale_check: firstOutput?.scale_check,
          furniture_check: firstOutput?.furniture_check,
          furniture_type_check: firstOutput?.furniture_type_check,
          furniture_size_check: firstOutput?.furniture_size_check,
          bed_size_issues: firstOutput?.bed_size_issues,
          furniture_issues: firstOutput?.furniture_issues,
          structural_check: firstOutput?.structural_check,
        },
        timestamp: new Date().toISOString(),
      };

      // Initialize or append to attempts array
      if (!stepState.attempts) {
        stepState.attempts = [];
      }
      stepState.attempts.push(attemptRecord);

      const attemptCount = stepState.attempt_count;
      const maxAttempts = stepState.max_attempts || 5;
      const autoRetryEnabled = stepState.auto_retry_enabled !== false && currentPipeline?.auto_retry_enabled !== false;
      const globalRetryCount = (currentPipeline?.total_retry_count || 0);
      const maxGlobalRetries = 20; // Hard limit per run

      console.log(`[Step ${currentStep}] Attempt ${attemptCount}/${maxAttempts}, global retries: ${globalRetryCount}/${maxGlobalRetries}`);

      // Check if we should auto-retry
      const canAutoRetry = autoRetryEnabled &&
        attemptCount < maxAttempts &&
        globalRetryCount < maxGlobalRetries;

      if (canAutoRetry) {
        // Mark as qa_fail and trigger retry
        stepState.status = "qa_fail";

        // Build retry delta - adjust constraints based on QA feedback
        const retryDelta = {
          changes_made: [] as string[],
          prompt_adjustments: [] as string[],
          new_seed: Math.floor(Math.random() * 2147483647),
          temperature: Math.max(0.1, 0.7 - (attemptCount * 0.1)),
        };

        // Add specific constraints based on rejection reasons
        const qaReason = generatedOutputs[0]?.qa_reason?.toLowerCase() || "";
        if (qaReason.includes("geometry") || qaReason.includes("wall") || qaReason.includes("angle")) {
          retryDelta.prompt_adjustments.push("CRITICAL: Preserve ALL wall angles exactly. Do NOT straighten angled or curved walls.");
          retryDelta.changes_made.push("Added geometry preservation constraint");
        }
        if (qaReason.includes("scale") || qaReason.includes("proportion") || qaReason.includes("size")) {
          retryDelta.prompt_adjustments.push("CRITICAL: Maintain exact furniture scale proportions matching room dimensions.");
          retryDelta.changes_made.push("Added scale constraint");
        }
        if (qaReason.includes("bed") || qaReason.includes("bedroom")) {
          retryDelta.prompt_adjustments.push("CRITICAL: Use appropriate bed sizes - single/twin for secondary rooms, double only for master bedroom.");
          retryDelta.changes_made.push("Added bed size constraint");
        }
        if (qaReason.includes("furniture") || qaReason.includes("hallucin")) {
          retryDelta.prompt_adjustments.push("CRITICAL: Preserve exact furniture types and counts from input. Do NOT add or change furniture.");
          retryDelta.changes_made.push("Added furniture preservation constraint");
        }

        stepState.last_retry_delta = retryDelta;

        // Update pipeline with retry state
        await supabaseAdmin
          .from("floorplan_pipelines")
          .update({
            step_retry_state: { ...existingRetryState, [stepKey]: stepState },
            total_retry_count: globalRetryCount + 1,
            status: `step${currentStep}_qa_fail`,
            updated_at: new Date().toISOString(),
          })
          .eq("id", pipeline_id);

        await emitEvent(supabaseAdmin, pipeline_id, user.id, currentStep, "auto_retry_started",
          `AI-QA rejected Step ${currentStep} - auto-retry ${attemptCount + 1}/${maxAttempts}`, 10);

        // Self-invoke with retry context (non-blocking)
        console.log(`[Step ${currentStep}] Triggering auto-retry ${attemptCount + 1}/${maxAttempts}`);

        const retryBody = {
          pipeline_id,
          is_retry: true,
          retry_attempt: attemptCount + 1,
          retry_delta: retryDelta,
        };

        // Use fire-and-forget pattern to avoid blocking
        // CRITICAL: Use service role key for internal retries to avoid token expiration issues
        fetch(`${SUPABASE_URL}/functions/v1/run-pipeline-step`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            "x-internal-retry": "true",
            "x-retry-user-id": user.id,
          },
          body: JSON.stringify(retryBody),
        }).catch(err => console.error(`[Step ${currentStep}] Retry invocation error:`, err));

        return new Response(JSON.stringify({
          success: true,
          auto_retry_triggered: true,
          attempt: attemptCount + 1,
          max_attempts: maxAttempts,
          qa_reason: overallQaReason,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } else if (attemptCount >= maxAttempts) {
        // Max retries exhausted - block for human approval
        stepState.status = "blocked_for_human";

        await supabaseAdmin
          .from("floorplan_pipelines")
          .update({
            step_retry_state: { ...existingRetryState, [stepKey]: stepState },
            status: `step${currentStep}_blocked_for_human`,
            updated_at: new Date().toISOString(),
          })
          .eq("id", pipeline_id);

        await emitEvent(supabaseAdmin, pipeline_id, user.id, currentStep, "qa_fail_blocked",
          `Step ${currentStep} blocked after ${maxAttempts} failed attempts - manual approval required`, 10);

        // Create notification for manual review
        await supabaseAdmin.from("notifications").insert({
          owner_id: user.id,
          project_id: pipeline.project_id,
          type: "pipeline_blocked_for_manual",
          title: `Step ${currentStep} - Manual Approval Required`,
          message: `After ${maxAttempts} attempts, AI-QA still rejects the output. Please review manually.`,
          target_route: `/projects/${pipeline.project_id}`,
          target_params: { tab: "floor-plan-jobs", pipelineId: pipeline_id },
        });

        return new Response(JSON.stringify({
          success: true,
          blocked_for_human: true,
          attempt: attemptCount,
          max_attempts: maxAttempts,
          qa_reason: overallQaReason,
          output_upload_id: generatedOutputs[0]?.output_upload_id,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Fetch full step_outputs NOW (after generation is complete, to reduce peak memory during API calls)
    const stepOutputs = await fetchFullStepOutputs();

    if (isSingleOutput) {
      // Single output - backward compatible format
      const output = generatedOutputs[0];
      // Truncate prompt_used to prevent step_outputs from becoming too large (memory issue)
      const truncatedPrompt = output.prompt_used?.slice(0, 200) + (output.prompt_used?.length > 200 ? '...' : '');
      stepOutputs[`step${currentStep}`] = {
        output_upload_id: output.output_upload_id,
        qa_decision: output.qa_decision,
        qa_reason: output.qa_reason,
        overall_qa_decision: overallQaDecision,
        overall_qa_reason: overallQaReason,
        aspect_ratio: pipeline.aspect_ratio || "16:9",
        output_quality: pipeline.output_resolution || "2K",
        prompt_used: truncatedPrompt,
        ...(currentStep === 3 && output.preset_id ? {
          camera_angle: output.camera_angle,
          used_preset_ids: usedPresetIds,
          last_preset_id: output.preset_id
        } : {}),
        ...(currentStep === 4 ? {
          camera_position: camera_position,
          forward_direction: forward_direction
        } : {}),
        ...(currentStep === 2 ? {
          ...(designRefIds.length > 0 ? {
            design_ref_upload_ids: designRefIds,
            style_transfer_applied: true
          } : {}),
          ...(selectedStyleTitle ? { style_title: selectedStyleTitle } : {})
        } : {})
      };
    } else {
      // Multi-output - new array format
      stepOutputs[`step${currentStep}`] = {
        outputs: generatedOutputs.map((output, idx) => {
          // Truncate prompt_used to prevent step_outputs from becoming too large
          const truncatedPrompt = output.prompt_used?.slice(0, 200) + (output.prompt_used?.length > 200 ? '...' : '');
          return {
            output_upload_id: output.output_upload_id,
            qa_decision: output.qa_decision,
            qa_reason: output.qa_reason,
            approval_status: output.qa_decision === "approved" ? "approved" : "pending",
            prompt_used: truncatedPrompt,
            variation_index: idx,
            ...(output.camera_angle ? { camera_angle: output.camera_angle } : {}),
            ...(output.preset_id ? { preset_id: output.preset_id } : {})
          };
        }),
        // Step metadata with partial success info
        overall_qa_decision: overallQaDecision,
        overall_qa_reason: overallQaReason,
        approved_count: approvedCount,
        rejected_count: rejectedCount,
        aspect_ratio: pipeline.aspect_ratio || "16:9",
        output_quality: pipeline.output_resolution || "2K",
        output_count: generatedOutputs.length,
        ...(currentStep === 3 ? { used_preset_ids: usedPresetIds } : {}),
        ...(currentStep === 4 ? {
          camera_position: camera_position,
          forward_direction: forward_direction
        } : {}),
        ...(currentStep === 2 ? {
          ...(designRefIds.length > 0 ? {
            design_ref_upload_ids: designRefIds,
            style_transfer_applied: true
          } : {}),
          ...(selectedStyleTitle ? { style_title: selectedStyleTitle } : {})
        } : {})
      };
    }

    // PARTIAL SUCCESS HANDLING: Step goes to waiting_approval if at least ONE output is valid
    // The step is NOT marked as failed/rejected if partial success
    // Only mark as step{N}_rejected if ALL outputs failed
    const stepStatus = overallQaDecision === "rejected"
      ? `step${currentStep}_rejected`
      : `step${currentStep}_waiting_approval`;

    // Determine whole_apartment_phase for Whole Apartment mode pipelines
    // This is CRITICAL: The UI relies on this phase to show Approve/Reject controls
    let wholeApartmentPhaseUpdate: string | null = null;
    if (pipeline.pipeline_mode === "whole_apartment") {
      if (overallQaDecision === "rejected") {
        // If rejected, stay in pending state for retry
        if (currentStep === 1) {
          wholeApartmentPhaseUpdate = "top_down_3d_pending";
        } else if (currentStep === 2) {
          wholeApartmentPhaseUpdate = "style_pending";
        }
      } else {
        // If approved or partial success, move to review phase
        if (currentStep === 1) {
          wholeApartmentPhaseUpdate = "top_down_3d_review";
        } else if (currentStep === 2) {
          wholeApartmentPhaseUpdate = "style_review";
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CRITICAL FIX: Clear step_retry_state when QA passes
    // This prevents the UI from showing retry controls when a step has succeeded
    // ═══════════════════════════════════════════════════════════════════════════
    let updatedStepRetryState: Record<string, any> | null = null;
    if (overallQaDecision !== "rejected") {
      // QA passed - clear or mark the retry state as successful
      const { data: currentPipelineState } = await supabaseAdmin
        .from("floorplan_pipelines")
        .select("step_retry_state")
        .eq("id", pipeline_id)
        .single();

      const existingRetryState = (currentPipelineState?.step_retry_state || {}) as Record<string, any>;
      const stepKey = `step_${currentStep}`;

      if (existingRetryState[stepKey]) {
        // Update the step state to mark as passed, preserve attempt history
        existingRetryState[stepKey] = {
          ...existingRetryState[stepKey],
          status: "qa_pass",
          last_qa_result: {
            decision: overallQaDecision,
            reason: overallQaReason,
            output_upload_ids: generatedOutputs.map((o: any) => o.output_upload_id),
            qa_executed: true,
          },
          updated_at: new Date().toISOString(),
        };
        updatedStepRetryState = existingRetryState;
        console.log(`[run-pipeline-step] Cleared step_retry_state for step ${currentStep} - QA passed`);
      }
    }

    const updatePayload: Record<string, any> = {
      status: stepStatus,
      step_outputs: stepOutputs,
      updated_at: new Date().toISOString()
    };

    if (wholeApartmentPhaseUpdate) {
      updatePayload.whole_apartment_phase = wholeApartmentPhaseUpdate;
      console.log(`[run-pipeline-step] Setting whole_apartment_phase to: ${wholeApartmentPhaseUpdate}`);
    }

    // Include updated step_retry_state if QA passed
    if (updatedStepRetryState) {
      updatePayload.step_retry_state = updatedStepRetryState;
    }

    const { error: updateError } = await supabaseAdmin
      .from("floorplan_pipelines")
      .update(updatePayload)
      .eq("id", pipeline_id);

    // CRITICAL: If this update fails, the UI will not have step_outputs / phase information
    // to render the review panel (Approve/Reject). We must fail loudly so the catch
    // handler can reset state and persist last_error.
    if (updateError) {
      await emitStepError(
        supabaseAdmin,
        pipeline_id,
        user.id,
        currentStep,
        "DB_UPDATE_ERROR",
        `Failed to persist final pipeline update: ${updateError.message}`
      );
      return new Response(JSON.stringify({
        error: `Failed to persist pipeline update: ${updateError.message}`,
        error_code: "DB_UPDATE_ERROR",
        action_id: actionId,
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const isAwaitingApproval = overallQaDecision !== "rejected";

    await emitEvent(
      supabaseAdmin,
      pipeline_id,
      user.id,
      currentStep,
      isAwaitingApproval ? "step_complete" : "step_rejected",
      isAwaitingApproval
        ? `Step ${currentStep} complete - ${generatedOutputs.length} output(s) awaiting approval`
        : `Step ${currentStep} rejected by AI-QA - please retry`,
      currentStep * 25
    );

    // Create notification
    await supabaseAdmin.from("notifications").insert({
      owner_id: user.id,
      project_id: pipeline.project_id,
      type: isAwaitingApproval ? "pipeline_step_complete" : "pipeline_step_rejected",
      title: isAwaitingApproval
        ? `Pipeline Step ${currentStep} Complete`
        : `Pipeline Step ${currentStep} Rejected`,
      message: isAwaitingApproval
        ? (generatedOutputs.length > 1
          ? `Step ${currentStep} generated ${generatedOutputs.length} outputs ready for review`
          : `Step ${currentStep} is ready for your review`)
        : `AI-QA rejected Step ${currentStep}. You can retry this step.`,
      target_route: `/projects/${pipeline.project_id}`,
      target_params: { tab: "floor-plan-jobs", pipelineId: pipeline_id }
    });

    // Import flushLangfuse is at top of file (need to add import first)
    // CRITICAL: Return success - Langfuse flush should have been added via import
    return new Response(JSON.stringify({
      success: true,
      outputCount: generatedOutputs.length,
      outputs: generatedOutputs.map(o => ({ uploadId: o.output_upload_id, qa: o.qa_decision }))
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error("[run-pipeline-step] Pipeline step error:", error);

    // Try to reset pipeline status and emit error event
    // Note: pipeline_id is already available in scope from request body parsing
    try {
      // Don't use req.clone() - body was already consumed by req.json() earlier
      // pipeline_id is already available from the main try block
      if (typeof pipeline_id !== 'undefined' && pipeline_id) {
        const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const { data: pipeline } = await supabaseAdmin
          .from("floorplan_pipelines")
          .select("current_step, status, owner_id")
          .eq("id", pipeline_id)
          .maybeSingle();

        if (pipeline) {
          const errorMessage = error instanceof Error ? error.message : "Unknown error";

          // Emit step_error event if we have pipeline context
          try {
            await supabaseAdmin.from("floorplan_pipeline_events").insert({
              pipeline_id: pipeline_id,
              owner_id: pipeline.owner_id,
              step_number: pipeline.current_step ?? 0,
              type: "step_error",
              message: `[UNHANDLED_ERROR] ${errorMessage}`,
              progress_int: 0
            });
          } catch (eventError) {
            console.error("[CRITICAL] Could not write error event:", eventError);
          }

          // Reset status if pipeline is running
          if (pipeline.status?.includes("running")) {
            await supabaseAdmin
              .from("floorplan_pipelines")
              .update({
                status: `step${pipeline.current_step}_pending`,
                last_error: `[UNHANDLED_ERROR] ${errorMessage}`,
                updated_at: new Date().toISOString()
              })
              .eq("id", pipeline_id);
            console.log(`[run-pipeline-step] Reset pipeline ${pipeline_id} to step${pipeline.current_step}_pending`);
          }
        }
      }
    } catch (resetError) {
      console.error("[run-pipeline-step] Failed to reset pipeline status:", resetError);
    }

    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Unknown error",
      error_code: "UNHANDLED_ERROR"
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});

// Helper function to determine if rejection is structural (walls/openings/floor/boundaries)
function isStructuralIssue(reason: string): boolean {
  const lowerReason = reason.toLowerCase();
  const structuralKeywords = [
    "wall", "walls", "door", "doors", "window", "windows", "opening", "openings",
    "floor", "boundary", "boundaries", "room", "geometry", "proportion", "proportions",
    "position", "positions", "size", "sizes", "layout", "structure", "structural",
    "moved", "missing", "added", "removed", "changed", "distorted", "inconsistent"
  ];

  // Check if the rejection reason contains structural keywords
  return structuralKeywords.some(keyword => lowerReason.includes(keyword));
}

async function emitEvent(
  supabase: any,
  pipelineId: string,
  ownerId: string,
  stepNumber: number,
  type: string,
  message: string,
  progressInt: number
) {
  await supabase.from("floorplan_pipeline_events").insert({
    pipeline_id: pipelineId,
    owner_id: ownerId,
    step_number: stepNumber,
    type,
    message,
    progress_int: progressInt
  });
}

type QAImageInput = {
  signedUrl?: string | null;
  base64?: string | null;
};

// Extended QA result type with all possible check fields
interface QAResult {
  decision: string;
  reason: string;
  qa_executed: boolean;
  // Individual check fields from different QA prompts
  geometry_check?: string;
  scale_check?: string;
  furniture_check?: string;
  furniture_type_check?: string;
  furniture_size_check?: string;
  structural_check?: string;
  flooring_check?: string; // Step 1 new category
  bed_size_issues?: string[];
  furniture_issues?: string[];
  // Room type validation
  room_type_violation?: boolean;
  detected_room_type?: string;
  structural_violation?: boolean;
  // Step 3 specific
  structural_issues?: Array<{ type: string; description: string; step3_evidence?: string; generated_evidence?: string }>;
  issues?: Array<{ type: string; severity: string; description: string; location_hint?: string; visual_evidence?: string }>;
  // Generic fields
  score?: number;
  pass?: boolean;
  request_fulfilled?: boolean;
  request_analysis?: string;
  recommended_action?: string;
  corrected_instructions?: string;
  // Structured reasons for detailed UI (Step 1 new format)
  reasons?: Array<{ code: string; description: string }>;
  raw_qa_result?: Record<string, unknown>;
  // Text overlay preservation check (Steps 0-5)
  text_overlay_check?: {
    passed: boolean;
    labels_verified_count?: number;
    missing_labels?: string[];
    changed_labels?: Array<{ original: string; new: string }>;
    added_labels?: string[];
    moved_labels?: string[];
    summary: string;
  };
}

/**
 * runQAValidation - NEW IMPLEMENTATION
 * Delegates to run-qa-check Edge Function (Gemini-based with scoring)
 * Replaces old OpenAI-based inline QA logic
 */
async function runQAValidation(
  input: QAImageInput,
  output: QAImageInput,
  stepNumber: number,
  pipeline_id: string,
  project_id: string,
  user_id: string,
  output_upload_id: string | null,
  current_attempt: number,
  authHeader: string,
): Promise<QAResult> {
  // EXPLICIT QA EXECUTION TRACKING - keep logs lightweight
  const qaStartTime = Date.now();
  console.log(
    `[QA] Step ${stepNumber} started (via run-qa-check Edge Function)`,
  );

  try {
    // Call run-qa-check Edge Function (Gemini-based with scoring)
    // This replaces the old OpenAI inline QA logic

    console.log(`[QA] Preparing request to run-qa-check Edge Function`);
    console.log(`[QA] Pipeline: ${pipeline_id}, Project: ${project_id}, Step: ${stepNumber}, Attempt: ${current_attempt}`);

    // Build request payload for run-qa-check
    // CRITICAL: run-qa-check only accepts qa_type: "render" | "panorama" | "merge"
    // Map step numbers to valid qa_type values
    let qaType: string;
    if (stepNumber === 4) {
      qaType = "panorama";
    } else if (stepNumber === 7) {
      qaType = "merge";
    } else {
      // Steps 1, 2, 3 all use "render" type (structural validation)
      qaType = "render";
    }

    const qaCheckPayload: Record<string, unknown> = {
      upload_id: output_upload_id,
      qa_type: qaType,
      step_id: stepNumber,
      project_id: project_id,
      asset_id: pipeline_id, // For auto-retry tracking
      asset_type: "pipeline_step",
      current_attempt: current_attempt,
    };

    console.log(`[QA] Mapped Step ${stepNumber} to qa_type: ${qaType}`);

    console.log(`[QA] Calling run-qa-check: ${JSON.stringify(qaCheckPayload)}`);

    // Add timeout to prevent QA from hanging indefinitely
    const QA_TIMEOUT_MS = 120000; // 2 minutes max for QA
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), QA_TIMEOUT_MS);

    let qaResponse: Response;
    try {
      qaResponse = await fetch(`${SUPABASE_URL}/functions/v1/run-qa-check`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": authHeader,
        },
        body: JSON.stringify(qaCheckPayload),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
    } catch (fetchError) {
      clearTimeout(timeoutId);
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        console.error(`[QA] run-qa-check timed out after ${QA_TIMEOUT_MS}ms`);
        return {
          decision: "rejected",
          reason: `QA timed out after ${QA_TIMEOUT_MS / 1000}s`,
          qa_executed: false,
          qa_score: null,
        };
      }
      throw fetchError;
    }

    const qaEndTime = Date.now();
    console.log(`[QA] run-qa-check completed in ${qaEndTime - qaStartTime}ms, status: ${qaResponse.status}`);

    if (!qaResponse.ok) {
      console.error(`[QA] run-qa-check returned ${qaResponse.status}`);
      const errorText = await qaResponse.text();
      console.error(`[QA] Error response: ${errorText.substring(0, 500)}`);

      return {
        decision: "rejected",
        reason: `QA service error (${qaResponse.status})`,
        qa_executed: false,
        qa_score: null,
      };
    }

    const qaResult = await qaResponse.json();
    console.log(`[QA] run-qa-check result:`, JSON.stringify(qaResult, null, 2));

    // Extract decision and score from run-qa-check response
    const decision = qaResult.qa_decision || qaResult.decision || "rejected";
    const score = qaResult.qa_score != null ? qaResult.qa_score : null;
    const reasons = qaResult.reasons || [];
    const reason = reasons.length > 0
      ? reasons.map((r: { category?: string; short_reason?: string }) =>
        r.category ? `[${r.category}] ${r.short_reason}` : r.short_reason
      ).join("; ")
      : (qaResult.summary || qaResult.reason || (decision === "approved" ? "All checks passed" : "QA check failed"));

    console.log(`[QA] Final decision: ${decision}, score: ${score}, reason: ${reason.substring(0, 200)}`);

    return {
      decision,
      reason,
      qa_executed: true,
      qa_score: score, // Numeric score (0-100) for display
      reasons: reasons.map((r: { category?: string; short_reason?: string; code?: string }) => ({
        code: r.code || r.category?.toUpperCase() || "UNKNOWN",
        description: r.short_reason || "",
      })),
      raw_qa_result: qaResult,
    };

  } catch (error) {
    const qaEndTime = Date.now();
    console.error(`[QA] Step ${stepNumber} ERROR after ${qaEndTime - qaStartTime}ms:`, error);

    return {
      decision: "rejected",
      reason: "QA validation error",
      qa_executed: false,
      qa_score: null,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// OLD INLINE QA LOGIC (DEPRECATED - KEPT FOR REFERENCE)
// ═══════════════════════════════════════════════════════════════════════════
// The code below was the old OpenAI-based inline QA logic.
// It has been REPLACED by the run-qa-check Edge Function call above.
// Keeping it commented for reference/rollback if needed.
// ═══════════════════════════════════════════════════════════════════════════
/*
async function runQAValidationOLD(
  input: QAImageInput,
  output: QAImageInput,
  stepNumber: number,
): Promise<QAResult> {
  try {
    // Step-specific QA prompts with structural focus for Step 1
    let qaPrompt: string;

    if (stepNumber === 1) {
      // ═══════════════════════════════════════════════════════════════════════════
      // STEP 1 QA: 2D Floor Plan → Top-Down 3D Render
      // DETERMINISTIC, ARCHITECTURAL-LOGIC-BASED VALIDATION WITH COMMON SENSE
      // ═══════════════════════════════════════════════════════════════════════════
      qaPrompt = `You are an EXPERIENCED ARCHITECT performing QA validation on a 2D floor plan to top-down 3D render conversion.

You must apply ARCHITECTURAL COMMON SENSE, not pixel-perfect literal matching.

═══════════════════════════════════════════════════════════════════════════════
STEP 1 QA - TEXT CHECKS COMPLETELY DISABLED
═══════════════════════════════════════════════════════════════════════════════

CRITICAL: This is a 2D→3D transformation. Text labels from the 2D floor plan
are NOT expected to appear in the 3D render. DO NOT check for text at all.

═══════════════════════════════════════════════════════════════════════════════
QA CHECKS - PRIORITY ORDER (evaluate ONLY these):
═══════════════════════════════════════════════════════════════════════════════

1. ROOM COUNT CONSISTENCY (STRICT):
   - Count the number of main functional rooms in both images
   - No new rooms may appear that don't exist in the floor plan
   - No existing rooms may disappear
   - This is PASS/FAIL with no exceptions

2. ROOM TYPE CONSISTENCY (STRICT):
   - A bathroom must not appear where none exists in the plan
   - A bedroom must not turn into a bathroom or kitchen
   - Functional room roles must remain consistent
   - Kitchen areas must stay kitchen areas
   - Bathrooms must stay bathrooms

3. MAJOR FURNITURE INTEGRITY (STRICT):
   - Large, defining furniture must remain consistent:
     * Beds in bedrooms (appropriate size for room)
     * Toilets/showers ONLY in bathrooms
     * Kitchen counters ONLY in kitchen areas
   - No additional major furniture beyond what exists in the plan
   - No removal of major furniture that exists in the plan

4. FURNITURE ORIENTATION (BASIC):
   - Beds must not rotate arbitrarily
   - Large furniture orientation must roughly match the plan
   - Minor rotation tolerance is allowed, but not layout changes

5. STRUCTURAL FIDELITY (WALLS/DOORS/WINDOWS):
   - Walls MUST be in the SAME positions as the original floor plan
   - Windows MUST be in the SAME positions
   - Doors MUST be in the SAME positions
   - NO walls, windows, or doors may be added, removed, or relocated

═══════════════════════════════════════════════════════════════════════════════
COMPLETELY FORBIDDEN QA CHECKS FOR STEP 1 (NEVER USE THESE):
═══════════════════════════════════════════════════════════════════════════════

✗ Text labels - DO NOT CHECK (2D labels don't transfer to 3D)
✗ Room name labels - DO NOT CHECK
✗ Text presence/absence - DO NOT CHECK
✗ Text position - DO NOT CHECK
✗ Text font/color/language - DO NOT CHECK
✗ Lighting quality, mood, or direction
✗ Decorative style or aesthetics
✗ Material realism beyond basic flooring type
✗ Artistic interpretation
✗ Color harmony or color choices
✗ Subjective "looks realistic" judgments

═══════════════════════════════════════════════════════════════════════════════
DECISION RULES:
═══════════════════════════════════════════════════════════════════════════════

APPROVE ("approved") if:
- Room count matches the original floor plan
- Room types are consistent (bathrooms are bathrooms, bedrooms are bedrooms)
- Major furniture is present and appropriately placed
- Structural elements preserved (walls, windows, doors in correct positions)
- No hallucinated rooms or major furniture

REJECT ("rejected") ONLY if:
- room_count_mismatch: Different number of functional rooms
- room_type_violation: Room type changed (e.g., bedroom became bathroom)
- structural_change: Wall, window, or door added/removed/relocated
- extra_furniture: Major furniture added that doesn't exist in the floor plan
- missing_furniture: Major furniture missing that exists in the floor plan
- furniture_placement: Major furniture in wrong room type (toilet in bedroom)

═══════════════════════════════════════════════════════════════════════════════
MANDATORY OUTPUT FORMAT (JSON only):
═══════════════════════════════════════════════════════════════════════════════

{
  "status": "approved" | "rejected",
  "reasons": [
    {
      "category": "room_count_mismatch" | "room_type_violation" | "structural_change" | "extra_furniture" | "missing_furniture" | "furniture_placement",
      "short_reason": "One concrete sentence explaining the issue"
    }
  ],
  "room_count_original": 5,
  "room_count_generated": 5,
  "room_types_verified": ["bedroom", "bathroom", "kitchen", "living_room", "hallway"]
}

RULES FOR OUTPUT:
- If "rejected": reasons array MUST have at least one entry with specific category and short_reason
- If "approved": reasons array MUST be empty []
- NO text_overlay_check for Step 1 (text checks are disabled)
- No vague or generic language allowed
- Each reason MUST have a concrete, factual observation
- Do NOT include any categories not listed above

EXAMPLES:

Approved output:
{"status": "approved", "reasons": [], "room_count_original": 5, "room_count_generated": 5, "room_types_verified": ["master_bedroom", "bedroom", "bathroom", "kitchen", "living_room"]}

Rejected output (room type violation):
{"status": "rejected", "reasons": [{"category": "room_type_violation", "short_reason": "The secondary bedroom shows a toilet and shower, but the floor plan shows this as a bedroom"}], "room_count_original": 5, "room_count_generated": 5, "room_types_verified": ["master_bedroom", "bathroom", "bathroom", "kitchen", "living_room"]}

Rejected output (structural issue):
{"status": "rejected", "reasons": [{"category": "structural_change", "short_reason": "Kitchen wall separating from dining room is missing in the render"}], "room_count_original": 5, "room_count_generated": 5, "room_types_verified": ["master_bedroom", "bedroom", "bathroom", "kitchen", "living_room"]}`;
    } else if (stepNumber === 3) {
      // ═══════════════════════════════════════════════════════════════
      // STEP 3 QA - EXPLICIT EXECUTION VERIFICATION
      // ═══════════════════════════════════════════════════════════════
      console.log(`[Step 3 QA] ▶▶▶ EXECUTING Step 3 QA validation`);
      console.log(`[Step 3 QA] Comparing Step 2 output (input) vs Step 3 output`);

      qaPrompt = `You are performing MANDATORY QA validation on Step 3 (Camera-Angle Render).

═══════════════════════════════════════════════════════════════
STEP 3 QA - EXECUTION REQUIRED
═══════════════════════════════════════════════════════════════

This is a REAL validation. You MUST:
1. Actually examine BOTH images carefully
2. Report REAL observations, not assumptions
3. Make a deterministic decision based on evidence

═══════════════════════════════════════════════════════════════
COMPARISON METHODOLOGY - Step 2 Output vs Step 3 Output
═══════════════════════════════════════════════════════════════

PHASE 1 - STRUCTURAL ELEMENT CHECK:

Examine and report on EACH of these elements:

□ WALLS: Are walls in the SAME positions in both images?
□ DOORS: Are door openings in the SAME locations?
□ WINDOWS: Are windows in the SAME positions?
□ OPENINGS: Are passages/archways unchanged?

PHASE 2 - FURNITURE ELEMENT CHECK:

□ FURNITURE COUNT: Same number of major furniture pieces?
□ FURNITURE POSITIONS: Furniture in same relative locations?
□ FURNITURE TYPES: Same furniture types (sofa is still sofa)?

PHASE 3 - CAMERA/VIEW CHECK (EXPECTED CHANGE):

□ CAMERA ANGLE: Has the viewing angle changed? (EXPECTED)
□ PERSPECTIVE: Is this now eye-level view? (EXPECTED)

═══════════════════════════════════════════════════════════════
DECISION RULES (STRICT):
═══════════════════════════════════════════════════════════════

APPROVE if:
- Walls, doors, windows in correct positions
- Furniture preserved (positions may shift due to perspective)
- Camera angle is the only major change

REJECT if:
- Wall added, removed, or relocated
- Door blocked, removed, or relocated
- Window blocked, removed, or relocated
- Major furniture piece missing or drastically repositioned

NO-CHANGE if:
- Output appears identical to input (no camera change applied)

═══════════════════════════════════════════════════════════════
COMPLETELY IGNORE (NEVER rejection reasons):
═══════════════════════════════════════════════════════════════
- Text, labels, annotations, room names
- Dimension markings, measurements
- Color/lighting variations
- Material/texture differences
- Style changes

═══════════════════════════════════════════════════════════════
FORBIDDEN:
═══════════════════════════════════════════════════════════════
- DO NOT claim changes that don't exist
- DO NOT hallucinate differences
- DO NOT approve without actual comparison
- DO NOT use vague language

═══════════════════════════════════════════════════════════════
RESPONSE FORMAT (JSON ONLY):
═══════════════════════════════════════════════════════════════

You MUST respond with this exact JSON structure:
{
  "decision": "approved" | "rejected" | "no_change",
  "reason": "SPECIFIC observation based on actual visual comparison",
  "structural_check": "passed" | "failed",
  "furniture_check": "passed" | "failed" | "minor_change",
  "camera_changed": true | false
}`;
    } else if (stepNumber === 4) {
      // Step 4: 360° Panorama validation
      qaPrompt = `Compare the input image with the generated 360° panorama output.

Check:
1. Is it a true 2:1 equirectangular panorama?
2. Are there any fisheye circles or warped geometry?
3. Are vertical lines straight?
4. Is the perspective correct for VR viewing?
5. Are the original elements preserved?

COMPLETELY IGNORE (NEVER use as rejection reasons):
- ALL textual annotations, labels, room names
- ALL dimension markings, measurements
- Color/material/lighting variations (expected for rendering)

Respond with ONLY valid JSON: {"decision": "approved" or "rejected", "reason": "brief explanation"}`;
    } else if (stepNumber === 2) {
      // Step 2: Design Style Change validation with FURNITURE PRESERVATION + TEXT OVERLAY
      // STEP 2 QA IS ACTIVE - Log entry to confirm execution
      console.log(`[Step 2 QA] EXECUTING Step 2 validation - comparing input vs styled output`);

      qaPrompt = `You are performing QA validation on a STEP 2 (Design Style Change) output.

═══════════════════════════════════════════════════════════════
STEP 2 PURPOSE: Apply interior design style changes.
Style differences (colors, textures, lighting) are EXPECTED and CORRECT.
═══════════════════════════════════════════════════════════════

YOUR TASK: Validate STRUCTURAL CONSISTENCY + FURNITURE PRESERVATION + TEXT OVERLAY PRESERVATION.

CHECK THESE STRUCTURAL ELEMENTS (must match input):

1. WALL POSITIONS:
   - Are walls in the SAME positions?
   - Walls NOT added, removed, or relocated?

2. DOORS & OPENINGS:
   - Are door openings in the EXACT same locations?
   - Doors NOT blocked, removed, or relocated?

3. WINDOWS:
   - Are windows in the SAME positions?
   - Windows NOT blocked, removed, or relocated?

4. ROOM BOUNDARIES:
   - Are room proportions visually preserved?
   - Room shapes NOT distorted?

5. FURNITURE TYPES (CRITICAL - must NOT change):
   - Are SAME furniture types present? (beds, sofas, tables, etc.)
   - Is a SINGLE BED still a SINGLE BED (not changed to double)?
   - Is a DOUBLE BED still a DOUBLE BED (not changed to single)?
   - Are furniture COUNTS preserved (same number of chairs, etc.)?

6. FURNITURE SIZES (CRITICAL - must NOT change):
   - Are furniture SIZES preserved (not scaled up/down)?
   - Are bed sizes consistent with input?

7. TEXT/LABEL PRESERVATION (STRICT - Steps 0-5):
   Compare room name labels between input and output:
   - All room name labels MUST still be present
   - Labels MUST have identical text (same spelling, language)
   - Labels MUST be in the same positions (no noticeable movement)
   - NO new text/labels/watermarks may be added
   - Font, color, and size should be preserved

═══════════════════════════════════════════════════════════════
COMPLETELY IGNORE (NEVER use as rejection reasons):
═══════════════════════════════════════════════════════════════
- Color changes (EXPECTED)
- Texture changes (EXPECTED)
- Material variations (EXPECTED)
- Lighting mood changes (EXPECTED)
- Furniture STYLE changes (EXPECTED - e.g., modern to rustic)
- Any aesthetic/stylistic differences

═══════════════════════════════════════════════════════════════
DECISION RULES:
═══════════════════════════════════════════════════════════════

APPROVE IF:
- All walls, doors, windows in correct positions
- Room proportions preserved
- Furniture TYPES and SIZES preserved (only STYLE changed)
- All original room name labels are present, unchanged, and in correct positions
- Only style/design changes applied (which is the goal)

REJECT ONLY IF:
- Walls physically moved, removed, or incorrectly added
- Doors or windows blocked, removed, or relocated
- Room geometry/proportions significantly distorted
- Furniture TYPE changed (e.g., single bed → double bed) → FurnitureTypeMismatch
- Furniture SIZE changed (e.g., small table → large table) → FurnitureSizeMismatch
- Major furniture ADDED or REMOVED → FurnitureHallucination
- Room name label MISSING → TextLabelMissing
- Room name label CHANGED (text differs) → TextLabelChanged
- Room name label MOVED noticeably → TextLabelMoved
- New text/labels/watermarks ADDED → TextLabelAdded

═══════════════════════════════════════════════════════════════
RESPONSE FORMAT (JSON only):
═══════════════════════════════════════════════════════════════

Respond with ONLY valid JSON:
{
  "decision": "approved" or "rejected",
  "reason": "SPECIFIC structural/furniture/text observation - what you verified",
  "structural_check": "passed" or "failed",
  "furniture_type_check": "passed" or "failed",
  "furniture_size_check": "passed" or "failed",
  "furniture_issues": ["description of any furniture type/size mismatches"] or [],
  "text_overlay_check": {
    "passed": true or false,
    "labels_verified_count": 8,
    "missing_labels": [],
    "changed_labels": [],
    "added_labels": [],
    "moved_labels": [],
    "summary": "All 8 room labels preserved correctly"
  }
}

Examples:
- {"decision": "approved", "reason": "Structural layout verified: walls, doors, windows in correct positions. Furniture types and sizes preserved. All 6 room labels preserved. Style changes applied as expected.", "structural_check": "passed", "furniture_type_check": "passed", "furniture_size_check": "passed", "furniture_issues": [], "text_overlay_check": {"passed": true, "labels_verified_count": 6, "missing_labels": [], "changed_labels": [], "added_labels": [], "moved_labels": [], "summary": "All labels preserved"}}
- {"decision": "rejected", "reason": "'Kitchen' room label is missing from the styled output.", "structural_check": "passed", "furniture_type_check": "passed", "furniture_size_check": "passed", "furniture_issues": [], "text_overlay_check": {"passed": false, "labels_verified_count": 5, "missing_labels": ["Kitchen"], "changed_labels": [], "added_labels": [], "moved_labels": [], "summary": "1 label missing"}}
- {"decision": "rejected", "reason": "Bedroom 2 single bed replaced with double bed in styled output.", "structural_check": "passed", "furniture_type_check": "failed", "furniture_size_check": "failed", "furniture_issues": ["Bedroom 2: single bed changed to double bed"], "text_overlay_check": {"passed": true, "labels_verified_count": 6, "missing_labels": [], "changed_labels": [], "added_labels": [], "moved_labels": [], "summary": "All labels preserved"}}`;
    } else {
      // Fallback for any other step
      qaPrompt = `Compare the input image with the generated output and verify structural consistency.
Respond with ONLY valid JSON: {"decision": "approved" or "rejected", "reason": "brief explanation"}`;
    }

    // OpenAI-based QA has been removed - system now uses Gemini for QA
    // This function is deprecated and returns a default rejection
    console.log(`[QA EXECUTION] OpenAI-based QA removed - returning default rejection`);
    return { decision: "rejected", reason: "OpenAI QA deprecated - use Gemini-based QA", qa_executed: false };
      body: JSON.stringify({
        model: "gpt-4o",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: qaPrompt },
              {
                type: "image_url",
                image_url: { url: inputUrl, detail: "high" }
              },
              {
                type: "image_url",
                image_url: { url: outputUrl, detail: "high" }
              }
            ]
          }
        ],
        max_completion_tokens: 1000
      })
    });

    if (!response.ok) {
      // Do NOT auto-approve on QA API error (any step): return rejected so it can't silently pass.
      console.error(`[QA EXECUTION] Step ${stepNumber} API error. Status: ${response.status}`);
      return { decision: "rejected", reason: `QA API error (${response.status})`, qa_executed: false };
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content || "";

    const qaEndTime = Date.now();
    console.log(`[QA EXECUTION] Step ${stepNumber} QA completed in ${qaEndTime - qaStartTime}ms`);
    console.log(`[QA EXECUTION] Raw response length: ${content.length} chars`);

    // Parse JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      console.log(`[QA EXECUTION] Step ${stepNumber} RESULT:`, JSON.stringify(parsed));
      console.log(`[QA EXECUTION] ═══════════════════════════════════════════════════════`);

      // Step 1 uses new format with "status" and "reasons" array
      if (stepNumber === 1) {
        // Normalize Step 1 response: status → decision, reasons → reason
        const decision = parsed.status === "approved" ? "approved" : "rejected";
        const reasons = parsed.reasons || [];
        const reason = reasons.length > 0
          ? reasons.map((r: { category: string; short_reason: string }) => `[${r.category}] ${r.short_reason}`).join("; ")
          : (decision === "approved" ? "All checks passed" : "QA check failed");

        // Extract individual check statuses from categories
        const hasFlooringIssue = reasons.some((r: { category: string }) => r.category === "flooring_mismatch");
        const hasScaleIssue = reasons.some((r: { category: string }) => r.category === "furniture_scale");
        const hasExtraFurniture = reasons.some((r: { category: string }) => r.category === "extra_furniture");
        const hasStructuralChange = reasons.some((r: { category: string }) => r.category === "structural_change");

        return {
          decision,
          reason,
          qa_executed: true,
          // Map to legacy check fields for UI compatibility
          flooring_check: hasFlooringIssue ? "failed" : "passed",
          scale_check: hasScaleIssue ? "failed" : "passed",
          furniture_check: hasExtraFurniture ? "failed" : "passed",
          structural_check: hasStructuralChange ? "failed" : "passed",
          geometry_check: hasStructuralChange ? "failed" : "passed",
          // Store structured reasons for detailed UI
          reasons: reasons.map((r: { category: string; short_reason: string }) => ({
            code: r.category.toUpperCase(),
            description: r.short_reason
          })),
          // Raw response for debugging
          raw_qa_result: parsed,
        };
      }

      // Other steps use existing "decision" format
      // Validate that we got a real decision, not empty/undefined
      if (!parsed.decision || (parsed.decision !== "approved" && parsed.decision !== "rejected" && parsed.decision !== "no_change")) {
        console.error(`[QA EXECUTION] Step ${stepNumber} invalid decision: "${parsed.decision}"`);
        // Step 3 must hard-fail to prevent proceeding with an unvalidated camera step.
        if (stepNumber === 3) {
          throw new Error(`Step 3 QA returned invalid decision: ${parsed.decision}`);
        }
        return { decision: "rejected", reason: "QA returned invalid decision format", qa_executed: false };
      }

      return { ...parsed, qa_executed: true };
    }

    // Parsing failed: never silently approve.
    console.warn(`[QA EXECUTION] Step ${stepNumber} could not parse response`);
    if (stepNumber === 3) {
      throw new Error("Step 3 QA failed to parse - cannot validate output");
    }
    return { decision: "rejected", reason: "QA response parse failure", qa_executed: false };
  } catch (error) {
    console.error(`[QA EXECUTION] Step ${stepNumber} ERROR:`, error);

    if (stepNumber === 3) {
      throw error;
    }

    // Reject on QA execution failures (prevents silent approvals).
    return { decision: "rejected", reason: "QA validation error", qa_executed: false };
  }
}
*/
// END OF OLD INLINE QA LOGIC
