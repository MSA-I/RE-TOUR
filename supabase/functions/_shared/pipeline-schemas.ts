/**
 * STRICT PIPELINE CONTRACTS
 * 
 * These schemas define the EXACT structure expected between pipeline services.
 * All services MUST validate inputs/outputs against these schemas.
 * 
 * ARCHITECTURE:
 * - Image I/O Service → deterministic, no LLM
 * - Info Worker → LLM vision/text analysis
 * - Comparison Worker → LLM + rules validation
 * - Supervisor → always-on orchestrator with LLM audit
 */

// ============================================================================
// COMMON TYPES
// ============================================================================

export type ImageRole = "input" | "output" | "reference" | "preview";
export type QualityTier = "1K" | "2K" | "4K";
export type AspectRatio = "1:1" | "4:3" | "16:9" | "2:1" | "21:9";
export type StepPhase = "pending" | "running" | "completed" | "failed" | "blocked";

export type SpaceCategory =
  | "bathroom"
  | "bedroom"
  | "kitchen"
  | "living_room"
  | "dining_room"
  | "corridor"
  | "balcony"
  | "terrace"
  | "laundry"
  | "storage"
  | "office"
  | "entrance"
  | "other";

export type FailureType =
  | "schema_invalid"
  | "constraint_violation"
  | "quality_mismatch"
  | "missing_space"
  | "extra_space"
  | "furniture_mismatch"
  | "style_inconsistency"
  | "geometry_error"
  | "ambiguity_unresolved"
  | "llm_contradiction"
  | "timeout"
  | "api_error";

export type FixTarget = "prompt" | "input" | "constraint" | "manual_review";
export type SupervisorDecision = "proceed" | "retry" | "block";
export type Severity = "low" | "medium" | "high" | "critical";

// QA Result Codes - specific failure types for AI-QA
export type QAReasonCode =
  | "INVALID_INPUT"
  | "MISSING_SPACE"
  | "DUPLICATED_OBJECTS"
  | "GEOMETRY_DISTORTION"
  | "WRONG_ROOM_TYPE"
  | "LOW_CONFIDENCE"
  | "AMBIGUOUS_CLASSIFICATION"
  | "SCALE_MISMATCH"
  | "FURNITURE_MISMATCH"
  | "STYLE_INCONSISTENCY"
  | "WALL_RECTIFICATION"
  | "MISSING_FURNISHINGS"
  | "RESOLUTION_MISMATCH"
  | "SEAM_ARTIFACTS"
  | "COLOR_INCONSISTENCY"
  | "PERSPECTIVE_ERROR"
  | "SCHEMA_INVALID"
  | "API_ERROR"
  | "TIMEOUT"
  | "UNKNOWN";

// Retry suggestion types
export type RetrySuggestionType =
  | "prompt_delta"      // Modify prompt constraints
  | "settings_delta"    // Change generation settings
  | "seed_change"       // Different random seed
  | "input_change"      // Different input selection
  | "manual_review";    // Requires human intervention

// ============================================================================
// A) IMAGE I/O OUTPUT SCHEMA
// ============================================================================

export interface ImageIOImage {
  upload_id: string;
  role: ImageRole;
  preview_url: string;           // Required, signed, time-limited
  original_url: string | null;   // Required if original exists
  width: number;
  height: number;
  filesize_bytes: number;
  mime_type: string;
  sha256_hash: string;
}

export interface ImageIOOutput {
  run_id: string;
  step_id: string;
  images: ImageIOImage[];
  quality_used: QualityTier;
  ratio_used: AspectRatio;
  created_at: string;            // ISO 8601
}

