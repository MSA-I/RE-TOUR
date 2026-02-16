# Langfuse Evaluator Gating Configuration

## Problem

The `retour_evaluator_qa_judge` Langfuse evaluator expects inputs that only exist for visual QA steps (Steps 1, 2, 4, 5, 6, 7):
- AFTER image (generated output)
- BEFORE image (optional reference)
- Floor plan analysis
- Camera specifications
- Structural comparison data

When this evaluator runs on Step 0 (Space Analysis) or Step 3 (Camera Planning), it fails because these steps don't generate visual outputs.

## Solution: Gate Evaluator by Step Number

The evaluator must be configured to **only run on steps that generate visual outputs**.

### Option 1: Filter by Generation Name (Recommended)

Configure the evaluator in Langfuse to only run on generations with names matching QA Judge patterns:

**Evaluator Name Pattern Filter:**
```
qa_judge_step_*
```

This will match:
- `qa_judge_step_1`
- `qa_judge_step_2`
- `qa_judge_step_4`
- `qa_judge_step_5`
- `qa_judge_step_6`
- `qa_judge_step_7`

And will **NOT** match:
- `space_analysis_step_0_2` (Step 0: Space Analysis)
- `camera_planning_step_3_2` (Step 3: Camera Planning)

### Option 2: Filter by Metadata (Alternative)

All generations now include a `supports_qa_evaluation` metadata field:

**Metadata Filter:**
```json
{
  "supports_qa_evaluation": true
}
```

Configure the evaluator to only run when this field is `true`.

### Option 3: Filter by Step Number (Alternative)

**Metadata Filter:**
```json
{
  "step_number": { "$in": [1, 2, 4, 5, 6, 7] }
}
```

This explicitly allows only QA-evaluatable steps.

## Steps That Support QA Evaluation

| Step | Name | Generates Visual Output | Needs QA Judge |
|------|------|------------------------|----------------|
| 0 | Space Analysis | ❌ Text/JSON only | ❌ NO |
| 1 | Top-Down 3D | ✅ Yes | ✅ YES |
| 2 | Style Transfer | ✅ Yes | ✅ YES |
| 3 | Camera Planning | ❌ Metadata only | ❌ NO |
| 4 | Multi-Image Panorama | ✅ Yes | ✅ YES |
| 5 | Space Renders | ✅ Yes | ✅ YES |
| 6 | Space Panoramas | ✅ Yes | ✅ YES |
| 7 | Merge/Final Tour | ✅ Yes | ✅ YES |

## How to Configure in Langfuse Dashboard

1. Navigate to **Evaluators** in Langfuse dashboard
2. Find the `retour_evaluator_qa_judge` evaluator
3. Edit the evaluator configuration
4. Add a **Generation Name Filter**:
   - Pattern: `qa_judge_step_*`
   - OR Pattern: `*qa_judge*` (broader match)
5. Save the configuration

### Alternative: API Configuration

If using the Langfuse API to configure evaluators:

```typescript
// Evaluator configuration
{
  "name": "retour_evaluator_qa_judge",
  "filters": {
    "generationName": {
      "$regex": "qa_judge_step_[1-7]"
    },
    // OR use metadata filter
    "metadata.supports_qa_evaluation": true
  }
}
```

## Verification

After configuring the evaluator, verify it's gated correctly:

1. Run Step 0 (Space Analysis) and check Langfuse trace
   - ✅ Generation should appear in trace
   - ✅ NO evaluator scores should be attached

2. Run Step 5 (Space Renders) and check Langfuse trace
   - ✅ Generation should appear with `qa_judge_step_5` name
   - ✅ Evaluator score SHOULD be attached

## Code Changes

The following code changes support evaluator gating:

### 1. Added Constants (`langfuse-constants.ts`)
```typescript
// Steps that support QA Judge evaluation
export const QA_EVALUATABLE_STEPS = [1, 2, 4, 5, 6, 7] as const;

// Steps that do NOT support QA Judge evaluation
export const NON_QA_STEPS = [0, 3] as const;
```

### 2. Added Helper Function (`langfuse-constants.ts`)
```typescript
export function stepSupportsQAEvaluation(stepNumber: number): boolean {
  return (QA_EVALUATABLE_STEPS as readonly number[]).includes(stepNumber);
}
```

### 3. Added Metadata Field (`buildStandardMetadata`)
All generations now include:
```json
{
  "metadata": {
    "step_number": 0,
    "supports_qa_evaluation": false  // ← NEW FIELD
  }
}
```

## Testing

Test that evaluators don't run on non-QA steps:

```bash
# Run Step 0
curl -X POST $EDGE_FUNCTION_URL/run-space-analysis \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"pipeline_id": "test-123"}'

# Check Langfuse trace for test-123
# Verify: No evaluator scores on step-0-space-analysis generation
```

Test that evaluators DO run on QA steps:

```bash
# Run Step 5 (after completing Steps 0-4)
curl -X POST $EDGE_FUNCTION_URL/run-space-render \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"render_id": "render-456"}'

# Check Langfuse trace
# Verify: Evaluator score attached to qa_judge_step_5 generation
```

## References

- **Langfuse Evaluators Docs**: https://langfuse.com/docs/scores/model-based-evals
- **Generation Name Constants**: `supabase/functions/_shared/langfuse-constants.ts`
- **Metadata Builder**: `buildStandardMetadata()` in `langfuse-constants.ts`
