# Step 0 Fix for Supabase Free Tier (No Transformations)

**Version**: 2.3.0-no-transform-fallback
**Date**: 2026-02-09
**For**: Users on Supabase Free Tier WITHOUT Image Transformations

---

## What Changed

This version works **without** Supabase Image Transformations (which require a paid subscription).

### Key Differences from 2.2.0

1. **✅ Graceful Fallback**: Tries transformations first, falls back to raw download if unavailable
2. **✅ Stricter Size Limits**: Max 10 MB for uploads (instead of 50 MB)
3. **✅ Download Validation**: Validates actual downloaded size, not just upload size
4. **✅ Clear Logging**: Shows whether transformations worked or raw download was used
5. **✅ Same Stability Fixes**: All improvements from 2.2.0 (Langfuse non-blocking, state validation, etc.)

### Why Smaller Size Limit?

Without transformations, we download the **full original image**. To prevent memory issues:
- **Old limit**: 50 MB (assumed transformations would compress)
- **New limit**: 10 MB (raw images must be smaller)

---

## How It Works

### Two-Path Strategy

```
┌─────────────────────────────────────┐
│  Try Transformations First          │
│  (works on paid plans)              │
└──────────┬──────────────────────────┘
           │
           ├─ ✅ Works? Use transformed image (3-5 MB)
           │
           └─ ❌ Fails? Fall back to raw download
                        │
                        └─ Validate size < 10 MB
                        └─ Download and process
```

### Transformation Detection

The code detects if transformations worked by checking:
1. Response status (200 OK)
2. Downloaded size vs original size
3. If downloaded size < 90% of original → transformations worked
4. Otherwise → use raw download

---

## Deployment

### Step 1: Deploy Function

```bash
cd A:\RE-TOUR
npx supabase functions deploy run-space-analysis --no-verify-jwt
```

### Step 2: Verify Version

Check logs for:
```
[SPACE_ANALYSIS] VERSION: 2.3.0-no-transform-fallback
```

### Step 3: Prepare Your Images

**CRITICAL**: You MUST compress images before uploading.

#### Recommended Tools

