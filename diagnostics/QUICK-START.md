# Step 0 Fix - Quick Start Guide

## What Just Happened

✅ **Fixed**: The `runStyleAnalysis()` function now uses image transformations (compress before download)
✅ **Deployed**: Version `2.1.0-transform-fix` is now live
✅ **Added**: Diagnostic tools and verification guides

## Immediate Next Steps

### 1. Verify Supabase Storage Transformations Enabled (CRITICAL)

**Without this, the fix won't work!**

1. Go to: [Supabase Dashboard → Storage → Settings](https://supabase.com/dashboard/project/zturojwgqtjrxwsfbwqw/storage/settings)
2. Find: "Image Transformations" toggle
3. Ensure: Toggle is **ON** (blue)
4. If you just enabled it: Wait 2-3 minutes before testing

### 2. Run Diagnostic Queries

**File**: `A:\RE-TOUR\diagnostics\step0-debug-queries.sql`

**Quick check - Run this in Supabase SQL Editor:**

```sql
-- Check if design references exist (this determines if Step 0.1 runs)
SELECT
  u.id,
  u.original_filename,
  ROUND(u.size_bytes::numeric / 1024 / 1024, 2) as size_mb
FROM uploads u
WHERE u.project_id = (
  SELECT project_id FROM floorplan_pipelines
  WHERE id = 'c0d8ac86-8d49-45a8-90e9-8deee01e640f'
)
AND u.kind = 'design_ref';
```

**What this tells you:**
- **No rows returned**: Only Step 0.2 runs (floor plan analysis) - Should already work
- **Rows returned**: BOTH Step 0.1 (style) AND Step 0.2 run - This is what we fixed

### 3. Reset Pipeline to Step 0 and Test

**Run this in Supabase SQL Editor:**

```sql
UPDATE floorplan_pipelines
SET
  status = 'step0_pending',
  whole_apartment_phase = 'space_analysis_pending',
  current_step = 0,
  last_error = NULL
WHERE id = 'c0d8ac86-8d49-45a8-90e9-8deee01e640f';
```

**Then trigger Step 0 from your frontend/API.**

### 4. Check Logs

Go to: [Supabase Dashboard → Functions → run-space-analysis → Logs](https://supabase.com/dashboard/project/zturojwgqtjrxwsfbwqw/functions/run-space-analysis/logs)

**Look for:**

✅ **Version marker** (confirms deployment worked):
```
[SPACE_ANALYSIS] VERSION: 2.1.0-transform-fix
```

✅ **Transformation logs for design references** (confirms fix applied):
```
[runStyleAnalysis] Original file size: reference1.jpg (22.30 MB)
[runStyleAnalysis] Creating signed URL with transformations for reference1.jpg
[runStyleAnalysis] Transformed size: 2.80 MB
```

✅ **Success message**:
```
[SPACE_ANALYSIS] Complete: X rooms + Y zones
```

❌ **If you see this** (transformations NOT working):
```
[runStyleAnalysis] Transformed size: 22.30 MB
[runStyleAnalysis] CRITICAL: Image is 22.30MB after transformation!
```
→ Go back to Step 1, enable transformations

### 5. Check Langfuse (Optional but Recommended)

Go to: [Langfuse Traces](https://cloud.langfuse.com/traces)

Search for: `c0d8ac86-8d49-45a8-90e9-8deee01e640f`

**Check:**
- `design_reference_analysis_step_0_1` generation (if design refs exist)
- `space_analysis_step_0_2` generation (always runs)
- **Input size**: Should be < 5MB per image after transformations
- **Output**: Should NOT be empty

## Expected Results

### ✅ Success Scenario

**Logs show:**
```
[SPACE_ANALYSIS] VERSION: 2.1.0-transform-fix
[SPACE_ANALYSIS] Action <uuid> started
[fetchImageAsBase64] Original file size: floorplan.png (28.50 MB)
[fetchImageAsBase64] Transformed size: 3.45 MB
[STEP 0.1] Running design reference analysis for 2 references
[runStyleAnalysis] Original file size: ref1.jpg (22.30 MB)
[runStyleAnalysis] Transformed size: 2.80 MB
[runStyleAnalysis] Original file size: ref2.jpg (18.60 MB)
[runStyleAnalysis] Transformed size: 2.10 MB
[STEP 0.1] Complete: Modern Minimalist
[SPACE_ANALYSIS] Complete: 4 rooms + 2 zones
[SPACE_ANALYSIS] Action <uuid> completed successfully
```

**Database shows:**
- `whole_apartment_phase`: `space_analysis_complete`
- `status`: `step1_pending` (or next step)
- `last_error`: `NULL`
- `step_outputs`: Contains `space_analysis` AND `reference_style_analysis`

### ❌ Failure Scenarios

#### Scenario 1: Version marker missing

**Logs show:** No `VERSION: 2.1.0-transform-fix` line

**Cause:** Deployment didn't apply or cached

**Fix:**
```bash
cd A:\RE-TOUR
npx supabase functions delete run-space-analysis
npx supabase functions deploy run-space-analysis --no-verify-jwt
```

#### Scenario 2: Transformed size same as original

**Logs show:** `Transformed size: 28.50 MB` (same as original)

**Cause:** Image transformations not enabled

**Fix:** Go to Supabase Storage Settings, enable transformations, wait 2-3 minutes

#### Scenario 3: Still getting "Empty response"

**Possible causes:**
1. Transformations not working (check logs)
2. Different error (check Langfuse traces to see which sub-step failed)
3. Image is corrupt (try different image)

**Debug:**
- Run full diagnostic queries: `step0-debug-queries.sql`
- Check Langfuse traces for detailed error
- Share logs with timestamps

## Files Created

- **`diagnostics/step0-debug-queries.sql`**: SQL queries to check pipeline state
- **`diagnostics/verify-deployment.md`**: Detailed troubleshooting guide
- **`diagnostics/QUICK-START.md`**: This file (quick reference)

## What Was Changed in Code

**File**: `supabase/functions/run-space-analysis/index.ts`

**Changes:**
1. Added version marker: `VERSION = "2.1.0-transform-fix"`
2. Updated `runStyleAnalysis()` function (lines ~216-245):
   - Replaced `storage.download()` with `createSignedUrl()` + transform options
   - Added logging for original and transformed sizes
   - Added size validation (max 15MB after transformation)
3. Added version logging in main serve function

**Why:**
- Step 0.1 (Style Analysis) was downloading full-size design reference images
- This caused memory exhaustion in Edge Functions
- Gemini API returned empty responses due to memory issues
- Now all images are compressed to ~2-3MB before processing

## Questions?

If the fix doesn't work:
1. Check all items in this quick start
2. Read detailed guide: `diagnostics/verify-deployment.md`
3. Run diagnostic queries: `diagnostics/step0-debug-queries.sql`
4. Share:
   - Supabase function logs (with timestamps)
   - Langfuse trace ID
   - Results of diagnostic queries

## Timeline

- **Immediate**: Verify transformations enabled (Step 1)
- **5 minutes**: Run test (Steps 2-4)
- **10 minutes**: Check logs and verify success (Step 5)
- **If successful**: Monitor for 24-48 hours, consider refactoring to shared utility
- **If failed**: Run diagnostics and share results
