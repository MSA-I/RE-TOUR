import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  parseJsonFromLLM,
  buildParseDebugInfo,
} from "../_shared/json-parsing.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Enhanced prompt for structured architectural graph
const SPATIAL_DECOMPOSITION_PROMPT = `You are an expert architectural analyst. Analyze this 2D floor plan image and produce a structured architectural logic graph.

OUTPUT REQUIREMENTS:
You MUST respond with ONLY valid JSON. No markdown, no explanation, no code blocks. Just raw JSON.

SCHEMA (follow EXACTLY):
{
  "rooms": [
    {
      "id": "room_1",
      "type": "room",
      "name": "living_room",
      "label": "Living Room",
      "center": { "x": 0.3, "y": 0.4 },
      "bounds": { "x": 10, "y": 20, "width": 40, "height": 35 },
      "area_sqm": 25,
      "confidence": 0.95,
      "suggested_cameras": 4
    }
  ],
  "edges": [
    {
      "from": "room_1",
      "to": "room_2",
      "connection_type": "door",
      "confidence": 0.9
    }
  ],
  "locks": [
    {
      "room_id": "room_1",
      "must_include": ["sofa", "coffee_table"],
      "must_not_include": ["bed"],
      "scale_notes": "Standard living room proportions"
    }
  ],
  "visibility_hints": [
    {
      "room_id": "room_1",
      "hints": ["Open plan with kitchen visibility", "Large windows on east wall"]
    }
  ],
  "total_area_sqm": 120,
  "floor_count": 1
}

FIELD DEFINITIONS:

rooms[]:
- id: unique identifier (room_1, room_2, etc.)
- type: "room" for habitable spaces, "zone" for corridors/storage/utility
- name: semantic name (living_room, bedroom, kitchen, bathroom, hallway, dining_room, office, closet, laundry, garage, balcony, entrance, storage, corridor, pantry, utility)
- label: human-readable label if visible on plan
- center: normalized position (0-1) relative to image
- bounds: percentage of plan (x, y, width, height from 0-100)
- area_sqm: estimated area in square meters
- confidence: detection confidence 0-1
- suggested_cameras: recommended camera angles (2-6)

edges[]:
- from/to: room IDs that are adjacent
- connection_type: "door" | "opening" | "archway" | "pass_through" | "unknown"
- confidence: 0-1

locks[]:
- room_id: which room this applies to
- must_include: furniture/elements that MUST appear based on room type
- must_not_include: elements that should NOT appear
- scale_notes: constraints about proportions/scale

visibility_hints[]:
- room_id: which room this applies to
- hints: visual context notes for rendering (e.g., "visible from hallway", "window wall")

ANALYZE THE IMAGE AND RESPOND WITH JSON ONLY.`;

// Simple schema validation
interface Room {
  id: string;
  type: "room" | "zone";
  name: string;
  label?: string;
  center?: { x: number; y: number };
  bounds?: { x: number; y: number; width: number; height: number };
  area_sqm?: number;
  confidence: number;
  suggested_cameras?: number;
}

interface Edge {
  from: string;
  to: string;
  connection_type: "door" | "opening" | "archway" | "pass_through" | "unknown";
  confidence?: number;
}

interface Lock {
  room_id: string;
  must_include?: string[];
  must_not_include?: string[];
  scale_notes?: string;
}

interface VisibilityHint {
  room_id: string;
  hints: string[];
}

interface SpatialAnalysisResult {
  rooms: Room[];
  edges: Edge[];
  locks: Lock[];
  visibility_hints: VisibilityHint[];
  total_area_sqm?: number;
  floor_count?: number;
}

