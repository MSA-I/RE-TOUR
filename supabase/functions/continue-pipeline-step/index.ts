import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  getStepFromPhase,
  getNextPhase,
  isLegalTransition
} from "../_shared/pipeline-phase-step-contract.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { pipeline_id, from_step, from_phase } = await req.json();

    if (!pipeline_id) {
      return new Response(JSON.stringify({ error: "Missing pipeline_id" }), { status: 400, headers: corsHeaders });
    }

    // Check current status
    const { data: pipeline, error: pipeError } = await supabase
      .from("floorplan_pipelines")
      .select("whole_apartment_phase, current_step")
      .eq("id", pipeline_id)
      .single();

    if (pipeError || !pipeline) {
      return new Response(JSON.stringify({ error: "Pipeline not found" }), { status: 404, headers: corsHeaders });
    }

    const currentPhase = pipeline.whole_apartment_phase;

    // Validate request matches current state (optional but good for safety)
    if (from_phase && from_phase !== currentPhase) {
      // Allow if we are just retrying or if client is slightly out of sync but transition is valid
      // But strict contract says we should be careful.
      console.warn(`Request from_phase ${from_phase} does not match current ${currentPhase}`);
    }

    const nextPhase = getNextPhase(currentPhase);

    if (!nextPhase) {
      return new Response(JSON.stringify({ error: `No legal transition from phase ${currentPhase}` }), { status: 400, headers: corsHeaders });
    }

    const nextStep = getStepFromPhase(nextPhase);

    // Update
    const { error: updateError } = await supabase
      .from("floorplan_pipelines")
      .update({
        whole_apartment_phase: nextPhase,
        current_step: nextStep,
        last_error: null
      })
      .eq("id", pipeline_id);

    if (updateError) throw updateError;

    return new Response(JSON.stringify({
      success: true,
      previous_phase: currentPhase,
      new_phase: nextPhase,
      new_step: nextStep
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Error in continue-pipeline-step:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
