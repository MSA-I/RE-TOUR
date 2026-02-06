import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ReqBody = {
  pipeline_id: string;
  step_number: number;
  output_upload_id?: string | null;
  decision?: "APPROVED";
  notes?: Record<string, unknown>;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");

    // Use service role for DB writes, but validate identity using getClaims.
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      console.error("[approve-pipeline-step-manually] Unauthorized:", claimsError?.message);
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ownerId = claimsData.claims.sub as string;
    const body = (await req.json()) as ReqBody;

    if (!body?.pipeline_id) {
      return new Response(JSON.stringify({ error: "Missing pipeline_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const stepNumber = Number(body.step_number);
    if (!Number.isFinite(stepNumber) || stepNumber < 0) {
      return new Response(JSON.stringify({ error: "Invalid step_number" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const decision = body.decision ?? "APPROVED";
    if (decision !== "APPROVED") {
      return new Response(JSON.stringify({ error: "Only APPROVED is supported" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("[approve-pipeline-step-manually] start", {
      pipeline_id: body.pipeline_id,
      step_number: stepNumber,
      owner_id: ownerId,
      output_upload_id: body.output_upload_id ?? null,
    });

    const { data: pipeline, error: rpcError } = await supabase.rpc(
      "manual_approve_floorplan_pipeline_step",
      {
        p_pipeline_id: body.pipeline_id,
        p_step_number: stepNumber,
        p_owner_id: ownerId,
        p_output_upload_id: body.output_upload_id ?? null,
        p_notes: body.notes ?? {},
      },
    );

    if (rpcError) {
      console.error("[approve-pipeline-step-manually] rpc error", rpcError);
      return new Response(JSON.stringify({ error: rpcError.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("[approve-pipeline-step-manually] success", {
      pipeline_id: body.pipeline_id,
      from_step: stepNumber,
      to_step: stepNumber + 1,
    });

    return new Response(
      JSON.stringify({
        pipeline,
        next_allowed_actions: {
          continue_to_step: stepNumber + 1,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[approve-pipeline-step-manually] Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