function validateAndNormalize(raw: unknown): SpatialAnalysisResult {
  const data = raw as Record<string, unknown>;
  
  // Extract rooms - handle both 'rooms' and legacy 'adjacency' format
  let rooms: Room[] = [];
  if (Array.isArray(data.rooms)) {
    rooms = data.rooms.map((r: Record<string, unknown>, idx: number) => ({
      id: String(r.id || r.room_id || `room_${idx + 1}`),
      type: (r.type === "zone" ? "zone" : "room") as "room" | "zone",
      name: String(r.name || r.type || "unknown"),
      label: r.label ? String(r.label) : undefined,
      center: r.center as { x: number; y: number } | undefined,
      bounds: r.bounds as { x: number; y: number; width: number; height: number } | undefined,
      area_sqm: typeof r.area_sqm === "number" ? r.area_sqm : undefined,
      confidence: typeof r.confidence === "number" ? r.confidence : 0.8,
      suggested_cameras: typeof r.suggested_cameras === "number" ? r.suggested_cameras : 3,
    }));
  }

  // Extract edges - handle both 'edges' and legacy 'adjacency' format
  let edges: Edge[] = [];
  const edgeSource = data.edges || data.adjacency;
  if (Array.isArray(edgeSource)) {
    edges = edgeSource.map((e: Record<string, unknown>) => ({
      from: String(e.from),
      to: String(e.to),
      connection_type: validateConnectionType(e.connection_type),
      confidence: typeof e.confidence === "number" ? e.confidence : 0.8,
    }));
  }

  // Extract locks
  let locks: Lock[] = [];
  if (Array.isArray(data.locks)) {
    locks = data.locks.map((l: Record<string, unknown>) => ({
      room_id: String(l.room_id),
      must_include: Array.isArray(l.must_include) ? l.must_include.map(String) : [],
      must_not_include: Array.isArray(l.must_not_include) ? l.must_not_include.map(String) : [],
      scale_notes: l.scale_notes ? String(l.scale_notes) : undefined,
    }));
  }

  // Extract visibility hints
  let visibility_hints: VisibilityHint[] = [];
  if (Array.isArray(data.visibility_hints)) {
    visibility_hints = data.visibility_hints.map((v: Record<string, unknown>) => ({
      room_id: String(v.room_id),
      hints: Array.isArray(v.hints) ? v.hints.map(String) : [],
    }));
  }

  // Auto-generate locks for rooms that don't have them
  const roomsWithLocks = new Set(locks.map(l => l.room_id));
  for (const room of rooms) {
    if (!roomsWithLocks.has(room.id)) {
      locks.push(generateDefaultLock(room));
    }
  }

  return {
    rooms,
    edges,
    locks,
    visibility_hints,
    total_area_sqm: typeof data.total_area_sqm === "number" ? data.total_area_sqm : undefined,
    floor_count: typeof data.floor_count === "number" ? data.floor_count : 1,
  };
}

function validateConnectionType(val: unknown): Edge["connection_type"] {
  const valid = ["door", "opening", "archway", "pass_through", "unknown"];
  const str = String(val || "").toLowerCase().replace(/[_-]/g, "_");
  if (str === "open_doorway") return "opening";
  return valid.includes(str) ? str as Edge["connection_type"] : "unknown";
}

function generateDefaultLock(room: Room): Lock {
  const defaults: Record<string, { must_include: string[]; must_not_include: string[] }> = {
    living_room: { must_include: ["sofa", "seating"], must_not_include: ["bed", "toilet"] },
    bedroom: { must_include: ["bed"], must_not_include: ["toilet", "stove", "refrigerator"] },
    kitchen: { must_include: ["counter", "cabinets"], must_not_include: ["bed", "toilet"] },
    bathroom: { must_include: ["toilet", "sink"], must_not_include: ["bed", "sofa", "stove"] },
    dining_room: { must_include: ["dining_table"], must_not_include: ["bed", "toilet"] },
    office: { must_include: ["desk"], must_not_include: ["bed", "toilet", "stove"] },
    hallway: { must_include: [], must_not_include: ["bed", "stove", "toilet"] },
    corridor: { must_include: [], must_not_include: ["bed", "stove", "toilet"] },
    entrance: { must_include: [], must_not_include: ["bed", "stove"] },
  };

  const preset = defaults[room.name] || { must_include: [], must_not_include: [] };
  return {
    room_id: room.id,
    must_include: preset.must_include,
    must_not_include: preset.must_not_include,
    scale_notes: `Standard ${room.name.replace(/_/g, " ")} proportions`,
  };
}

