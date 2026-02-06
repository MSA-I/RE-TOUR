/**
 * AI-QA RESULT SCHEMA
 * 
 * This file defines the MANDATORY contract for all AI-QA checks.
 * Every QA check MUST return a structured result matching this schema.
 * 
 * DO NOT return simple PASS/FAIL booleans.
 * DO NOT skip any required fields.
 */

import type { QAReasonCode, RetrySuggestionType, Severity } from "./pipeline-schemas.ts";

// ============================================================================
// STRUCTURED QA RESULT SCHEMA
// ============================================================================

export interface QAReasonDetail {
  code: QAReasonCode;
  description: string;
}

export interface QAEvidence {
  observation: string;
  location?: string;
  confidence?: number;
}

export interface QARetrySuggestion {
  type: RetrySuggestionType;
  instruction: string;
  priority?: number;
}

export interface StructuredQAResult {
  /** PASS or FAIL status */
  status: "PASS" | "FAIL";
  
  /** One clear sentence explaining the primary reason (required for FAIL) */
  reason_short: string;
  
  /** Detailed reasons with codes (required for FAIL, at least one) */
  reasons: QAReasonDetail[];
  
  /** Factual observations/evidence (required for FAIL) */
  evidence: QAEvidence[];
  
  /** Severity level */
  severity: Severity;
  
  /** What should change in the next attempt */
  retry_suggestion: QARetrySuggestion;
  
  /** AI confidence in this QA decision (0-1) */
  confidence_score: number;
  
  /** Additional context for debugging */
  debug_context?: {
    model_used?: string;
    processing_time_ms?: number;
    input_hash?: string;
    attempt_number?: number;
  };
}

// ============================================================================
// STEP ATTEMPT TRACKING
// ============================================================================

export interface StepAttemptRecord {
  attempt_number: number;
  status: "running" | "qa_pass" | "qa_fail" | "blocked_for_human";
  qa_result: StructuredQAResult | null;
  retry_delta: {
    changes_made: string[];
    suggestion_applied: QARetrySuggestion | null;
  } | null;
  output_upload_id: string | null;
  created_at: string;
  completed_at: string | null;
  processing_time_ms: number | null;
}

export interface StepRetryState {
  step_id: string;
  step_number: number;
  auto_retry_enabled: boolean;
  attempt_count: number;
  max_attempts: number;
  current_status: "pending" | "running" | "qa_pass" | "qa_fail" | "blocked_for_human";
  last_qa_result: StructuredQAResult | null;
  last_retry_delta: {
    changes_made: string[];
    suggestion_applied: QARetrySuggestion | null;
  } | null;
  attempts: StepAttemptRecord[];
  created_at: string;
  updated_at: string;
}

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

/**
 * Validate a QA result matches the required schema
 */
export function validateQAResult(result: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!result || typeof result !== "object") {
    errors.push("QA result must be an object");
    return { valid: false, errors };
  }
  
  const r = result as Record<string, unknown>;
  
  // Required fields
  if (!r.status || (r.status !== "PASS" && r.status !== "FAIL")) {
    errors.push("status must be 'PASS' or 'FAIL'");
  }
  
  if (typeof r.reason_short !== "string" || r.reason_short.length === 0) {
    errors.push("reason_short must be a non-empty string");
  }
  
  if (!Array.isArray(r.reasons)) {
    errors.push("reasons must be an array");
  } else if (r.status === "FAIL" && r.reasons.length === 0) {
    errors.push("reasons must have at least one entry for FAIL status");
  }
  
  if (!Array.isArray(r.evidence)) {
    errors.push("evidence must be an array");
  }
  
  if (!r.severity || !["low", "medium", "high", "critical"].includes(r.severity as string)) {
    errors.push("severity must be 'low', 'medium', 'high', or 'critical'");
  }
  
  if (!r.retry_suggestion || typeof r.retry_suggestion !== "object") {
    errors.push("retry_suggestion must be an object");
  } else {
    const suggestion = r.retry_suggestion as Record<string, unknown>;
    if (!suggestion.type || !["prompt_delta", "settings_delta", "seed_change", "input_change", "manual_review"].includes(suggestion.type as string)) {
      errors.push("retry_suggestion.type must be a valid type");
    }
    if (typeof suggestion.instruction !== "string") {
      errors.push("retry_suggestion.instruction must be a string");
    }
  }
  
  if (typeof r.confidence_score !== "number" || r.confidence_score < 0 || r.confidence_score > 1) {
    errors.push("confidence_score must be a number between 0 and 1");
  }
  
  return { valid: errors.length === 0, errors };
}

/**
 * Create a PASS result with minimal required fields
 */
export function createPassResult(
  reason: string = "All checks passed",
  confidence: number = 0.95
): StructuredQAResult {
  return {
    status: "PASS",
    reason_short: reason,
    reasons: [],
    evidence: [],
    severity: "low",
    retry_suggestion: {
      type: "prompt_delta",
      instruction: "No changes needed"
    },
    confidence_score: confidence
  };
}

/**
 * Create a FAIL result with all required fields
 */
export function createFailResult(
  reason_short: string,
  reasons: QAReasonDetail[],
  evidence: QAEvidence[],
  severity: Severity,
  retry_suggestion: QARetrySuggestion,
  confidence: number = 0.85
): StructuredQAResult {
  return {
    status: "FAIL",
    reason_short,
    reasons,
    evidence,
    severity,
    retry_suggestion,
    confidence_score: confidence
  };
}

// ============================================================================
// RETRY ENGINE RULES
// ============================================================================

