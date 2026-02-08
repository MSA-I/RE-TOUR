import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  ensurePipelineTrace,
  logSimpleGeneration,
  flushLangfuse,
} from "../_shared/langfuse-generation-wrapper.ts";
import { STEP_3_1_GENERATIONS } from "../_shared/langfuse-constants.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Storage space types that should be excluded from panorama generation
const STORAGE_SPACE_TYPES = [
  "pantry",
  "closet", 
  "storage_closet",
  "utility_closet",
  "cabinet_storage",
  "wardrobe",
  "storage",
  "corridor",
  "hallway",
];

function isStorageSpace(spaceType: string, roomType: string): boolean {
  const normalized = (spaceType || roomType || "").toLowerCase().replace(/[\s_-]+/g, "_");
  return STORAGE_SPACE_TYPES.some(type => 
    normalized === type || 
    normalized.includes("closet") || 
    normalized.includes("pantry") ||
    normalized.includes("storage") ||
    normalized.includes("wardrobe")
  ) || roomType === "zone";
}

/**
 * Emit pipeline event for progress tracking
 */
// deno-lint-ignore no-explicit-any
async function emitEvent(
  supabase: any,
  pipelineId: string,
  ownerId: string,
  stepNumber: number,
  type: string,
  message: string,
  progressInt: number
) {
  try {
    await supabase.from("floorplan_pipeline_events").insert({
      pipeline_id: pipelineId,
      owner_id: ownerId,
      step_number: stepNumber,
      type,
      message,
      progress_int: progressInt,
    });
  } catch (e) {
    console.error(`[detect-spaces] Failed to emit event: ${e}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ALLOWED PHASES FOR THIS FUNCTION
// Step 3 = Detect Spaces (NOT Step 4)
// Note: "style_approved" is a non-standard phase that may appear if approval
// didn't transition correctly. We handle it gracefully by proceeding.
// ═══════════════════════════════════════════════════════════════════════════
const ALLOWED_PHASES = ["detect_spaces_pending", "detecting_spaces", "style_approved", "style_review"];

/**
 * Room structure from step_outputs.space_analysis (Step 0 analysis)
 * CRITICAL: room_name is the human-readable name and is REQUIRED
 */
interface SpaceAnalysisRoom {
  space_id: string;
  room_name: string;           // REQUIRED: Human-readable name (e.g., "Kitchen", "Bedroom 1")
  inferred_usage?: string;     // Legacy/backup field, should match room_name
  confidence: number;
  classification_reason?: string;
  dimensions_summary?: string;
  geometry_flags?: { has_angled_walls: boolean; has_curved_walls: boolean };
  detected_items?: string[];
}

interface SpaceAnalysisData {
  rooms: SpaceAnalysisRoom[];
  zones: SpaceAnalysisRoom[];
  rooms_count: number;
  zones_count: number;
  overall_notes?: string;
  analyzed_at: string;
}

/**
 * Get the canonical room name from a space analysis room object.
 * Prioritizes room_name, falls back to inferred_usage for backward compatibility.
 */
function getCanonicalRoomName(room: SpaceAnalysisRoom, index: number, type: string): string {
  const name = room.room_name || room.inferred_usage;
  if (!name || name.trim().length < 2 || /^(room|space|zone|area)[\s_-]?\d*$/i.test(name.trim())) {
    console.warn(`[detect-spaces] Space has invalid name "${name}", using fallback`);
    return `${type === "zone" ? "Zone" : "Room"} ${index + 1}`;
  }
  return name;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const actionId = crypto.randomUUID();
  console.log(`[DETECT_SPACES] Action ${actionId} started`);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { 
        status: 401, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { 
      global: { headers: { Authorization: authHeader } } 
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData } = await supabase.auth.getUser(token);
    if (!claimsData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { 
        status: 401, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }
    const userId = claimsData.user.id;

    const { pipeline_id } = await req.json();
    if (!pipeline_id) {
      return new Response(JSON.stringify({ error: "Missing pipeline_id" }), { 
        status: 400, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    console.log(`[DETECT_SPACES] Starting for pipeline: ${pipeline_id}`);

    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ═══════════════════════════════════════════════════════════════════════════
    // LANGFUSE TRACING: Ensure pipeline_run trace exists
    // ═══════════════════════════════════════════════════════════════════════════
    await ensurePipelineTrace(pipeline_id, "", userId);
    
    // Fetch pipeline with only needed columns
    const { data: pipeline, error: pipelineError } = await serviceClient
      .from("floorplan_pipelines")
      .select("id, owner_id, whole_apartment_phase, aspect_ratio, output_resolution, step3_attempt_count, step_outputs")
      .eq("id", pipeline_id)
      .eq("owner_id", userId)
      .single();
    
    if (pipelineError || !pipeline) {
      return new Response(JSON.stringify({ error: "Pipeline not found" }), { 
        status: 404, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE GUARD: Validate this function is allowed for current phase
    // ═══════════════════════════════════════════════════════════════════════════
    const currentPhase = pipeline.whole_apartment_phase ?? "upload";
    console.log(`[DETECT_SPACES] Pipeline ${pipeline_id} current phase: ${currentPhase}`);
    
    if (!ALLOWED_PHASES.includes(currentPhase)) {
      console.error(`[DETECT_SPACES] Phase mismatch: expected one of [${ALLOWED_PHASES.join(", ")}], got "${currentPhase}"`);
      return new Response(
        JSON.stringify({ 
          error: `Phase mismatch: run-detect-spaces handles Step 3 (Detect Spaces), but pipeline is at phase "${currentPhase}"`,
          hint: "After Step 2 (Style), call continue-pipeline-step to advance to detect_spaces_pending before calling this function",
          expected_phases: ALLOWED_PHASES,
          current_phase: currentPhase,
          action_id: actionId,
        }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Emit action start event (Step 3, not 4)
    await emitEvent(serviceClient, pipeline_id, userId, 3, "ACTION_START", JSON.stringify({
      action_name: "DETECT_SPACES_START",
      action_id: actionId,
      phase_at_start: currentPhase,
      function_name: "run-detect-spaces",
    }), 0);

    // GUARD: Prevent duplicate concurrent executions with stale lock detection
    if (pipeline.whole_apartment_phase === "detecting_spaces") {
      const { data: recentEvents } = await serviceClient
        .from("floorplan_pipeline_events")
        .select("id, ts")
        .eq("pipeline_id", pipeline_id)
        .eq("step_number", 3)
        .order("ts", { ascending: false })
        .limit(1);
      
      const lastEventTs = recentEvents?.[0]?.ts;
      const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
      
      if (lastEventTs && lastEventTs > twoMinutesAgo) {
        console.log(`[detect-spaces] Already running for pipeline: ${pipeline_id}`);
        await emitEvent(serviceClient, pipeline_id, userId, 3, "info", 
          "Space detection already in progress...", 0);
        return new Response(JSON.stringify({ 
          success: false, 
          already_running: true, 
          message: "Space detection is already in progress" 
        }), { 
          headers: { ...corsHeaders, "Content-Type": "application/json" } 
        });
      } else {
        console.log(`[detect-spaces] Stale lock detected for pipeline: ${pipeline_id}, restarting...`);
        await emitEvent(serviceClient, pipeline_id, userId, 3, "warning", 
          "Stale lock detected, restarting space detection...", 5);
      }
    }

    // IDEMPOTENCY CHECK: Return existing spaces if already detected
    const { data: existingSpaces } = await serviceClient
      .from("floorplan_pipeline_spaces")
      .select("id, name, space_type, confidence, bounds_note, status")
      .eq("pipeline_id", pipeline_id);
    
    if (existingSpaces && existingSpaces.length > 0) {
      console.log(`[detect-spaces] Returning ${existingSpaces.length} existing spaces`);
      await serviceClient
        .from("floorplan_pipelines")
        .update({ whole_apartment_phase: "spaces_detected", status: "spaces_detected", current_step: 3 })
        .eq("id", pipeline_id);
      
      return new Response(JSON.stringify({ 
        success: true, 
        spaces: existingSpaces, 
        total_spaces: existingSpaces.length, 
        already_existed: true 
      }), { 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    // Mark as running to prevent duplicate calls + track heartbeat
    const newJobId = crypto.randomUUID();
    await serviceClient
      .from("floorplan_pipelines")
      .update({ 
        whole_apartment_phase: "detecting_spaces",
        step3_job_id: newJobId,
        step3_last_backend_event_at: new Date().toISOString(),
        step3_attempt_count: (pipeline.step3_attempt_count || 0) + 1,
        last_error: null
      })
      .eq("id", pipeline_id);

    await emitEvent(serviceClient, pipeline_id, userId, 3, "info", "Loading spatial map from Step 0 analysis...", 10);

    // ═══════════════════════════════════════════════════════════════════════════
    // CRITICAL FIX: Use rooms from step_outputs.space_analysis (run-space-analysis output)
    // ═══════════════════════════════════════════════════════════════════════════
    const stepOutputs = pipeline.step_outputs as Record<string, unknown> | null;
    const spaceAnalysis = stepOutputs?.space_analysis as SpaceAnalysisData | undefined;

    if (!spaceAnalysis || (!spaceAnalysis.rooms && !spaceAnalysis.zones)) {
      console.error(`[detect-spaces] No space_analysis found in step_outputs for pipeline: ${pipeline_id}`);
      await serviceClient
        .from("floorplan_pipelines")
        .update({ 
          whole_apartment_phase: "detect_spaces_pending", 
          last_error: "Space Analysis not found in step_outputs - Step 0 may not have completed. Reset pipeline and run Space Analysis first." 
        })
        .eq("id", pipeline_id);
      throw new Error("Space Analysis not found - ensure Step 0 (Space Analysis) has completed");
    }

    // Combine rooms and zones from space_analysis
    const allSpaces = [
      ...(spaceAnalysis.rooms || []).map(r => ({ ...r, type: "room" as const })),
      ...(spaceAnalysis.zones || []).map(z => ({ ...z, type: "zone" as const })),
    ];
    console.log(`[detect-spaces] Loaded ${spaceAnalysis.rooms_count} rooms and ${spaceAnalysis.zones_count} zones from step_outputs.space_analysis`);

    await emitEvent(serviceClient, pipeline_id, userId, 3, "info", 
      `Found ${allSpaces.length} spaces from initial analysis, creating space records...`, 40);

    // Create space records and their render placeholders FROM SPACE ANALYSIS DATA
    const createdSpaces = [];
    let includedCount = 0;
    let excludedCount = 0;
    
    for (let i = 0; i < allSpaces.length; i++) {
      const space = allSpaces[i];
      const spaceId = space.space_id || `space_${i + 1}`;
      
      // CRITICAL: Use canonical room name (room_name with fallback to inferred_usage)
      const spaceName = getCanonicalRoomName(space, i, space.type);
      const spaceType = spaceName.toLowerCase().replace(/\s+/g, "_") || "room";
      const isStorage = space.type === "zone" || isStorageSpace(spaceType, space.type);
      const includeInGeneration = !isStorage;
      
      console.log(`[detect-spaces] Processing space ${i + 1}: "${spaceName}" (type: ${space.type}, storage: ${isStorage})`);
      
      // Generate bounds_note from dimensions_summary and detected_items
      let boundsNote = space.dimensions_summary || "";
      if (space.detected_items && space.detected_items.length > 0) {
        boundsNote += ` | Detected: ${space.detected_items.join(", ")}`;
      }
      if (space.geometry_flags?.has_angled_walls) {
        boundsNote += " | Has angled walls";
      }
      if (space.geometry_flags?.has_curved_walls) {
        boundsNote += " | Has curved walls";
      }
      
      const { data: spaceRecord, error: spaceError } = await serviceClient
        .from("floorplan_pipeline_spaces")
        .insert({
          pipeline_id,
          owner_id: userId,
          name: spaceName,  // Uses validated canonical name
          space_type: spaceType,
          confidence: space.confidence || 0.9,
          bounds_note: boundsNote || `Detected from floor plan analysis`,
          status: isStorage ? "excluded" : "pending",
          include_in_generation: includeInGeneration,
          is_excluded: isStorage,
          excluded_reason: isStorage ? `Storage/zone space (${space.classification_reason || "zone type"}) - excluded from panorama generation` : null,
          excluded_at: isStorage ? new Date().toISOString() : null,
        })
        .select()
        .single();

      if (spaceError) {
        console.error(`[detect-spaces] Failed to create space ${spaceName}: ${spaceError.message}`);
        continue;
      }

      if (spaceRecord) {
        // Only create render placeholders for spaces that are included in generation
        if (includeInGeneration) {
          // Create render A placeholder
          await serviceClient.from("floorplan_space_renders").insert({
            space_id: spaceRecord.id,
            pipeline_id,
            owner_id: userId,
            kind: "A",
            status: "planned",
            prompt_text: `Eye-level render of ${spaceName}`,
            ratio: pipeline.aspect_ratio || "16:9",
            quality: pipeline.output_resolution || "2K"
          });
          
          // Create render B placeholder
          await serviceClient.from("floorplan_space_renders").insert({
            space_id: spaceRecord.id,
            pipeline_id,
            owner_id: userId,
            kind: "B",
            status: "planned",
            prompt_text: `Opposite angle render of ${spaceName}`,
            ratio: pipeline.aspect_ratio || "16:9",
            quality: pipeline.output_resolution || "2K"
          });
          includedCount++;
        } else {
          excludedCount++;
          console.log(`[detect-spaces] Excluded storage/zone space: ${spaceName} (${spaceType}, type=${space.type})`);
        }
        
        createdSpaces.push(spaceRecord);
      }
    }
    
    console.log(`[detect-spaces] Created ${createdSpaces.length} spaces from space_analysis (${includedCount} for generation, ${excludedCount} storage/zones excluded)`);

    // Update pipeline status - clear job tracking on success
    await serviceClient
      .from("floorplan_pipelines")
      .update({ 
        whole_apartment_phase: "spaces_detected", 
        status: "spaces_detected", 
        current_step: 3,
        step3_job_id: null,
        step3_last_backend_event_at: new Date().toISOString(),
        last_error: null
      })
      .eq("id", pipeline_id);

    await emitEvent(serviceClient, pipeline_id, userId, 3, "success", 
      `Space detection complete: ${includedCount} rooms for generation, ${excludedCount} zones excluded`, 100);

    // ═══════════════════════════════════════════════════════════════════════════
    // LANGFUSE: Log Step 3.1 Space Detection generation
    // ═══════════════════════════════════════════════════════════════════════════
    await logSimpleGeneration({
      traceId: pipeline_id,
      name: STEP_3_1_GENERATIONS.SPACE_DETECTION,
      model: "space_analysis_derived",
      input: {
        pipeline_id,
        step_number: 3,
        sub_step: "3.1",
        source: "step_outputs.space_analysis",
        rooms_count: spaceAnalysis.rooms_count,
        zones_count: spaceAnalysis.zones_count,
      },
      output: {
        spaces_created: createdSpaces.length,
        included_count: includedCount,
        excluded_count: excludedCount,
        space_names: createdSpaces.map(s => s.name),
      },
      metadata: {
        project_id: "",
        pipeline_id,
        step_number: 3,
        sub_step: "3.1",
      },
    });

    // CRITICAL: Flush Langfuse events before returning
    await flushLangfuse();

    return new Response(JSON.stringify({ 
      success: true, 
      spaces: createdSpaces,
      total_spaces: createdSpaces.length,
      included_count: includedCount,
      excluded_count: excludedCount,
      analyzed_at: spaceAnalysis.analyzed_at,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });
    
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[detect-spaces] Error: ${message}`);
    
    // Flush Langfuse even on error
    await flushLangfuse();
    
    return new Response(JSON.stringify({ error: message }), { 
      status: 500, 
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });
  }
});
