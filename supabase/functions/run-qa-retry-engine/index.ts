import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";

/**
 * QA RETRY ENGINE
 * 
 * Orchestrates automatic retries for pipeline steps that fail AI-QA.
 * Enforces strict retry limits and safety rules to prevent infinite loops.
 * 
 * CRITICAL SAFETY RULES:
 * 1. Each retry MUST differ from the previous attempt
 * 2. Max attempts per step (default: 5)
 * 3. Max total attempts per run (default: 20)
 * 4. Exponential backoff between retries
 * 5. Critical severity or manual_review suggestion = block auto-retry
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ============================================================================
// RETRY ENGINE CONFIGURATION
// ============================================================================

const RETRY_CONFIG = {
  DEFAULT_MAX_ATTEMPTS_PER_STEP: 5,
  MAX_TOTAL_ATTEMPTS_PER_RUN: 20,
  BASE_RETRY_DELAY_SECONDS: 2,
  MAX_RETRY_DELAY_SECONDS: 30,
  BLOCK_AUTO_RETRY_SEVERITIES: ["critical"],
  BLOCK_AUTO_RETRY_SUGGESTIONS: ["manual_review"],
  MIN_CONFIDENCE_FOR_AUTO_RETRY: 0.3,
};

// ============================================================================
// TYPES
// ============================================================================

interface StructuredQAResult {
  status: "PASS" | "FAIL";
  reason_short: string;
  reasons: Array<{ code: string; description: string }>;
  evidence: Array<{ observation: string; location?: string; confidence?: number }>;
  severity: "low" | "medium" | "high" | "critical";
  retry_suggestion: {
    type: "prompt_delta" | "settings_delta" | "seed_change" | "input_change" | "manual_review";
    instruction: string;
    priority?: number;
  };
  confidence_score: number;
  debug_context?: Record<string, unknown>;
}

interface StepRetryState {
  attempt_count: number;
  max_attempts: number;
  auto_retry_enabled: boolean;
  last_qa_result: StructuredQAResult | null;
  last_retry_delta: {
    changes_made: string[];
    suggestion_applied: { type: string; instruction: string } | null;
  } | null;
  status: "pending" | "running" | "qa_pass" | "qa_fail" | "blocked_for_human";
  created_at: string;
  updated_at: string;
}

interface RetryDecision {
  should_retry: boolean;
  reason: string;
  next_action: "retry" | "block_for_human" | "proceed";
  retry_delta?: {
    changes_made: string[];
    new_seed?: number;
    prompt_adjustments?: string[];
    settings_adjustments?: Record<string, unknown>;
  };
  delay_seconds?: number;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function jsonError(message: string, status = 400) {
  return new Response(
    JSON.stringify({ ok: false, error: message }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

function jsonSuccess(data: Record<string, unknown>) {
  return new Response(
    JSON.stringify({ ok: true, ...data }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

/**
 * Calculate exponential backoff delay
 */
function calculateRetryDelay(attemptNumber: number): number {
  const delay = RETRY_CONFIG.BASE_RETRY_DELAY_SECONDS * Math.pow(2, attemptNumber - 1);
  return Math.min(delay, RETRY_CONFIG.MAX_RETRY_DELAY_SECONDS);
}

/**
 * Determine if auto-retry is eligible based on QA result and current state
 */
