import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Stale threshold: 2 minutes
const STALE_THRESHOLD_MS = 2 * 60 * 1000;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth validation
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData } = await supabase.auth.getUser(token);
    if (!claimsData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.user.id;

    // Parse request
    const { pipeline_id, step_number } = await req.json();
    if (!pipeline_id) {
      return new Response(JSON.stringify({ error: "Missing pipeline_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Currently only Step 3 is supported
    if (step_number !== 3) {
      return new Response(JSON.stringify({ error: "Only step 3 retry is supported" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[retry-pipeline-step] Retrying step ${step_number} for pipeline: ${pipeline_id}`);

    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Fetch pipeline with ownership check
    const { data: pipeline, error: pipelineError } = await serviceClient
      .from("floorplan_pipelines")
      .select("id, owner_id, whole_apartment_phase, step3_job_id, step3_last_backend_event_at, step3_attempt_count, step_outputs")
      .eq("id", pipeline_id)
      .eq("owner_id", userId)
      .single();

    if (pipelineError || !pipeline) {
      console.error(`[retry-pipeline-step] Pipeline not found: ${pipelineError?.message}`);
      return new Response(JSON.stringify({ error: "Pipeline not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const phase = pipeline.whole_apartment_phase;
    const isRunning = phase === "detecting_spaces";

    // Check if genuinely running (not stale)
    if (isRunning && pipeline.step3_last_backend_event_at) {
      const lastEventTime = new Date(pipeline.step3_last_backend_event_at).getTime();
      const isStale = Date.now() - lastEventTime > STALE_THRESHOLD_MS;

      if (!isStale) {
        console.log(`[retry-pipeline-step] Step 3 is actively running (last event: ${pipeline.step3_last_backend_event_at})`);
        return new Response(JSON.stringify({
          success: false,
          already_running: true,
          job_id: pipeline.step3_job_id,
          message: "Step 3 is actively running. Please wait.",
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      console.log(`[retry-pipeline-step] Step 3 is stale (last event: ${pipeline.step3_last_backend_event_at}), allowing retry`);
    }

    // Get the styled image upload ID from step_outputs
    const stepOutputs = pipeline.step_outputs || {};
    // deno-lint-ignore no-explicit-any
    const styledImageId = (stepOutputs as any).step2?.output_upload_id;

    if (!styledImageId) {
      console.error(`[retry-pipeline-step] No styled image found in step_outputs`);
      return new Response(JSON.stringify({ 
        error: "Cannot retry: Step 2 output not found. Please complete Step 2 first." 
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Reset pipeline state for Step 3 retry
    const newJobId = crypto.randomUUID();
    const now = new Date().toISOString();

    console.log(`[retry-pipeline-step] Resetting Step 3 state with new job_id: ${newJobId}`);

    // Clear any existing spaces from previous failed attempts (if configured to do so)
    // For now, we'll just update the pipeline phase to allow retry
    await serviceClient
      .from("floorplan_pipelines")
      .update({
        whole_apartment_phase: "style_approved", // Reset to pre-Step3 phase
        step3_job_id: newJobId,
        step3_last_backend_event_at: now,
        last_error: null,
      })
      .eq("id", pipeline_id);

    // Emit retry event
    await serviceClient.from("floorplan_pipeline_events").insert({
      pipeline_id,
      owner_id: userId,
      step_number: 3,
      type: "info",
      message: `Step 3 retry initiated (attempt ${(pipeline.step3_attempt_count || 0) + 1})`,
      progress_int: 0,
    });

    // Now invoke run-detect-spaces
    console.log(`[retry-pipeline-step] Invoking run-detect-spaces...`);

    const detectResponse = await fetch(`${SUPABASE_URL}/functions/v1/run-detect-spaces`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": authHeader,
      },
      body: JSON.stringify({
        pipeline_id,
        styled_image_upload_id: styledImageId,
      }),
    });

    if (!detectResponse.ok) {
      const errorText = await detectResponse.text();
      console.error(`[retry-pipeline-step] run-detect-spaces failed: ${detectResponse.status} - ${errorText}`);
      
      // Update pipeline with error
      await serviceClient
        .from("floorplan_pipelines")
        .update({
          last_error: `Retry failed: ${errorText}`,
          step3_job_id: null,
        })
        .eq("id", pipeline_id);

      return new Response(JSON.stringify({
        success: false,
        error: `Space detection failed: ${errorText}`,
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const detectResult = await detectResponse.json();
    console.log(`[retry-pipeline-step] run-detect-spaces result:`, detectResult);

    return new Response(JSON.stringify({
      success: true,
      restarted: true,
      job_id: newJobId,
      spaces_count: detectResult.total_spaces || 0,
      message: "Step 3 retry initiated successfully",
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[retry-pipeline-step] Error: ${message}`);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
