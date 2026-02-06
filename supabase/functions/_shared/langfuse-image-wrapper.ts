/**
 * Langfuse Image Generation Wrapper for RE:TOUR Edge Functions
 * 
 * This is the SINGLE entry point for all image generation API calls.
 * All pipeline steps (1-7) MUST use this wrapper - direct API calls are BANNED.
 * 
 * Features:
 * - Automatic Langfuse trace/generation logging with non-empty input/output
 * - Structured error logging on failures
 * - Mandatory flush before returning
 * - Consistent metadata across all steps
 * 
 * Usage:
 *   const result = await wrapImageGeneration({...}, async () => { ... });
 */

import {
  isLangfuseEnabled,
  logCompleteGeneration,
  createTrace,
  flushLangfuse,
} from "./langfuse-client.ts";

import {
  buildStandardMetadata,
  TRACE_NAMES,
  STEP_1_GENERATIONS,
  STEP_2_GENERATIONS,
  STEP_4_GENERATIONS,
  STEP_5_GENERATIONS,
  STEP_6_GENERATIONS,
  STEP_7_GENERATIONS,
  type StandardMetadata,
} from "./langfuse-constants.ts";

// Re-export for convenience
export { flushLangfuse } from "./langfuse-client.ts";

// ============= CONSTANTS =============
const GEMINI_IMAGE_MODEL = "gemini-3-pro-image-preview";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// ============= TYPES =============

export interface ImageGenerationParams {
  pipelineId: string;
  projectId: string;
  ownerId: string;
  stepNumber: number;
  subStep?: string;
  attemptIndex?: number;
  roomId?: string;
  roomName?: string;
  cameraId?: string;
  promptText: string;
  imageSize?: string;
  aspectRatio?: string;
  requestParams?: Record<string, unknown>;
  variationIndex?: number;
}

export interface ImageGenerationRequest {
  contents: Array<{
    role: string;
    parts: Array<{
      text?: string;
      inlineData?: { mimeType: string; data: string };
    }>;
  }>;
  generationConfig: {
    responseModalities: string[];
    imageConfig?: {
      aspectRatio?: string;
      imageSize?: string;
    };
  };
}

export interface ImageGenerationResult {
  success: boolean;
  imageData?: {
    base64: string;
    mimeType: string;
  };
  error?: Error;
  generationId?: string;
  timingMs: number;
  rawResponse?: unknown;
}

// ============= HELPER: Get generation name by step =============

function getImageGenGenerationName(stepNumber: number): string {
  switch (stepNumber) {
    case 1: return STEP_1_GENERATIONS.IMAGE_GEN;
    case 2: return STEP_2_GENERATIONS.IMAGE_GEN;
    case 4: return STEP_4_GENERATIONS.MULTI_PANO_GEN;
    case 5: return STEP_5_GENERATIONS.RENDER_GEN;
    case 6: return STEP_6_GENERATIONS.PANO_360_GEN;
    case 7: return STEP_7_GENERATIONS.MERGE_PANOS;
    default: return `image_gen_step_${stepNumber}`;
  }
}

// ============= HELPER: Sanitize payloads =============

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

function truncateForLogging(text: string, maxLength: number = 50000): string {
  if (!text) return "<empty>";
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + `... [TRUNCATED: ${text.length - maxLength} more chars]`;
}

// ============= MAIN WRAPPER FUNCTION =============

/**
 * Wrap a Gemini image generation call with full Langfuse logging.
 * 
 * CRITICAL: This function logs a COMPLETE generation with both input AND output
 * in a single event. Always flushes before returning.
 * 
 * @param params - Configuration for the generation
 * @param apiKey - The API key for Gemini
 * @param requestBody - The full request body to send to Gemini API
 * @returns Result with imageData, error, timing, and generation ID
 */
