# 🔍 Langfuse Connectivity Diagnostic Report

**Issue:** No traces appearing in Langfuse UI
**Priority:** BLOCKING (Langfuse is mandatory)

---

## 🧪 Diagnostic Steps

### Step 1: Verify Configuration Check

The Langfuse client uses this logic to determine if it's enabled:

```typescript
// From langfuse-client.ts line 122-134
function getConfig(): LangfuseConfig {
  const enabled = Deno.env.get("LANGFUSE_ENABLED") === "true";  // MUST be exactly "true"
  const secretKey = Deno.env.get("LANGFUSE_SECRET_KEY") || "";
  const publicKey = Deno.env.get("LANGFUSE_PUBLIC_KEY") || "";
  const baseUrl = Deno.env.get("LANGFUSE_BASE_URL") || "https://cloud.langfuse.com";

  return { enabled, secretKey, publicKey, baseUrl };
}

export function isLangfuseEnabled(): boolean {
  const config = getConfig();
  return config.enabled && !!config.secretKey && !!config.publicKey;  // ALL THREE must be true
}
```

**Possible Issues:**
1. ❌ `LANGFUSE_ENABLED` is set to something other than exactly `"true"` (e.g., `"True"`, `"TRUE"`, `"1"`, `true` (boolean))
2. ❌ `LANGFUSE_SECRET_KEY` is empty or not set
3. ❌ `LANGFUSE_PUBLIC_KEY` is empty or not set

---

### Step 2: Check Edge Function Logs

When an Edge Function runs, look for these console.log messages:

**If Langfuse is DISABLED:**
```
[Langfuse] Disabled, skipping trace creation
```

**If Langfuse is ENABLED:**
```
[Langfuse] Queued trace creation: <traceName> (id: <traceId>)
[Langfuse] Queued generation create: <generationName> (model: <model>)
[Langfuse] Flushing <N> events to ingestion API
[Langfuse] Flushed successfully: <result>
```

**If flush FAILS:**
```
[Langfuse] Ingestion API error: <status> - <errorText>
[Langfuse] Flush failed: <error message>
```

**Action:** Check Supabase Edge Function logs for `run-space-analysis` execution:
- Navigate to: Supabase Dashboard → Edge Functions → `run-space-analysis` → Logs
- Look for the messages above

---

### Step 3: Verify Secret Values (Supabase Dashboard)

Go to: Project Settings → Edge Functions → Secrets

**Check each value:**

1. **LANGFUSE_ENABLED**
   - Must be: `true` (lowercase, no quotes in the value field)
   - NOT: `"true"`, `True`, `TRUE`, `1`, `yes`

2. **LANGFUSE_SECRET_KEY**
   - Must start with: `sk-lf-`
   - Must not be empty
   - Must be the correct key from Langfuse

3. **LANGFUSE_PUBLIC_KEY**
   - Must start with: `pk-lf-`
   - Must not be empty
   - Must be the correct key from Langfuse

4. **LANGFUSE_BASE_URL**
   - Must be: `https://cloud.langfuse.com` (or your self-hosted URL)
   - Must include `https://`
   - Must NOT have trailing slash

---

### Step 4: Test with Minimal Edge Function

Create a test Edge Function to isolate the issue:

**File:** `supabase/functions/langfuse-test/index.ts`

```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  createTrace,
  flushLangfuse,
  isLangfuseEnabled,
} from "../_shared/langfuse-client.ts";

serve(async (req) => {
  console.log("=== LANGFUSE DIAGNOSTIC TEST ===");

  // Step 1: Check if enabled
  const enabled = isLangfuseEnabled();
  console.log(`[Test] isLangfuseEnabled(): ${enabled}`);

  // Step 2: Check raw env vars
  const envEnabled = Deno.env.get("LANGFUSE_ENABLED");
  const envSecret = Deno.env.get("LANGFUSE_SECRET_KEY");
  const envPublic = Deno.env.get("LANGFUSE_PUBLIC_KEY");
  const envBaseUrl = Deno.env.get("LANGFUSE_BASE_URL");

  console.log(`[Test] LANGFUSE_ENABLED = "${envEnabled}" (type: ${typeof envEnabled})`);
  console.log(`[Test] LANGFUSE_SECRET_KEY present: ${!!envSecret}, starts with sk-lf-: ${envSecret?.startsWith("sk-lf-")}`);
  console.log(`[Test] LANGFUSE_PUBLIC_KEY present: ${!!envPublic}, starts with pk-lf-: ${envPublic?.startsWith("pk-lf-")}`);
  console.log(`[Test] LANGFUSE_BASE_URL = "${envBaseUrl}"`);

  // Step 3: Try to create a trace
  const testTraceId = crypto.randomUUID();
  console.log(`[Test] Creating trace with ID: ${testTraceId}`);

  const traceResult = await createTrace({
    id: testTraceId,
    name: "test-trace",
    input: { test: "input data" },
    output: { test: "output data" },
    metadata: { test_mode: true },
    tags: ["diagnostic", "test"],
  });

  console.log(`[Test] Trace creation result:`, traceResult);

  // Step 4: Try to flush
  console.log(`[Test] Calling flushLangfuse()...`);
  const flushResult = await flushLangfuse();
  console.log(`[Test] Flush result:`, flushResult);

  // Step 5: Return diagnostic info
  return new Response(JSON.stringify({
    diagnostic: "langfuse-test",
    enabled,
    envVars: {
      LANGFUSE_ENABLED: envEnabled,
      LANGFUSE_SECRET_KEY_present: !!envSecret,
      LANGFUSE_SECRET_KEY_format: envSecret?.startsWith("sk-lf-") ? "correct" : "incorrect",
      LANGFUSE_PUBLIC_KEY_present: !!envPublic,
      LANGFUSE_PUBLIC_KEY_format: envPublic?.startsWith("pk-lf-") ? "correct" : "incorrect",
      LANGFUSE_BASE_URL: envBaseUrl,
    },
    traceResult,
    flushResult,
    testTraceId,
    instructions: "Check Langfuse UI for trace with ID: " + testTraceId,
  }, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
});
```

