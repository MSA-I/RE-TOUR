import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
    
    if (authError || !user) {
      throw new Error("Unauthorized");
    }

    const requestBody = await req.json();
    const { bucket, path, uploadId, expiresIn = 3600, filename } = requestBody;
    
    let resolvedBucket: string;
    let resolvedPath: string;

    // Support uploadId-based lookup (resolve bucket/path from uploads table)
    if (uploadId) {
      console.log(`Resolving upload ID: ${uploadId}`);
      
      const { data: upload, error: uploadError } = await supabaseClient
        .from('uploads')
        .select('bucket, path, owner_id, original_filename')
        .eq('id', uploadId)
        .single();

      if (uploadError || !upload) {
        console.error("Upload lookup failed:", uploadError);
        return new Response(
          JSON.stringify({ error: "File not found or unauthorized" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (upload.owner_id !== user.id) {
        console.error("Ownership mismatch:", { uploadOwnerId: upload.owner_id, userId: user.id });
        return new Response(
          JSON.stringify({ error: "File not found or unauthorized" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      resolvedBucket = upload.bucket;
      resolvedPath = upload.path;
      console.log(`Resolved: bucket=${resolvedBucket}, path=${resolvedPath}`);
    } else {
      // Legacy mode: use provided bucket and path
      if (!bucket || !path) {
        throw new Error("Missing bucket or path (or uploadId)");
      }

      const allowedBuckets = ["panoramas", "design_refs", "outputs", "floor_plans"];
      if (!allowedBuckets.includes(bucket)) {
        throw new Error("Invalid bucket");
      }

      // CRITICAL: Verify user owns this file via uploads table
      const { data: upload, error: uploadError } = await supabaseClient
        .from('uploads')
        .select('owner_id')
        .eq('bucket', bucket)
        .eq('path', path)
        .single();

      if (uploadError || !upload || upload.owner_id !== user.id) {
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

      resolvedBucket = bucket;
      resolvedPath = path;
    }

    console.log(`Creating signed download URL for ${resolvedBucket}/${resolvedPath}`);

    const { data, error } = await supabaseClient.storage
      .from(resolvedBucket)
      .createSignedUrl(resolvedPath, expiresIn, {
        download: filename || true
      });

    if (error) {
      console.error("Storage error:", error);
      throw error;
    }

    console.log("Signed download URL created successfully");

    return new Response(
      JSON.stringify({ signedUrl: data.signedUrl }),
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
