/**
 * Diagnostic Edge Function to test API_NANOBANANA configuration
 * Deploy this temporarily to verify environment variables are set correctly
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
    }

    try {
        // Check all environment variables
        const API_NANOBANANA = Deno.env.get("API_NANOBANANA");
        const API_OPENAI = Deno.env.get("API_OPENAI");
        const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
        const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        const LANGFUSE_SECRET_KEY = Deno.env.get("LANGFUSE_SECRET_KEY");
        const LANGFUSE_PUBLIC_KEY = Deno.env.get("LANGFUSE_PUBLIC_KEY");

        const diagnostics = {
            timestamp: new Date().toISOString(),
            environment_variables: {
                API_NANOBANANA: API_NANOBANANA ? `SET (${API_NANOBANANA.substring(0, 10)}...)` : "❌ NOT SET",
                API_OPENAI: API_OPENAI ? `SET (${API_OPENAI.substring(0, 10)}...)` : "❌ NOT SET",
                SUPABASE_URL: SUPABASE_URL ? `SET (${SUPABASE_URL})` : "❌ NOT SET",
                SUPABASE_SERVICE_ROLE_KEY: SUPABASE_SERVICE_ROLE_KEY ? `SET (${SUPABASE_SERVICE_ROLE_KEY.substring(0, 20)}...)` : "❌ NOT SET",
                LANGFUSE_SECRET_KEY: LANGFUSE_SECRET_KEY ? `SET (${LANGFUSE_SECRET_KEY.substring(0, 10)}...)` : "NOT SET (optional)",
                LANGFUSE_PUBLIC_KEY: LANGFUSE_PUBLIC_KEY ? `SET (${LANGFUSE_PUBLIC_KEY.substring(0, 10)}...)` : "NOT SET (optional)",
            },
            missing_critical_vars: [],
            status: "unknown"
        };

        // Check critical variables
        if (!API_NANOBANANA) diagnostics.missing_critical_vars.push("API_NANOBANANA");
        if (!SUPABASE_URL) diagnostics.missing_critical_vars.push("SUPABASE_URL");
        if (!SUPABASE_SERVICE_ROLE_KEY) diagnostics.missing_critical_vars.push("SUPABASE_SERVICE_ROLE_KEY");

        if (diagnostics.missing_critical_vars.length > 0) {
            diagnostics.status = "❌ CRITICAL VARIABLES MISSING";
            return new Response(JSON.stringify(diagnostics, null, 2), {
                status: 500,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }

        diagnostics.status = "✅ ALL CRITICAL VARIABLES SET";

        return new Response(JSON.stringify(diagnostics, null, 2), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
        });

    } catch (error) {
        console.error("[test-env-vars] Error:", error);
        return new Response(JSON.stringify({
            error: error.message,
            stack: error.stack
        }, null, 2), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
    }
});
