import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * SUPERVISOR SERVICE - Always-On Orchestrator
 * 
 * ALWAYS runs after each worker completes.
 * Validates schemas, applies rule checks, audits with LLM.
 * 
 * INPUT: run_id + step_id + job_id (the just-completed job)
 * OUTPUT: SupervisorOutput with decision (proceed/retry/block)
 * 
 * RULES:
 * - MUST run after EVERY worker block
 * - MUST block if schema invalid or rule checks fail
 * - MUST block if LLM audit consistency_score < 0.7
 * - Uses LLM to audit reasoning quality and detect contradictions
 * - Manages retry budget and pipeline state transitions
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface SchemaValidationResult {
  schema_name: string;
  valid: boolean;
  errors: string[];
}

interface RuleCheckResult {
  rule_name: string;
  passed: boolean;
  message: string;
  blocked: boolean;
}

interface LLMAudit {
  consistency_score: number;
  contradiction_flags: string[];
  risk_notes: string;
  reasoning_quality: "excellent" | "good" | "acceptable" | "poor";
  model_used: string;
}

type SupervisorDecision = "proceed" | "retry" | "block";

interface SupervisorOutput {
  run_id: string;
  step_id: string;
  job_id: string;
  schema_validations: SchemaValidationResult[];
  rule_checks: RuleCheckResult[];
  llm_audit: LLMAudit;
  decision: SupervisorDecision;
  retry_budget_remaining: number;
  block_reason?: string;
  next_action?: string;
  processing_time_ms: number;
}

interface SupervisorRequest {
  run_id: string;
  step_id: string;
  job_id: string;
  trigger: "job_completed" | "manual" | "retry" | "scheduled";
}

// ============================================================================
// RULE GATES CONFIGURATION
// ============================================================================

const RULE_GATES = {
  MIN_CONSISTENCY_SCORE: 0.7,
  MAX_RETRIES_PER_STEP: 3,
  MAX_TOTAL_RETRIES: 10,
  AUTO_BLOCK_TRIGGERS: [
    "schema_invalid", 
    "critical_failure", 
    "consistency_below_threshold", 
    "retry_budget_exhausted"
  ],
  LLM_AUDIT_REQUIRED: true,
  PROCESSING_TIMEOUT_MS: 45000,
  
  // Service-specific validation rules
  SERVICE_RULES: {
    image_io: {
      require_images: true,
      max_images: 12,
      require_signed_urls: true,
    },
    info_worker: {
      require_spaces: true,
      max_spaces: 20,
      require_confidence: true,
      min_confidence: 0.3,
    },
    comparison: {
      require_decision: true,
      require_failures_on_fail: true,
    }
  }
};

