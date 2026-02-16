# All Pipeline Bugs - Complete Summary

**Date:** 2026-02-11
**Status:** 🔴 CRITICAL - Multiple database migrations not applied
**Root Cause:** 4 critical migrations from `20250211` never applied to database

---

## Overview

**DISCOVERY:** The root cause of all errors is that **4 critical migrations are missing** from your database:
1. `20250211_add_camera_intents_table.sql`
2. `20250211_add_final_prompts_table.sql`
3. `20250211_update_pipeline_phases.sql`
4. `20250211_update_phase_step_constraint.sql`

This causes multiple cascading bugs:

1. **Pipeline Creation Bug** - Creating new pipelines (phase/step mismatch in code)
2. **Phase Transition Bug** - Transitioning from Step 2 → Step 3 (phase/step mismatch in edge function)
3. **Missing Database View Bug** - 404 error (view doesn't exist)
4. **Missing Phase Values Bug** - 400 error (phase enum values don't exist)
5. **Outdated Trigger Bug** - 400 error (old phase-step constraint)

**SOLUTION:** Run `HOTFIX_COMPLETE_SETUP.sql` to apply ALL missing migrations at once.

---

## Bug #1: Pipeline Creation

### Error Message
```
POST https://zturojwgqtjrxwsfbwqw.supabase.co/rest/v1/floorplan_pipelines 400 (Bad Request)
{code: 'P0001', message: 'Phase upload expects step 0 but current_step is 1'}
```

### Root Cause
**File:** `src/hooks/useFloorplanPipelines.ts:144`

**Old Code (BUG):**
```typescript
const initialPhase = isWholeApartment ? "upload" : null;
const { data, error } = await supabase
  .from("floorplan_pipelines")
  .insert({
    whole_apartment_phase: initialPhase,  // "upload"
    current_step: startFromStep,           // 1 ❌ WRONG!
  })
```

**Problem:** Phase "upload" expects step 0, but code was setting step 1.

### Fix Applied
```typescript
const initialPhase = isWholeApartment ? "upload" : null;
const initialStep = isWholeApartment ? 0 : startFromStep;  // ✅ FIX

const { data, error } = await supabase
  .from("floorplan_pipelines")
  .insert({
    whole_apartment_phase: initialPhase,  // "upload"
    current_step: initialStep,            // 0 ✅ CORRECT!
  })
```

**Status:** ✅ Fixed in code, pending user verification

**Docs:** `PIPELINE_CREATION_FIX.md`

---

## Bug #2: Phase Transition (Step 2 → Step 3)

### Error Message
```
PATCH https://zturojwgqtjrxwsfbwqw.supabase.co/rest/v1/floorplan_pipelines 400 (Bad Request)
{code: 'P0001', message: 'Phase camera_intent_pending expects step 4 but current_step is 3'}
```

### Root Cause
**File:** `supabase/functions/continue-pipeline-step/index.ts`

**Old Deployed Code (BUG):**
```typescript
.update({
  whole_apartment_phase: nextPhase,  // "detect_spaces_pending"
  // DO NOT set current_step - trigger handles it  ❌ WRONG!
})
```

**Problem:**
- Code only set phase, relied on database trigger to auto-correct step
- Trigger validation ran BEFORE trigger could auto-correct, causing rejection
- Old deployed function had this bug, but local code was already fixed (deployment mismatch)

### Fix Applied
```typescript
.update({
  whole_apartment_phase: nextPhase,  // "detect_spaces_pending"
  current_step: nextStep,            // 3 ✅ Explicitly set both!
  last_error: null
})
```

**Deployment:**
```bash
supabase functions deploy continue-pipeline-step
```

**Status:** ✅ Deployed, pending user verification

**Docs:** `CRITICAL_FIX_PHASE_STEP_MISMATCH.md`

---

## Bug #3: Missing Database View

### Error Message
```
GET https://zturojwgqtjrxwsfbwqw.supabase.co/rest/v1/camera_intents_with_spaces 404 (Not Found)
{code: 'PGRST205', message: "Could not find the table 'public.camera_intents_with_spaces' in the schema cache"}
```

### Root Cause
**Migration:** `supabase/migrations/20260210150001_activate_camera_intents.sql`

**Problem:**
- Migration that creates `camera_intents_with_spaces` view exists locally
- But hasn't been applied to remote database
- Frontend tries to query this view immediately on pipeline creation
- View doesn't exist → 404 error

**Migration Status:**
```
Local: 20260210150001 ✅
Remote: (not applied) ❌
```

### Fix Required
**Manual Action:** Run SQL in Supabase dashboard

**SQL File:** `HOTFIX_CREATE_VIEW.sql`

```sql
CREATE OR REPLACE VIEW camera_intents_with_spaces AS
SELECT
  ci.*,
  ss.name AS standing_space_name,
  ss.space_type AS standing_space_type,
  ts.name AS target_space_name,
  ts.space_type AS target_space_type
FROM camera_intents ci
JOIN floorplan_pipeline_spaces ss ON ci.standing_space_id = ss.id
LEFT JOIN floorplan_pipeline_spaces ts ON ci.target_space_id = ts.id;

GRANT SELECT ON camera_intents_with_spaces TO authenticated;
GRANT SELECT ON camera_intents_with_spaces TO anon;
```

**Status:** ⏳ User must run SQL manually in Supabase dashboard

**Sub-Issue Discovered:** Initial SQL used wrong table structure (complex vs simple)
- Fixed by creating corrected SQL for simple structure
- Updated frontend query to use correct column names

**Docs:** `VIEW_CREATION_FIX.md`, `TABLE_STRUCTURE_MISMATCH_FIX.md`, `HOTFIX_CREATE_VIEW_CORRECT.sql`

---

## Phase-Step Contract Reference

**Authoritative Source:** `supabase/functions/_shared/pipeline-phase-step-contract.ts`

**Key Mappings:**
```
Phase "upload"                → Step 0
Phase "space_analysis_*"      → Step 0
Phase "top_down_3d_*"         → Step 1
Phase "style_*"               → Step 2
Phase "detect_spaces_*"       → Step 3  ← Bug #2 target
Phase "camera_plan_*"         → Step 4
Phase "renders_*"             → Step 5
Phase "panoramas_*"           → Step 6
Phase "merging_*"             → Step 7
```

---

## Timeline

1. **Migration Added:** `20250211_update_phase_step_constraint.sql`
   - Introduced database constraint: `enforce_phase_step_consistency`
   - Validates phase/step match on INSERT and UPDATE

2. **Bug #2 Discovered:** User reported 400 error when advancing from Step 2
   - Investigation revealed deployed edge function had outdated code
   - Local code was correct but never deployed
   - Fixed by deploying updated edge function

3. **Bug #1 Discovered:** User reported 400 error when creating new pipeline
   - Investigation revealed frontend was setting step 1 for phase "upload"
   - Fixed by updating frontend to set step 0 for whole_apartment mode

---

## Common Pattern

Both bugs followed the same pattern:

**❌ Anti-Pattern:**
```typescript
// Setting phase and step independently
.update({
  whole_apartment_phase: newPhase,
  current_step: guessedStep  // ❌ Not from contract!
})
```

**✅ Correct Pattern:**
```typescript
// Reference the contract
import { PHASE_STEP_CONTRACT } from './pipeline-phase-step-contract';

const nextStep = PHASE_STEP_CONTRACT[nextPhase];  // ✅ From contract!
.update({
  whole_apartment_phase: nextPhase,
  current_step: nextStep
})
```

---

## Files Changed

### Frontend
- ✅ `src/hooks/useFloorplanPipelines.ts` - Fixed pipeline creation (Bug #1)
- ✅ `src/components/WholeApartmentPipelineCard.tsx` - Fixed query ordering for simple table structure (Bug #3)

### Backend
- ✅ `supabase/functions/continue-pipeline-step/index.ts` - Deployed with explicit step setting (Bug #2)

### Database
- 🔴 `HOTFIX_COMPLETE_SETUP.sql` - **COMPLETE FIX - RUN THIS ONE** (fixes ALL bugs)
- ❌ `HOTFIX_CREATE_VIEW_CORRECT.sql` - Partial fix only (outdated)
- ❌ `HOTFIX_CREATE_VIEW.sql` - Wrong version (outdated)

### Documentation
- 🔴 `COMPLETE_FIX_REQUIRED.md` - **START HERE** (complete fix instructions)
- ✅ `PHASE_STEP_BUGS_SUMMARY.md` - This file (overview)
- ✅ `PIPELINE_CREATION_FIX.md` - Bug #1 details
- ✅ `CRITICAL_FIX_PHASE_STEP_MISMATCH.md` - Bug #2 details
- ✅ `VIEW_CREATION_FIX.md` - Bug #3 details (outdated)
- ✅ `TABLE_STRUCTURE_MISMATCH_FIX.md` - Bug #3 sub-issue
- ✅ `VERIFICATION_INSTRUCTIONS.md` - Testing guide
- ❌ `ACTION_REQUIRED.md` - Outdated (use COMPLETE_FIX_REQUIRED.md instead)

---

## Verification Required

### Bug #1: Pipeline Creation
**User Action:** Create a new whole_apartment pipeline

**Expected:**
- No 400 error
- Pipeline created successfully
- Database shows: phase="upload", step=0

**If Successful:**
- Pipeline creation works correctly
- Can advance to Step 1

### Bug #2: Phase Transition
**User Action:** Navigate pipeline from Step 2 to Step 3

**Expected:**
- No 400 error
- Pipeline advances to Step 3 (detect_spaces_pending)
- Database shows: phase="detect_spaces_pending", step=3

**If Successful:**
- Phase transitions work correctly
- Can continue through pipeline

---

## Prevention Strategies

### Immediate
1. ✅ Always reference `PHASE_STEP_CONTRACT` when setting phase/step
2. ✅ Set both phase AND step together in the same operation
3. ✅ Test deployment state, not just code logic

### Long-Term
1. Create helper function: `getStepForPhase(phase: string): number`
2. Audit all locations that set `whole_apartment_phase`
3. Add E2E tests that verify phase/step consistency
4. Add deployment smoke tests to catch deployed vs local mismatches

---

## Related Files

**Contract (SSOT):**
- `supabase/functions/_shared/pipeline-phase-step-contract.ts`

**Database:**
- `supabase/migrations/20250211_update_phase_step_constraint.sql` (constraint)

**Frontend:**
- `src/hooks/useFloorplanPipelines.ts` (creation)
- `src/hooks/useWholeApartmentPipeline.ts` (PHASE_STEP_MAP)
- `src/components/WholeApartmentPipelineCard.tsx` (UI)

**Backend:**
- `supabase/functions/continue-pipeline-step/index.ts` (transitions)
- `supabase/functions/run-space-render/index.ts` (phase updates)
- `supabase/functions/save-camera-intents/index.ts` (phase updates)

---

## Testing Checklist

### Manual Testing
- [ ] **Bug #3 (FIRST):** Run hotfix SQL in Supabase dashboard
  - [ ] Open Supabase dashboard → SQL Editor
  - [ ] Run `HOTFIX_CREATE_VIEW.sql`
  - [ ] See "View created successfully!" message
  - [ ] Verify view exists in Table Editor

- [ ] **Bug #1:** Create new whole_apartment pipeline
  - [ ] No 400 error (phase/step mismatch)
  - [ ] No 404 error (missing view)
  - [ ] Pipeline created successfully
  - [ ] Database shows correct phase/step

- [ ] **Bug #2:** Transition from Step 2 → Step 3
  - [ ] No 400 error
  - [ ] Pipeline advances successfully
  - [ ] Database shows correct phase/step

### Full Pipeline Flow
- [ ] Create pipeline (Step 0)
- [ ] Advance to Step 1
- [ ] Advance to Step 2
- [ ] Advance to Step 3 (Bug #2 test)
- [ ] Advance to Step 4
- [ ] Advance to Step 5
- [ ] Complete pipeline

### Edge Cases
- [ ] Create legacy pipeline (not whole_apartment)
- [ ] Reject and retry a step
- [ ] Reset pipeline to Step 1
- [ ] Go back to previous step

---

## Lessons Learned

1. **Database constraints expose bugs early** - The constraint caught bugs that would have caused silent data corruption
2. **Deployment state matters** - Tests verified logic was correct, but didn't catch deployment mismatch
3. **Single source of truth is critical** - Phase-step contract prevented worse inconsistencies
4. **Always set related fields together** - Setting phase without step (or vice versa) causes mismatches

---

## Impact Assessment

### Before Fixes
- ❌ Users cannot create new whole_apartment pipelines (Bugs #1, #3)
- ❌ Users see 404 errors for missing database view (Bug #3)
- ❌ Users see 400 errors for phase/step mismatch (Bug #1)
- ❌ Users cannot advance from Step 2 to Step 3 (Bug #2)
- ❌ Pipeline stuck at critical points
- ❌ Multiple error types block progress

### After All Fixes
- ✅ Users can create pipelines successfully
- ✅ Users can advance through all pipeline steps
- ✅ Phase and step stay in sync
- ✅ No constraint violations
- ✅ No missing views
- ✅ Smooth pipeline flow from creation to completion

---

## Current Status

**ROOT CAUSE IDENTIFIED:** Missing database migrations (20250211 files)

**Comprehensive Fix Created:**
- 🔴 **ACTION REQUIRED:** Run `HOTFIX_COMPLETE_SETUP.sql` in Supabase dashboard
- ✅ SQL includes: phase enum values, trigger, view, indexes, pipeline fixes
- ✅ Fixes ALL bugs at once
- 📄 Docs: `COMPLETE_FIX_REQUIRED.md`

**Individual Code Fixes (Still needed but not sufficient alone):**
- ✅ **Bug #1:** Frontend code fixed (`useFloorplanPipelines.ts`)
- ✅ **Bug #2:** Edge function deployed (`continue-pipeline-step`)
- ✅ **Bug #3:** Frontend query updated (`WholeApartmentPipelineCard.tsx`)

**Status:**
- ⚠️ **Database migrations missing** - Must run `HOTFIX_COMPLETE_SETUP.sql`
- ✅ Code fixes applied
- ⏳ Waiting for user to apply database hotfix
- ✅ Documentation complete

---

## Next Actions

### Immediate (User)
1. Restart dev server if needed: `npm run dev`
2. Test pipeline creation (Bug #1)
3. Test Step 2 → Step 3 transition (Bug #2)
4. Report results

### Follow-Up (Optional)
1. Audit all phase/step assignments
2. Create helper function for phase→step lookup
3. Add E2E tests for full pipeline flow
4. Set up deployment verification tests

---

## Success Criteria

**All three bugs will be considered fully resolved when:**
- [ ] Database view `camera_intents_with_spaces` exists (Bug #3)
- [ ] User can create new pipelines without 404 errors (Bug #3)
- [ ] User can create new pipelines without 400 errors (Bug #1)
- [ ] User can advance from Step 2 to Step 3 without errors (Bug #2)
- [ ] Database shows correct phase/step values (Bugs #1 & #2)
- [ ] No 400 Bad Request errors (phase/step mismatches)
- [ ] No 404 Not Found errors (missing views)
- [ ] No constraint violations

**Expected Outcome:** Complete pipeline flow from creation through completion with no errors.
