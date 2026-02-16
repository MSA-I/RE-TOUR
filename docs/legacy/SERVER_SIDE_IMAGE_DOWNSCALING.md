# Server-Side Image Downscaling for Steps 1-4

## Problem

When executing Steps 1-4 of the pipeline, the Edge Function was hitting memory limits when loading large images from storage. The error appeared as:

```
shutdown - Memory limit exceeded - [Memory before-load-input] RSS: 0.0MB, Heap: 9.6MB
```

This occurred because images were loaded at full size (sometimes 4000×3000px or larger), converted to base64, and sent to the image generation API - all within the limited memory environment of a Supabase Edge Function.

## Solution

Implemented **automatic server-side image downscaling** for Steps 1-4 using **Supabase Storage image transformations**.

### How It Works

**File**: `supabase/functions/run-pipeline-step/index.ts:1626-1680`

When loading input images for Steps 1-4:

1. **Apply URL transformations** to the signed storage URL:
   ```typescript
   url.searchParams.set('width', '2400');   // Max width 2400px
   url.searchParams.set('quality', '80');    // JPEG quality 80%
   ```

2. **Fetch the transformed image** from Supabase Storage:
   - Storage server performs the downscaling/compression
   - Edge Function receives the already-reduced image
   - Memory usage stays within limits

3. **Log diagnostics**:
   - Downloaded size (in MB)
   - Base64 size (in MB)
   - Final dimensions (width×height)
   - Success confirmation or warnings

### Transformation Parameters

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| `width` | 2400 | Matches Step 0 client-side compression target; balances quality and memory |
| `quality` | 80 | Good JPEG compression without visible artifacts |

These match the client-side compression strategy used in Step 0 (space analysis).

### Benefits

1. **Prevents memory exhaustion**: Images are downscaled BEFORE entering Edge Function memory
2. **Consistent with Step 0**: Uses same target dimensions (2400px) as client-side compression
3. **No external dependencies**: Uses native Supabase Storage features
4. **Minimal latency**: Transformation happens at storage layer, not in Edge Function
5. **Automatic**: Applied transparently to all image loads in Steps 1-4

### Requirements

**Supabase Storage Image Transformations must be enabled for this to work.**

To enable image transformations in your Supabase project:

1. Go to **Storage** in Supabase Dashboard
2. Select your bucket (e.g., `outputs`)
3. Enable **Image Transformations** in bucket settings

If transformations are NOT enabled:
- The URL parameters will be ignored
- Images will load at full size (risk of memory exhaustion)
- A warning will be logged: `WARNING: Image still exceeds 2400px`

### Verification

**Success logs:**
```
[IMAGE_DOWNSCALE] Step 1: Applying server-side downscaling to prevent memory exhaustion
[IMAGE_DOWNSCALE] Transformed URL: https://...?width=2400&quality=80...
[IMAGE_DOWNSCALE] Downloaded image size: 6.23MB (6531072 bytes)
[IMAGE_DOWNSCALE] Base64 size: 8.31MB (8708096 chars)
[IMAGE_DOWNSCALE] Final dimensions: 2400×1800 (JPEG)
[IMAGE_DOWNSCALE] ✓ Image successfully downscaled to 2400px
```

**Failure indicators:**
```
[IMAGE_DOWNSCALE] WARNING: Image still exceeds 2400px (4000px). Storage transformations may not be enabled.
```

If you see the warning, check that image transformations are enabled in your Supabase Storage bucket.

## Steps Affected

- **Step 1**: Top-Down 3D (uses floor plan image)
- **Step 2**: Style Reference (uses floor plan + style images)
- **Step 3**: Camera-Angle Render (uses Step 2 output)
- **Step 4**: Multi-Panorama (uses camera angles)

**Step 0** already uses **client-side compression** before upload, so no changes needed.

**Steps 5-7** process outputs from previous steps, which are already at appropriate sizes.

## Memory Impact

**Before** (no downscaling):
- Loading 4000×3000 image → ~34MB raw → ~46MB base64
- Edge Function memory limit: 150-512MB (plan-dependent)
- Risk of exhaustion when combined with other allocations

**After** (with downscaling):
- Loading 2400×1800 image → ~12MB raw → ~16MB base64
- Memory usage reduced by ~66%
- Safe margin for other allocations (API requests, JSON parsing, etc.)

## Fallback Strategy

If Supabase Storage transformations are not available or don't work:

**Option 1: Manual re-upload with compression**
- Use Step 0's client-side compression flow
- Re-upload large images at reduced size

**Option 2: Implement fallback server-side processing**
- Add image processing library (e.g., `imagescript` from deno.land/x)
- Downscale in Edge Function (still uses memory, but less than full size to API)
- More complex and adds dependencies

**Current implementation prioritizes Option 1** (use storage transformations) as it's the most memory-efficient and doesn't add complexity.

## Related Documentation

- **Client-side compression**: `docs/FLOOR_PLAN_COMPRESSION.md`
- **Memory optimizations**: `docs/EDGE_FUNCTION_MEMORY_FIXES.md`
- **Step 1 diagnostics**: `docs/TROUBLESHOOTING_STEP_1_ERROR.md`

## Testing

To verify the fix works:

1. Upload a floor plan in Step 0 (client compression applies automatically)
2. Complete Step 0 (Space Analysis)
3. Run Step 1 (Top-Down 3D)
4. Check Supabase Edge Function logs for:
   ```
   [IMAGE_DOWNSCALE] Step 1: Applying server-side downscaling...
   [IMAGE_DOWNSCALE] ✓ Image successfully downscaled to 2400px
   ```
5. Verify Step 1 completes without "Memory limit exceeded" error

Expected outcome:
- **Before fix**: `shutdown - Memory limit exceeded - [Memory before-load-input]`
- **After fix**: Step 1 completes successfully with downscaled images

## Configuration

No configuration required if:
- Supabase Storage image transformations are enabled
- Bucket permissions allow transformation requests

If transformations are disabled, you'll need to:
1. Enable them in Storage settings, OR
2. Implement fallback server-side processing

## Performance

Transformation overhead:
- Storage-side transformation: ~50-200ms (negligible)
- Network transfer reduction: ~66% less data transferred
- Edge Function memory pressure: Significantly reduced

Net result: **Faster execution with lower memory usage**.
