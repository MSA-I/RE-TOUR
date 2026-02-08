/**
 * QA Judge Persistence Module
 * 
 * This module handles persisting QA judge results to the qa_judge_results table.
 * It provides a unified interface for storing all AI-QA evaluations from all steps,
 * ensuring every QA run is recorded for UI display and analytics.
 * 
 * Database Table: qa_judge_results
 * - One row per QA attempt
 * - Linked to pipeline_id, step_number, output_id
 * - Contains pass/fail, score, reasons, and full result JSON
 */

import { getABBucket } from "./langfuse-constants.ts";

// ============= TYPES =============

export interface QAJudgeResult {
  pipeline_id: string;
  project_id: string;
  owner_id: string;
  step_number: number;
  sub_step?: string | null;
  output_id?: string | null;
  attempt_index: number;
  pass: boolean;
  score: number | null;
  confidence: number | null;
  reasons: string[];
  violated_rules: string[];
  full_result: Record<string, unknown>;
  judge_model: string;
  prompt_name?: string | null;
  prompt_version?: string | null;
  ab_bucket?: string | null;
  processing_time_ms?: number | null;
}

export interface PersistQAResultParams {
  // deno-lint-ignore no-explicit-any
  supabase: any; // Accept any Supabase client version
  pipeline_id: string;
  project_id: string;
  owner_id: string;
  step_number: number;
  sub_step?: string | null;
  output_id?: string | null;
  attempt_index: number;
  pass: boolean;
  score: number | null;
  confidence?: number | null;
  reasons: string[];
  violated_rules?: string[];
  // deno-lint-ignore no-explicit-any
  full_result: any;
  judge_model: string;
  prompt_name?: string | null;
  prompt_version?: string | null;
  processing_time_ms?: number | null;
}

// ============= CONSTANTS =============

// Pass threshold: score >= 0.85 (85) is considered passing
export const QA_PASS_THRESHOLD = 85;

// Score ranges for decision logic
export const QA_SCORE_RANGES = {
  PASS: 85,        // >= 85 = PASS
  RETRY_MIN: 60,   // 60-84 = auto-retry eligible
  NEEDS_HUMAN: 0,  // < 60 = needs human review
} as const;

// ============= MAIN PERSISTENCE FUNCTION =============

/**
 * Persist a QA judge result to the database.
 * This is the primary function for storing AI-QA evaluations.
 * 
 * @returns The inserted row ID or null on failure
 */
