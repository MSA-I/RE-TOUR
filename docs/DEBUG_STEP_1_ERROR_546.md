# Debug: Step 1 Error (Status 546)

## Issue Description

When clicking "Run Step 1", Supabase returns status code 546.

## Status Code 546

This is NOT a standard HTTP status code. It's likely a Supabase Edge Functions-specific error indicating:
- Memory limit exceeded
- Function timeout
- Infrastructure error

## Diagnosis Steps

### 1. Check Supabase Storage Image Transformations

**Critical**: The Edge Function requires image transformations to downscale images before processing.

**How to check**:
1. Go to Supabase Dashboard: https://supabase.com/dashboard
2. Select your project
3. Go to **Storage** → **Settings**
4. Look for **"Image Transformations"** setting
5. **Enable it** if not already enabled

**Why this matters**:
- Step 1 downloads the floor plan image
- Without transformations, the function tries to load the full-size image
- Large images (> 15MB) cause memory limits to be exceeded
- With transformations, images are automatically compressed to 1600px @ 60% quality

### 2. Check Floor Plan Image Size

Run this SQL query in Supabase SQL Editor:

```sql
-- Check the most recent floor plan upload size
SELECT
  u.id,
  u.original_filename,
  u.mime_type,
  u.bucket,
  u.path,
  u.created_at,
  -- Check metadata for file size if available
  u.metadata
FROM uploads u
JOIN floorplan_pipelines p ON p.floor_plan_upload_id = u.id
ORDER BY p.created_at DESC
LIMIT 1;
```

**Then check the actual file size in Storage**:
1. Go to Supabase Dashboard → Storage → Buckets
2. Find the bucket (probably "uploads" or "inputs")
3. Navigate to the file path shown in the query result
4. Check the file size

**Expected**:
- Floor plan should be < 15MB after transformation
- Recommended upload size: < 5MB original
- If file is very large, the transformations may timeout

### 3. Check Pipeline State

Run this SQL query:

```sql
SELECT
  id,
  current_step,
  whole_apartment_phase,
  status,
  last_error,
  updated_at,
  floor_plan_upload_id
FROM floorplan_pipelines
ORDER BY updated_at DESC
LIMIT 1;
```

**Expected states for Step 1**:
- `whole_apartment_phase` should be `"top_down_3d_pending"` or `"top_down_3d_running"`
- `current_step` should be `1`
- `status` should be `"step1_pending"` or `"step1_running"`

**If it shows**:
- Different phase: Phase transition from Step 0 to Step 1 failed
- Error in `last_error`: This will give you the actual error message

### 4. Check Edge Function Logs

Unfortunately, you can't access Edge Function logs directly from the CLI in real-time.

**Alternative**: Check Supabase Dashboard logs:
1. Go to Supabase Dashboard → Functions
2. Find "run-pipeline-step"
3. Click to view logs
4. Look for recent errors with timestamps matching your Step 1 click

**What to look for**:
- `[IMAGE_DOWNSCALE] CRITICAL: Image is XXmb after transformation!`
- `Image transformations failed: Downloaded XXmb`
- `Memory limit exceeded` errors
- `Failed to fetch image` errors

### 5. Check Browser Console

Open your browser DevTools (F12) and check the Console tab:

**Look for**:
- The full error object after clicking Step 1
- Network tab → Look for the POST to `/functions/v1/run-pipeline-step`
- Click on that request → Response tab → See if there's an error message

### 6. Verify API Keys

Edge Function requires these environment variables:
- `API_NANOBANANA` (for image generation)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

**Check**:
1. Go to Supabase Dashboard → Project Settings → Edge Functions
2. Verify all required secrets are set
3. Especially check `API_NANOBANANA` is valid

## Common Fixes

### Fix 1: Enable Image Transformations (Most Common)

```
Supabase Dashboard → Storage → Settings → Enable Image Transformations
```

After enabling, wait 1-2 minutes for the feature to activate, then try Step 1 again.

### Fix 2: Reduce Floor Plan Size

If your floor plan is very large (> 20MB original):
1. Resize it before uploading
2. Recommended size: 2048px max dimension
3. Export as PNG or JPEG with 80% quality

### Fix 3: Check Phase Transition

If pipeline is stuck in wrong phase:

```sql
-- Reset pipeline to correct phase for Step 1
UPDATE floorplan_pipelines
SET
  whole_apartment_phase = 'top_down_3d_pending',
  status = 'step1_pending',
  current_step = 1
WHERE id = '<your-pipeline-id>';
```

Replace `<your-pipeline-id>` with your actual pipeline ID.

### Fix 4: Check Memory Logs

If the issue persists, the Edge Function might be hitting memory limits even with transformations.

**Code location**: `A:\RE-TOUR\supabase\functions\run-pipeline-step\index.ts:1676-1699`

The function has a hard 15MB limit. If your image is larger even after transformation, you'll need to:
1. Verify transformations are working (check downloaded size in logs)
2. Upload a smaller floor plan

## Next Steps

1. **Enable image transformations** (if not already)
2. **Run the SQL queries** above to check state
3. **Check Supabase Dashboard logs** for actual error message
4. **Report back** with:
   - Pipeline phase and status from SQL
   - Any error messages from logs
   - Floor plan file size
   - Whether image transformations are enabled

This will help pinpoint the exact issue!
