# Troubleshooting Step 1 "Edge Function returned a non-2xx status code" Error

## Error Message

```
[TOP_DOWN_3D_START] Error: FunctionsHttpError: Edge Function returned a non-2xx status code
```

## What This Means

This is a **generic HTTP error** from Supabase. The Edge Function returned an HTTP error status (4xx or 5xx) instead of 200 OK. The actual error details are on the backend.

## Fixed: Memory Limit Exceeded

**As of the latest update, the most common cause of this error (memory exhaustion) has been fixed.**

If you were seeing `shutdown - Memory limit exceeded - [Memory before-load-input]` in Supabase Edge Function logs, this is now resolved through automatic server-side image downscaling for Steps 1-4.

See: `docs/SERVER_SIDE_IMAGE_DOWNSCALING.md`

## Root Causes

1. **Phase transition failure**: `continue-pipeline-step` returned an error
2. **Phase validation failure**: Pipeline is in wrong phase for Step 1
3. **Missing dependencies**: Step 0 output not properly saved
4. **Authentication issue**: Token expired or invalid
5. **Resource not found**: Pipeline or uploads missing

## Diagnostic Steps

### Step 1: Check Enhanced Frontend Logs

The frontend now includes detailed logging. Open browser console (F12) and look for:

```javascript
[TOP_DOWN_3D_START] Current phase: space_analysis_complete
[TOP_DOWN_3D_START] Phase is space_analysis_complete, calling continue-pipeline-step first
[TOP_DOWN_3D_START] continue-pipeline-step response: {
  hasError: true,  // ← Key indicator
  errorMessage: "...",
  dataError: "...",
}
```

**Key fields to check:**
- `hasError`: If `true`, phase transition failed
- `errorMessage`: Specific error from Edge Function
- `dataError`: Backend-returned error message

### Step 2: Check Supabase Edge Function Logs

Go to **Supabase Dashboard** → **Edge Functions** → Select function → **Logs**

#### Check `continue-pipeline-step` logs:

**✅ Success:**
```
[continue-pipeline-step] Transitioning: space_analysis_complete (step 0) → top_down_3d_pending (step 1)
[continue-pipeline-step] Success: Pipeline <id> now at phase=top_down_3d_pending
```

**❌ Common Errors:**

**Error 1: Phase Mismatch**
```
[continue-pipeline-step] Phase mismatch: expected=space_analysis_complete, got=top_down_3d_pending
```
**Cause**: Pipeline already transitioned (page is stale)
**Fix**: Refresh the page

**Error 2: Unauthorized**
```
[continue-pipeline-step] Invalid token
```
**Cause**: Token expired
**Fix**: Log out and log back in

**Error 3: Not Found**
```
[continue-pipeline-step] Pipeline not found or not owned by user
```
**Cause**: Pipeline deleted or belongs to different user
**Fix**: Navigate back to projects list

#### Check `run-pipeline-step` logs:

**✅ Success:**
```
[RUN_PIPELINE_STEP] Pipeline <id> current phase: top_down_3d_pending, step: 1
[TOP_DOWN_3D_START] Pipeline <id>: Starting step 1
```

**❌ Common Errors:**

**Error 1: Phase Validation Failure**
```
[RUN_PIPELINE_STEP] Phase mismatch: expected one of [top_down_3d_pending, ...], got "space_analysis_complete"
```
**Cause**: Phase transition didn't happen or was incomplete
**Fix**: This should not happen with the frontend logic, indicates a race condition

**Error 2: Missing Floor Plan**
```
Failed to load floor plan image
```
**Cause**: Floor plan upload was deleted or corrupted
**Fix**: Re-upload floor plan and run Step 0 again

**Error 3: Missing Space Analysis**
```
Space analysis output not found
```
**Cause**: Step 0 didn't complete successfully
**Fix**: Re-run Step 0

### Step 3: Check Pipeline State

Open browser console and run:

```javascript
// Check current pipeline state
const { data: pipeline } = await supabase
  .from("floorplan_pipelines")
  .select("id, whole_apartment_phase, current_step, step_outputs")
  .eq("id", "<your-pipeline-id>")
  .single();

console.log("Pipeline state:", {
  phase: pipeline.whole_apartment_phase,
  step: pipeline.current_step,
  hasStep0Output: !!pipeline.step_outputs?.space_analysis,
  hasFloorPlan: !!pipeline.floor_plan_upload_id,
});
```

**Expected state after Step 0:**
```json
{
  "phase": "space_analysis_complete",
  "step": 0,
  "hasStep0Output": true,
  "hasFloorPlan": true
}
```

**If not matching:**
- `phase` is wrong → Manual fix required (see below)
- `hasStep0Output: false` → Re-run Step 0
- `hasFloorPlan: false` → Re-upload floor plan

### Step 4: Check for Race Conditions

If the error happens intermittently:

1. Wait 2-3 seconds after Step 0 completes
2. Then click "Run Step 1"
3. If it works, it was a race condition (frontend wasn't updated)

**Workaround**: Refresh the page after Step 0 completes before running Step 1.

## Solutions

### Solution 1: Refresh Page (Most Common)

1. Refresh the browser page (F5)
2. Check that pipeline shows "Step 0 Complete"
3. Click "Run Step 1" again

**Why this works**: Frontend state might be stale, refresh loads latest pipeline state.

### Solution 2: Check Token Expiry

1. Open browser console
2. Check for "Unauthorized" or "Invalid token" errors
3. If present:
   - Log out
   - Log back in
   - Try again

### Solution 3: Re-run Step 0

If Step 0 output is missing:

1. Navigate back to Step 0
2. Click "Run Space Analysis" again
3. Wait for completion
4. Try Step 1 again

### Solution 4: Manual Phase Reset (Advanced)

If pipeline is stuck in wrong phase:

**⚠️ WARNING**: Only use if you understand SQL

```sql
-- Check current phase
SELECT id, whole_apartment_phase, current_step
FROM floorplan_pipelines
WHERE id = '<your-pipeline-id>';

-- If phase is wrong, reset to space_analysis_complete
UPDATE floorplan_pipelines
SET whole_apartment_phase = 'space_analysis_complete'
WHERE id = '<your-pipeline-id>';
```

Then refresh the page and retry Step 1.

### Solution 5: Re-create Pipeline

If all else fails:

1. Note which floor plan you used
2. Create a new pipeline
3. Upload the same floor plan
4. Run Step 0 → Step 1

## Enhanced Logging Output

With the enhanced logging, you should see:

### Success Case

```javascript
[TOP_DOWN_3D_START] Current phase: space_analysis_complete
[TOP_DOWN_3D_START] Phase is space_analysis_complete, calling continue-pipeline-step first
[TOP_DOWN_3D_START] continue-pipeline-step response: {
  hasError: false,
  hasData: true,
  dataSuccess: true
}
[TOP_DOWN_3D_START] ✓ Phase advanced to top_down_3d_pending
[TOP_DOWN_3D_START] Invoking run-pipeline-step for Step 1
[TOP_DOWN_3D_START] run-pipeline-step response: {
  hasError: false,
  hasData: true,
  dataError: undefined
}
[TOP_DOWN_3D_START] ✓ Step 1 completed successfully
```

### Failure Case (Phase Transition)

```javascript
[TOP_DOWN_3D_START] Current phase: space_analysis_complete
[TOP_DOWN_3D_START] Phase is space_analysis_complete, calling continue-pipeline-step first
[TOP_DOWN_3D_START] continue-pipeline-step response: {
  hasError: true,
  errorMessage: "Outdated transition: phase has changed",
  errorContext: {...}
}
[TOP_DOWN_3D_START] continue-pipeline-step error: FunctionsHttpError
[TOP_DOWN_3D_START] Full error object: {...}
```

### Failure Case (Step Execution)

```javascript
[TOP_DOWN_3D_START] ✓ Phase advanced to top_down_3d_pending
[TOP_DOWN_3D_START] Invoking run-pipeline-step for Step 1
[TOP_DOWN_3D_START] run-pipeline-step response: {
  hasError: true,
  errorMessage: "Floor plan not found",
  errorContext: {...}
}
[TOP_DOWN_3D_START] Edge function error: FunctionsHttpError
[TOP_DOWN_3D_START] Full error object: {...}
```

## Common Error Messages Decoded

| Error Message | Meaning | Fix |
|---------------|---------|-----|
| `Outdated transition: phase has changed` | Pipeline moved to different phase | Refresh page |
| `Invalid token` | Authentication expired | Log out/in |
| `Pipeline not found` | Wrong pipeline ID or deleted | Check project |
| `Phase mismatch: expected one of [...]` | Wrong phase for Step 1 | Refresh page |
| `Space analysis output not found` | Step 0 incomplete | Re-run Step 0 |
| `Floor plan not found` | Floor plan upload deleted | Re-upload |
| `Missing authorization header` | Not logged in | Log in |

## Prevention

To avoid this error in the future:

1. **Wait for completion**: Let Step 0 fully complete before starting Step 1
2. **Refresh page**: Refresh after each step completes
3. **Check status**: Verify pipeline shows correct status before proceeding
4. **Stay logged in**: Don't let session expire between steps

## Files Modified

Enhanced error logging added to:

**File**: `src/hooks/useWholeApartmentPipeline.ts`

**Changes**:
- Lines 474-510: Enhanced `continue-pipeline-step` logging
- Lines 492-516: Enhanced `run-pipeline-step` logging
- Added full error object logging
- Added response structure logging
- Added success confirmation logs

## Related Documentation

- **Phase Contract**: `supabase/functions/_shared/pipeline-phase-step-contract.ts`
- **Continue Function**: `supabase/functions/continue-pipeline-step/index.ts`
- **Run Step Function**: `supabase/functions/run-pipeline-step/index.ts`

## Reporting an Issue

If none of the above solutions work, report with:

1. **Full frontend console logs** (everything starting with `[TOP_DOWN_3D_START]`)
2. **Supabase Edge Function logs** (both `continue-pipeline-step` and `run-pipeline-step`)
3. **Pipeline state** (phase, step, has outputs)
4. **Steps to reproduce**

The enhanced logging should provide all necessary context to diagnose the issue.
