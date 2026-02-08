import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RequestBody {
  projectId: string;
  pipelineId: string;
  stepId: number;
}

const MAX_SIMILAR_CASES = 5;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Validate auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ownerId = claimsData.claims.sub as string;
    const body = (await req.json()) as RequestBody;

    console.log("[get-qa-learning-context] Fetching context:", {
      projectId: body.projectId,
      stepId: body.stepId,
    });

    // 1. Fetch active policy rules with priority ordering
    // Priority: step-specific > project-specific > global
    const { data: allRules } = await supabase
      .from("qa_policy_rules")
      .select("*")
      .eq("owner_id", ownerId)
      .eq("rule_status", "active")
      .or(`step_id.eq.${body.stepId},step_id.is.null`)
      .or(`project_id.eq.${body.projectId},project_id.is.null`)
      .order("scope_level", { ascending: false }) // step > project > global
      .order("support_count", { ascending: false })
      .limit(20);

    // De-duplicate and prioritize rules
    const seenCategories = new Set<string>();
    const policyRules = (allRules || [])
      .filter((rule) => {
        // Prioritize step-specific rules per category
        const key = `${rule.step_id || "any"}_${rule.category}`;
        if (seenCategories.has(key)) return false;
        seenCategories.add(key);
        return true;
      })
      .slice(0, 10)
      .map((rule) => ({
        id: rule.id,
        scopeLevel: rule.scope_level,
        stepId: rule.step_id,
        category: rule.category,
        ruleText: rule.rule_text,
        supportCount: rule.support_count,
      }));

    // 2. Fetch similar past cases from qa_case_index
    // First try same step, then fall back to same project
    const { data: stepCases } = await supabase
      .from("qa_case_index")
      .select(`
        id,
        feedback_id,
        step_id,
        category,
        outcome_type,
        qa_human_feedback!inner(
          user_decision,
          user_reason_short,
          qa_original_status,
          context_snapshot
        )
      `)
      .eq("owner_id", ownerId)
      .eq("step_id", body.stepId)
      .order("created_at", { ascending: false })
      .limit(MAX_SIMILAR_CASES);

    // If we don't have enough step-specific cases, fetch project-level cases
    let additionalCases: unknown[] = [];
    if ((stepCases?.length || 0) < MAX_SIMILAR_CASES) {
      const remaining = MAX_SIMILAR_CASES - (stepCases?.length || 0);
      const { data: projectCases } = await supabase
        .from("qa_case_index")
        .select(`
          id,
          feedback_id,
          step_id,
          category,
          outcome_type,
          qa_human_feedback!inner(
            user_decision,
            user_reason_short,
            qa_original_status,
            context_snapshot,
            project_id
          )
        `)
        .eq("owner_id", ownerId)
        .neq("step_id", body.stepId)
        .order("created_at", { ascending: false })
        .limit(remaining);

      // Filter to same project
      additionalCases = (projectCases || []).filter(
        (c: any) => c.qa_human_feedback?.project_id === body.projectId
      );
    }

    const allCases = [...(stepCases || []), ...additionalCases];
    const similarCases = allCases.map((c: any) => ({
      id: c.id,
      stepId: c.step_id,
      category: c.category,
      userDecision: c.qa_human_feedback?.user_decision,
      userReasonShort: c.qa_human_feedback?.user_reason_short,
      qaOriginalStatus: c.qa_human_feedback?.qa_original_status,
      outcomeType: c.outcome_type,
      contextSummary: summarizeContext(c.qa_human_feedback?.context_snapshot),
    }));

    // 3. Fetch calibration stats for this step
    const { data: calibrationData } = await supabase
      .from("qa_calibration_stats")
      .select("*")
      .eq("owner_id", ownerId)
      .eq("project_id", body.projectId)
      .eq("step_id", body.stepId);

    const calibrationStats = (calibrationData || []).map((stat) => ({
      stepId: stat.step_id,
      category: stat.category,
      falseRejectCount: stat.false_reject_count || 0,
      falseApproveCount: stat.false_approve_count || 0,
      confirmedCorrectCount: stat.confirmed_correct_count || 0,
    }));

    // 4. Fetch attempt feedback (Like/Dislike signals) for this step
    const { data: attemptFeedbackData } = await supabase
      .from("qa_attempt_feedback")
      .select("*")
      .eq("owner_id", ownerId)
      .eq("step_id", body.stepId)
      .order("created_at", { ascending: false })
      .limit(20);

    // Separate into liked and disliked cases for calibration
    const likedCases: unknown[] = [];
    const dislikedCases: unknown[] = [];

    for (const fb of attemptFeedbackData || []) {
      const summary = {
        id: fb.id,
        stepId: fb.step_id,
        category: fb.user_category,
        qaDecision: fb.qa_decision,
        userVote: fb.user_vote,
        userComment: fb.user_comment_short,
        contextSummary: summarizeContext(fb.context_snapshot as Record<string, unknown>),
      };

      if (fb.user_vote === "like") {
        likedCases.push(summary);
      } else {
        dislikedCases.push(summary);
      }
    }

    // Compute aggregate vote counts per category
    const voteCounts: Record<string, { likes: number; dislikes: number }> = {};
    for (const fb of attemptFeedbackData || []) {
      const cat = fb.user_category;
      if (!voteCounts[cat]) {
        voteCounts[cat] = { likes: 0, dislikes: 0 };
      }
      if (fb.user_vote === "like") {
        voteCounts[cat].likes++;
      } else {
        voteCounts[cat].dislikes++;
      }
    }

    const attemptFeedbackSignals = {
      likedCases: likedCases.slice(0, 3), // Top 3 liked
      dislikedCases: dislikedCases.slice(0, 3), // Top 3 disliked
      voteCounts, // { category: { likes, dislikes } }
    };

    console.log("[get-qa-learning-context] Retrieved:", {
      policyRulesCount: policyRules.length,
      similarCasesCount: similarCases.length,
      calibrationStatsCount: calibrationStats.length,
      attemptFeedbackLikes: likedCases.length,
      attemptFeedbackDislikes: dislikedCases.length,
    });

    return new Response(
      JSON.stringify({
        policyRules,
        similarCases,
        calibrationStats,
        attemptFeedbackSignals,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[get-qa-learning-context] Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

/**
 * Create a compact summary of the context snapshot
 */
function summarizeContext(context: Record<string, unknown> | null): string {
  if (!context) return "";
  
  const parts: string[] = [];
  if (context.step_id) parts.push(`Step ${context.step_id}`);
  if (context.aspect_ratio) parts.push(`${context.aspect_ratio}`);
  if (context.has_style_bible) parts.push("styled");
  
  return parts.join(", ");
}