export async function persistQAJudgeResult(
  params: PersistQAResultParams
): Promise<{ success: boolean; id?: string; error?: string }> {
  const {
    supabase,
    pipeline_id,
    project_id,
    owner_id,
    step_number,
    sub_step,
    output_id,
    attempt_index,
    pass,
    score,
    confidence,
    reasons,
    violated_rules = [],
    full_result,
    judge_model,
    prompt_name,
    prompt_version,
    processing_time_ms,
  } = params;

  // Compute deterministic A/B bucket from pipeline_id
  const ab_bucket = getABBucket(pipeline_id, "qa_judge");

  const row: QAJudgeResult = {
    pipeline_id,
    project_id,
    owner_id,
    step_number,
    sub_step: sub_step || null,
    output_id: output_id || null,
    attempt_index,
    pass,
    score,
    confidence: confidence ?? null,
    reasons: reasons || [],
    violated_rules: violated_rules || [],
    full_result: full_result || {},
    judge_model,
    prompt_name: prompt_name || null,
    prompt_version: prompt_version || null,
    ab_bucket,
    processing_time_ms: processing_time_ms ?? null,
  };

  try {
    const { data, error } = await supabase
      .from("qa_judge_results")
      .insert(row)
      .select("id")
      .single();

    if (error) {
      console.error(`[qa-judge-persist] Insert error for pipeline=${pipeline_id}, step=${step_number}:`, error.message);
      return { success: false, error: error.message };
    }

    console.log(`[qa-judge-persist] Persisted QA result: pipeline=${pipeline_id}, step=${step_number}, attempt=${attempt_index}, pass=${pass}, score=${score}, id=${data?.id}`);
    
    return { success: true, id: data?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[qa-judge-persist] Exception:`, message);
    return { success: false, error: message };
  }
}

/**
 * Persist a failed QA result when the QA call itself fails (network error, parse error, etc.)
 * This ensures we never have silent failures - every attempt is recorded.
 */
export async function persistQAFailure(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  pipeline_id: string,
  project_id: string,
  owner_id: string,
  step_number: number,
  attempt_index: number,
  error_message: string,
  judge_model: string,
  sub_step?: string | null,
  output_id?: string | null,
  processing_time_ms?: number | null
): Promise<{ success: boolean; id?: string; error?: string }> {
  return persistQAJudgeResult({
    supabase,
    pipeline_id,
    project_id,
    owner_id,
    step_number,
    sub_step,
    output_id,
    attempt_index,
    pass: false,
    score: 0,
    confidence: 0,
    reasons: ["QA_CALL_FAILED"],
    violated_rules: ["SYSTEM_ERROR"],
    full_result: {
      error: true,
      message: error_message,
      failed_at: new Date().toISOString(),
    },
    judge_model,
    prompt_name: "error",
    prompt_version: null,
    processing_time_ms,
  });
}

// ============= HELPER FUNCTIONS =============

/**
 * Extract reasons from a QA result object.
 * Handles various formats from different QA prompts.
 */
export function extractReasonsFromResult(qaResult: Record<string, unknown>): string[] {
  const reasons: string[] = [];

  // From failure_categories
  if (Array.isArray(qaResult.failure_categories)) {
    reasons.push(...qaResult.failure_categories.filter((r): r is string => typeof r === "string"));
  }

  // From issues array
  if (Array.isArray(qaResult.issues)) {
    for (const issue of qaResult.issues) {
      if (typeof issue === "object" && issue !== null) {
        const desc = (issue as Record<string, unknown>).description;
        if (typeof desc === "string") {
          reasons.push(desc);
        }
      }
    }
  }

  // From approval_reasons
  if (qaResult.pass && Array.isArray(qaResult.approval_reasons)) {
    reasons.push(...qaResult.approval_reasons.filter((r): r is string => typeof r === "string"));
  }

  // From rejection_explanation
  if (!qaResult.pass && typeof qaResult.rejection_explanation === "string" && qaResult.rejection_explanation) {
    reasons.push(qaResult.rejection_explanation);
  }

  // From reasons array (Step 1 new format)
  if (Array.isArray(qaResult.reasons)) {
    for (const r of qaResult.reasons) {
      if (typeof r === "object" && r !== null) {
        const shortReason = (r as Record<string, unknown>).short_reason;
        const category = (r as Record<string, unknown>).category;
        if (typeof shortReason === "string") {
          reasons.push(category ? `[${category}] ${shortReason}` : shortReason);
        }
      } else if (typeof r === "string") {
        reasons.push(r);
      }
    }
  }

  // From reason field (simple format)
  if (typeof qaResult.reason === "string" && qaResult.reason) {
    reasons.push(qaResult.reason);
  }

  // Deduplicate and limit
  return [...new Set(reasons)].slice(0, 10);
}

/**
 * Extract violated rules from a QA result object.
 */
export function extractViolatedRulesFromResult(qaResult: Record<string, unknown>): string[] {
  const rules: string[] = [];

  // From issues array categories
  if (Array.isArray(qaResult.issues)) {
    for (const issue of qaResult.issues) {
      if (typeof issue === "object" && issue !== null) {
        const category = (issue as Record<string, unknown>).category || (issue as Record<string, unknown>).type;
        if (typeof category === "string") {
          rules.push(category);
        }
      }
    }
  }

  // From failure_categories
  if (Array.isArray(qaResult.failure_categories)) {
    rules.push(...qaResult.failure_categories.filter((r): r is string => typeof r === "string"));
  }

  // From structural checks
  if (qaResult.room_type_violation) {
    rules.push("room_type_violation");
  }
  if (qaResult.structural_violation) {
    rules.push("structural_violation");
  }

  // Deduplicate
  return [...new Set(rules)];
}

/**
 * Convert a normalized score (0-1 or 0-100) to the 0-100 range.
 */
export function normalizeScore(score: number | null | undefined): number | null {
  if (score === null || score === undefined) {
    return null;
  }
  // If score is between 0 and 1, multiply by 100
  if (score >= 0 && score <= 1) {
    return Math.round(score * 100);
  }
  // If already 0-100, use as-is
  return Math.round(Math.min(100, Math.max(0, score)));
}

/**
 * Determine pass/fail based on score and threshold.
 */
export function scoreToPass(score: number | null | undefined): boolean {
  if (score === null || score === undefined) {
    return false;
  }
  const normalized = normalizeScore(score);
  return normalized !== null && normalized >= QA_PASS_THRESHOLD;
}

/**
 * Determine recommended action based on score.
 */
export function scoreToAction(score: number | null | undefined): "approve" | "retry" | "needs_human" {
  if (score === null || score === undefined) {
    return "needs_human";
  }
  const normalized = normalizeScore(score) ?? 0;
  
  if (normalized >= QA_SCORE_RANGES.PASS) {
    return "approve";
  }
  if (normalized >= QA_SCORE_RANGES.RETRY_MIN) {
    return "retry";
  }
  return "needs_human";
}

/**
 * Build a QA generation name for Langfuse tracing.
 */
export function getQAGenerationName(stepNumber: number, subStep?: string | null): string {
  if (subStep) {
    return `qa_judge_step_${stepNumber}_${subStep.replace(".", "_")}`;
  }
  return `qa_judge_step_${stepNumber}`;
}
