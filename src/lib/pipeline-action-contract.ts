/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PIPELINE PHASE → ACTION CONTRACT (SINGLE SOURCE OF TRUTH)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * This file defines the authoritative mapping between pipeline phases and
 * their allowed actions (endpoints). Every CTA button, mutation, and backend
 * guard MUST use this contract to ensure deterministic routing.
 * 
 * ⚠️  WARNING: DO NOT MODIFY WITHOUT UPDATING BACKEND GUARDS  ⚠️
 * 
 * Backend edge functions that validate phases:
 *   - supabase/functions/run-space-analysis/index.ts
 *   - supabase/functions/run-pipeline-step/index.ts  
 *   - supabase/functions/run-detect-spaces/index.ts
 *   - supabase/functions/continue-pipeline-step/index.ts
 * ═══════════════════════════════════════════════════════════════════════════
 */

// ============= Action Types =============

export type CTAType = "RUN" | "CONTINUE" | "APPROVE" | "REJECT" | "EDITOR" | "DISABLED" | "NONE";

export type ActionName =
  | "DESIGN_REFERENCE_SCAN_START"
  | "DESIGN_REFERENCE_SCAN_RUNNING"
  | "DESIGN_REFERENCE_SCAN_CONTINUE"
  | "SPACE_SCAN_START"
  | "SPACE_SCAN_RUNNING"
  | "SPACE_SCAN_CONTINUE"
  | "SPACE_ANALYSIS_START"
  | "SPACE_ANALYSIS_RUNNING"
  | "SPACE_ANALYSIS_CONTINUE"
  | "TOP_DOWN_3D_START"
  | "TOP_DOWN_3D_RUNNING"
  | "TOP_DOWN_3D_APPROVE"
  | "STYLE_START"
  | "STYLE_RUNNING"
  | "STYLE_APPROVE"
  | "CAMERA_INTENT_SELECT"
  | "CAMERA_INTENT_CONTINUE"
  | "CAMERA_PLAN_EDIT"
  | "CAMERA_PLAN_CONTINUE"
  | "DETECT_SPACES_START"
  | "DETECT_SPACES_RUNNING"
  | "DETECT_SPACES_CONTINUE"
  | "RENDERS_START"
  | "RENDERS_RUNNING"
  | "RENDERS_APPROVE"
  | "PANORAMAS_START"
  | "PANORAMAS_RUNNING"
  | "PANORAMAS_APPROVE"
  | "MERGE_START"
  | "MERGE_RUNNING"
  | "MERGE_APPROVE"
  | "PIPELINE_COMPLETE"
  | "PIPELINE_RETRY";

export interface PhaseActionConfig {
  step: number;
  ctaType: CTAType;
  endpoint: string | null;
  actionName: ActionName;
  ctaLabel: string;
  /** Phases that this endpoint is allowed to handle */
  allowedPhases?: string[];
}

// ============= Phase → Action Contract =============