export async function wrapImageGeneration(
  params: ImageGenerationParams,
  apiKey: string,
  requestBody: ImageGenerationRequest
): Promise<ImageGenerationResult> {
  const startTime = new Date();
  const generationId = crypto.randomUUID();
  const generationName = getImageGenGenerationName(params.stepNumber);
  
  // Ensure pipeline trace exists
  if (isLangfuseEnabled()) {
    try {
      await createTrace({
        id: params.pipelineId,
        name: TRACE_NAMES.PIPELINE_RUN,
        userId: params.ownerId,
        sessionId: params.pipelineId,
        metadata: {
          project_id: params.projectId,
          pipeline_id: params.pipelineId,
        },
        tags: ["pipeline", "re-tour"],
      });
    } catch {
      // Trace may already exist, continue
    }
  }
  
  // Build input payload for logging (never null/undefined)
  const inputPayload = sanitizePayload({
    pipeline_id: params.pipelineId,
    project_id: params.projectId,
    step_number: params.stepNumber,
    sub_step: params.subStep || undefined,
    attempt_index: params.attemptIndex ?? 0,
    room_id: params.roomId || undefined,
    room_name: params.roomName || undefined,
    camera_id: params.cameraId || undefined,
    variation_index: params.variationIndex ?? 0,
    model_name: GEMINI_IMAGE_MODEL,
    prompt_text: truncateForLogging(params.promptText),
    image_size: params.imageSize || "1K",
    aspect_ratio: params.aspectRatio || "1:1",
    request_params: params.requestParams || {},
    image_input_count: requestBody.contents[0]?.parts.filter(p => p.inlineData).length || 0,
  });

  // Build metadata
  const fullMetadata = buildStandardMetadata({
    project_id: params.projectId,
    pipeline_id: params.pipelineId,
    step_number: params.stepNumber,
    sub_step: params.subStep,
    room_id: params.roomId,
    room_name: params.roomName,
    camera_id: params.cameraId,
    attempt_index: params.attemptIndex,
    model_name: GEMINI_IMAGE_MODEL,
  });

  console.log(`[LangfuseImageWrapper] Starting ${generationName} for pipeline ${params.pipelineId}`);
  console.log(`[LangfuseImageWrapper] Langfuse trace created: ${params.pipelineId}`);

  // Call Gemini API
  let result: Response;
  let timingMs: number;
  
  try {
    const geminiUrl = `${GEMINI_API_BASE}/${GEMINI_IMAGE_MODEL}:generateContent`;
    
    result = await fetch(geminiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(requestBody),
    });

    const endTime = new Date();
    timingMs = endTime.getTime() - startTime.getTime();
    
    if (!result.ok) {
      const errorText = await result.text();
      const error = new Error(`Gemini API error: ${result.status} - ${errorText}`);
      
      console.error(`[LangfuseImageWrapper] API error: ${result.status}`);
      
      // Log error to Langfuse
      if (isLangfuseEnabled()) {
        try {
          await logCompleteGeneration({
            id: generationId,
            traceId: params.pipelineId,
            name: generationName,
            model: GEMINI_IMAGE_MODEL,
            input: inputPayload,
            output: sanitizePayload({
              error: true,
              status_code: result.status,
              message: errorText.substring(0, 2000),
              timing_ms: timingMs,
            }),
            startTime,
            endTime,
            metadata: fullMetadata,
            level: "ERROR",
            statusMessage: `Error: ${result.status}`,
          });
        } catch (logErr) {
          console.error(`[LangfuseImageWrapper] Failed to log error:`, logErr);
        }
      }
      
      await flushLangfuse();
      
      return {
        success: false,
        error,
        generationId,
        timingMs,
      };
    }

    // Parse successful response
    const responseData = await result.json();
    const candidates = responseData.candidates;
    
    if (!candidates || candidates.length === 0) {
      const error = new Error("No candidates in Gemini response");
      
      if (isLangfuseEnabled()) {
        try {
          await logCompleteGeneration({
            id: generationId,
            traceId: params.pipelineId,
            name: generationName,
            model: GEMINI_IMAGE_MODEL,
            input: inputPayload,
            output: sanitizePayload({
              error: true,
              message: "No candidates in response",
              raw_response_preview: JSON.stringify(responseData).substring(0, 1000),
              timing_ms: timingMs,
            }),
            startTime,
            endTime,
            metadata: fullMetadata,
            level: "ERROR",
            statusMessage: "No candidates",
          });
        } catch (logErr) {
          console.error(`[LangfuseImageWrapper] Failed to log error:`, logErr);
        }
      }
      
      await flushLangfuse();
      
      return {
        success: false,
        error,
        generationId,
        timingMs,
        rawResponse: responseData,
      };
    }

    const parts = candidates[0]?.content?.parts;
    const imagePart = parts?.find((p: any) => p.inlineData?.mimeType?.startsWith("image/"));
    
    if (!imagePart?.inlineData) {
      const error = new Error("No image data in Gemini response");
      
      if (isLangfuseEnabled()) {
        try {
          await logCompleteGeneration({
            id: generationId,
            traceId: params.pipelineId,
            name: generationName,
            model: GEMINI_IMAGE_MODEL,
            input: inputPayload,
            output: sanitizePayload({
              error: true,
              message: "No image data in response",
              parts_found: parts?.length || 0,
              timing_ms: timingMs,
            }),
            startTime,
            endTime,
            metadata: fullMetadata,
            level: "ERROR",
            statusMessage: "No image data",
          });
        } catch (logErr) {
          console.error(`[LangfuseImageWrapper] Failed to log error:`, logErr);
        }
      }
      
      await flushLangfuse();
      
      return {
        success: false,
        error,
        generationId,
        timingMs,
        rawResponse: responseData,
      };
    }

    const imageData = {
      base64: imagePart.inlineData.data,
      mimeType: imagePart.inlineData.mimeType,
    };

    // Log success to Langfuse
    if (isLangfuseEnabled()) {
      try {
        await logCompleteGeneration({
          id: generationId,
          traceId: params.pipelineId,
          name: generationName,
          model: GEMINI_IMAGE_MODEL,
          input: inputPayload,
          output: sanitizePayload({
            success: true,
            image_mime_type: imageData.mimeType,
            image_data_length: imageData.base64.length,
            timing_ms: timingMs,
            // Don't log the full base64 - just metadata
            finish_reason: candidates[0]?.finishReason || "unknown",
          }),
          startTime,
          endTime: new Date(),
          metadata: fullMetadata,
          level: "DEFAULT",
          statusMessage: "Image generated successfully",
        });
      } catch (logErr) {
        console.error(`[LangfuseImageWrapper] Failed to log success:`, logErr);
      }
    }

    console.log(`[LangfuseImageWrapper] Generation succeeded: ${generationName} (${timingMs}ms)`);

    await flushLangfuse();

    return {
      success: true,
      imageData,
      generationId,
      timingMs,
      rawResponse: responseData,
    };

  } catch (err) {
    const endTime = new Date();
    timingMs = endTime.getTime() - startTime.getTime();
    
    const error = err instanceof Error ? err : new Error(String(err));
    
    console.error(`[LangfuseImageWrapper] Exception: ${error.message}`);
    
    // Log error to Langfuse
    if (isLangfuseEnabled()) {
      try {
        await logCompleteGeneration({
          id: generationId,
          traceId: params.pipelineId,
          name: generationName,
          model: GEMINI_IMAGE_MODEL,
          input: inputPayload,
          output: sanitizePayload({
            error: true,
            message: error.message,
            name: error.name,
            stack: error.stack?.substring(0, 2000),
            timing_ms: timingMs,
          }),
          startTime,
          endTime,
          metadata: fullMetadata,
          level: "ERROR",
          statusMessage: `Exception: ${error.message}`,
        });
      } catch (logErr) {
        console.error(`[LangfuseImageWrapper] Failed to log exception:`, logErr);
      }
    }

    await flushLangfuse();

    return {
      success: false,
      error,
      generationId,
      timingMs,
    };
  }
}

// ============= HELPER: Build request body for Gemini =============

export interface BuildImageRequestParams {
  prompt: string;
  inputImages: Array<{ base64: string; mimeType: string }>;
  aspectRatio?: string;
  imageSize?: string;
}

export function buildGeminiImageRequest(params: BuildImageRequestParams): ImageGenerationRequest {
  const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [
    { text: params.prompt },
  ];

  for (const img of params.inputImages) {
    parts.push({
      inlineData: { mimeType: img.mimeType, data: img.base64 },
    });
  }

  return {
    contents: [{
      role: "user",
      parts,
    }],
    generationConfig: {
      responseModalities: ["Image"],
      imageConfig: {
        aspectRatio: params.aspectRatio || "1:1",
        imageSize: params.imageSize || "1K",
      },
    },
  };
}
