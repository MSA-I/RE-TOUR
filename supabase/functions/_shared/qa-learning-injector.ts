/**
 * QA Learning Injector
 * 
 * Retrieves learning context (policy rules, similar cases, calibration stats)
 * and formats them for injection into QA prompts.
 * 
 * This enables the QA system to "learn" from user feedback over time.
 */

interface QAPolicyRule {
  id: string;
  scope_level: "global" | "project" | "step";
  step_id: number | null;
  category: string;
  rule_text: string;
  support_count: number;
}

interface QASimilarCase {
  step_id: number;
  category: string;
  user_decision: "approved" | "rejected";
  user_reason_short: string;
  qa_original_status: string;
  outcome_type: "false_reject" | "false_approve" | "confirmed_correct";
}

interface QACalibrationStats {
  step_id: number;
  category: string;
  false_reject_count: number;
  false_approve_count: number;
  confirmed_correct_count: number;
}

interface QALearningContext {
  policyRules: QAPolicyRule[];
  similarCases: QASimilarCase[];
  calibrationStats: QACalibrationStats[];
}

/**
 * Fetch learning context from database
 */
export async function fetchLearningContext(
  supabase: any,
  projectId: string,
  stepId: number,
  ownerId: string
): Promise<QALearningContext> {
  // Fetch active policy rules for this step
  const { data: policyRules } = await supabase
    .from("qa_policy_rules")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("rule_status", "active")
    .or(`step_id.eq.${stepId},step_id.is.null`)
    .order("support_count", { ascending: false })
    .limit(10);

  // Fetch similar past cases for few-shot learning
  const { data: caseIndex } = await supabase
    .from("qa_case_index")
    .select("feedback_id, step_id, category, outcome_type, searchable_text")
    .eq("owner_id", ownerId)
    .eq("step_id", stepId)
    .order("created_at", { ascending: false })
    .limit(5);

  // Fetch the actual feedback for similar cases
  const feedbackIds = (caseIndex || []).map((c: any) => c.feedback_id);
  const { data: feedbacks } = feedbackIds.length > 0
    ? await supabase
        .from("qa_human_feedback")
        .select("*")
        .in("id", feedbackIds)
    : { data: [] };

  const similarCases: QASimilarCase[] = (caseIndex || []).map((c: any) => {
    const feedback = (feedbacks || []).find((f: any) => f.id === c.feedback_id);
    return {
      step_id: c.step_id,
      category: c.category,
      user_decision: feedback?.user_decision || "approved",
      user_reason_short: feedback?.user_reason_short || "",
      qa_original_status: feedback?.qa_original_status || "unknown",
      outcome_type: c.outcome_type,
    };
  });

  // Fetch calibration stats for this step
  const { data: calibrationStats } = await supabase
    .from("qa_calibration_stats")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("project_id", projectId)
    .eq("step_id", stepId);

  return {
    policyRules: policyRules || [],
    similarCases,
    calibrationStats: calibrationStats || [],
  };
}

/**
 * Format learning context for injection into QA prompt
 */
export function formatLearningContextForPrompt(context: QALearningContext): string {
  const sections: string[] = [];

  // Policy rules section
  if (context.policyRules.length > 0) {
    sections.push("=== LEARNED POLICY RULES (from user feedback) ===");
    context.policyRules.forEach((rule, i) => {
      sections.push(`${i + 1}. [${rule.category}] ${rule.rule_text} (confirmed ${rule.support_count}x)`);
    });
  }

  // Similar cases section (few-shot examples)
  if (context.similarCases.length > 0) {
    sections.push("\n=== SIMILAR PAST DECISIONS ===");
    context.similarCases.forEach((c, i) => {
      const outcome = c.outcome_type === "false_reject"
        ? "USER_APPROVED (QA was too strict)"
        : c.outcome_type === "false_approve"
        ? "USER_REJECTED (QA missed issue)"
        : "CONFIRMED_CORRECT";
      sections.push(`${i + 1}. [${c.category}] ${c.user_reason_short} → ${outcome}`);
    });
  }

  // Calibration hints section
  if (context.calibrationStats.length > 0) {
    sections.push("\n=== CALIBRATION HINTS ===");
    context.calibrationStats.forEach((stat) => {
      const total = stat.false_reject_count + stat.false_approve_count + stat.confirmed_correct_count;
      if (total > 0) {
        const falseRejectRate = ((stat.false_reject_count / total) * 100).toFixed(0);
        const falseApproveRate = ((stat.false_approve_count / total) * 100).toFixed(0);
        if (parseInt(falseRejectRate) > 30) {
          sections.push(`- ${stat.category}: You've been too strict (${falseRejectRate}% false rejections). Be more lenient.`);
        } else if (parseInt(falseApproveRate) > 30) {
          sections.push(`- ${stat.category}: You've been too lenient (${falseApproveRate}% false approvals). Be stricter.`);
        }
      }
    });
  }

  if (sections.length === 0) {
    return ""; // No learning context available
  }

  return `\n${sections.join("\n")}\n`;
}

