import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RequestBody {
  projectId?: string | null;
  stepId?: number | null;
  timeRange?: "7d" | "30d" | "90d" | "all";
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get user from auth header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body: RequestBody = await req.json();
    const timeRange = body.timeRange || "30d";

    // Calculate date threshold
    const daysAgo = timeRange === "7d" ? 7 : timeRange === "30d" ? 30 : timeRange === "90d" ? 90 : 365;
    const dateThreshold = new Date();
    dateThreshold.setDate(dateThreshold.getDate() - daysAgo);

    // Query qa_judge_results for retry metrics
    // Group by date to show trend over time
    const { data: retryData, error: queryError } = await supabase.rpc(
      "get_retry_analytics",
      {
        p_owner_id: user.id,
        p_project_id: body.projectId || null,
        p_step_id: body.stepId || null,
        p_date_threshold: dateThreshold.toISOString(),
      }
    );

    if (queryError) {
      // If RPC doesn't exist, fall back to direct query
      console.warn("[get-retry-analytics] RPC not found, using fallback query");

      let query = supabase
        .from("qa_judge_results")
        .select("pipeline_id, step_number, attempt_index, created_at, pass")
        .eq("owner_id", user.id)
        .gte("created_at", dateThreshold.toISOString())
        .order("created_at", { ascending: true });

      if (body.projectId) {
        query = query.eq("project_id", body.projectId);
      }

      if (body.stepId !== null && body.stepId !== undefined) {
        query = query.eq("step_number", body.stepId);
      }

      const { data: results, error: fetchError } = await query;

      if (fetchError) {
        throw fetchError;
      }

      // Calculate analytics from results
      const analytics = calculateRetryAnalytics(results || []);

      return new Response(
        JSON.stringify(analytics),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify(retryData),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[get-retry-analytics] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

/**
 * Calculate retry analytics from raw QA judge results
 */
function calculateRetryAnalytics(results: any[]): {
  avgRetryCount: number;
  totalPipelines: number;
  successRate: number;
  trendByDate: Array<{ date: string; avgRetries: number; count: number }>;
} {
  // Group by pipeline_id to calculate retries per pipeline
  const pipelineRetries: Record<string, number> = {};
  const pipelineSuccess: Record<string, boolean> = {};

  for (const result of results) {
    const key = `${result.pipeline_id}_${result.step_number}`;
    pipelineRetries[key] = Math.max(pipelineRetries[key] || 0, result.attempt_index);
    if (result.pass) {
      pipelineSuccess[key] = true;
    }
  }

  // Calculate overall metrics
  const retryValues = Object.values(pipelineRetries);
  const avgRetryCount = retryValues.length > 0
    ? retryValues.reduce((sum, val) => sum + val, 0) / retryValues.length
    : 0;

  const totalPipelines = Object.keys(pipelineRetries).length;
  const successCount = Object.values(pipelineSuccess).filter(Boolean).length;
  const successRate = totalPipelines > 0 ? (successCount / totalPipelines) * 100 : 0;

  // Calculate trend by date (group by day)
  const dateGroups: Record<string, { totalRetries: number; count: number }> = {};

  for (const result of results) {
    const date = new Date(result.created_at).toISOString().split("T")[0];
    if (!dateGroups[date]) {
      dateGroups[date] = { totalRetries: 0, count: 0 };
    }
    dateGroups[date].totalRetries += result.attempt_index;
    dateGroups[date].count += 1;
  }

  const trendByDate = Object.entries(dateGroups)
    .map(([date, data]) => ({
      date,
      avgRetries: data.totalRetries / data.count,
      count: data.count,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    avgRetryCount: Math.round(avgRetryCount * 100) / 100,
    totalPipelines,
    successRate: Math.round(successRate * 100) / 100,
    trendByDate,
  };
}
