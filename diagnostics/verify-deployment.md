# Step 0 Fix - Deployment Verification Guide

## What Was Fixed

**Problem**: Step 0 was failing with "Empty response from model" when design references were attached to the pipeline.

**Root Cause**: The `runStyleAnalysis()` function (Step 0.1) was using the old `storage.download()` method without image transformations. This caused:
- Large design reference images (>15MB) to be downloaded at full size
- Memory exhaustion in Supabase Edge Function
- Gemini API timeouts or empty responses

**Fix Applied**:
- Updated `runStyleAnalysis()` to use `createSignedUrl()` with transform options (width: 1600, height: 1600, quality: 60, format: webp)
- Added version marker (`VERSION = "2.1.0-transform-fix"`) for deployment verification
- Added detailed logging to track transformed file sizes

## Deployment Steps

### 1. Deploy the Function

```bash
cd A:\RE-TOUR
npx supabase functions deploy run-space-analysis --no-verify-jwt
```

**Expected output:**
```
✓ Deployed Functions: run-space-analysis
  Uploading asset: run-space-analysis/index.ts
  Uploading asset: _shared/langfuse-client.ts
  Uploading asset: _shared/langfuse-generation-wrapper.ts
  Uploading asset: _shared/json-parsing.ts
  ...
  Deployed version: <timestamp>
```

### 2. Verify Deployment in Logs

**Method 1: Check Supabase Dashboard**

1. Go to: Supabase Project → Functions → run-space-analysis → Logs
2. Trigger a test run (reset pipeline to Step 0 and run)
3. Look for the version marker in logs:
   ```
   [SPACE_ANALYSIS] VERSION: 2.1.0-transform-fix
   ```

**Method 2: Check Transformation Logs**

After triggering Step 0, look for these new log lines:

**For floor plan (Step 0.2 - should already exist):**
```
[fetchImageAsBase64] Original file size: floorplan.png (28.50 MB)
[fetchImageAsBase64] Creating signed URL with transformations
[fetchImageAsBase64] Transformed size: 3.45 MB
```

**For design references (Step 0.1 - NEW logs after fix):**
```
[runStyleAnalysis] Original file size: reference1.jpg (22.30 MB)
[runStyleAnalysis] Creating signed URL with transformations for reference1.jpg
[runStyleAnalysis] Fetching transformed image from signed URL
[runStyleAnalysis] Transformed size: 2.80 MB
[runStyleAnalysis] Converting to base64: 2936832 bytes
```

### 3. Verify Supabase Storage Transformations Enabled

**CRITICAL**: Image transformations MUST be enabled in Supabase Storage settings.

**Check Dashboard:**
1. Go to: Supabase Project → Storage → Settings
2. Verify: "Image Transformations" toggle is **ON**
3. If OFF: Enable it and wait 2-3 minutes for changes to propagate

**How to tell if transformations are working:**
- Logs show: `Transformed size: X.XX MB` where X < 5 MB
- If logs show: `Transformed size: 28.50 MB` (same as original) → Transformations NOT working

**If transformations disabled:**
- Signed URLs with transform options are ignored
- Full-size images are downloaded
- Memory errors persist even after code fix

### 4. Test the Fix

#### Test Case 1: Floor Plan Only (No Design Refs)

**Setup:**
```sql
-- Reset pipeline to Step 0
UPDATE floorplan_pipelines
SET
  status = 'step0_pending',
  whole_apartment_phase = 'space_analysis_pending',
  current_step = 0,
  last_error = NULL,
  step_outputs = jsonb_set(
    COALESCE(step_outputs, '{}'::jsonb),
    '{design_reference_ids}',
    '[]'::jsonb
  )
WHERE id = 'c0d8ac86-8d49-45a8-90e9-8deee01e640f';
```

**Expected Result:**
- ✅ Step 0.2 (Space Analysis) runs
- ✅ Uses `fetchImageAsBase64()` with transforms (already fixed)
- ✅ Completes successfully
- ✅ Logs show transformed image size < 5MB

**If this FAILS:**
- Transformations not enabled in Supabase
- Deployment didn't apply
- Floor plan image is corrupted

#### Test Case 2: Floor Plan + Design References