**Action:**
1. Deploy this test function: `supabase functions deploy langfuse-test`
2. Invoke it via Supabase Dashboard or curl
3. Check the Edge Function logs for diagnostic output
4. Check Langfuse UI for the test trace

---

## 🔧 Common Fixes

### Fix 1: Incorrect LANGFUSE_ENABLED Value

**Problem:** `LANGFUSE_ENABLED` is not exactly `"true"`

**Solution:** In Supabase Dashboard → Secrets, set:
```
Key: LANGFUSE_ENABLED
Value: true
```
(No quotes, lowercase, exactly "true")

---

### Fix 2: Missing or Incorrect Keys

**Problem:** Keys are empty, malformed, or incorrect

**Solution:** Verify in Langfuse UI → Settings → API Keys:
1. Copy `Secret Key` (starts with `sk-lf-`)
2. Copy `Public Key` (starts with `pk-lf-`)
3. Set in Supabase Secrets (exact copy, no extra spaces)

---

### Fix 3: Base URL with Trailing Slash

**Problem:** `LANGFUSE_BASE_URL` has trailing slash: `https://cloud.langfuse.com/`

**Solution:** Remove trailing slash:
```
Key: LANGFUSE_BASE_URL
Value: https://cloud.langfuse.com
```

---

### Fix 4: Authentication Failure

**Problem:** Keys are correct but flush returns 401/403

**Solution:**
1. Regenerate API keys in Langfuse UI
2. Update Supabase Secrets with new keys
3. Redeploy Edge Functions

---

### Fix 5: Network/Firewall Issue

**Problem:** Supabase Edge Functions cannot reach Langfuse API

**Solution:**
1. Check Langfuse status page
2. Verify Supabase → Langfuse network path is open
3. Try self-hosted Langfuse if cloud is blocked

---

## ✅ Validation Checklist

After applying fixes, verify:

- [ ] Edge Function logs show: `[Langfuse] Queued trace creation: ...`
- [ ] Edge Function logs show: `[Langfuse] Flushing N events to ingestion API`
- [ ] Edge Function logs show: `[Langfuse] Flushed successfully: ...`
- [ ] NO logs showing: `[Langfuse] Disabled, skipping trace creation`
- [ ] NO logs showing: `[Langfuse] Ingestion API error: ...`
- [ ] Langfuse UI shows traces with non-empty inputs/outputs
- [ ] Judge evaluations visible in Langfuse UI (for QA steps)

---

## 🚨 If Still Not Working

**Escalation Path:**

1. **Check Supabase Logs:**
   - Dashboard → Edge Functions → Select function → Logs tab
   - Look for ALL console.log messages
   - Copy full log output for analysis

2. **Test Network Connectivity:**
   - Create a minimal test function that just calls `fetch()` to Langfuse API
   - Verify Supabase → Langfuse network path works

3. **Verify Langfuse Account:**
   - Log into Langfuse UI
   - Verify project exists
   - Verify API keys are active (not revoked)
   - Check Langfuse logs for incoming requests

4. **Simplify Test:**
   - Use the test Edge Function above
   - Check if trace appears in Langfuse UI
   - If not, issue is with credentials or network
   - If yes, issue is with how main functions use Langfuse

---

**Next Action:** Please run through Step 1-3 above and report back what you find in the Edge Function logs.
