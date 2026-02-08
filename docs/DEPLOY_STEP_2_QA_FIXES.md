# Deploy Step 2 QA Fixes - Quick Guide

## Errors Fixed

### ✅ Error 1: `Cannot access 'attemptIndex' before initialization`
**Problem**: Variable used before it was defined (line 2367 used it, defined at line 2406)

**Fix**: Moved `attemptIndex` calculation before the QA validation call

### ✅ Error 2: `Body is unusable at Request.clone()`
**Problem**: Request body was already consumed, can't be cloned again

**Fix**: Use `pipeline_id` variable directly instead of cloning request

### ✅ Error 3: QA Stuck/Hanging
**Problem**: No timeout on QA service call

**Fix**: Added 2-minute timeout with AbortController

---

## Deploy Now

```bash
cd A:\RE-TOUR
npx supabase functions deploy run-pipeline-step
```

**Wait 1-2 minutes** for deployment to complete.

---

## Test Step 2

1. Navigate to your pipeline
2. Click "Run Step 2" (Style Reference)
3. Monitor the logs

### Expected Success Logs

```
[QA] Preparing request to run-qa-check Edge Function
[QA] Pipeline: <id>, Project: <id>, Step: 2, Attempt: 1
[QA] Calling run-qa-check: {"upload_id":"...","qa_type":"style",...}
[QA] run-qa-check completed in 2500ms, status: 200
[QA] run-qa-check result: {"qa_decision":"approved","qa_score":85,...}
[QA] Final decision: approved, score: 85, reason: All checks passed
```

### Expected Rejection (with Reason)

```
[QA] Final decision: rejected, score: 45, reason: [furniture_mismatch] Single bed changed to double bed; [text_label_missing] Kitchen label missing
```

### No More Errors

You should **NOT** see:
- ❌ `Cannot access 'attemptIndex' before initialization`
- ❌ `Body is unusable at Request.clone()`
- ❌ QA stuck indefinitely
- ❌ `QA could not run (missing API key)`

---

## If QA Still Hangs

**Check run-qa-check logs separately:**

1. Go to Supabase Dashboard
2. Edge Functions → **run-qa-check** (not run-pipeline-step)
3. Click **Logs** tab
4. Look for errors

**Common issues:**
- `API_NANOBANANA` not set in secrets
- Image URLs not accessible (signed URL expired)
- Gemini API rate limit

---

## Verification Checklist

After deployment:

- [ ] Step 2 starts without `attemptIndex` error
- [ ] QA completes within 2 minutes (no timeout)
- [ ] QA returns score (0-100) for approved/rejected
- [ ] Rejection reasons are specific (not generic)
- [ ] No "Body unusable" errors in logs
- [ ] Pipeline resets correctly on error (no clone error)

---

## Rollback (if needed)

If you need to revert:

```bash
cd A:\RE-TOUR
git checkout HEAD -- supabase/functions/run-pipeline-step/index.ts
npx supabase functions deploy run-pipeline-step
```

This will restore the previous version (before these fixes).

---

## Summary of Changes

**File**: `supabase/functions/run-pipeline-step/index.ts`

**Line 2350**: Moved `attemptIndex` calculation before QA call
**Line 3054**: Removed `req.clone()`, use `pipeline_id` directly
**Line 3222**: Added 2-minute timeout with AbortController for QA fetch

All changes are surgical and don't affect other pipeline steps.

---

## Next: Fix Remaining Issues

After deployment succeeds, we still need to address:

3. **Failed attempts visibility** - Check if frontend displays attempt history
4. **QA score format** - Update UI to show score consistently (like Multi Panoramas)

These are frontend updates and don't require redeployment.
