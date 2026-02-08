/**
 * Human Feedback Memory Module
 * 
 * Builds and formats the `human_feedback_memory` object for injection into
 * AI-QA prompts. This enables the LLM Judge to learn from user behavior.
 * 
 * Sources:
 * - qa_human_feedback: Approve/reject decisions with reasons
 * - qa_attempt_feedback: Like/dislike votes with scores and comments
 * - qa_policy_rules: Extracted patterns (active rules)
 * - qa_calibration_stats: False reject/approve rates
 */

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface HumanFeedbackExample {
  decision: "approved" | "rejected";
  reason_text: string;
  user_signal: "like" | "dislike" | null;
  user_score: number | null;
  output_context: {
    room_name?: string;
    camera_id?: string;
    change_request?: string;
    space_type?: string;
    render_kind?: string;
  };
  created_at: string;
}

export interface CalibrationHints {
  false_reject_rate: number;
  false_approve_rate: number;
  user_strictness: "lenient" | "balanced" | "strict";
  total_decisions: number;
}

export interface HumanFeedbackMemory {
  step_number: number;
  sub_step: string | null;
  recent_examples: HumanFeedbackExample[];
  learned_preferences_summary: string[];
  calibration_hints: CalibrationHints;
  examples_count: number;
}

interface BuildOptions {
  limit?: number;
  subStep?: string;
  includeProjectLevel?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN BUILDER FUNCTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build the human_feedback_memory object from database tables.
 * This should be called before every AI-QA LLM call.
 */
// deno-lint-ignore no-explicit-any
export async function buildHumanFeedbackMemory(
  supabase: any,
  ownerId: string,
  projectId: string,
  stepId: number,
  options: BuildOptions = {}
): Promise<HumanFeedbackMemory> {
  const limit = options.limit ?? 20;
  const subStep = options.subStep ?? null;

  console.log(`[human-feedback-memory] Building memory for step ${stepId}, owner ${ownerId.slice(0, 8)}...`);

  // 1. Fetch recent qa_human_feedback records (approve/reject decisions)
  const { data: humanFeedback } = await supabase
    .from("qa_human_feedback")
    .select(`
      id,
      step_id,
      user_decision,
      user_reason_short,
      user_category,
      context_snapshot,
      created_at
    `)
    .eq("owner_id", ownerId)
    .eq("step_id", stepId)
    .order("created_at", { ascending: false })
    .limit(limit);

  // 2. Fetch qa_attempt_feedback (likes/dislikes with scores)
  const { data: attemptFeedback } = await supabase
    .from("qa_attempt_feedback")
    .select(`
      id,
      step_id,
      user_vote,
      user_category,
      user_comment_short,
      qa_decision,
      context_snapshot,
      created_at
    `)
    .eq("owner_id", ownerId)
    .eq("step_id", stepId)
    .order("created_at", { ascending: false })
    .limit(limit);

  // 3. Fetch calibration stats
  const { data: calibrationStats } = await supabase
    .from("qa_calibration_stats")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("step_id", stepId);

  // 4. Fetch active policy rules
  const { data: policyRules } = await supabase
    .from("qa_policy_rules")
    .select("id, category, rule_text, support_count")
    .eq("owner_id", ownerId)
    .eq("rule_status", "active")
    .or(`step_id.eq.${stepId},step_id.is.null`)
    .order("support_count", { ascending: false })
    .limit(10);

  // Build recent examples from human feedback
  const recentExamples: HumanFeedbackExample[] = [];

  // Add qa_human_feedback records
  for (const fb of humanFeedback || []) {
    const ctx = (fb.context_snapshot || {}) as Record<string, unknown>;
    recentExamples.push({
      decision: fb.user_decision as "approved" | "rejected",
      reason_text: fb.user_reason_short || "",
      user_signal: null,
      user_score: null,
      output_context: {
        room_name: ctx.room_name as string | undefined,
        camera_id: ctx.camera_id as string | undefined,
        change_request: ctx.change_request as string | undefined,
        space_type: ctx.space_type as string | undefined,
        render_kind: ctx.render_kind as string | undefined,
      },
      created_at: fb.created_at,
    });
  }

  // Add qa_attempt_feedback records (likes/dislikes)
  for (const fb of attemptFeedback || []) {
    const ctx = (fb.context_snapshot || {}) as Record<string, unknown>;
    // Map like/dislike to approve/reject for consistency
    const decision = fb.user_vote === "like" ? "approved" : "rejected";
    recentExamples.push({
      decision: decision as "approved" | "rejected",
      reason_text: fb.user_comment_short || `User ${fb.user_vote}d the output`,
      user_signal: fb.user_vote as "like" | "dislike",
      user_score: ctx.user_score as number | null || null,
      output_context: {
        room_name: ctx.room_name as string | undefined,
        camera_id: ctx.camera_id as string | undefined,
        space_type: ctx.space_type as string | undefined,
        render_kind: ctx.render_kind as string | undefined,
      },
      created_at: fb.created_at,
    });
  }

  // Sort by date and deduplicate
  recentExamples.sort((a, b) => 
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  // Build calibration hints
  const calibrationHints = buildCalibrationHints(calibrationStats || [], recentExamples);

  // Extract learned preferences from policy rules and repeated patterns
  const learnedPreferences = extractLearnedPreferences(
    policyRules || [],
    recentExamples
  );

  const memory: HumanFeedbackMemory = {
    step_number: stepId,
    sub_step: subStep,
    recent_examples: recentExamples.slice(0, limit),
    learned_preferences_summary: learnedPreferences,
    calibration_hints: calibrationHints,
    examples_count: recentExamples.length,
  };

  console.log(`[human-feedback-memory] Built memory: ${recentExamples.length} examples, ${learnedPreferences.length} preferences, strictness: ${calibrationHints.user_strictness}`);

  return memory;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CALIBRATION HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

interface CalibrationStat {
  category: string;
  false_reject_count: number;
  false_approve_count: number;
  confirmed_correct_count: number;
}

function buildCalibrationHints(
  stats: CalibrationStat[],
  examples: HumanFeedbackExample[]
): CalibrationHints {
  let totalFalseReject = 0;
  let totalFalseApprove = 0;
  let totalConfirmed = 0;

  for (const stat of stats) {
    totalFalseReject += stat.false_reject_count || 0;
    totalFalseApprove += stat.false_approve_count || 0;
    totalConfirmed += stat.confirmed_correct_count || 0;
  }

  const total = totalFalseReject + totalFalseApprove + totalConfirmed;
  const falseRejectRate = total > 0 ? totalFalseReject / total : 0;
  const falseApproveRate = total > 0 ? totalFalseApprove / total : 0;

  // Determine user strictness from their scoring patterns
  const scores = examples
    .filter(e => e.user_score !== null)
    .map(e => e.user_score as number);
  const avgScore = scores.length > 0 
    ? scores.reduce((a, b) => a + b, 0) / scores.length 
    : 50;

  // Also consider rejection rate
  const rejections = examples.filter(e => e.decision === "rejected").length;
  const rejectionRate = examples.length > 0 ? rejections / examples.length : 0.5;

  let userStrictness: "lenient" | "balanced" | "strict" = "balanced";
  if (avgScore > 65 && rejectionRate < 0.3) {
    userStrictness = "lenient";
  } else if (avgScore < 45 || rejectionRate > 0.6) {
    userStrictness = "strict";
  }

  return {
    false_reject_rate: Math.round(falseRejectRate * 100),
    false_approve_rate: Math.round(falseApproveRate * 100),
    user_strictness: userStrictness,
    total_decisions: examples.length,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PREFERENCE EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════════

interface PolicyRule {
  id: string;
  category: string;
  rule_text: string;
  support_count: number;
}

function extractLearnedPreferences(
  policyRules: PolicyRule[],
  examples: HumanFeedbackExample[]
): string[] {
  const preferences: string[] = [];

  // 1. Add high-confidence policy rules
  for (const rule of policyRules.slice(0, 5)) {
    if (rule.support_count >= 2) {
      preferences.push(`[${rule.category}] ${rule.rule_text}`);
    }
  }

  // 2. Extract patterns from rejection reasons
  const rejectionReasons = examples
    .filter(e => e.decision === "rejected" && e.reason_text)
    .map(e => e.reason_text.toLowerCase());

  const patternCounts: Record<string, number> = {};
  
  // Common rejection pattern keywords
  const patterns = [
    { keyword: "bed", pattern: "bed-related issues" },
    { keyword: "furniture", pattern: "furniture placement issues" },
    { keyword: "wall", pattern: "wall/structural issues" },
    { keyword: "door", pattern: "door/opening issues" },
    { keyword: "window", pattern: "window issues" },
    { keyword: "scale", pattern: "scale/proportion issues" },
    { keyword: "color", pattern: "color/material issues" },
    { keyword: "light", pattern: "lighting issues" },
    { keyword: "seam", pattern: "seam/edge issues" },
    { keyword: "artifact", pattern: "visual artifacts" },
    { keyword: "bathroom", pattern: "bathroom fixture issues" },
    { keyword: "kitchen", pattern: "kitchen element issues" },
  ];

  for (const reason of rejectionReasons) {
    for (const { keyword, pattern } of patterns) {
      if (reason.includes(keyword)) {
        patternCounts[pattern] = (patternCounts[pattern] || 0) + 1;
      }
    }
  }

  // Add patterns that appear 2+ times
  for (const [pattern, count] of Object.entries(patternCounts)) {
    if (count >= 2 && preferences.length < 8) {
      preferences.push(`User frequently rejects due to ${pattern} (${count}x)`);
    }
  }

  // 3. Extract approval patterns (what the user likes)
  const approvalReasons = examples
    .filter(e => e.decision === "approved" && e.reason_text && e.reason_text.length > 5)
    .map(e => e.reason_text);

  if (approvalReasons.length >= 3) {
    const sample = approvalReasons.slice(0, 2).join("; ");
    if (sample.length > 10 && preferences.length < 10) {
      preferences.push(`User approval patterns: "${sample.slice(0, 100)}"`);
    }
  }

  return preferences;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROMPT FORMATTING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Format the human feedback memory for injection into QA prompts.
 * Returns a formatted string ready for prompt injection.
 */
export function formatHumanFeedbackForPrompt(memory: HumanFeedbackMemory): string {
  if (memory.examples_count === 0 && memory.learned_preferences_summary.length === 0) {
    return ""; // No feedback to inject
  }

  const sections: string[] = [];

  // Header with hard rules precedence guard
  sections.push(`
═══════════════════════════════════════════════════════════════════
HUMAN FEEDBACK MEMORY (Use as soft preferences, NOT hard rules)
═══════════════════════════════════════════════════════════════════

CRITICAL: Human feedback influences BORDERLINE decisions only.
HARD RULES ALWAYS TAKE PRECEDENCE over human preferences:
- Layout fidelity (walls, doors, windows must match floor plan)
- Camera intent (render must show specified camera angle)
- Room connectivity (openings only to adjacent rooms)
- Room type consistency (no invented rooms or structural elements)

If human feedback contradicts hard rules, HARD RULES WIN.
═══════════════════════════════════════════════════════════════════`);

  // Calibration hint
  const { calibration_hints: cal } = memory;
  if (cal.total_decisions > 0) {
    let calibrationNote = "";
    if (cal.user_strictness === "strict") {
      calibrationNote = `USER IS STRICT: They frequently reject outputs (avg rejection rate high). Apply tighter constraints on borderline cases.`;
    } else if (cal.user_strictness === "lenient") {
      calibrationNote = `USER IS LENIENT: They usually approve outputs. Only reject for clear violations, be tolerant on minor issues.`;
    } else {
      calibrationNote = `USER IS BALANCED: Apply standard QA thresholds.`;
    }

    if (cal.false_reject_rate > 30) {
      calibrationNote += ` WARNING: ${cal.false_reject_rate}% of past rejections were overturned by user (QA too strict).`;
    }
    if (cal.false_approve_rate > 30) {
      calibrationNote += ` WARNING: ${cal.false_approve_rate}% of past approvals were rejected by user (QA too lenient).`;
    }

    sections.push(`\n=== CALIBRATION ===\n${calibrationNote}`);
  }

  // Learned preferences
  if (memory.learned_preferences_summary.length > 0) {
    sections.push(`\n=== LEARNED USER PREFERENCES ===`);
    memory.learned_preferences_summary.forEach((pref, i) => {
      sections.push(`${i + 1}. ${pref}`);
    });
  }

  // Recent examples (few-shot learning)
  const significantExamples = memory.recent_examples.filter(e => 
    e.reason_text && e.reason_text.length > 5
  ).slice(0, 5);

  if (significantExamples.length > 0) {
    sections.push(`\n=== RECENT USER DECISIONS (few-shot examples) ===`);
    significantExamples.forEach((ex, i) => {
      const context = ex.output_context.space_type || ex.output_context.room_name || "";
      const signal = ex.user_signal ? ` [${ex.user_signal}]` : "";
      const score = ex.user_score !== null ? ` (score: ${ex.user_score}/100)` : "";
      sections.push(`${i + 1}. ${ex.decision.toUpperCase()}${signal}${score}: "${ex.reason_text.slice(0, 100)}"${context ? ` [${context}]` : ""}`);
    });
  }

  sections.push(`\n═══════════════════════════════════════════════════════════════════`);

  return sections.join("\n");
}

/**
 * Create a compact summary for Langfuse metadata.
 */
export function formatCompactSummary(memory: HumanFeedbackMemory): string {
  return JSON.stringify({
    step: memory.step_number,
    examples: memory.examples_count,
    preferences: memory.learned_preferences_summary.length,
    strictness: memory.calibration_hints.user_strictness,
    false_reject_rate: memory.calibration_hints.false_reject_rate,
  });
}
