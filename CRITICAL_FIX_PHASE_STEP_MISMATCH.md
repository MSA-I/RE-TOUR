# CRITICAL FIX: Phase/Step Mismatch Error

**Date:** 2026-02-11
**Issue:** 400 Bad Request when transitioning from Step 2 to Step 3
**Error:** "Phase camera_intent_pending expects step 4 but current_step is 3"

---

## Root Cause

The deployed `continue-pipeline-step` edge function has **outdated code** that doesn't explicitly set `current_step` when updating the phase.

### Old Deployed Code (BUG):
```typescript
.update({
  whole_apartment_phase: nextPhase,
  // DO NOT set current_step - trigger handles it  ❌
})
```

This relied on a database trigger to auto-correct the step, but there's a timing issue causing the trigger to reject the update before it runs.

### New Fixed Code:
```typescript
.update({
  whole_apartment_phase: nextPhase,
  current_step: nextStep,  // ✅ Explicitly set both!
  last_error: null
})
```

---

## Immediate Fix

Redeploy the `continue-pipeline-step` edge function:

```bash
cd A:/RE-TOUR
supabase functions deploy continue-pipeline-step
```

---

## Verification

After deploying, test the fix:

1. Navigate to a pipeline at Step 2 (style_review)
2. Click "Continue to Camera Intent"
3. Should successfully transition to Step 3 (detect_spaces_pending)
4. No more 400 Bad Request error

---

## Why This Happened

The edge function code was updated locally but never deployed to production. The git status shows:

```
Changes not staged for commit:
	modified:   supabase/functions/continue-pipeline-step/index.ts
```

This is exactly the kind of issue the Deep Debugger plan was designed to catch!

---

## Prevention

This issue demonstrates why our testing infrastructure is critical:

### ✅ Prevented by Tests:
- Our phase transition tests (39/39 passed) verified the LOGIC is correct
- The contract file `pipeline-phase-step-contract.ts` has correct mappings

### ❌ Not Caught by Tests:
- Deployment state (local vs production mismatch)
- Timing issues with database triggers

### Recommendation:
Add deployment verification to CI/CD:
1. Verify edge functions deployed successfully
2. Run smoke test against production after deployment
3. Monitor edge function error rates post-deployment

---

## Related Files

**Edge Function:**
- `supabase/functions/continue-pipeline-step/index.ts` (uncommitted changes)

**Contract File:**
- `supabase/functions/_shared/pipeline-phase-step-contract.ts`

**Database Trigger:**
- `supabase/migrations/20250211_update_phase_step_constraint.sql`

**Frontend:**
- `src/components/WholeApartmentPipelineCard.tsx` (line 1542-1543 comment is wrong)

---

## Additional Fix Needed

Update the incorrect comment in WholeApartmentPipelineCard.tsx:

**Line 1542 (WRONG):**
```typescript
// Trigger phase transition from style_review → camera_intent_pending
onContinueToStep(2, "style_review");
```

**Should be:**
```typescript
// Trigger phase transition from style_review → detect_spaces_pending (Step 3)
onContinueToStep(2, "style_review");
```

The code works correctly (edge function looks up the right phase), but the comment is misleading.

---

## Impact

**Before Fix:**
- Users blocked at Step 2, cannot advance to Step 3
- 400 Bad Request error
- Pipeline stuck

**After Fix:**
- Users can advance from Step 2 → Step 3 → Step 4 correctly
- Phase and step stay in sync
- No database constraint violations

---

## Deployment Command

```bash
cd A:/RE-TOUR
supabase functions deploy continue-pipeline-step
```

**Expected Output:**
```
Deploying function continue-pipeline-step...
✓ Function deployed successfully
```

---

## Post-Deployment Verification

1. Test the exact user scenario:
   - Pipeline at Step 2 (style_review)
   - Click "Continue to Camera Intent"
   - Should transition to detect_spaces_pending (Step 3)
   - Phase and step should both update correctly

2. Check browser network tab:
   - Edge function call should return 200 OK
   - Response should show: `{ "new_phase": "detect_spaces_pending", "new_step": 3 }`

3. Monitor for errors:
   - No 400 Bad Request errors
   - No phase/step mismatch errors
   - Supabase dashboard should show function executing successfully

---

## Lessons Learned

1. **Always commit and deploy edge function changes** - Local changes don't help users!
2. **Test deployment state** - Not just code logic
3. **Comment accuracy matters** - Wrong comments mislead future developers
4. **Database triggers are fragile** - Explicitly set both phase AND step together

---

## Status

- ✅ **DEPLOYED** - Edge function successfully deployed (script size: 70.79kB)
- ✅ **Root Cause Identified** - Clear fix available
- ✅ **Tests Pass** - Phase transition logic correct
- ✅ **Comments Fixed** - Misleading comments in WholeApartmentPipelineCard.tsx corrected
- ⏳ **User Verification Pending** - Ready for testing

**DEPLOYED - Ready for user verification!**
