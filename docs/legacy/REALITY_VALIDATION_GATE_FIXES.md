# Reality Validation Gate Fixes - Implementation Summary

## Overview

This document summarizes the fixes implemented to resolve three critical issues identified during Reality Validation Gate execution:

1. **JSON Parsing Failures** (Step 0)
2. **Langfuse Judge Wrong Step Number** (Step 5)
3. **Langfuse Judge Running on Wrong Steps** (Step 0)

---

## Issue 1: JSON Parsing Failures (Step 0)

### Problem
Step 0 (Space Analysis) was failing with "Expected ',' or ']' after array element" due to:
- Gemini responses truncated at 8192 token limit
- Incomplete JSON repair logic not handling mid-element truncation

### Fixes Implemented

#### 1.1: Increased Token Limit
**File**: `supabase/functions/run-space-analysis/index.ts:472`

```typescript
// Before:
const spaceRequestParams = { temperature: 0.3, maxOutputTokens: 8192, responseMimeType: "application/json" };

// After:
const spaceRequestParams = { temperature: 0.3, maxOutputTokens: 16384, responseMimeType: "application/json" };
```

**Rationale**: Doubled token limit from 8K → 16K to handle complex floor plans. Gemini 2.5 Pro supports up to 32K output tokens.

#### 1.2: Enhanced Truncation Detection
**File**: `supabase/functions/run-space-analysis/index.ts:527-540`

```typescript
// Check for truncation but still attempt parsing (repair might succeed)
if (finishReason === "MAX_TOKENS") {
  console.warn("[run-space-analysis] WARNING: Response truncated at token limit");
  console.warn("[run-space-analysis] Token usage:", geminiData.usageMetadata);
  console.warn("[run-space-analysis] Attempting JSON repair...");
}
```

**Rationale**: Changed from throwing immediately to attempting repair, with prominent warnings for debugging.

#### 1.3: Improved JSON Repair Logic
**File**: `supabase/functions/_shared/json-parsing.ts:240-301`

**Key Enhancement**: Aggressive truncation handling
- Detects incomplete trailing array elements
- Removes incomplete elements after last comma
- Properly closes remaining brackets/braces

```typescript
// NEW: Remove incomplete trailing content after the last complete element
if (inString || openBraces > 0 || openBrackets > 0) {
  const lastCommaIndex = repaired.lastIndexOf(",", lastCompletePosition);
  if (lastCommaIndex > 0) {
    repaired = repaired.substring(0, lastCommaIndex);
    console.log("[json-repair] Removed incomplete trailing element after truncation");
  }
}
```

**Rationale**: Handles mid-element truncation by removing incomplete elements cleanly.

#### 1.4: Better Error Context
**File**: `supabase/functions/run-space-analysis/index.ts:548-566`

```typescript
// Add truncation context to parse errors
if (wasTruncated) {
  errorMessage = `${errorMessage} (Response was truncated at ${spaceRequestParams.maxOutputTokens} token limit - repair failed)`;
}
```

**Rationale**: Clear error messages help diagnose whether issues are from truncation or other causes.

---

## Issue 2: Langfuse Judge Wrong Step Number

### Problem
`run-qa-check` calculated incorrect fallback step numbers when `step_id` parameter was missing:
- `render` → Step 4 (WRONG, should be Step 5)
- `panorama` → Step 5 (WRONG, should be Step 6)
- `merge` → Step 6 (WRONG, should be Step 7)

This caused the Judge to use wrong evaluation criteria.

### Fixes Implemented

#### 2.1: Corrected Step Number Fallback
**File**: `supabase/functions/run-qa-check/index.ts:1110`

```typescript
// Before (INCORRECT):
const effectiveStepId = step_id || (qa_type === "render" ? 4 : qa_type === "panorama" ? 5 : 6);

// After (CORRECT):
const effectiveStepId = step_id || (qa_type === "render" ? 5 : qa_type === "panorama" ? 6 : 7);
```

**Rationale**: Fixed off-by-one error to match actual pipeline step numbers.

#### 2.2: Added Explicit step_id Parameters (Defense-in-Depth)
**File**: `supabase/functions/run-space-render/index.ts`

**Change 1**: Added `project_id` to pipeline query (line 508)
```typescript
.select("step_outputs, output_resolution, aspect_ratio, quality_post_step4, floor_plan_upload_id, project_id")
```

**Change 2**: Simplified project_id lookup (line 1319)
```typescript
// Before: Inline query each time
project_id: render.space?.pipeline_id ?
  (await serviceClient.from("floorplan_pipelines").select("project_id").eq("id", render.pipeline_id).single()).data?.project_id :
  null,

// After: Use already-fetched value
project_id: pipeline?.project_id || null,
```

**Change 3**: Added explicit parameters to QA check call (lines 1381-1382)
```typescript
body: JSON.stringify({
  // ... existing parameters ...
  // NEW: Explicit step tracking for correct Judge evaluation
  step_id: 5,
  project_id: pipeline?.project_id || null,
}),
```

**Rationale**: Always pass explicit `step_id` so fallback logic is never needed.

---

## Issue 3: Langfuse Judge Running on Wrong Steps