function evaluateRetryEligibility(
  qaResult: StructuredQAResult,
  currentState: StepRetryState,
  totalRetryCount: number
): RetryDecision {
  // Check if auto-retry is disabled
  if (!currentState.auto_retry_enabled) {
    return {
      should_retry: false,
      reason: "Auto-retry is disabled for this step",
      next_action: "block_for_human",
    };
  }

  // Check step attempt limit
  if (currentState.attempt_count >= currentState.max_attempts) {
    return {
      should_retry: false,
      reason: `Max attempts reached (${currentState.attempt_count}/${currentState.max_attempts})`,
      next_action: "block_for_human",
    };
  }

  // Check total retry limit
  if (totalRetryCount >= RETRY_CONFIG.MAX_TOTAL_ATTEMPTS_PER_RUN) {
    return {
      should_retry: false,
      reason: `Total retry budget exhausted (${totalRetryCount}/${RETRY_CONFIG.MAX_TOTAL_ATTEMPTS_PER_RUN})`,
      next_action: "block_for_human",
    };
  }

  // Check severity
  if (RETRY_CONFIG.BLOCK_AUTO_RETRY_SEVERITIES.includes(qaResult.severity)) {
    return {
      should_retry: false,
      reason: `Severity '${qaResult.severity}' requires human review`,
      next_action: "block_for_human",
    };
  }

  // Check suggestion type
  if (RETRY_CONFIG.BLOCK_AUTO_RETRY_SUGGESTIONS.includes(qaResult.retry_suggestion.type)) {
    return {
      should_retry: false,
      reason: `Suggestion type '${qaResult.retry_suggestion.type}' requires human review`,
      next_action: "block_for_human",
    };
  }

  // Check confidence
  if (qaResult.confidence_score < RETRY_CONFIG.MIN_CONFIDENCE_FOR_AUTO_RETRY) {
    return {
      should_retry: false,
      reason: `Low QA confidence (${qaResult.confidence_score}) requires human review`,
      next_action: "block_for_human",
    };
  }

  // Eligible for auto-retry - build retry delta
  const retryDelta = buildRetryDelta(qaResult, currentState);
  const delaySeconds = calculateRetryDelay(currentState.attempt_count + 1);

  return {
    should_retry: true,
    reason: `Auto-retry eligible (attempt ${currentState.attempt_count + 1}/${currentState.max_attempts})`,
    next_action: "retry",
    retry_delta: retryDelta,
    delay_seconds: delaySeconds,
  };
}

/**
 * Build the changes to apply for the next retry attempt
 */
