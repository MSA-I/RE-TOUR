/**
 * Camera Context Builder - Builds prompt context from CameraSpec + SpaceGraph
 * Used by run-space-render to compose architecture-aware prompts
 */

// Types matching the database schema
export interface CameraMarker {
  id: string;
  pipeline_id: string;
  label: string;
  x_norm: number;
  y_norm: number;
  yaw_deg: number;
  fov_deg: number;
  room_id: string | null;
}

export interface DetectedRoom {
  id?: string;
  room_id?: string;
  type: "room" | "zone" | string;
  name: string;
  label?: string;
  center?: { x: number; y: number };
  bounds?: { x: number; y: number; width: number; height: number };
  confidence: number;
}

export interface RoomAdjacency {
  from: string;
  to: string;
  connection_type: "door" | "opening" | "archway" | "pass_through" | "unknown";
  confidence?: number;
}

export interface RoomLock {
  room_id: string;
  must_include?: string[];
  must_not_include?: string[];
  scale_notes?: string;
}

export interface VisibilityHint {
  room_id: string;
  hints: string[];
}

export interface SpatialMap {
  id: string;
  pipeline_id: string;
  version: number;
  rooms: DetectedRoom[];
  adjacency_graph: RoomAdjacency[];
  locks_json: {
    furniture_locks?: RoomLock[];
    visibility_hints?: VisibilityHint[];
    scale_locked?: boolean;
    geometry_locked?: boolean;
  };
}

export interface CameraContextResult {
  cameraDirectionPrompt: string;
  adjacencyConstraints: string;
  lockConstraints: string;
  visibilityHints: string;
  fullContextBlock: string;
  adjacencyJson: object;
}

// Helper to get room ID (handles both formats)
function getRoomId(room: DetectedRoom): string {
  return room.id || room.room_id || "unknown";
}

// Helper to get room display name
function getRoomDisplayName(room: DetectedRoom): string {
  return room.label || room.name?.replace(/_/g, " ") || "Unknown Room";
}

// Find the closest room to a camera position
function findNearestRoom(
  xNorm: number, 
  yNorm: number, 
  rooms: DetectedRoom[]
): DetectedRoom | null {
  if (rooms.length === 0) return null;
  
  let closest: DetectedRoom | null = null;
  let minDistance = Infinity;
  
  for (const room of rooms) {
    if (!room.center) continue;
    const dx = xNorm - room.center.x;
    const dy = yNorm - room.center.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance < minDistance) {
      minDistance = distance;
      closest = room;
    }
  }
  
  return closest;
}

// Convert yaw degrees to human-readable direction
function yawToDirection(yawDeg: number): string {
  const normalizedYaw = ((yawDeg % 360) + 360) % 360;
  
  if (normalizedYaw >= 337.5 || normalizedYaw < 22.5) return "facing north (forward/up)";
  if (normalizedYaw >= 22.5 && normalizedYaw < 67.5) return "facing northeast";
  if (normalizedYaw >= 67.5 && normalizedYaw < 112.5) return "facing east (right)";
  if (normalizedYaw >= 112.5 && normalizedYaw < 157.5) return "facing southeast";
  if (normalizedYaw >= 157.5 && normalizedYaw < 202.5) return "facing south (backward/down)";
  if (normalizedYaw >= 202.5 && normalizedYaw < 247.5) return "facing southwest";
  if (normalizedYaw >= 247.5 && normalizedYaw < 292.5) return "facing west (left)";
  return "facing northwest";
}

// Convert FOV to description
function fovToDescription(fovDeg: number): string {
  if (fovDeg <= 40) return "telephoto (narrow, compressed perspective)";
  if (fovDeg <= 60) return "normal (natural human perspective)";
  if (fovDeg <= 90) return "wide-angle (captures more of the room)";
  return "ultra-wide (panoramic, slight distortion acceptable)";
}

/**
 * Build camera context for prompt composition
 */
