# Langfuse Tracing Restore - Implementation Summary

## Changes Made

### Files Modified (3 files)

#### 1. `supabase/functions/_shared/langfuse-client.ts`

**Lines changed**: ~133, ~144-171, ~171-194, ~238-248, ~307-318

**What was added**:
- Diagnostic logging in `isLangfuseEnabled()` to show configuration status
- New function `testLangfuseConnectivity()` for health checks
- Diagnostic logging in `flushLangfuse()` to show flush operations
- Diagnostic logging in `createTrace()` to show trace creation
- Diagnostic logging in `logGeneration()` to show generation logging

**One-line summary**: Added comprehensive diagnostic logging to trace Langfuse operations and identify why events aren't appearing

---

#### 2. `supabase/functions/run-space-analysis/index.ts`

**Lines changed**: ~718-755

**What was added**:
- Connectivity test at pipeline start
- Diagnostic logging around trace creation
- Enhanced error logging for Langfuse failures

**One-line summary**: Added Step 0 diagnostics to verify Langfuse is being called and show any failures

---

#### 3. `supabase/functions/verify-langfuse-config/index.ts` (NEW FILE)

**What it does**:
- Checks all environment variables
- Tests connectivity to Langfuse
- Returns comprehensive status report
- Lists any configuration issues

**One-line summary**: Dedicated endpoint to verify Langfuse configuration without running a full pipeline

---

### Files Created (1 doc file)

#### 4. `docs/LANGFUSE_DIAGNOSTIC_GUIDE.md`

**What it contains**:
- Complete diagnostic guide
- How to read diagnostic logs
- Environment variable setup
- Testing checklist
- Common issues and solutions
- Cleanup instructions

**One-line summary**: Complete guide for diagnosing and fixing Langfuse tracing issues

---

## What to Do Next

### Immediate Actions

1. **Check current Langfuse configuration**:
   ```bash
   # Test via Supabase CLI
   npx supabase functions invoke verify-langfuse-config
   ```

   **Expected result if working**:
   ```json
   {
     "status": "enabled",
     "issues": []
   }
   ```

2. **If issues are found**, fix environment variables:
   - Go to Supabase Dashboard → Project Settings → Edge Functions → Environment Variables
   - Verify these exist and are correct:
     ```
     LANGFUSE_ENABLED=true
     LANGFUSE_SECRET_KEY=sk-lf-...
     LANGFUSE_PUBLIC_KEY=pk-lf-...
     LANGFUSE_BASE_URL=https://cloud.langfuse.com
     ```
   - After adding/changing, redeploy functions

3. **Run a test pipeline**:
   - Start a new pipeline with a floor plan
   - Go to Supabase Dashboard → Edge Functions → `run-space-analysis` → Logs
   - Look for `[LANGFUSE_DIAGNOSTIC]` entries

4. **Check Langfuse dashboard**:
   - Go to your Langfuse project
   - Look for traces in the last hour
   - Filter by tags: `pipeline`, `re-tour`

### Reading the Diagnostic Logs

#### ✅ Success Pattern (Langfuse working):

```
[LANGFUSE_DIAGNOSTIC] Configuration check: {
  enabled: true,
  secretKeyPresent: true,
  publicKeyPresent: true,
  baseUrl: "https://cloud.langfuse.com",
  finalResult: true
}
[LANGFUSE_DIAGNOSTIC] Connectivity test result: { reachable: true, statusCode: 200 }
[LANGFUSE_DIAGNOSTIC] createTrace() called: ...
[LANGFUSE_DIAGNOSTIC] Trace event queued successfully, pending events: 1
[LANGFUSE_DIAGNOSTIC] flushLangfuse() called, pending events: 2
[LANGFUSE_DIAGNOSTIC] Event types: trace-create, generation-create
[LANGFUSE_DIAGNOSTIC] Ingestion API response status: 200
```

#### ❌ Problem Pattern (Langfuse disabled):

```
[LANGFUSE_DIAGNOSTIC] Configuration check: {
  enabled: false,  // ← ISSUE
  secretKeyPresent: true,
  publicKeyPresent: true,
  finalResult: false
}
[LANGFUSE_DIAGNOSTIC] Langfuse disabled - skipping trace creation
```

**Fix**: Set `LANGFUSE_ENABLED=true` in environment variables

#### ❌ Problem Pattern (Missing credentials):

```
[LANGFUSE_DIAGNOSTIC] Configuration check: {
  enabled: true,
  secretKeyPresent: false,  // ← ISSUE
  publicKeyPresent: true,
  finalResult: false
}
```

**Fix**: Add `LANGFUSE_SECRET_KEY` environment variable

#### ❌ Problem Pattern (Network failure):

```
[LANGFUSE_DIAGNOSTIC] Health check failed: TypeError: error sending request
[LANGFUSE_DIAGNOSTIC] Full error response: { status: 503, ... }
```

**Fix**: Check network connectivity, firewall rules, or Langfuse host availability

---

## Acceptance Tests

### Test A: Verify Configuration

**Command**:
```bash
npx supabase functions invoke verify-langfuse-config
```

**Pass criteria**:
- `status: "enabled"`
- `issues: []`
- `connectivity.reachable: true`

### Test B: Pipeline Creates Trace

**Steps**:
1. Start a new pipeline
2. Check `run-space-analysis` logs within 30 seconds
3. Check Langfuse dashboard within 1 minute

