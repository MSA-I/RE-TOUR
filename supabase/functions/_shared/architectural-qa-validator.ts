/**
 * Architectural QA Validator
 * 
 * Validates Steps 5-7 outputs using:
 * - Original floor plan (with space names)
 * - Space list and adjacency data from Space Scan
 * - Camera marker data (position, yaw, FOV)
 * - Rendered output image
 * 
 * Hard failure rules:
 * 1. Adjacent space correctness (openings must match adjacency graph)
 * 2. Wall vs opening consistency (camera direction vs rendered content)
 * 3. Camera direction fidelity (render must match camera aim)
 * 4. No camera intent override (accuracy over aesthetics)
 */

import { SpatialMap, CameraMarker, RoomAdjacency, DetectedRoom } from "./camera-context-builder.ts";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const QA_MODEL = "gemini-2.5-pro";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface ArchitecturalQAInput {
  renderedImageBase64: string;
  renderedMimeType: string;
  floorPlanBase64?: string;
  floorPlanMimeType?: string;
  spaceName: string;
  spaceType: string;
  spaceId: string;
  cameraKind: "A" | "B";
  cameraMarker: CameraMarker | null;
  spatialMap: SpatialMap | null;
  stepNumber: 5 | 6 | 7;
  apiKey: string;
  learningContext?: string;
}

export interface ArchitecturalQAIssue {
  rule: "adjacent_space" | "wall_opening" | "camera_direction" | "camera_override" | "room_mismatch" | "geometry" | "other";
  severity: "critical" | "major" | "minor";
  description: string;
  expected?: string;
  actual?: string;
  location_hint?: string;
}