**Setup:**
```sql
-- Get design reference IDs for this project
SELECT id, original_filename, size_bytes
FROM uploads
WHERE project_id = (
  SELECT project_id FROM floorplan_pipelines
  WHERE id = 'c0d8ac86-8d49-45a8-90e9-8deee01e640f'
)
AND kind = 'design_ref';

-- Add design references back and reset to Step 0
UPDATE floorplan_pipelines
SET
  status = 'step0_pending',
  whole_apartment_phase = 'space_analysis_pending',
  current_step = 0,
  last_error = NULL,
  step_outputs = jsonb_set(
    COALESCE(step_outputs, '{}'::jsonb),
    '{design_reference_ids}',
    '["ref-id-1", "ref-id-2"]'::jsonb  -- Replace with actual IDs
  )
WHERE id = 'c0d8ac86-8d49-45a8-90e9-8deee01e640f';
```

**Expected Result:**
- ✅ Step 0.1 (Style Analysis) runs FIRST
- ✅ Uses NEW `createSignedUrl()` with transforms
- ✅ Logs show: `[runStyleAnalysis] Transformed size: X.XX MB`
- ✅ Step 0.2 (Space Analysis) runs SECOND
- ✅ Both complete successfully
- ✅ No "Empty response from model" error

**If this STILL FAILS:**
- Check logs for version marker (verify deployment)
- Check transformed size in logs (verify transformations enabled)
- Check Langfuse traces for input size (should be < 5MB per image)

## Troubleshooting

### Issue: Version marker not showing in logs

**Cause**: Deployment didn't apply or cached function version

**Fix:**
```bash
# Force redeploy
npx supabase functions delete run-space-analysis
npx supabase functions deploy run-space-analysis --no-verify-jwt

# Wait 1 minute, then test again
```

### Issue: Transformed size same as original

**Cause**: Image transformations not enabled in Supabase Storage

**Fix:**
1. Supabase Dashboard → Storage → Settings
2. Enable "Image Transformations"
3. Wait 2-3 minutes
4. Test again

**Verify transformations work:**
```bash
# Test transformation manually
curl "https://<project>.supabase.co/storage/v1/object/public/uploads/<path>?width=800&height=800&quality=60"
```

If this returns the ORIGINAL size, transformations are not enabled.

### Issue: Still getting "Empty response from model"

**Possible causes:**

1. **Transformations not working**: Check logs for transformed size
2. **Image is corrupt**: Check if image can be downloaded manually
3. **Gemini API issue**: Check Gemini API status
4. **Different error source**: Check Langfuse traces to see which sub-step failed

**Debug checklist:**
- [ ] Version marker shows `2.1.0-transform-fix`
- [ ] Logs show `[runStyleAnalysis] Creating signed URL with transformations`
- [ ] Logs show `Transformed size: X.XX MB` where X < 5
- [ ] Supabase Storage transformations enabled
- [ ] Design reference IDs are valid (exist in uploads table)

### Issue: Memory exceeded error persists

**Cause**: Even with transformations, total memory usage too high

**Potential fixes:**

1. **Reduce maxOutputTokens** (if truncation is acceptable):
```typescript
// In runStyleAnalysis()
const requestParams = {
  temperature: 0.3,
  maxOutputTokens: 1000  // Reduced from 2000
};
```

2. **Process design references sequentially** (one at a time):
```typescript
// Instead of loading all at once, process in batches
for (const refId of designRefIds) {
  // Fetch, analyze, then release memory before next
}
```

3. **Increase Edge Function memory limit** (Pro plan feature):
- Supabase Dashboard → Functions → Settings
- Increase memory allocation

## Success Criteria

✅ **Fix is successful if:**

1. Version marker shows `2.1.0-transform-fix` in logs
2. Logs show transformed image sizes < 5MB for ALL images
3. Step 0.1 (Style Analysis) completes without errors
4. Step 0.2 (Space Analysis) completes without errors
5. Pipeline moves to `space_analysis_complete` phase
6. No "Empty response from model" errors
7. Langfuse traces show full input/output for both generations

## Next Steps After Verification

If fix is successful:
- Monitor production usage for 24-48 hours
- Check Langfuse for any anomalies
- Consider refactoring to shared utility (Fix 2 from plan)

If fix is NOT successful:
- Run diagnostic SQL queries (step0-debug-queries.sql)
- Share Supabase logs with detailed timestamps
- Share Langfuse trace IDs
- Check if issue is with specific images (test with smaller images)
