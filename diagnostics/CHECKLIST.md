# Step 0 Fix - Verification Checklist

## Pre-Flight Check (Do This First!)

### ⚠️ CRITICAL: Enable Image Transformations

- [ ] Go to: [Supabase Dashboard → Storage → Settings](https://supabase.com/dashboard/project/zturojwgqtjrxwsfbwqw/storage/settings)
- [ ] Find: "Image Transformations" toggle
- [ ] Verify: Toggle is **ON** (blue)
- [ ] If just enabled: Wait 2-3 minutes before proceeding

**Why this matters**: Without transformations enabled, the fix won't work. Signed URLs with transform options will be ignored, and full-size images will still be downloaded.

---

## Step 1: Verify Deployment

### Check Function Version

- [ ] Go to: [Supabase Functions → Logs](https://supabase.com/dashboard/project/zturojwgqtjrxwsfbwqw/functions/run-space-analysis/logs)
- [ ] Trigger a test run (see Step 2)
- [ ] Search logs for: `VERSION: 2.1.0-transform-fix`

**Result**:
- ✅ Found: Deployment successful, proceed
- ❌ Not found: Redeploy function (see Troubleshooting)

---

## Step 2: Run Diagnostic Query

### Check What's Uploaded

Copy/paste this into Supabase SQL Editor:

```sql
-- Check design references
SELECT
  u.id,
  u.original_filename,
  ROUND(u.size_bytes::numeric / 1024 / 1024, 2) as size_mb
FROM uploads u
WHERE u.project_id = (
  SELECT project_id FROM floorplan_pipelines
  WHERE id = 'c0d8ac86-8d49-45a8-90e9-8deee01e640f'
)
AND u.kind = 'design_ref'
ORDER BY u.created_at DESC;
```

**Result**:
- ✅ No rows: Only floor plan analysis runs (Step 0.2) - Already fixed
- ✅ Rows returned: Style analysis runs (Step 0.1) - This is what we fixed
- [ ] Number of design refs found: _____
- [ ] Largest file size: _____ MB

---

## Step 3: Reset Pipeline

### Prepare for Test

Run this in Supabase SQL Editor:

```sql
UPDATE floorplan_pipelines
SET
  status = 'step0_pending',
  whole_apartment_phase = 'space_analysis_pending',
  current_step = 0,
  last_error = NULL
WHERE id = 'c0d8ac86-8d49-45a8-90e9-8deee01e640f';
```

- [ ] Query executed successfully
- [ ] Trigger Step 0 from your frontend/API

---

## Step 4: Check Logs

### Monitor Execution

Go to: [Supabase Functions → Logs](https://supabase.com/dashboard/project/zturojwgqtjrxwsfbwqw/functions/run-space-analysis/logs)

### Checklist Items

#### Version Marker
- [ ] Found: `[SPACE_ANALYSIS] VERSION: 2.1.0-transform-fix`

#### Floor Plan Transformation (Step 0.2)
- [ ] Found: `[fetchImageAsBase64] Original file size: ... (...XX MB)`
- [ ] Found: `[fetchImageAsBase64] Creating signed URL with transformations`
- [ ] Found: `[fetchImageAsBase64] Transformed size: X.XX MB`
- [ ] Transformed size is < 5MB: _____ MB

#### Design Reference Transformation (Step 0.1 - if refs exist)
- [ ] Found: `[STEP 0.1] Running design reference analysis for X references`
- [ ] Found: `[runStyleAnalysis] Original file size: ... (...XX MB)`
- [ ] Found: `[runStyleAnalysis] Creating signed URL with transformations`
- [ ] Found: `[runStyleAnalysis] Transformed size: X.XX MB`
- [ ] All transformed sizes < 5MB: _____ MB, _____ MB, ...

#### Success Messages
- [ ] Found: `[STEP 0.1] Complete: <style name>` (if refs exist)
- [ ] Found: `[SPACE_ANALYSIS] Complete: X rooms + Y zones`
- [ ] Found: `[SPACE_ANALYSIS] Action <uuid> completed successfully`

#### Error Check
- [ ] No "Empty response from model" errors
- [ ] No "Memory limit exceeded" errors
- [ ] No "Image too large" errors

---

## Step 5: Verify Database

### Check Pipeline State

Run this in Supabase SQL Editor:

```sql
SELECT
  id,
  whole_apartment_phase,
  status,
  last_error,
  step_outputs -> 'space_analysis' -> 'rooms_count' as rooms,
  step_outputs -> 'space_analysis' -> 'zones_count' as zones,
  step_outputs -> 'reference_style_analysis' as style_data
FROM floorplan_pipelines
WHERE id = 'c0d8ac86-8d49-45a8-90e9-8deee01e640f';
```

**Expected Values**:
- [ ] `whole_apartment_phase`: `space_analysis_complete`
- [ ] `status`: NOT `failed`
- [ ] `last_error`: `NULL`
- [ ] `rooms`: Number > 0
- [ ] `zones`: Number >= 0
- [ ] `style_data`: NOT NULL (if design refs exist)

---

## Step 6: Check Langfuse (Optional)

### Verify Traces

Go to: [Langfuse Traces](https://cloud.langfuse.com/traces)

Search for: `c0d8ac86-8d49-45a8-90e9-8deee01e640f`

### Check Generations

- [ ] Found trace for pipeline ID
- [ ] Generation: `space_analysis_step_0_2` exists
- [ ] Generation: `design_reference_analysis_step_0_1` exists (if refs exist)
- [ ] Input size reasonable (< 5MB per image in base64)
- [ ] Output NOT empty
- [ ] No errors in trace

---

## Success Criteria

### ✅ All Green = Fix Successful

- [ ] Version marker shows `2.1.0-transform-fix`
- [ ] All transformed sizes < 5MB
- [ ] No "Empty response" errors
- [ ] Pipeline phase = `space_analysis_complete`
- [ ] Database has `space_analysis` data
- [ ] Database has `reference_style_analysis` data (if refs exist)
- [ ] Langfuse traces show full input/output

**If all checked**: Success! Fix is working correctly.

---

## Troubleshooting

### Issue: Version marker not found

**Steps**:
1. [ ] Redeploy function:
```bash
cd A:\RE-TOUR
npx supabase functions deploy run-space-analysis --no-verify-jwt
```
2. [ ] Wait 1 minute
3. [ ] Retry test

### Issue: Transformed size same as original

Example: `Transformed size: 28.50 MB` (same as input)

**Steps**:
1. [ ] Go to Supabase Storage Settings
2. [ ] Enable "Image Transformations" toggle
3. [ ] Wait 2-3 minutes
4. [ ] Retry test

### Issue: "Empty response" still occurs

**Steps**:
1. [ ] Check which sub-step failed (Step 0.1 or 0.2)
2. [ ] Check Langfuse trace for detailed error
3. [ ] Check if transformations are working (size in logs)
4. [ ] Run full diagnostic queries (step0-debug-queries.sql)
5. [ ] Share results:
   - Supabase logs with timestamps
   - Langfuse trace ID
   - Diagnostic query results

### Issue: Memory exceeded error persists

**Steps**:
1. [ ] Verify transformations are working (size < 5MB)
2. [ ] If yes, may need to reduce maxOutputTokens
3. [ ] Consider processing design refs sequentially
4. [ ] Check if Edge Function memory limit can be increased

---

## Quick Reference

| File | Purpose |
|------|---------|
| `QUICK-START.md` | Quick reference guide |
| `verify-deployment.md` | Detailed troubleshooting |
| `step0-debug-queries.sql` | SQL diagnostic queries |
| `IMPLEMENTATION-SUMMARY.md` | What was changed |
| `CHECKLIST.md` | This file |

---

## Contact/Escalation

If all steps completed but issue persists:

**Share these**:
1. [ ] Supabase function logs (copy full log output with timestamps)
2. [ ] Langfuse trace ID
3. [ ] Results of diagnostic queries
4. [ ] Screenshot of Storage Settings (transformations toggle)
5. [ ] Checklist with marked items

**Include**:
- Pipeline ID: `c0d8ac86-8d49-45a8-90e9-8deee01e640f`
- Function version: Should be `2.1.0-transform-fix`
- Timestamp of test run
- Any error messages

---

## Timeline Estimate

- **2 minutes**: Pre-flight check (enable transformations)
- **1 minute**: Step 1 (verify deployment)
- **1 minute**: Step 2 (diagnostic query)
- **1 minute**: Step 3 (reset pipeline)
- **2-5 minutes**: Step 4 (check logs during execution)
- **1 minute**: Step 5 (verify database)
- **2 minutes**: Step 6 (check Langfuse)

**Total**: ~10-15 minutes for full verification

---

## Next Steps After Success

- [ ] Monitor production for 24-48 hours
- [ ] Check for any edge cases
- [ ] Consider refactoring to shared utility (future enhancement)
- [ ] Apply similar fix to `run-qa-check` function (future enhancement)

---

## Signature

**Test completed by**: _______________
**Date**: _______________
**Result**: ⬜ Success ⬜ Failed ⬜ Partial
**Notes**: _______________