export const RETRY_ENGINE_RULES = {
  /** Default max attempts per step */
  DEFAULT_MAX_ATTEMPTS_PER_STEP: 5,
  
  /** Global safety cap */
  MAX_TOTAL_ATTEMPTS_PER_RUN: 20,
  
  /** Base delay in seconds between retries */
  BASE_RETRY_DELAY_SECONDS: 2,
  
  /** Maximum delay between retries */
  MAX_RETRY_DELAY_SECONDS: 30,
  
  /** Severities that block auto-retry */
  BLOCK_AUTO_RETRY_SEVERITIES: ["critical"] as Severity[],
  
  /** Suggestion types that block auto-retry */
  BLOCK_AUTO_RETRY_SUGGESTIONS: ["manual_review"] as RetrySuggestionType[],
  
  /** Minimum confidence for auto-retry eligibility */
  MIN_CONFIDENCE_FOR_AUTO_RETRY: 0.3
};

/**
 * Check if auto-retry is allowed based on current state
 */
export function isAutoRetryEligible(
  state: StepRetryState,
  qaResult: StructuredQAResult
): { eligible: boolean; reason: string } {
  // Check if auto-retry is enabled
  if (!state.auto_retry_enabled) {
    return { eligible: false, reason: "Auto-retry is disabled for this step" };
  }
  
  // Check attempt count
  if (state.attempt_count >= state.max_attempts) {
    return { eligible: false, reason: `Max attempts reached (${state.attempt_count}/${state.max_attempts})` };
  }
  
  // Check severity
  if (RETRY_ENGINE_RULES.BLOCK_AUTO_RETRY_SEVERITIES.includes(qaResult.severity)) {
    return { eligible: false, reason: `Severity '${qaResult.severity}' requires manual review` };
  }
  
  // Check suggestion type
  if (RETRY_ENGINE_RULES.BLOCK_AUTO_RETRY_SUGGESTIONS.includes(qaResult.retry_suggestion.type)) {
    return { eligible: false, reason: `Suggestion type '${qaResult.retry_suggestion.type}' requires manual review` };
  }
  
  // Check confidence
  if (qaResult.confidence_score < RETRY_ENGINE_RULES.MIN_CONFIDENCE_FOR_AUTO_RETRY) {
    return { eligible: false, reason: `Low confidence (${qaResult.confidence_score}) requires manual review` };
  }
  
  return { eligible: true, reason: "Eligible for auto-retry" };
}

/**
 * Calculate retry delay with exponential backoff
 */
export function calculateRetryDelay(attemptNumber: number): number {
  const delay = RETRY_ENGINE_RULES.BASE_RETRY_DELAY_SECONDS * Math.pow(2, attemptNumber - 1);
  return Math.min(delay, RETRY_ENGINE_RULES.MAX_RETRY_DELAY_SECONDS);
}

// ============================================================================
// QA PROMPT BUILDER
// ============================================================================

/**
 * Build the QA system prompt that enforces structured output
 */
export function buildQASystemPrompt(stepDescription: string): string {
  return `You are a strict quality assurance AI for architectural visualization.

TASK: Evaluate the generated output for ${stepDescription}.

OUTPUT CONTRACT (MANDATORY):
You MUST return a JSON object with this EXACT structure. No exceptions.

{
  "status": "PASS" | "FAIL",
  "reason_short": "One clear sentence explaining the primary finding",
  "reasons": [
    {
      "code": "ENUM_CODE",
      "description": "Detailed explanation"
    }
  ],
  "evidence": [
    {
      "observation": "Specific factual observation",
      "location": "Where in the image (optional)",
      "confidence": 0.95
    }
  ],
  "severity": "low" | "medium" | "high" | "critical",
  "retry_suggestion": {
    "type": "prompt_delta" | "settings_delta" | "seed_change" | "input_change" | "manual_review",
    "instruction": "What must change in the next attempt",
    "priority": 1
  },
  "confidence_score": 0.85
}

VALID REASON CODES:
- INVALID_INPUT: Input image is corrupt, wrong format, or unusable
- MISSING_SPACE: Expected room/space not detected
- DUPLICATED_OBJECTS: Same furniture/object appears multiple times incorrectly
- GEOMETRY_DISTORTION: Walls, floors, or ceilings are distorted
- WRONG_ROOM_TYPE: Room classified incorrectly
- LOW_CONFIDENCE: Cannot make confident determination
- AMBIGUOUS_CLASSIFICATION: Multiple valid interpretations
- SCALE_MISMATCH: Furniture or room proportions are wrong
- FURNITURE_MISMATCH: Wrong furniture type or arrangement
- STYLE_INCONSISTENCY: Design style doesn't match reference
- WALL_RECTIFICATION: Angled/curved walls incorrectly straightened
- MISSING_FURNISHINGS: Required furniture not present
- RESOLUTION_MISMATCH: Output resolution doesn't meet requirements
- SEAM_ARTIFACTS: Visible seams or stitching artifacts
- COLOR_INCONSISTENCY: Colors don't match across the image
- PERSPECTIVE_ERROR: Incorrect perspective or camera angle
- SCHEMA_INVALID: Output doesn't match expected schema
- API_ERROR: External API call failed
- TIMEOUT: Operation timed out
- UNKNOWN: Unclassified issue

CRITICAL RULES:
1. ALWAYS return valid JSON
2. For FAIL status, reasons array MUST have at least one entry
3. retry_suggestion.instruction MUST be specific and actionable
4. confidence_score reflects your certainty in the QA decision
5. severity determines if auto-retry is possible (critical = requires human)`;
}