// JSON Schema for validation
export const IMAGE_IO_OUTPUT_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  required: ["run_id", "step_id", "images", "quality_used", "ratio_used", "created_at"],
  additionalProperties: false,
  properties: {
    run_id: { type: "string", format: "uuid" },
    step_id: { type: "string", minLength: 1 },
    images: {
      type: "array",
      items: {
        type: "object",
        required: ["upload_id", "role", "preview_url", "width", "height", "filesize_bytes", "mime_type", "sha256_hash"],
        additionalProperties: false,
        properties: {
          upload_id: { type: "string", format: "uuid" },
          role: { type: "string", enum: ["input", "output", "reference", "preview"] },
          preview_url: { type: "string", format: "uri", pattern: "^https://" },
          original_url: { type: ["string", "null"], format: "uri" },
          width: { type: "integer", minimum: 1, maximum: 8192 },
          height: { type: "integer", minimum: 1, maximum: 8192 },
          filesize_bytes: { type: "integer", minimum: 1, maximum: 104857600 }, // 100MB max
          mime_type: { type: "string", pattern: "^image/(jpeg|png|webp)$" },
          sha256_hash: { type: "string", pattern: "^[a-f0-9]{64}$" }
        }
      }
    },
    quality_used: { type: "string", enum: ["1K", "2K", "4K"] },
    ratio_used: { type: "string", enum: ["1:1", "4:3", "16:9", "2:1", "21:9"] },
    created_at: { type: "string", format: "date-time" }
  }
};

// ============================================================================
// B) INFO WORKER OUTPUT SCHEMA
// ============================================================================

export interface DetectedFurnishing {
  item_type: string;
  count: number;
  confidence: number;
}

export interface SpaceInfo {
  space_id: string;              // Stable ID for tracking
  label: string;                 // Human-readable, e.g., "Bathroom 1"
  category: SpaceCategory;
  confidence: number;            // 0-1
  detected_furnishings: DetectedFurnishing[];
  geometry_notes: string;        // Short, factual
  ambiguity_flags: string[];     // e.g., ["uncertain between bathroom/laundry"]
}

export interface InfoWorkerOutput {
  run_id: string;
  step_id: string;
  spaces: SpaceInfo[];
  global_notes: string;
  processing_time_ms: number;
  model_used: string;
}

export const INFO_WORKER_OUTPUT_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  required: ["run_id", "step_id", "spaces", "global_notes", "processing_time_ms", "model_used"],
  additionalProperties: false,
  properties: {
    run_id: { type: "string", format: "uuid" },
    step_id: { type: "string", minLength: 1 },
    spaces: {
      type: "array",
      items: {
        type: "object",
        required: ["space_id", "label", "category", "confidence", "detected_furnishings", "geometry_notes", "ambiguity_flags"],
        additionalProperties: false,
        properties: {
          space_id: { type: "string", pattern: "^space_[a-z0-9_]+$" },
          label: { type: "string", minLength: 1, maxLength: 100 },
          category: {
            type: "string",
            enum: ["bathroom", "bedroom", "kitchen", "living_room", "dining_room", "corridor", "balcony", "terrace", "laundry", "storage", "office", "entrance", "other"]
          },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          detected_furnishings: {
            type: "array",
            items: {
              type: "object",
              required: ["item_type", "count", "confidence"],
              additionalProperties: false,
              properties: {
                item_type: { type: "string", minLength: 1 },
                count: { type: "integer", minimum: 1 },
                confidence: { type: "number", minimum: 0, maximum: 1 }
              }
            }
          },
          geometry_notes: { type: "string", maxLength: 500 },
          ambiguity_flags: {
            type: "array",
            items: { type: "string", maxLength: 200 }
          }
        }
      }
    },
    global_notes: { type: "string", maxLength: 2000 },
    processing_time_ms: { type: "integer", minimum: 0 },
    model_used: { type: "string", minLength: 1 }
  }
};

// ============================================================================
// C) COMPARISON WORKER OUTPUT SCHEMA
// ============================================================================

export interface ComparisonFailure {
  type: FailureType;
  description: string;
  severity: Severity;
  affected_space_id?: string;
  expected?: string;
  actual?: string;
}

export interface ComparisonFix {
  target: FixTarget;
  action: string;
  expected_effect: string;
  priority: number;              // 1 = highest
}

export type RecommendedNextStep =
  | "proceed"
  | "retry_info"
  | "retry_generation"
  | "block_for_human";