function buildRetryDelta(
  qaResult: StructuredQAResult,
  _currentState: StepRetryState
): RetryDecision["retry_delta"] {
  const changes: string[] = [];
  const promptAdjustments: string[] = [];
  const settingsAdjustments: Record<string, unknown> = {};

  switch (qaResult.retry_suggestion.type) {
    case "prompt_delta":
      // Add the suggested instruction as a constraint
      promptAdjustments.push(qaResult.retry_suggestion.instruction);
      changes.push(`Applied prompt constraint: ${qaResult.retry_suggestion.instruction}`);
      break;

    case "settings_delta":
      // Reduce creativity / tighten constraints
      settingsAdjustments.temperature = 0.3;
      settingsAdjustments.guidance_scale = 12;
      changes.push("Reduced creativity (temperature=0.3, guidance=12)");
      break;

    case "seed_change":
      // Generate new random seed
      const newSeed = Math.floor(Math.random() * 2147483647);
      changes.push(`Changed seed to ${newSeed}`);
      return {
        changes_made: changes,
        new_seed: newSeed,
        prompt_adjustments: promptAdjustments,
        settings_adjustments: settingsAdjustments,
      };

    case "input_change":
      // Flag for input modification (requires upstream handling)
      changes.push("Flagged for input modification");
      settingsAdjustments.input_modified = true;
      break;

    default:
      // Generic retry with seed change
      const fallbackSeed = Math.floor(Math.random() * 2147483647);
      changes.push(`Generic retry with new seed ${fallbackSeed}`);
      return {
        changes_made: changes,
        new_seed: fallbackSeed,
        prompt_adjustments: [],
        settings_adjustments: {},
      };
  }

  // Add reason-specific adjustments
  for (const reason of qaResult.reasons) {
    switch (reason.code) {
      case "GEOMETRY_DISTORTION":
      case "WALL_RECTIFICATION":
        promptAdjustments.push("CRITICAL: Preserve ALL wall angles exactly as shown. Do NOT straighten angled walls.");
        changes.push("Added geometry preservation constraint");
        break;

      case "SCALE_MISMATCH":
      case "FURNITURE_MISMATCH":
        promptAdjustments.push("CRITICAL: Maintain exact scale and proportions from floor plan dimensions.");
        changes.push("Added scale preservation constraint");
        break;

      case "STYLE_INCONSISTENCY":
        promptAdjustments.push("CRITICAL: Match the design style exactly as specified in the style reference.");
        changes.push("Added style consistency constraint");
        break;

      case "MISSING_FURNISHINGS":
        promptAdjustments.push("CRITICAL: Include all required furniture items for this room type.");
        changes.push("Added furniture completeness constraint");
        break;
    }
  }

  return {
    changes_made: changes,
    new_seed: Math.floor(Math.random() * 2147483647),
    prompt_adjustments: promptAdjustments,
    settings_adjustments: settingsAdjustments,
  };
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonError("Unauthorized", 401);
    }

    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const token = authHeader.replace("Bearer ", "");
    const { data: userData } = await serviceClient.auth.getUser(token);
    if (!userData?.user) {
      return jsonError("Unauthorized", 401);
    }
    const userId = userData.user.id;

    // Parse request
    const body = await req.json();
    const { 
      pipeline_id, 
      step_number, 
      qa_result,
      action // "evaluate" | "execute_retry" | "stop_auto_retry" | "enable_auto_retry"
    } = body;

    if (!pipeline_id || step_number === undefined) {
      return jsonError("pipeline_id and step_number required");
    }

    // Fetch pipeline
    const { data: pipeline, error: pipelineError } = await serviceClient
      .from("floorplan_pipelines")
      .select("*")
      .eq("id", pipeline_id)
      .eq("owner_id", userId)
      .single();

    if (pipelineError || !pipeline) {
      return jsonError("Pipeline not found", 404);
    }

    // Get or initialize step retry state
    const stepRetryState = (pipeline.step_retry_state || {}) as Record<string, StepRetryState>;
    const stepKey = `step_${step_number}`;
    
    let currentStepState: StepRetryState = stepRetryState[stepKey] || {
      attempt_count: 0,
      max_attempts: RETRY_CONFIG.DEFAULT_MAX_ATTEMPTS_PER_STEP,
      auto_retry_enabled: pipeline.auto_retry_enabled ?? true,
      last_qa_result: null,
      last_retry_delta: null,
      status: "pending",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const totalRetryCount = pipeline.total_retry_count || 0;

    // Handle different actions
    switch (action) {
      case "stop_auto_retry": {
        currentStepState.auto_retry_enabled = false;
        currentStepState.updated_at = new Date().toISOString();
        stepRetryState[stepKey] = currentStepState;

        await serviceClient
          .from("floorplan_pipelines")
          .update({ step_retry_state: stepRetryState })
          .eq("id", pipeline_id);

        console.log(`[run-qa-retry-engine] Stopped auto-retry for step ${step_number}`);
        return jsonSuccess({ 
          message: "Auto-retry stopped", 
          step_state: currentStepState 
        });
      }

      case "enable_auto_retry": {
        currentStepState.auto_retry_enabled = true;
        currentStepState.updated_at = new Date().toISOString();
        stepRetryState[stepKey] = currentStepState;

        await serviceClient
          .from("floorplan_pipelines")
          .update({ step_retry_state: stepRetryState })
          .eq("id", pipeline_id);

        console.log(`[run-qa-retry-engine] Enabled auto-retry for step ${step_number}`);
        return jsonSuccess({ 
          message: "Auto-retry enabled", 
          step_state: currentStepState 
        });
      }

      case "evaluate": {
        // Evaluate a QA result and decide on next action
        if (!qa_result) {
          return jsonError("qa_result required for evaluate action");
        }

        const structuredQA = qa_result as StructuredQAResult;

        // If QA passed, update state and return
        if (structuredQA.status === "PASS") {
          currentStepState.status = "qa_pass";
          currentStepState.last_qa_result = structuredQA;
          currentStepState.updated_at = new Date().toISOString();
          stepRetryState[stepKey] = currentStepState;

          await serviceClient
            .from("floorplan_pipelines")
            .update({ step_retry_state: stepRetryState })
            .eq("id", pipeline_id);

          return jsonSuccess({
            decision: "proceed",
            message: "QA passed",
            step_state: currentStepState,
          });
        }

        // QA failed - evaluate retry eligibility
        const decision = evaluateRetryEligibility(structuredQA, currentStepState, totalRetryCount);

        // Update state with QA result
        currentStepState.last_qa_result = structuredQA;
        currentStepState.status = decision.should_retry ? "qa_fail" : "blocked_for_human";
        currentStepState.updated_at = new Date().toISOString();

        if (decision.should_retry && decision.retry_delta) {
          currentStepState.last_retry_delta = {
            changes_made: decision.retry_delta.changes_made,
            suggestion_applied: structuredQA.retry_suggestion,
          };
        }

        stepRetryState[stepKey] = currentStepState;

        // Update pipeline status
        const newStatus = decision.should_retry 
          ? `step${step_number}_qa_fail` 
          : "blocked_for_human";

        await serviceClient
          .from("floorplan_pipelines")
          .update({ 
            step_retry_state: stepRetryState,
            status: newStatus,
          })
          .eq("id", pipeline_id);

        // Emit event
        await serviceClient.from("floorplan_pipeline_events").insert({
          pipeline_id,
          owner_id: userId,
          step_number,
          type: decision.should_retry ? "qa_fail_auto_retry" : "qa_fail_blocked",
          message: decision.reason,
          progress_int: 0,
        });

        console.log(`[run-qa-retry-engine] Step ${step_number} evaluation: ${decision.next_action} - ${decision.reason}`);

        return jsonSuccess({
          decision: decision.next_action,
          should_retry: decision.should_retry,
          reason: decision.reason,
          retry_delta: decision.retry_delta,
          delay_seconds: decision.delay_seconds,
          step_state: currentStepState,
        });
      }

      case "execute_retry": {
        // Execute the retry for a step
        if (!currentStepState.auto_retry_enabled) {
          return jsonError("Auto-retry is disabled for this step");
        }

        if (currentStepState.attempt_count >= currentStepState.max_attempts) {
          return jsonError("Max attempts reached");
        }

        // Increment attempt count
        currentStepState.attempt_count += 1;
        currentStepState.status = "running";
        currentStepState.updated_at = new Date().toISOString();
        stepRetryState[stepKey] = currentStepState;

        // Update pipeline
        await serviceClient
          .from("floorplan_pipelines")
          .update({ 
            step_retry_state: stepRetryState,
            total_retry_count: totalRetryCount + 1,
            status: `step${step_number}_running`,
          })
          .eq("id", pipeline_id);

        // Emit retry event
        await serviceClient.from("floorplan_pipeline_events").insert({
          pipeline_id,
          owner_id: userId,
          step_number,
          type: "auto_retry_started",
          message: `Auto-retry attempt ${currentStepState.attempt_count}/${currentStepState.max_attempts}`,
          progress_int: 5,
        });

        console.log(`[run-qa-retry-engine] Executing retry ${currentStepState.attempt_count} for step ${step_number}`);

        return jsonSuccess({
          message: `Retry ${currentStepState.attempt_count} initiated`,
          attempt_number: currentStepState.attempt_count,
          retry_delta: currentStepState.last_retry_delta,
          step_state: currentStepState,
        });
      }

      default: {
        // Get current state
        return jsonSuccess({
          step_state: currentStepState,
          total_retry_count: totalRetryCount,
          pipeline_status: pipeline.status,
        });
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[run-qa-retry-engine] Error: ${message}`);
    return jsonError(message, 500);
  }
});
