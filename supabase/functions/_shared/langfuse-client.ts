/**
 * Langfuse Observability Client for RE:TOUR Edge Functions
 * 
 * CRITICAL FIX: Uses the /api/public/ingestion endpoint with proper batching
 * and generation IDs to ensure input/output are visible in Langfuse UI.
 * 
 * This module provides:
 * - Trace/Generation/Span logging with guaranteed input/output recording
 * - Prompt Management (fetch prompts by name + label)
 * - Score recording for A/B testing metrics
 * - Safe no-op behavior when disabled
 * 
 * Required Environment Variables:
 * - LANGFUSE_ENABLED: "true" to enable, anything else disables
 * - LANGFUSE_SECRET_KEY: Langfuse secret key (sk-lf-...)
 * - LANGFUSE_PUBLIC_KEY: Langfuse public key (pk-lf-...)
 * - LANGFUSE_BASE_URL: Langfuse API base URL (https://cloud.langfuse.com)
 */

import {
  TRACE_NAMES,
  buildStandardMetadata,
  getABBucket,
  getPromptLabel,
  type StandardMetadata,
} from "./langfuse-constants.ts";

// Re-export for convenience
export {
  TRACE_NAMES,
  STEP_0_GENERATIONS,
  STEP_1_GENERATIONS,
  STEP_2_GENERATIONS,
  STEP_3_1_GENERATIONS,
  STEP_3_2_GENERATIONS,
  STEP_4_GENERATIONS,
  STEP_5_GENERATIONS,
  STEP_6_GENERATIONS,
  STEP_7_GENERATIONS,
  PROMPT_NAMES,
  buildStandardMetadata,
  getABBucket,
  getPromptLabel,
  type StandardMetadata,
} from "./langfuse-constants.ts";

// ============= TYPES =============

export interface LangfuseTraceParams {
  id?: string;
  name: string;
  userId?: string;
  metadata?: Record<string, unknown>;
  tags?: string[];
  sessionId?: string;
  input?: unknown;
  output?: unknown;
}

export interface LangfuseGenerationParams {
  id?: string; // CRITICAL: Include ID for updates
  traceId: string;
  name: string;
  model: string;
  modelParameters?: Record<string, unknown>;
  input?: unknown;
  output?: unknown;
  startTime?: Date;
  endTime?: Date;
  completionStartTime?: Date;
  metadata?: Record<string, unknown>;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  level?: "DEBUG" | "DEFAULT" | "WARNING" | "ERROR";
  statusMessage?: string;
  promptName?: string;
  promptVersion?: string;
}

export interface LangfuseSpanParams {
  id?: string;
  traceId: string;
  name: string;
  startTime?: Date;
  endTime?: Date;
  metadata?: Record<string, unknown>;
  input?: unknown;
  output?: unknown;
  level?: "DEBUG" | "DEFAULT" | "WARNING" | "ERROR";
  statusMessage?: string;
}

export interface LangfuseScoreParams {
  traceId: string;
  name: string;
  value: number;
  comment?: string;
  observationId?: string;
}

export interface LangfusePrompt {
  name: string;
  version: number;
  prompt: string;
  config?: Record<string, unknown>;
  labels?: string[];
  tags?: string[];
}

interface LangfuseConfig {
  enabled: boolean;
  secretKey: string;
  publicKey: string;
  baseUrl: string;
}

// ============= CONFIGURATION =============

function getConfig(): LangfuseConfig {
  const enabled = Deno.env.get("LANGFUSE_ENABLED") === "true";
  const secretKey = Deno.env.get("LANGFUSE_SECRET_KEY") || "";
  const publicKey = Deno.env.get("LANGFUSE_PUBLIC_KEY") || "";
  const baseUrl = Deno.env.get("LANGFUSE_BASE_URL") || "https://cloud.langfuse.com";

  return { enabled, secretKey, publicKey, baseUrl };
}

export function isLangfuseEnabled(): boolean {
  const config = getConfig();
  return config.enabled && !!config.secretKey && !!config.publicKey;
}

// ============= INGESTION BATCH API =============

interface IngestionEvent {
  id: string;
  type: "trace-create" | "generation-create" | "generation-update" | "span-create" | "span-update" | "score-create";
  timestamp: string;
  body: Record<string, unknown>;
}

// Pending events to be flushed
let pendingEvents: IngestionEvent[] = [];

/**
 * Add an event to the batch queue
 */
