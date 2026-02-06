import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { 
  validateInfoWorkerOutput, 
  validateComparisonWorkerOutput,
  type ValidationResult 
} from "../_shared/schema-validator.ts";
import {
  RULE_GATES,
  type ComparisonWorkerOutput,
  type ComparisonFailure,
  type ComparisonFix,
  type RecommendedNextStep,
  type Severity,
  type FailureType,
  type SpaceInfo
} from "../_shared/pipeline-schemas.ts";

/**
 * COMPARISON WORKER SERVICE
 * 
 * Validates worker outputs against user requests and schemas.
 * Uses LLM + deterministic rules to decide PASS/FAIL.
 * 
 * INPUT: run_id + step_id + info_worker_output_artifact_id + user_request
 * OUTPUT: ComparisonWorkerOutput with pass/fail + fixes
 * 
 * VALIDATION STAGES:
 * 1. Schema validation of Info Worker output
 * 2. Deterministic rule checks (space count, confidence, ambiguity)
 * 3. LLM comparison against user request (if provided)
 * 4. Severity assessment and next step recommendation
 * 
 * RULES:
 * - Must reference user request constraints explicitly
 * - Must NOT trigger image generation
 * - Critical failures = auto-block
 * - Must provide fixes for failures
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ComparisonRequest {
  run_id: string;
  step_id: string;
  info_artifact_id?: string;    // ID of info worker output artifact
  info_output?: object;         // Direct info output (alternative to artifact_id)
  user_request?: string;        // Original user request/constraints
  expected_spaces?: number;     // Optional expected space count
  expected_room_types?: string[]; // Optional expected room types
  style_constraints?: string;   // Optional style constraints
  quality_expected?: string;    // Expected quality tier
}

// Extended rule gates for comparison
const COMPARISON_RULES = {
  ...RULE_GATES.COMPARISON_WORKER,
  // Additional comparison-specific rules
  MIN_SPACES_FOR_FLOORPLAN: 2,
  MAX_LOW_CONFIDENCE_RATIO: 0.5,  // Max 50% of spaces can be low confidence
  MAX_AMBIGUOUS_RATIO: 0.3,       // Max 30% of spaces can have ambiguity flags
  REQUIRE_FURNISHINGS_IN_HABITABLE: true,  // Habitable rooms must have furnishings
  HABITABLE_CATEGORIES: ["bedroom", "living_room", "dining_room", "kitchen", "office"],
  CRITICAL_MISSING_SPACES: ["bathroom", "bedroom", "kitchen"],  // These are critical if missing
};

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
      return jsonError("API_NANOBANANA not configured", 500);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Parse request
    const body: ComparisonRequest = await req.json();
    const { 
      run_id, 
      step_id, 
      info_artifact_id, 
      info_output: directInfoOutput,
      user_request, 
      expected_spaces,
      expected_room_types,
      style_constraints,
      quality_expected
    } = body;

    if (!run_id || !step_id) {
      return jsonError("run_id and step_id are required", 400);
    }

    console.log(`[comparison-worker] START run=${run_id} step=${step_id} instance=${instanceId}`);

    // DEDUPLICATION: Check if job is already running
    const { data: isRunning } = await supabase.rpc("is_job_running", {
      p_run_id: run_id,
      p_step_id: step_id,
      p_service: "comparison"
    });

    if (isRunning) {
      console.log(`[comparison-worker] Job already running, returning 409`);
      return jsonError("Job already running", 409);
    }

    // Get user ID from run
    const { data: runData, error: runError } = await supabase
      .from("pipeline_runs")
      .select("owner_id")
      .eq("id", run_id)
      .maybeSingle();

    if (runError || !runData) {
      return jsonError("Pipeline run not found", 404);
    }

    const userId = runData.owner_id;

    // CREATE JOB RECORD with lock
    const { data: newJob, error: createError } = await supabase
      .from("pipeline_jobs")
      .insert({
        run_id,
        step_id,
        service: "comparison",
        status: "running",
        payload_ref: { 
          info_artifact_id, 
          user_request: user_request?.slice(0, 500),
          expected_spaces,
          expected_room_types 
        },
        locked_at: new Date().toISOString(),
        locked_by: instanceId,
        started_at: new Date().toISOString(),
        owner_id: userId,
        idempotency_key: `${run_id}:${step_id}:comparison:${Date.now()}`
      })
      .select("id")
      .single();

    if (createError) {
      console.error("[comparison-worker] Failed to create job:", createError);
      return jsonError("Failed to create job", 500);
    }

    const jobId = newJob.id;

    try {
      // ======================================================================
      // STEP 1: FETCH INFO WORKER OUTPUT
      // ======================================================================
      let infoOutput: any = directInfoOutput;

      if (!infoOutput && info_artifact_id) {
        const { data: infoArtifact, error: artifactError } = await supabase
          .from("pipeline_artifacts")
          .select("metadata_json")
          .eq("id", info_artifact_id)
          .single();

        if (artifactError || !infoArtifact) {
          await releaseJob(supabase, jobId, "failed", "Info artifact not found", startTime);
          return jsonError("Info artifact not found", 404);
        }

        infoOutput = infoArtifact.metadata_json;
      }

      if (!infoOutput) {
        // Try to find most recent info worker output for this run/step
        const { data: workerOutput } = await supabase
          .from("worker_outputs")
          .select("output_data")
          .eq("run_id", run_id)
          .eq("worker_type", "info")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (workerOutput) {
          infoOutput = workerOutput.output_data;
        }
      }

      if (!infoOutput) {
        await releaseJob(supabase, jobId, "failed", "No info worker output found", startTime);
        return jsonError("No info worker output found - provide info_artifact_id or info_output", 400);
      }

      // ======================================================================
      // STEP 2: SCHEMA VALIDATION OF INFO WORKER OUTPUT
      // ======================================================================
      const schemaValidation = validateInfoWorkerOutput(infoOutput);
      const failures: ComparisonFailure[] = [];
      const fixes: ComparisonFix[] = [];

      if (!schemaValidation.valid) {
        failures.push({
          type: "schema_invalid",
          description: `Info Worker output failed schema validation: ${schemaValidation.block_reasons.join("; ")}`,
          severity: "critical"
        });
        fixes.push({
          target: "manual_review",
          action: "Review Info Worker implementation - output schema is invalid",
          expected_effect: "Info Worker returns valid schema",
          priority: 1
        });
      }

      // Add rule check failures from schema validation
      for (const rule of schemaValidation.rule_results) {
        if (!rule.passed) {
          failures.push({
            type: rule.blocked ? "constraint_violation" : "ambiguity_unresolved",
            description: rule.message,
            severity: rule.blocked ? "high" : "medium"
          });
        }
      }

      const spaces: SpaceInfo[] = infoOutput?.spaces || [];

      // ======================================================================
      // STEP 3: DETERMINISTIC RULE CHECKS
      // ======================================================================

      // Check 3.1: Minimum spaces for a floor plan
      if (spaces.length < COMPARISON_RULES.MIN_SPACES_FOR_FLOORPLAN) {
        failures.push({
          type: "missing_space",
          description: `Floor plan has only ${spaces.length} spaces, expected at least ${COMPARISON_RULES.MIN_SPACES_FOR_FLOORPLAN}`,
          severity: "high",
          expected: `≥${COMPARISON_RULES.MIN_SPACES_FOR_FLOORPLAN}`,
          actual: String(spaces.length)
        });
        fixes.push({
          target: "input",
          action: "Ensure floor plan image is clear and shows all rooms",
          expected_effect: "More spaces detected",
          priority: 1
        });
      }

      // Check 3.2: Expected space count (if provided)
      if (expected_spaces !== undefined && spaces.length !== expected_spaces) {
        const diff = spaces.length - expected_spaces;
        const severity: Severity = Math.abs(diff) > 2 ? "high" : "medium";
        failures.push({
          type: diff > 0 ? "extra_space" : "missing_space",
          description: `Expected ${expected_spaces} spaces, found ${spaces.length} (difference: ${diff > 0 ? '+' : ''}${diff})`,
          severity,
          expected: String(expected_spaces),
          actual: String(spaces.length)
        });
        fixes.push({
          target: "prompt",
          action: `Adjust space detection to find exactly ${expected_spaces} spaces`,
          expected_effect: "Correct space count",
          priority: 2
        });
      }

      // Check 3.3: Expected room types (if provided)
      if (expected_room_types && expected_room_types.length > 0) {
        const detectedCategories = new Set(spaces.map(s => s.category));
        for (const expectedType of expected_room_types) {
          if (!detectedCategories.has(expectedType as any)) {
            const isCritical = COMPARISON_RULES.CRITICAL_MISSING_SPACES.includes(expectedType);
            failures.push({
              type: "missing_space",
              description: `Expected room type "${expectedType}" was not detected`,
              severity: isCritical ? "high" : "medium",
              expected: expectedType
            });
          }
        }
      }

      // Check 3.4: Critical spaces present
      const detectedCategories = new Set(spaces.map(s => s.category));
      for (const criticalSpace of COMPARISON_RULES.CRITICAL_MISSING_SPACES) {
        // Only check if this is a residential floor plan (has at least one bedroom or living room)
        const isResidential = detectedCategories.has("bedroom") || detectedCategories.has("living_room");
        if (isResidential && !detectedCategories.has(criticalSpace as any) && criticalSpace !== "kitchen") {
          // Kitchen is optional for some units
          failures.push({
            type: "missing_space",
            description: `Critical space "${criticalSpace}" not detected in residential floor plan`,
            severity: "medium",
            expected: criticalSpace
          });
        }
      }

      // Check 3.5: Low confidence ratio
      const lowConfidenceSpaces = spaces.filter(s => s.confidence < RULE_GATES.INFO_WORKER.MIN_CONFIDENCE_THRESHOLD);
      const lowConfidenceRatio = spaces.length > 0 ? lowConfidenceSpaces.length / spaces.length : 0;
      
      if (lowConfidenceRatio > COMPARISON_RULES.MAX_LOW_CONFIDENCE_RATIO) {
        failures.push({
          type: "ambiguity_unresolved",
          description: `${Math.round(lowConfidenceRatio * 100)}% of spaces have low confidence (>${Math.round(COMPARISON_RULES.MAX_LOW_CONFIDENCE_RATIO * 100)}% threshold)`,
          severity: "high"
        });
        fixes.push({
          target: "input",
          action: "Provide clearer floor plan image or higher resolution",
          expected_effect: "Higher confidence space detection",
          priority: 1
        });
      }

      // Add individual low-confidence space failures
      for (const space of lowConfidenceSpaces) {
        failures.push({
          type: "ambiguity_unresolved",
          description: `Space "${space.label}" has low confidence (${(space.confidence * 100).toFixed(0)}%)`,
          severity: space.confidence < 0.2 ? "high" : "medium",
          affected_space_id: space.space_id
        });
      }

      // Check 3.6: Ambiguity flags ratio
      const ambiguousSpaces = spaces.filter(s => s.ambiguity_flags && s.ambiguity_flags.length > 0);
      const ambiguousRatio = spaces.length > 0 ? ambiguousSpaces.length / spaces.length : 0;
      
      if (ambiguousRatio > COMPARISON_RULES.MAX_AMBIGUOUS_RATIO) {
        failures.push({
          type: "ambiguity_unresolved",
          description: `${Math.round(ambiguousRatio * 100)}% of spaces have ambiguity flags (>${Math.round(COMPARISON_RULES.MAX_AMBIGUOUS_RATIO * 100)}% threshold)`,
          severity: "medium"
        });
        fixes.push({
          target: "manual_review",
          action: "Review ambiguous spaces and clarify room types",
          expected_effect: "Resolved ambiguities",
          priority: 2
        });
      }

      // Check 3.7: Furnishings in habitable spaces
      if (COMPARISON_RULES.REQUIRE_FURNISHINGS_IN_HABITABLE) {
        const habitableWithoutFurnishings = spaces.filter(s => 
          COMPARISON_RULES.HABITABLE_CATEGORIES.includes(s.category) &&
          (!s.detected_furnishings || s.detected_furnishings.length === 0)
        );

        if (habitableWithoutFurnishings.length > 0) {
          failures.push({
            type: "furniture_mismatch",
            description: `${habitableWithoutFurnishings.length} habitable space(s) have no detected furnishings`,
            severity: "low"
          });
          for (const space of habitableWithoutFurnishings) {
            failures.push({
              type: "furniture_mismatch",
              description: `${space.label} (${space.category}) has no furnishings detected`,
              severity: "low",
              affected_space_id: space.space_id
            });
          }
        }
      }

      // Check 3.8: Duplicate space labels
      const labelCounts = new Map<string, number>();
      for (const space of spaces) {
        const count = labelCounts.get(space.label) || 0;
        labelCounts.set(space.label, count + 1);
      }
      for (const [label, count] of labelCounts) {
        if (count > 1) {
          failures.push({
            type: "constraint_violation",
            description: `Duplicate space label "${label}" appears ${count} times`,
            severity: "low"
          });
        }
      }

      // ======================================================================
      // STEP 4: LLM COMPARISON (if user request provided)
      // ======================================================================
      let userRequestSummary = "No specific user request provided";
      let llmModelUsed = "rules-only";

      if (user_request || style_constraints) {
        const llmResult = await performLLMComparison(
          geminiKey,
          user_request || "",
          style_constraints || "",
          spaces,
          expected_room_types
        );

        if (llmResult) {
          userRequestSummary = llmResult.summary;
          llmModelUsed = "gemini-2.5-flash";
          
          // Add LLM-detected failures
          for (const failure of llmResult.failures) {
            // Avoid duplicates
            const isDuplicate = failures.some(f => 
              f.type === failure.type && 
              f.description.toLowerCase().includes(failure.description.toLowerCase().slice(0, 30))
            );
            if (!isDuplicate) {
              failures.push(failure);
            }
          }

          // Add LLM-suggested fixes
          for (const fix of llmResult.fixes) {
            const isDuplicate = fixes.some(f => 
              f.target === fix.target && 
              f.action.toLowerCase().includes(fix.action.toLowerCase().slice(0, 30))
            );
            if (!isDuplicate) {
              fixes.push(fix);
            }
          }
        }
      } else {
        userRequestSummary = `Automated validation of ${spaces.length} detected spaces`;
      }

      // ======================================================================
      // STEP 5: DETERMINE PASS/FAIL AND NEXT STEP
      // ======================================================================
      const criticalFailures = failures.filter(f => f.severity === "critical");
      const highFailures = failures.filter(f => f.severity === "high");
      const mediumFailures = failures.filter(f => f.severity === "medium");

      let pass = true;
      let recommendedNextStep: RecommendedNextStep = "proceed";

      // Decision logic
      if (criticalFailures.length > 0) {
        pass = false;
        recommendedNextStep = "block_for_human";
      } else if (failures.length > COMPARISON_RULES.MAX_FAILURES_BEFORE_BLOCK) {
        pass = false;
        recommendedNextStep = "block_for_human";
      } else if (highFailures.length > 2) {
        pass = false;
        recommendedNextStep = "retry_info";
      } else if (highFailures.length > 0) {
        pass = false;
        recommendedNextStep = "retry_info";
      } else if (mediumFailures.length > 3) {
        pass = true; // Proceed with caution
        recommendedNextStep = "proceed";
      }

      // Sort fixes by priority
      fixes.sort((a, b) => a.priority - b.priority);

      const processingTime = Date.now() - startTime;

      // ======================================================================
      // STEP 6: BUILD AND VALIDATE OUTPUT
      // ======================================================================
      const output: ComparisonWorkerOutput = {
        run_id,
        step_id,
        pass,
        user_request_summary: userRequestSummary.slice(0, 1000),
        failures,
        fixes,
        recommended_next_step: recommendedNextStep,
        processing_time_ms: processingTime,
        model_used: llmModelUsed
      };

      // Validate our own output
      const outputValidation = validateComparisonWorkerOutput(output);
      if (!outputValidation.valid) {
        console.error("[comparison-worker] Own output failed validation:", outputValidation.block_reasons);
        // Still return result but log the issue
      }

      // ======================================================================
      // STEP 7: STORE RESULTS
      // ======================================================================
      
      // Store in worker_outputs table
      await supabase.from("worker_outputs").insert({
        run_id,
        step_id,
        worker_type: "comparison",
        output_data: output,
        schema_valid: outputValidation.valid,
        processing_time_ms: processingTime,
        llm_model_used: llmModelUsed
      });

      // Store as pipeline artifact
      const { data: resultArtifact } = await supabase
        .from("pipeline_artifacts")
        .insert({
          run_id,
          step_id,
          kind: "json",
          metadata_json: output,
          owner_id: userId
        })
        .select("id")
        .single();

      // Release job with success
      await releaseJob(supabase, jobId, "completed", null, startTime, {
        artifact_id: resultArtifact?.id,
        pass,
        failures_count: failures.length,
        critical_count: criticalFailures.length,
        high_count: highFailures.length,
        recommended_next_step: recommendedNextStep
      });

      console.log(`[comparison-worker] DONE pass=${pass} failures=${failures.length} (critical=${criticalFailures.length}, high=${highFailures.length}) time=${processingTime}ms`);

      return jsonSuccess(output);

    } catch (error) {
      console.error("[comparison-worker] Processing error:", error);
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      await releaseJob(supabase, jobId, "failed", errorMsg, startTime);
      return jsonError(errorMsg, 500);
    }

  } catch (error) {
    console.error("[comparison-worker] Fatal error:", error);
    return jsonError(error instanceof Error ? error.message : "Unknown error", 500);
  }
});

// ============================================================================
// LLM COMPARISON
// ============================================================================

interface LLMComparisonResult {
  summary: string;
  failures: ComparisonFailure[];
  fixes: ComparisonFix[];
}

async function performLLMComparison(
  apiKey: string,
  userRequest: string,
  styleConstraints: string,
  spaces: SpaceInfo[],
  expectedRoomTypes?: string[]
): Promise<LLMComparisonResult | null> {
  try {
    const spaceSummary = spaces.map(s => ({
      label: s.label,
      category: s.category,
      confidence: s.confidence,
      furnishings: s.detected_furnishings.map(f => `${f.count}x ${f.item_type}`).join(", "),
      ambiguities: s.ambiguity_flags
    }));

    const prompt = `You are a validation AI comparing floor plan analysis results against user requirements.

USER REQUEST:
"${userRequest || 'Standard floor plan analysis'}"

${styleConstraints ? `STYLE CONSTRAINTS:
"${styleConstraints}"` : ''}

${expectedRoomTypes?.length ? `EXPECTED ROOM TYPES: ${expectedRoomTypes.join(", ")}` : ''}

DETECTED SPACES (${spaces.length} total):
${JSON.stringify(spaceSummary, null, 2)}

TASK: Compare the detected spaces against the user requirements. Identify any mismatches, missing rooms, extra rooms, or concerns.

RESPOND WITH VALID JSON ONLY:
{
  "summary": "Brief summary of what the user requested (max 200 chars)",
  "failures": [
    {
      "type": "missing_space|extra_space|furniture_mismatch|style_inconsistency|constraint_violation",
      "description": "What's wrong (be specific)",
      "severity": "low|medium|high|critical",
      "affected_space_id": "space_xxx (optional)",
      "expected": "what was expected (optional)",
      "actual": "what was found (optional)"
    }
  ],
  "fixes": [
    {
      "target": "prompt|input|constraint|manual_review",
      "action": "Specific action to take",
      "expected_effect": "Expected result",
      "priority": 1
    }
  ]
}

If everything looks good and matches requirements, return empty arrays for failures and fixes.
Focus on semantic mismatches - the user wants X but got Y.
Do NOT report issues already covered by automated checks (low confidence, ambiguity flags).`;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const response = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 2048
        }
      })
    });

    if (!response.ok) {
      console.error("[comparison-worker] LLM request failed:", response.status);
      return null;
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return null;

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);

    return {
      summary: parsed.summary || userRequest?.slice(0, 200) || "User request analysis",
      failures: (parsed.failures || []).map((f: any) => ({
        type: validateFailureType(f.type),
        description: String(f.description || "Unknown failure").slice(0, 500),
        severity: validateSeverity(f.severity),
        affected_space_id: f.affected_space_id,
        expected: f.expected,
        actual: f.actual
      })),
      fixes: (parsed.fixes || []).map((f: any) => ({
        target: validateFixTarget(f.target),
        action: String(f.action || "Review manually").slice(0, 500),
        expected_effect: String(f.expected_effect || "Unknown").slice(0, 300),
        priority: Math.min(Math.max(parseInt(f.priority) || 5, 1), 10)
      }))
    };

  } catch (error) {
    console.error("[comparison-worker] LLM comparison error:", error);
    return null;
  }
}

function validateFailureType(type: string): FailureType {
  const validTypes: FailureType[] = [
    "schema_invalid", "constraint_violation", "quality_mismatch",
    "missing_space", "extra_space", "furniture_mismatch",
    "style_inconsistency", "geometry_error", "ambiguity_unresolved",
    "llm_contradiction", "timeout", "api_error"
  ];
  return validTypes.includes(type as FailureType) ? type as FailureType : "constraint_violation";
}

function validateSeverity(severity: string): Severity {
  const validSeverities: Severity[] = ["low", "medium", "high", "critical"];
  return validSeverities.includes(severity as Severity) ? severity as Severity : "medium";
}

function validateFixTarget(target: string): "prompt" | "input" | "constraint" | "manual_review" {
  const validTargets = ["prompt", "input", "constraint", "manual_review"];
  return validTargets.includes(target) ? target as any : "manual_review";
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

// deno-lint-ignore no-explicit-any
async function releaseJob(
  supabase: any,
  jobId: string,
  status: string,
  error: string | null,
  startTime: number,
  resultRef?: any
): Promise<void> {
  try {
    await supabase.rpc("release_job_lock", {
      p_job_id: jobId,
      p_status: status,
      p_result_ref: resultRef || null,
      p_error: error,
      p_processing_time_ms: Date.now() - startTime
    });
  } catch (e) {
    console.error("[comparison-worker] Failed to release job:", e);
    // Fallback: direct update
    await supabase
      .from("pipeline_jobs")
      .update({
        status,
        last_error: error,
        processing_time_ms: Date.now() - startTime,
        completed_at: new Date().toISOString(),
        locked_at: null,
        locked_by: null
      })
      .eq("id", jobId);
  }
}

function jsonSuccess(data: any): Response {
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