/**
 * Build retry prompt delta from QA result and learning context
 * This is the "Auto-Fix Prompt Builder" logic
 */
export function buildAutoFixPromptDelta(
  qaResult: {
    issues?: Array<{ type: string; description: string; location_hint?: string }>;
    corrected_instructions?: string;
    recommended_action?: string;
  },
  learningContext: QALearningContext,
  currentAttempt: number
): {
  promptAdjustments: string[];
  settingsAdjustments: Record<string, unknown>;
  changes: string[];
} {
  const promptAdjustments: string[] = [];
  const settingsAdjustments: Record<string, unknown> = {};
  const changes: string[] = [];

  // 1. Apply AI's correction instructions
  if (qaResult.corrected_instructions) {
    promptAdjustments.push(`CRITICAL FIX REQUIRED: ${qaResult.corrected_instructions}`);
    changes.push(`Applied QA fix: ${qaResult.corrected_instructions.slice(0, 50)}...`);
  }

  // 2. Apply issue-specific fixes
  for (const issue of qaResult.issues || []) {
    switch (issue.type) {
      case "hallucination":
        promptAdjustments.push("STRICT: Do NOT add any furniture or objects not present in the source image.");
        changes.push("Added anti-hallucination constraint");
        break;
      case "duplicate":
        promptAdjustments.push("STRICT: Each furniture item must appear ONLY ONCE. No duplicates.");
        changes.push("Added anti-duplication constraint");
        break;
      case "distortion":
        promptAdjustments.push("STRICT: Maintain perfect geometry. No warping, melting, or perspective errors.");
        changes.push("Added geometry preservation constraint");
        break;
      case "seam":
        promptAdjustments.push("STRICT: Left and right edges must connect seamlessly. Ensure perfect 360° wrap.");
        changes.push("Added seam quality constraint");
        break;
      case "geometry":
        promptAdjustments.push("STRICT: Wall lines, floor patterns, and ceiling must be perfectly aligned.");
        changes.push("Added geometry alignment constraint");
        break;
    }
  }

  // 3. Apply policy rules from learning
  for (const rule of learningContext.policyRules.slice(0, 3)) {
    promptAdjustments.push(`USER PREFERENCE: ${rule.rule_text}`);
    changes.push(`Applied learned rule: ${rule.category}`);
  }

  // 4. Progressive constraint tightening with each attempt
  if (currentAttempt >= 3) {
    settingsAdjustments.temperature = 0.3;
    settingsAdjustments.guidance_scale = 12;
    changes.push("Reduced creativity (attempt 3+)");
  }
  if (currentAttempt >= 4) {
    promptAdjustments.push("ULTRA-STRICT MODE: Prioritize accuracy over creativity. Match source exactly.");
    changes.push("Enabled ultra-strict mode (attempt 4+)");
  }

  // 5. New seed for each attempt
  settingsAdjustments.seed = Math.floor(Math.random() * 2147483647);
  changes.push(`New seed: ${settingsAdjustments.seed}`);

  return { promptAdjustments, settingsAdjustments, changes };
}
