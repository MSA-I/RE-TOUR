/**
 * LOGICAL QA SCHEMA
 * 
 * Validates Step 3+ outputs against SpaceGraph architectural logic.
 * Checks room-type adherence, adjacency constraints, and furniture locks.
 */

// ============================================================================
// LOGICAL QA OUTPUT SCHEMA
// ============================================================================

export interface LogicalQAReason {
  code: LogicalQAReasonCode;
  description: string;
  evidence?: string;
  severity: "critical" | "major" | "minor";
}

export interface LogicalQARequiredChange {
  type: "prompt_delta" | "constraint_update" | "seed_change" | "camera_adjust";
  instruction: string;
  priority: number;
}

export interface LogicalQAResult {
  status: "approved" | "reject";
  reasons: LogicalQAReason[];
  required_changes: LogicalQARequiredChange[];
  confidence: number;
  
  // Specific check results
  room_type_check: {
    passed: boolean;
    expected_type: string;
    detected_type: string | null;
    mismatch_evidence?: string;
  };
  
  adjacency_check: {
    passed: boolean;
    expected_adjacent_rooms: string[];
    detected_connections?: string[];
    hallucinated_connections?: string[];
  };
  
  locks_check: {
    passed: boolean;
    must_include_violations: string[];
    must_not_include_violations: string[];
  };
  
  // Metadata
  attempt_number: number;
  max_attempts: number;
  model_used?: string;
  processing_time_ms?: number;
}

export type LogicalQAReasonCode = 
  | "ROOM_TYPE_MISMATCH"
  | "HALLUCINATED_ADJACENCY"
  | "MISSING_REQUIRED_ELEMENT"
  | "FORBIDDEN_ELEMENT_PRESENT"
  | "SCALE_VIOLATION"
  | "GEOMETRY_MISMATCH"
  | "CAMERA_ANGLE_DEVIATION"
  | "VISIBILITY_VIOLATION"
  | "UNKNOWN";

// ============================================================================
// INPUT TYPES
// ============================================================================

export interface CameraSpecInput {
  id: string;
  label: string;
  x_norm: number;
  y_norm: number;
  yaw_deg: number;
  fov_deg: number;
  room_id: string | null;
}

export interface SpaceGraphRoom {
  id: string;
  type: "room" | "zone";
  name: string;
  label?: string;
  center?: { x: number; y: number };
  confidence: number;
}

export interface SpaceGraphEdge {
  from: string;
  to: string;
  connection_type: "door" | "opening" | "archway" | "pass_through" | "unknown";
  confidence?: number;
}

export interface SpaceGraphLock {
  room_id: string;
  must_include?: string[];
  must_not_include?: string[];
  scale_notes?: string;
}

export interface LogicalQAInput {
  upload_id: string;
  camera_spec: CameraSpecInput;
  space_graph: {
    rooms: SpaceGraphRoom[];
    edges: SpaceGraphEdge[];
    locks: SpaceGraphLock[];
  };
  space_type: string;
  space_name: string;
  current_attempt: number;
  max_attempts: number;
  step3_output_upload_id?: string;
}

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

export function validateLogicalQAResult(result: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!result || typeof result !== "object") {
    errors.push("Result must be an object");
    return { valid: false, errors };
  }
  
  const r = result as Record<string, unknown>;
  
  // Required status field
  if (!r.status || (r.status !== "approved" && r.status !== "reject")) {
    errors.push("status must be 'approved' or 'reject'");
  }
  
  // Required arrays
  if (!Array.isArray(r.reasons)) {
    errors.push("reasons must be an array");
  }
  if (!Array.isArray(r.required_changes)) {
    errors.push("required_changes must be an array");
  }
  
  // Confidence score
  if (typeof r.confidence !== "number" || r.confidence < 0 || r.confidence > 1) {
    errors.push("confidence must be a number between 0 and 1");
  }
  
  // Check objects
  if (!r.room_type_check || typeof r.room_type_check !== "object") {
    errors.push("room_type_check must be an object");
  }
  if (!r.adjacency_check || typeof r.adjacency_check !== "object") {
    errors.push("adjacency_check must be an object");
  }
  if (!r.locks_check || typeof r.locks_check !== "object") {
    errors.push("locks_check must be an object");
  }
  
  return { valid: errors.length === 0, errors };
}

/**
 * Create a default APPROVED result
 */
