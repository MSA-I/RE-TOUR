# Pipeline Creation Fix: Phase/Step Mismatch

**Date:** 2026-02-11
**Status:** ✅ Fixed
**Issue:** 400 Bad Request when creating new whole_apartment pipeline
**Error:** "Phase upload expects step 0 but current_step is 1"

---

## Root Cause

The `createPipeline` mutation in `useFloorplanPipelines.ts` was creating whole_apartment pipelines with mismatched phase and step values:

**Bug:**
```typescript
const initialPhase = isWholeApartment ? "upload" : null;
const { data, error } = await supabase
  .from("floorplan_pipelines")
  .insert({
    whole_apartment_phase: initialPhase,  // "upload"
    current_step: startFromStep,           // 1 ❌ WRONG!
    // ...
  })
```

**Phase-Step Contract:**
- Phase "upload" → Step 0 (per `pipeline-phase-step-contract.ts:20`)
- But code was setting `current_step: 1` (the default value of `startFromStep`)

This violated the database constraint `enforce_phase_step_consistency`.

---

## Fix Applied

Updated `useFloorplanPipelines.ts:132-144` to explicitly set step 0 for whole_apartment pipelines:

```typescript
// Determine initial status and phase based on mode
const isWholeApartment = pipelineMode === "whole_apartment";
const initialStatus = isWholeApartment ? "step1_pending" : `step${startFromStep}_pending`;
const initialPhase = isWholeApartment ? "upload" : null;
// For whole_apartment mode: phase "upload" expects step 0
const initialStep = isWholeApartment ? 0 : startFromStep;  // ✅ FIX

const { data, error } = await supabase
  .from("floorplan_pipelines")
  .insert({
    project_id: projectId,
    owner_id: user.id,
    floor_plan_upload_id: floorPlanUploadId,
    status: initialStatus,
    current_step: initialStep,  // ✅ Now correctly set to 0 for whole_apartment
    output_resolution: outputResolution,
    aspect_ratio: aspectRatio,
    step_outputs: Object.keys(stepOutputs).length > 0 ? stepOutputs : null,
    pipeline_mode: pipelineMode,
    whole_apartment_phase: initialPhase
  })
```

**Key Change:**
- Added `initialStep` variable that checks `isWholeApartment`
- If true: set to 0 (matches "upload" phase)
- If false: use `startFromStep` (legacy behavior unchanged)

---

## Files Changed

**Frontend:**
- `src/hooks/useFloorplanPipelines.ts:132-145` - Fixed pipeline creation logic

**Related Files (Not Changed):**
- `supabase/functions/_shared/pipeline-phase-step-contract.ts` - Authoritative phase-step mapping
- `supabase/migrations/20250211_update_phase_step_constraint.sql` - Database constraint

---

## Testing Instructions

### 1. Rebuild Frontend

```bash
# If running dev server, it should hot-reload automatically
# If not, restart:
npm run dev
```

### 2. Create New Pipeline

1. Navigate to a project in the UI
2. Click "Create New Pipeline" or similar button
3. Select pipeline mode: "Whole Apartment"
4. Click "Create"

### 3. Expected Results ✅

**Success Indicators:**
- No 400 Bad Request error
- Pipeline created successfully
- Pipeline shows at Step 0 (upload phase)
- Database shows:
  - `whole_apartment_phase: "upload"`
  - `current_step: 0`
  - No constraint violations

**Browser Console:**
- No errors
- Success toast: "Pipeline created"

### 4. Verify in Database (Optional)

Open Supabase dashboard → Table Editor → `floorplan_pipelines`:
```
whole_apartment_phase: "upload"
current_step: 0
pipeline_mode: "whole_apartment"
status: "step1_pending" (or similar)
```

---

## Edge Cases Handled

### Whole Apartment Pipeline
- ✅ Phase: "upload", Step: 0 (FIXED)

### Legacy Pipeline (Not Whole Apartment)
- ✅ Phase: null, Step: `startFromStep` (unchanged)

### Starting from Later Step
- ✅ Legacy pipelines can still start from step 2, 3, etc. (unchanged)
- ✅ Whole apartment pipelines always start from step 0 (new behavior)

---

## Related Issues

This is the **second** phase/step mismatch bug found today:

### Issue #1: Step 2 → Step 3 Transition
- **File:** `supabase/functions/continue-pipeline-step/index.ts`
- **Fix:** Deployed updated edge function
- **Status:** ✅ Resolved
- **Docs:** `CRITICAL_FIX_PHASE_STEP_MISMATCH.md`

### Issue #2: Pipeline Creation (THIS FIX)
- **File:** `src/hooks/useFloorplanPipelines.ts`
- **Fix:** Set `current_step: 0` for whole_apartment pipelines
- **Status:** ✅ Fixed (pending test)
- **Docs:** This file

---

## Why This Happened

The phase/step constraint was recently added in migration `20250211_update_phase_step_constraint.sql`. This exposed pre-existing bugs where phase and step were set independently without checking consistency.

**Root Cause:** Code was setting phase and step separately without referencing the authoritative contract.

**Prevention:** All phase/step updates should reference `PHASE_STEP_CONTRACT` to ensure consistency.

---

## Impact

**Before Fix:**
- Users cannot create new whole_apartment pipelines
- 400 Bad Request error blocks pipeline creation
- Database constraint violation

**After Fix:**
- Users can create whole_apartment pipelines successfully
- Phase and step are in sync from creation
- No constraint violations

---

## Next Steps

### Immediate
1. ✅ Fix applied to code
2. ⏳ Test pipeline creation (user action required)
3. ⏳ Verify no constraint violations

### Optional Follow-Up
1. Search for other locations that set `whole_apartment_phase` and `current_step`
2. Verify all locations reference the phase-step contract
3. Consider adding a helper function: `getStepForPhase(phase: string): number`

---

## Verification Checklist

After fixing:
- [ ] Rebuild/restart dev server
- [ ] Create new whole_apartment pipeline
- [ ] No 400 error appears
- [ ] Pipeline created successfully
- [ ] Database shows: phase="upload", step=0
- [ ] Pipeline can advance to Step 1

---

## Summary

✅ **Fixed:** Pipeline creation now correctly sets `current_step: 0` for whole_apartment pipelines
✅ **Tested:** Logic verified against phase-step contract
⏳ **Verification Pending:** User needs to test pipeline creation

**Expected Result:** Smooth pipeline creation with no phase/step mismatch errors.
