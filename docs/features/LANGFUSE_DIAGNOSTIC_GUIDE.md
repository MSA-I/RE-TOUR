# Langfuse Tracing Diagnostic Guide

## Summary of Changes

I've added comprehensive diagnostic logging to identify why Langfuse traces aren't appearing. All changes are **temporary** and **non-blocking** - the pipeline will continue to work regardless of Langfuse status.

## Files Modified

### 1. `supabase/functions/_shared/langfuse-client.ts`

**Changes**:
- Added diagnostic logging to `isLangfuseEnabled()` (line ~133)
- Added diagnostic logging to `flushLangfuse()` (line ~171)
- Added diagnostic logging to `createTrace()` (line ~238)
- Added diagnostic logging to `logGeneration()` (line ~307)
- Added `testLangfuseConnectivity()` function for health checks (line ~144)

**What it logs**:
```typescript
[LANGFUSE_DIAGNOSTIC] Configuration check: {
  enabled: true/false,
  secretKeyPresent: true/false,
  publicKeyPresent: true/false,
  baseUrl: "https://cloud.langfuse.com",
  finalResult: true/false
}

[LANGFUSE_DIAGNOSTIC] flushLangfuse() called, pending events: 2
[LANGFUSE_DIAGNOSTIC] Event types: trace-create, generation-create
[LANGFUSE_DIAGNOSTIC] Ingestion API response status: 200

[LANGFUSE_DIAGNOSTIC] createTrace() called: {
  name: "re-tour-pipeline-run",
  hasMetadata: true,
  tags: ["pipeline", "re-tour"]
}

[LANGFUSE_DIAGNOSTIC] Trace event queued successfully, pending events: 1
```

### 2. `supabase/functions/run-space-analysis/index.ts`

**Changes**:
- Added connectivity test at pipeline start (line ~718)
- Added diagnostic logging around trace creation (line ~727)

**What it logs**:
```typescript
[LANGFUSE_DIAGNOSTIC] Step 0 starting - testing Langfuse connectivity
[LANGFUSE_DIAGNOSTIC] Connectivity test result: {
  reachable: true,
  statusCode: 200
}

[LANGFUSE_DIAGNOSTIC] About to call createPipelineRunTrace
[LANGFUSE_DIAGNOSTIC] createPipelineRunTrace returned: {
  success: true,
  traceId: "pipeline-uuid"
}
```

### 3. `supabase/functions/verify-langfuse-config/index.ts` (NEW)

**Purpose**: Dedicated endpoint to verify Langfuse configuration and connectivity.

**What it returns**:
```json
{
  "timestamp": "2025-02-09T...",
  "configuration": {
    "LANGFUSE_ENABLED": "true",
    "secretKeyPresent": true,
    "publicKeyPresent": true,
    "baseUrl": "https://cloud.langfuse.com",
    "isLangfuseEnabled": true
  },
  "connectivity": {
    "reachable": true,
    "statusCode": 200
  },
  "status": "enabled",
  "issues": []
}
```

## How to Diagnose

### Step 1: Verify Environment Variables

Run the verification function:

```bash
# Via Supabase CLI
npx supabase functions invoke verify-langfuse-config

# Or via HTTP (if you have access token)
curl -X POST https://[your-project].supabase.co/functions/v1/verify-langfuse-config \
  -H "Authorization: Bearer [anon-key]"
```

**Expected output** (if working):
```json
{
  "configuration": {
    "LANGFUSE_ENABLED": "true",
    "secretKeyPresent": true,
    "publicKeyPresent": true,
    "baseUrl": "https://cloud.langfuse.com",
    "isLangfuseEnabled": true
  },
  "connectivity": {
    "reachable": true,
    "statusCode": 200
  },
  "status": "enabled",
  "issues": []
}
```

**Common Issues**:

| Issue | Cause | Fix |
|-------|-------|-----|
| `LANGFUSE_ENABLED: "false"` or missing | Env var not set or wrong value | Set to exactly `"true"` in Supabase Dashboard → Edge Functions → Environment Variables |
| `secretKeyPresent: false` | Secret key missing | Add `LANGFUSE_SECRET_KEY` env var |
| `publicKeyPresent: false` | Public key missing | Add `LANGFUSE_PUBLIC_KEY` env var |
| `reachable: false` | Network/firewall issue | Check if Edge Functions can reach Langfuse host |

### Step 2: Check Edge Function Logs

1. Go to Supabase Dashboard → Edge Functions
2. Click on `run-space-analysis`
3. View the logs for recent executions
4. Look for `[LANGFUSE_DIAGNOSTIC]` entries

**What to look for**:

```
✅ GOOD - Langfuse is working:
[LANGFUSE_DIAGNOSTIC] Configuration check: { enabled: true, secretKeyPresent: true, publicKeyPresent: true, ... finalResult: true }
[LANGFUSE_DIAGNOSTIC] createTrace() called: ...
[LANGFUSE_DIAGNOSTIC] Trace event queued successfully, pending events: 1
[LANGFUSE_DIAGNOSTIC] flushLangfuse() called, pending events: 2
[LANGFUSE_DIAGNOSTIC] Event types: trace-create, generation-create
[LANGFUSE_DIAGNOSTIC] Ingestion API response status: 200

❌ BAD - Langfuse is disabled:
[LANGFUSE_DIAGNOSTIC] Configuration check: { enabled: false, ... finalResult: false }
[LANGFUSE_DIAGNOSTIC] Langfuse disabled - skipping trace creation

❌ BAD - Credentials missing:
[LANGFUSE_DIAGNOSTIC] Configuration check: { enabled: true, secretKeyPresent: false, ... finalResult: false }

❌ BAD - Network issue:
[LANGFUSE_DIAGNOSTIC] Health check failed: Error: ...
[LANGFUSE_DIAGNOSTIC] Full error response: { status: 401, ... }
```

### Step 3: Run a Test Pipeline

1. Upload a floor plan and start a new pipeline
2. Check the logs for `run-space-analysis` function
3. Look for the diagnostic output

**If Langfuse is enabled and working**, you should see:
- Configuration check showing all true
- Trace creation logged
- Generation events queued
- Flush operation completed with 200 status

**If traces still don't appear in Langfuse UI**:
- Check that events are being flushed (look for "Flushing X events" log)
- Verify the response status is 200
- Check Langfuse dashboard filters (date range, project selection)
- Verify the trace ID matches the pipeline ID

### Step 4: Check Langfuse Dashboard

1. Go to your Langfuse dashboard
2. Navigate to Traces view
3. Filter by:
   - Date range: Today
   - Tags: `pipeline`, `re-tour`
   - Name: `re-tour-pipeline-run`

**If you see traces**:
- ✅ Success! Tracing is working
- Check that generations appear under the trace
- Verify metadata is present

**If you don't see traces**:
- Check the logs from Step 2 for errors
- Verify credentials are correct in Langfuse UI (Settings → API Keys)
- Check that your Langfuse project is active

## Environment Variable Setup (Supabase)

### Required Variables

Set these in: **Supabase Dashboard → Project Settings → Edge Functions → Add environment variable**

```
LANGFUSE_ENABLED=true
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_BASE_URL=https://cloud.langfuse.com
```

**Important**:
- `LANGFUSE_ENABLED` must be exactly the string `"true"` (case-sensitive)
- Get keys from Langfuse Dashboard → Settings → API Keys
- After adding/changing env vars, **redeploy functions** for changes to take effect

### Redeploy After Env Changes

```bash
# Redeploy all functions that use Langfuse
cd A:\RE-TOUR
npx supabase functions deploy run-space-analysis
npx supabase functions deploy run-pipeline-step
npx supabase functions deploy run-qa-check
# ... etc
```

## Testing Checklist

