# FIX: Step 2 "Apply Style" Edge Function Error

**Date**: 2026-02-12
**Issue**: Edge Function returned a non-2xx status code
**Status**: FIXED - Awaiting deployment

---

## Problem Report

**User Report:**
> When I click Apply Style this is the error that appears: "Style Application Failed - Edge Function returned a non-2xx status code"

**Error Messages:**
- "Style Application Failed"
- "Edge Function returned a non-2xx status code"
- "Failed to start Step 2"

---

## Root Cause Analysis

The `run-pipeline-step` edge function was looking for Step 1's output using only one field name pattern:

```typescript
const step1OutputId = initialOutputs.step1?.output_upload_id || null;
```

But the actual data could be stored with different field name variations:
- Key: `step1` OR `"1"`
- Field: `output_upload_id` OR `upload_id`

When Step 2 tried to load Step 1's output as input, it couldn't find it because it wasn't checking all possible field name patterns.

**Error Flow:**
1. User clicks "Apply Style" in Step 2
2. Frontend calls `runStyleTopDown()` mutation
3. Mutation calls `run-pipeline-step` edge function with `step_number: 2`
4. Edge function tries to load Step 1 output using `step1OutputId`
5. **FAILS** because `step1OutputId` is null (field name mismatch)
6. Throws error: "No previous step output found. Please ensure at least step 1 has completed successfully."
7. User sees: "Edge Function returned a non-2xx status code"

---

## The Fix

### File: `supabase/functions/run-pipeline-step/index.ts`

#### Change 1: Check All Field Name Variations (Lines 1414-1420)

**Before:**
```typescript
const step1OutputId = initialOutputs.step1?.output_upload_id || null;
const step2OutputId = initialOutputs.step2?.output_upload_id || null;
const step3OutputId = initialOutputs.step3?.output_upload_id || null;
const step4OutputId = initialOutputs.step4?.output_upload_id || null;
```

**After:**
```typescript
// Support both "step1" and "1" keys, and both "upload_id" and "output_upload_id" fields
const step1OutputId = initialOutputs.step1?.output_upload_id || initialOutputs.step1?.upload_id ||
                      initialOutputs["1"]?.output_upload_id || initialOutputs["1"]?.upload_id || null;
const step2OutputId = initialOutputs.step2?.output_upload_id || initialOutputs.step2?.upload_id ||
                      initialOutputs["2"]?.output_upload_id || initialOutputs["2"]?.upload_id || null;
const step3OutputId = initialOutputs.step3?.output_upload_id || initialOutputs.step3?.upload_id ||
                      initialOutputs["3"]?.output_upload_id || initialOutputs["3"]?.upload_id || null;
const step4OutputId = initialOutputs.step4?.output_upload_id || initialOutputs.step4?.upload_id ||
                      initialOutputs["4"]?.output_upload_id || initialOutputs["4"]?.upload_id || null;
```

**Why:** This checks for 4 possible field name patterns per step, ensuring compatibility with different naming conventions.

#### Change 2: Improved Error Logging (Lines 1635-1637)

**Before:**
```typescript
if (!prevStepOutput) {
  console.error(`[run-pipeline-step] No valid previous step output found for step ${currentStep}`);
  throw new Error(`No previous step output found. Please ensure at least step 1 has completed successfully.`);
}
```

**After:**
```typescript
if (!prevStepOutput) {
  console.error(`[run-pipeline-step] No valid previous step output found for step ${currentStep}`);
  console.error(`[run-pipeline-step] Available step outputs:`, JSON.stringify(stepOutputIds));
  console.error(`[run-pipeline-step] Full step_outputs keys:`, Object.keys(initialOutputs));
  throw new Error(`No previous step output found for step ${currentStep}. Available outputs: ${Object.keys(stepOutputIds).filter(k => stepOutputIds[k]).join(', ')}. Please ensure step ${currentStep - 1} has completed successfully.`);
}
```

**Why:** Provides detailed diagnostic information showing:
- What step outputs are actually available
- What keys exist in the database
- Which specific step is missing
- More helpful error message for debugging

---

## Deployment Required

**The fix is code-complete but requires deployment to take effect.**

### Deploy the Edge Function

```bash
cd A:/RE-TOUR
supabase functions deploy run-pipeline-step
```

Or with project reference:
```bash
supabase functions deploy run-pipeline-step --project-ref YOUR_PROJECT_REF
```

### Verification

After deployment, test:
1. Upload floor plan in Step 0
2. Run Step 1 (Generate 2D Plan)
3. Approve Step 1 output
4. Click "Apply Style" in Step 2
5. Verify no error appears

**Expected:** Step 2 should start successfully and apply style to the 2D plan.

---

## Why This Error Occurred

The issue arose from inconsistent field naming across different parts of the codebase:

### Backend (run-pipeline-step)
Saves outputs as:
```typescript
stepOutputs[`step${currentStep}`] = {
  output_upload_id: output.output_upload_id,
  ...
};
```

Uses key: `step1`, `step2`, etc.
Uses field: `output_upload_id`

### Frontend (Step Components)
Reads outputs as:
```typescript
const step1Output = stepOutputs["step1"] || stepOutputs["1"];
const outputUploadId = step1Output?.upload_id || step1Output?.output_upload_id;
```

Checks both:
- Key: `step1` OR `"1"`
- Field: `upload_id` OR `output_upload_id`

**The Mismatch:**
Backend was only checking ONE pattern (`step1.output_upload_id`), while frontend was checking FOUR patterns. The fix makes backend match frontend's flexibility.

---

## Related Issues

This same fix was applied to all steps (1-4) to prevent similar issues in Steps 3 and 4.

**Prevention:**
- Standardize field naming conventions across backend and frontend
- Document field naming patterns in shared types
- Add validation tests for field name compatibility

---

## Testing Status

- [x] Fix applied to code
- [ ] Edge function deployed
- [ ] Tested with real pipeline
- [ ] Verified error resolved

**Next:** User needs to deploy and test.

---

## Success Criteria

✅ Fixed when:
- User can click "Apply Style" without error
- Step 2 loads Step 1's output correctly
- Style application proceeds normally
- No "Edge Function returned a non-2xx status code" error

---

**Status**: Code fixed, awaiting deployment
**Priority**: HIGH - Blocks Step 2 functionality
**Deployment Time**: ~1 minute
**Risk**: LOW - Backward compatible change (only adds fallbacks)