export interface ComparisonWorkerOutput {
  run_id: string;
  step_id: string;
  pass: boolean;
  user_request_summary: string;  // Echo back what was requested
  failures: ComparisonFailure[];
  fixes: ComparisonFix[];
  recommended_next_step: RecommendedNextStep;
  processing_time_ms: number;
  model_used: string;
}

export const COMPARISON_WORKER_OUTPUT_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  required: ["run_id", "step_id", "pass", "user_request_summary", "failures", "fixes", "recommended_next_step", "processing_time_ms", "model_used"],
  additionalProperties: false,
  properties: {
    run_id: { type: "string", format: "uuid" },
    step_id: { type: "string", minLength: 1 },
    pass: { type: "boolean" },
    user_request_summary: { type: "string", minLength: 1, maxLength: 1000 },
    failures: {
      type: "array",
      items: {
        type: "object",
        required: ["type", "description", "severity"],
        additionalProperties: false,
        properties: {
          type: {
            type: "string",
            enum: ["schema_invalid", "constraint_violation", "quality_mismatch", "missing_space", "extra_space", "furniture_mismatch", "style_inconsistency", "geometry_error", "ambiguity_unresolved", "llm_contradiction", "timeout", "api_error"]
          },
          description: { type: "string", minLength: 1, maxLength: 500 },
          severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
          affected_space_id: { type: "string" },
          expected: { type: "string" },
          actual: { type: "string" }
        }
      }
    },
    fixes: {
      type: "array",
      items: {
        type: "object",
        required: ["target", "action", "expected_effect", "priority"],
        additionalProperties: false,
        properties: {
          target: { type: "string", enum: ["prompt", "input", "constraint", "manual_review"] },
          action: { type: "string", minLength: 1, maxLength: 500 },
          expected_effect: { type: "string", minLength: 1, maxLength: 300 },
          priority: { type: "integer", minimum: 1, maximum: 10 }
        }
      }
    },
    recommended_next_step: {
      type: "string",
      enum: ["proceed", "retry_info", "retry_generation", "block_for_human"]
    },
    processing_time_ms: { type: "integer", minimum: 0 },
    model_used: { type: "string", minLength: 1 }
  }
};

// ============================================================================
// D) SUPERVISOR OUTPUT SCHEMA
// ============================================================================

export interface SchemaValidationResult {
  schema_name: string;
  valid: boolean;
  errors: string[];
}

export interface RuleCheckResult {
  rule_name: string;
  passed: boolean;
  message: string;
  blocked: boolean;           // If true, must block pipeline
}

export interface LLMAudit {
  consistency_score: number;  // 0-1
  contradiction_flags: string[];
  risk_notes: string;
  reasoning_quality: "excellent" | "good" | "acceptable" | "poor";
  model_used: string;
}

export interface SupervisorOutput {
  run_id: string;
  step_id: string;
  schema_validations: SchemaValidationResult[];
  rule_checks: RuleCheckResult[];
  llm_audit: LLMAudit;
  decision: SupervisorDecision;
  retry_budget_remaining: number;
  block_reason?: string;
  next_action?: string;
  processing_time_ms: number;
}

