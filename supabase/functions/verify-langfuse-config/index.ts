/**
 * TEMPORARY DIAGNOSTIC FUNCTION
 * Verify Langfuse configuration and connectivity
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { isLangfuseEnabled, testLangfuseConnectivity } from "../_shared/langfuse-client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("[VERIFY_LANGFUSE] Starting configuration verification");

    // Check environment variables (safe - no secrets logged)
    const enabled = Deno.env.get("LANGFUSE_ENABLED");
    const hasSecretKey = !!Deno.env.get("LANGFUSE_SECRET_KEY");
    const hasPublicKey = !!Deno.env.get("LANGFUSE_PUBLIC_KEY");
    const baseUrl = Deno.env.get("LANGFUSE_BASE_URL") || "https://cloud.langfuse.com";

    console.log("[VERIFY_LANGFUSE] Environment variables:", {
      LANGFUSE_ENABLED: enabled,
      secretKeyPresent: hasSecretKey,
      publicKeyPresent: hasPublicKey,
      baseUrl
    });

    // Check if Langfuse is enabled
    const langfuseEnabled = isLangfuseEnabled();
    console.log("[VERIFY_LANGFUSE] isLangfuseEnabled():", langfuseEnabled);

    // Test connectivity
    let connectivityResult = null;
    if (langfuseEnabled) {
      console.log("[VERIFY_LANGFUSE] Testing connectivity...");
      connectivityResult = await testLangfuseConnectivity();
      console.log("[VERIFY_LANGFUSE] Connectivity result:", connectivityResult);
    }

    const result = {
      timestamp: new Date().toISOString(),
      configuration: {
        LANGFUSE_ENABLED: enabled,
        secretKeyPresent: hasSecretKey,
        publicKeyPresent: hasPublicKey,
        baseUrl,
        isLangfuseEnabled: langfuseEnabled
      },
      connectivity: connectivityResult,
      status: langfuseEnabled ? "enabled" : "disabled",
      issues: []
    };

    // Identify issues
    if (enabled !== "true") {
      result.issues.push(`LANGFUSE_ENABLED is "${enabled}" (must be exactly "true")`);
    }
    if (!hasSecretKey) {
      result.issues.push("LANGFUSE_SECRET_KEY is missing");
    }
    if (!hasPublicKey) {
      result.issues.push("LANGFUSE_PUBLIC_KEY is missing");
    }
    if (connectivityResult && !connectivityResult.reachable) {
      result.issues.push(`Cannot reach Langfuse at ${baseUrl}: ${connectivityResult.error || "Unknown error"}`);
    }

    console.log("[VERIFY_LANGFUSE] Verification complete:", result);

    return new Response(JSON.stringify(result, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error("[VERIFY_LANGFUSE] Error:", error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
