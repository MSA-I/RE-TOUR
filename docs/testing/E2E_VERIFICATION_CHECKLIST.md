# End-to-End Verification Checklist
**Date:** 2026-02-16
**Purpose:** Verify cloud migration success through user flow testing

## Prerequisites
- ✅ Dev server running on http://localhost:8080
- ✅ Cloud database connected (zturojwgqtjrxwsfbwqw)
- ✅ Edge functions deployed and secrets configured
- ✅ Storage buckets configured with RLS

---

## Test Suite

### 1. Auth Flow Test ⏳

**Browser Testing:**
1. Open http://localhost:8080 in browser
2. Open browser DevTools (F12)
3. Navigate to Network tab
4. **Verify:** All requests go to `https://zturojwgqtjrxwsfbwqw.supabase.co` (NOT 127.0.0.1)

**Signup Flow:**
1. Navigate to signup page
2. Create test account: `test-cloud-migration-[timestamp]@example.com`
3. Enter password (min 6 chars)
4. Submit signup
5. **Expected:** Success message, redirected to dashboard
6. **Console check:** No 401/403/500 errors

**Login Flow:**
1. Log out
2. Navigate to login page
3. Enter test credentials
4. Submit login
5. **Expected:** Success, redirected to dashboard
6. **Console check:** No authentication errors

**SQL Verification (Optional):**
```sql
SELECT email, created_at, email_confirmed_at
FROM auth.users
WHERE email LIKE 'test-cloud-migration%'
ORDER BY created_at DESC
LIMIT 5;
```

---

### 2. Project Creation Test ⏳

**Browser Testing:**
1. Ensure logged in
2. Navigate to "New Project" or similar
3. Fill in project details:
   - Name: "Cloud Migration Verification Test"
   - Description: "Testing cloud rollback"
4. Save/create project
5. **Expected:** Project appears in project list
6. **Console check:** No errors in Network tab

**SQL Verification (Optional):**
```sql
SELECT id, name, created_at, owner_id
FROM projects
WHERE name LIKE '%Cloud Migration%'
ORDER BY created_at DESC
LIMIT 5;
```

---

### 3. File Upload Test ⏳

**Browser Testing:**
1. Open the test project created above
2. Navigate to upload section (design references or floor plan)
3. Select a test image file (any JPG/PNG)
4. Upload file
5. **Expected:**
   - Upload progress indicator
   - File appears in UI after upload
   - Thumbnail/preview displays
6. **Console check:**
   - POST request to `create-signed-upload-url` function returns 200
   - PUT request to storage shows upload progress
   - No CORS errors

**Storage Verification:**
```bash
cd /a/RE-TOUR
npx supabase storage ls --linked --experimental ss:///design_refs/ -r
# OR
npx supabase storage ls --linked --experimental ss:///uploads/ -r
```

**Expected:** Shows uploaded file in user's folder (UUID-based path)

---

### 4. Pipeline Creation Test ⏳

**Browser Testing:**
1. In test project, start a new floorplan pipeline
2. Upload floor plan image (if required)
3. Initiate pipeline
4. **Expected:**
   - Pipeline initializes
   - Status shows "pending" or initial phase
   - No blocking errors
5. **Console check:**
   - Edge function calls return 200
   - No 500/503 errors

**SQL Verification (Optional):**
```sql
SELECT id, whole_apartment_phase, current_step, created_at
FROM floorplan_pipelines
WHERE project_id IN (
  SELECT id FROM projects WHERE name LIKE '%Cloud Migration%'
)
ORDER BY created_at DESC
LIMIT 5;
```

---

### 5. Edge Function Integration Test ⏳

**Test via UI:**
1. In pipeline, trigger any automated step that calls edge functions
   - Example: Space detection (calls `run-detect-spaces`)
   - Or: Style analysis (calls `run-style-analysis`)
2. Monitor operation progress
3. **Expected:**
   - Operation completes without errors
   - Results display in UI
   - Status updates correctly

**Test via Curl:**
```bash
# Test help chatbot (already tested during Phase D)
curl -X POST https://zturojwgqtjrxwsfbwqw.supabase.co/functions/v1/help-chatbot \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp0dXJvandncXRqcnh3c2Zid3F3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyOTQ0MTksImV4cCI6MjA4NTg3MDQxOX0.T-dqpO9_cGmrpN5XrizSWvXO7G92Rw3VcVCpOGEbosU" \
  -H "Content-Type: application/json" \
  -d '{"message": "How do I upload files?"}'

# Test create-signed-upload-url (requires auth token)
# Get token from browser DevTools: Application → Local Storage → supabase.auth.token
```