export function createApprovedResult(
  input: LogicalQAInput,
  confidence: number = 0.95
): LogicalQAResult {
  return {
    status: "approved",
    reasons: [],
    required_changes: [],
    confidence,
    room_type_check: {
      passed: true,
      expected_type: input.space_type,
      detected_type: input.space_type,
    },
    adjacency_check: {
      passed: true,
      expected_adjacent_rooms: getAdjacentRooms(input.camera_spec.room_id, input.space_graph.edges, input.space_graph.rooms),
      detected_connections: [],
      hallucinated_connections: [],
    },
    locks_check: {
      passed: true,
      must_include_violations: [],
      must_not_include_violations: [],
    },
    attempt_number: input.current_attempt,
    max_attempts: input.max_attempts,
  };
}

/**
 * Create a REJECT result with specified reasons
 */
export function createRejectResult(
  input: LogicalQAInput,
  reasons: LogicalQAReason[],
  roomTypeCheck: LogicalQAResult["room_type_check"],
  adjacencyCheck: LogicalQAResult["adjacency_check"],
  locksCheck: LogicalQAResult["locks_check"],
  confidence: number = 0.85
): LogicalQAResult {
  // Build required changes from reasons
  const requiredChanges: LogicalQARequiredChange[] = [];
  
  for (const reason of reasons) {
    let changeType: LogicalQARequiredChange["type"] = "prompt_delta";
    let instruction = "";
    
    switch (reason.code) {
      case "ROOM_TYPE_MISMATCH":
        changeType = "prompt_delta";
        instruction = `Generate a ${roomTypeCheck.expected_type}, NOT a ${roomTypeCheck.detected_type}. Remove all ${roomTypeCheck.detected_type} fixtures.`;
        break;
      case "HALLUCINATED_ADJACENCY":
        changeType = "prompt_delta";
        instruction = `Do NOT show doorways to non-adjacent rooms. Only show connections to: ${adjacencyCheck.expected_adjacent_rooms.join(", ")}`;
        break;
      case "MISSING_REQUIRED_ELEMENT":
        changeType = "constraint_update";
        instruction = `MUST include: ${locksCheck.must_include_violations.join(", ")}`;
        break;
      case "FORBIDDEN_ELEMENT_PRESENT":
        changeType = "constraint_update";
        instruction = `MUST NOT include: ${locksCheck.must_not_include_violations.join(", ")}`;
        break;
      case "CAMERA_ANGLE_DEVIATION":
        changeType = "camera_adjust";
        instruction = `Adjust camera to match specified yaw: ${input.camera_spec.yaw_deg}°`;
        break;
      default:
        changeType = "seed_change";
        instruction = reason.description;
    }
    
    requiredChanges.push({
      type: changeType,
      instruction,
      priority: reason.severity === "critical" ? 1 : reason.severity === "major" ? 2 : 3,
    });
  }
  
  return {
    status: "reject",
    reasons,
    required_changes: requiredChanges,
    confidence,
    room_type_check: roomTypeCheck,
    adjacency_check: adjacencyCheck,
    locks_check: locksCheck,
    attempt_number: input.current_attempt,
    max_attempts: input.max_attempts,
  };
}

/**
 * Get adjacent room names from edges
 */
export function getAdjacentRooms(
  roomId: string | null,
  edges: SpaceGraphEdge[],
  rooms: SpaceGraphRoom[]
): string[] {
  if (!roomId) return [];
  
  const adjacentIds = new Set<string>();
  
  for (const edge of edges) {
    if (edge.from === roomId) {
      adjacentIds.add(edge.to);
    } else if (edge.to === roomId) {
      adjacentIds.add(edge.from);
    }
  }
  
  // Map IDs to names
  return Array.from(adjacentIds).map(id => {
    const room = rooms.find(r => r.id === id);
    return room?.label || room?.name || id;
  });
}

/**
 * Get locks for a specific room
 */
export function getRoomLocks(
  roomId: string | null,
  locks: SpaceGraphLock[]
): SpaceGraphLock | null {
  if (!roomId) return null;
  return locks.find(l => l.room_id === roomId) || null;
}

// ============================================================================
// PROMPT BUILDER
// ============================================================================

