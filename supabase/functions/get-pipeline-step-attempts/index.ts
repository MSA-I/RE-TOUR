import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ReqBody {
  pipeline_id: string;
  step_number: number;
}

interface QAReason {
  code: string;
  description: string;
}

interface QAResultJson {
  status?: "PASS" | "FAIL";
  reason_short?: string;
  reasons?: QAReason[];
  evidence?: Array<{ observation: string; location?: string; confidence?: number }>;
  severity?: "low" | "medium" | "high" | "critical";
  retry_suggestion?: { type: string; instruction: string; priority?: number };
  confidence_score?: number;
  // Legacy fields
  decision?: string;
  reason?: string;
  geometry_check?: string;
  scale_check?: string;
  furniture_check?: string;
  [key: string]: unknown;
}

interface AttemptWithUrl {
  id: string;
  pipeline_id: string;
  step_number: number;
  attempt_index: number;
  output_upload_id: string | null;
  qa_status: string;
  qa_reason_short: string | null;
  qa_reason_full: string | null;
  qa_result_json: QAResultJson;
  prompt_used: string | null;
  model_used: string | null;
  created_at: string;
  image_url: string | null;
  // Computed fields
  rejection_category: string | null;
  confidence: "low" | "medium" | "high";
}

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
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Validate user identity
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      console.error("[get-pipeline-step-attempts] Unauthorized:", claimsError?.message);
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

    console.log("[get-pipeline-step-attempts] Fetching attempts", {
      pipeline_id: body.pipeline_id,
      step_number: stepNumber,
      owner_id: ownerId,
    });

    // Fetch all attempts for this pipeline step with retry for transient errors
    let attempts = null;
    let fetchError = null;
    const MAX_RETRIES = 2;
    
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const result = await supabase
        .from("floorplan_pipeline_step_attempts")
        .select("*")
        .eq("pipeline_id", body.pipeline_id)
        .eq("step_number", stepNumber)
        .eq("owner_id", ownerId)
        .order("attempt_index", { ascending: true });
      
      if (!result.error) {
        attempts = result.data;
        fetchError = null;
        break;
      }
      
      // Check if it's a transient network error
      const isTransient = result.error.message?.includes("connection") || 
                          result.error.message?.includes("timeout") ||
                          result.error.message?.includes("reset");
      
      if (isTransient && attempt < MAX_RETRIES) {
        console.warn(`[get-pipeline-step-attempts] Transient error, retry ${attempt + 1}/${MAX_RETRIES}`);
        await new Promise(r => setTimeout(r, 200 * (attempt + 1))); // Exponential backoff
        continue;
      }
      
      fetchError = result.error;
    }

    if (fetchError) {
      console.error("[get-pipeline-step-attempts] Fetch error:", fetchError);
      const isTransient = fetchError.message?.includes("connection") || 
                          fetchError.message?.includes("timeout") ||
                          fetchError.message?.includes("reset");
      return new Response(JSON.stringify({ error: fetchError.message }), {
        status: isTransient ? 503 : 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Generate signed URLs and compute structured fields for each attempt
    const attemptsWithUrls: AttemptWithUrl[] = await Promise.all(
      (attempts || []).map(async (attempt) => {
        let imageUrl: string | null = null;

        if (attempt.output_upload_id) {
          // Fetch upload details
          const { data: upload } = await supabase
            .from("uploads")
            .select("bucket, path")
            .eq("id", attempt.output_upload_id)
            .single();

          if (upload?.bucket && upload?.path) {
            const { data: signedData } = await supabase.storage
              .from(upload.bucket)
              .createSignedUrl(upload.path, 3600); // 1 hour expiry

            imageUrl = signedData?.signedUrl || null;
          }
        }

        // Parse qa_result_json
        const qa = (attempt.qa_result_json || {}) as QAResultJson;
        
        // Extract primary rejection category
        let rejection_category: string | null = null;
        if (qa.reasons && Array.isArray(qa.reasons) && qa.reasons.length > 0) {
          rejection_category = qa.reasons[0].code;
        } else if (qa.geometry_check === "failed") {
          rejection_category = "GEOMETRY_DISTORTION";
        } else if (qa.scale_check === "failed") {
          rejection_category = "SCALE_MISMATCH";
        } else if (qa.furniture_check === "failed") {
          rejection_category = "FURNITURE_MISMATCH";
        } else if (attempt.qa_status === "rejected") {
          rejection_category = "UNKNOWN";
        }
        
        // Extract confidence level
        let confidence: "low" | "medium" | "high" = "medium";
        if (typeof qa.confidence_score === "number") {
          if (qa.confidence_score >= 0.8) confidence = "high";
          else if (qa.confidence_score < 0.5) confidence = "low";
        }

        return {
          id: attempt.id,
          pipeline_id: attempt.pipeline_id,
          step_number: attempt.step_number,
          attempt_index: attempt.attempt_index,
          output_upload_id: attempt.output_upload_id,
          qa_status: attempt.qa_status,
          qa_reason_short: attempt.qa_reason_short,
          qa_reason_full: attempt.qa_reason_full,
          qa_result_json: qa,
          prompt_used: attempt.prompt_used,
          model_used: attempt.model_used,
          created_at: attempt.created_at,
          image_url: imageUrl,
          rejection_category,
          confidence,
        };
      })
    );

    console.log("[get-pipeline-step-attempts] Found", attemptsWithUrls.length, "attempts");

    return new Response(
      JSON.stringify({
        attempts: attemptsWithUrls,
        total_count: attemptsWithUrls.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[get-pipeline-step-attempts] Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