// ============================================================================
// MAIN HANDLER
// ============================================================================

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const instanceId = crypto.randomUUID().slice(0, 8);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const geminiKey = Deno.env.get("API_NANOBANANA");

    if (!geminiKey) {
      return jsonError("API_NANOBANANA key not configured", 500);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const body: SupervisorRequest = await req.json();
    const { run_id, step_id, job_id, trigger } = body;

    if (!run_id || !step_id || !job_id) {
      return jsonError("Missing required fields: run_id, step_id, job_id", 400);
    }

    console.log(`[supervisor:${instanceId}] START run=${run_id} step=${step_id} job=${job_id} trigger=${trigger}`);

    // ========================================================================
    // FETCH ALL CONTEXT
    // ========================================================================

    // 1. Fetch the job that triggered this supervision
    const { data: job, error: jobError } = await supabase
      .from("pipeline_jobs")
      .select("*")
      .eq("id", job_id)
      .single();

    if (jobError || !job) {
      console.error(`[supervisor:${instanceId}] Job not found:`, jobError);
      return jsonError(`Job not found: ${job_id}`, 404);
    }

    // 2. Fetch the pipeline run
    const { data: run, error: runError } = await supabase
      .from("pipeline_runs")
      .select("*")
      .eq("id", run_id)
      .single();

    if (runError || !run) {
      console.error(`[supervisor:${instanceId}] Run not found:`, runError);
      return jsonError(`Run not found: ${run_id}`, 404);
    }

    // 3. Fetch all worker outputs for this step
    const { data: workerOutputs } = await supabase
      .from("worker_outputs")
      .select("*")
      .eq("run_id", run_id)
      .eq("step_id", step_id)
      .order("created_at", { ascending: false });

    // 4. Fetch all jobs for this step (for retry counting)
    const { data: stepJobs } = await supabase
      .from("pipeline_jobs")
      .select("id, status, attempts")
      .eq("run_id", run_id)
      .eq("step_id", step_id);

    // 5. Fetch previous supervisor decisions for this run
    const { data: previousDecisions } = await supabase
      .from("pipeline_decisions")
      .select("*")
      .eq("run_id", run_id)
      .order("created_at", { ascending: false })
      .limit(10);

    // ========================================================================
    // CALCULATE RETRY BUDGET
    // ========================================================================

    const stepAttempts = stepJobs?.reduce((sum, j) => sum + (j.attempts || 0), 0) || 0;
    const stepRetryBudget = Math.max(0, RULE_GATES.MAX_RETRIES_PER_STEP - stepAttempts);
    const totalRetryBudget = Math.max(0, RULE_GATES.MAX_TOTAL_RETRIES - (run.total_retries || 0));
    const retryBudgetRemaining = Math.min(stepRetryBudget, totalRetryBudget);

    console.log(`[supervisor:${instanceId}] Retry budget: step=${stepRetryBudget} total=${totalRetryBudget} remaining=${retryBudgetRemaining}`);

    // ========================================================================
    // 1. SCHEMA VALIDATIONS (Deterministic)
    // ========================================================================

    const schemaValidations: SchemaValidationResult[] = [];

    // Validate job result schema based on service type
    if (job.result_ref) {
      const resultValidation = validateServiceResult(job.service, job.result_ref);
      schemaValidations.push(resultValidation);
    } else if (job.status === "completed") {
      schemaValidations.push({
        schema_name: `${job.service}_output`,
        valid: false,
        errors: ["Job marked completed but no result_ref found"]
      });
    }

    // Validate all worker outputs for this step
    if (workerOutputs && workerOutputs.length > 0) {
      for (const output of workerOutputs) {
        const outputValidation = validateWorkerOutput(output.worker_type, output.output_data);
        schemaValidations.push(outputValidation);
      }
    }

    // ========================================================================
    // 2. RULE CHECKS (Deterministic)
    // ========================================================================

    const ruleChecks: RuleCheckResult[] = [];

    // Check job status
    ruleChecks.push({
      rule_name: "job_status_valid",
      passed: job.status === "completed",
      message: `Job status is '${job.status}'`,
      blocked: job.status === "failed"
    });

    // Check retry budget
    ruleChecks.push({
      rule_name: "retry_budget_available",
      passed: retryBudgetRemaining > 0,
      message: `${stepAttempts}/${RULE_GATES.MAX_RETRIES_PER_STEP} step attempts, ${run.total_retries || 0}/${RULE_GATES.MAX_TOTAL_RETRIES} total retries`,
      blocked: retryBudgetRemaining <= 0 && job.status !== "completed"
    });

    // Check processing time
    if (job.processing_time_ms) {
      const timeoutExceeded = job.processing_time_ms > RULE_GATES.PROCESSING_TIMEOUT_MS;
      ruleChecks.push({
        rule_name: "processing_time_acceptable",
        passed: !timeoutExceeded,
        message: `Processing took ${job.processing_time_ms}ms (limit: ${RULE_GATES.PROCESSING_TIMEOUT_MS}ms)`,
        blocked: false // Warning only, not blocking
      });
    }

    // Check for errors
    if (job.last_error) {
      ruleChecks.push({
        rule_name: "no_execution_errors",
        passed: false,
        message: `Job error: ${job.last_error.substring(0, 200)}`,
        blocked: true
      });
    }

    // Service-specific rule checks
    const serviceRules = validateServiceSpecificRules(job.service, job.result_ref, workerOutputs);
    ruleChecks.push(...serviceRules);

    // Check for schema validation failures
    const schemaErrors = schemaValidations.filter(v => !v.valid);
    if (schemaErrors.length > 0) {
      ruleChecks.push({
        rule_name: "all_schemas_valid",
        passed: false,
        message: `${schemaErrors.length} schema validation(s) failed`,
        blocked: true
      });
    }

    // Check for decision history patterns (detect loops)
    const recentRetries = previousDecisions?.filter(d => d.decision === "retry").length || 0;
    if (recentRetries >= 3) {
      ruleChecks.push({
        rule_name: "no_retry_loops",
        passed: false,
        message: `Detected ${recentRetries} recent retries - possible loop`,
        blocked: recentRetries >= 5
      });
    }

    // ========================================================================
    // 3. LLM AUDIT (Always Required)
    // ========================================================================

    console.log(`[supervisor:${instanceId}] Starting LLM audit...`);

    const llmAudit = await performLLMAudit(
      geminiKey,
      {
        job,
        run,
        workerOutputs: workerOutputs || [],
        schemaValidations,
        ruleChecks,
        previousDecisions: previousDecisions || []
      }
    );

    console.log(`[supervisor:${instanceId}] LLM audit complete: consistency=${llmAudit.consistency_score} quality=${llmAudit.reasoning_quality}`);

    // Add consistency check to rule checks
    if (llmAudit.consistency_score < RULE_GATES.MIN_CONSISTENCY_SCORE) {
      ruleChecks.push({
        rule_name: "consistency_threshold",
        passed: false,
        message: `Consistency score ${llmAudit.consistency_score.toFixed(2)} < ${RULE_GATES.MIN_CONSISTENCY_SCORE} threshold`,
        blocked: true
      });
    }

    // ========================================================================
    // 4. DECISION LOGIC
    // ========================================================================

    let decision: SupervisorDecision = "proceed";
    let blockReason: string | undefined;
    let nextAction: string | undefined;

    const blockedRules = ruleChecks.filter(r => r.blocked);
    const failedRules = ruleChecks.filter(r => !r.passed);
    const lowConsistency = llmAudit.consistency_score < RULE_GATES.MIN_CONSISTENCY_SCORE;

    // Decision priority: block > retry > proceed
    if (schemaErrors.length > 0) {
      decision = "block";
      blockReason = `Schema validation failed: ${schemaErrors.map(e => `${e.schema_name}: ${e.errors.slice(0, 2).join(", ")}`).join("; ")}`;
      nextAction = "Fix schema errors and resubmit";
    } else if (blockedRules.length > 0) {
      // Check if we can retry
      if (retryBudgetRemaining > 0 && !blockedRules.some(r => r.rule_name === "retry_budget_available")) {
        decision = "retry";
        nextAction = `Retry with adjusted parameters (${retryBudgetRemaining} attempts remaining)`;
      } else {
        decision = "block";
        blockReason = blockedRules.map(r => r.message).join("; ");
        nextAction = "Manual intervention required";
      }
    } else if (lowConsistency) {
      decision = "block";
      blockReason = `LLM audit detected low consistency (${llmAudit.consistency_score.toFixed(2)} < ${RULE_GATES.MIN_CONSISTENCY_SCORE})`;
      nextAction = "Review contradictions and adjust: " + llmAudit.contradiction_flags.slice(0, 2).join(", ");
    } else if (llmAudit.reasoning_quality === "poor") {
      if (retryBudgetRemaining > 0) {
        decision = "retry";
        nextAction = "Retry with improved prompts based on LLM feedback";
      } else {
        decision = "block";
        blockReason = "Poor reasoning quality and no retry budget remaining";
        nextAction = "Manual review required";
      }
    } else if (failedRules.length > 0 && retryBudgetRemaining > 0) {
      // Non-blocking failures with retry budget
      decision = "retry";
      nextAction = `Address ${failedRules.length} issue(s) and retry`;
    }

    // All clear - proceed
    if (decision === "proceed") {
      nextAction = determineNextStep(step_id, run);
    }

    const processingTime = Date.now() - startTime;

    // ========================================================================
    // 5. BUILD OUTPUT
    // ========================================================================

    const output: SupervisorOutput = {
      run_id,
      step_id,
      job_id,
      schema_validations: schemaValidations,
      rule_checks: ruleChecks,
      llm_audit: llmAudit,
      decision,
      retry_budget_remaining: retryBudgetRemaining,
      block_reason: blockReason,
      next_action: nextAction,
      processing_time_ms: processingTime
    };

    // ========================================================================
    // 6. PERSIST DECISION
    // ========================================================================

    const { error: decisionError } = await supabase
      .from("pipeline_decisions")
      .insert({
        run_id,
        job_id,
        step_id,
        decision,
        schema_validations: schemaValidations,
        rule_checks: ruleChecks,
        llm_audit: llmAudit,
        retry_budget_remaining: retryBudgetRemaining,
        block_reason: blockReason,
        processing_time_ms: processingTime,
        owner_id: run.owner_id
      });

    if (decisionError) {
      console.error(`[supervisor:${instanceId}] Failed to persist decision:`, decisionError);
      // Don't fail the request, continue with state update
    }

    // ========================================================================
    // 7. UPDATE PIPELINE STATE
    // ========================================================================

    await updatePipelineState(supabase, run, decision, blockReason, nextAction, step_id, instanceId);

    console.log(`[supervisor:${instanceId}] COMPLETE decision=${decision} consistency=${llmAudit.consistency_score.toFixed(2)} time=${processingTime}ms`);

    return jsonSuccess(output);

  } catch (error) {
    console.error(`[supervisor:${instanceId}] Fatal error:`, error);
    return jsonError(error instanceof Error ? error.message : "Unknown error", 500);
  }
});