export function buildCameraContext(
  cameraMarker: CameraMarker | null,
  spatialMap: SpatialMap | null,
  spaceId: string | null,
  spaceName: string,
  spaceType: string
): CameraContextResult {
  const rooms = spatialMap?.rooms || [];
  const edges = spatialMap?.adjacency_graph || [];
  const locks = spatialMap?.locks_json || {};
  
  // Find the room this camera is in
  let targetRoom: DetectedRoom | null = null;
  
  if (cameraMarker?.room_id && rooms.length > 0) {
    targetRoom = rooms.find(r => getRoomId(r) === cameraMarker.room_id) || null;
  }
  
  if (!targetRoom && cameraMarker && rooms.length > 0) {
    targetRoom = findNearestRoom(cameraMarker.x_norm, cameraMarker.y_norm, rooms);
  }
  
  // Fallback to matching by space name
  if (!targetRoom && rooms.length > 0) {
    targetRoom = rooms.find(r => 
      getRoomDisplayName(r).toLowerCase().includes(spaceName.toLowerCase()) ||
      spaceName.toLowerCase().includes(getRoomDisplayName(r).toLowerCase())
    ) || null;
  }
  
  // Build camera direction prompt
  // FIXED GLOBAL VALUES (non-negotiable per spec):
  // - Camera height: 1.60 meters
  // - View type: EYE LEVEL
  const CAMERA_HEIGHT_M = 1.60;
  
  let cameraDirectionPrompt = "";
  if (cameraMarker) {
    const direction = yawToDirection(cameraMarker.yaw_deg);
    const fovDesc = fovToDescription(cameraMarker.fov_deg);
    const positionDesc = `positioned at (${(cameraMarker.x_norm * 100).toFixed(0)}%, ${(cameraMarker.y_norm * 100).toFixed(0)}%) of the floor plan`;
    
    cameraDirectionPrompt = `CAMERA SPECIFICATION (from Camera Planning):
- Label: "${cameraMarker.label}"
- Position: ${positionDesc}
- Direction: ${direction} (yaw: ${cameraMarker.yaw_deg.toFixed(1)}°)
- Field of View: ${cameraMarker.fov_deg}° - ${fovDesc}
- Height: EXACTLY ${CAMERA_HEIGHT_M}m (eye-level, FIXED)
- View Type: EYE LEVEL (human standing perspective)

CRITICAL: Generate the view from THIS EXACT camera position, direction, and height.
Do NOT place camera at floor level or overhead - maintain ${CAMERA_HEIGHT_M}m eye-level.`;
  } else {
    cameraDirectionPrompt = `CAMERA SPECIFICATION (default):
- Position: Central view of ${spaceName}
- Direction: Looking into the main area
- Field of View: Normal (50-60°)
- Height: EXACTLY ${CAMERA_HEIGHT_M}m (eye-level, FIXED)
- View Type: EYE LEVEL (human standing perspective)`;
  }
  
  // Build adjacency constraints
  let adjacencyConstraints = "";
  const adjacentRooms: string[] = [];
  const adjacencyJson: { room: string; adjacent_to: string[]; connection_types: string[] } = {
    room: spaceName,
    adjacent_to: [],
    connection_types: []
  };
  
  if (targetRoom && edges.length > 0) {
    const roomId = getRoomId(targetRoom);
    
    // Find all edges involving this room
    for (const edge of edges) {
      if (edge.from === roomId) {
        const adjRoom = rooms.find(r => getRoomId(r) === edge.to);
        if (adjRoom) {
          const adjName = getRoomDisplayName(adjRoom);
          adjacentRooms.push(`${adjName} (via ${edge.connection_type})`);
          adjacencyJson.adjacent_to.push(adjName);
          adjacencyJson.connection_types.push(edge.connection_type);
        }
      } else if (edge.to === roomId) {
        const adjRoom = rooms.find(r => getRoomId(r) === edge.from);
        if (adjRoom) {
          const adjName = getRoomDisplayName(adjRoom);
          adjacentRooms.push(`${adjName} (via ${edge.connection_type})`);
          adjacencyJson.adjacent_to.push(adjName);
          adjacencyJson.connection_types.push(edge.connection_type);
        }
      }
    }
  }
  
  if (adjacentRooms.length > 0) {
    adjacencyConstraints = `ARCHITECTURAL ADJACENCY (STRICT):
This room (${spaceName}) is connected to:
${adjacentRooms.map(r => `  - ${r}`).join("\n")}

CRITICAL CONSTRAINTS:
- Do NOT invent new rooms beyond those listed above
- If a doorway/opening is visible, it MUST connect to one of: ${adjacencyJson.adjacent_to.join(", ")}
- Maintain consistent layout with the floor plan and adjacency graph
- Hallways/corridors should only reveal glimpses of adjacent spaces`;
  } else {
    adjacencyConstraints = `ARCHITECTURAL CONSTRAINTS:
- Generate ONLY what would be visible from inside ${spaceName}
- Do NOT add doorways to unlisted rooms
- Any visible openings should show appropriate adjacent spaces`;
  }
  
  // Build lock constraints (furniture/scale)
  let lockConstraints = "";
  if (targetRoom && locks.furniture_locks) {
    const roomId = getRoomId(targetRoom);
    const roomLock = locks.furniture_locks.find(l => l.room_id === roomId);
    
    if (roomLock) {
      const parts: string[] = [];
      
      if (roomLock.must_include && roomLock.must_include.length > 0) {
        parts.push(`MUST include: ${roomLock.must_include.join(", ")}`);
      }
      if (roomLock.must_not_include && roomLock.must_not_include.length > 0) {
        parts.push(`MUST NOT include: ${roomLock.must_not_include.join(", ")}`);
      }
      if (roomLock.scale_notes) {
        parts.push(`Scale: ${roomLock.scale_notes}`);
      }
      
      if (parts.length > 0) {
        lockConstraints = `FURNITURE CONSTRAINTS FOR ${spaceName.toUpperCase()}:
${parts.join("\n")}`;
      }
    }
  }
  
  // If no specific locks, add generic room-type constraints
  if (!lockConstraints) {
    lockConstraints = buildGenericLockConstraints(spaceType);
  }
  
  // Build visibility hints
  let visibilityHints = "";
  if (targetRoom && locks.visibility_hints) {
    const roomId = getRoomId(targetRoom);
    const hint = locks.visibility_hints.find(h => h.room_id === roomId);
    
    if (hint && hint.hints.length > 0) {
      visibilityHints = `VISIBILITY NOTES:
${hint.hints.map(h => `  - ${h}`).join("\n")}`;
    }
  }
  
  // Combine all context
  const fullContextBlock = `
═══════════════════════════════════════════════════════════════
CAMERA + ARCHITECTURAL CONTEXT
═══════════════════════════════════════════════════════════════

${cameraDirectionPrompt}

${adjacencyConstraints}

${lockConstraints}
${visibilityHints ? "\n" + visibilityHints : ""}

═══════════════════════════════════════════════════════════════
`;

  return {
    cameraDirectionPrompt,
    adjacencyConstraints,
    lockConstraints,
    visibilityHints,
    fullContextBlock,
    adjacencyJson
  };
}

