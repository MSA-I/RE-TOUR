import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { transformStorageUrl } from "../_shared/url-transform.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

    console.log("[create-signed-view-url] Starting request, anon key available:", !!supabaseAnonKey);

    if (!supabaseAnonKey) {
      console.error("[create-signed-view-url] SUPABASE_ANON_KEY not configured");
      return new Response(
        JSON.stringify({ error: "Server configuration error - SUPABASE_ANON_KEY missing" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const authHeader = req.headers.get("Authorization");
    console.log("[create-signed-view-url] Auth header present:", !!authHeader);

    if (!authHeader?.startsWith("Bearer ")) {
      console.error("[create-signed-view-url] Missing or invalid authorization header");
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[create-signed-view-url] Creating supabase client for auth...");
    const supabaseAnon = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    console.log("[create-signed-view-url] Calling getUser()...");
    const { data: userData, error: authError } = await supabaseAnon.auth.getUser();

    if (authError || !userData?.user) {
      console.error("[create-signed-view-url] Auth verification failed:", {
        hasError: !!authError,
        errorMessage: authError?.message,
        errorStatus: authError?.status,
        hasUserData: !!userData,
        hasUser: !!userData?.user
      });
      return new Response(
        JSON.stringify({ error: "Unauthorized", details: authError?.message }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[create-signed-view-url] Auth successful, user ID:", userData.user.id);
    const user = { id: userData.user.id };
    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey);

    const { bucket, path, expiresIn = 3600, uploadId, transform } = await req.json();

    // Support two modes: 
    // 1. uploadId - look up bucket and path from uploads table
    // 2. bucket + path - direct lookup (legacy)

    let resolvedBucket: string;
    let resolvedPath: string;
    let upload: { owner_id: string; bucket: string; path: string } | null = null;

    if (uploadId) {
      // Mode 1: Look up by upload ID
      const { data: uploadData, error: uploadError } = await supabaseClient
        .from('uploads')
        .select('owner_id, bucket, path')
        .eq('id', uploadId)
        .single();

      if (uploadError || !uploadData) {
        console.error("Upload lookup failed:", { uploadId, userId: user.id, error: uploadError });
        return new Response(
          JSON.stringify({ error: "File not found or unauthorized" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (uploadData.owner_id !== user.id) {
        console.error("Ownership verification failed:", { uploadId, userId: user.id, ownerId: uploadData.owner_id });
        return new Response(
          JSON.stringify({ error: "File not found or unauthorized" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      upload = uploadData;
      resolvedBucket = uploadData.bucket;
      resolvedPath = uploadData.path;
    } else if (bucket && path) {
      // Mode 2: Direct bucket + path lookup (legacy)
      const allowedBuckets = ["panoramas", "design_refs", "outputs", "floor_plans"];
      if (!allowedBuckets.includes(bucket)) {
        throw new Error("Invalid bucket");
      }

      // CRITICAL: Verify user owns this file via uploads table
      const { data: uploadData, error: uploadError } = await supabaseClient
        .from('uploads')
        .select('owner_id, bucket, path')
        .eq('bucket', bucket)
        .eq('path', path)
        .single();

      if (uploadError || !uploadData || uploadData.owner_id !== user.id) {
        console.error("Ownership verification failed:", { bucket, path, userId: user.id });
        return new Response(
          JSON.stringify({ error: "File not found or unauthorized" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Defense-in-depth: verify path starts with user ID
      if (!path.startsWith(`${user.id}/`)) {
        console.error("Path validation failed:", { path, userId: user.id });
        return new Response(
          JSON.stringify({ error: "Invalid path" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      upload = uploadData;
      resolvedBucket = bucket;
      resolvedPath = path;
    } else {
      throw new Error("Missing uploadId or bucket+path");
    }

    console.log(`Creating signed view URL for ${resolvedBucket}/${resolvedPath}${transform ? ' with transform' : ''}`);

    let signedUrlResult = await supabaseClient.storage
      .from(resolvedBucket)
      .createSignedUrl(resolvedPath, expiresIn, { transform });

    // If transform fails (likely free tier), fall back to original
    if (transform && signedUrlResult.error) {
      const errorMsg = signedUrlResult.error.message || "";
      const isTransformError =
        errorMsg.includes("transform") ||
        errorMsg.includes("not available") ||
        errorMsg.includes("upgrade") ||
        (signedUrlResult.error as any).statusCode === "402";

      if (isTransformError) {
        console.warn("[create-signed-view-url] Transform not available, falling back to original");
        signedUrlResult = await supabaseClient.storage
          .from(resolvedBucket)
          .createSignedUrl(resolvedPath, expiresIn); // No transform
      }
    }

    const { data, error } = signedUrlResult;

    if (error) {
      // Handle "Object not found" gracefully - return null signedUrl instead of throwing
      if (error.message?.includes("not found") || (error as any).statusCode === "404") {
        console.log(`File not found in storage: ${resolvedBucket}/${resolvedPath} - returning null`);
        return new Response(
          JSON.stringify({ signedUrl: null, notFound: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      console.error("Storage error:", error);
      throw error;
    }

    console.log("Signed view URL created successfully");

    return new Response(
      JSON.stringify({ signedUrl: transformStorageUrl(data.signedUrl, supabaseUrl) }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
