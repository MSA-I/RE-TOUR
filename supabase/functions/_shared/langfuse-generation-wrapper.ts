/**
 * Langfuse Generation Wrapper for RE:TOUR Edge Functions
 * 
 * CRITICAL FIX v2.0: This wrapper now:
 * 1. Uses a single generation-create event with BOTH input AND output
 * 2. Properly flushes before returning
 * 3. Guarantees no null/undefined values in payloads
 * 4. Includes sanity guards to prevent silent garbage data
 * 
 * USAGE:
 *   const result = await wrapModelGeneration({...}, async () => { ... });
 *   // CRITICAL: Always call flushLangfuse() before returning from Edge Function!
 */

import {
  isLangfuseEnabled,
  logCompleteGeneration,
  createTrace,
  flushLangfuse,
  type LangfuseGenerationParams,
} from "./langfuse-client.ts";

import {
  buildStandardMetadata,
  TRACE_NAMES,
  type StandardMetadata,
} from "./langfuse-constants.ts";

// Re-export flush for Edge Functions to use
export { flushLangfuse } from "./langfuse-client.ts";

// ============= TYPES =============

export interface GenerationInputPayload {
  pipeline_id: string;
  project_id: string;
  step_number: number;
  sub_step?: string;
  attempt_index?: number;
  prompt_source: "langfuse_prompt_management" | "code" | "hybrid";
  prompt_name?: string;
  prompt_label?: string;
  prompt_version?: string;
  final_prompt_text: string;
  variables?: Record<string, unknown>;
  model_name: string;
  request_params?: Record<string, unknown>;
  room_id?: string;
  room_name?: string;
  camera_id?: string;
  image_count?: number;
}

export interface GenerationOutputPayload {
  model_name: string;
  response: unknown;
  raw_response?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  timing_ms: number;
}

export interface GenerationErrorPayload {
  error: true;
  message: string;
  name: string;
  stack?: string;
  raw_response_preview?: string;
  extracted_json_preview?: string;
  timing_ms: number;
}

export interface WrapModelGenerationParams {
  traceId: string;
  generationName: string;
  model: string;
  metadata: StandardMetadata;
  promptInfo?: {
    name?: string;
    version?: string;
    label?: string;
    source?: "langfuse_prompt_management" | "code" | "hybrid";
  };
  finalPromptText: string;
  variables?: Record<string, unknown>;
  requestParams?: Record<string, unknown>;
  imageCount?: number;
}

export interface WrapModelGenerationResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
  generationId?: string;
  timingMs: number;
}

// ============= SANITY GUARDS =============

class TracingError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = "TracingError";
  }
}

function validateInput(params: WrapModelGenerationParams): void {
  if (!params.traceId || params.traceId.length < 10) {
    throw new TracingError("TRACE_INPUT_MISSING: traceId is required", "TRACE_INPUT_MISSING");
  }
  if (!params.finalPromptText || params.finalPromptText.trim().length < 10) {
    throw new TracingError("TRACE_INPUT_MISSING: finalPromptText is required and must be non-trivial", "TRACE_INPUT_MISSING");
  }
  if (!params.generationName) {
    throw new TracingError("TRACE_INPUT_MISSING: generationName is required", "TRACE_INPUT_MISSING");
  }
}

// ============= HELPER: Ensure no null/undefined in payloads =============

function sanitizePayload<T extends Record<string, unknown>>(obj: T): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {
      result[key] = "<missing>";
    } else if (typeof value === "object" && !Array.isArray(value) && value !== null) {
      result[key] = sanitizePayload(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      result[key] = value.map(v => 
        typeof v === "object" && v !== null ? sanitizePayload(v as Record<string, unknown>) : v ?? "<missing>"
      );
    } else {
      result[key] = value;
    }
  }
  return result as T;
}

// ============= HELPER: Truncate prompt if too long =============

function truncateForLogging(text: string, maxLength: number = 50000): string {
  if (!text) return "<empty>";
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + `... [TRUNCATED: ${text.length - maxLength} more chars]`;
}

// ============= ENSURE TRACE EXISTS =============

export async function ensurePipelineTrace(
  pipelineId: string,
  projectId: string,
  ownerId: string,
  additionalMetadata?: Record<string, unknown>
): Promise<void> {
  if (!isLangfuseEnabled()) return;

  try {
    await createTrace({
      id: pipelineId,
      name: TRACE_NAMES.PIPELINE_RUN,
      userId: ownerId,
      sessionId: pipelineId,
      metadata: {
        project_id: projectId,
        pipeline_id: pipelineId,
        ...additionalMetadata,
      },
      tags: ["pipeline", "re-tour"],
    });
    console.log(`[LangfuseWrapper] Ensured trace exists: ${pipelineId}`);
  } catch (err) {
    console.log(`[LangfuseWrapper] Trace creation (may already exist): ${err}`);
  }
}