**Pass criteria**:
- Logs show `[LANGFUSE_DIAGNOSTIC] Trace event queued successfully`
- Logs show `[LANGFUSE_DIAGNOSTIC] Ingestion API response status: 200`
- Langfuse dashboard shows new trace with matching pipeline ID
- Trace contains at least one generation (Step 0.2)

### Test C: Disabled Mode Works

**Steps**:
1. Set `LANGFUSE_ENABLED=false` in Supabase environment variables
2. Redeploy: `npx supabase functions deploy run-space-analysis`
3. Run a pipeline

**Pass criteria**:
- Pipeline completes successfully
- Logs show `[LANGFUSE_DIAGNOSTIC] Langfuse disabled - skipping`
- No new traces in Langfuse (expected behavior)

---

## Cleanup After Fix

Once Langfuse is working, remove the diagnostic logs:

### 1. Remove diagnostics from `langfuse-client.ts`:

```typescript
// Delete all console.log lines containing "[LANGFUSE_DIAGNOSTIC]"
// Keep the normal Langfuse logs like "[Langfuse] Flushing X events"
```

### 2. Remove diagnostics from `run-space-analysis/index.ts`:

```typescript
// Delete the connectivity test block (~lines 718-726)
// Delete diagnostic logs around createPipelineRunTrace (~lines 729, 739-743)
```

### 3. Delete verification function:

```bash
rm -rf supabase/functions/verify-langfuse-config
```

### 4. Redeploy:

```bash
npx supabase functions deploy run-space-analysis
```

---

## Most Likely Issues & Quick Fixes

### Issue 1: LANGFUSE_ENABLED not set

**Diagnostic**: `verify-langfuse-config` shows `enabled: false` or `enabled: undefined`

**Fix**:
1. Supabase Dashboard → Project Settings → Edge Functions → Add environment variable
2. Name: `LANGFUSE_ENABLED`, Value: `true` (exactly this string)
3. Redeploy functions

### Issue 2: Missing API keys

**Diagnostic**: `verify-langfuse-config` shows `secretKeyPresent: false` or `publicKeyPresent: false`

**Fix**:
1. Langfuse Dashboard → Settings → API Keys → Create/Copy keys
2. Supabase Dashboard → Add environment variables:
   - `LANGFUSE_SECRET_KEY`: `sk-lf-...`
   - `LANGFUSE_PUBLIC_KEY`: `pk-lf-...`
3. Redeploy functions

### Issue 3: Wrong project or expired keys

**Diagnostic**: Connectivity test fails with 401/403

**Fix**:
1. Verify keys are for the correct Langfuse project
2. Generate new keys if expired
3. Update Supabase environment variables
4. Redeploy

### Issue 4: Traces queued but not visible in UI

**Diagnostic**: Logs show 200 response but no traces in dashboard

**Fix**:
1. Check Langfuse UI date/time filters
2. Verify correct project selected in Langfuse
3. Check trace tags/filters
4. Try searching by pipeline ID directly

---

## Support Information

**Diagnostic logs will show**:
- ✅ Whether Langfuse is enabled
- ✅ Whether credentials are present
- ✅ Whether connectivity test succeeds
- ✅ Whether traces are being created
- ✅ Whether events are being queued
- ✅ Whether flush operations succeed
- ✅ HTTP response status from Langfuse API

**If issues persist**:
1. Share output of `verify-langfuse-config`
2. Share `run-space-analysis` logs showing `[LANGFUSE_DIAGNOSTIC]` entries
3. Screenshot of Langfuse dashboard with filters applied
4. Verify functions are deployed with latest code

---

## Deployment Checklist

- [x] Modified `langfuse-client.ts` with diagnostics
- [x] Modified `run-space-analysis/index.ts` with diagnostics
- [x] Created `verify-langfuse-config` function
- [x] Deployed `run-space-analysis`
- [x] Deployed `verify-langfuse-config`
- [x] Created diagnostic guide documentation
- [ ] Run `verify-langfuse-config` to check status
- [ ] Fix any identified issues
- [ ] Test with a pipeline run
- [ ] Verify traces appear in Langfuse
- [ ] Remove diagnostic logs after confirmation
- [ ] Redeploy clean versions

---

## Timeline

**Phase 1 - Diagnosis** (Current):
- [x] Add diagnostic logging
- [x] Deploy functions
- [ ] Run verification
- [ ] Identify root cause

**Phase 2 - Fix**:
- [ ] Fix environment variables (if needed)
- [ ] Fix connectivity issues (if needed)
- [ ] Verify traces appear

**Phase 3 - Cleanup**:
- [ ] Remove temporary diagnostic logs
- [ ] Delete verification function
- [ ] Redeploy clean versions
- [ ] Update documentation

---

## Key Insights

**Langfuse Integration Design**:
- ✅ Non-blocking: Pipeline continues if Langfuse fails
- ✅ Batched: Events are queued and flushed in batches
- ✅ Serverless-safe: Explicit flush before function returns
- ✅ Configurable: Can be enabled/disabled via environment variable

**Common Gotchas**:
- `LANGFUSE_ENABLED` must be exactly `"true"` (case-sensitive string)
- Environment variables require function redeployment to take effect
- Events are queued but not sent until `flushLangfuse()` is called
- Network failures are logged but don't break the pipeline

**Best Practices**:
- Always check `verify-langfuse-config` first
- Read diagnostic logs from most recent pipeline run
- Test with disabled mode to ensure non-blocking behavior
- Remove diagnostic logs once issue is resolved