function queueEvent(event: IngestionEvent): void {
  pendingEvents.push(event);
}

/**
 * CRITICAL: Flush all pending events to Langfuse
 * This MUST be called before the Edge Function returns!
 */
export async function flushLangfuse(): Promise<{ success: boolean; error?: string }> {
  if (!isLangfuseEnabled()) {
    pendingEvents = [];
    return { success: true };
  }

  if (pendingEvents.length === 0) {
    return { success: true };
  }

  const config = getConfig();
  const authString = `${config.publicKey}:${config.secretKey}`;
  const authHeader = `Basic ${btoa(authString)}`;

  const batch = [...pendingEvents];
  pendingEvents = []; // Clear immediately to prevent duplicate sends

  console.log(`[Langfuse] Flushing ${batch.length} events to ingestion API`);

  try {
    const response = await fetch(`${config.baseUrl}/api/public/ingestion`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": authHeader,
      },
      body: JSON.stringify({
        batch,
        metadata: {
          sdk_name: "retour-edge-functions",
          sdk_version: "2.0.0",
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Langfuse] Ingestion API error: ${response.status} - ${errorText}`);
      return { success: false, error: `Ingestion error: ${response.status}` };
    }

    const result = await response.json();
    console.log(`[Langfuse] Flushed successfully:`, result);
    return { success: true };
  } catch (error) {
    console.error("[Langfuse] Flush failed:", error instanceof Error ? error.message : "Unknown error");
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

// ============= TRACE OPERATIONS =============

export async function createTrace(params: LangfuseTraceParams): Promise<{ success: boolean; traceId?: string; error?: string }> {
  if (!isLangfuseEnabled()) {
    console.log("[Langfuse] Disabled, skipping trace creation");
    return { success: true, traceId: params.id || `noop-${Date.now()}` };
  }

  const traceId = params.id || crypto.randomUUID();
  
  queueEvent({
    id: crypto.randomUUID(),
    type: "trace-create",
    timestamp: new Date().toISOString(),
    body: {
      id: traceId,
      name: params.name,
      userId: params.userId,
      metadata: params.metadata,
      tags: params.tags,
      sessionId: params.sessionId,
      input: params.input,
      output: params.output,
    },
  });

  console.log(`[Langfuse] Queued trace creation: ${params.name} (id: ${traceId})`);
  
  return { success: true, traceId };
}

export async function updateTrace(
  traceId: string,
  updates: { output?: unknown; metadata?: Record<string, unknown>; tags?: string[] }
): Promise<{ success: boolean; error?: string }> {
  if (!isLangfuseEnabled()) {
    return { success: true };
  }

  // Trace updates use the same trace-create type (upsert behavior)
  queueEvent({
    id: crypto.randomUUID(),
    type: "trace-create",
    timestamp: new Date().toISOString(),
    body: {
      id: traceId,
      ...updates,
    },
  });

  console.log(`[Langfuse] Queued trace update: ${traceId}`);
  
  return { success: true };
}

// ============= GENERATION OPERATIONS =============

/**
 * Log a generation with full input/output in a single call.
 * CRITICAL: This queues the event - you MUST call flushLangfuse() before returning!
 */
export async function logGeneration(params: LangfuseGenerationParams): Promise<{ success: boolean; generationId?: string; error?: string }> {
  if (!isLangfuseEnabled()) {
    console.log("[Langfuse] Disabled, skipping generation log");
    return { success: true, generationId: params.id || `noop-${Date.now()}` };
  }

  const generationId = params.id || crypto.randomUUID();
  
  // Determine if this is a create or update based on whether endTime is set
  const isComplete = !!params.endTime;
  
  const payload: Record<string, unknown> = {
    id: generationId,
    traceId: params.traceId,
    name: params.name,
    model: params.model,
    modelParameters: params.modelParameters,
    input: params.input,
    output: params.output,
    startTime: params.startTime?.toISOString() || new Date().toISOString(),
    metadata: params.metadata,
    usage: params.usage,
    level: params.level || "DEFAULT",
    statusMessage: params.statusMessage,
  };

  // Only include endTime if set
  if (params.endTime) {
    payload.endTime = params.endTime.toISOString();
  }
  if (params.completionStartTime) {
    payload.completionStartTime = params.completionStartTime.toISOString();
  }

  // Add prompt reference if provided
  if (params.promptName) {
    payload.promptName = params.promptName;
    if (params.promptVersion) {
      payload.promptVersion = parseInt(params.promptVersion, 10) || undefined;
    }
  }

  queueEvent({
    id: crypto.randomUUID(),
    type: isComplete ? "generation-update" : "generation-create",
    timestamp: new Date().toISOString(),
    body: payload,
  });

  console.log(`[Langfuse] Queued generation ${isComplete ? "update" : "create"}: ${params.name} (model: ${params.model})`);
  
  return { success: true, generationId };
}

/**
 * Create a generation with input and immediately update with output.
 * This ensures both input AND output are recorded in a single generation.
 * 
 * CRITICAL: Always call flushLangfuse() after this!
 */
export async function logCompleteGeneration(
  params: LangfuseGenerationParams & { output: unknown }
): Promise<{ success: boolean; generationId?: string; error?: string }> {
  if (!isLangfuseEnabled()) {
    return { success: true, generationId: `noop-${Date.now()}` };
  }

  const generationId = params.id || crypto.randomUUID();
  const now = new Date();
  
  // Single event with both input and output
  const payload: Record<string, unknown> = {
    id: generationId,
    traceId: params.traceId,
    name: params.name,
    model: params.model,
    modelParameters: params.modelParameters,
    input: params.input,
    output: params.output,
    startTime: params.startTime?.toISOString() || now.toISOString(),
    endTime: params.endTime?.toISOString() || now.toISOString(),
    metadata: params.metadata,
    usage: params.usage,
    level: params.level || "DEFAULT",
    statusMessage: params.statusMessage,
  };

  if (params.promptName) {
    payload.promptName = params.promptName;
    if (params.promptVersion) {
      payload.promptVersion = parseInt(params.promptVersion, 10) || undefined;
    }
  }

  // Use generation-create with all fields set
  queueEvent({
    id: crypto.randomUUID(),
    type: "generation-create",
    timestamp: now.toISOString(),
    body: payload,
  });

  console.log(`[Langfuse] Queued complete generation: ${params.name} (model: ${params.model})`);
  
  return { success: true, generationId };
}

// ============= SPAN OPERATIONS =============

export async function logSpan(params: LangfuseSpanParams): Promise<{ success: boolean; spanId?: string; error?: string }> {
  if (!isLangfuseEnabled()) {
    console.log("[Langfuse] Disabled, skipping span log");
    return { success: true, spanId: params.id || `noop-${Date.now()}` };
  }

  const spanId = params.id || crypto.randomUUID();
  
  queueEvent({
    id: crypto.randomUUID(),
    type: "span-create",
    timestamp: new Date().toISOString(),
    body: {
      id: spanId,
      traceId: params.traceId,
      name: params.name,
      startTime: params.startTime?.toISOString() || new Date().toISOString(),
      endTime: params.endTime?.toISOString(),
      metadata: params.metadata,
      input: params.input,
      output: params.output,
      level: params.level || "DEFAULT",
      statusMessage: params.statusMessage,
    },
  });

  console.log(`[Langfuse] Queued span: ${params.name}`);
  
  return { success: true, spanId };
}

// ============= SCORE OPERATIONS =============

export async function recordScore(params: LangfuseScoreParams): Promise<{ success: boolean; error?: string }> {
  if (!isLangfuseEnabled()) {
    console.log("[Langfuse] Disabled, skipping score recording");
    return { success: true };
  }

  const payload: Record<string, unknown> = {
    id: crypto.randomUUID(),
    traceId: params.traceId,
    name: params.name,
    value: params.value,
    comment: params.comment,
  };

  if (params.observationId) {
    payload.observationId = params.observationId;
  }

  queueEvent({
    id: crypto.randomUUID(),
    type: "score-create",
    timestamp: new Date().toISOString(),
    body: payload,
  });

  console.log(`[Langfuse] Queued score: ${params.name} = ${params.value}`);
  
  return { success: true };
}

export async function recordQAScore(
  traceId: string,
  pass: boolean,
  stepNumber: number,
  attemptIndex: number,
  generationId?: string
): Promise<{ success: boolean; error?: string }> {
  return recordScore({
    traceId,
    name: `qa_pass_step_${stepNumber}`,
    value: pass ? 1 : 0,
    comment: `Attempt ${attemptIndex}: ${pass ? "PASS" : "FAIL"}`,
    observationId: generationId,
  });
}

export async function recordRetryCount(
  traceId: string,
  stepNumber: number,
  retryCount: number
): Promise<{ success: boolean; error?: string }> {
  return recordScore({
    traceId,
    name: `retry_count_step_${stepNumber}`,
    value: retryCount,
    comment: `Total retries for step ${stepNumber}`,
  });
}

// ============= PROMPT MANAGEMENT =============

export async function fetchPrompt(
  promptName: string,
  label?: string
): Promise<LangfusePrompt | null> {
  if (!isLangfuseEnabled()) {
    console.log("[Langfuse] Disabled, skipping prompt fetch");
    return null;
  }

  const config = getConfig();
  const authString = `${config.publicKey}:${config.secretKey}`;
  const authHeader = `Basic ${btoa(authString)}`;

  try {
    let url = `${config.baseUrl}/api/public/v2/prompts/${encodeURIComponent(promptName)}`;
    if (label) {
      url += `?label=${encodeURIComponent(label)}`;
    }

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": authHeader,
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        console.warn(`[Langfuse] Prompt not found: ${promptName}${label ? ` (label: ${label})` : ""}`);
        return null;
      }
      const errorText = await response.text();
      console.error(`[Langfuse] Prompt fetch error: ${response.status} - ${errorText}`);
      return null;
    }

    const data = await response.json();
    
    console.log(`[Langfuse] Fetched prompt: ${promptName} v${data.version}${label ? ` (${label})` : ""}`);
    
    return {
      name: data.name,
      version: data.version,
      prompt: data.prompt,
      config: data.config,
      labels: data.labels,
      tags: data.tags,
    };
  } catch (error) {
    console.error("[Langfuse] Prompt fetch failed:", error instanceof Error ? error.message : "Unknown error");
    return null;
  }
}

export async function fetchPromptWithAB(
  promptName: string,
  pipelineId: string,
  experimentName: string = "default"
): Promise<{ prompt: LangfusePrompt | null; bucket: "A" | "B"; label: string }> {
  const bucket = getABBucket(pipelineId, experimentName);
  const label = getPromptLabel(bucket);
  const prompt = await fetchPrompt(promptName, label);
  
  return { prompt, bucket, label };
}

// ============= PIPELINE-SPECIFIC HELPERS =============

export async function createPipelineRunTrace(
  pipelineId: string,
  projectId: string,
  ownerId: string,
  additionalMetadata?: Record<string, unknown>
): Promise<{ success: boolean; traceId: string; error?: string }> {
  const metadata = buildStandardMetadata({
    project_id: projectId,
    pipeline_id: pipelineId,
    step_number: 0,
    ...additionalMetadata,
  });

  const result = await createTrace({
    id: pipelineId,
    name: TRACE_NAMES.PIPELINE_RUN,
    userId: ownerId,
    sessionId: pipelineId,
    metadata,
    tags: ["pipeline", "re-tour"],
  });

  return {
    success: result.success,
    traceId: result.traceId || pipelineId,
    error: result.error,
  };
}

export async function logStepGeneration(
  traceId: string,
  generationName: string,
  model: string,
  input: unknown,
  output: unknown,
  startTime: Date,
  endTime: Date,
  metadata: StandardMetadata,
  promptInfo?: { name: string; version: string }
): Promise<{ success: boolean; generationId?: string; error?: string }> {
  return logCompleteGeneration({
    traceId,
    name: generationName,
    model,
    input,
    output,
    startTime,
    endTime,
    metadata: buildStandardMetadata(metadata),
    promptName: promptInfo?.name,
    promptVersion: promptInfo?.version,
  });
}

/**
 * Legacy helper for backward compatibility
 */
export async function createPipelineTrace(
  pipelineId: string,
  stepName: string,
  metadata?: Record<string, unknown>
): Promise<{ success: boolean; traceId?: string; error?: string }> {
  return createTrace({
    id: pipelineId,
    name: TRACE_NAMES.PIPELINE_RUN,
    metadata: {
      pipeline_id: pipelineId,
      step_name: stepName,
      ...metadata,
    },
    tags: ["pipeline", "re-tour"],
  });
}

/**
 * Convenience: Create trace and ensure it's flushed
 * Use this when you just need a trace without generations
 */
export async function createAndFlushTrace(params: LangfuseTraceParams): Promise<{ success: boolean; traceId?: string; error?: string }> {
  const result = await createTrace(params);
  await flushLangfuse();
  return result;
}