export const PHASE_ACTION_CONTRACT: Record<string, PhaseActionConfig> = {
  // ─────────────────────────────────────────────────────────────────────
  // Step 0.1: Design Reference Scan (OPTIONAL)
  // ─────────────────────────────────────────────────────────────────────
  design_reference_pending: {
    step: 0,
    ctaType: "RUN",
    endpoint: "run-design-reference-scan",
    actionName: "DESIGN_REFERENCE_SCAN_START" as ActionName,
    ctaLabel: "Analyze Design References",
  },
  design_reference_running: {
    step: 0,
    ctaType: "DISABLED",
    endpoint: null,
    actionName: "DESIGN_REFERENCE_SCAN_RUNNING" as ActionName,
    ctaLabel: "Analyzing References...",
  },
  design_reference_complete: {
    step: 0,
    ctaType: "CONTINUE",
    endpoint: "continue-pipeline-step",
    actionName: "DESIGN_REFERENCE_SCAN_CONTINUE" as ActionName,
    ctaLabel: "Continue to Space Scan",
  },
  design_reference_failed: {
    step: 0,
    ctaType: "RUN",
    endpoint: "run-design-reference-scan",
    actionName: "DESIGN_REFERENCE_SCAN_START" as ActionName,
    ctaLabel: "Retry Design Reference Scan",
  },

  // ─────────────────────────────────────────────────────────────────────
  // Step 0.2: Space Scan (REQUIRED)
  // ─────────────────────────────────────────────────────────────────────
  upload: {
    step: 0,
    ctaType: "RUN",
    endpoint: "run-space-scan",
    actionName: "SPACE_SCAN_START" as ActionName,
    ctaLabel: "Scan Spaces from Floor Plan",
  },
  space_scan_pending: {
    step: 0,
    ctaType: "RUN",
    endpoint: "run-space-scan",
    actionName: "SPACE_SCAN_START" as ActionName,
    ctaLabel: "Start Space Scan",
  },
  space_scan_running: {
    step: 0,
    ctaType: "DISABLED",
    endpoint: null,
    actionName: "SPACE_SCAN_RUNNING" as ActionName,
    ctaLabel: "Scanning Spaces...",
  },
  space_scan_complete: {
    step: 0,
    ctaType: "CONTINUE",
    endpoint: "continue-pipeline-step",
    actionName: "SPACE_SCAN_CONTINUE" as ActionName,
    ctaLabel: "Continue to Top-Down 3D",
  },
  space_scan_failed: {
    step: 0,
    ctaType: "RUN",
    endpoint: "run-space-scan",
    actionName: "SPACE_SCAN_START" as ActionName,
    ctaLabel: "Retry Space Scan",
  },

  // ─────────────────────────────────────────────────────────────────────
  // Step 0: Space Analysis (LEGACY - for backwards compatibility)
  // ─────────────────────────────────────────────────────────────────────
  space_analysis_pending: {
    step: 0,
    ctaType: "RUN",
    endpoint: "run-space-analysis",
    actionName: "SPACE_ANALYSIS_START",
    ctaLabel: "Start Space Analysis",
  },
  space_analysis_running: {
    step: 0,
    ctaType: "DISABLED",
    endpoint: null,
    actionName: "SPACE_ANALYSIS_RUNNING",
    ctaLabel: "Analyzing...",
  },
  space_analysis_complete: {
    step: 0,
    ctaType: "CONTINUE",
    endpoint: "continue-pipeline-step",
    actionName: "SPACE_ANALYSIS_CONTINUE",
    ctaLabel: "Continue to Top-Down 3D",
  },

  // ─────────────────────────────────────────────────────────────────────
  // Step 1: Top-Down 3D
  // ─────────────────────────────────────────────────────────────────────
  top_down_3d_pending: {
    step: 1,
    ctaType: "RUN",
    endpoint: "run-pipeline-step",
    actionName: "TOP_DOWN_3D_START",
    ctaLabel: "Generate Top-Down 3D",
  },
  top_down_3d_running: {
    step: 1,
    ctaType: "DISABLED",
    endpoint: null,
    actionName: "TOP_DOWN_3D_RUNNING",
    ctaLabel: "Generating...",
  },
  top_down_3d_review: {
    step: 1,
    ctaType: "APPROVE",
    endpoint: null, // Uses mutation, not edge function
    actionName: "TOP_DOWN_3D_APPROVE",
    ctaLabel: "Approve / Reject",
  },

  // ─────────────────────────────────────────────────────────────────────
  // Step 2: Style Top-Down
  // ─────────────────────────────────────────────────────────────────────
  style_pending: {
    step: 2,
    ctaType: "RUN",
    endpoint: "run-pipeline-step",
    actionName: "STYLE_START",
    ctaLabel: "Apply Style",
  },
  style_running: {
    step: 2,
    ctaType: "DISABLED",
    endpoint: null,
    actionName: "STYLE_RUNNING",
    ctaLabel: "Styling...",
  },
  style_review: {
    step: 2,
    ctaType: "APPROVE",
    endpoint: null,
    actionName: "STYLE_APPROVE",
    ctaLabel: "Approve / Reject",
  },

  // ─────────────────────────────────────────────────────────────────────
  // Step 3: Detect Spaces (SWAPPED - was Step 4)
  // ─────────────────────────────────────────────────────────────────────
  detect_spaces_pending: {
    step: 3,
    ctaType: "RUN",
    endpoint: "run-detect-spaces",
    actionName: "DETECT_SPACES_START",
    ctaLabel: "Detect Spaces",
  },
  detecting_spaces: {
    step: 3,
    ctaType: "DISABLED",
    endpoint: null,
    actionName: "DETECT_SPACES_RUNNING",
    ctaLabel: "Detecting...",
  },
  spaces_detected: {
    step: 3,
    ctaType: "CONTINUE",
    endpoint: "continue-pipeline-step",
    actionName: "DETECT_SPACES_CONTINUE",
    ctaLabel: "Continue to Camera Planning",
  },

  // ─────────────────────────────────────────────────────────────────────
  // Step 3 (spec): Camera Intent (Templates A-H) - NEW
  // ─────────────────────────────────────────────────────────────────────
  camera_intent_pending: {
    step: 3,
    ctaType: "EDITOR",
    endpoint: null, // Opens CameraIntentSelector, no backend call until confirm
    actionName: "CAMERA_INTENT_SELECT" as ActionName,
    ctaLabel: "Define Camera Intent",
  },
  camera_intent_confirmed: {
    step: 3,
    ctaType: "CONTINUE",
    endpoint: "continue-pipeline-step",
    actionName: "CAMERA_INTENT_CONTINUE" as ActionName,
    ctaLabel: "Continue to Renders",
  },

  // ─────────────────────────────────────────────────────────────────────
  // Step 4 (internal): Camera Planning (LEGACY - now Capability Slots)
  // ─────────────────────────────────────────────────────────────────────
  camera_plan_pending: {
    step: 4,
    ctaType: "DISABLED", // Changed from EDITOR - feature disabled
    endpoint: null,
    actionName: "CAMERA_PLAN_EDIT",
    ctaLabel: "Capability Slots (Coming Soon)",
  },
  camera_plan_in_progress: {
    step: 4,
    ctaType: "DISABLED",
    endpoint: null,
    actionName: "CAMERA_PLAN_EDIT",
    ctaLabel: "Camera Planning In Progress",
  },
  camera_plan_confirmed: {
    step: 4,
    ctaType: "CONTINUE",
    endpoint: "continue-pipeline-step",
    actionName: "CAMERA_PLAN_CONTINUE",
    ctaLabel: "Continue to Renders",
  },

  // ─────────────────────────────────────────────────────────────────────
  // Step 5: Renders
  // ─────────────────────────────────────────────────────────────────────
  renders_pending: {
    step: 5,
    ctaType: "RUN",
    endpoint: "run-batch-space-renders",
    actionName: "RENDERS_START",
    ctaLabel: "Start All Renders",
  },
  renders_in_progress: {
    step: 5,
    ctaType: "DISABLED",
    endpoint: null,
    actionName: "RENDERS_RUNNING",
    ctaLabel: "Rendering...",
  },
  renders_review: {
    step: 5,
    ctaType: "APPROVE",
    endpoint: null,
    actionName: "RENDERS_APPROVE",
    ctaLabel: "Review Renders",
  },

  // ─────────────────────────────────────────────────────────────────────
  // Step 6: Panoramas
  // ─────────────────────────────────────────────────────────────────────
  panoramas_pending: {
    step: 6,
    ctaType: "RUN",
    endpoint: "run-batch-space-panoramas",
    actionName: "PANORAMAS_START",
    ctaLabel: "Start All Panoramas",
  },
  panoramas_in_progress: {
    step: 6,
    ctaType: "DISABLED",
    endpoint: null,
    actionName: "PANORAMAS_RUNNING",
    ctaLabel: "Generating Panoramas...",
  },
  panoramas_review: {
    step: 6,
    ctaType: "APPROVE",
    endpoint: null,
    actionName: "PANORAMAS_APPROVE",
    ctaLabel: "Review Panoramas",
  },

  // ─────────────────────────────────────────────────────────────────────
  // Step 7: Merge
  // ─────────────────────────────────────────────────────────────────────
  merging_pending: {
    step: 7,
    ctaType: "RUN",
    endpoint: "run-batch-space-merges",
    actionName: "MERGE_START",
    ctaLabel: "Start Merge",
  },
  merging_in_progress: {
    step: 7,
    ctaType: "DISABLED",
    endpoint: null,
    actionName: "MERGE_RUNNING",
    ctaLabel: "Merging...",
  },
  merging_review: {
    step: 7,
    ctaType: "APPROVE",
    endpoint: null,
    actionName: "MERGE_APPROVE",
    ctaLabel: "Review Final 360s",
  },

  // ─────────────────────────────────────────────────────────────────────
  // Terminal States
  // ─────────────────────────────────────────────────────────────────────
  completed: {
    step: 7,
    ctaType: "NONE",
    endpoint: null,
    actionName: "PIPELINE_COMPLETE",
    ctaLabel: "Pipeline Complete",
  },
  failed: {
    step: 0,
    ctaType: "RUN",
    endpoint: "retry-pipeline-step",
    actionName: "PIPELINE_RETRY",
    ctaLabel: "Retry Pipeline",
  },
};

