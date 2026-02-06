import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";
import { 
  PHASE_STEP_CONTRACT, 
  LEGAL_PHASE_TRANSITIONS, 
  getStepFromPhase 
} from "../_shared/pipeline-phase-step-contract.ts";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CONTINUE-PIPELINE-STEP EDGE FUNCTION
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * PURPOSE: Pure state transition function. Advances `whole_apartment_phase` 
 * from a "review" or "confirmed" phase to the next "pending" phase.
 * 
 * CRITICAL RULES:
 * 1. This function NEVER triggers AI work
 * 2. This function NEVER calls other edge functions
 * 3. This function only updates `whole_apartment_phase`
 * 4. The DB trigger will auto-correct `current_step` to match phase
 * 5. Returns FULL pipeline payload to prevent stale UI
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Parse request body
    const { pipeline_id, from_step, from_phase } = await req.json();

    if (!pipeline_id) {
      return new Response(
        JSON.stringify({ error: "pipeline_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (from_step === undefined || !from_phase) {
      return new Response(
        JSON.stringify({ error: "from_step and from_phase are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Authenticate user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    // Get user ID from token
    const token = authHeader.replace("Bearer ", "");
    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData?.user) {
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const userId = authData.user.id;

    console.log(`[continue-pipeline-step] User ${userId} requesting transition from phase=${from_phase} step=${from_step}`);

    // 1. FETCH the pipeline with row lock validation
    const { data: pipeline, error: fetchError } = await supabase
      .from("floorplan_pipelines")
      .select("*")
      .eq("id", pipeline_id)
      .eq("owner_id", userId)
      .single();

    if (fetchError || !pipeline) {
      console.error(`[continue-pipeline-step] Pipeline not found or not owned: ${fetchError?.message}`);
      return new Response(
        JSON.stringify({ error: "Pipeline not found or not owned by user" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. VALIDATE from_phase matches current phase (exact string match)
    if (pipeline.whole_apartment_phase !== from_phase) {
      console.warn(`[continue-pipeline-step] Phase mismatch: expected=${pipeline.whole_apartment_phase}, got=${from_phase}`);
      return new Response(
        JSON.stringify({ 
          error: "Outdated transition: phase has changed",
          current_phase: pipeline.whole_apartment_phase,
          requested_from_phase: from_phase,
        }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. VALIDATE from_step matches derived step from phase
    const currentDerivedStep = getStepFromPhase(pipeline.whole_apartment_phase);
    if (currentDerivedStep !== from_step) {
      console.warn(`[continue-pipeline-step] Step mismatch: derived=${currentDerivedStep}, requested=${from_step}`);
      return new Response(
        JSON.stringify({ 
          error: "Outdated transition: step has changed",
          current_step: currentDerivedStep,
          requested_from_step: from_step,
        }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. VALIDATE target phase is legal
    const nextPhase = LEGAL_PHASE_TRANSITIONS[from_phase];
    if (!nextPhase) {
      console.error(`[continue-pipeline-step] No legal transition from phase: ${from_phase}`);
      return new Response(
        JSON.stringify({ 
          error: `No legal transition from phase: ${from_phase}`,
          hint: "This phase may require approval or generation first",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const toStep = getStepFromPhase(nextPhase);
    console.log(`[continue-pipeline-step] Transitioning: ${from_phase} (step ${from_step}) → ${nextPhase} (step ${toStep})`);

    // 5. ATOMIC UPDATE — NO AI CALLS, NO STATUS STRING
    // Note: current_step will be auto-corrected by the DB trigger
    const { data: updated, error: updateError } = await supabase
      .from("floorplan_pipelines")
      .update({
        whole_apartment_phase: nextPhase,
        // DO NOT set current_step - trigger handles it
        // DO NOT set status - phase is SSOT
        updated_at: new Date().toISOString(),
      })
      .eq("id", pipeline_id)
      .eq("owner_id", userId)
      .select("*")
      .single();

    if (updateError) {
      console.error(`[continue-pipeline-step] Update failed: ${updateError.message}`);
      return new Response(
        JSON.stringify({ error: `Update failed: ${updateError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 6. INSERT event for audit trail
    await supabase.from("floorplan_pipeline_events").insert({
      pipeline_id,
      owner_id: userId,
      step_number: toStep,
      type: "STEP_CONTINUE",
      message: JSON.stringify({ 
        from_step, 
        from_phase, 
        to_step: toStep, 
        to_phase: nextPhase,
        action: "continue-pipeline-step",
      }),
      progress_int: 0,
      ts: new Date().toISOString(),
    });

    console.log(`[continue-pipeline-step] Success: Pipeline ${pipeline_id} now at phase=${nextPhase}`);

    // 7. RETURN FULL pipeline payload to prevent stale UI
    return new Response(
      JSON.stringify({ 
        success: true,
        pipeline: updated,
        transition: {
          from_phase,
          from_step,
          to_phase: nextPhase,
          to_step: toStep,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error(`[continue-pipeline-step] Unexpected error:`, error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