**Online (Free)**:
- [TinyPNG](https://tinypng.com/) - Best for PNG
- [Squoosh](https://squoosh.app/) - Google's image compressor
- [CompressJPEG](https://compressjpeg.com/) - Best for JPEG

**Settings to Use**:
- **Format**: JPEG (smaller than PNG)
- **Quality**: 70-80%
- **Max Dimension**: 2048px
- **Target Size**: Under 5 MB (lower is better)

#### Example: Photoshop/GIMP

```
1. Open image
2. Image → Scale → Max dimension 2048px
3. Export as JPEG
4. Quality: 75%
5. Check file size < 5 MB
```

### Step 4: Test

1. Upload compressed floor plan (< 5 MB recommended)
2. Trigger Step 0
3. Check logs

---

## Success Indicators

### In Logs (Transformations Available - Paid Plan)

```
[fetchImageAsBase64] Attempting to use transformations...
[fetchImageAsBase64] ✅ Transformations WORKED - Size: 3.45 MB (reduced from 8.50 MB)
[fetchImageAsBase64] ✅ SUCCESS - Method: TRANSFORMED
```

### In Logs (Free Tier - No Transformations)

```
[fetchImageAsBase64] Attempting to use transformations...
[fetchImageAsBase64] ⚠️ Transformations FAILED - Size unchanged
[fetchImageAsBase64] Falling back to raw download...
[fetchImageAsBase64] Using raw download (no transformations available)
[fetchImageAsBase64] Raw download size: 4.82 MB
[fetchImageAsBase64] ✅ SUCCESS - Method: RAW
```

**Key indicator**: You'll see `Method: RAW` at the end.

### Expected Behavior

✅ **With transformations** (paid plan):
- Original: 20 MB → Downloaded: 4 MB → Success

✅ **Without transformations** (free tier):
- Original: 4 MB → Downloaded: 4 MB → Success
- Original: 15 MB → **FAILS** with clear error

---

## Error Messages & Fixes

### Error: "Floor plan file is too large (X.XX MB). Maximum allowed: 10 MB"

**Cause**: Your image is too large for free tier
**Fix**: Compress the image before uploading
- Use TinyPNG or Squoosh
- Target: < 5 MB
- Format: JPEG at 70-80% quality

### Error: "Downloaded image too large: X.XX MB"

**Cause**: Download exceeded memory limit
**Fix**: Same as above - compress more aggressively

### Still Getting 500 Errors

**Check these:**

1. **Is new version deployed?**
   ```bash
   npx supabase functions logs run-space-analysis --limit 5
   ```
   Look for `VERSION: 2.3.0-no-transform-fallback`

2. **Is image too large?**
   Run this SQL:
   ```sql
   SELECT
     original_filename,
     ROUND(size_bytes / 1024.0 / 1024.0, 2) as size_mb
   FROM uploads
   WHERE id = (
     SELECT floor_plan_upload_id
     FROM floorplan_pipelines
     ORDER BY created_at DESC
     LIMIT 1
   );
   ```
   If `size_mb > 10` → Compress the image

3. **Check actual error in logs:**
   ```bash
   npx supabase functions logs run-space-analysis --follow
   ```
   Then trigger Step 0 and see the real error

---

## Langfuse Traces Missing?

If you're not seeing Langfuse traces, check:

### 1. Langfuse Configuration

```bash
# Check if Langfuse is enabled
npx supabase secrets list
```

Look for:
- `LANGFUSE_ENABLED=true`
- `LANGFUSE_SECRET_KEY`
- `LANGFUSE_PUBLIC_KEY`
- `LANGFUSE_BASE_URL`

### 2. Langfuse is Non-Blocking

The new version makes Langfuse **non-blocking**. Even if Langfuse fails, Step 0 will complete.

**In logs you'll see:**
```
[safeFlushLangfuse] WARN: Langfuse flush failed
[safeFlushLangfuse] Pipeline will continue despite Langfuse error
```

This is **OK** - the pipeline still works.

### 3. Enable Debug Logging

If Langfuse is configured but traces aren't appearing:

1. Check Langfuse dashboard: https://cloud.langfuse.com
2. Verify project is selected
3. Look in "Traces" tab for recent traces
4. Check if trace ID matches pipeline ID

### 4. Langfuse Might Be Disabled

If you see:
```
[Langfuse] Disabled, skipping trace creation
```

Then `LANGFUSE_ENABLED` is not set to `"true"`. Set it:

```bash
npx supabase secrets set LANGFUSE_ENABLED=true
```

---

## Performance Considerations

### Free Tier Constraints

Without transformations:
- **Input images**: Must be < 10 MB
- **Memory usage**: Higher (full image in memory)
- **Latency**: Similar (no transformation overhead)
- **Token limit**: 8K (conservative for memory)

### Recommendations

1. **Always compress images**
   - Even if under 10 MB, smaller is better
   - Target: 3-5 MB for optimal performance

2. **Use JPEG instead of PNG**
   - JPEG is 50-70% smaller
   - Quality: 70-80% is sufficient for floor plans

3. **Limit floor plan complexity**
   - Very detailed plans may hit token limits
   - If you see truncation warnings, reduce maxOutputTokens to 4096

---

## Upgrading to Paid Plan

If you upgrade to a Supabase paid plan with Image Transformations:

1. **Enable transformations** in Supabase Dashboard → Storage → Settings
2. **No code changes needed** - the function will automatically use transformations
3. **Higher limits** will apply (50 MB uploads, 16K tokens)
4. **Better performance** - images compressed server-side

The same deployed function works for both free and paid tiers!

---

## Size Limits Summary

| Scenario | Max Upload | Max Download | Method | Performance |
|----------|-----------|--------------|---------|-------------|
| **Free Tier** | 10 MB | 10 MB | Raw | Good if images compressed |
| **Paid + Transform** | 50 MB | 15 MB | Transformed | Excellent |
| **Paid - No Transform** | 10 MB | 10 MB | Raw | Same as free |

---

## Troubleshooting Checklist

Before asking for help, verify:

- [ ] Function version is `2.3.0-no-transform-fallback`
- [ ] Floor plan image is < 10 MB
- [ ] Image is compressed (JPEG 70-80% quality)
- [ ] Checked Edge Function logs for actual error
- [ ] Verified upload exists in database
- [ ] Tried with a very small image (1-2 MB) as test

If all above checked and still failing:
1. Copy full error from `npx supabase functions logs run-space-analysis`
2. Run `diagnostics/diagnose-500-error.sql`
3. Share both outputs

---

## Example: Preparing a Floor Plan

```bash
# Original file: floor_plan.png (25 MB)

# Option 1: Online tool
1. Go to https://squoosh.app/
2. Upload floor_plan.png
3. Choose "MozJPEG" codec
4. Set quality to 75
5. Download (should be 3-5 MB)

# Option 2: Command line (ImageMagick)
magick floor_plan.png -resize 2048x2048 -quality 75 floor_plan_compressed.jpg

# Result: floor_plan_compressed.jpg (4.2 MB) ✅
```

---

## Summary

✅ **Works on free tier** - No transformations required
✅ **Strict size limits** - Max 10 MB to prevent memory issues
✅ **Graceful fallback** - Uses transformations if available
✅ **Clear logging** - Shows which method was used
✅ **Non-blocking Langfuse** - Pipeline works even if Langfuse fails
✅ **Same stability** - All improvements from 2.2.0 included

**Key takeaway**: Compress your images before uploading. Target 3-5 MB for best results.

---

**Next Steps:**
1. Deploy the function
2. Compress your floor plan images
3. Upload and test
4. Check logs to confirm `Method: RAW` or `Method: TRANSFORMED`
5. Monitor for 24 hours

If issues persist after following this guide, share:
- Function logs
- Image file size
- Database query results from `diagnose-500-error.sql`
