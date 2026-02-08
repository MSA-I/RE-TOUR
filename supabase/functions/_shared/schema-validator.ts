/**
 * STRICT SCHEMA VALIDATOR
 * 
 * Server-side validation for all pipeline contracts.
 * Uses deterministic checks + rule gates.
 * 
 * VALIDATION POINTS:
 * - Image I/O Service: validates on OUTPUT before returning
 * - Info Worker: validates on INPUT (images) and OUTPUT (spaces)
 * - Comparison Worker: validates on INPUT (all worker outputs) and OUTPUT
 * - Supervisor: validates ALL schemas, applies ALL rules, audits with LLM
 */

import {
  IMAGE_IO_OUTPUT_SCHEMA,
  INFO_WORKER_OUTPUT_SCHEMA,
  COMPARISON_WORKER_OUTPUT_SCHEMA,
  SUPERVISOR_OUTPUT_SCHEMA,
  RULE_GATES,
  validateSchema,
  applyRuleGates,
  type ImageIOOutput,
  type InfoWorkerOutput,
  type ComparisonWorkerOutput,
  type SupervisorOutput,
  type SchemaValidationResult,
  type RuleCheckResult,
  type QualityTier
} from "./pipeline-schemas.ts";

// ============================================================================
// VALIDATION ENTRY POINTS
// ============================================================================

export interface ValidationResult {
  valid: boolean;
  schema_results: SchemaValidationResult[];
  rule_results: RuleCheckResult[];
  blocked: boolean;
  block_reasons: string[];
}

/**
 * Validate Image I/O output
 * Called by: image-io-service before returning
 */
export function validateImageIOOutput(data: unknown, stepIndex: number): ValidationResult {
  const schemaResult = validateSchema(data, IMAGE_IO_OUTPUT_SCHEMA);
  const schemaValidation: SchemaValidationResult = {
    schema_name: "ImageIOOutput",
    valid: schemaResult.valid,
    errors: schemaResult.errors
  };
  
  const ruleResults: RuleCheckResult[] = [];
  const blockReasons: string[] = [];
  
  if (schemaResult.valid) {
    const output = data as ImageIOOutput;
    
    // Apply rule gates
    const gates = applyRuleGates({
      step_index: stepIndex,
      images: output.images
    });
    ruleResults.push(...gates);
    
    // Check quality enforcement for steps 0-3
    const expectedQuality = RULE_GATES.IMAGE_IO.STEP_QUALITY_OVERRIDE[stepIndex];
    if (expectedQuality && output.quality_used !== expectedQuality) {
      ruleResults.push({
        rule_name: "step_quality_override",
        passed: false,
        message: `Step ${stepIndex} requires ${expectedQuality}, got ${output.quality_used}`,
        blocked: true
      });
    }
    
    // Check no base64 in URLs
    for (const img of output.images) {
      if (img.preview_url.startsWith('data:')) {
        ruleResults.push({
          rule_name: "no_base64_urls",
          passed: false,
          message: `Image ${img.upload_id} has base64 preview_url - FORBIDDEN`,
          blocked: true
        });
      }
      if (img.original_url?.startsWith('data:')) {
        ruleResults.push({
          rule_name: "no_base64_urls",
          passed: false,
          message: `Image ${img.upload_id} has base64 original_url - FORBIDDEN`,
          blocked: true
        });
      }
    }
  } else {
    blockReasons.push(...schemaResult.errors);
  }
  
  // Collect block reasons
  for (const rule of ruleResults) {
    if (rule.blocked) {
      blockReasons.push(rule.message);
    }
  }
  
  return {
    valid: schemaResult.valid && ruleResults.every(r => r.passed),
    schema_results: [schemaValidation],
    rule_results: ruleResults,
    blocked: blockReasons.length > 0,
    block_reasons: blockReasons
  };
}

/**
 * Validate Info Worker output
 * Called by: info-worker before returning AND by supervisor
 */