export interface ArchitecturalQAResult {
  pass: boolean;
  overall_score: number;
  issues: ArchitecturalQAIssue[];
  recommended_action: "approve" | "retry" | "needs_human";
  corrected_instructions?: string;
  validation_summary: {
    adjacency_check: "pass" | "fail" | "skipped";
    wall_opening_check: "pass" | "fail" | "skipped";
    camera_direction_check: "pass" | "fail" | "skipped";
    camera_override_check: "pass" | "fail" | "skipped";
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// ADJACENCY HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function getRoomId(room: DetectedRoom): string {
  return room.id || room.room_id || "unknown";
}

function getRoomDisplayName(room: DetectedRoom): string {
  return room.label || room.name?.replace(/_/g, " ") || "Unknown Room";
}

function buildAdjacencyContext(
  spaceId: string,
  spaceName: string,
  spatialMap: SpatialMap | null
): { adjacentSpaces: string[]; connectionTypes: Map<string, string>; fullContext: string } {
  const adjacentSpaces: string[] = [];
  const connectionTypes = new Map<string, string>();
  
  if (!spatialMap || !spatialMap.adjacency_graph || spatialMap.adjacency_graph.length === 0) {
    return { 
      adjacentSpaces: [], 
      connectionTypes, 
      fullContext: `No adjacency data available for ${spaceName}. Validation skipped.` 
    };
  }
  
  const rooms = spatialMap.rooms || [];
  
  // Find the current room
  let currentRoom = rooms.find(r => getRoomId(r) === spaceId);
  if (!currentRoom) {
    currentRoom = rooms.find(r => 
      getRoomDisplayName(r).toLowerCase().includes(spaceName.toLowerCase()) ||
      spaceName.toLowerCase().includes(getRoomDisplayName(r).toLowerCase())
    );
  }
  
  if (!currentRoom) {
    return { 
      adjacentSpaces: [], 
      connectionTypes, 
      fullContext: `Room "${spaceName}" not found in spatial map.` 
    };
  }
  
  const roomId = getRoomId(currentRoom);
  
  // Find all adjacent rooms
  for (const edge of spatialMap.adjacency_graph) {
    if (edge.from === roomId) {
      const adjRoom = rooms.find(r => getRoomId(r) === edge.to);
      if (adjRoom) {
        const adjName = getRoomDisplayName(adjRoom);
        adjacentSpaces.push(adjName);
        connectionTypes.set(adjName, edge.connection_type);
      }
    } else if (edge.to === roomId) {
      const adjRoom = rooms.find(r => getRoomId(r) === edge.from);
      if (adjRoom) {
        const adjName = getRoomDisplayName(adjRoom);
        adjacentSpaces.push(adjName);
        connectionTypes.set(adjName, edge.connection_type);
      }
    }
  }
  
  const connectionDetails = adjacentSpaces.map(name => 
    `  - ${name} (via ${connectionTypes.get(name) || "unknown"})`
  ).join("\n");
  
  return {
    adjacentSpaces,
    connectionTypes,
    fullContext: `Room "${spaceName}" is adjacent to:\n${connectionDetails || "  (no adjacent spaces found)"}`
  };
}

function buildCameraDirectionContext(
  cameraMarker: CameraMarker | null,
  cameraKind: "A" | "B"
): string {
  if (!cameraMarker) {
    return "No camera marker data available. Camera direction validation skipped.";
  }
  
  // Adjust yaw for Camera B (180° opposite)
  const yawDeg = cameraKind === "B" ? (cameraMarker.yaw_deg + 180) % 360 : cameraMarker.yaw_deg;
  
  // Determine what the camera is pointing at based on yaw
  const directionMap: Record<string, string> = {
    "0-45": "top/north wall region",
    "45-135": "right/east wall region",
    "135-225": "bottom/south wall region",
    "225-315": "left/west wall region",
    "315-360": "top/north wall region",
  };
  
  let facingRegion = "unknown";
  for (const [range, region] of Object.entries(directionMap)) {
    const [min, max] = range.split("-").map(Number);
    if (yawDeg >= min && yawDeg < max) {
      facingRegion = region;
      break;
    }
  }
  
  return `Camera ${cameraKind} specification:
  - Position: (${(cameraMarker.x_norm * 100).toFixed(1)}%, ${(cameraMarker.y_norm * 100).toFixed(1)}%) on floor plan
  - Yaw: ${yawDeg.toFixed(0)}° (facing ${facingRegion})
  - FOV: ${cameraMarker.fov_deg}°
  - The render MUST show what is visible from this exact position facing this direction.`;
}

// ═══════════════════════════════════════════════════════════════════════════
// ARCHITECTURAL QA PROMPTS
// ═══════════════════════════════════════════════════════════════════════════

function buildArchitecturalQAPrompt(
  input: ArchitecturalQAInput,
  adjacencyContext: ReturnType<typeof buildAdjacencyContext>,
  cameraContext: string
): string {
  const stepDescription = input.stepNumber === 5 ? "eye-level render" : 
                          input.stepNumber === 6 ? "360° panorama" : "merged 360° panorama";
  
  const hasFloorPlan = !!input.floorPlanBase64;
  const hasAdjacency = adjacencyContext.adjacentSpaces.length > 0;
  const hasCamera = !!input.cameraMarker;
  
  return `You are a STRICT architectural validation system for interior ${stepDescription}s.

═══════════════════════════════════════════════════════════════
SPACE CONTEXT
═══════════════════════════════════════════════════════════════
Space Name: ${input.spaceName}
Space Type: ${input.spaceType}
Step: ${input.stepNumber} (${stepDescription})
Camera: ${input.cameraKind}

═══════════════════════════════════════════════════════════════
ADJACENCY DATA (from Space Scan)
═══════════════════════════════════════════════════════════════
${adjacencyContext.fullContext}

ADJACENT SPACES ALLOWED:
${adjacencyContext.adjacentSpaces.length > 0 
  ? adjacencyContext.adjacentSpaces.map(s => `  ✓ ${s}`).join("\n")
  : "  (No adjacency data - skip adjacency validation)"}

═══════════════════════════════════════════════════════════════
CAMERA DATA
═══════════════════════════════════════════════════════════════
${cameraContext}

═══════════════════════════════════════════════════════════════
VALIDATION RULES (HARD FAILURES)
═══════════════════════════════════════════════════════════════

1️⃣ ADJACENT SPACE CORRECTNESS ${hasAdjacency ? "(ENABLED)" : "(SKIPPED - no adjacency data)"}
   - If the render shows visible openings (doors, archways, pass-throughs), each opening MUST lead to an ADJACENT SPACE listed above
   - HARD REJECT if: Opening leads to a non-adjacent space (e.g., Living Room shows opening to Bathroom when only Bedroom is adjacent)
   - HARD REJECT if: Hallucinated rooms appear that are not in the adjacency list

2️⃣ WALL VS OPENING CONSISTENCY ${hasFloorPlan ? "(ENABLED)" : "(SKIPPED - no floor plan)"}
   - Compare the floor plan with the rendered output
   - HARD REJECT if: Camera faces a solid wall in floor plan, but render shows an opening
   - HARD REJECT if: Camera faces an opening in floor plan, but render shows a solid wall

3️⃣ CAMERA DIRECTION FIDELITY ${hasCamera ? "(ENABLED)" : "(SKIPPED - no camera data)"}
   - The render MUST match the camera's aim direction
   - If camera aims at a wall: render MUST show a wall-dominant view
   - If camera aims at an opening/corridor: render MUST show that opening
   - HARD REJECT if: Render ignores camera direction

4️⃣ NO CAMERA INTENT OVERRIDE ${hasCamera ? "(ENABLED)" : "(SKIPPED - no camera data)"}
   - The model must NOT replace the requested camera view with a more aesthetic or different angle
   - Accuracy is mandatory, aesthetics are secondary
   - HARD REJECT if: Render shows a different viewing angle than specified by camera
   - HARD REJECT if: Camera B render matches Camera A orientation (B should be opposite)

5️⃣ ROOM TYPE CONSISTENCY (ALWAYS ENABLED)
   - The rendered space MUST match the space type (${input.spaceType})
   - HARD REJECT if: Wrong fixtures visible (e.g., bathroom fixtures in bedroom)
   - HARD REJECT if: Inappropriate furniture for the space type

${input.learningContext || ""}

═══════════════════════════════════════════════════════════════
OUTPUT FORMAT (JSON ONLY)
═══════════════════════════════════════════════════════════════
{
  "pass": true/false,
  "overall_score": 0-100,
  "issues": [
    {
      "rule": "adjacent_space|wall_opening|camera_direction|camera_override|room_mismatch|geometry|other",
      "severity": "critical|major|minor",
      "description": "Explicit structured reason",
      "expected": "What should be there",
      "actual": "What is rendered",
      "location_hint": "Where in the image"
    }
  ],
  "validation_summary": {
    "adjacency_check": "pass|fail|skipped",
    "wall_opening_check": "pass|fail|skipped",
    "camera_direction_check": "pass|fail|skipped",
    "camera_override_check": "pass|fail|skipped"
  },
  "recommended_action": "approve|retry|needs_human",
  "corrected_instructions": "If retry needed, specific fix instructions for next attempt"
}

EXPLICIT REJECT REASON EXAMPLES:
- "Camera aimed at wall, render shows open living area"
- "Opening expected to Bedroom, rendered as Bathroom"
- "Camera B ignored, render matches Camera A orientation"
- "Living Room rendered with toilet visible (wrong room type)"
- "Hallucinated Kitchen visible through doorway, not in adjacency graph"

Analyze the provided image(s) and return ONLY the JSON result.`;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN VALIDATION FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

export async function runArchitecturalQA(
  input: ArchitecturalQAInput
): Promise<ArchitecturalQAResult> {
  // Build context from spatial map and camera
  const adjacencyContext = buildAdjacencyContext(
    input.spaceId,
    input.spaceName,
    input.spatialMap
  );
  
  const cameraContext = buildCameraDirectionContext(
    input.cameraMarker,
    input.cameraKind
  );
  
  // Build the QA prompt
  const prompt = buildArchitecturalQAPrompt(input, adjacencyContext, cameraContext);
  
  // Prepare images for API call
  const imageParts: Array<{ inlineData: { mimeType: string; data: string } }> = [];
  
  // Add floor plan first (if available)
  if (input.floorPlanBase64 && input.floorPlanMimeType) {
    imageParts.push({
      inlineData: {
        mimeType: input.floorPlanMimeType,
        data: input.floorPlanBase64,
      },
    });
  }
  
  // Add the rendered image
  imageParts.push({
    inlineData: {
      mimeType: input.renderedMimeType,
      data: input.renderedImageBase64,
    },
  });
  
  const qaUrl = `${GEMINI_API_BASE}/${QA_MODEL}:generateContent?key=${input.apiKey}`;
  
  try {
    const response = await fetch(qaUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            ...imageParts,
          ],
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 2000,
        },
      }),
    });
    
    if (!response.ok) {
      const error = await response.text();
      console.error(`[architectural-qa] API error: ${error}`);
      return createFallbackResult("QA API error", "needs_human");
    }
    
    const data = await response.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    
    // Parse JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      
      // Determine pass/fail based on critical issues
      const hasCriticalIssues = (parsed.issues || []).some(
        (i: ArchitecturalQAIssue) => i.severity === "critical"
      );
      
      const overallScore = parsed.overall_score || 0;
      const passes = !hasCriticalIssues && overallScore >= 70;
      
      return {
        pass: passes,
        overall_score: overallScore,
        issues: parsed.issues || [],
        recommended_action: parsed.recommended_action || (passes ? "approve" : "retry"),
        corrected_instructions: parsed.corrected_instructions,
        validation_summary: parsed.validation_summary || {
          adjacency_check: "skipped",
          wall_opening_check: "skipped",
          camera_direction_check: "skipped",
          camera_override_check: "skipped",
        },
      };
    }
    
    console.error(`[architectural-qa] Failed to parse response: ${content.slice(0, 200)}`);
    return createFallbackResult("Failed to parse QA response", "needs_human");
    
  } catch (e) {
    console.error(`[architectural-qa] Error: ${e}`);
    return createFallbackResult(`QA error: ${e instanceof Error ? e.message : "Unknown"}`, "needs_human");
  }
}

function createFallbackResult(reason: string, action: "approve" | "retry" | "needs_human"): ArchitecturalQAResult {
  return {
    pass: false,
    overall_score: 0,
    issues: [{
      rule: "other",
      severity: "critical",
      description: reason,
    }],
    recommended_action: action,
    validation_summary: {
      adjacency_check: "skipped",
      wall_opening_check: "skipped",
      camera_direction_check: "skipped",
      camera_override_check: "skipped",
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITY: Format issues for display
// ═══════════════════════════════════════════════════════════════════════════

export function formatArchitecturalQAIssues(result: ArchitecturalQAResult): string {
  if (result.issues.length === 0) {
    return "All architectural checks passed.";
  }
  
  return result.issues.map(issue => {
    const parts = [`[${issue.severity.toUpperCase()}] ${issue.rule}: ${issue.description}`];
    if (issue.expected && issue.actual) {
      parts.push(`  Expected: ${issue.expected}`);
      parts.push(`  Actual: ${issue.actual}`);
    }
    if (issue.location_hint) {
      parts.push(`  Location: ${issue.location_hint}`);
    }
    return parts.join("\n");
  }).join("\n\n");
}
