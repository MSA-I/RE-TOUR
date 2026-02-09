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
  attemptNumber: number;
  imageId: string | null;
  userDecision: "approved" | "rejected";
  userCategory: "furniture_scale" | "extra_furniture" | "structural_change" | "flooring_mismatch" | "other";
  userReasonShort: string;
  qaOriginalStatus: "approved" | "rejected" | "pending" | null;
  qaOriginalReasons: unknown[];
  contextSnapshot: Record<string, unknown>;
  qaWasWrong: boolean;
}

// Minimum similarity threshold for matching rules (simple heuristic)
const RULE_SIMILARITY_THRESHOLD = 0.6;

// Activation threshold for pending rules
const ACTIVATION_THRESHOLD = 3;

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

    console.log("[store-qa-feedback] Processing feedback:", {
      pipelineId: body.pipelineId,
      stepId: body.stepId,
      decision: body.userDecision,
      category: body.userCategory,
      qaWasWrong: body.qaWasWrong,
    });

    // 1. Insert the feedback record
    const { data: feedback, error: feedbackError } = await supabase
      .from("qa_human_feedback")
      .insert({
        project_id: body.projectId,
        pipeline_id: body.pipelineId,
        owner_id: ownerId,
        step_id: body.stepId,
        attempt_number: body.attemptNumber,
        image_id: body.imageId,
        user_decision: body.userDecision,
        user_category: body.userCategory,
        user_reason_short: body.userReasonShort.slice(0, 500),
        qa_original_status: body.qaOriginalStatus,
        qa_original_reasons: body.qaOriginalReasons,
        context_snapshot: body.contextSnapshot,
        qa_was_wrong: body.qaWasWrong,
      })
      .select("id")
      .single();

    if (feedbackError) {
      console.error("[store-qa-feedback] Failed to insert feedback:", feedbackError);
      throw feedbackError;
    }

    // 2. Determine outcome type for calibration
    let outcomeType: "false_reject" | "false_approve" | "confirmed_correct";
    if (body.userDecision === "approved" && body.qaOriginalStatus === "rejected") {
      outcomeType = "false_reject";
    } else if (body.userDecision === "rejected" && body.qaOriginalStatus === "approved") {
      outcomeType = "false_approve";
    } else {
      outcomeType = "confirmed_correct";
    }

    // 3. Create searchable case index entry
    const searchableText = [
      `step:${body.stepId}`,
      `category:${body.userCategory}`,
      `decision:${body.userDecision}`,
      body.userReasonShort,
      body.qaOriginalStatus ? `qa:${body.qaOriginalStatus}` : "",
    ].filter(Boolean).join(" ");

    await supabase
      .from("qa_case_index")
      .insert({
        feedback_id: feedback.id,
        owner_id: ownerId,
        step_id: body.stepId,
        category: body.userCategory,
        searchable_text: searchableText,
        outcome_type: outcomeType,
      });

    // 4. Update calibration stats (upsert)
    const { data: existingStats } = await supabase
      .from("qa_calibration_stats")
      .select("*")
      .eq("owner_id", ownerId)
      .eq("project_id", body.projectId)
      .eq("step_id", body.stepId)
      .eq("category", body.userCategory)
      .maybeSingle();

    if (existingStats) {
      // Update existing stats
      const updates: Record<string, number> = {};
      if (outcomeType === "false_reject") {
        updates.false_reject_count = (existingStats.false_reject_count || 0) + 1;
      } else if (outcomeType === "false_approve") {
        updates.false_approve_count = (existingStats.false_approve_count || 0) + 1;
      } else {
        updates.confirmed_correct_count = (existingStats.confirmed_correct_count || 0) + 1;
      }

      await supabase
        .from("qa_calibration_stats")
        .update({ ...updates, last_updated_at: new Date().toISOString() })
        .eq("id", existingStats.id);
    } else {
      // Insert new stats
      await supabase
        .from("qa_calibration_stats")
        .insert({
          owner_id: ownerId,
          project_id: body.projectId,
          step_id: body.stepId,
          category: body.userCategory,
          false_reject_count: outcomeType === "false_reject" ? 1 : 0,
          false_approve_count: outcomeType === "false_approve" ? 1 : 0,
          confirmed_correct_count: outcomeType === "confirmed_correct" ? 1 : 0,
        });
    }

    // 5. Auto-create or update policy rule if user disagreed with QA
    let policyRuleCreated = false;
    let policyRuleStatus: "pending" | "active" | null = null;

    if (outcomeType !== "confirmed_correct" && body.userReasonShort.length >= 10) {
      // Look for similar existing rules
      const { data: existingRules } = await supabase
        .from("qa_policy_rules")
        .select("*")
        .eq("owner_id", ownerId)
        .eq("step_id", body.stepId)
        .eq("category", body.userCategory)
        .in("rule_status", ["pending", "active"]);

      // Simple text similarity check (could be replaced with embedding similarity)
      const normalizedReason = body.userReasonShort.toLowerCase().trim();
      let matchedRule = null;

      for (const rule of existingRules || []) {
        const normalizedRule = rule.rule_text.toLowerCase().trim();
        const similarity = calculateSimpleSimilarity(normalizedReason, normalizedRule);
        if (similarity >= RULE_SIMILARITY_THRESHOLD) {
          matchedRule = rule;
          break;
        }
      }

      if (matchedRule) {
        // Increment support count
        const newSupportCount = (matchedRule.support_count || 1) + 1;
        const newStatus = newSupportCount >= ACTIVATION_THRESHOLD ? "active" : matchedRule.rule_status;

        await supabase
          .from("qa_policy_rules")
          .update({
            support_count: newSupportCount,
            last_supported_at: new Date().toISOString(),
            rule_status: newStatus,
          })
          .eq("id", matchedRule.id);

        policyRuleCreated = true;
        policyRuleStatus = newStatus as "pending" | "active";

        console.log("[store-qa-feedback] Updated existing rule:", {
          ruleId: matchedRule.id,
          newSupportCount,
          newStatus,
        });
      } else {
        // Create new pending rule
        const { data: newRule } = await supabase
          .from("qa_policy_rules")
          .insert({
            owner_id: ownerId,
            scope_level: "step",
            project_id: body.projectId,
            step_id: body.stepId,
            category: body.userCategory,
            rule_text: body.userReasonShort,
            rule_status: "pending",
            support_count: 1,
            created_from_feedback_id: feedback.id,
          })
          .select("id")
          .single();

        if (newRule) {
          policyRuleCreated = true;
          policyRuleStatus = "pending";

          console.log("[store-qa-feedback] Created new pending rule:", {
            ruleId: newRule.id,
            text: body.userReasonShort.slice(0, 50),
          });
        }
      }
    }

    console.log("[store-qa-feedback] Success:", {
      feedbackId: feedback.id,
      outcomeType,
      policyRuleCreated,
      policyRuleStatus,
    });

    return new Response(
      JSON.stringify({
        success: true,
        feedbackId: feedback.id,
        outcomeType,
        policyRuleCreated,
        policyRuleStatus,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[store-qa-feedback] Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

/**
 * Simple word-based similarity calculation
 * Returns a value between 0 and 1
 */
function calculateSimpleSimilarity(text1: string, text2: string): number {
  const words1 = new Set(text1.split(/\s+/).filter(w => w.length > 3));
  const words2 = new Set(text2.split(/\s+/).filter(w => w.length > 3));

  if (words1.size === 0 || words2.size === 0) return 0;

  let intersection = 0;
  for (const word of words1) {
    if (words2.has(word)) intersection++;
  }

  const union = words1.size + words2.size - intersection;
  return intersection / union;
}