// ============= MAIN WRAPPER FUNCTION =============

/**
 * Wrap a model call with full Langfuse generation logging.
 * 
 * CRITICAL: This function logs a COMPLETE generation with both input AND output
 * in a single event. You MUST call flushLangfuse() before returning from the Edge Function!
 * 
 * @param params - Configuration for the generation
 * @param modelCallFn - Async function that performs the actual model call
 * @returns Result with data, error, timing, and generation ID
 */
export async function wrapModelGeneration<T>(
  params: WrapModelGenerationParams,
  modelCallFn: () => Promise<T>
): Promise<WrapModelGenerationResult<T>> {
  const startTime = new Date();
  const generationId = crypto.randomUUID();
  
  // Validate input before proceeding
  try {
    validateInput(params);
  } catch (validationError) {
    console.error(`[LangfuseWrapper] Validation failed:`, validationError);

    // Even if we didn't queue anything, keep behavior consistent: flush before returning.
    // This prevents serverless early-termination from dropping any queued events from
    // earlier operations in the same request.
    try {
      await flushLangfuse();
    } catch {
      // no-op
    }
    return {
      success: false,
      error: validationError instanceof Error ? validationError : new Error(String(validationError)),
      generationId,
      timingMs: 0,
    };
  }
  
  // Build the full input payload (never null/undefined)
  const inputPayload: GenerationInputPayload = sanitizePayload({
    pipeline_id: params.metadata.pipeline_id || params.traceId,
    project_id: params.metadata.project_id || "<unknown>",
    step_number: params.metadata.step_number ?? 0,
    sub_step: params.metadata.sub_step || undefined,
    attempt_index: params.metadata.attempt_index ?? 0,
    prompt_source: params.promptInfo?.source ?? "code",
    prompt_name: params.promptInfo?.name ?? "<none>",
    prompt_label: params.promptInfo?.label ?? "production",
    prompt_version: params.promptInfo?.version ?? "<none>",
    final_prompt_text: truncateForLogging(params.finalPromptText),
    variables: params.variables ?? {},
    model_name: params.model,
    request_params: params.requestParams ?? {},
    room_id: params.metadata.room_id || undefined,
    room_name: params.metadata.room_name || undefined,
    camera_id: params.metadata.camera_id || undefined,
    image_count: params.imageCount,
  });

  // Build metadata
  const fullMetadata = buildStandardMetadata(params.metadata);

  console.log(`[LangfuseWrapper] Executing generation: ${params.generationName}`);

  // Execute the model call
  let result: T;
  let timingMs: number;
  let outputPayload: GenerationOutputPayload | GenerationErrorPayload;
  let level: "DEFAULT" | "ERROR" = "DEFAULT";
  let statusMessage = "Generation completed successfully";
  
  try {
    result = await modelCallFn();
    const endTime = new Date();
    timingMs = endTime.getTime() - startTime.getTime();

    // Validate output is not empty
    if (result === null || result === undefined) {
      console.warn(`[LangfuseWrapper] Warning: Model returned empty response`);
    }

    // Build success output payload
    outputPayload = sanitizePayload({
      model_name: params.model,
      response: result ?? "<empty_response>",
      timing_ms: timingMs,
    });

    console.log(`[LangfuseWrapper] Generation succeeded: ${params.generationName} (${timingMs}ms)`);

  } catch (error) {
    const endTime = new Date();
    timingMs = endTime.getTime() - startTime.getTime();
    
    const err = error instanceof Error ? error : new Error(String(error));
    
    // Extract raw response if attached to error (for JSON parse failures)
    const rawResponse = (error as any)?.rawResponse;
    const extractedJson = (error as any)?.extractedJson;
    
    // Build error output payload - NEVER undefined
    outputPayload = {
      error: true as const,
      message: err.message || "<no_message>",
      name: err.name || "Error",
      stack: err.stack?.substring(0, 2000) || "<no_stack>",
      raw_response_preview: rawResponse ? String(rawResponse).substring(0, 1000) : undefined,
      extracted_json_preview: extractedJson ? String(extractedJson).substring(0, 1000) : undefined,
      timing_ms: timingMs,
    };
    
    level = "ERROR";
    statusMessage = `Error: ${err.message}`;

    console.log(`[LangfuseWrapper] Generation failed: ${params.generationName} - ${err.message}`);

    // Log the complete generation with error output
    if (isLangfuseEnabled()) {
      try {
        await logCompleteGeneration({
          id: generationId,
          traceId: params.traceId,
          name: params.generationName,
          model: params.model,
          input: inputPayload,
          output: outputPayload,
          startTime,
          endTime,
          metadata: fullMetadata,
          level,
          statusMessage,
          promptName: params.promptInfo?.name,
          promptVersion: params.promptInfo?.version,
        });
      } catch (logErr) {
        console.error(`[LangfuseWrapper] Failed to log error generation:`, logErr);
      }
    }

    // CRITICAL: Flush before returning (serverless can terminate immediately)
    try {
      await flushLangfuse();
    } catch {
      // no-op
    }

    return {
      success: false,
      error: err,
      generationId,
      timingMs,
    };
  }

  // Log the complete generation with success output
  if (isLangfuseEnabled()) {
    const endTime = new Date();
    try {
      await logCompleteGeneration({
        id: generationId,
        traceId: params.traceId,
        name: params.generationName,
        model: params.model,
        input: inputPayload,
        output: outputPayload,
        startTime,
        endTime,
        metadata: fullMetadata,
        level,
        statusMessage,
        promptName: params.promptInfo?.name,
        promptVersion: params.promptInfo?.version,
      });
    } catch (logErr) {
      console.error(`[LangfuseWrapper] Failed to log success generation:`, logErr);
    }
  }

  // CRITICAL: Flush before returning (serverless can terminate immediately)
  try {
    await flushLangfuse();
  } catch {
    // no-op
  }

  return {
    success: true,
    data: result,
    generationId,
    timingMs,
  };
}