- [ ] Run `verify-langfuse-config` and confirm `status: "enabled"`, `issues: []`
- [ ] Start a new pipeline and check `run-space-analysis` logs
- [ ] Confirm `[LANGFUSE_DIAGNOSTIC] Configuration check: { ... finalResult: true }`
- [ ] Confirm `[LANGFUSE_DIAGNOSTIC] Trace event queued successfully`
- [ ] Confirm `[LANGFUSE_DIAGNOSTIC] Ingestion API response status: 200`
- [ ] Check Langfuse dashboard for new trace with matching pipeline ID
- [ ] Verify generations appear under the trace
- [ ] Test with `LANGFUSE_ENABLED=false` to confirm pipeline still works

## Removing Diagnostic Logs

Once you've identified and fixed the issue, remove the temporary diagnostic logs:

### 1. Remove from `langfuse-client.ts`:

```typescript
// REMOVE all lines containing "[LANGFUSE_DIAGNOSTIC]"
```

### 2. Remove from `run-space-analysis/index.ts`:

```typescript
// REMOVE the connectivity test block (lines ~718-726)
// REMOVE diagnostic logs around createPipelineRunTrace (lines ~729, ~739-743)
```

### 3. Delete the verification function:

```bash
rm -rf supabase/functions/verify-langfuse-config
```

### 4. Redeploy:

```bash
npx supabase functions deploy run-space-analysis
```

## Common Solutions

### Issue: `LANGFUSE_ENABLED` is not "true"

**Solution**:
```bash
# Set environment variable in Supabase Dashboard
LANGFUSE_ENABLED=true

# Then redeploy
npx supabase functions deploy run-space-analysis
```

### Issue: Keys are missing

**Solution**:
1. Go to Langfuse Dashboard → Settings → API Keys
2. Copy `Secret Key` (sk-lf-...) and `Public Key` (pk-lf-...)
3. Add to Supabase Edge Functions environment variables
4. Redeploy functions

### Issue: Connectivity fails (401/403)

**Causes**:
- Wrong keys
- Keys revoked/expired
- Wrong Langfuse project

**Solution**:
1. Generate new keys in Langfuse
2. Update Supabase environment variables
3. Redeploy

### Issue: Connectivity fails (Network error)

**Causes**:
- Supabase Edge Functions can't reach Langfuse host
- Firewall blocking requests
- Self-hosted Langfuse not accessible

**Solution**:
- For cloud.langfuse.com: Should work (public internet)
- For self-hosted: Ensure Supabase can reach your host
- Check firewall rules if applicable

### Issue: Events queued but not appearing in UI

**Causes**:
- Flush not being called
- Flush failing silently
- Wrong project selected in Langfuse UI

**Solution**:
1. Check logs for "Flushing X events" message
2. Check for 200 response status
3. Verify Langfuse UI project selection
4. Check date/time filters in Langfuse UI

## Acceptance Tests

### A) New trace appears in Langfuse

**Test**:
1. Trigger a pipeline run
2. Wait 10 seconds
3. Check Langfuse dashboard

**Expected**: New trace with name `re-tour-pipeline-run` and matching pipeline ID

### B) Step 0 generates events

**Test**:
1. Run pipeline
2. Check logs for generation events
3. Check Langfuse for generations under trace

**Expected**: At least one generation event (Step 0.2 - Space Analysis) with metadata

### C) Disabled mode still works

**Test**:
1. Set `LANGFUSE_ENABLED=false`
2. Redeploy functions
3. Run pipeline

**Expected**:
- Pipeline completes successfully
- Logs show "Langfuse disabled - skipping"
- No traces in Langfuse (expected)

## Next Steps

1. **Run `verify-langfuse-config`** to check current status
2. **Check Edge Function logs** for diagnostic output
3. **Fix any identified issues** (env vars, connectivity, etc.)
4. **Test with a pipeline run**
5. **Remove diagnostic logs** once working
6. **Update this guide** with any new findings

## Support

If issues persist after following this guide:
1. Share the output of `verify-langfuse-config`
2. Share relevant logs from `run-space-analysis`
3. Include screenshots of Langfuse dashboard filters
4. Verify Edge Functions have latest deployment