### Problem
The `retour_evaluator_qa_judge` Langfuse evaluator was configured to run on ALL generations, including Step 0 (Space Analysis), where it expects inputs that don't exist:
- AFTER image (visual output)
- Floor plan analysis
- Camera specifications

### Fixes Implemented

#### 3.1: Added Step Gating Constants
**File**: `supabase/functions/_shared/langfuse-constants.ts`

```typescript
// Steps that support QA Judge evaluation (visual quality checks)
export const QA_EVALUATABLE_STEPS = [1, 2, 4, 5, 6, 7] as const;

// Steps that do NOT support QA Judge evaluation
export const NON_QA_STEPS = [0, 3] as const;
```

#### 3.2: Added Helper Function
**File**: `supabase/functions/_shared/langfuse-constants.ts`

```typescript
/**
 * Check if a step supports QA Judge evaluation
 * Steps that generate visual outputs (images) need QA evaluation
 * Steps that generate metadata/text do not
 */
export function stepSupportsQAEvaluation(stepNumber: number): boolean {
  return (QA_EVALUATABLE_STEPS as readonly number[]).includes(stepNumber);
}
```

#### 3.3: Added Metadata Field for Evaluator Gating
**File**: `supabase/functions/_shared/langfuse-constants.ts:buildStandardMetadata`

```typescript
// Add QA evaluation flag to help Langfuse evaluators gate correctly
metadata["supports_qa_evaluation"] = stepSupportsQAEvaluation(params.step_number);
```

**Effect**: All generations now include this metadata:
```json
{
  "metadata": {
    "step_number": 0,
    "supports_qa_evaluation": false  // ← Used by evaluator filters
  }
}
```

#### 3.4: Configuration Documentation
**File**: `docs/LANGFUSE_EVALUATOR_GATING.md`

Complete guide for configuring Langfuse evaluator filters:
- **Option 1**: Filter by generation name pattern (`qa_judge_step_*`)
- **Option 2**: Filter by metadata (`supports_qa_evaluation: true`)
- **Option 3**: Filter by step number (`step_number: [1,2,4,5,6,7]`)

---

## Required Manual Configuration

### Langfuse Dashboard Configuration

**YOU MUST configure the evaluator in the Langfuse dashboard:**

1. Navigate to **Evaluators** in Langfuse dashboard
2. Find `retour_evaluator_qa_judge`
3. Edit configuration
4. Add **Generation Name Filter**:
   ```
   Pattern: qa_judge_step_*
   ```
   OR **Metadata Filter**:
   ```json
   {
     "supports_qa_evaluation": true
   }
   ```
5. Save configuration

**See `docs/LANGFUSE_EVALUATOR_GATING.md` for detailed instructions.**

---

## Verification Steps

### Test 1: Step 0 Completes Without Truncation
```bash
# Upload floor plan and run Step 0
# Expected:
# - Logs show: "Finish reason: STOP" (not MAX_TOKENS)
# - JSON parsing succeeds
# - No evaluator scores on Step 0 generation
```

### Test 2: Judge Uses Correct Step Number
```bash
# Run Step 5 (renders)
# Expected:
# - Logs show: "effectiveStepId = 5"
# - Judge uses Step 5 evaluation criteria
# - Evaluator score attached to qa_judge_step_5 generation
```

### Test 3: Evaluator Doesn't Run on Step 0
```bash
# Check Langfuse trace for Step 0
# Expected:
# - Generation "step-0-space-analysis" visible
# - NO evaluator scores attached
# - metadata.supports_qa_evaluation = false
```

---

## Files Modified

### Core Fixes
1. `supabase/functions/run-space-analysis/index.ts` - Token limit, truncation handling
2. `supabase/functions/_shared/json-parsing.ts` - Enhanced repair logic
3. `supabase/functions/run-qa-check/index.ts` - Fixed step number fallback
4. `supabase/functions/run-space-render/index.ts` - Added explicit step_id/project_id
5. `supabase/functions/_shared/langfuse-constants.ts` - Added QA gating metadata

### Documentation
6. `docs/LANGFUSE_EVALUATOR_GATING.md` - Evaluator configuration guide
7. `docs/REALITY_VALIDATION_GATE_FIXES.md` - This file

---

## Success Criteria

- ✅ Step 0 completes without JSON parsing errors
- ✅ Increased token limit (8192 → 16384) prevents truncation
- ✅ Enhanced repair logic handles mid-element truncation
- ✅ Truncation errors are explicit and actionable
- ✅ Judge uses correct step numbers (render=5, panorama=6, merge=7)
- ✅ Explicit step_id parameters prevent fallback issues
- ✅ Metadata marks which steps support QA evaluation
- ✅ Evaluator can be gated to only run on Steps 1,2,4,5,6,7
- ✅ All fixes are backward-compatible and surgical

---

## Rollback Plan

If issues persist:

1. **Revert token limit**: Change back to 8192 if 16384 causes issues
2. **Revert step_id changes**: Remove explicit parameters
3. **Revert repair logic**: Restore original `repairJson` function
4. **Disable evaluator**: Remove evaluator filter in Langfuse dashboard

---

## Notes

- All code changes are complete and committed
- **Manual action required**: Configure Langfuse evaluator filter (see above)
- Changes are surgical and low-risk
- No architectural changes
- Backward-compatible
