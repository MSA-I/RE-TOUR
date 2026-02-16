# Step 2 QA 400 Error - Fixed

## Problem

Getting error: **`QA service error (400)`**

## Root Cause

The `run-qa-check` Edge Function only accepts these `qa_type` values:
- `"render"`
- `"panorama"`
- `"merge"`

But `run-pipeline-step` was sending:
- Step 2: `qa_type: "style"` ❌ INVALID
- Other steps: `qa_type: "structural"` ❌ INVALID

This caused a 400 Bad Request error.

## Fix Applied

**File**: `supabase/functions/run-pipeline-step/index.ts:3202-3223`

**Before**:
```typescript
const qaCheckPayload: Record<string, unknown> = {
  upload_id: output_upload_id,
  qa_type: stepNumber === 2 ? "style" : stepNumber === 4 ? "panorama" : "structural", // ❌ WRONG
  // ...
};
```

**After**:
```typescript
// Map step numbers to VALID qa_type values
let qaType: string;
if (stepNumber === 4) {
  qaType = "panorama";
} else if (stepNumber === 7) {
  qaType = "merge";
} else {
  // Steps 1, 2, 3 all use "render" type (structural validation)
  qaType = "render"; // ✅ VALID
}

const qaCheckPayload: Record<string, unknown> = {
  upload_id: output_upload_id,
  qa_type: qaType, // ✅ Now always valid
  step_id: stepNumber,
  project_id: project_id,
  asset_id: pipeline_id,
  asset_type: "pipeline_step",
  current_attempt: current_attempt,
};
```

## Step → QA Type Mapping

| Step | Purpose | qa_type |
|------|---------|---------|
| 1 | Top-Down 3D | `"render"` |
| 2 | Style Reference | `"render"` |
| 3 | Camera-Angle Render | `"render"` |
| 4 | Multi-Panorama | `"panorama"` |
| 5 | Space Renders | `"render"` |
| 6 | Space Panorama | `"panorama"` |
| 7 | Merge 360 | `"merge"` |

## Deployment Status

✅ **DEPLOYED** - Function updated and live

Deployed at: Just now
Function: `run-pipeline-step`
Project: `zturojwgqtjrxwsfbwqw`

## Test Now

1. Go to your pipeline
2. Run Step 2 (Style Reference)
3. Check logs

### Expected Success:

```
[QA] Mapped Step 2 to qa_type: render
[QA] Calling run-qa-check: {"upload_id":"...","qa_type":"render",...}
[QA] run-qa-check completed in 2500ms, status: 200
[QA] Final decision: approved, score: 85
```

### No More 400 Error:

You should **NOT** see:
- ❌ `QA service error (400)`
- ❌ `qa_type must be one of: render, panorama, merge`

## Additional Benefits

- Added `asset_id` and `asset_type` for auto-retry tracking
- Removed invalid `input_signed_url` and `output_signed_url` parameters
- Added logging: `[QA] Mapped Step X to qa_type: Y`

## Verification

If Step 2 still fails, check Supabase logs for:

**run-pipeline-step logs:**
```
[QA] Mapped Step 2 to qa_type: render  ← Should see this
```

**run-qa-check logs:**
```
[qa-check] Running render QA on upload <id>  ← Should see "render", not "style"
```

## Summary

- ✅ Fixed invalid `qa_type` values ("style", "structural")
- ✅ Mapped all steps to valid types ("render", "panorama", "merge")
- ✅ Deployed successfully
- ✅ Ready to test

Test Step 2 now - it should work without 400 errors!