export function buildLogicalQAPrompt(input: LogicalQAInput): string {
  const adjacentRooms = getAdjacentRooms(input.camera_spec.room_id, input.space_graph.edges, input.space_graph.rooms);
  const roomLocks = getRoomLocks(input.camera_spec.room_id, input.space_graph.locks);
  
  return `You are a LOGICAL CONSISTENCY validator for architectural visualizations.

TASK: Validate that the generated image correctly represents the declared room and respects the architectural graph.

═══════════════════════════════════════════════════════════════════════════════
SPACE CONTEXT
═══════════════════════════════════════════════════════════════════════════════
- Space Name: ${input.space_name}
- Space Type: ${input.space_type}
- Camera Label: ${input.camera_spec.label}
- Camera Position: (${input.camera_spec.x_norm.toFixed(2)}, ${input.camera_spec.y_norm.toFixed(2)})
- Camera Direction: ${input.camera_spec.yaw_deg}° yaw
- Field of View: ${input.camera_spec.fov_deg}°
- Attempt: ${input.current_attempt}/${input.max_attempts}

═══════════════════════════════════════════════════════════════════════════════
ADJACENCY GRAPH (CRITICAL)
═══════════════════════════════════════════════════════════════════════════════
This room is ONLY adjacent to: ${adjacentRooms.length > 0 ? adjacentRooms.join(", ") : "No other rooms (isolated)"}

If ANY doorway, opening, or visible connection is shown, it MUST connect to one of the above rooms ONLY.
If a doorway implies a connection to a room NOT in this list, that is a HALLUCINATED ADJACENCY.

═══════════════════════════════════════════════════════════════════════════════
FURNITURE LOCKS (CONSTRAINTS)
═══════════════════════════════════════════════════════════════════════════════
${roomLocks ? `
MUST INCLUDE (at least one visible): ${roomLocks.must_include?.join(", ") || "None specified"}
MUST NOT INCLUDE: ${roomLocks.must_not_include?.join(", ") || "None specified"}
SCALE NOTES: ${roomLocks.scale_notes || "None"}
` : "No specific furniture constraints for this room."}

═══════════════════════════════════════════════════════════════════════════════
VALIDATION CHECKS (PERFORM ALL)
═══════════════════════════════════════════════════════════════════════════════

CHECK 1: ROOM TYPE CONSISTENCY
- Does the image show a ${input.space_type}?
- Are the fixtures appropriate for this room type?
- CRITICAL: Bathroom fixtures (toilet, shower, bathtub, sink) MUST NOT appear in non-bathroom rooms

CHECK 2: ADJACENCY VALIDATION
- Look for doorways, openings, archways, or pass-throughs
- If visible, do they imply connection to rooms in the adjacency list?
- Flag any doorway that suggests a connection to an unlisted room

CHECK 3: LOCK COMPLIANCE
- Check if must_include items are present
- Check if must_not_include items are absent
- Verify furniture scale matches scale_notes

═══════════════════════════════════════════════════════════════════════════════
OUTPUT FORMAT (STRICT JSON ONLY)
═══════════════════════════════════════════════════════════════════════════════

Return ONLY a JSON object:
{
  "status": "approved" | "reject",
  "reasons": [
    {
      "code": "ROOM_TYPE_MISMATCH" | "HALLUCINATED_ADJACENCY" | "MISSING_REQUIRED_ELEMENT" | "FORBIDDEN_ELEMENT_PRESENT" | "SCALE_VIOLATION" | "GEOMETRY_MISMATCH" | "CAMERA_ANGLE_DEVIATION" | "VISIBILITY_VIOLATION" | "UNKNOWN",
      "description": "Clear explanation of the issue",
      "evidence": "What in the image shows this",
      "severity": "critical" | "major" | "minor"
    }
  ],
  "required_changes": [
    {
      "type": "prompt_delta" | "constraint_update" | "seed_change" | "camera_adjust",
      "instruction": "Specific instruction for retry",
      "priority": 1-3
    }
  ],
  "confidence": 0.0-1.0,
  "room_type_check": {
    "passed": true/false,
    "expected_type": "${input.space_type}",
    "detected_type": "what type the image actually shows",
    "mismatch_evidence": "if failed, describe what's wrong"
  },
  "adjacency_check": {
    "passed": true/false,
    "expected_adjacent_rooms": ${JSON.stringify(adjacentRooms)},
    "detected_connections": ["rooms visible through doorways"],
    "hallucinated_connections": ["rooms shown but not in adjacency list"]
  },
  "locks_check": {
    "passed": true/false,
    "must_include_violations": ["items that should be present but aren't"],
    "must_not_include_violations": ["items that shouldn't be present but are"]
  }
}

CRITICAL RULES:
1. If room_type_check.passed = false with bathroom fixtures in non-bathroom → status = "reject"
2. If hallucinated_connections has any entries → status = "reject" with severity = "major"
3. If must_not_include_violations has entries → status = "reject" with severity = "critical"
4. Only return "approved" if ALL checks pass`;
}