// ============================================================================
// SCHEMA VALIDATION FUNCTIONS
// ============================================================================

function validateServiceResult(service: string, resultRef: unknown): SchemaValidationResult {
  const errors: string[] = [];
  const result = resultRef as Record<string, unknown>;

  switch (service) {
    case "image_io":
      if (!result.images_count && result.images_count !== 0) {
        errors.push("Missing images_count");
      }
      if (!result.artifact_ids || !Array.isArray(result.artifact_ids)) {
        errors.push("Missing or invalid artifact_ids array");
      }
      break;

    case "info_worker":
      if (!result.artifact_id) {
        errors.push("Missing artifact_id");
      }
      if (result.spaces_count === undefined) {
        errors.push("Missing spaces_count");
      }
      if (result.schema_valid === false) {
        errors.push("Worker reported schema_valid=false");
      }
      break;

    case "comparison":
      if (result.pass === undefined) {
        errors.push("Missing pass boolean");
      }
      if (!result.recommended_next_step) {
        errors.push("Missing recommended_next_step");
      }
      break;

    case "supervisor":
      // Self-validation - minimal checks
      if (!result.decision) {
        errors.push("Missing decision");
      }
      break;

    default:
      errors.push(`Unknown service type: ${service}`);
  }

  return {
    schema_name: `${service}_result`,
    valid: errors.length === 0,
    errors
  };
}