// deno-lint-ignore no-explicit-any
async function emitEvent(
  supabase: any,
  pipelineId: string,
  ownerId: string,
  stepNumber: number,
  type: string,
  message: string,
  progress: number
) {
  await supabase.from("floorplan_pipeline_events").insert({
    pipeline_id: pipelineId,
    owner_id: ownerId,
    step_number: stepNumber,
    type,
    message,
    progress_int: progress,
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const geminiApiKey = Deno.env.get("API_NANOBANANA");

    if (!geminiApiKey) {
      return new Response(JSON.stringify({ error: "Gemini API key not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
    const MODEL = "gemini-2.5-pro";

    const supabase = createClient(supabaseUrl, supabaseKey);
    const { pipeline_id, floor_plan_upload_id } = await req.json();

    if (!pipeline_id || !floor_plan_upload_id) {
      return new Response(JSON.stringify({ error: "pipeline_id and floor_plan_upload_id are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: pipeline, error: pipelineError } = await supabase
      .from("floorplan_pipelines")
      .select("*")
      .eq("id", pipeline_id)
      .eq("owner_id", user.id)
      .single();

    if (pipelineError || !pipeline) {
      return new Response(JSON.stringify({ error: "Pipeline not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase
      .from("floorplan_pipelines")
      .update({ 
        status: "spatial_decomposition_running",
        global_phase: "spatial_decomposition",
        architecture_version: "v2_branching"
      })
      .eq("id", pipeline_id);

    await emitEvent(supabase, pipeline_id, user.id, 0, "info", "Starting architectural graph analysis...", 10);

    const { data: upload, error: uploadError } = await supabase
      .from("uploads")
      .select("*")
      .eq("id", floor_plan_upload_id)
      .eq("owner_id", user.id)
      .single();

    if (uploadError || !upload) {
      await emitEvent(supabase, pipeline_id, user.id, 0, "error", "Floor plan not found", 0);
      throw new Error("Floor plan upload not found");
    }

    const { data: signedData, error: signedError } = await supabase.storage
      .from(upload.bucket)
      .createSignedUrl(upload.path, 3600);

    if (signedError || !signedData?.signedUrl) {
      await emitEvent(supabase, pipeline_id, user.id, 0, "error", "Failed to access floor plan image", 0);
      throw new Error("Failed to get signed URL for floor plan");
    }

    await emitEvent(supabase, pipeline_id, user.id, 0, "info", "Analyzing spatial structure and adjacency...", 30);

    console.log("Calling Gemini for enhanced spatial decomposition...");
    
    // Fetch the image and convert to base64
    const imageResponse = await fetch(signedData.signedUrl);
    const imageBlob = await imageResponse.arrayBuffer();
    const imageBase64 = btoa(String.fromCharCode(...new Uint8Array(imageBlob)));
    
    // Use responseMimeType for strict JSON output
    const aiResponse = await fetch(`${GEMINI_API_BASE}/${MODEL}:generateContent?key=${geminiApiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: SPATIAL_DECOMPOSITION_PROMPT },
            { inlineData: { mimeType: "image/jpeg", data: imageBase64 } },
          ],
        }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 4000,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("Gemini API error:", errorText);
      await emitEvent(supabase, pipeline_id, user.id, 0, "error", `AI analysis failed: ${aiResponse.status}`, 0);
      throw new Error(`Gemini API error: ${aiResponse.status}`);
    }

    await emitEvent(supabase, pipeline_id, user.id, 0, "info", "Processing architectural graph results...", 60);

    const aiData = await aiResponse.json();
    const responseContent = aiData.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    // Log raw response for debugging
    console.log("Raw AI response length:", responseContent?.length || 0);
    console.log("Raw AI response preview:", responseContent?.substring(0, 500));

    if (!responseContent) {
      await emitEvent(supabase, pipeline_id, user.id, 0, "error", "AI returned empty response", 0);
      throw new Error("Empty AI response");
    }

    // Use robust JSON parsing with repair logic
    const parseResult = parseJsonFromLLM<Record<string, unknown>>(responseContent, "gemini-2.5-pro");
    
    if (!parseResult.success) {
      console.error("JSON parse failed:", parseResult.error);
      console.error("Error code:", parseResult.errorCode);
      
      // Build debug info for storage
      const debugInfo = buildParseDebugInfo(responseContent, parseResult);
      console.error("Parse debug info:", JSON.stringify(debugInfo, null, 2));
      
      await emitEvent(supabase, pipeline_id, user.id, 0, "error", 
        `Failed to parse space analysis - ${parseResult.errorCode}: ${parseResult.error?.substring(0, 100)}`, 0);
      
      // Return structured error instead of throwing
      return new Response(JSON.stringify({
        ok: false,
        success: false,
        error_code: "SPATIAL_DECOMPOSITION_PARSE_FAILED",
        error: parseResult.error,
        user_message: "Space decomposition returned invalid data. Please retry.",
        retry_available: true,
        debug: {
          raw_output_length: responseContent.length,
          raw_output_preview: responseContent.substring(0, 1000),
          extracted_json_preview: parseResult.extractedJson?.substring(0, 500),
          parse_error_position: parseResult.parsePosition,
        }
      }), { 
        status: 200, // NOT 500 - graceful error
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }
    
    const rawParsed = parseResult.data;

    // Validate and normalize the response
    const spatialAnalysis = validateAndNormalize(rawParsed);

    if (spatialAnalysis.rooms.length === 0) {
      await emitEvent(supabase, pipeline_id, user.id, 0, "error", "No rooms detected in floor plan", 0);
      throw new Error("No rooms detected in the floor plan");
    }

    await emitEvent(supabase, pipeline_id, user.id, 0, "info", 
      `Detected ${spatialAnalysis.rooms.length} rooms, ${spatialAnalysis.edges.length} connections`, 70);

    // Check for existing spatial map and upsert
    const { data: existingMap } = await supabase
      .from("pipeline_spatial_maps")
      .select("id, version")
      .eq("pipeline_id", pipeline_id)
      .maybeSingle();

    const newVersion = existingMap ? (existingMap.version || 0) + 1 : 1;

    // Prepare locks_json from the locks array
    const locksJson = {
      furniture_locks: spatialAnalysis.locks,
      visibility_hints: spatialAnalysis.visibility_hints,
      scale_locked: true,
      geometry_locked: true,
    };

    let spatialMap;
    if (existingMap) {
      // Update existing
      const { data, error } = await supabase
        .from("pipeline_spatial_maps")
        .update({ 
          rooms: spatialAnalysis.rooms,
          adjacency_graph: spatialAnalysis.edges,
          locks_json: locksJson,
          version: newVersion,
          raw_analysis: responseContent,
        })
        .eq("id", existingMap.id)
        .select()
        .single();
      
      if (error) throw new Error("Failed to update spatial analysis");
      spatialMap = data;
    } else {
      // Insert new
      const { data, error } = await supabase
        .from("pipeline_spatial_maps")
        .insert({ 
          pipeline_id, 
          owner_id: user.id, 
          rooms: spatialAnalysis.rooms, 
          adjacency_graph: spatialAnalysis.edges,
          locks_json: locksJson,
          version: newVersion,
          raw_analysis: responseContent,
        })
        .select()
        .single();

      if (error) throw new Error("Failed to save spatial analysis");
      spatialMap = data;
    }

    await emitEvent(supabase, pipeline_id, user.id, 0, "info", "Creating room sub-pipelines...", 80);

    // Delete existing room sub-pipelines before creating new ones
    await supabase.from("room_sub_pipelines").delete().eq("pipeline_id", pipeline_id);

    const roomSubPipelines = spatialAnalysis.rooms.map((room) => ({
      pipeline_id, 
      owner_id: user.id, 
      room_id: room.id, 
      room_type: room.name,
      room_label: room.label || null, 
      bounds: room.bounds || null, 
      status: "pending", 
      camera_renders: [],
    }));

    await supabase.from("room_sub_pipelines").insert(roomSubPipelines);

    await supabase.from("floorplan_pipelines").update({ 
      status: "step1_pending", 
      global_phase: "global_3d" 
    }).eq("id", pipeline_id);

    await emitEvent(supabase, pipeline_id, user.id, 0, "success", 
      `Architectural graph complete: ${spatialAnalysis.rooms.length} rooms, ${spatialAnalysis.edges.length} edges, ${spatialAnalysis.locks.length} locks`, 100);

    return new Response(JSON.stringify({
      success: true, 
      spatial_map_id: spatialMap.id, 
      version: newVersion,
      rooms_detected: spatialAnalysis.rooms.length, 
      edges_detected: spatialAnalysis.edges.length,
      locks_count: spatialAnalysis.locks.length,
      rooms: spatialAnalysis.rooms, 
      edges: spatialAnalysis.edges,
      locks: spatialAnalysis.locks,
      visibility_hints: spatialAnalysis.visibility_hints,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    console.error("Error in run-spatial-decomposition:", error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : "Unknown error",
      details: error instanceof Error ? error.stack : undefined,
    }), {
      status: 500, 
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
