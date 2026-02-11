// Edge Function: save-camera-intents
// Purpose: Step 3 - Save Camera Intent selections (Templates A-H)
// Date: 2026-02-10

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing Authorization header");
    }

    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const userClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      throw new Error("Unauthorized");
    }

    const { pipeline_id, intents } = await req.json();

    if (!pipeline_id) {
      throw new Error("Missing pipeline_id");
    }

    if (!intents || !Array.isArray(intents) || intents.length === 0) {
      throw new Error("Missing or empty intents array");
    }

    console.log(`[save-camera-intents] Saving ${intents.length} camera intents for pipeline ${pipeline_id}`);

    // Validate pipeline exists and is in correct phase
    const { data: pipeline, error: pipelineError } = await serviceClient
      .from("floorplan_pipelines")
      .select("id, whole_apartment_phase, project_id")
      .eq("id", pipeline_id)
      .eq("owner_id", user.id)
      .single();

    if (pipelineError || !pipeline) {
      throw new Error("Pipeline not found or access denied");
    }

    // Allow phases: camera_intent_pending, camera_intent_confirmed (re-edit)
    const allowedPhases = ["camera_intent_pending", "camera_intent_confirmed"];
    if (!allowedPhases.includes(pipeline.whole_apartment_phase)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Pipeline not ready for camera intent selection. Current phase: ${pipeline.whole_apartment_phase}. Expected: ${allowedPhases.join(", ")}`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate all intents have required fields
    for (const intent of intents) {
      if (!intent.standing_space_id) {
        throw new Error("Intent missing standing_space_id");
      }
      if (!intent.template_id || !["A", "B", "C", "D", "E", "F", "G", "H"].includes(intent.template_id)) {
        throw new Error(`Invalid template_id: ${intent.template_id}`);
      }
      if (!intent.view_direction_type) {
        throw new Error("Intent missing view_direction_type");
      }

      // Templates B and D require target_space_id
      if (["B", "D"].includes(intent.template_id) && !intent.target_space_id) {
        throw new Error(`Template ${intent.template_id} requires target_space_id (adjacent space)`);
      }
    }

    // Clear existing intents for this pipeline
    const { error: deleteError } = await serviceClient
      .from("camera_intents")
      .delete()
      .eq("pipeline_id", pipeline_id);

    if (deleteError) {
      console.error(`[save-camera-intents] Failed to delete existing intents: ${deleteError.message}`);
      // Continue anyway - upsert will handle it
    }

    // Insert new intents with generated IDs and timestamps
    const insertData = intents.map((intent, idx) => ({
      pipeline_id: pipeline_id,
      owner_id: user.id,
      project_id: pipeline.project_id,
      camera_id: `${pipeline_id}_${intent.standing_space_id}_${intent.template_id}`,
      standing_space_id: intent.standing_space_id,
      standing_space_name: intent.standing_space_name,
      template_id: intent.template_id,
      template_description: intent.template_description,
      view_direction_type: intent.view_direction_type,
      target_space_id: intent.target_space_id || null,
      target_space_name: intent.target_space_name || null,
      intent_description: intent.intent_description,
      generation_order: idx + 1,
      is_selected: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));

    const { error: insertError } = await serviceClient
      .from("camera_intents")
      .insert(insertData);

    if (insertError) {
      throw new Error(`Failed to insert camera intents: ${insertError.message}`);
    }

    console.log(`[save-camera-intents] Inserted ${insertData.length} camera intents`);

    // Update pipeline phase to confirmed
    const { error: updateError } = await serviceClient
      .from("floorplan_pipelines")
      .update({
        whole_apartment_phase: "camera_intent_confirmed",
        camera_intent_confirmed_at: new Date().toISOString(),
      })
      .eq("id", pipeline_id);

    if (updateError) {
      throw new Error(`Failed to update pipeline phase: ${updateError.message}`);
    }

    console.log(`[save-camera-intents] Pipeline ${pipeline_id} updated to camera_intent_confirmed`);

    return new Response(
      JSON.stringify({
        success: true,
        intents_saved: insertData.length,
        message: `${insertData.length} camera intent(s) saved successfully`,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[save-camera-intents] Error: ${message}`);

    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
