# Getting Edge Function Logs from Supabase

## Method 1: Supabase Dashboard (Easiest)

1. Go to: https://supabase.com/dashboard/project/zturojwgqtjrxwsfbwqw/functions
2. Click on **"run-space-analysis"**
3. Click **"Logs"** tab
4. Look at the most recent error (should be within last few minutes)
5. Copy the full error message

## Method 2: Using Supabase CLI

```bash
# Real-time logs (run this BEFORE triggering Step 0)
npx supabase functions logs run-space-analysis --follow

# Then trigger Step 0 from your UI
# You'll see the logs in real-time
```

## Method 3: Check Recent Logs

```bash
# Get last 20 log entries
npx supabase functions logs run-space-analysis --limit 20
```

## What to Look For

### Good Log (Success):
```
[SPACE_ANALYSIS] VERSION: 2.2.0-stability-fix
[fetchImageAsBase64] ENTRY - Upload ID: ...
[fetchImageAsBase64] Original file: ... (X.XX MB)
[fetchImageAsBase64] Transformed size: X.XX MB
[fetchImageAsBase64] SUCCESS - Returning validated base64 image
[SPACE_ANALYSIS] Complete: 4 rooms + 2 zones
```

### Bad Log (Error):
```
[fetchImageAsBase64] Failed to create signed URL: ...
```
OR
```
Error: Floor plan upload not found
```
OR
```
Failed to prepare floor plan image for processing
```

### Critical: Check for Version Marker

**If you see:**
```
[SPACE_ANALYSIS] VERSION: 2.1.1-req-body-fix
```
→ Old version is still deployed (my fixes haven't been deployed yet)

**If you see:**
```
[SPACE_ANALYSIS] VERSION: 2.2.0-stability-fix
```
→ New version is deployed correctly

## Common Error Messages and Fixes

### Error: "Failed to prepare floor plan image"
**Cause**: Image transformations not enabled
**Fix**:
1. Supabase Dashboard → Storage → Settings
2. Enable "Image Transformations"
3. Wait 2-3 minutes
4. Try again

### Error: "Floor plan upload not found"
**Cause**: Pipeline references invalid upload ID
**Fix**: Run this SQL:
```sql
SELECT
  p.id as pipeline_id,
  p.floor_plan_upload_id,
  u.id as upload_exists
FROM floorplan_pipelines p
LEFT JOIN uploads u ON u.id = p.floor_plan_upload_id
WHERE p.id = '<your-pipeline-id>';
```
If upload_exists is NULL, the upload was deleted or never created.

### Error: "Image is too large even after compression"
**Cause**: Transformations not working
**Fix**:
1. Check transformations are enabled (see above)
2. Try uploading a smaller image (< 10 MB)

### Error: "req.json() is not a function" or similar
**Cause**: Old version still deployed
**Fix**: Redeploy the function

## Next Steps

**After you check the logs, share:**
1. The exact error message from the logs
2. The version marker (2.1.1 or 2.2.0)
3. Whether you see image size logs

This will tell us exactly what's wrong!
