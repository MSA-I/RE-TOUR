/**
 * Langfuse Diagnostic Test Edge Function
 *
 * Deploy this to diagnose Langfuse connectivity issues.
 *
 * Usage:
 * 1. Create: supabase/functions/langfuse-test/index.ts (copy this file)
 * 2. Deploy: supabase functions deploy langfuse-test
 * 3. Invoke via Dashboard or: curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/langfuse-test
 * 4. Check logs in Dashboard → Edge Functions → langfuse-test → Logs
 * 5. Check Langfuse UI for trace with returned testTraceId
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  createTrace,
  logCompleteGeneration,
  flushLangfuse,
  isLangfuseEnabled,
} from "../_shared/langfuse-client.ts";

serve(async (req) => {
  console.log("=== LANGFUSE DIAGNOSTIC TEST START ===");

  // Step 1: Check if Langfuse is enabled
  const enabled = isLangfuseEnabled();
  console.log(`[Diagnostic] isLangfuseEnabled(): ${enabled}`);

  // Step 2: Check raw environment variables
  const envEnabled = Deno.env.get("LANGFUSE_ENABLED");
  const envSecret = Deno.env.get("LANGFUSE_SECRET_KEY");
  const envPublic = Deno.env.get("LANGFUSE_PUBLIC_KEY");
  const envBaseUrl = Deno.env.get("LANGFUSE_BASE_URL");

  console.log(`[Diagnostic] LANGFUSE_ENABLED = "${envEnabled}" (type: ${typeof envEnabled})`);
  console.log(`[Diagnostic] LANGFUSE_ENABLED === "true": ${envEnabled === "true"}`);
  console.log(`[Diagnostic] LANGFUSE_SECRET_KEY present: ${!!envSecret}`);
  console.log(`[Diagnostic] LANGFUSE_SECRET_KEY starts with "sk-lf-": ${envSecret?.startsWith("sk-lf-")}`);
  console.log(`[Diagnostic] LANGFUSE_PUBLIC_KEY present: ${!!envPublic}`);
  console.log(`[Diagnostic] LANGFUSE_PUBLIC_KEY starts with "pk-lf-": ${envPublic?.startsWith("pk-lf-")}`);
  console.log(`[Diagnostic] LANGFUSE_BASE_URL = "${envBaseUrl}"`);

  // Step 3: Try to create a trace
  const testTraceId = crypto.randomUUID();
  console.log(`[Diagnostic] Creating test trace with ID: ${testTraceId}`);

  const traceResult = await createTrace({
    id: testTraceId,
    name: "diagnostic-test-trace",
    input: {
      test: "input data",
      timestamp: new Date().toISOString(),
      diagnostic: true,
    },
    output: {
      test: "output data",
      status: "test completed",
    },
    metadata: {
      test_mode: true,
      function_name: "langfuse-test",
      environment: "edge-function",
    },
    tags: ["diagnostic", "test", "connectivity-check"],
  });

  console.log(`[Diagnostic] Trace creation result:`, JSON.stringify(traceResult, null, 2));

  // Step 4: Try to create a generation
  const testGenerationId = crypto.randomUUID();
  console.log(`[Diagnostic] Creating test generation with ID: ${testGenerationId}`);

  const generationResult = await logCompleteGeneration({
    id: testGenerationId,
    traceId: testTraceId,
    name: "diagnostic-test-generation",
    model: "test-model-v1",
    input: {
      prompt: "This is a test prompt for diagnostics",
      parameters: { temperature: 0.7, max_tokens: 100 },
    },
    output: {
      response: "This is a test response",
      tokens_used: 50,
    },
    startTime: new Date(Date.now() - 1000),
    endTime: new Date(),
    metadata: {
      test_mode: true,
      diagnostic: true,
    },
  });

  console.log(`[Diagnostic] Generation creation result:`, JSON.stringify(generationResult, null, 2));

  // Step 5: Try to flush
  console.log(`[Diagnostic] Calling flushLangfuse()...`);
  const flushStartTime = Date.now();
  const flushResult = await flushLangfuse();
  const flushDuration = Date.now() - flushStartTime;
  console.log(`[Diagnostic] Flush completed in ${flushDuration}ms`);
  console.log(`[Diagnostic] Flush result:`, JSON.stringify(flushResult, null, 2));

  console.log("=== LANGFUSE DIAGNOSTIC TEST END ===");

  // Step 6: Return diagnostic report
  const report = {
    diagnostic: "langfuse-connectivity-test",
    timestamp: new Date().toISOString(),
    enabled,
    envVars: {
      LANGFUSE_ENABLED: envEnabled,
      LANGFUSE_ENABLED_is_string_true: envEnabled === "true",
      LANGFUSE_SECRET_KEY_present: !!envSecret,
      LANGFUSE_SECRET_KEY_format: envSecret?.startsWith("sk-lf-") ? "✅ correct (sk-lf-...)" : "❌ incorrect or missing",
      LANGFUSE_PUBLIC_KEY_present: !!envPublic,
      LANGFUSE_PUBLIC_KEY_format: envPublic?.startsWith("pk-lf-") ? "✅ correct (pk-lf-...)" : "❌ incorrect or missing",
      LANGFUSE_BASE_URL: envBaseUrl || "❌ not set (will default to https://cloud.langfuse.com)",
    },
    testResults: {
      traceCreation: traceResult.success ? "✅ success" : `❌ failed: ${traceResult.error}`,
      generationCreation: generationResult.success ? "✅ success" : `❌ failed: ${generationResult.error}`,
      flush: flushResult.success ? "✅ success" : `❌ failed: ${flushResult.error}`,
      flushDurationMs: flushDuration,
    },
    testTraceId,
    testGenerationId,
    instructions: [
      "1. Check the logs above for [Diagnostic] messages",
      "2. If enabled = false, check LANGFUSE_ENABLED is exactly 'true'",
      "3. If enabled = true but traces not visible:",
      "   - Check Langfuse UI → Traces for ID: " + testTraceId,
      "   - Check if input/output are non-empty",
      "   - Verify flush result is success: true",
      "4. If flush failed, check the error message",
      "5. If flush succeeded but no trace in UI:",
      "   - Verify API keys are correct in Langfuse UI",
      "   - Check Langfuse account has permissions",
      "   - Verify LANGFUSE_BASE_URL matches your Langfuse instance",
    ],
    nextSteps: enabled
      ? flushResult.success
        ? "✅ Langfuse is configured correctly. Check Langfuse UI for trace: " + testTraceId
        : "❌ Flush failed. Check error message and verify API keys."
      : "❌ Langfuse is disabled. Check environment variables above.",
  };

  return new Response(JSON.stringify(report, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
});
