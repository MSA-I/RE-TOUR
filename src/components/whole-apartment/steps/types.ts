/**
 * Shared types for whole apartment pipeline step components
 */

import { FloorplanPipeline } from "@/hooks/useFloorplanPipelines";
import { PipelineSpace } from "@/hooks/useWholeApartmentPipeline";

/**
 * Common props for all step components
 * All step components receive these props via PipelineContext
 */
export interface BaseStepProps {
  pipeline: FloorplanPipeline;
  spaces: PipelineSpace[];
  imagePreviews: Record<string, string>;
}

/**
 * Step status indicator
 */
export type StepStatus =
  | "pending"     // Not started
  | "running"     // Currently executing
  | "review"      // Waiting for user approval
  | "approved"    // User approved, can continue
  | "completed"   // Fully done
  | "failed"      // Encountered error
  | "blocked";    // Blocked by another step

/**
 * Step phase states (from database enum)
 */
export type WholeApartmentPhase =
  // Step 0
  | "upload"
  | "space_analysis_pending"
  | "space_analysis_running"
  | "space_analysis_complete"
  // Step 1
  | "top_down_3d_pending"
  | "top_down_3d_running"
  | "top_down_3d_review"
  // Step 2
  | "style_pending"
  | "style_running"
  | "style_review"
  // Step 3
  | "detect_spaces_pending"
  | "detecting_spaces"
  | "spaces_detected"
  // Step 4
  | "camera_intent_pending"
  | "camera_intent_confirmed"
  // Step 5
  | "prompt_templates_pending"
  | "prompt_templates_confirmed"
  // Step 6
  | "outputs_pending"
  | "outputs_in_progress"
  | "outputs_review"
  // Step 7+
  | "panoramas_pending"
  | "panoramas_in_progress"
  | "panoramas_review"
  | "merging_pending"
  | "merging_in_progress"
  | "merging_review"
  | "completed"
  | "failed";

/**
 * Map phase to step status
 */
export function getStepStatus(phase: WholeApartmentPhase): StepStatus {
  if (phase.includes("pending")) return "pending";
  if (phase.includes("running") || phase.includes("progress")) return "running";
  if (phase.includes("review")) return "review";
  if (phase === "completed") return "completed";
  if (phase === "failed") return "failed";
  return "pending";
}
