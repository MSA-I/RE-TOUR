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
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("Missing environment variables");
      throw new Error("Server configuration error");
    }
    
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      console.error("Missing authorization header");
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create client with service role key for storage operations
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    
    // Verify user's JWT
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    
    if (authError || !user) {
      console.error("Auth error:", authError);
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const { bucket, path, contentType } = body;
    
    console.log(`Request from user ${user.id}: bucket=${bucket}, path=${path}, contentType=${contentType}`);
    
    if (!bucket || !path) {
      return new Response(
        JSON.stringify({ error: "Missing bucket or path" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate bucket is one of our allowed buckets
    const allowedBuckets = ["panoramas", "design_refs", "outputs", "floor_plans"];
    if (!allowedBuckets.includes(bucket)) {
      console.error(`Invalid bucket: ${bucket}`);
      return new Response(
        JSON.stringify({ error: "Invalid bucket" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify path starts with user's ID for security
    if (!path.startsWith(`${user.id}/`)) {
      console.error(`Path security violation: path=${path}, user=${user.id}`);
      return new Response(
        JSON.stringify({ error: "Invalid path - must start with your user ID" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Creating signed upload URL for ${bucket}/${path}`);

    // Create signed upload URL with upsert option
    const { data, error } = await supabaseAdmin.storage
      .from(bucket)
      .createSignedUploadUrl(path, {
        upsert: true,
      });

    if (error) {
      console.error("Storage error:", error);
      return new Response(
        JSON.stringify({ error: `Storage error: ${error.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!data || !data.signedUrl) {
      console.error("No signed URL returned from storage");
      return new Response(
        JSON.stringify({ error: "Failed to generate signed URL" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Signed upload URL created successfully:", {
      path: data.path,
      hasToken: !!data.token,
      urlLength: data.signedUrl?.length,
    });

    return new Response(
      JSON.stringify({
        signedUrl: transformStorageUrl(data.signedUrl, supabaseUrl),
        token: data.token,
        path: data.path
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
