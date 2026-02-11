/**
 * Pipeline Phase and Status Constants
 * 
 * This file defines all valid phase and status values used across the pipeline.
 * Always import from here to ensure consistency between edge functions.
 */

// ============================================================================
// Whole Apartment Pipeline Phases
// ============================================================================

export const WHOLE_APARTMENT_PHASES = [
  // Initial states
  "upload",

  // Step 0.1: Design Reference Scan (OPTIONAL)
  "design_reference_pending",
  "design_reference_running",
  "design_reference_complete",
  "design_reference_failed",

  // Step 0.2: Space Scan (REQUIRED)
  "space_scan_pending",
  "space_scan_running",
  "space_scan_complete",
  "space_scan_review",
  "space_scan_failed",

  // Legacy Step 0 phases (for migration compatibility)
  "space_analysis_pending",
  "space_analysis_running",
  "space_analysis_complete",
  "space_analysis_review",
  "space_analysis_failed",

  // Top-Down 3D (Step 1)
  "top_down_3d_pending",
  "top_down_3d_running",
  "top_down_3d_review",
  "top_down_3d_approved",

  // Style (Step 2)
  "style_pending",
  "style_running",
  "style_review",
  "style_approved",

  // Space Detection (Step 3 - legacy internal step, mapped to spec 0.2)
  "detect_spaces_pending",
  "detecting_spaces",
  "spaces_detected",
  "spaces_detected_waiting_approval",

  // Step 3 (spec): Camera Intent (Templates A-H)
  "camera_intent_pending",
  "camera_intent_confirmed",

  // Legacy camera planning phases (for migration compatibility)
  "camera_plan_pending",
  "camera_plan_in_progress",
  "camera_plan_confirmed",

  // Renders (Step 4 internal, spec Steps 4 & 5)
  "renders_pending",
  "renders_in_progress",
  "renders_review",
  "renders_approved",

  // Panoramas (Step 5 internal, spec Step 8 - EXTERNAL)
  "panoramas_pending",
  "panoramas_in_progress",
  "panoramas_review",
  "panoramas_approved",

  // Merge (Step 6 internal, spec Step 6 - FUTURE)
  "merging_pending",
  "merging_in_progress",
  "merging_review",

  // Terminal states
  "completed",
  "failed"
] as const;

export type WholeApartmentPhase = typeof WHOLE_APARTMENT_PHASES[number];

// ============================================================================
// Pipeline Status Values (for `status` column)
// ============================================================================

export const PIPELINE_STATUSES = [
  // Base states
  "draft",
  "initialized",
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
  
  // QA states
  "waiting_qa",
  "ai_qa_fail",
  "ai_qa_pass",
  "retrying",
  "blocked_for_human",
  
  // Step 0 (Analysis)
  "step0_pending",
  "step0_running",
  "step0_waiting_approval",
  "step0_rejected",
  "step0_qa_fail",
  "step0_blocked_for_human",
  
  // Step 1 (Top-Down)
  "step1_pending",
  "step1_running",
  "step1_waiting_approval",
  "step1_rejected",
  "step1_qa_fail",
  "step1_blocked_for_human",
  
  // Step 2 (Style)
  "step2_pending",
  "step2_running",
  "step2_waiting_approval",
  "step2_rejected",
  "step2_qa_fail",
  "step2_blocked_for_human",
  
  // Step 3 (Spaces/Renders)
  "step3_pending",
  "step3_running",
  "step3_waiting_approval",
  "step3_rejected",
  "step3_qa_fail",
  "step3_blocked_for_human",
  "spaces_detected",
  "spaces_detected_waiting_approval",
  
  // Step 4 (Panoramas)
  "step4_pending",
  "step4_running",
  "step4_waiting_approval",
  "step4_rejected",
  "step4_qa_fail",
  "step4_blocked_for_human",
  
  // Step 5 (Merge)
  "step5_pending",
  "step5_running",
  "step5_waiting_approval",
  "step5_rejected",
  "step5_qa_fail",
  "step5_blocked_for_human",
  
  // Whole apartment phase-related (legacy compatibility)
  "top_down_3d_review",
  "style_review",
  "space_analysis_pending",
  "space_analysis_running",
  "space_analysis_review",
  "space_analysis_failed"
] as const;

export type PipelineStatus = typeof PIPELINE_STATUSES[number];

// ============================================================================
// Helper Functions
// ============================================================================

export function isValidPhase(phase: string): phase is WholeApartmentPhase {
  return WHOLE_APARTMENT_PHASES.includes(phase as WholeApartmentPhase);
}

export function isValidStatus(status: string): status is PipelineStatus {
  return PIPELINE_STATUSES.includes(status as PipelineStatus);
}

export function getPhaseForStep(step: number, isReview: boolean = false): WholeApartmentPhase {
  const phaseMap: Record<number, { pending: WholeApartmentPhase; review: WholeApartmentPhase }> = {
    0: { pending: "space_scan_pending", review: "space_scan_review" }, // Step 0.2 (primary)
    1: { pending: "top_down_3d_pending", review: "top_down_3d_review" },
    2: { pending: "style_pending", review: "style_review" },
    3: { pending: "camera_intent_pending", review: "camera_intent_confirmed" }, // Step 3 (spec-aligned)
    4: { pending: "renders_pending", review: "renders_review" },
    5: { pending: "panoramas_pending", review: "panoramas_review" },
  };

  const phases = phaseMap[step];
  if (!phases) return "failed";
  return isReview ? phases.review : phases.pending;
}

export function getStatusForStep(
  step: number, 
  outcome: "pending" | "running" | "waiting_approval" | "rejected" | "qa_fail" | "blocked_for_human"
): PipelineStatus {
  return `step${step}_${outcome}` as PipelineStatus;
}