// ============= Endpoint → Allowed Phases Mapping =============
// This is used by backend guards to validate incoming requests

export const ENDPOINT_ALLOWED_PHASES: Record<string, string[]> = {
  "run-space-analysis": [
    "upload",
    "space_analysis_pending",
    "space_analysis_running",
    "space_analysis_complete", // Allow re-run if needed
  ],
  "run-pipeline-step": [
    "top_down_3d_pending",
    "top_down_3d_running",
    "style_pending",
    "style_running",
  ],
  "run-detect-spaces": [
    // NOTE: style_review should use continue-pipeline-step first to advance to detect_spaces_pending
    "detect_spaces_pending",
    "detecting_spaces",
  ],
  "continue-pipeline-step": [
    "space_analysis_complete",
    "top_down_3d_review",
    "style_review",
    "spaces_detected", // Now continues to camera_plan_pending
    "camera_plan_confirmed", // Now continues to renders_pending
    "renders_review",
    "panoramas_review",
    "merging_review",
  ],
  "run-batch-space-renders": [
    "spaces_detected",
    "renders_pending",
    "renders_in_progress",
  ],
  "run-batch-space-panoramas": [
    "renders_review",
    "panoramas_pending",
    "panoramas_in_progress",
  ],
  "run-batch-space-merges": [
    "panoramas_review",
    "merging_pending",
    "merging_in_progress",
  ],
};