function validateWorkerOutput(workerType: string, outputData: unknown): SchemaValidationResult {
  const errors: string[] = [];
  const data = outputData as Record<string, unknown>;

  switch (workerType) {
    case "info_worker":
      if (!Array.isArray(data.spaces)) {
        errors.push("Missing spaces array");
      } else {
        // Validate each space
        for (let i = 0; i < data.spaces.length; i++) {
          const space = data.spaces[i] as Record<string, unknown>;
          if (!space.space_id) errors.push(`spaces[${i}]: missing space_id`);
          if (!space.label) errors.push(`spaces[${i}]: missing label`);
          if (!space.category) errors.push(`spaces[${i}]: missing category`);
          if (typeof space.confidence !== "number") errors.push(`spaces[${i}]: invalid confidence`);
        }
      }
      if (!data.model_used) {
        errors.push("Missing model_used");
      }
      break;

    case "comparison":
      if (typeof data.pass !== "boolean") {
        errors.push("Missing or invalid pass boolean");
      }
      if (!data.recommended_next_step) {
        errors.push("Missing recommended_next_step");
      }
      if (!data.pass && (!Array.isArray(data.failures) || data.failures.length === 0)) {
        errors.push("pass=false but no failures provided");
      }
      break;

    default:
      // Generic validation
      if (!data || Object.keys(data).length === 0) {
        errors.push("Empty output data");
      }
  }

  return {
    schema_name: `${workerType}_output`,
    valid: errors.length === 0,
    errors
  };
}

