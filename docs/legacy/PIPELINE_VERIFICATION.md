# Pipeline Verification & Testing Guide

## Quick Start

### 1. Run Verification Script
```bash
# Verify phase-step contract and transitions
node scripts/verify-pipeline.js

# Test specific pipeline
node scripts/verify-pipeline.js <pipeline-id>
```

### 2. Manual Testing Checklist

#### Step 0 → Step 1 Transition
- [ ] Create new pipeline
- [ ] Run Space Analysis (Step 0)
- [ ] Wait for completion
- [ ] Click "Start Step 1"
- [ ] **Expected**: No 409 errors, Step 1 starts successfully
- [ ] **Check Console**: Should see `[TOP_DOWN_3D_START] Phase advanced to top_down_3d_pending`

#### Step 1 → Step 2 Transition
- [ ] Complete Step 1
- [ ] Approve Step 1 output
- [ ] Click "Start Step 2"
- [ ] **Expected**: No 409 errors, Step 2 starts successfully
- [ ] **Check Console**: Should see `[STYLE_START] Phase advanced to style_pending`

#### Step 2 → Step 3 Transition
- [ ] Complete Step 2
- [ ] Approve Step 2 output
- [ ] Click "Detect Spaces"
- [ ] **Expected**: No 409 errors, spaces detected successfully
- [ ] **Check Console**: Should see `[DETECT_SPACES_START] Phase advanced to detect_spaces_pending`

### 3. Error Scenarios to Test

#### 409 Conflict (Should NOT occur)
- **Trigger**: Try to start Step 1 without completing Step 0
- **Expected**: Clear error message, NOT 409 conflict
- **Fix Verification**: Should see phase check preventing invalid transition

#### Phase Mismatch (Should NOT occur)
- **Trigger**: Manually set phase to invalid state in database
- **Expected**: Frontend detects and corrects phase before calling Edge Function

### 4. Browser Console Checks

Look for these log messages to confirm fixes are working:

```
✅ Good Signs:
[TOP_DOWN_3D_START] Current phase: space_analysis_complete
[TOP_DOWN_3D_START] Phase is space_analysis_complete, calling continue-pipeline-step first
[TOP_DOWN_3D_START] Phase advanced to top_down_3d_pending
[TOP_DOWN_3D_START] Invoking run-pipeline-step for Step 1
[TOP_DOWN_3D_START] ✓ Step 1 started successfully

❌ Bad Signs (should NOT appear):
Edge Function returned a non-2xx status code
409 Conflict
FunctionsHttpError
```

### 5. Database Verification

Check phase consistency in database:

```sql
-- Check current pipeline phase
SELECT id, whole_apartment_phase, status 
FROM floorplan_pipelines 
WHERE id = '<pipeline-id>';

-- Verify phase-step alignment
SELECT 
  id,
  whole_apartment_phase,
  CASE 
    WHEN whole_apartment_phase IN ('upload', 'space_analysis_pending', 'space_analysis_running', 'space_analysis_complete', 'failed') THEN 0
    WHEN whole_apartment_phase IN ('top_down_3d_pending', 'top_down_3d_running', 'top_down_3d_review') THEN 1
    WHEN whole_apartment_phase IN ('style_pending', 'style_running', 'style_review') THEN 2
    WHEN whole_apartment_phase IN ('detect_spaces_pending', 'detecting_spaces', 'spaces_detected') THEN 3
    WHEN whole_apartment_phase IN ('camera_plan_pending', 'camera_plan_confirmed') THEN 4
    WHEN whole_apartment_phase IN ('renders_pending', 'renders_in_progress', 'renders_review') THEN 5
    WHEN whole_apartment_phase IN ('panoramas_pending', 'panoramas_in_progress', 'panoramas_review') THEN 6
    WHEN whole_apartment_phase IN ('merging_pending', 'merging_in_progress', 'merging_review', 'completed') THEN 7
  END as expected_step
FROM floorplan_pipelines
WHERE id = '<pipeline-id>';
```

## Repair Summary

### Changes Made

1. **Frontend Hook Repairs** (`useWholeApartmentPipeline.ts`)
   - ✅ Restored `runTopDown3D` with phase transition logic
   - ✅ Restored `runStyleTopDown` with phase transition logic
   - ✅ Restored `runDetectSpaces` with phase transition logic
   - ✅ Removed invalid `camera_plan_in_progress` phase
   - ✅ Added toast notifications for better UX

2. **Contract Alignment**
   - ✅ Frontend `PHASE_STEP_MAP` matches backend `PHASE_STEP_CONTRACT`
   - ✅ All phase transitions validated
   - ✅ Step numbering consistent (Step 3 = Detect Spaces, Step 4 = Camera Planning)

### Root Causes Fixed

1. **409 Conflict Errors**
   - **Cause**: Frontend called `run-pipeline-step` without checking/advancing phase
   - **Fix**: Added explicit phase checks and `continue-pipeline-step` calls

2. **Routing Mismatch**
   - **Cause**: Missing phase transition logic between steps
   - **Fix**: Restored backup's working phase advancement pattern

3. **Invalid Phase**
   - **Cause**: `camera_plan_in_progress` phase existed in frontend but not backend
   - **Fix**: Removed from both `WHOLE_APARTMENT_PHASES` and `PHASE_STEP_MAP`

## Next Steps

### Phase 2: Merge New Features (Optional)

If you want to preserve new features from current version:

1. **Step 0 Sub-steps** (0.1 Design Reference, 0.2 Space Scan)
   - Already present in current version
   - Verify integration with restored mutations

2. **Locked Pipeline Display**
   - Already present in current version
   - Update UI components to use new display structure

3. **Camera Context Fields**
   - Already present in type definitions
   - Verify database schema supports new fields

### Phase 3: Full Pipeline Test

Once browser is available:
1. Run complete pipeline from Step 0 → Step 7
2. Document any remaining issues
3. Update troubleshooting guide

## Rollback Plan

If issues persist:

```bash
# Restore from backup
cp A:\RE-TOUR_BACKUP\src\hooks\useWholeApartmentPipeline.ts a:\RE-TOUR\src\hooks\useWholeApartmentPipeline.ts

# Or revert specific changes
git diff HEAD src/hooks/useWholeApartmentPipeline.ts
git checkout HEAD -- src/hooks/useWholeApartmentPipeline.ts
```

## Support

If you encounter issues:
1. Check browser console for error messages
2. Run verification script: `node scripts/verify-pipeline.js`
3. Check database phase consistency
4. Review implementation plan: `C:\Users\User\.gemini\antigravity\brain\0019be27-afdf-402c-a0d0-9863ec7b144f\implementation_plan.md`