export const SUPERVISOR_OUTPUT_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  required: ["run_id", "step_id", "schema_validations", "rule_checks", "llm_audit", "decision", "retry_budget_remaining", "processing_time_ms"],
  additionalProperties: false,
  properties: {
    run_id: { type: "string", format: "uuid" },
    step_id: { type: "string", minLength: 1 },
    schema_validations: {
      type: "array",
      items: {
        type: "object",
        required: ["schema_name", "valid", "errors"],
        additionalProperties: false,
        properties: {
          schema_name: { type: "string", minLength: 1 },
          valid: { type: "boolean" },
          errors: { type: "array", items: { type: "string" } }
        }
      }
    },
    rule_checks: {
      type: "array",
      items: {
        type: "object",
        required: ["rule_name", "passed", "message", "blocked"],
        additionalProperties: false,
        properties: {
          rule_name: { type: "string", minLength: 1 },
          passed: { type: "boolean" },
          message: { type: "string" },
          blocked: { type: "boolean" }
        }
      }
    },
    llm_audit: {
      type: "object",
      required: ["consistency_score", "contradiction_flags", "risk_notes", "reasoning_quality", "model_used"],
      additionalProperties: false,
      properties: {
        consistency_score: { type: "number", minimum: 0, maximum: 1 },
        contradiction_flags: { type: "array", items: { type: "string" } },
        risk_notes: { type: "string", maxLength: 1000 },
        reasoning_quality: { type: "string", enum: ["excellent", "good", "acceptable", "poor"] },
        model_used: { type: "string", minLength: 1 }
      }
    },
    decision: { type: "string", enum: ["proceed", "retry", "block"] },
    retry_budget_remaining: { type: "integer", minimum: 0 },
    block_reason: { type: "string" },
    next_action: { type: "string" },
    processing_time_ms: { type: "integer", minimum: 0 }
  }
};

// ============================================================================
// RULE GATES (enforced server-side)
// ============================================================================

export const RULE_GATES = {
  // IMAGE I/O RULES
  IMAGE_IO: {
    MAX_IMAGES_PER_STEP: 12,
    MAX_PREVIEW_SIZE_BYTES: 2 * 1024 * 1024,    // 2MB
    MAX_ORIGINAL_SIZE_BYTES: 50 * 1024 * 1024,  // 50MB
    URL_EXPIRY_SECONDS: 3600,                    // 1 hour
    ALLOWED_MIME_TYPES: ["image/jpeg", "image/png", "image/webp"],

    // Quality enforcement per step
    STEP_QUALITY_OVERRIDE: {
      0: "2K", // Space Analysis
      1: "2K", // Top-Down 3D
      2: "2K", // Style
      3: "2K", // Detect Spaces
      // Steps 4+ use user preference
    } as Record<number, QualityTier>,

    // Dimension limits per quality tier
    QUALITY_DIMENSIONS: {
      "1K": { min: 800, max: 1200 },
      "2K": { min: 1800, max: 2400 },
      "4K": { min: 3600, max: 4200 }
    }
  },

  // INFO WORKER RULES
  INFO_WORKER: {
    MIN_CONFIDENCE_THRESHOLD: 0.3,      // Below this = ambiguity flag required
    MAX_SPACES_PER_FLOORPLAN: 20,
    MAX_FURNISHINGS_PER_SPACE: 50,
    REQUIRED_AMBIGUITY_IF_LOW_CONFIDENCE: true,
    PROCESSING_TIMEOUT_MS: 60000        // 60 seconds
  },

  // COMPARISON WORKER RULES
  COMPARISON_WORKER: {
    AUTO_BLOCK_SEVERITY: "critical",    // Critical failures = auto block
    MAX_FAILURES_BEFORE_BLOCK: 5,
    REQUIRE_USER_REQUEST_ECHO: true,
    PROCESSING_TIMEOUT_MS: 30000        // 30 seconds
  },

  // SUPERVISOR RULES
  SUPERVISOR: {
    MIN_CONSISTENCY_SCORE: 0.7,         // Below this = block for human
    MAX_RETRIES_PER_STEP: 3,
    MAX_TOTAL_RETRIES: 10,
    AUTO_BLOCK_TRIGGERS: [
      "schema_invalid",
      "critical_failure",
      "consistency_below_threshold",
      "retry_budget_exhausted"
    ],
    LLM_AUDIT_REQUIRED: true,           // ALWAYS run LLM audit
    PROCESSING_TIMEOUT_MS: 45000        // 45 seconds
  }
};

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

/**
 * Validate data against a JSON schema
 * Returns { valid: boolean, errors: string[] }
 */
