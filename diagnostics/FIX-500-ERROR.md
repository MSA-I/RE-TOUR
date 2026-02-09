# Fixing the 500 Error - Step by Step

## Current Issue

**Error**: `Edge Function returned a non-2xx status code` (500)
**Function**: `run-space-analysis`
**Location**: After deployment of transformation fix

## Possible Causes

1. **Syntax error in deployed code** (typo, bracket mismatch)
2. **Runtime error** (missing environment variable, API error)
3. **Deployment didn't complete** (old code still running)
4. **Error in new transformation code** (fetch fail, signed URL issue)

## IMMEDIATE ACTION: Check Supabase Logs

### Step 1: Open Supabase Dashboard Logs

Go to: [Supabase Functions Logs](https://supabase.com/dashboard/project/zturojwgqtjrxwsfbwqw/functions/run-space-analysis/logs)

**Filter by**:
- Time: Last 5 minutes
- Level: Error

### Step 2: Look for These Patterns

**Pattern A - Syntax Error** (code issue):
```
SyntaxError: Unexpected token '}' at line 290
ReferenceError: VERSION is not defined
TypeError: Cannot read property 'signedUrl' of undefined
```
→ **Fix**: Code syntax issue, need to correct

**Pattern B - Transformation Error** (Supabase Storage issue):
```
Failed to create signed URL for design reference
Failed to fetch design reference: 403 Forbidden
Image transformations may not be enabled
```
→ **Fix**: Enable image transformations in Storage Settings

**Pattern C - Missing Environment Variable**:
```
Uncaught TypeError: Cannot read properties of undefined (reading 'SUPABASE_URL')
```
→ **Fix**: Environment variables not set

**Pattern D - Request/Body Parsing Error**:
```
req.json() is not a function
Cannot read pipeline_id from undefined
```
→ **Fix**: Request format issue

### Step 3: Copy Error and Share

Copy the FULL error message from the logs and share it with me. I'll provide a specific fix.

## Quick Fixes Based on Common Issues

### Fix 1: If logs show "Cannot read req.json() twice"

**Problem**: Reading request body multiple times in error handler

**Solution**: This is likely in the error handling code. Let me check if there's an issue...

### Fix 2: If logs show transformation errors

**Problem**: Supabase Storage transformations not enabled

**Solution**:
1. Go to: [Storage Settings](https://supabase.com/dashboard/project/zturojwgqtjrxwsfbwqw/storage/settings)
2. Enable "Image Transformations"
3. Wait 2-3 minutes
4. Retry

### Fix 3: If deployment seems stale

**Problem**: New code didn't deploy

**Solution**:
```bash
cd A:\RE-TOUR

# Force redeploy
npx supabase functions delete run-space-analysis
npx supabase functions deploy run-space-analysis --no-verify-jwt
```

### Fix 4: If logs show req.json() error in catch block

**Problem**: The error handler tries to parse the request body again

**Issue location**: Around line 914 in the catch block
```typescript
const { pipeline_id } = await req.json().catch(() => ({}));
```

**This won't work because**:
- Body already consumed earlier in the request
- Can't call req.json() twice

**Solution**: Store pipeline_id earlier or handle differently

## Temporary Rollback (If needed)

If you need to rollback immediately while we debug:

```bash
cd A:\RE-TOUR

# Rollback to previous version
git checkout HEAD~1 supabase/functions/run-space-analysis/index.ts

# Redeploy old version
npx supabase functions deploy run-space-analysis --no-verify-jwt
```

This will restore the function to the working state before my changes.

## Most Likely Issue

Based on the code review, I suspect the issue is in the **error handling block** around line 914:

```typescript
const { pipeline_id } = await req.json().catch(() => ({}));
```

This line tries to parse the request body AGAIN after it was already consumed at line 445. This will throw an error in Deno/Edge Functions.

### The Fix

I'll create a patch that stores the pipeline_id early and reuses it in the error handler.

## Next Steps

1. **Check logs** - Go to Supabase Dashboard and copy the full error
2. **Share error** - Paste the error message so I can provide exact fix
3. **If urgent** - Use rollback command above to restore working state

While you're checking the logs, let me prepare a fix for the most likely issue...