**Supabase Dashboard Logs:**
1. Go to https://supabase.com/dashboard/project/zturojwgqtjrxwsfbwqw/functions
2. Click on "Logs" tab
3. **Expected:**
   - Recent function invocations visible
   - Status codes are 200 (not 500)
   - Execution times reasonable (<30s)

---

### 6. QA System Verification ⏳

**SQL Check:**
```sql
-- Verify QA rules exist
SELECT COUNT(*) as qa_rules_count FROM qa_policy_rules;

-- Verify learning tables exist
SELECT COUNT(*) as escalation_logs FROM constraint_escalation_log;

-- Verify QA judge results table
SELECT COUNT(*) as judge_results FROM qa_judge_results;
```

**Expected:**
- `qa_rules_count` > 0 (baseline rules should exist)
- Queries execute without errors (tables exist)

---

## Browser Console Checks

### What to Look For

**✅ Good Signs:**
- Supabase client initializes: `SupabaseClient { supabaseUrl: 'https://zturojwgqtjrxwsfbwqw.supabase.co', ... }`
- No "Invalid JWT" errors
- No 401/403 errors (authentication working)
- No CORS errors
- Network requests go to cloud URL (not localhost:54321)

**❌ Bad Signs:**
- "Invalid JWT" → Auth token mismatch (logout/login to fix)
- 401 errors → Anon key incorrect or RLS policies too strict
- 403 Forbidden → RLS policies blocking legitimate access
- 500 Internal Server Error → Edge function crashes or DB errors
- CORS errors → Missing CORS headers in edge functions
- Requests to 127.0.0.1 → Frontend still pointing to local Supabase

---

## Network Tab Analysis

### Expected Request Patterns

**Auth Requests:**
```
POST https://zturojwgqtjrxwsfbwqw.supabase.co/auth/v1/signup → 200
POST https://zturojwgqtjrxwsfbwqw.supabase.co/auth/v1/token?grant_type=password → 200
```

**Database Requests (PostgREST):**
```
GET https://zturojwgqtjrxwsfbwqw.supabase.co/rest/v1/projects → 200
POST https://zturojwgqtjrxwsfbwqw.supabase.co/rest/v1/projects → 201
```

**Storage Requests:**
```
POST https://zturojwgqtjrxwsfbwqw.supabase.co/functions/v1/create-signed-upload-url → 200
PUT https://zturojwgqtjrxwsfbwqw.supabase.co/storage/v1/object/design_refs/... → 200
```

**Edge Function Requests:**
```
POST https://zturojwgqtjrxwsfbwqw.supabase.co/functions/v1/run-detect-spaces → 200
POST https://zturojwgqtjrxwsfbwqw.supabase.co/functions/v1/run-space-analysis → 200
```

---

## Success Criteria

Migration is **SUCCESSFUL** when:

- [ ] Browser DevTools shows all requests to cloud URL (no local requests)
- [ ] Auth signup/login works end-to-end
- [ ] Projects can be created and listed
- [ ] Files can be uploaded to storage
- [ ] Pipelines can be initialized
- [ ] At least one edge function call succeeds from UI
- [ ] No blocking 401/500 errors in console
- [ ] No CORS errors
- [ ] Happy Path: User can sign up → create project → upload file → start pipeline

---

## Troubleshooting

### Issue: Browser still making requests to 127.0.0.1

**Fix:**
1. Verify `.env.local` is disabled (renamed to `.env.local.DISABLED`)
2. Hard refresh browser (Ctrl+Shift+R or Cmd+Shift+R)
3. Clear browser cache for localhost:8080
4. Restart dev server

### Issue: "Invalid JWT" errors

**Fix:**
1. Log out of application
2. Clear browser localStorage: DevTools → Application → Local Storage → Clear
3. Clear sessionStorage
4. Log in again (fresh token will be issued)

### Issue: 401 Unauthorized on database queries

**Fix:**
1. Verify RLS policies allow authenticated users to access their own data
2. Check that user is actually logged in (token in localStorage)
3. Verify anon key matches cloud project

### Issue: 500 errors from edge functions

**Fix:**
1. Check Supabase Dashboard → Edge Functions → Logs
2. Look for error messages in function logs
3. Common causes:
   - Missing `API_NANOBANANA` secret (verify with `npx supabase secrets list`)
   - Syntax errors in function code
   - Missing dependencies in import map

### Issue: CORS errors

**Fix:**
1. Verify edge functions have CORS headers in responses
2. Check `_shared/cors.ts` is being imported
3. Ensure OPTIONS requests are handled

---

## Manual Testing Completion

After completing all tests, update this checklist with results and any issues encountered.

**Tested by:** _____________
**Date:** _____________
**Result:** ⏳ PENDING / ✅ PASSED / ❌ FAILED

**Notes:**
