# Langfuse Integration for RE:TOUR

This document describes the comprehensive Langfuse observability integration for RE:TOUR's Supabase Edge Functions, including prompt management, QA persistence, and A/B testing.

## Overview

Langfuse provides end-to-end observability for the RE:TOUR pipeline:
- **Trace/Generation/Span logging** for all LLM calls
- **Prompt Management** for version-controlled prompt templates
- **Score Recording** for A/B testing metrics
- **QA Judge Persistence** in PostgreSQL for UI display

## Required Environment Variables

All secrets are stored in Supabase Edge Function secrets:

| Variable | Description | Example |
|----------|-------------|---------|
| `LANGFUSE_ENABLED` | Enable/disable Langfuse (set to "true" to enable) | `true` |
| `LANGFUSE_SECRET_KEY` | Langfuse secret key | `sk-lf-...` |
| `LANGFUSE_PUBLIC_KEY` | Langfuse public key | `pk-lf-...` |
| `LANGFUSE_BASE_URL` | Langfuse API base URL | `https://cloud.langfuse.com` |

## Naming Conventions

All traces, generations, and spans follow a strict naming convention defined in:
```
supabase/functions/_shared/langfuse-constants.ts
```

### Trace Names
- `pipeline_run` - Main trace for each pipeline execution (id = pipeline_id)

### Generation Names by Step

| Step | Generation Names |
|------|-----------------|
| **Step 0** | `space_analysis_step_0` |
| **Step 1** | `compose_prompt_step_1`, `image_gen_step_1`, `qa_judge_step_1`, `retry_correction_step_1` |
| **Step 2** | `compose_prompt_step_2`, `image_gen_step_2`, `qa_judge_step_2`, `retry_correction_step_2` |
| **Step 3.1** | `space_detection_step_3_1` |
| **Step 3.2** | `camera_planning_step_3_2`, `camera_screenshot_step_3_2`, `camera_prompt_compose_step_3_2`, `camera_prompts_approved_step_3_2`, `qa_camera_plan_step_3_2`, `retry_camera_plan_step_3_2` |
| **Step 4** | `compose_prompt_step_4`, `multi_pano_gen_step_4`, `qa_judge_step_4`, `retry_correction_step_4` |
| **Step 5** | `compose_prompt_step_5`, `pano_360_gen_step_5`, `qa_judge_step_5`, `retry_correction_step_5` |
| **Step 6** | `compose_prompt_step_6`, `merge_panos_step_6`/`tour_build_step_6`, `qa_judge_step_6`/`qa_tour_step_6`, `retry_correction_step_6` |

### Standard Metadata

Every generation includes these metadata fields:
- `project_id`, `pipeline_id`, `step_number`, `sub_step`
- `room_id`, `room_name`, `camera_id`
- `attempt_index`, `model_name`
- `prompt_name`, `prompt_version`
- `ab_bucket` (for A/B testing)

## Prompt Management

Prompts are fetched from Langfuse Prompt Management by name and label:

```typescript
import { fetchPrompt, fetchPromptWithAB } from "../_shared/langfuse-client.ts";

// Basic fetch
const prompt = await fetchPrompt("prompt_composer_template", "production");

// A/B bucket-aware fetch
const { prompt, bucket, label } = await fetchPromptWithAB(
  "qa_evaluator_template",
  pipelineId,
  "qa_experiment"
);
```

### Prompt Names

| Prompt Name | Usage |
|-------------|-------|
| `space_analysis_template` | Step 0 space analysis |
| `prompt_composer_template` | Steps 1-6 prompt composition |
| `retry_correction_template` | Auto-retry prompt generation |
| `qa_evaluator_template` | QA judge evaluation |
| `camera_planning_template` | Step 3.2 camera planning |
| `camera_prompt_compose_template` | Camera A/B prompt generation |

## QA Judge Results

QA results are persisted to the `qa_judge_results` table for UI display.

### Schema

```sql
CREATE TABLE qa_judge_results (
  id UUID PRIMARY KEY,
  pipeline_id UUID NOT NULL,
  project_id UUID NOT NULL,
  owner_id UUID NOT NULL,
  step_number INTEGER NOT NULL,
  sub_step TEXT,  -- '3.1' or '3.2' for Step 3
  output_id UUID,
  attempt_index INTEGER NOT NULL,
  pass BOOLEAN NOT NULL,
  score NUMERIC(5,2),
  confidence NUMERIC(5,4),
  reasons TEXT[] NOT NULL DEFAULT '{}',
  violated_rules TEXT[] NOT NULL DEFAULT '{}',
  full_result JSONB NOT NULL DEFAULT '{}',
  judge_model TEXT NOT NULL,
  prompt_name TEXT,
  prompt_version TEXT,
  ab_bucket TEXT,
  processing_time_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL
);
```

