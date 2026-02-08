import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GLOBAL_QA_PROMPT = `You are a quality assurance specialist comparing two adjacent room panoramas for spatial and visual consistency.

ROOM 1: {ROOM_1_TYPE} ({ROOM_1_LABEL})
ROOM 2: {ROOM_2_TYPE} ({ROOM_2_LABEL})
CONNECTION TYPE: {CONNECTION_TYPE}

CRITICAL CHECKS:
1. DOORWAY/OPENING POSITION: Does the connecting doorway or opening appear at a consistent position in both panoramas?
2. WALL ALIGNMENT: Do the shared walls appear to be at the same angle and position from both perspectives?
3. MATERIAL CONSISTENCY: Are the materials (flooring, wall paint, trim) consistent across both rooms?
4. LIGHTING DIRECTION: Is the natural light coming from a consistent direction in both rooms?
5. CEILING HEIGHT: Do the ceilings appear at the same height where the rooms connect?

For each issue found, specify:
- The type of inconsistency
- The severity (minor/major)
- Which room should be re-rendered to fix it

Respond with ONLY valid JSON:
{
  "consistent": true/false,
  "issues": [
    {
      "type": "wall_mismatch|opening_mismatch|material_mismatch|lighting_mismatch",
      "severity": "minor|major",
      "description": "Detailed description of the issue",
      "room_to_rerender": "room_1|room_2|both"
    }
  ],
  "confidence": 0.0-1.0,
  "notes": "Any additional observations"
}`;

