# Langfuse Generation Wrapper - Usage Guide

## Overview

The `langfuse-generation-wrapper.ts` module provides a unified wrapper for ALL model calls that guarantees:

1. **Full input logging BEFORE the model call** - Never miss what was sent
2. **Full output logging AFTER the model call** - Always capture what was returned
3. **Proper error recording with status** - Failures are logged with full context
4. **Consistent structured payloads** - No null/undefined values in Langfuse

## Problem Solved

Previously, generations in Langfuse showed:
- `Input: null`
- `Output: undefined`

This happened because logging was done AFTER the model call, and if parsing failed, logging was skipped entirely.

## Solution

The wrapper:
1. Logs generation with full input **before** calling the model
2. Executes your model call callback
3. Updates the generation with full output **after** success OR error

## Quick Start

```typescript
import {
  wrapModelGeneration,
  STEP_0_GENERATIONS,
  PROMPT_NAMES,
} from "../_shared/langfuse-client.ts";

// Wrap your model call
const result = await wrapModelGeneration<MyResponseType>(
  {
    traceId: pipeline_id,
    generationName: STEP_0_GENERATIONS.SPACE_ANALYSIS_STRUCTURAL,
    model: "gemini-2.5-pro",
    metadata: {
      project_id: project_id,
      pipeline_id: pipeline_id,
      step_number: 0,
      sub_step: "0.2",
      model_name: "gemini-2.5-pro",
      prompt_name: PROMPT_NAMES.SPACE_ANALYSIS,
      prompt_version: promptVersion,
    },
    promptInfo: {
      name: PROMPT_NAMES.SPACE_ANALYSIS,
      version: promptVersion,
      label: "production",
      source: "langfuse_prompt_management", // or "code"
    },
    finalPromptText: promptTemplate,
    variables: { room_count: 5 },
    requestParams: { temperature: 0.3, maxOutputTokens: 8192 },
    imageCount: 1, // optional - for vision models
  },
  async () => {
    // Your actual model call here
    const response = await fetch(geminiUrl, { ... });
    if (!response.ok) throw new Error(`API error: ${response.status}`);
    return await response.json();
  }
);

if (result.success) {
  // Use result.data
} else {
  throw result.error;
}
```

## Input Payload Structure

Every generation input will contain:

```json
{
  "pipeline_id": "uuid",
  "project_id": "uuid",
  "step_number": 0,
  "sub_step": "0.2",
  "attempt_index": 0,
  "prompt_source": "langfuse_prompt_management",
  "prompt_name": "retour_space_analysis",
  "prompt_label": "production",
  "prompt_version": "3",
  "final_prompt_text": "You are an expert...",
  "variables": { "room_count": 5 },
  "model_name": "gemini-2.5-pro",
  "request_params": { "temperature": 0.3, "maxOutputTokens": 8192 },
  "image_count": 1
}
```

## Output Payload Structure

On success:
```json
{
  "model_name": "gemini-2.5-pro",
  "response": { "rooms": [...], "zones": [...] },
  "timing_ms": 2340
}
```

On error:
```json
{
  "error": true,
  "message": "API error: 429",
  "name": "Error",
  "stack": "Error: API error: 429\n  at ...",
  "timing_ms": 150
}
```

## Generation Naming Convention

Use the constants from `langfuse-constants.ts`:

| Step | Generation Name | Constant |
|------|----------------|----------|
| 0.1 | `design_reference_analysis_step_0_1` | `STEP_0_GENERATIONS.DESIGN_REFERENCE_ANALYSIS` |
| 0.2 | `space_analysis_step_0_2` | `STEP_0_GENERATIONS.SPACE_ANALYSIS_STRUCTURAL` |
| 1 | `image_gen_step_1` | `STEP_1_GENERATIONS.IMAGE_GEN` |
| 1 | `qa_judge_step_1` | `STEP_1_GENERATIONS.QA_JUDGE` |
| 2 | `image_gen_step_2` | `STEP_2_GENERATIONS.IMAGE_GEN` |
| 3.1 | `space_detection_step_3_1` | `STEP_3_1_GENERATIONS.SPACE_DETECTION` |
| 3.2 | `camera_planning_step_3_2` | `STEP_3_2_GENERATIONS.CAMERA_PLANNING` |
| 4-6 | See `langfuse-constants.ts` | `STEP_N_GENERATIONS.*` |

## Edge Functions Updated

These edge functions now use the wrapper:

### High Priority (Steps 0-3)
- [x] `run-space-analysis/index.ts` - ✅ Step 0.1 & 0.2
- [x] `run-detect-spaces/index.ts` - ✅ Step 3.1
- [x] `run-camera-scan/index.ts` - ✅ Step 3.2 (label detection)
- [x] `confirm-camera-plan/index.ts` - ✅ Step 3.2 (prompts approved event)

### QA Functions
- [x] `run-qa-check/index.ts` - ✅ QA Judge for Steps 1-6

### Functions Using Existing Pattern
- `run-pipeline-step/index.ts` - Uses attempt-level logging to DB (can be enhanced)
- `compose-pipeline-prompt/index.ts` - Prompt composition (can be enhanced)
- `optimize-pipeline-prompt/index.ts` - Prompt optimization (can be enhanced)
- `get-opposite-view-template/index.ts` - Template generation (can be enhanced)

## Logging Non-Model Events

For events that don't involve model calls (like approvals, screenshots):

```typescript
import { logPipelineEvent } from "../_shared/langfuse-client.ts";

await logPipelineEvent({
  traceId: pipeline_id,
  eventName: "camera_prompts_approved_step_3_2",
  metadata: {
    project_id,
    pipeline_id,
    step_number: 3,
    sub_step: "3.2",
  },
  input: { camera_count: 5, approval_source: "user" },
  output: { approved_at: new Date().toISOString() },
});
```

## Retry Support

For automatic retry with per-attempt logging:

```typescript
import { wrapModelGenerationWithRetry } from "../_shared/langfuse-client.ts";

const result = await wrapModelGenerationWithRetry(
  {
    ...params,
    maxRetries: 2,
    retryDelayMs: 1000,
  },
  modelCallFn
);
```

Each retry creates a separate generation: `image_gen_step_1`, `image_gen_step_1_retry_1`, `image_gen_step_1_retry_2`.

## Verification

After running a pipeline step, check Langfuse:
1. Navigate to your trace (trace ID = pipeline_id)
2. Click on the generation
3. Verify **Input** shows the full prompt payload
4. Verify **Output** shows the model response or error

No generation should show `Input: null` or `Output: undefined`.
