# Troubleshooting "Empty response from model" Error

## Error Message

```
[SPACE_ANALYSIS_START] Error: Error: Empty response from model
```

## Root Causes

This error occurs when the Gemini API returns an empty response. Possible causes:

1. **Corrupted image after compression**
2. **Safety filter blocking the request**
3. **Invalid base64 encoding**
4. **Image format issues**
5. **API rate limiting or quota exceeded**
6. **Prompt issues triggering content filters**

---

## Diagnostic Steps

### Step 1: Check Edge Function Logs

Open Supabase Dashboard → Edge Functions → `run-space-analysis` → Logs

Look for these diagnostic messages:

#### ✅ Normal Execution

```
[run-space-analysis] Starting Gemini API call...
[run-space-analysis] Prompt length: 2847 chars
[run-space-analysis] Image base64 length: 11351 KB
[run-space-analysis] Base64 sample: /9j/4AAQSkZJRgABAQAAAQABAAD...
[run-space-analysis] Request payload size: 11.12 MB
[run-space-analysis] Gemini response received: 200
[run-space-analysis] Gemini response structure: {
  "hasCandidates": true,
  "candidatesLength": 1,
  "hasContent": true,
  "hasParts": true,
  "partsLength": 1,
  "finishReason": "STOP"
}
[run-space-analysis] Response length: 45231
[run-space-analysis] Finish reason: STOP
```

#### ❌ Empty Response (Current Issue)

```
[run-space-analysis] Gemini response structure: {
  "hasCandidates": true/false,
  "candidatesLength": 0 or 1,
  "hasContent": false,
  "finishReason": "SAFETY" or "RECITATION" or "OTHER"
}
[run-space-analysis] CRITICAL: Gemini returned empty content
```

### Step 2: Identify the Blocking Reason

Check the `finishReason` in the logs:

| finishReason | Cause | Solution |
|--------------|-------|----------|
| `STOP` | Normal completion | ✅ No issue |
| `MAX_TOKENS` | Response too long | Handled by repair logic |
| `SAFETY` | Safety filter triggered | Image contains restricted content |
| `RECITATION` | Content matches training data | Modify prompt or image |
| `OTHER` | Unknown error | Check API quota/rate limits |

### Step 3: Check for Safety Filter Blocks

If you see:
```
[run-space-analysis] Prompt blocked by safety filter: {...}
```

The Gemini API blocked the request due to:
- Image contains people, faces, or sensitive content
- Image quality is too low (triggering safety heuristics)
- Prompt contains flagged keywords

**Solution**: Use a different floor plan image without people or sensitive content.

### Step 4: Test Without Compression

The issue might be caused by image compression corrupting the file.

**Bypass compression:**

1. Open browser console (F12)
2. Run:
   ```javascript
   localStorage.setItem("skipCompression", "true");
   ```
3. Reload the page
4. Upload the floor plan again
5. Check if the error persists

**Re-enable compression:**
```javascript
localStorage.removeItem("skipCompression");
```

If the error goes away without compression, the issue is in the compression logic.

### Step 5: Verify Image Validity

Check browser console for compression logs:

#### ✅ Successful Compression

```javascript
[ImageCompress] Original: 3840x2560, 18.45MB
[ImageCompress] Target dimensions: 2400x1600
[ImageCompress] Attempt 1: quality=0.80
[ImageCompress] Result: 9.20MB
[ImageCompress] Attempt 2: quality=0.70
[ImageCompress] Result: 7.82MB
[ImageCompress] ✓ Target reached at quality=0.70
[ImageCompress] Validation: Compressed image loads successfully (2400x1600)
[FloorPlanUpload] Compressed modern_apartment.png: {...}
```

#### ❌ Compression Failure

```javascript
[ImageCompress] Compressed image failed validation: Image dimensions are invalid
```

**Solution**: Try a different image or report the specific image causing issues.

### Step 6: Check Base64 Encoding

In Edge Function logs, look for:

```
[run-space-analysis] Base64 sample: /9j/4AAQSkZJRgABAQAAAQABAAD...
```

Valid JPEG base64 starts with `/9j/`. If you see something different:

- `/9j/` = JPEG ✅
- `iVBORw0KGgo` = PNG (should be converted)
- `UklGR` = WebP (should be converted)
- Random characters = Corrupted

If corrupted, the issue is in base64 encoding.

### Step 7: Verify API Key and Quota

Check if you're hitting API rate limits:

1. Go to Google AI Studio
2. Check API usage dashboard
3. Verify quota hasn't been exceeded

If rate limited, wait or upgrade API quota.

---

## Solutions

### Solution 1: Use Original Image Without Compression

1. Set `skipCompression` flag (see Step 4)
2. Upload a smaller floor plan (< 8 MB)
3. Proceed with analysis

### Solution 2: Try Different Image Format

If the floor plan is in an unusual format:

1. Open in image editor (GIMP, Photoshop, etc.)
2. Export as JPEG, quality 80-90%
3. Ensure image is < 10 MB
4. Re-upload

### Solution 3: Manual Resize

If image is very large (> 30 MB):

1. Open in image editor
2. Resize to max 2400px on longest side
3. Save as JPEG, quality 80%
4. Re-upload

### Solution 4: Check for Restricted Content

If safety filters are triggering:

1. Review image for:
   - People, faces, or personal info
   - Copyrighted logos or brands
   - Low-quality scans or blurry images
2. Use a clean architectural floor plan drawing
3. Remove any photos or renderings

### Solution 5: Reduce Compression Quality

If compression is causing corruption:

**Edit**: `src/pages/ProjectDetail.tsx:223`

```typescript
const compressionResult = await compressFloorPlanImage(file, {
  maxFileSizeMB: 10,
  targetFileSizeMB: 8,
  maxDimension: 2400,
  initialQuality: 0.9,  // Increase from 0.8
  minQuality: 0.7,      // Increase from 0.6
  outputFormat: "jpeg",
});
```

Higher quality = less compression = less risk of corruption.

---

## Advanced Diagnostics

### Check Full Gemini Response

In Edge Function logs, look for:

```
[run-space-analysis] Full response: {
  "candidates": [...],
  "promptFeedback": {
    "blockReason": "SAFETY",
    "safetyRatings": [...]
  }
}
```

This shows exactly why Gemini blocked the request.

### Test with Simple Image

Create a minimal test:

1. Draw a simple floor plan in MS Paint
2. Save as JPEG, 800x600px, < 1 MB
3. Upload and test

If this works, the issue is with the specific floor plan image.

### Check Network Tab

1. Open DevTools → Network
2. Upload floor plan
3. Find the `run-space-analysis` request
4. Check:
   - Request payload size
   - Response status
   - Response body

If response is 200 but body is empty, Gemini returned nothing.

---

## Reporting the Issue

If none of the above solutions work, report the issue with:

1. **Edge Function logs** (full output from run-space-analysis)
2. **Browser console logs** (compression output)
3. **Floor plan characteristics**:
   - Original size (MB)
   - Dimensions (width x height)
   - Format (JPEG, PNG, etc.)
   - Source (CAD export, photo, scan)
4. **skipCompression test result**: Does it work without compression?

---

## Quick Fixes Summary

| Issue | Quick Fix |
|-------|-----------|
| Compression corrupting image | `localStorage.setItem("skipCompression", "true")` |
| Image too large | Resize to 2400px, < 10 MB before upload |
| Safety filter blocking | Use clean architectural floor plan without people |
| API quota exceeded | Wait or upgrade API quota |
| Base64 corruption | Try different image format (PNG → JPEG) |

---

## Files Modified (For Reference)

Enhanced error diagnostics were added to:

1. **`supabase/functions/run-space-analysis/index.ts`**
   - Lines 571-600: Detailed Gemini response logging
   - Lines 447-452: Base64 validation
   - Lines 545-562: Request payload validation

2. **`src/lib/image-compression.ts`**
   - Lines 273-297: Compressed image validation

3. **`src/pages/ProjectDetail.tsx`**
   - Lines 220-258: Debug mode bypass option

These additions provide comprehensive diagnostics to identify exactly where the failure occurs.