export function validateInfoWorkerOutput(data: unknown): ValidationResult {
  const schemaResult = validateSchema(data, INFO_WORKER_OUTPUT_SCHEMA);
  const schemaValidation: SchemaValidationResult = {
    schema_name: "InfoWorkerOutput",
    valid: schemaResult.valid,
    errors: schemaResult.errors
  };
  
  const ruleResults: RuleCheckResult[] = [];
  const blockReasons: string[] = [];
  
  if (schemaResult.valid) {
    const output = data as InfoWorkerOutput;
    
    // Apply rule gates
    const gates = applyRuleGates({
      step_index: -1, // Not applicable
      spaces: output.spaces
    });
    ruleResults.push(...gates);
    
    // Additional checks
    
    // Ensure no prompts or storage info in output
    const outputStr = JSON.stringify(output);
    if (outputStr.includes('"prompt"') || outputStr.includes('"storage"') || outputStr.includes('signed')) {
      ruleResults.push({
        rule_name: "no_prompts_or_storage",
        passed: false,
        message: "Info Worker output must not contain prompts or storage info",
        blocked: true
      });
    }
    
    // Validate space_id format
    for (const space of output.spaces) {
      if (!space.space_id.match(/^space_[a-z0-9_]+$/)) {
        ruleResults.push({
          rule_name: "valid_space_id_format",
          passed: false,
          message: `Invalid space_id format: ${space.space_id}`,
          blocked: true
        });
      }
    }
    
    // Check processing time
    if (output.processing_time_ms > RULE_GATES.INFO_WORKER.PROCESSING_TIMEOUT_MS) {
      ruleResults.push({
        rule_name: "processing_timeout",
        passed: false,
        message: `Processing took ${output.processing_time_ms}ms, exceeds ${RULE_GATES.INFO_WORKER.PROCESSING_TIMEOUT_MS}ms limit`,
        blocked: false // Warning, not blocking
      });
    }
  } else {
    blockReasons.push(...schemaResult.errors);
  }
  
  for (const rule of ruleResults) {
    if (rule.blocked) {
      blockReasons.push(rule.message);
    }
  }
  
  return {
    valid: schemaResult.valid && ruleResults.every(r => r.passed),
    schema_results: [schemaValidation],
    rule_results: ruleResults,
    blocked: blockReasons.length > 0,
    block_reasons: blockReasons
  };
}

/**
 * Validate Comparison Worker output
 * Called by: comparison-worker before returning AND by supervisor
 */
export function validateComparisonWorkerOutput(data: unknown): ValidationResult {
  const schemaResult = validateSchema(data, COMPARISON_WORKER_OUTPUT_SCHEMA);
  const schemaValidation: SchemaValidationResult = {
    schema_name: "ComparisonWorkerOutput",
    valid: schemaResult.valid,
    errors: schemaResult.errors
  };
  
  const ruleResults: RuleCheckResult[] = [];
  const blockReasons: string[] = [];
  
  if (schemaResult.valid) {
    const output = data as ComparisonWorkerOutput;
    
    // Apply rule gates
    const gates = applyRuleGates({
      step_index: -1,
      failures: output.failures
    });
    ruleResults.push(...gates);
    
    // Must have user_request_summary
    if (RULE_GATES.COMPARISON_WORKER.REQUIRE_USER_REQUEST_ECHO) {
      if (!output.user_request_summary || output.user_request_summary.length < 10) {
        ruleResults.push({
          rule_name: "user_request_echo_required",
          passed: false,
          message: "user_request_summary is required and must be meaningful",
          blocked: true
        });
      }
    }
    
    // If pass=false, must have failures
    if (!output.pass && output.failures.length === 0) {
      ruleResults.push({
        rule_name: "failures_required_on_fail",
        passed: false,
        message: "pass=false but no failures provided",
        blocked: true
      });
    }
    
    // If failures exist, must have fixes
    if (output.failures.length > 0 && output.fixes.length === 0) {
      ruleResults.push({
        rule_name: "fixes_required_with_failures",
        passed: false,
        message: "Failures detected but no fixes suggested",
        blocked: false // Warning
      });
    }
  } else {
    blockReasons.push(...schemaResult.errors);
  }
  
  for (const rule of ruleResults) {
    if (rule.blocked) {
      blockReasons.push(rule.message);
    }
  }
  
  return {
    valid: schemaResult.valid && ruleResults.every(r => r.passed),
    schema_results: [schemaValidation],
    rule_results: ruleResults,
    blocked: blockReasons.length > 0,
    block_reasons: blockReasons
  };
}

/**
 * Validate Supervisor output
 * Called by: supervisor self-validation before persisting decision
 */
