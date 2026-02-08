/**
 * Langfuse Naming Constants for RE:TOUR Pipeline
 * 
 * This module defines the STRICT naming convention for all Langfuse traces,
 * generations, and spans across Steps 0-6 of the pipeline.
 * 
 * IMPORTANT: These names are the single source of truth for observability.
 * Do not hardcode names elsewhere - import from this module.
 */

// ============= TRACE NAMES =============
export const TRACE_NAMES = {
  PIPELINE_RUN: "pipeline_run",
} as const;

// ============= EVALUATOR GATING =============
// Steps that support QA Judge evaluation (visual quality checks)
// These steps generate images that need AFTER image + structural comparison
export const QA_EVALUATABLE_STEPS = [1, 2, 4, 5, 6, 7] as const;

// Steps that do NOT support QA Judge evaluation
// Step 0: Space analysis (text-only, no renders to evaluate)
// Step 3: Camera planning (metadata generation, not visual outputs)
export const NON_QA_STEPS = [0, 3] as const;

// ============= STEP 0: SPACE ANALYSIS (Two Sub-Steps) =============
// Step 0.1: Design Reference Analysis (conditional - only if reference provided)
// Step 0.2: Space Analysis (always runs)
export const STEP_0_GENERATIONS = {
  // Legacy name (kept for backward compatibility)
  SPACE_ANALYSIS: "space_analysis_step_0",
  // New sub-step naming
  DESIGN_REFERENCE_ANALYSIS: "design_reference_analysis_step_0_1",
  SPACE_ANALYSIS_STRUCTURAL: "space_analysis_step_0_2",
} as const;

// ============= STEP 1: TOP-DOWN 3D =============
export const STEP_1_GENERATIONS = {
  COMPOSE_PROMPT: "compose_prompt_step_1",
  IMAGE_GEN: "image_gen_step_1",
  QA_JUDGE: "qa_judge_step_1",
  RETRY_CORRECTION: "retry_correction_step_1",
} as const;

// ============= STEP 2: STYLE TRANSFER =============
export const STEP_2_GENERATIONS = {
  COMPOSE_PROMPT: "compose_prompt_step_2",
  IMAGE_GEN: "image_gen_step_2",
  QA_JUDGE: "qa_judge_step_2",
  RETRY_CORRECTION: "retry_correction_step_2",
} as const;

// ============= STEP 3.1: SPACE DETECTION =============
export const STEP_3_1_GENERATIONS = {
  SPACE_DETECTION: "space_detection_step_3_1",
} as const;

// ============= STEP 3.2: CAMERA PLANNING =============
export const STEP_3_2_GENERATIONS = {
  CAMERA_PLANNING: "camera_planning_step_3_2",
  CAMERA_SCREENSHOT: "camera_screenshot_step_3_2",
  CAMERA_PROMPT_COMPOSE: "camera_prompt_compose_step_3_2",
  CAMERA_PROMPTS_APPROVED: "camera_prompts_approved_step_3_2",
  QA_CAMERA_PLAN: "qa_camera_plan_step_3_2",
  RETRY_CAMERA_PLAN: "retry_camera_plan_step_3_2",
} as const;

// ============= STEP 4: MULTI-IMAGE PANORAMA =============
export const STEP_4_GENERATIONS = {
  COMPOSE_PROMPT: "compose_prompt_step_4",
  MULTI_PANO_GEN: "multi_pano_gen_step_4",
  QA_JUDGE: "qa_judge_step_4",
  RETRY_CORRECTION: "retry_correction_step_4",
} as const;

// ============= STEP 5: SPACE RENDERS =============
export const STEP_5_GENERATIONS = {
  COMPOSE_PROMPT: "compose_prompt_step_5",
  RENDER_GEN: "render_gen_step_5",
  QA_JUDGE: "qa_judge_step_5",
  RETRY_CORRECTION: "retry_correction_step_5",
} as const;

// ============= STEP 6: SPACE PANORAMAS =============
export const STEP_6_GENERATIONS = {
  COMPOSE_PROMPT: "compose_prompt_step_6",
  PANO_360_GEN: "pano_360_gen_step_6",
  QA_JUDGE: "qa_judge_step_6",
  RETRY_CORRECTION: "retry_correction_step_6",
} as const;

