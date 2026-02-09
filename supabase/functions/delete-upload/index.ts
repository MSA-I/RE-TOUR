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
    const {
      data: { user },
      error: authError,
    } = await supabaseClient.auth.getUser(token);

    if (authError || !user) {
      throw new Error("Unauthorized");
    }

    const { upload_id, force_db_only, permanent = false } = await req.json();

    if (!upload_id) {
      throw new Error("Missing upload_id");
    }

    console.log(`Deleting upload: ${upload_id}, permanent: ${permanent}, force_db_only: ${force_db_only}`);

    // Get upload details and verify ownership
    const { data: upload, error: uploadError } = await supabaseClient
      .from("uploads")
      .select("*")
      .eq("id", upload_id)
      .eq("owner_id", user.id)
      .single();

    if (uploadError || !upload) {
      console.error("Upload not found or unauthorized:", uploadError);
      throw new Error("Upload not found or unauthorized");
    }

    console.log(`Found upload: ${upload.bucket}/${upload.path}, kind: ${upload.kind}`);

    if (permanent) {
      // PERMANENT DELETE LOGIC (Hard Delete)
      // Check for critical references before permanent deletion
      if (upload.kind === "floor_plan") {
        const { count } = await supabaseClient
          .from("floorplan_pipelines")
          .select("*", { count: "exact", head: true })
          .eq("floor_plan_upload_id", upload_id);

        if (count && count > 0) {
          throw new Error("Cannot permanently delete floor plan: it is referenced by active pipelines.");
        }
      }

      if (upload.kind === "panorama") {
        const { count } = await supabaseClient
          .from("render_jobs")
          .select("*", { count: "exact", head: true })
          .eq("panorama_upload_id", upload_id);

        if (count && count > 0) {
          throw new Error("Cannot permanently delete panorama: it is referenced by render jobs.");
        }
      }

      // 1. Delete from storage (unless force_db_only)
      if (!force_db_only) {
        const { error: storageError } = await supabaseClient.storage
          .from(upload.bucket)
          .remove([upload.path]);

        if (storageError) {
          console.warn("Storage delete error (file may already be missing):", storageError.message);
        } else {
          console.log(`Deleted file from storage: ${upload.bucket}/${upload.path}`);
        }
      }

      // 2. Hard delete from database
      const { error: dbError } = await supabaseClient
        .from("uploads")
        .delete()
        .eq("id", upload_id)
        .eq("owner_id", user.id);

      if (dbError) throw dbError;

      console.log(`Upload ${upload_id} permanently deleted`);
    } else {
      // SOFT DELETE LOGIC (Default)
      // Simply mark as deleted_at
      const { error: dbError } = await supabaseClient
        .from("uploads")
        .update({
          deleted_at: new Date().toISOString(),
          deleted_by: user.id
        })
        .eq("id", upload_id)
        .eq("owner_id", user.id);

      if (dbError) {
        console.error("Soft delete error:", dbError);
        throw new Error("Failed to soft-delete upload record");
      }

      console.log(`Upload ${upload_id} soft-deleted successfully`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: permanent ? "Upload permanently deleted" : "Upload soft-deleted",
        deleted_id: upload_id,
        mode: permanent ? "permanent" : "soft"
      }),
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