// ============= CONVENIENCE: Wrap with auto-retry logging =============

export interface WrapWithRetryParams extends WrapModelGenerationParams {
  maxRetries?: number;
  retryDelayMs?: number;
}

export async function wrapModelGenerationWithRetry<T>(
  params: WrapWithRetryParams,
  modelCallFn: () => Promise<T>
): Promise<WrapModelGenerationResult<T>> {
  const maxRetries = params.maxRetries ?? 1;
  const retryDelayMs = params.retryDelayMs ?? 1000;
  
  let lastError: Error | undefined;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const attemptMetadata = {
      ...params.metadata,
      attempt_index: attempt,
    };
    
    const attemptParams = {
      ...params,
      metadata: attemptMetadata,
      generationName: attempt > 0 
        ? `${params.generationName}_retry_${attempt}` 
        : params.generationName,
    };
    
    const result = await wrapModelGeneration(attemptParams, modelCallFn);
    
    if (result.success) {
      return result;
    }
    
    lastError = result.error;
    
    if (attempt < maxRetries) {
      console.log(`[LangfuseWrapper] Retry ${attempt + 1}/${maxRetries} after ${retryDelayMs}ms`);
      await new Promise(resolve => setTimeout(resolve, retryDelayMs));
    }
  }
  
  return {
    success: false,
    error: lastError,
    timingMs: 0,
  };
}

// ============= CONVENIENCE: Log a simple event (no model call) =============

export interface LogEventParams {
  traceId: string;
  eventName: string;
  metadata: StandardMetadata;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
}

export async function logPipelineEvent(params: LogEventParams): Promise<void> {
  if (!isLangfuseEnabled()) return;
  
  const now = new Date();
  
  try {
    await logCompleteGeneration({
      traceId: params.traceId,
      name: params.eventName,
      model: "system",
      input: sanitizePayload(params.input),
      output: sanitizePayload(params.output),
      startTime: now,
      endTime: now,
      metadata: buildStandardMetadata(params.metadata),
      level: "DEFAULT",
    });
    await flushLangfuse();
  } catch (err) {
    console.error(`[LangfuseWrapper] Failed to log event ${params.eventName}:`, err);
  }
}

// ============= SIMPLE GENERATION LOGGING =============

export interface SimpleGenerationParams {
  traceId: string;
  name: string;
  model: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  metadata: StandardMetadata;
  timingMs?: number;
}

export async function logSimpleGeneration(params: SimpleGenerationParams): Promise<void> {
  if (!isLangfuseEnabled()) return;
  
  const now = new Date();
  const startTime = params.timingMs ? new Date(now.getTime() - params.timingMs) : now;
  
  try {
    await logCompleteGeneration({
      traceId: params.traceId,
      name: params.name,
      model: params.model,
      input: sanitizePayload(params.input),
      output: sanitizePayload(params.output),
      startTime,
      endTime: now,
      metadata: buildStandardMetadata(params.metadata),
      level: "DEFAULT",
    });
    console.log(`[LangfuseWrapper] Logged generation: ${params.name}`);
    await flushLangfuse();
  } catch (err) {
    console.error(`[LangfuseWrapper] Failed to log generation ${params.name}:`, err);
  }
}