// ============= STEP 7: MERGE / FINAL TOUR =============
export const STEP_7_GENERATIONS = {
  COMPOSE_PROMPT: "compose_prompt_step_7",
  MERGE_PANOS: "merge_panos_step_7",
  QA_JUDGE: "qa_judge_step_7",
  RETRY_CORRECTION: "retry_correction_step_7",
  TOUR_BUILD: "tour_build_step_7",
  QA_TOUR: "qa_tour_step_7",
} as const;

// ============= PROMPT NAMES (for Langfuse Prompt Management) =============
export const PROMPT_NAMES = {
  // Step 0 prompts
  DESIGN_REFERENCE_ANALYSIS: "retour_design_reference_analysis",
  SPACE_ANALYSIS: "retour_space_analysis",
  // Legacy names (kept for compatibility)
  SPACE_ANALYSIS_LEGACY: "space_analysis_template",
  PROMPT_COMPOSER: "prompt_composer_template",
  RETRY_CORRECTION: "retry_correction_template",
  QA_EVALUATOR: "qa_evaluator_template",
  CAMERA_PLANNING: "camera_planning_template",
  CAMERA_PROMPT_COMPOSE: "camera_prompt_compose_template",
} as const;

// ============= A/B TESTING LABELS =============
export const AB_LABELS = {
  CONTROL: "production",
  VARIANT_A: "variant_a",
  VARIANT_B: "variant_b",
} as const;

// ============= METADATA KEYS =============
export const METADATA_KEYS = {
  PROJECT_ID: "project_id",
  PIPELINE_ID: "pipeline_id",
  STEP_NUMBER: "step_number",
  SUB_STEP: "sub_step",
  ROOM_ID: "room_id",
  ROOM_NAME: "room_name",
  CAMERA_ID: "camera_id",
  ATTEMPT_INDEX: "attempt_index",
  MODEL_NAME: "model_name",
  PROMPT_NAME: "prompt_name",
  PROMPT_VERSION: "prompt_version",
  AB_BUCKET: "ab_bucket",
} as const;

// ============= HELPER: Get generation name by step =============
export function getGenerationName(
  stepNumber: number,
  subStep: "1" | "2" | null,
  type: "compose" | "generate" | "qa" | "retry"
): string {
  const stepKey = subStep ? `${stepNumber}.${subStep}` : stepNumber.toString();
  
  switch (stepKey) {
    case "0":
      return STEP_0_GENERATIONS.SPACE_ANALYSIS; // Legacy fallback
    case "0.1":
      return STEP_0_GENERATIONS.DESIGN_REFERENCE_ANALYSIS;
    case "0.2":
      return STEP_0_GENERATIONS.SPACE_ANALYSIS_STRUCTURAL;
      switch (type) {
        case "compose": return STEP_1_GENERATIONS.COMPOSE_PROMPT;
        case "generate": return STEP_1_GENERATIONS.IMAGE_GEN;
        case "qa": return STEP_1_GENERATIONS.QA_JUDGE;
        case "retry": return STEP_1_GENERATIONS.RETRY_CORRECTION;
      }
      break;
    case "2":
      switch (type) {
        case "compose": return STEP_2_GENERATIONS.COMPOSE_PROMPT;
        case "generate": return STEP_2_GENERATIONS.IMAGE_GEN;
        case "qa": return STEP_2_GENERATIONS.QA_JUDGE;
        case "retry": return STEP_2_GENERATIONS.RETRY_CORRECTION;
      }
      break;
    case "3.1":
      return STEP_3_1_GENERATIONS.SPACE_DETECTION;
    case "3.2":
      switch (type) {
        case "compose": return STEP_3_2_GENERATIONS.CAMERA_PROMPT_COMPOSE;
        case "generate": return STEP_3_2_GENERATIONS.CAMERA_PLANNING;
        case "qa": return STEP_3_2_GENERATIONS.QA_CAMERA_PLAN;
        case "retry": return STEP_3_2_GENERATIONS.RETRY_CAMERA_PLAN;
      }
      break;
    case "4":
      switch (type) {
        case "compose": return STEP_4_GENERATIONS.COMPOSE_PROMPT;
        case "generate": return STEP_4_GENERATIONS.MULTI_PANO_GEN;
        case "qa": return STEP_4_GENERATIONS.QA_JUDGE;
        case "retry": return STEP_4_GENERATIONS.RETRY_CORRECTION;
      }
      break;
    case "5":
      switch (type) {
        case "compose": return STEP_5_GENERATIONS.COMPOSE_PROMPT;
        case "generate": return STEP_5_GENERATIONS.RENDER_GEN;
        case "qa": return STEP_5_GENERATIONS.QA_JUDGE;
        case "retry": return STEP_5_GENERATIONS.RETRY_CORRECTION;
      }
      break;
    case "6":
      switch (type) {
        case "compose": return STEP_6_GENERATIONS.COMPOSE_PROMPT;
        case "generate": return STEP_6_GENERATIONS.PANO_360_GEN;
        case "qa": return STEP_6_GENERATIONS.QA_JUDGE;
        case "retry": return STEP_6_GENERATIONS.RETRY_CORRECTION;
      }
      break;
    case "7":
      switch (type) {
        case "compose": return STEP_7_GENERATIONS.COMPOSE_PROMPT;
        case "generate": return STEP_7_GENERATIONS.MERGE_PANOS;
        case "qa": return STEP_7_GENERATIONS.QA_JUDGE;
        case "retry": return STEP_7_GENERATIONS.RETRY_CORRECTION;
      }
      break;
  }
  
  return `unknown_step_${stepNumber}_${type}`;
}

