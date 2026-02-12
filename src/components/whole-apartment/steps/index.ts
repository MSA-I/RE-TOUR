/**
 * Modular step components for Whole Apartment Pipeline
 *
 * Each component is focused on a single step and uses PipelineContext
 * to eliminate prop drilling and improve maintainability.
 */

export { Step0_DesignRefAndSpaceScan } from "./Step0_DesignRefAndSpaceScan";
export { Step1_RealisticPlan } from "./Step1_RealisticPlan";
export { Step2_StyleApplication } from "./Step2_StyleApplication";
export { Step3_SpaceScan } from "./Step3_SpaceScan";
export { Step4_CameraIntent } from "./Step4_CameraIntent";
export { Step5_PromptTemplates } from "./Step5_PromptTemplates";
export { Step6_OutputsQA } from "./Step6_OutputsQA";

export { StepContainer } from "./StepContainer";
export type { BaseStepProps, StepStatus, WholeApartmentPhase } from "./types";
