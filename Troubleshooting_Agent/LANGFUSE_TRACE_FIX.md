# Langfuse Traces Not Appearing - Root Cause Analysis & Fix

## Issue Summary
Pipeline executes successfully but no traces appear in the Langfuse dashboard.

## Root Cause Identified

**Location:** `supabase/functions/langfuse-test/index.ts`

**Problem:** Missing `flushLangfuse()` call before returning response.

### Technical Explanation

The Langfuse client uses a **batching system** for performance reasons:

1. When you call `createTrace()`, `logGeneration()`, or `logSpan()`, events are **queued in memory**
2. Events are NOT immediately sent to the Langfuse API
3. Events are only transmitted when `flushLangfuse()` is explicitly called
4. **Without the flush, all queued events remain in memory and are discarded when the Edge Function terminates**

This is similar to how database transactions work - you can prepare multiple operations, but they only commit when you call `commit()`.

### Code Evidence

**Before (BROKEN):**
```typescript
// langfuse-test/index.ts lines 200-217
// Determine overall success
const allSuccessful = Object.entries(results)
  .filter(([key]) => typeof results[key] === "object" && results[key] !== null)
  .every(([, value]) => (value as { success?: boolean }).success !== false);

return new Response(
  JSON.stringify({
    success: allSuccessful,
    message: allSuccessful
      ? "All Langfuse tests passed! Check your Langfuse dashboard for the trace."
      : "Some tests failed. Check the results for details.",
    results,
    dashboard_url: "https://cloud.langfuse.com",
  }),
  {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  }
);
// ❌ NO FLUSH - Events never sent!
```

**After (FIXED):**
```typescript
// Determine overall success
const allSuccessful = Object.entries(results)
  .filter(([key]) => typeof results[key] === "object" && results[key] !== null)
  .every(([, value]) => (value as { success?: boolean }).success !== false);

// CRITICAL: Flush Langfuse events before returning
// Without this flush, all queued events remain in memory and are never sent to Langfuse
console.log("[langfuse-test] Flushing Langfuse events...");
await flushLangfuse();
console.log("[langfuse-test] Flush complete");

return new Response(
  JSON.stringify({
    success: allSuccessful,
    message: allSuccessful
      ? "All Langfuse tests passed! Check your Langfuse dashboard for the trace."
      : "Some tests failed. Check the results for details.",
    results,
    dashboard_url: "https://cloud.langfuse.com",
  }),
  {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  }
);
// ✅ FLUSH CALLED - Events transmitted to Langfuse!
```

## Why `run-pipeline-step` Works Correctly

The main pipeline function uses `wrapImageGeneration()` from `langfuse-image-wrapper.ts`, which **ALREADY includes** the flush call at lines 258, 300, 342, 388, and 433:

```typescript
// langfuse-image-wrapper.ts
export async function wrapImageGeneration(...) {
  // ... logging code ...
  
  await flushLangfuse();  // ✅ PRESENT
  
  return {
    success: true,
    imageData,
    // ...
  };
}
```

So if your pipeline is using `wrapImageGeneration()` for image generation calls, those should be working fine.

## Verification Steps

### 1. Check Environment Variables

Make sure these are set in your Supabase Edge Functions secrets:

```bash
LANGFUSE_ENABLED=true
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_BASE_URL=https://cloud.langfuse.com
```

To check if they're set:
```bash
supabase secrets list
```

### 2. Deploy the Fixed Function

```bash
supabase functions deploy langfuse-test
```

### 3. Test the Function

```bash
curl -X POST https://[your-project-id].supabase.co/functions/v1/langfuse-test \
  -H "Content-Type: application/json" \
  -d '{"test_type": "full"}'
```

### 4. Verify in Langfuse Dashboard

1. Go to https://cloud.langfuse.com
2. Navigate to your project
3. Check the "Traces" tab
4. You should see a trace named "RE:TOUR Integration Test" within ~10 seconds
5. Click into the trace to see:
   - Metadata (test: true, environment: "edge-function")
   - Tags: test, integration, edge-function
   - Generation: "Test Model Call" (simulated LLM call)
   - Span: "Test Database Operation" (simulated DB operation)

### 5. Check Edge Function Logs

Watch the logs during execution:

```bash
supabase functions logs langfuse-test --follow
```

You should see:
```
[LANGFUSE_DIAGNOSTIC] Configuration check: { enabled: true, ... }
[langfuse-test] Running test: full
[langfuse-test] Langfuse enabled: true
[Langfuse] Queued trace creation: RE:TOUR Integration Test (id: ...)
[Langfuse] Queued generation create: Test Model Call (model: gemini-2.5-flash)
[Langfuse] Queued span: Test Database Operation
[langfuse-test] Flushing Langfuse events...
[Langfuse] Flushing 4 events to ingestion API
[LANGFUSE_DIAGNOSTIC] Ingestion API response status: 207
[Langfuse] Flushed successfully: {...}
[langfuse-test] Flush complete
```

## Expected Langfuse Trace Structure

```
Trace: RE:TOUR Integration Test
├─ Generation: Test Model Call
│  ├─ Model: gemini-2.5-flash
│  ├─ Input: { prompt: "This is a test prompt..." }
│  ├─ Output: { response: "This is a simulated..." }
│  └─ Metadata: { test: true, latency_ms: ... }
│
└─ Span: Test Database Operation
   ├─ Input: { query: "SELECT * FROM test" }
   ├─ Output: { rows: 0 }
   └─ Metadata: { operation: "select", table: "test_table" }
```

## Troubleshooting

### If traces still don't appear:

1. **Check API Status Code (in logs)**
   - `207 Multi-Status` = Partial success (some events accepted)
   - `200 OK` = All events accepted
   - `401 Unauthorized` = Invalid credentials
   - `400 Bad Request` = Malformed payload

2. **Verify Credentials Match**
   - Compare `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` with your Langfuse project settings
   - Ensure they're from the same Langfuse project you're viewing

3. **Check Network Connectivity**
   - Edge Functions must be able to reach `https://cloud.langfuse.com`
   - Verify no firewall blocking outbound HTTPS

4. **Validate Payload Size**
   - Langfuse has payload size limits (~5MB per event)
   - Check logs for payload truncation warnings

5. **Time-based Visibility**
   - Traces may take 5-30 seconds to appear in the UI
   - Try refreshing the Langfuse dashboard
   - Check if your browser time matches the trace timestamp

## Fix Applied

- **File:** `supabase/functions/langfuse-test/index.ts`
- **Lines Changed:** 15-22 (import), 203-210 (flush call)
- **Complexity:** Minimal, one-line fix with critical impact
- **Risk:** None, this is a test function

The fix is **backwards compatible** and **non-breaking**. It only ensures that queued events are properly transmitted to Langfuse before the function returns.
