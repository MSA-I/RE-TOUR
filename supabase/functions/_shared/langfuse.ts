/**
 * Shared Langfuse tracing utility (Edge Functions)
 *
 * Goal: make Input/Output NEVER empty by enforcing:
 * - explicit generation input + output
 * - structured error output
 * - always flushing before returning
 *
 * IMPORTANT: This module is observability-only and must not affect business logic.
 */

import {
  createTrace,
  flushLangfuse,
  isLangfuseEnabled,
  logCompleteGeneration,
  type LangfuseTraceParams,
} from "./langfuse-client.ts";

import { TRACE_NAMES, buildStandardMetadata, type StandardMetadata } from "./langfuse-constants.ts";

export type TraceLLMErrorCode =
  | "TRACE_INPUT_MISSING"
  | "TRACE_OUTPUT_EMPTY"
  | "STEP_OUTPUT_INVALID"
  | "RUN_FN_ERROR";

export interface TraceLLMParams<TParsed> {
  traceName: (typeof TRACE_NAMES)[keyof typeof TRACE_NAMES];
  pipelineId: string;
  stepNumber: number;
  subStep?: string;
  generationName: string;
  promptName?: string;
  promptVersion?: string;
  modelName: string;
  metadata: StandardMetadata;
  inputPayload: Record<string, unknown>;
  /**
   * Executes the actual model/tool call and returns a raw response.
   * MUST throw on HTTP/SDK errors.
   */
  runFn: () => Promise<{ raw: unknown; parsed: TParsed }>;
}

function sanitizeForLangfuse(value: unknown): unknown {
  if (value === null || value === undefined) return "<missing>";
  if (Array.isArray(value)) return value.map(sanitizeForLangfuse);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitizeForLangfuse(v);
    }
    return out;
  }
  return value;
}

function ensureNonEmptyInput(inputPayload: Record<string, unknown>): void {
  if (!inputPayload || Object.keys(inputPayload).length === 0) {
    const err = new Error("TRACE_INPUT_MISSING: inputPayload is empty");
    (err as any).code = "TRACE_INPUT_MISSING" satisfies TraceLLMErrorCode;
    throw err;
  }
}

function ensureNonEmptyRaw(raw: unknown): void {
  const isEmptyString = typeof raw === "string" && raw.trim().length === 0;
  if (raw === null || raw === undefined || isEmptyString) {
    const err = new Error("TRACE_OUTPUT_EMPTY: raw output is empty");
    (err as any).code = "TRACE_OUTPUT_EMPTY" satisfies TraceLLMErrorCode;
    throw err;
  }
}

function buildErrorOutput(params: {
  code: TraceLLMErrorCode;
  message: string;
  name?: string;
  stack?: string;
  raw_preview?: string;
  timing_ms: number;
}): Record<string, unknown> {
  return sanitizeForLangfuse({
    error: true,
    code: params.code,
    message: params.message,
    name: params.name ?? "Error",
    stack: params.stack ?? "<no_stack>",
    raw_preview: params.raw_preview,
    timing_ms: params.timing_ms,
  }) as Record<string, unknown>;
}

/**
 * Single entry-point for traced model/tool calls.
 * This ALWAYS flushes before returning.
 */
export async function traceLLM<TParsed>(
  params: TraceLLMParams<TParsed>
): Promise<{ raw: unknown; parsed: TParsed }> {
  const start = Date.now();

  // Guard: never allow empty inputs to be silently logged as null
  ensureNonEmptyInput(params.inputPayload);

  if (isLangfuseEnabled()) {
    const traceParams: LangfuseTraceParams = {
      id: params.pipelineId,
      name: params.traceName,
      sessionId: params.pipelineId,
      metadata: {
        project_id: params.metadata.project_id,
        pipeline_id: params.pipelineId,
      },
      tags: ["pipeline", "re-tour"],
    };
    await createTrace(traceParams);
  }

  const generationId = crypto.randomUUID();
  const standardizedMetadata = buildStandardMetadata({
    ...params.metadata,
    step_number: params.stepNumber,
    sub_step: params.subStep,
    prompt_name: params.promptName,
    prompt_version: params.promptVersion,
    model_name: params.modelName,
  });

  try {
    const { raw, parsed } = await params.runFn();
    ensureNonEmptyRaw(raw);

    if (isLangfuseEnabled()) {
      await logCompleteGeneration({
        id: generationId,
        traceId: params.pipelineId,
        name: params.generationName,
        model: params.modelName,
        input: sanitizeForLangfuse(params.inputPayload),
        output: sanitizeForLangfuse({
          raw,
          parsed,
          timing_ms: Date.now() - start,
        }),
        startTime: new Date(start),
        endTime: new Date(),
        metadata: standardizedMetadata,
        level: "DEFAULT",
        statusMessage: "ok",
        promptName: params.promptName,
        promptVersion: params.promptVersion,
      });
    }

    await flushLangfuse();
    return { raw, parsed };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    const code = ((e as any)?.code as TraceLLMErrorCode) || "RUN_FN_ERROR";

    if (isLangfuseEnabled()) {
      await logCompleteGeneration({
        id: generationId,
        traceId: params.pipelineId,
        name: params.generationName,
        model: params.modelName,
        input: sanitizeForLangfuse(params.inputPayload),
        output: buildErrorOutput({
          code,
          message: err.message,
          name: err.name,
          stack: err.stack?.slice(0, 2000),
          raw_preview:
            typeof (e as any)?.rawResponse === "string"
              ? (e as any).rawResponse.slice(0, 1000)
              : undefined,
          timing_ms: Date.now() - start,
        }),
        startTime: new Date(start),
        endTime: new Date(),
        metadata: standardizedMetadata,
        level: "ERROR",
        statusMessage: `error: ${code}`,
        promptName: params.promptName,
        promptVersion: params.promptVersion,
      });
    }

    await flushLangfuse();
    throw err;
  }
}
