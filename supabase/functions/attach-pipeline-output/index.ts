import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    // Get user from auth header
    const supabaseUser = createClient(
      SUPABASE_URL,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      throw new Error("Unauthorized");
    }

    const { pipeline_id, output_upload_id } = await req.json();

    if (!pipeline_id || !output_upload_id) {
      throw new Error("pipeline_id and output_upload_id are required");
    }

    console.log(`Attaching pipeline output: pipeline=${pipeline_id}, output=${output_upload_id}`);

    // Get pipeline and verify ownership
    const { data: pipeline, error: pipelineError } = await supabaseAdmin
      .from("floorplan_pipelines")
      .select("*")
      .eq("id", pipeline_id)
      .eq("owner_id", user.id)
      .single();

    if (pipelineError || !pipeline) {
      throw new Error("Pipeline not found or access denied");
    }

    // Verify the output belongs to this pipeline
    const stepOutputs = pipeline.step_outputs as Record<string, any> || {};
    let isValidOutput = false;
    for (const [stepKey, stepData] of Object.entries(stepOutputs)) {
      if (stepData?.output_upload_id === output_upload_id) {
        isValidOutput = true;
        break;
      }
    }

    if (!isValidOutput) {
      throw new Error("Output does not belong to this pipeline");
    }

    // Get the output upload details
    const { data: outputUpload, error: outputError } = await supabaseAdmin
      .from("uploads")
      .select("*")
      .eq("id", output_upload_id)
      .eq("owner_id", user.id)
      .single();

    if (outputError || !outputUpload) {
      throw new Error("Output upload not found");
    }

    console.log(`Found output upload: bucket=${outputUpload.bucket}, path=${outputUpload.path}`);

    // Download the file from outputs bucket
    const { data: fileData, error: downloadError } = await supabaseAdmin.storage
      .from(outputUpload.bucket)
      .download(outputUpload.path);

    if (downloadError || !fileData) {
      throw new Error(`Failed to download output file: ${downloadError?.message}`);
    }

    console.log(`Downloaded file: ${fileData.size} bytes`);

    // Generate new path in panoramas bucket
    const fileExt = outputUpload.path.split('.').pop() || 'png';
    const newUuid = crypto.randomUUID();
    const newPath = `${user.id}/${pipeline.project_id}/${newUuid}.${fileExt}`;

    // Upload to panoramas bucket
    const { error: uploadError } = await supabaseAdmin.storage
      .from("panoramas")
      .upload(newPath, fileData, {
        contentType: outputUpload.mime_type || "image/png"
      });

    if (uploadError) {
      throw new Error(`Failed to upload to panoramas: ${uploadError.message}`);
    }

    console.log(`Uploaded to panoramas: ${newPath}`);

    // Create new uploads row for panorama
    const { data: newUpload, error: insertError } = await supabaseAdmin
      .from("uploads")
      .insert({
        project_id: pipeline.project_id,
        owner_id: user.id,
        bucket: "panoramas",
        path: newPath,
        kind: "panorama",
        mime_type: outputUpload.mime_type || "image/png",
        size_bytes: outputUpload.size_bytes || fileData.size,
        original_filename: outputUpload.original_filename || `pipeline_panorama_${pipeline_id}.${fileExt}`
      })
      .select()
      .single();

    if (insertError) {
      throw new Error(`Failed to create upload record: ${insertError.message}`);
    }

    console.log(`Created panorama upload record: ${newUpload.id}`);

    // Create notification
    await supabaseAdmin.from("notifications").insert({
      owner_id: user.id,
      project_id: pipeline.project_id,
      type: "pipeline_attached",
      title: "Pipeline Output Attached",
      message: "Pipeline output has been attached to Panorama Uploads",
      target_route: `/projects/${pipeline.project_id}`,
      target_params: { tab: "panorama-uploads", uploadId: newUpload.id }
    });

    return new Response(JSON.stringify({ 
      success: true, 
      panorama_upload_id: newUpload.id,
      message: "Successfully attached to Panorama Uploads"
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error("Attach pipeline output error:", error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : "Unknown error" 
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
