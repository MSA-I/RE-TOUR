import { createContext, useContext, ReactNode } from "react";
import { FloorplanPipeline } from "@/hooks/useFloorplanPipelines";
import { PipelineSpace } from "@/hooks/useWholeApartmentPipeline";
import { UseToastReturn } from "@/hooks/use-toast";

/**
 * Pipeline Context - Provides shared state and mutations for whole apartment pipeline
 *
 * Purpose: Eliminate prop drilling in WholeApartmentPipelineCard by providing
 * pipeline state, mutations, and loading states via React Context.
 *
 * Usage:
 * 1. Wrap pipeline content in <PipelineProvider>
 * 2. Access context in step components with usePipelineContext()
 * 3. Components only access what they need (no more 40+ props)
 */

export interface CameraIntent {
  id: string;
  pipeline_id: string;
  space_id: string;
  suggestion_text: string;
  suggestion_index: number;
  space_size_category: string;
  is_selected: boolean;
  selected_at?: string;
  space_name?: string;
  space_class?: string;
}

export interface FinalPrompt {
  id: string;
  pipeline_id: string;
  space_id: string;
  prompt_template: string;
  final_composed_prompt: string;
  image_count: number;
  source_camera_intent_ids: string[];
  nanobanana_job_id?: string;
  status: 'pending' | 'queued' | 'generating' | 'complete' | 'failed';

  // Output fields (added 2026-02-12 for Step 6 integration)
  output_upload_ids?: string[];
  attempt_number?: number;

  // QA fields (added 2026-02-12 for Step 6 integration)
  qa_status?: string;
  qa_report?: {
    overall_decision?: string;
    overall_score?: number;
    criteria?: Array<{
      name: string;
      passed: boolean;
      confidence?: number;
      details?: string;
    }>;
    feedback?: string;
    qa_reason?: string;
  };
  qa_score?: number;
  qa_feedback?: string;
  qa_reason?: string;

  // Approval fields (added 2026-02-12 for Step 6 integration)
  manual_approved?: boolean;
  locked_approved?: boolean;
  approved_at?: string;
  approved_by?: string;
}

interface PipelineContextValue {
  // Pipeline state
  pipeline: FloorplanPipeline;
  spaces: PipelineSpace[];
  imagePreviews: Record<string, string>;
  currentStep: number;

  // Camera intents (Step 4)
  cameraIntents: CameraIntent[];
  refetchCameraIntents: () => void;

  // Final prompts (Step 5)
  finalPrompts: FinalPrompt[];
  refetchFinalPrompts: () => void;

  // Mutations - Pipeline progression
  runSpaceAnalysis: () => Promise<void>;
  runTopDown3D: () => Promise<void>;
  runStyleTopDown: () => Promise<void>;
  runDetectSpaces: () => Promise<void>;
  continueToStep: (params: { from_phase: string }) => Promise<void>;

  // Mutations - Step 4-6 specific
  saveCameraIntents: (intentIds: string[]) => Promise<void>;
  composeFinalPrompts: (intentIds: string[]) => Promise<void>;
  runBatchOutputs: () => Promise<void>;

  // Mutations - Step control (reset/rollback)
  restartStep: (stepNumber: number) => Promise<void>;
  rollbackToPreviousStep: (currentStepNumber: number) => Promise<void>;

  // Loading states
  isLoadingSpaces: boolean;
  isRunningStep: boolean; // Generic step execution state
  isGeneratingPrompts: boolean;
  isGeneratingImages: boolean;
  isResetPending: boolean;
  isRollbackPending: boolean;

  // Progress tracking
  progress: number;
  progressDetails?: string;

  // Toast notifications
  toast: UseToastReturn['toast'];

  // Callbacks
  onUpdatePipeline?: () => void;
}

const PipelineContext = createContext<PipelineContextValue | undefined>(undefined);

export interface PipelineProviderProps {
  value: PipelineContextValue;
  children: ReactNode;
}

/**
 * Provider component - wraps pipeline content
 */
export function PipelineProvider({ value, children }: PipelineProviderProps) {
  return (
    <PipelineContext.Provider value={value}>
      {children}
    </PipelineContext.Provider>
  );
}

/**
 * Hook to access pipeline context
 *
 * @throws Error if used outside PipelineProvider
 */
export function usePipelineContext(): PipelineContextValue {
  const context = useContext(PipelineContext);

  if (context === undefined) {
    throw new Error('usePipelineContext must be used within a PipelineProvider');
  }

  return context;
}

/**
 * Type guard to check if pipeline is in a specific phase
 */
export function isPipelinePhase(pipeline: FloorplanPipeline, phase: string): boolean {
  return pipeline.whole_apartment_phase === phase;
}

/**
 * Type guard to check if pipeline is in a specific step
 */
export function isPipelineStep(pipeline: FloorplanPipeline, step: number): boolean {
  return pipeline.current_step === step;
}

/**
 * Helper to check if a phase transition is valid
 */
export function canTransitionFrom(currentPhase: string, targetPhase: string): boolean {
  const LEGAL_TRANSITIONS: Record<string, string> = {
    "space_analysis_complete": "top_down_3d_pending",
    "top_down_3d_review": "style_pending",
    "style_review": "detect_spaces_pending",
    "spaces_detected": "camera_intent_pending",
    "camera_intent_confirmed": "prompt_templates_pending",
    "prompt_templates_confirmed": "outputs_pending",
    "outputs_review": "panoramas_pending",
    "panoramas_review": "merging_pending",
    "merging_review": "completed",
  };

  return LEGAL_TRANSITIONS[currentPhase] === targetPhase;
}
