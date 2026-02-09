# How to Deploy the Step 1 Memory Fix

## Problem
You're seeing: `shutdown - Memory limit exceeded` in Supabase Edge Function logs.

## Solution Overview
I've implemented aggressive server-side image downscaling that reduces images to 1600px max with 60% quality before loading into memory. This requires:

1. **Deploying the updated Edge Function**
2. **Enabling Supabase Storage transformations**

---

## Step 1: Deploy the Updated Edge Function

The code changes won't take effect until you deploy. Run:

```bash
cd A:\RE-TOUR

# Deploy the updated run-pipeline-step function
npx supabase functions deploy run-pipeline-step
```

**Alternative (deploy all functions):**
```bash
npx supabase functions deploy
```

**Verify deployment:**
After deployment, check the Supabase Dashboard → Edge Functions → `run-pipeline-step` → should show recent deployment timestamp.

---

## Step 2: Enable Storage Image Transformations

This is **CRITICAL** - without this, the URL parameters won't work and images will still load at full size.

### In Supabase Dashboard:

1. **Go to Storage**
   - Navigate to https://supabase.com/dashboard
   - Select your project
   - Click **Storage** in left sidebar

2. **Enable for each bucket**

   For the `outputs` bucket:
   - Click on **outputs** bucket
   - Click **Settings** (gear icon or settings tab)
   - Find **"Image Transformations"** or **"Image Optimization"**
   - **Enable** the toggle
   - Save changes

   Repeat for the `uploads` bucket (if used for floor plans).

3. **Verify it's enabled**
   - Go back to bucket list
   - You should see a ✓ or badge indicating transformations are enabled

### Alternative: Check via SQL

Run this query in Supabase SQL Editor to check bucket settings:

```sql
SELECT
  name,
  id,
  public,
  file_size_limit,
  allowed_mime_types
FROM storage.buckets
WHERE name IN ('outputs', 'uploads');
```

(Note: Image transformation settings might not be in the database - they're project-level settings)

---

## Step 3: Test the Fix

1. **Go to your pipeline in the UI**
2. **Run Step 1 (Top-Down 3D)**
3. **Check Supabase Edge Function logs**

### Expected Success Logs:

```
[IMAGE_DOWNSCALE] Step 1: Applying AGGRESSIVE server-side downscaling
[IMAGE_DOWNSCALE] Transformations: width=1600, height=1600, quality=60, format=webp
[IMAGE_DOWNSCALE] Content-Length: 4.23MB
[IMAGE_DOWNSCALE] Downloaded: 4.23MB (4435968 bytes)
[IMAGE_DOWNSCALE] Base64: 5.64MB (5914624 chars)
[IMAGE_DOWNSCALE] Dimensions: 1600×1200 (WEBP)
[IMAGE_DOWNSCALE] ✅ Successfully downscaled to 1600px
```

### If Transformations Are NOT Working:

You'll see:
```
[IMAGE_DOWNSCALE] CRITICAL: Image is 28.50MB after transformation!
[IMAGE_DOWNSCALE] Storage transformations are NOT working.
Error: Image transformations failed: Downloaded 28.50MB (expected < 15MB).
Enable image transformations in your Supabase Storage bucket settings.
```

**Action**: Go back and enable Storage transformations (see Step 2 above).

---

## Troubleshooting

### Issue 1: Transformations Not Available on Your Plan

**Some Supabase plans don't include image transformations.**

Check: https://supabase.com/pricing

If transformations aren't available:

**Option A: Upgrade your Supabase plan** (Pro plan includes transformations)

**Option B: Use a different approach** - I can implement a manual image processing solution using Deno libraries, but it will be slower and more complex.

### Issue 2: Still Seeing Memory Errors After Deployment

**Possible causes:**

1. **Old function version still running**
   - Wait 1-2 minutes after deployment for new version to activate
   - Try triggering Step 1 again

2. **Transformations not enabled**
   - Double-check Storage settings in Supabase Dashboard
   - Look for error message in logs mentioning "Image transformations failed"

3. **Very large initial image**
   - Even with transformations, if the original image is extremely large (> 100MB), it might timeout
   - Solution: Re-upload floor plan using Step 0 (which applies client-side compression first)

4. **Memory exhaustion elsewhere in the code**
   - Check the full Edge Function logs
   - Look for which `logMemory()` call happens right before the error
   - Share the logs and I can investigate further

### Issue 3: Images Look Lower Quality

**Expected behavior** - images are compressed more aggressively (1600px, quality 60) to fit in memory.

If quality is too low for your needs:
- Ensure Supabase is on a plan with higher memory limits (Pro/Enterprise)
- I can adjust the parameters (increase quality/size) if you have more memory available

---

## Quick Diagnosis Commands

### Check if function was deployed:
```bash
# List deployed functions with timestamps
npx supabase functions list
```

### Check Edge Function logs:
1. Go to Supabase Dashboard
2. Edge Functions → `run-pipeline-step`
3. Click **Logs** tab
4. Look for recent `[IMAGE_DOWNSCALE]` messages

### Re-deploy if needed:
```bash
cd A:\RE-TOUR
npx supabase functions deploy run-pipeline-step --debug
```

---

## What Changed

### File Modified:
`supabase/functions/run-pipeline-step/index.ts`

### Key Changes:

1. **Aggressive transformation parameters:**
   - Width: 1600px (was 2400px)
   - Quality: 60 (was 80)
   - Format: WebP (better compression)

2. **Size validation:**
   - Checks Content-Length header before loading
   - Rejects images > 15MB with clear error message

3. **Better error messages:**
   - Tells you exactly if transformations aren't working
   - Provides actionable fix instructions

4. **Reference image safety:**
   - Skips reference images > 15MB
   - Prevents one bad reference from crashing the whole function

---

## Summary Checklist

- [ ] Deploy updated Edge Function (`npx supabase functions deploy run-pipeline-step`)
- [ ] Enable Storage transformations for `outputs` bucket
- [ ] Enable Storage transformations for `uploads` bucket
- [ ] Test Step 1 and check logs for `[IMAGE_DOWNSCALE] ✅` message
- [ ] Verify no "Memory limit exceeded" errors

If all checks pass, Step 1 should now work without memory errors!

---

## Need Help?

If you're still seeing memory errors after following all steps:

1. **Share the full Edge Function logs** (everything from `[IMAGE_DOWNSCALE]`)
2. **Confirm your Supabase plan** (Free/Pro/Enterprise)
3. **Share the exact error message**

I can then provide a more specific solution or implement an alternative approach.
