import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface RequestBody {
  projectId: string;
  pipelineId: string;
  stepId: number;
  attemptNumber: number;
  imageId: string | null;
  qaDecision: "approved" | "rejected";
  qaReasons: unknown[];
  userVote: "like" | "dislike";
  userCategory:
    | "furniture_scale"
    | "extra_furniture"
    | "structural_change"
    | "flooring_mismatch"
    | "other";
  userCommentShort: string;
  contextSnapshot: Record<string, unknown>;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Validate auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(
      token
    );
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ownerId = claimsData.claims.sub as string;
    const body = (await req.json()) as RequestBody;

    console.log("[store-qa-attempt-feedback] Processing:", {
      pipelineId: body.pipelineId,
      stepId: body.stepId,
      attemptNumber: body.attemptNumber,
      vote: body.userVote,
      category: body.userCategory,
    });

    // Check if feedback already exists (for upsert)
    const { data: existing } = await supabase
      .from("qa_attempt_feedback")
      .select("id")
      .eq("pipeline_id", body.pipelineId)
      .eq("step_id", body.stepId)
      .eq("attempt_number", body.attemptNumber)
      .eq("image_id", body.imageId)
      .maybeSingle();

    let feedbackId: string;

    if (existing) {
      // Update existing feedback
      const { data: updated, error: updateError } = await supabase
        .from("qa_attempt_feedback")
        .update({
          user_vote: body.userVote,
          user_category: body.userCategory,
          user_comment_short: body.userCommentShort?.slice(0, 200) || null,
          qa_reasons: body.qaReasons,
          context_snapshot: body.contextSnapshot,
        })
        .eq("id", existing.id)
        .select("id")
        .single();

      if (updateError) throw updateError;
      feedbackId = updated.id;

      console.log("[store-qa-attempt-feedback] Updated existing:", feedbackId);
    } else {
      // Insert new feedback
      const { data: inserted, error: insertError } = await supabase
        .from("qa_attempt_feedback")
        .insert({
          project_id: body.projectId,
          pipeline_id: body.pipelineId,
          owner_id: ownerId,
          step_id: body.stepId,
          attempt_number: body.attemptNumber,
          image_id: body.imageId,
          qa_decision: body.qaDecision,
          qa_reasons: body.qaReasons,
          user_vote: body.userVote,
          user_category: body.userCategory,
          user_comment_short: body.userCommentShort?.slice(0, 200) || null,
          context_snapshot: body.contextSnapshot,
        })
        .select("id")
        .single();

      if (insertError) throw insertError;
      feedbackId = inserted.id;

      console.log("[store-qa-attempt-feedback] Inserted new:", feedbackId);
    }

    // Update calibration stats based on the vote
    // Like on rejected = user agrees QA was right to reject = confirmed_correct
    // Dislike on rejected = user thinks QA was wrong to reject = false_reject
    // Like on approved = user agrees QA was right to approve = confirmed_correct
    // Dislike on approved = user thinks QA was wrong to approve = false_approve

    let calibrationType: "false_reject" | "false_approve" | "confirmed_correct";
    if (body.userVote === "like") {
      calibrationType = "confirmed_correct";
    } else {
      // Dislike
      calibrationType =
        body.qaDecision === "rejected" ? "false_reject" : "false_approve";
    }

    // Extract user score from context if available
    const userScore = (body.contextSnapshot?.user_score as number) || null;

    // Upsert calibration stats with score-based weighting
    const { data: existingStats } = await supabase
      .from("qa_calibration_stats")
      .select("*")
      .eq("owner_id", ownerId)
      .eq("project_id", body.projectId)
      .eq("step_id", body.stepId)
      .eq("category", body.userCategory)
      .maybeSingle();

    if (existingStats) {
      const updates: Record<string, number> = {};
      
      // Weight the update based on user score if available
      // Low scores (< 40) = stronger signal, High scores (> 80) = weaker signal for false_approve
      const weight = userScore !== null 
        ? (calibrationType === "false_approve" && userScore < 40 ? 2 : 1)
        : 1;
      
      if (calibrationType === "false_reject") {
        updates.false_reject_count = (existingStats.false_reject_count || 0) + weight;
      } else if (calibrationType === "false_approve") {
        updates.false_approve_count = (existingStats.false_approve_count || 0) + weight;
      } else {
        updates.confirmed_correct_count =
          (existingStats.confirmed_correct_count || 0) + weight;
      }

      await supabase
        .from("qa_calibration_stats")
        .update({ ...updates, last_updated_at: new Date().toISOString() })
        .eq("id", existingStats.id);
    } else {
      // Weight initial counts based on user score
      const weight = userScore !== null && userScore < 40 ? 2 : 1;
      
      await supabase.from("qa_calibration_stats").insert({
        owner_id: ownerId,
        project_id: body.projectId,
        step_id: body.stepId,
        category: body.userCategory,
        false_reject_count: calibrationType === "false_reject" ? weight : 0,
        false_approve_count: calibrationType === "false_approve" ? weight : 0,
        confirmed_correct_count: calibrationType === "confirmed_correct" ? weight : 0,
      });
    }

    console.log("[store-qa-attempt-feedback] Success:", {
      feedbackId,
      calibrationType,
      userScore,
    });

    return new Response(
      JSON.stringify({
        success: true,
        feedbackId,
        calibrationType,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[store-qa-attempt-feedback] Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