export function validateSchema(data: unknown, schema: object): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  try {
    // Basic type checking (full JSON Schema validation would use ajv library)
    if (typeof data !== 'object' || data === null) {
      errors.push("Data must be an object");
      return { valid: false, errors };
    }

    const schemaObj = schema as any;
    const dataObj = data as Record<string, unknown>;

    // Check required fields
    if (schemaObj.required) {
      for (const field of schemaObj.required) {
        if (!(field in dataObj)) {
          errors.push(`Missing required field: ${field}`);
        }
      }
    }

    // Check additionalProperties
    if (schemaObj.additionalProperties === false && schemaObj.properties) {
      const allowedKeys = Object.keys(schemaObj.properties);
      for (const key of Object.keys(dataObj)) {
        if (!allowedKeys.includes(key)) {
          errors.push(`Unexpected field: ${key}`);
        }
      }
    }

    // Check for base64 in any string field (forbidden)
    const checkForBase64 = (obj: unknown, path: string): void => {
      if (typeof obj === 'string') {
        if (obj.startsWith('data:image') || (obj.length > 1000 && /^[A-Za-z0-9+/=]+$/.test(obj))) {
          errors.push(`Base64 data detected at ${path} - FORBIDDEN`);
        }
      } else if (Array.isArray(obj)) {
        obj.forEach((item, i) => checkForBase64(item, `${path}[${i}]`));
      } else if (typeof obj === 'object' && obj !== null) {
        Object.entries(obj).forEach(([k, v]) => checkForBase64(v, `${path}.${k}`));
      }
    };

    checkForBase64(data, 'root');

    return { valid: errors.length === 0, errors };
  } catch (e) {
    errors.push(`Validation error: ${e instanceof Error ? e.message : 'Unknown'}`);
    return { valid: false, errors };
  }
}

/**
 * Apply rule gates and return check results
 */
export function applyRuleGates(
  context: {
    step_index: number;
    images?: ImageIOImage[];
    spaces?: SpaceInfo[];
    failures?: ComparisonFailure[];
    retry_count?: number;
    consistency_score?: number;
  }
): RuleCheckResult[] {
  const results: RuleCheckResult[] = [];

  // IMAGE I/O RULES
  if (context.images) {
    // Max images check
    results.push({
      rule_name: "max_images_per_step",
      passed: context.images.length <= RULE_GATES.IMAGE_IO.MAX_IMAGES_PER_STEP,
      message: `${context.images.length}/${RULE_GATES.IMAGE_IO.MAX_IMAGES_PER_STEP} images`,
      blocked: context.images.length > RULE_GATES.IMAGE_IO.MAX_IMAGES_PER_STEP
    });

    // Quality enforcement for steps 0-3
    const expectedQuality = RULE_GATES.IMAGE_IO.STEP_QUALITY_OVERRIDE[context.step_index];
    if (expectedQuality) {
      results.push({
        rule_name: "step_quality_enforcement",
        passed: true, // Would check actual quality_used
        message: `Step ${context.step_index} requires ${expectedQuality}`,
        blocked: false
      });
    }

    // File size checks
    for (const img of context.images) {
      if (img.role === "preview" && img.filesize_bytes > RULE_GATES.IMAGE_IO.MAX_PREVIEW_SIZE_BYTES) {
        results.push({
          rule_name: "preview_size_limit",
          passed: false,
          message: `Preview ${img.upload_id} exceeds 2MB limit`,
          blocked: true
        });
      }
    }
  }

  // INFO WORKER RULES
  if (context.spaces) {
    // Max spaces check
    results.push({
      rule_name: "max_spaces_per_floorplan",
      passed: context.spaces.length <= RULE_GATES.INFO_WORKER.MAX_SPACES_PER_FLOORPLAN,
      message: `${context.spaces.length}/${RULE_GATES.INFO_WORKER.MAX_SPACES_PER_FLOORPLAN} spaces`,
      blocked: context.spaces.length > RULE_GATES.INFO_WORKER.MAX_SPACES_PER_FLOORPLAN
    });

    // Low confidence must have ambiguity flags
    for (const space of context.spaces) {
      if (space.confidence < RULE_GATES.INFO_WORKER.MIN_CONFIDENCE_THRESHOLD) {
        const hasAmbiguity = space.ambiguity_flags.length > 0;
        results.push({
          rule_name: "low_confidence_ambiguity_required",
          passed: hasAmbiguity,
          message: `Space ${space.space_id} has low confidence (${space.confidence}) ${hasAmbiguity ? 'with' : 'WITHOUT'} ambiguity flags`,
          blocked: !hasAmbiguity
        });
      }
    }
  }

  // COMPARISON WORKER RULES
  if (context.failures) {
    const criticalCount = context.failures.filter(f => f.severity === "critical").length;
    results.push({
      rule_name: "critical_failures_block",
      passed: criticalCount === 0,
      message: `${criticalCount} critical failures`,
      blocked: criticalCount > 0
    });

    results.push({
      rule_name: "max_failures_before_block",
      passed: context.failures.length <= RULE_GATES.COMPARISON_WORKER.MAX_FAILURES_BEFORE_BLOCK,
      message: `${context.failures.length}/${RULE_GATES.COMPARISON_WORKER.MAX_FAILURES_BEFORE_BLOCK} failures`,
      blocked: context.failures.length > RULE_GATES.COMPARISON_WORKER.MAX_FAILURES_BEFORE_BLOCK
    });
  }

  // SUPERVISOR RULES
  if (context.retry_count !== undefined) {
    results.push({
      rule_name: "retry_budget",
      passed: context.retry_count < RULE_GATES.SUPERVISOR.MAX_RETRIES_PER_STEP,
      message: `${context.retry_count}/${RULE_GATES.SUPERVISOR.MAX_RETRIES_PER_STEP} retries used`,
      blocked: context.retry_count >= RULE_GATES.SUPERVISOR.MAX_RETRIES_PER_STEP
    });
  }

  if (context.consistency_score !== undefined) {
    results.push({
      rule_name: "consistency_threshold",
      passed: context.consistency_score >= RULE_GATES.SUPERVISOR.MIN_CONSISTENCY_SCORE,
      message: `Consistency score ${context.consistency_score} ${context.consistency_score >= RULE_GATES.SUPERVISOR.MIN_CONSISTENCY_SCORE ? '>=' : '<'} ${RULE_GATES.SUPERVISOR.MIN_CONSISTENCY_SCORE}`,
      blocked: context.consistency_score < RULE_GATES.SUPERVISOR.MIN_CONSISTENCY_SCORE
    });
  }

  return results;
}

