/**
 * Langfuse Integration Test Edge Function
 * 
 * This function verifies that Langfuse credentials are working correctly
 * and that traces/generations appear in the Langfuse dashboard.
 * 
 * IMPORTANT: This is a dev/test endpoint. In production, consider
 * restricting access or removing entirely.
 * 
 * Usage:
 * POST /langfuse-test
 * Body: { "test_type": "full" | "trace" | "generation" | "span" }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  isLangfuseEnabled,
  createTrace,
  logGeneration,
  logSpan,
  updateTrace,
  flushLangfuse,
} from "../_shared/langfuse-client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type TestType = "full" | "trace" | "generation" | "span";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Parse request body
    let testType: TestType = "full";
    try {
      const body = await req.json();
      const requestedType = body.test_type as string;
      if (["trace", "generation", "span", "full"].includes(requestedType)) {
        testType = requestedType as TestType;
      }
    } catch {
      // Default to full test
    }

    console.log(`[langfuse-test] Running test: ${testType}`);

    // Check if Langfuse is enabled
    const enabled = isLangfuseEnabled();
    console.log(`[langfuse-test] Langfuse enabled: ${enabled}`);

    if (!enabled) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Langfuse is not enabled or credentials are missing",
          hint: "Set LANGFUSE_ENABLED=true and ensure LANGFUSE_SECRET_KEY, LANGFUSE_PUBLIC_KEY, LANGFUSE_BASE_URL are configured",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const results: Record<string, unknown> = {
      enabled: true,
      test_type: testType,
      timestamp: new Date().toISOString(),
    };

    // Determine which tests to run
    const runTrace = testType === "full" || testType === "trace";
    const runGeneration = testType === "full" || testType === "generation";
    const runSpan = testType === "full" || testType === "span";

    // For generation/span-only tests, we still need a trace first
    const needsTrace = runTrace || runGeneration || runSpan;

    let traceId: string | undefined;

    // Test 1: Create a trace
    if (needsTrace) {
      const traceResult = await createTrace({
        name: "RE:TOUR Integration Test",
        metadata: {
          test: true,
          environment: "edge-function",
          timestamp: Date.now(),
        },
        tags: ["test", "integration", "edge-function"],
        input: { test_type: testType },
      });

      traceId = traceResult.traceId;

      if (runTrace) {
        results.trace = {
          success: traceResult.success,
          traceId: traceResult.traceId,
          error: traceResult.error,
        };
      }
    }

    // Test 2: Log a generation (simulated LLM call)
    if (runGeneration && traceId) {
      const startTime = new Date();

      // Simulate some processing time
      await new Promise((resolve) => setTimeout(resolve, 100));

      const endTime = new Date();

      const generationResult = await logGeneration({
        traceId,
        name: "Test Model Call",
        model: "gemini-2.5-flash",
        modelParameters: {
          temperature: 0.7,
          maxTokens: 1000,
        },
        input: {
          prompt: "This is a test prompt for Langfuse integration verification",
        },
        output: {
          response: "This is a simulated model response for testing purposes",
        },
        startTime,
        endTime,
        metadata: {
          test: true,
          latency_ms: endTime.getTime() - startTime.getTime(),
        },
        usage: {
          promptTokens: 15,
          completionTokens: 12,
          totalTokens: 27,
        },
      });

      results.generation = {
        success: generationResult.success,
        generationId: generationResult.generationId,
        error: generationResult.error,
      };
    }

    // Test 3: Log a span (non-LLM operation)
    if (runSpan && traceId) {
      const startTime = new Date();

      // Simulate some processing
      await new Promise((resolve) => setTimeout(resolve, 50));

      const endTime = new Date();

      const spanResult = await logSpan({
        traceId,
        name: "Test Database Operation",
        startTime,
        endTime,
        metadata: {
          operation: "select",
          table: "test_table",
        },
        input: { query: "SELECT * FROM test" },
        output: { rows: 0 },
      });

      results.span = {
        success: spanResult.success,
        spanId: spanResult.spanId,
        error: spanResult.error,
      };
    }

    // Test 4: Update the trace with final output
    if (traceId) {
      const updateResult = await updateTrace(traceId, {
        output: {
          test_completed: true,
          tests_run: Object.keys(results).filter((k) => k !== "enabled" && k !== "test_type" && k !== "timestamp"),
        },
        metadata: {
          completed_at: new Date().toISOString(),
        },
      });

      results.trace_update = {
        success: updateResult.success,
        error: updateResult.error,
      };
    }

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
  } catch (error) {
    console.error("[langfuse-test] Error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