// ============= HELPER: Build standard metadata object =============
export interface StandardMetadata {
  project_id: string;
  pipeline_id: string;
  step_number: number;
  sub_step?: string | null;
  room_id?: string | null;
  room_name?: string | null;
  camera_id?: string | null;
  attempt_index?: number;
  model_name?: string;
  prompt_name?: string;
  prompt_version?: string;
  ab_bucket?: string;
}

/**
 * Check if a step supports QA Judge evaluation
 * Steps that generate visual outputs (images) need QA evaluation
 * Steps that generate metadata/text do not
 */
export function stepSupportsQAEvaluation(stepNumber: number): boolean {
  return (QA_EVALUATABLE_STEPS as readonly number[]).includes(stepNumber);
}

export function buildStandardMetadata(params: StandardMetadata): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    [METADATA_KEYS.PROJECT_ID]: params.project_id,
    [METADATA_KEYS.PIPELINE_ID]: params.pipeline_id,
    [METADATA_KEYS.STEP_NUMBER]: params.step_number,
  };

  // Add QA evaluation flag to help Langfuse evaluators gate correctly
  metadata["supports_qa_evaluation"] = stepSupportsQAEvaluation(params.step_number);

  if (params.sub_step) metadata[METADATA_KEYS.SUB_STEP] = params.sub_step;
  if (params.room_id) metadata[METADATA_KEYS.ROOM_ID] = params.room_id;
  if (params.room_name) metadata[METADATA_KEYS.ROOM_NAME] = params.room_name;
  if (params.camera_id) metadata[METADATA_KEYS.CAMERA_ID] = params.camera_id;
  if (params.attempt_index !== undefined) metadata[METADATA_KEYS.ATTEMPT_INDEX] = params.attempt_index;
  if (params.model_name) metadata[METADATA_KEYS.MODEL_NAME] = params.model_name;
  if (params.prompt_name) metadata[METADATA_KEYS.PROMPT_NAME] = params.prompt_name;
  if (params.prompt_version) metadata[METADATA_KEYS.PROMPT_VERSION] = params.prompt_version;
  if (params.ab_bucket) metadata[METADATA_KEYS.AB_BUCKET] = params.ab_bucket;

  return metadata;
}

// ============= HELPER: Compute stable A/B bucket from pipeline_id =============
/**
 * Deterministic A/B bucket assignment based on pipeline_id hash.
 * Ensures consistent bucketing across all requests for the same pipeline.
 */
export function getABBucket(pipelineId: string, experimentName: string = "default"): "A" | "B" {
  // Simple hash function for deterministic bucketing
  const hashInput = `${pipelineId}:${experimentName}`;
  let hash = 0;
  for (let i = 0; i < hashInput.length; i++) {
    const char = hashInput.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  
  // 50/50 split
  return (Math.abs(hash) % 2 === 0) ? "A" : "B";
}

/**
 * Get the prompt label for A/B testing based on bucket
 */
export function getPromptLabel(bucket: "A" | "B"): string {
  return bucket === "A" ? AB_LABELS.CONTROL : AB_LABELS.VARIANT_A;
}
