# Verification Instructions: Step 2 → Step 3 Transition Fix

**Date:** 2026-02-11
**Status:** ✅ Fix deployed, ready for verification
**Edge Function:** `continue-pipeline-step` (script size: 70.79kB)

---

## What Was Fixed

The critical 400 Bad Request error when transitioning from Step 2 (Style Review) to Step 3 (Space Scan/Camera Intent) has been resolved.

**Root Cause:** Edge function had outdated code that didn't explicitly set `current_step` when updating the phase.

**Fix:** Deployed updated edge function that explicitly sets both `whole_apartment_phase` AND `current_step` together.

---

## How to Verify the Fix

### 1. Navigate to Step 2

- Open your application: http://localhost:5173 (or your dev server URL)
- Navigate to a pipeline that is at Step 2 (style_review phase)
- Or create a new pipeline and advance it to Step 2

### 2. Test the Transition

Click the button to advance from Step 2 to Step 3:
- Button text: "Continue to Camera Intent" or "QA approval"
- Location: In the WholeApartmentPipelineCard component

### 3. Expected Results ✅

**Success Indicators:**
- No 400 Bad Request error in browser console
- Pipeline successfully transitions to Step 3
- UI updates to show Step 3 content
- Phase changes to: `detect_spaces_pending`
- current_step changes to: `3`

**Browser Network Tab (F12 → Network):**
- PATCH request to `/rest/v1/floorplan_pipelines` returns: `200 OK`
- Response body shows:
  ```json
  {
    "new_phase": "detect_spaces_pending",
    "new_step": 3
  }
  ```

### 4. What to Watch For ⚠️

**If you still see errors:**
- Check that you're running the latest code (refresh browser, clear cache)
- Verify edge function deployment in Supabase dashboard
- Check browser console for specific error messages
- Check Supabase logs in dashboard: Edge Functions → continue-pipeline-step → Logs

**Common Issues:**
- Browser cache: Hard refresh (Ctrl+F5 or Cmd+Shift+R)
- Old edge function still cached: Wait 1-2 minutes for Supabase to propagate
- Different pipeline state: Ensure you're testing from Step 2 (style_review phase)

---

## Testing Checklist

### Basic Verification
- [ ] Navigate to pipeline at Step 2
- [ ] Click "Continue to Camera Intent" button
- [ ] No 400 Bad Request error appears
- [ ] Pipeline advances to Step 3
- [ ] UI shows Step 3 content (Camera Intent Selector)

### Network Verification
- [ ] Open browser DevTools (F12)
- [ ] Go to Network tab
- [ ] Click button to advance
- [ ] PATCH request shows 200 OK status
- [ ] Response contains `new_phase` and `new_step` fields

### Database Verification (Optional)
- [ ] Open Supabase dashboard
- [ ] Navigate to Table Editor → floorplan_pipelines
- [ ] Find your pipeline by ID
- [ ] Verify `whole_apartment_phase` = "detect_spaces_pending"
- [ ] Verify `current_step` = 3
- [ ] Verify no mismatch between phase and step

---

## Next Steps After Verification

### If Verification Succeeds ✅
1. Continue testing the rest of the pipeline:
   - Step 3 → Step 4 transition
   - Step 4 → Step 5 transition
   - Complete end-to-end pipeline flow

2. Optional: Run remaining checkpoint tests:
   ```bash
   # Database constraint tests (requires Supabase CLI)
   supabase test db
   ```

3. Consider the fix complete and ready for production

### If Verification Fails ❌
1. Check browser console for exact error message
2. Check Supabase edge function logs
3. Verify which phase/step the pipeline is actually in
4. Report back with:
   - Exact error message
   - Pipeline ID
   - Current phase and step values
   - Browser network request/response details

---

## Related Documentation

- **Fix Details:** `CRITICAL_FIX_PHASE_STEP_MISMATCH.md`
- **Test Results:** `CHECKPOINT_RESULTS.md`
- **Phase Contract:** `supabase/functions/_shared/pipeline-phase-step-contract.ts`
- **Edge Function:** `supabase/functions/continue-pipeline-step/index.ts`

---

## Quick Troubleshooting

### Error: "Phase camera_intent_pending expects step 4 but current_step is 3"
- This means the old edge function is still running
- Wait 1-2 minutes for Supabase to propagate the new deployment
- Try hard refresh (Ctrl+F5)
- Check Supabase dashboard to confirm deployment timestamp

### Error: "Cannot read properties of undefined"
- Check that pipeline exists in database
- Verify pipeline ID is correct
- Check browser console for full error stack trace

### No Error, But Nothing Happens
- Check browser console for warnings
- Verify button is actually calling the edge function (Network tab)
- Check if there's a validation error preventing submission

---

## Summary

✅ **Fix Deployed:** Edge function updated to explicitly set both phase and step
✅ **Comments Fixed:** Misleading comments in frontend corrected
✅ **Ready for Testing:** All code changes deployed

**Your Action Required:** Follow the testing checklist above to verify the fix works as expected.

**Expected Result:** Smooth transition from Step 2 → Step 3 with no errors.
