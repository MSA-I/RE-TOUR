/**
 * Dimension Extraction & Wall Geometry Utility for RE:TOUR
 * 
 * Extracts real-world dimensions and wall geometry from floor plans to ensure 
 * scale-consistent and geometry-faithful generation across all pipeline steps.
 */

export interface ExtractedDimension {
  label: string;       // e.g., "Room width", "Wall length", "Overall length"
  value: number;       // Numeric value
  unit: string;        // "m", "cm", "ft", "in"
  confidence: number;  // 0.0 - 1.0
  raw_text: string;    // Original text from plan, e.g., "3.20m"
}

/**
 * Wall Geometry Analysis Result
 */
export interface WallGeometryResult {
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

export interface DimensionAnalysisResult {
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
  // Wall geometry analysis
  wall_geometry?: WallGeometryResult;
}

/**
 * Prompt for AI-based dimension extraction from floor plan images
 */
export const DIMENSION_EXTRACTION_PROMPT = `You are an expert architectural analyst specializing in reading floor plans.

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

/**
 * Prompt for AI-based wall geometry detection from floor plan images
 */
export const WALL_GEOMETRY_EXTRACTION_PROMPT = `You are an expert architectural analyst specializing in floor plan geometry.

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

/**
 * Build the scale guidance text block for prompts
 */
export function buildScaleGuidanceBlock(analysis: DimensionAnalysisResult): string {
  if (!analysis.dimensions_found || analysis.extracted_dimensions.length === 0) {
    return `SCALE & PROPORTIONS:
- Preserve proportions exactly as shown in the floor plan.
- Maintain accurate room shapes and relative sizes.
- No dimension annotations detected; rely on visual proportions only.`;
  }

  const unitLabel = analysis.units === "metric" ? "meters/centimeters" : 
                    analysis.units === "imperial" ? "feet/inches" : "detected units";

  // Extract key dimensions (highest confidence ones)
  const keyDimensions = analysis.extracted_dimensions
    .filter(d => d.confidence >= 0.8)
    .slice(0, 6) // Max 6 key dimensions
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

  return `SCALE & DIMENSIONS (LOCKED - DO NOT VIOLATE):
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

/**
 * Build scale constraints for interior render prompts
 */
export function buildRenderScaleConstraints(analysis: DimensionAnalysisResult, spaceType: string): string {
  if (!analysis.dimensions_found) {
    return `SCALE CONSISTENCY:
- Maintain realistic furniture and fixture proportions.
- Door heights: ~2.1m (7 ft)
- Standard ceiling heights: 2.4-2.7m (8-9 ft)
- Furniture should appear natural scale relative to room size.`;
  }

  // Extract room-specific dimensions if available
  const roomDimensions = analysis.extracted_dimensions
    .filter(d => 
      d.label.toLowerCase().includes(spaceType.toLowerCase()) ||
      d.label.toLowerCase().includes("room") ||
      d.label.toLowerCase().includes("width") ||
      d.label.toLowerCase().includes("length")
    )
    .slice(0, 3);

  const dimensionNotes = roomDimensions.length > 0
    ? `\nRelevant room dimensions:\n${roomDimensions.map(d => `  - ${d.label}: ${d.raw_text}`).join("\n")}`
    : "";

  return `SCALE CONSISTENCY (LOCKED FROM PLAN DIMENSIONS):
- scale_locked: TRUE
- Units: ${analysis.units}${dimensionNotes}

FURNITURE SCALE RULES:
- All furniture must fit realistically within the measured room dimensions.
- A ${analysis.units === "metric" ? "2.4m wide" : "8ft wide"} room should NOT contain an oversized sectional sofa.
- Standard proportions:
  * Door height: 2.1m (7 ft)
  * Ceiling height: 2.4-2.7m (8-9 ft)
  * Standard sofa depth: 0.9m (3 ft)
  * Dining table: 0.75m height (2.5 ft)
  * Kitchen counter: 0.9m height (3 ft)

- Verify furniture does NOT appear miniature or oversized relative to the room.
- Window and door proportions must match the floor plan measurements.`;
}

/**
 * Add scale validation checks to QA prompts
 */
export function getScaleValidationQABlock(analysis: DimensionAnalysisResult): string {
  if (!analysis.dimensions_found) {
    return `SCALE CHECK:
- Verify furniture appears at natural, realistic scale.
- Check door and window proportions look correct.
- Note: No specific dimensions available for verification.`;
  }

  return `SCALE VALIDATION (DIMENSIONS LOCKED):
- scale_locked: TRUE from floor plan annotations

CHECK FOR SCALE VIOLATIONS:
1. Does furniture appear correctly sized for the room dimensions?
   - No oversized furniture in small rooms
   - No miniature furniture in large spaces

2. Are door and window proportions realistic?
   - Doors should appear ~2.1m / 7ft tall
   - Windows should match the proportions shown in the plan

3. Is there scale drift from the floor plan?
   - Room proportions should match the measured dimensions

IF SCALE VIOLATION DETECTED:
- Flag issue type: "ScaleMismatch"
- Describe the specific violation
- This is a REJECTION reason if severe`;
}

/**
 * Build wall geometry preservation constraint block for prompts
 */
export function buildGeometryPreservationBlock(geometry: WallGeometryResult | undefined | null): string {
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

/**
 * Build geometry constraints for interior render prompts
 */
export function buildRenderGeometryConstraints(geometry: WallGeometryResult | undefined | null, spaceType: string): string {
  if (!geometry || (!geometry.has_non_orthogonal_walls && !geometry.has_curved_walls)) {
    return `WALL GEOMETRY:
- Maintain standard orthogonal wall layout for this ${spaceType}.
- Walls should appear straight and at 90° corners.`;
  }

  // Find features relevant to this space type
  const relevantFeatures = geometry.detected_features
    .filter(f => 
      f.location.toLowerCase().includes(spaceType.toLowerCase()) ||
      f.confidence >= 0.85
    )
    .slice(0, 3);

  const featureNotes = relevantFeatures.length > 0
    ? `\nRelevant geometry features:\n${relevantFeatures.map(f => `  - ${f.description} (${f.location})`).join("\n")}`
    : "";

  return `WALL GEOMETRY PRESERVATION (LOCKED FROM PLAN):
- geometry_locked: TRUE
- This space may have non-standard wall geometry.${featureNotes}

CRITICAL - Must preserve:
- All angled walls must remain angled (not straightened)
- All curved walls must remain curved
- Diagonal corners and chamfers must be maintained
- Room shape must match the floor plan exactly

Do NOT:
- Straighten any angled walls
- Remove curves from curved walls
- Convert irregular rooms to rectangular rooms`;
}

/**
 * Get geometry validation QA block for prompts
 */
export function getGeometryValidationQABlock(geometry: WallGeometryResult | undefined | null): string {
  if (!geometry || (!geometry.has_non_orthogonal_walls && !geometry.has_curved_walls && !geometry.has_diagonal_corners)) {
    return `GEOMETRY CHECK:
- Verify wall positions match the floor plan.
- Note: Standard orthogonal layout expected.`;
  }

  const features = geometry.detected_features
    .slice(0, 5)
    .map(f => `  □ ${f.type.replace(/_/g, " ")} at ${f.location}`)
    .join("\n");

  return `WALL GEOMETRY VALIDATION (CRITICAL):
- geometry_locked: TRUE from floor plan analysis

NON-STANDARD GEOMETRY DETECTED - MUST BE PRESERVED:
${features}

CHECK FOR GEOMETRY VIOLATIONS:
1. Are angled walls still angled (NOT straightened)?
2. Are curved walls still curved (NOT flattened)?
3. Are diagonal corners/chamfers preserved?
4. Do room shapes match the original irregular boundaries?

GEOMETRY MISMATCH DETECTION:
- Compare the wall boundaries between input and output
- Look for walls that were angled in input but appear straight in output
- Look for curved walls that were flattened
- Look for simplified geometry that removes complexity

IF GEOMETRY VIOLATION DETECTED:
- Flag issue type: "GeometryMismatch_NonStraightWalls"
- Describe: which wall was straightened/simplified and where
- This is a CRITICAL REJECTION reason - output must preserve wall geometry`;
}