// deno-lint-ignore no-explicit-any
async function emitEvent(
  supabase: any,
  pipelineId: string,
  ownerId: string,
  type: string,
  message: string
) {
  await supabase.from("floorplan_pipeline_events").insert({
    pipeline_id: pipelineId,
    owner_id: ownerId,
    step_number: 5, // Global QA phase
    type,
    message,
    progress_int: 0,
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
    const QA_MODEL = "gemini-3-pro-preview";

    const supabase = createClient(supabaseUrl, supabaseKey);
    const { pipeline_id } = await req.json();

    if (!pipeline_id) {
      return new Response(JSON.stringify({ error: "pipeline_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify user
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get pipeline
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

    // Get spatial map for adjacency information
    const { data: spatialMap, error: spatialError } = await supabase
      .from("pipeline_spatial_maps")
      .select("*")
      .eq("pipeline_id", pipeline_id)
      .single();

    if (spatialError || !spatialMap) {
      return new Response(JSON.stringify({ error: "Spatial map not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adjacencyGraph = (spatialMap.adjacency_graph || []) as {
      from: string;
      to: string;
      connection_type: string;
    }[];

    if (adjacencyGraph.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: "No adjacent room pairs to check",
        results: [],
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get all room sub-pipelines with completed panoramas
    const { data: roomSubPipelines, error: roomsError } = await supabase
      .from("room_sub_pipelines")
      .select("*")
      .eq("pipeline_id", pipeline_id)
      .eq("status", "completed")
      .not("panorama_upload_id", "is", null);

    if (roomsError) {
      throw new Error("Failed to fetch room sub-pipelines");
    }

    // deno-lint-ignore no-explicit-any
    const roomMap = new Map((roomSubPipelines || []).map((r: any) => [r.room_id, r]));

    await emitEvent(supabase, pipeline_id, user.id, "info", 
      `Starting global QA: checking ${adjacencyGraph.length} room pairs...`);

    const qaResults: {
      room_pair: string[];
      consistency_decision: string;
      inconsistency_type?: string;
      inconsistency_details?: string;
    }[] = [];

    // Check each adjacent pair
    for (const adjacency of adjacencyGraph) {
      // deno-lint-ignore no-explicit-any
      const room1 = roomMap.get(adjacency.from) as any;
      // deno-lint-ignore no-explicit-any
      const room2 = roomMap.get(adjacency.to) as any;

      if (!room1 || !room2 || !room1.panorama_upload_id || !room2.panorama_upload_id) {
        console.log(`Skipping pair ${adjacency.from}-${adjacency.to}: missing panoramas`);
        continue;
      }

      // Get panorama images
      const [upload1, upload2] = await Promise.all([
        supabase.from("uploads").select("*").eq("id", room1.panorama_upload_id).single(),
        supabase.from("uploads").select("*").eq("id", room2.panorama_upload_id).single(),
      ]);

      if (upload1.error || upload2.error) {
        continue;
      }

      // Get signed URLs
      const [signed1, signed2] = await Promise.all([
        supabase.storage.from(upload1.data.bucket).createSignedUrl(upload1.data.path, 3600),
        supabase.storage.from(upload2.data.bucket).createSignedUrl(upload2.data.path, 3600),
      ]);

      if (!signed1.data?.signedUrl || !signed2.data?.signedUrl) {
        continue;
      }

      // Fetch images
      const [img1Response, img2Response] = await Promise.all([
        fetch(signed1.data.signedUrl),
        fetch(signed2.data.signedUrl),
      ]);

      const [img1ArrayBuffer, img2ArrayBuffer] = await Promise.all([
        img1Response.arrayBuffer(),
        img2Response.arrayBuffer(),
      ]);

      const img1Base64 = encode(img1ArrayBuffer);
      const img2Base64 = encode(img2ArrayBuffer);

      // Build prompt
      const prompt = GLOBAL_QA_PROMPT
        .replace("{ROOM_1_TYPE}", room1.room_type)
        .replace("{ROOM_1_LABEL}", room1.room_label || room1.room_type)
        .replace("{ROOM_2_TYPE}", room2.room_type)
        .replace("{ROOM_2_LABEL}", room2.room_label || room2.room_type)
        .replace("{CONNECTION_TYPE}", adjacency.connection_type);

      // Call Gemini for QA
      const qaPayload = {
        contents: [{
          parts: [
            { text: "You are a quality assurance specialist for architectural visualizations. Always respond with valid JSON only.\n\n" + prompt },
            { inlineData: { mimeType: "image/jpeg", data: img1Base64 } },
            { inlineData: { mimeType: "image/jpeg", data: img2Base64 } },
          ],
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 1000,
        },
      };

      const qaResponse = await fetch(`${GEMINI_API_BASE}/${QA_MODEL}:generateContent?key=${geminiApiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(qaPayload),
      });

      if (!qaResponse.ok) {
        console.error(`QA check failed for ${adjacency.from}-${adjacency.to}`);
        continue;
      }

      const qaData = await qaResponse.json();
      const qaContent = qaData.candidates?.[0]?.content?.parts?.[0]?.text || "";

      // Extract JSON from response
      const jsonMatch = qaContent.match(/\{[\s\S]*\}/);
      let qaResult;
      try {
        qaResult = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
        if (!qaResult) throw new Error("No JSON found");
      } catch {
        console.error("Failed to parse QA response");
        continue;
      }

      const result = {
        room_pair: [adjacency.from, adjacency.to],
        consistency_decision: qaResult.consistent ? "approved" : "inconsistent",
        inconsistency_type: qaResult.issues?.[0]?.type || null,
        // deno-lint-ignore no-explicit-any
        inconsistency_details: qaResult.issues?.map((i: any) => i.description).join("; ") || null,
      };

      qaResults.push(result);

      // Store in database
      await supabase.from("global_qa_results").insert({
        pipeline_id,
        owner_id: user.id,
        room_pair: result.room_pair,
        consistency_decision: result.consistency_decision,
        inconsistency_type: result.inconsistency_type,
        inconsistency_details: result.inconsistency_details,
        rerender_triggered: false,
      });
    }

    const approvedCount = qaResults.filter(r => r.consistency_decision === "approved").length;
    const inconsistentCount = qaResults.filter(r => r.consistency_decision === "inconsistent").length;

    await emitEvent(supabase, pipeline_id, user.id, "success", 
      `Global QA complete: ${approvedCount} consistent, ${inconsistentCount} inconsistent pairs`);

    console.log(`Global QA complete for pipeline ${pipeline_id}: ${qaResults.length} pairs checked`);

    return new Response(JSON.stringify({
      success: true,
      pairs_checked: qaResults.length,
      approved_count: approvedCount,
      inconsistent_count: inconsistentCount,
      results: qaResults,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Error in run-global-qa:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
