import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    // Verify user auth
    const supabaseUser = createClient(
      SUPABASE_URL,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      throw new Error("Unauthorized");
    }

    const { pipeline_id } = await req.json();

    if (!pipeline_id) {
      throw new Error("pipeline_id is required");
    }

    // Get pipeline and verify ownership
    const { data: pipeline, error: pipelineError } = await supabaseAdmin
      .from("floorplan_pipelines")
      .select("*")
      .eq("id", pipeline_id)
      .eq("owner_id", user.id)
      .single();

    if (pipelineError || !pipeline) {
      throw new Error("Pipeline not found or access denied");
    }

    console.log(`Resetting pipeline ${pipeline_id} for user ${user.id}`);
    console.log(`Floor plan upload ID (WILL NOT BE DELETED): ${pipeline.floor_plan_upload_id}`);

    // Get step output upload IDs from pipeline (support both single and multi-output formats)
    const stepOutputs = (pipeline.step_outputs as Record<string, any>) || {};
    const outputUploadIds: string[] = [];

    for (const key of Object.keys(stepOutputs)) {
      if (key.startsWith("step")) {
        const stepData = stepOutputs[key];
        
        // Single output format
        if (stepData?.output_upload_id && stepData.output_upload_id !== pipeline.floor_plan_upload_id) {
          outputUploadIds.push(stepData.output_upload_id);
        }
        
        // Multi-output array format
        if (stepData?.outputs && Array.isArray(stepData.outputs)) {
          for (const output of stepData.outputs) {
            if (output?.output_upload_id && output.output_upload_id !== pipeline.floor_plan_upload_id) {
              outputUploadIds.push(output.output_upload_id);
            }
          }
        }
      }
    }

    console.log(`Found ${outputUploadIds.length} step outputs to PRESERVE (never deleted)`);
    console.log(`CRITICAL: Creations assets will ALWAYS be PRESERVED - pipeline reset only clears references`);
    
    // Log what we're preserving (ALL outputs stay in Creations)
    if (outputUploadIds.length > 0) {
      console.log(`PRESERVING ${outputUploadIds.length} output uploads for Creations:`);
      outputUploadIds.forEach(id => console.log(`  - ${id} (KEPT in Creations)`));
    }

    // Delete pipeline events
    const { error: eventsError } = await supabaseAdmin
      .from("floorplan_pipeline_events")
      .delete()
      .eq("pipeline_id", pipeline_id);

    if (eventsError) {
      console.warn("Failed to delete pipeline events:", eventsError);
    }

    // Delete pipeline reviews
    const { error: reviewsError } = await supabaseAdmin
      .from("floorplan_pipeline_reviews")
      .delete()
      .eq("pipeline_id", pipeline_id);

    if (reviewsError) {
      console.warn("Failed to delete pipeline reviews:", reviewsError);
    }

    // Reset pipeline to step 1 pending state
    const { error: updateError } = await supabaseAdmin
      .from("floorplan_pipelines")
      .update({
        status: "step1_pending",
        current_step: 1,
        step_outputs: {},
        last_error: null,
        camera_position: null,
        forward_direction: null,
        updated_at: new Date().toISOString()
      })
      .eq("id", pipeline_id);

    if (updateError) {
      throw new Error(`Failed to reset pipeline: ${updateError.message}`);
    }

    console.log(`Pipeline ${pipeline_id} reset successfully`);

    return new Response(JSON.stringify({ 
      success: true, 
      message: "Pipeline reset to step 1",
      deleted_outputs: outputUploadIds.length
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error("Reset pipeline error:", error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : "Unknown error" 
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