export function validateSupervisorOutput(data: unknown): ValidationResult {
  const schemaResult = validateSchema(data, SUPERVISOR_OUTPUT_SCHEMA);
  const schemaValidation: SchemaValidationResult = {
    schema_name: "SupervisorOutput",
    valid: schemaResult.valid,
    errors: schemaResult.errors
  };
  
  const ruleResults: RuleCheckResult[] = [];
  const blockReasons: string[] = [];
  
  if (schemaResult.valid) {
    const output = data as SupervisorOutput;
    
    // LLM audit is ALWAYS required
    if (RULE_GATES.SUPERVISOR.LLM_AUDIT_REQUIRED) {
      if (!output.llm_audit || !output.llm_audit.model_used) {
        ruleResults.push({
          rule_name: "llm_audit_required",
          passed: false,
          message: "LLM audit is ALWAYS required",
          blocked: true
        });
      }
    }
    
    // Check consistency threshold
    if (output.llm_audit.consistency_score < RULE_GATES.SUPERVISOR.MIN_CONSISTENCY_SCORE) {
      if (output.decision !== "block") {
        ruleResults.push({
          rule_name: "low_consistency_must_block",
          passed: false,
          message: `Consistency ${output.llm_audit.consistency_score} < ${RULE_GATES.SUPERVISOR.MIN_CONSISTENCY_SCORE} but decision is ${output.decision}, not 'block'`,
          blocked: true
        });
      }
    }
    
    // Decision must match block_reason
    if (output.decision === "block" && !output.block_reason) {
      ruleResults.push({
        rule_name: "block_reason_required",
        passed: false,
        message: "decision='block' but no block_reason provided",
        blocked: true
      });
    }
    
    // Retry budget check
    if (output.retry_budget_remaining < 0) {
      ruleResults.push({
        rule_name: "invalid_retry_budget",
        passed: false,
        message: "retry_budget_remaining cannot be negative",
        blocked: true
      });
    }
  } else {
    blockReasons.push(...schemaResult.errors);
  }
  
  for (const rule of ruleResults) {
    if (rule.blocked) {
      blockReasons.push(rule.message);
    }
  }
  
  return {
    valid: schemaResult.valid && ruleResults.every(r => r.passed),
    schema_results: [schemaValidation],
    rule_results: ruleResults,
    blocked: blockReasons.length > 0,
    block_reasons: blockReasons
  };
}

// ============================================================================
// HELPER: Get quality tier for step
// ============================================================================

export function getRequiredQualityForStep(stepIndex: number, userPreference: QualityTier): QualityTier {
  const override = RULE_GATES.IMAGE_IO.STEP_QUALITY_OVERRIDE[stepIndex];
  return override || userPreference;
}

// ============================================================================
// HELPER: Check if base64 exists anywhere in object
// ============================================================================

export function containsBase64(obj: unknown): { found: boolean; paths: string[] } {
  const paths: string[] = [];
  
  const check = (value: unknown, path: string): void => {
    if (typeof value === 'string') {
      // Check for data URI
      if (value.startsWith('data:image')) {
        paths.push(path);
      }
      // Check for long base64-like strings
      else if (value.length > 1000 && /^[A-Za-z0-9+/=]+$/.test(value.substring(0, 100))) {
        paths.push(path);
      }
    } else if (Array.isArray(value)) {
      value.forEach((item, i) => check(item, `${path}[${i}]`));
    } else if (typeof value === 'object' && value !== null) {
      Object.entries(value).forEach(([k, v]) => check(v, `${path}.${k}`));
    }
  };
  
  check(obj, 'root');
  return { found: paths.length > 0, paths };
}

// ============================================================================
// VALIDATION WHERE EACH RUNS (documentation)
// ============================================================================

/**
 * VALIDATION POINTS:
 * 
 * 1. IMAGE I/O SERVICE (image-io-service/index.ts)
 *    - ON OUTPUT: validateImageIOOutput()
 *    - Checks: schema, max images, quality override, no base64 URLs, file sizes
 *    - BLOCKS if: schema invalid, base64 found, quality mismatch for steps 0-3
 * 
 * 2. INFO WORKER (info-worker/index.ts - to be created)
 *    - ON INPUT: validate images are signed URLs (not base64)
 *    - ON OUTPUT: validateInfoWorkerOutput()
 *    - Checks: schema, space count, confidence+ambiguity, no prompts/storage
 *    - BLOCKS if: schema invalid, too many spaces, low confidence without flags
 * 
 * 3. COMPARISON WORKER (comparison-worker/index.ts - to be created)
 *    - ON INPUT: validate all previous worker outputs
 *    - ON OUTPUT: validateComparisonWorkerOutput()
 *    - Checks: schema, failure count, user request echo, fixes required
 *    - BLOCKS if: critical failures, schema invalid, no user request echo
 * 
 * 4. SUPERVISOR (supervisor/index.ts - to be created)
 *    - ALWAYS RUNS after each worker
 *    - Validates: ALL schemas from all workers in run
 *    - Applies: ALL rule gates
 *    - LLM Audit: consistency, contradictions, risk
 *    - DECIDES: proceed / retry / block
 *    - BLOCKS if: schema invalid, any rule gate blocks, consistency < 0.7, retry budget exhausted
 *    - ON OWN OUTPUT: validateSupervisorOutput() for self-check
 */