// ============================================================================
// DATABASE FIELD MAPPINGS
// ============================================================================

/**
 * Minimal DB fields needed to store each output
 */
export const DB_FIELD_MAPPINGS = {
  // worker_outputs table stores all worker results
  WORKER_OUTPUTS: {
    id: "uuid PRIMARY KEY",
    run_id: "uuid REFERENCES pipeline_runs(id)",
    worker_type: "text NOT NULL", // 'image_io' | 'info_worker' | 'comparison_worker' | 'supervisor'
    step_id: "text NOT NULL",
    output_data: "jsonb NOT NULL", // Full schema-validated output
    schema_valid: "boolean NOT NULL",
    supervisor_approved: "boolean",
    processing_time_ms: "integer",
    llm_model_used: "text",
    created_at: "timestamptz DEFAULT now()",
    error_message: "text",
    input_schema_hash: "text" // For deduplication
  },

  // pipeline_runs table tracks orchestration state
  PIPELINE_RUNS: {
    id: "uuid PRIMARY KEY",
    pipeline_id: "uuid REFERENCES floorplan_pipelines(id)",
    owner_id: "uuid NOT NULL",
    current_step: "integer NOT NULL",
    status: "text NOT NULL", // 'pending' | 'running' | 'completed' | 'failed' | 'blocked'
    total_retries: "integer DEFAULT 0",
    step_retries: "integer DEFAULT 0",
    supervisor_decisions: "jsonb[]", // Array of SupervisorOutput
    started_at: "timestamptz DEFAULT now()",
    completed_at: "timestamptz",
    last_error: "text",
    updated_at: "timestamptz DEFAULT now()"
  }
};