// Generic lock constraints based on room type
function buildGenericLockConstraints(spaceType: string): string {
  const normalized = spaceType.toLowerCase();
  
  if (normalized.includes("bedroom") || normalized.includes("master")) {
    return `FURNITURE CONSTRAINTS (BEDROOM):
- MUST include: bed, possibly nightstands
- MUST NOT include: toilet, shower, bathtub, kitchen appliances
- Scale: Bed should be proportional to room size`;
  }
  
  if (normalized.includes("bathroom") || normalized.includes("wc") || normalized.includes("toilet")) {
    return `FURNITURE CONSTRAINTS (BATHROOM):
- MUST include: at least one of toilet, shower, sink
- MUST NOT include: bed, kitchen appliances, dining table`;
  }
  
  if (normalized.includes("kitchen")) {
    return `FURNITURE CONSTRAINTS (KITCHEN):
- MUST include: counter space, cabinets, sink
- MUST NOT include: bed, toilet, shower`;
  }
  
  if (normalized.includes("living") || normalized.includes("lounge")) {
    return `FURNITURE CONSTRAINTS (LIVING ROOM):
- MUST include: seating area (sofa/chairs)
- MUST NOT include: bed, toilet, shower, kitchen appliances`;
  }
  
  return `FURNITURE CONSTRAINTS:
- Appropriate furniture for a ${spaceType}
- MUST NOT include bathroom fixtures unless this is a bathroom`;
}
