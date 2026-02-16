# Deployment Test Checklist

**Date:** 2026-02-12
**Status:** Edge Functions Deployed ✅ | Frontend Pending ⚠️

---

## ✅ Deployed Components

### Edge Functions (Live on Supabase)
- [x] `create-signed-view-url` - Secure auth + transform fallback
- [x] `start-image-edit-job` - Secure auth + transform fallback + size limits

### Frontend (Needs Build & Deploy)
- [ ] `src/components/tests/TestsTab.tsx` - Job concurrency controls
- [ ] `src/hooks/useStorage.ts` - Client-side logging

---

## Test Plan

### Phase 1: Authentication Security Tests (CRITICAL)

**Test 1.1: Valid Token Test**
- [ ] Log into the app
- [ ] Upload an image to any project
- [ ] Verify the image displays correctly
- [ ] Expected: Image loads successfully with signed URL
- [ ] Check browser console for errors

**Test 1.2: Expired Token Test**
- [ ] Wait for token to expire (or manually invalidate session)
- [ ] Try to view an image
- [ ] Expected: Should get 401 Unauthorized error
- [ ] Should NOT crash the edge function

**Test 1.3: Integration Test**
- [ ] Create a new test job in the Tests tab
- [ ] Upload multiple images
- [ ] Verify all thumbnails load
- [ ] Verify job starts successfully
- [ ] Expected: No auth errors in console

### Phase 2: Transform Fallback Tests

**Test 2.1: Free Tier Transform Test**
- [ ] Upload an image
- [ ] Try to load thumbnail (calls transform API)
- [ ] Expected on free tier: Falls back to original image
- [ ] Expected on Pro tier: Transformed image loads
- [ ] Check edge function logs for fallback warnings

**Test 2.2: Large Image Test**
- [ ] Upload an image >5MB
- [ ] Start an image edit job
- [ ] Expected: Warning logged but doesn't crash
- [ ] Check logs for "Image too large" warning

**Test 2.3: Multiple Image Test**
- [ ] Upload 5 images in Tests tab
- [ ] Add external references
- [ ] Start batch job
- [ ] Expected: All images process without transform errors

### Phase 3: Concurrency Control Tests (After Frontend Deploy)

**Test 3.1: Small Batch Test**
- [ ] Upload 5 images to Tests tab
- [ ] Submit with a change request
- [ ] Monitor browser console
- [ ] Expected: Jobs created in batches of 3
- [ ] Verify all 5 jobs complete successfully

**Test 3.2: Large Batch Test**
- [ ] Upload 15 images
- [ ] Submit batch
- [ ] Monitor job creation timing
- [ ] Expected: Jobs process in waves (3 at a time)
- [ ] All 15 should complete without failures

**Test 3.3: Resource Usage Test**
- [ ] Upload 20 images
- [ ] Submit batch
- [ ] Monitor browser network tab
- [ ] Expected: Max 3 concurrent edge function calls
- [ ] No 429 rate limit errors
- [ ] No database connection errors

---

## Edge Function Logs to Check

### In Supabase Dashboard → Edge Functions → Logs

**Look for these success messages:**
```
[create-signed-view-url] Auth verification succeeded
[create-signed-view-url] Transform not available, falling back to original
[start-image-edit-job] Auth verification succeeded
[start-image-edit-job] Transform failed, falling back to original
[start-image-edit-job] Image too large (X.XXMb), skipping
```

**These are ERRORS (should not appear):**
```
[create-signed-view-url] Missing sub claim in JWT
[create-signed-view-url] Invalid token format
[start-image-edit-job] Unauthorized
Uncaught exception (indicates crash)
```

---

## Expected Behavior Changes

### Before Fixes:
- ❌ Expired tokens accepted (security risk)
- ❌ Transform failures cause silent errors
- ❌ 20 uploads = 20 simultaneous calls (resource exhaustion)
- ❌ No size checks (potential OOM crashes)

### After Fixes:
- ✅ Expired tokens rejected with 401
- ✅ Transform failures fall back gracefully
- ✅ 20 uploads = batched processing (3 at a time)
- ✅ Large images (>5MB) handled safely

---

## Rollback Plan (If Issues Found)

### If Edge Functions Have Issues:
1. Go to Supabase Dashboard → Edge Functions
2. For each function, click "Version History"
3. Click "Restore" on the previous version
4. Report issue to development team

### If Frontend Issues (After Deploy):
1. Revert git commit
2. Rebuild and redeploy
3. Frontend issues won't affect already-deployed edge functions

---

## Next Steps

1. **Immediate:** Test edge functions (Phase 1 & 2)
2. **Then:** Build and deploy frontend
   ```bash
   npm run build
   # Deploy to your hosting platform
   ```
3. **Finally:** Test Phase 3 (concurrency controls)

---

## Success Criteria

✅ **All tests pass when:**
- No authentication errors with valid tokens
- Expired tokens properly rejected
- Images load even on free tier (no transform errors)
- Large images handled without crashes
- Batch uploads don't cause rate limits or connection issues

---

## Notes

- Edge function changes are live immediately
- Frontend changes require rebuild + redeploy
- All changes are backward compatible
- Can roll back individual components if needed