### UI Components

```tsx
import { useQAJudgeResults } from "@/hooks/useQAJudgeResults";
import { QAJudgeResultsList } from "@/components/shared";

function MyComponent({ pipelineId, stepNumber }) {
  const { data: results } = useQAJudgeResults(pipelineId, stepNumber);
  
  return <QAJudgeResultsList results={results || []} />;
}
```

## A/B Testing

A/B bucket assignment is deterministic based on `pipeline_id`:

```typescript
import { getABBucket, getPromptLabel } from "../_shared/langfuse-constants.ts";

const bucket = getABBucket(pipelineId, "my_experiment"); // 'A' or 'B'
const label = getPromptLabel(bucket); // 'production' or 'variant_a'
```

### Recording Scores for A/B Analysis

```typescript
import { recordQAScore, recordRetryCount } from "../_shared/langfuse-client.ts";

// Record QA pass/fail
await recordQAScore(traceId, pass, stepNumber, attemptIndex, generationId);

// Record retry count
await recordRetryCount(traceId, stepNumber, totalRetries);
```

Scores appear in Langfuse dashboard for comparison between buckets.

## Usage Examples

### Creating a Pipeline Trace

```typescript
import { createPipelineRunTrace, logStepGeneration } from "../_shared/langfuse-client.ts";
import { STEP_1_GENERATIONS } from "../_shared/langfuse-constants.ts";

// Create main trace (use pipeline_id as trace_id)
const { traceId } = await createPipelineRunTrace(
  pipelineId,
  projectId,
  ownerId
);

// Log a generation
const startTime = new Date();
const result = await callModel(...);
const endTime = new Date();

await logStepGeneration(
  traceId,
  STEP_1_GENERATIONS.IMAGE_GEN,
  "gemini-3-pro-image-preview",
  prompt,
  result,
  startTime,
  endTime,
  {
    project_id: projectId,
    pipeline_id: pipelineId,
    step_number: 1,
    attempt_index: 1,
    model_name: "gemini-3-pro-image-preview",
    ab_bucket: bucket,
  },
  { name: "prompt_composer_template", version: "3" }
);
```

### Persisting QA Results

```typescript
// After QA judge evaluation, persist to DB
await supabase.from("qa_judge_results").insert({
  pipeline_id: pipelineId,
  project_id: projectId,
  owner_id: ownerId,
  step_number: 1,
  output_id: outputUploadId,
  attempt_index: 1,
  pass: false,
  score: 45.5,
  confidence: 0.92,
  reasons: ["Wall structure does not match floor plan", "Missing window in bedroom"],
  violated_rules: ["structural_fidelity", "opening_accuracy"],
  full_result: qaResultJson,
  judge_model: "gemini-3-pro-image-preview",
  prompt_name: "qa_evaluator_template",
  prompt_version: "2",
  ab_bucket: "A",
  processing_time_ms: 1250,
});
```

## Testing

### Test Endpoint

```bash
curl -X POST https://pyswjfcqirszxelrsotw.supabase.co/functions/v1/langfuse-test \
  -H "Content-Type: application/json" \
  -d '{"test_type": "full"}'
```

### Verifying in Langfuse Dashboard

1. Go to [https://cloud.langfuse.com](https://cloud.langfuse.com)
2. Navigate to **Traces** → Look for `pipeline_run` traces
3. View generations nested under each trace
4. Check **Scores** tab for A/B metrics
5. Navigate to **Prompts** to manage prompt versions

## Files

| File | Description |
|------|-------------|
| `supabase/functions/_shared/langfuse-client.ts` | Main Langfuse client |
| `supabase/functions/_shared/langfuse-constants.ts` | Naming conventions |
| `supabase/functions/langfuse-test/index.ts` | Test endpoint |
| `src/hooks/useQAJudgeResults.ts` | React hook for QA results |
| `src/components/shared/QAJudgeResultDisplay.tsx` | UI components |

## Security Notes

- ✅ All secrets in Supabase Edge Function environment
- ✅ Secrets never logged
- ✅ Frontend has zero access to Langfuse credentials
- ✅ QA results protected by RLS (owner_id)
