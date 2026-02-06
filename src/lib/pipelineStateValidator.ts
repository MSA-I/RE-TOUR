/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PIPELINE STATE VALIDATOR
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Detects illegal states in the pipeline and provides recovery guidance.
 * Used by the PipelineDebugPanel to surface issues and enable recovery actions.
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { PHASE_STEP_MAP } from "@/hooks/useWholeApartmentPipeline";

export interface IllegalState {
  type: 
    | "PHASE_STEP_MISMATCH" 
    | "APPROVED_NOT_ADVANCED" 
    | "REVIEW_WITHOUT_OUTPUT"
    | "BLOCKED_NO_UI_ACTION"
    | "OUTPUT_EXISTS_NOT_IN_STEP_OUTPUTS";
  message: string;
  severity: "critical" | "high" | "medium";
  recovery?: {
    phase: string;
    current_step: number;
  };
}

export interface StateValidationResult {
  isValid: boolean;
  illegalStates: IllegalState[];
}

export interface PipelineForValidation {
  id: string;
  whole_apartment_phase?: string | null;
  current_step?: number | null;
  step_outputs?: Record<string, { 
    manual_approved?: boolean; 
    output_upload_id?: string;
  }> | null;
  step_retry_state?: Record<string, {
    status?: string;
    attempt_count?: number;
  }> | null;
  status?: string | null;
}

/**
 * Get the next pending phase after a review phase
 */
function getNextPendingPhase(step: number): string {
  const nextPhaseMap: Record<number, string> = {
    1: "style_pending",
    2: "camera_plan_pending",
    3: "detect_spaces_pending",
    4: "renders_pending",
    5: "panoramas_pending",
    6: "merging_pending",
  };
  return nextPhaseMap[step] || "completed";
}

/**
 * Validate pipeline state for consistency
 */
export function validatePipelineState(pipeline: PipelineForValidation): StateValidationResult {
  const issues: IllegalState[] = [];
  const phase = pipeline.whole_apartment_phase || "upload";
  const currentStep = pipeline.current_step ?? 0;
  const stepOutputs = (pipeline.step_outputs || {}) as Record<string, { 
    manual_approved?: boolean; 
    output_upload_id?: string;
  }>;
  const stepRetryState = (pipeline.step_retry_state || {}) as Record<string, {
    status?: string;
    attempt_count?: number;
  }>;

  // Check 1: Phase-step consistency
  const expectedStep = PHASE_STEP_MAP[phase];
  if (expectedStep !== undefined && expectedStep !== currentStep) {
    issues.push({
      type: "PHASE_STEP_MISMATCH",
      message: `Phase "${phase}" expects step ${expectedStep}, but current_step is ${currentStep}`,
      severity: "critical",
      recovery: { phase, current_step: expectedStep },
    });
  }

  // Check 2: Approved but phase not advanced
  // Step 1 approved but still in review
  if (stepOutputs?.step1?.manual_approved && phase === "top_down_3d_review") {
    issues.push({
      type: "APPROVED_NOT_ADVANCED",
      message: "Step 1 is approved but phase is still top_down_3d_review",
      severity: "high",
      recovery: { phase: getNextPendingPhase(1), current_step: 2 },
    });
  }

  // Step 2 approved but still in review
  if (stepOutputs?.step2?.manual_approved && phase === "style_review") {
    issues.push({
      type: "APPROVED_NOT_ADVANCED",
      message: "Step 2 is approved but phase is still style_review",
      severity: "high",
      recovery: { phase: getNextPendingPhase(2), current_step: 3 },
    });
  }

  // Check 3: Review phase without output
  if (phase === "top_down_3d_review" && !stepOutputs?.step1?.output_upload_id) {
    issues.push({
      type: "REVIEW_WITHOUT_OUTPUT",
      message: "Phase is top_down_3d_review but no Step 1 output exists",
      severity: "medium",
      recovery: { phase: "top_down_3d_pending", current_step: 1 },
    });
  }

  if (phase === "style_review" && !stepOutputs?.step2?.output_upload_id) {
    issues.push({
      type: "REVIEW_WITHOUT_OUTPUT",
      message: "Phase is style_review but no Step 2 output exists",
      severity: "medium",
      recovery: { phase: "style_pending", current_step: 2 },
    });
  }

  // Check 4: Blocked for human with no recovery path
  for (const [stepKey, retryState] of Object.entries(stepRetryState)) {
    if (retryState?.status === "blocked_for_human") {
      const stepNum = parseInt(stepKey.replace("step_", ""), 10);
      // This is informational - blocked states require manual approval
      // Don't mark as illegal, but could add visibility
    }
  }

  return {
    isValid: issues.length === 0,
    illegalStates: issues,
  };
}

/**
 * Get a human-readable summary of the pipeline state
 */
export function getPipelineStateSummary(pipeline: PipelineForValidation): string {
  const phase = pipeline.whole_apartment_phase || "upload";
  const step = pipeline.current_step ?? 0;
  const validation = validatePipelineState(pipeline);
  
  if (validation.isValid) {
    return `Phase: ${phase}, Step: ${step} (valid)`;
  }
  
  const criticalCount = validation.illegalStates.filter(s => s.severity === "critical").length;
  const highCount = validation.illegalStates.filter(s => s.severity === "high").length;
  
  return `Phase: ${phase}, Step: ${step} (${criticalCount} critical, ${highCount} high issues)`;
}
