/**
 * ═══════════════════════════════════════════════════════════════════════════
 * UNIFIED PIPELINE ROUTER
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * This file provides a single routing function used by all frontend mutations
 * to determine the correct Edge Function to call based on pipeline phase.
 * 
 * RULE: All routing decisions MUST go through this file. No direct endpoint
 * selection in hooks or components.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { 
  PHASE_ACTION_CONTRACT, 
  getEndpointForPhase,
  validateEndpointForPhase,
  type ActionName,
} from "./pipeline-action-contract";

// ============= Types =============

export interface RouteResult {
  /** The edge function endpoint to call, or null if no call needed */
  endpoint: string | null;
  /** The action name for logging */
  actionName: ActionName | string;
  /** Base payload to send */
  payload: Record<string, unknown>;
  /** CTA label for display */
  ctaLabel: string;
  /** Whether the action is valid for current phase */
  isValid: boolean;
  /** Error message if not valid */
  error?: string;
}

export interface ActionContext {
  /** UUID generated at click time */
  action_id: string;
  /** Action name from contract */
  action_name: string;
  /** Pipeline phase when button clicked */
  phase_at_click: string;
  /** Endpoint we're calling */
  endpoint_expected: string | null;
  /** ISO timestamp */
  timestamp: string;
}

// ============= Routing Functions =============

/**
 * Route an action by phase to the correct endpoint.
 * This is the ONLY function that should determine which Edge Function to call.
 */
export function routeActionByPhase(
  phase: string,
  actionType: "RUN" | "CONTINUE" | "APPROVE" | "REJECT",
  pipelineId: string,
  additionalParams?: Record<string, unknown>
): RouteResult {
  const config = PHASE_ACTION_CONTRACT[phase];
  
  if (!config) {
    return {
      endpoint: null,
      actionName: "UNKNOWN",
      payload: { pipeline_id: pipelineId },
      ctaLabel: "Unknown Phase",
      isValid: false,
      error: `Unknown phase: ${phase}`,
    };
  }

  // Check if the requested action type matches the phase's CTA type
  if (actionType === "RUN" && config.ctaType !== "RUN") {
    return {
      endpoint: null,
      actionName: config.actionName,
      payload: { pipeline_id: pipelineId },
      ctaLabel: config.ctaLabel,
      isValid: false,
      error: `Phase "${phase}" does not support RUN action (current CTA type: ${config.ctaType})`,
    };
  }

  if (actionType === "CONTINUE" && config.ctaType !== "CONTINUE") {
    return {
      endpoint: null,
      actionName: config.actionName,
      payload: { pipeline_id: pipelineId },
      ctaLabel: config.ctaLabel,
      isValid: false,
      error: `Phase "${phase}" does not support CONTINUE action (current CTA type: ${config.ctaType})`,
    };
  }

  // Build the payload
  const payload: Record<string, unknown> = {
    pipeline_id: pipelineId,
    ...additionalParams,
  };

  // For continue actions, include phase transition info
  if (actionType === "CONTINUE" && config.endpoint === "continue-pipeline-step") {
    payload.from_step = config.step;
    payload.from_phase = phase;
  }

  return {
    endpoint: config.endpoint,
    actionName: config.actionName,
    payload,
    ctaLabel: config.ctaLabel,
    isValid: true,
  };
}

/**
 * Validate that the current phase allows a specific action.
 * Use this before showing CTAs or executing mutations.
 */
export function validatePhaseForAction(
  currentPhase: string,
  requestedAction: ActionName
): { valid: boolean; error?: string } {
  const config = PHASE_ACTION_CONTRACT[currentPhase];
  
  if (!config) {
    return { valid: false, error: `Unknown phase: ${currentPhase}` };
  }

  if (config.actionName !== requestedAction) {
    return {
      valid: false,
      error: `Action "${requestedAction}" is not valid for phase "${currentPhase}". Expected: "${config.actionName}"`,
    };
  }

  return { valid: true };
}

/**
 * Create an action context for logging and tracking.
 * Call this before executing any mutation.
 */
export function createActionContext(
  phase: string,
  endpoint: string | null,
  actionName: string
): ActionContext {
  return {
    action_id: crypto.randomUUID(),
    action_name: actionName,
    phase_at_click: phase,
    endpoint_expected: endpoint,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Log the action context to console with structured prefix.
 */
export function logActionStart(context: ActionContext): void {
  console.log(`[${context.action_name}] Starting action ${context.action_id}`);
  console.log(`[${context.action_name}] Phase at click: ${context.phase_at_click}`);
  console.log(`[${context.action_name}] Calling: ${context.endpoint_expected ?? "(no endpoint)"}`);
}

/**
 * Log action completion with result info.
 */
export function logActionComplete(
  context: ActionContext, 
  success: boolean, 
  error?: string
): void {
  if (success) {
    console.log(`[${context.action_name}] Action ${context.action_id} completed successfully`);
  } else {
    console.error(`[${context.action_name}] Action ${context.action_id} failed: ${error}`);
  }
}

/**
 * Get the appropriate action name for a step number (for legacy compatibility)
 */
export function getActionNameForStep(
  stepNumber: number, 
  actionType: "RUN" | "CONTINUE" | "APPROVE"
): ActionName {
  const stepActions: Record<number, Record<string, ActionName>> = {
    0: { RUN: "SPACE_ANALYSIS_START", CONTINUE: "SPACE_ANALYSIS_CONTINUE", APPROVE: "SPACE_ANALYSIS_CONTINUE" },
    1: { RUN: "TOP_DOWN_3D_START", CONTINUE: "TOP_DOWN_3D_APPROVE", APPROVE: "TOP_DOWN_3D_APPROVE" },
    2: { RUN: "STYLE_START", CONTINUE: "STYLE_APPROVE", APPROVE: "STYLE_APPROVE" },
    3: { RUN: "CAMERA_PLAN_EDIT", CONTINUE: "CAMERA_PLAN_CONTINUE", APPROVE: "CAMERA_PLAN_CONTINUE" },
    4: { RUN: "DETECT_SPACES_START", CONTINUE: "DETECT_SPACES_CONTINUE", APPROVE: "DETECT_SPACES_CONTINUE" },
    5: { RUN: "RENDERS_START", CONTINUE: "RENDERS_APPROVE", APPROVE: "RENDERS_APPROVE" },
    6: { RUN: "PANORAMAS_START", CONTINUE: "PANORAMAS_APPROVE", APPROVE: "PANORAMAS_APPROVE" },
    7: { RUN: "MERGE_START", CONTINUE: "MERGE_APPROVE", APPROVE: "MERGE_APPROVE" },
  };

  return stepActions[stepNumber]?.[actionType] ?? "PIPELINE_RETRY";
}