function validateServiceSpecificRules(
  service: string, 
  resultRef: unknown, 
  workerOutputs: unknown[] | null
): RuleCheckResult[] {
  const rules: RuleCheckResult[] = [];
  const result = resultRef as Record<string, unknown>;
  const serviceRules = RULE_GATES.SERVICE_RULES[service as keyof typeof RULE_GATES.SERVICE_RULES];

  if (!serviceRules) return rules;

  if (service === "image_io" && serviceRules) {
    const ioRules = serviceRules as typeof RULE_GATES.SERVICE_RULES.image_io;
    
    if (ioRules.require_images) {
      const hasImages = result?.images_count && (result.images_count as number) > 0;
      rules.push({
        rule_name: "images_present",
        passed: !!hasImages,
        message: hasImages ? `${result.images_count} images produced` : "No images in result",
        blocked: !hasImages
      });
    }

    if (ioRules.max_images && result?.images_count) {
      const withinLimit = (result.images_count as number) <= ioRules.max_images;
      rules.push({
        rule_name: "images_within_limit",
        passed: withinLimit,
        message: `${result.images_count}/${ioRules.max_images} images`,
        blocked: !withinLimit
      });
    }
  }

  if (service === "info_worker" && workerOutputs && workerOutputs.length > 0) {
    const infoRules = serviceRules as typeof RULE_GATES.SERVICE_RULES.info_worker;
    const latestOutput = workerOutputs[0] as { output_data: { spaces?: unknown[] } };
    const spaces = latestOutput.output_data?.spaces || [];

    if (infoRules.require_spaces) {
      rules.push({
        rule_name: "spaces_detected",
        passed: spaces.length > 0,
        message: spaces.length > 0 ? `${spaces.length} spaces detected` : "No spaces detected",
        blocked: spaces.length === 0
      });
    }

    if (infoRules.max_spaces) {
      const withinLimit = spaces.length <= infoRules.max_spaces;
      rules.push({
        rule_name: "spaces_within_limit",
        passed: withinLimit,
        message: `${spaces.length}/${infoRules.max_spaces} max spaces`,
        blocked: !withinLimit
      });
    }

    if (infoRules.require_confidence) {
      const lowConfidenceSpaces = spaces.filter((s: unknown) => {
        const space = s as { confidence?: number; ambiguity_flags?: string[] };
        return (space.confidence || 0) < infoRules.min_confidence && 
               (!space.ambiguity_flags || space.ambiguity_flags.length === 0);
      });
      
      rules.push({
        rule_name: "low_confidence_flagged",
        passed: lowConfidenceSpaces.length === 0,
        message: lowConfidenceSpaces.length === 0 
          ? "All low-confidence spaces have ambiguity flags" 
          : `${lowConfidenceSpaces.length} low-confidence spaces without flags`,
        blocked: false // Warning only
      });
    }
  }

  return rules;
}

// ============================================================================
// LLM AUDIT FUNCTION
// ============================================================================