// ============= Helper Functions =============

/**
 * Get the correct endpoint for a phase and action type.
 * Returns null if the action is not supported for this phase.
 */
export function getEndpointForPhase(
  phase: string,
  actionType: "RUN" | "CONTINUE"
): string | null {
  const config = PHASE_ACTION_CONTRACT[phase];
  if (!config) {
    console.warn(`[getEndpointForPhase] Unknown phase: ${phase}`);
    return null;
  }

  if (actionType === "RUN" && config.ctaType === "RUN") {
    return config.endpoint;
  }
  if (actionType === "CONTINUE" && config.ctaType === "CONTINUE") {
    return config.endpoint;
  }

  return null;
}

/**
 * Check if a phase supports a RUN action
 */
export function isPhaseRunnable(phase: string): boolean {
  const config = PHASE_ACTION_CONTRACT[phase];
  return config?.ctaType === "RUN";
}

/**
 * Check if a phase is an approval phase
 */
export function isPhaseApprovalPhase(phase: string): boolean {
  const config = PHASE_ACTION_CONTRACT[phase];
  return config?.ctaType === "APPROVE";
}

/**
 * Check if a phase is a running/in-progress phase
 */
export function isPhaseRunning(phase: string): boolean {
  const config = PHASE_ACTION_CONTRACT[phase];
  return config?.ctaType === "DISABLED";
}

/**
 * Check if a phase is an editor phase (no compute)
 */
export function isPhaseEditorPhase(phase: string): boolean {
  const config = PHASE_ACTION_CONTRACT[phase];
  return config?.ctaType === "EDITOR";
}

/**
 * Get the step number for a phase
 */
export function getStepForPhase(phase: string): number {
  const config = PHASE_ACTION_CONTRACT[phase];
  return config?.step ?? 0;
}

/**
 * Get the action name for a phase
 */
export function getActionNameForPhase(phase: string): ActionName | null {
  const config = PHASE_ACTION_CONTRACT[phase];
  return config?.actionName ?? null;
}

/**
 * Get the CTA label for a phase
 */
export function getCTALabelForPhase(phase: string): string {
  const config = PHASE_ACTION_CONTRACT[phase];
  return config?.ctaLabel ?? "Unknown Action";
}

/**
 * Validate that an endpoint is allowed to handle a specific phase.
 * Returns { valid: true } or { valid: false, error: string }
 */
export function validateEndpointForPhase(
  endpoint: string,
  phase: string
): { valid: boolean; error?: string } {
  const allowedPhases = ENDPOINT_ALLOWED_PHASES[endpoint];
  
  if (!allowedPhases) {
    return { valid: false, error: `Unknown endpoint: ${endpoint}` };
  }

  if (!allowedPhases.includes(phase)) {
    return {
      valid: false,
      error: `Phase mismatch: ${endpoint} handles phases [${allowedPhases.join(", ")}], but pipeline is at phase "${phase}"`,
    };
  }

  return { valid: true };
}

/**
 * Check if a step is complete based on current phase
 */
export function isStepComplete(phase: string, stepNumber: number): boolean {
  const phaseStep = getStepForPhase(phase);
  return phaseStep > stepNumber;
}