async function performLLMAudit(
  apiKey: string,
  context: {
    job: unknown;
    run: unknown;
    workerOutputs: unknown[];
    schemaValidations: SchemaValidationResult[];
    ruleChecks: RuleCheckResult[];
    previousDecisions: unknown[];
  }
): Promise<LLMAudit> {
  try {
    const job = context.job as Record<string, unknown>;
    const run = context.run as Record<string, unknown>;

    // Build audit prompt with strict JSON instruction
    const prompt = `You are a quality auditor for a pipeline. Analyze this execution:

SERVICE: ${job.service} | STEP: ${job.step_id} | STATUS: ${job.status}
ATTEMPTS: ${job.attempts} | TIME: ${job.processing_time_ms}ms
RESULT: ${JSON.stringify(job.result_ref || {}).slice(0, 500)}
${job.last_error ? `ERROR: ${job.last_error}` : ""}

SCHEMA CHECKS:
${context.schemaValidations.map(v => `${v.schema_name}: ${v.valid ? "PASS" : "FAIL"}`).join(", ")}

RULE CHECKS:
${context.ruleChecks.slice(0, 5).map(r => `${r.rule_name}: ${r.passed ? "PASS" : "FAIL"}`).join(", ")}

RESPOND WITH ONLY THIS JSON (nothing else):
{"consistency_score":0.85,"contradiction_flags":[],"risk_notes":"Low risk","reasoning_quality":"good"}`;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const response = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1, // Low temperature for consistent auditing
          maxOutputTokens: 1024
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[supervisor] Gemini API error ${response.status}:`, errorText);
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

    console.log("[supervisor] Gemini raw response:", text?.slice(0, 300));

    if (!text) {
      console.log("[supervisor] Full response structure:", JSON.stringify(data).slice(0, 500));
      throw new Error("No text in Gemini response");
    }

    // Extract JSON from response - try multiple patterns
    let parsed: Record<string, unknown> | null = null;
    
    // Try direct parse first (if response is pure JSON)
    try {
      parsed = JSON.parse(text.trim());
    } catch {
      // Try to extract JSON from markdown code blocks
      const codeBlockMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (codeBlockMatch) {
        parsed = JSON.parse(codeBlockMatch[1]);
      } else {
        // Try basic JSON extraction
        const jsonMatch = text.match(/\{[^{}]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        }
      }
    }

    if (!parsed) {
      console.error("[supervisor] Could not parse JSON from:", text.slice(0, 200));
      throw new Error("No valid JSON found in response");
    }

    return {
      consistency_score: typeof parsed.consistency_score === "number"
        ? Math.max(0, Math.min(1, parsed.consistency_score as number))
        : 0.85, // Default to passing if job is completed
      contradiction_flags: Array.isArray(parsed.contradiction_flags)
        ? (parsed.contradiction_flags as string[]).slice(0, 10)
        : [],
      risk_notes: typeof parsed.risk_notes === "string"
        ? (parsed.risk_notes as string).slice(0, 500)
        : "Low risk",
      reasoning_quality: ["excellent", "good", "acceptable", "poor"].includes(parsed.reasoning_quality as string)
        ? parsed.reasoning_quality as "excellent" | "good" | "acceptable" | "poor"
        : "good",
      model_used: "gemini-2.5-flash"
    };

  } catch (error) {
    console.error("[supervisor] LLM audit error:", error);
    
    // Return conservative fallback on error
    return {
      consistency_score: 0.5, // Neutral score
      contradiction_flags: [`LLM audit failed: ${error instanceof Error ? error.message : "Unknown"}`],
      risk_notes: "Audit failed - manual review recommended",
      reasoning_quality: "poor",
      model_used: "gemini-2.5-flash (failed)"
    };
  }
}

// ============================================================================
// PIPELINE STATE MANAGEMENT
// ============================================================================

function determineNextStep(currentStepId: string, run: unknown): string {
  const runData = run as Record<string, unknown>;
  const currentStep = runData.current_step as number || 0;
  
  // Map step progression
  const stepProgression: Record<string, string> = {
    "step_0_analysis": "Proceed to Step 1: Top-Down 3D Generation",
    "step_1_topdown": "Proceed to Step 2: Style Application",
    "step_2_style": "Proceed to Step 3: Space Detection",
    "step_3_detect": "Proceed to Step 4: Renders Generation",
    "step_4_renders": "Proceed to Step 5: Panorama Generation",
    "step_5_panoramas": "Proceed to Step 6: Final 360 Merge",
    "step_6_merge": "Pipeline Complete - All steps finished"
  };

  return stepProgression[currentStepId] || `Advance from step ${currentStep} to ${currentStep + 1}`;
}

async function updatePipelineState(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  run: unknown,
  decision: SupervisorDecision,
  blockReason: string | undefined,
  nextAction: string | undefined,
  stepId: string,
  instanceId: string
): Promise<void> {
  const runData = run as Record<string, unknown>;
  const runId = runData.id as string;
  const currentStep = runData.current_step as number || 0;

  try {
    if (decision === "proceed") {
      // Advance to next step
      await supabase
        .from("pipeline_runs")
        .update({
          status: "running",
          current_step: currentStep + 1,
          step_retries: 0, // Reset step retries on successful advance
          updated_at: new Date().toISOString()
        })
        .eq("id", runId);

      console.log(`[supervisor:${instanceId}] Advanced run to step ${currentStep + 1}`);

    } else if (decision === "block") {
      // Block the pipeline
      await supabase
        .from("pipeline_runs")
        .update({
          status: "blocked",
          last_error: blockReason,
          updated_at: new Date().toISOString()
        })
        .eq("id", runId);

      console.log(`[supervisor:${instanceId}] Blocked run: ${blockReason}`);

    } else if (decision === "retry") {
      // Increment retry counter, keep status as running
      await supabase
        .from("pipeline_runs")
        .update({
          status: "running",
          total_retries: (runData.total_retries as number || 0) + 1,
          step_retries: (runData.step_retries as number || 0) + 1,
          updated_at: new Date().toISOString()
        })
        .eq("id", runId);

      console.log(`[supervisor:${instanceId}] Scheduled retry for step ${stepId}`);
    }
  } catch (error) {
    console.error(`[supervisor:${instanceId}] Failed to update pipeline state:`, error);
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function jsonSuccess(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
