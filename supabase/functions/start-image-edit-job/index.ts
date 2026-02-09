import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

  try {
    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser(
      authHeader.replace("Bearer ", "")
    );

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { job_id } = await req.json();

    if (!job_id) {
      return new Response(
        JSON.stringify({ error: "Missing job_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[start-image-edit-job] Starting job: ${job_id}`);

    // Fetch the job
    const { data: job, error: jobError } = await supabase
      .from("image_edit_jobs")
      .select(`
        *,
        source_upload:uploads!image_edit_jobs_source_upload_id_fkey(*)
      `)
      .eq("id", job_id)
      .eq("owner_id", user.id)
      .single();

    if (jobError || !job) {
      console.error("Job fetch error:", jobError);
      return new Response(
        JSON.stringify({ error: "Job not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (job.status !== "queued") {
      return new Response(
        JSON.stringify({ error: "Job is not in queued status" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update status to running
    await supabase
      .from("image_edit_jobs")
      .update({ status: "running", progress_int: 0, progress_message: "Starting..." })
      .eq("id", job_id);

    // Log event
    const logEvent = async (type: string, message: string, progress: number) => {
      await supabase.from("image_edit_job_events").insert({
        job_id,
        owner_id: user.id,
        type,
        message,
        progress_int: progress
      });
      await supabase
        .from("image_edit_jobs")
        .update({ progress_int: progress, progress_message: message })
        .eq("id", job_id);
    };

    // Get source image URL
    const sourceUpload = job.source_upload;
    if (!sourceUpload) {
      await logEvent("error", "Source upload not found", 0);
      await supabase.from("image_edit_jobs").update({
        status: "failed",
        last_error: "Source upload not found"
      }).eq("id", job_id);
      return new Response(
        JSON.stringify({ error: "Source upload not found" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    await logEvent("info", "Fetching reference images...", 10);

    // Get all reference uploads
    const refIds = job.reference_upload_ids && job.reference_upload_ids.length > 0
      ? job.reference_upload_ids
      : [job.source_upload_id];

    const { data: refUploads, error: refError } = await supabase
      .from("uploads")
      .select("*")
      .in("id", refIds);

    if (refError || !refUploads || refUploads.length === 0) {
      console.error("Reference uploads fetch error:", refError);
      // Fallback to source only if ref fetch fails but source is there
    }

    // Fetch all images and convert to base64
    const imageParts = [];
    for (const upload of (refUploads || [sourceUpload])) {
      try {
        const { data: signedData } = await supabase.storage
          .from(upload.bucket)
          .createSignedUrl(upload.path, 3600);

        if (signedData?.signedUrl) {
          const imgResp = await fetch(signedData.signedUrl);
          const imgBuf = await imgResp.arrayBuffer();
          const imgBytes = new Uint8Array(imgBuf);
          let binStr = "";
          for (let i = 0; i < imgBytes.length; i++) {
            binStr += String.fromCharCode(imgBytes[i]);
          }

          imageParts.push({
            inlineData: {
              mimeType: upload.mime_type || "image/png",
              data: btoa(binStr)
            }
          });
        }
      } catch (e) {
        console.error(`Failed to fetch image ${upload.id}:`, e);
      }
    }

    if (imageParts.length === 0) {
      await logEvent("error", "No valid images found for processing", 0);
      await supabase.from("image_edit_jobs").update({
        status: "failed",
        last_error: "No valid images found for processing"
      }).eq("id", job_id);
      return new Response(JSON.stringify({ error: "No valid images" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    await logEvent("info", `Sending ${imageParts.length} image(s) to AI for editing...`, 30);

    // Call AI API for image editing using Google Gemini directly
    const nanoBananaKey = Deno.env.get("API_NANOBANANA");
    if (!nanoBananaKey) {
      await logEvent("error", "API_NANOBANANA key not configured", 0);
      await supabase.from("image_edit_jobs").update({
        status: "failed",
        last_error: "API_NANOBANANA key not configured"
      }).eq("id", job_id);
      return new Response(
        JSON.stringify({ error: "AI API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Use Gemini for image editing - with 4K support based on job settings
    const qualitySetting = job.output_quality?.toUpperCase() || "2K";
    const validSizes = ["1K", "2K", "4K"];
    const imageSize = validSizes.includes(qualitySetting) ? qualitySetting : "2K";
    const aspectRatio = job.aspect_ratio || "1:1";

    console.log(`[start-image-edit-job] Quality config: imageSize=${imageSize}, aspectRatio=${aspectRatio}`);

    const aiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${nanoBananaKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              {
                text: `Edit this image according to the following instructions: ${job.change_description}

Important: Apply the changes precisely as described. Maintain image quality and preserve areas not mentioned in the edit request.`
              },
              ...imageParts
            ]
          }],
          generationConfig: {
            responseModalities: ["IMAGE"],
            imageConfig: {
              aspectRatio: aspectRatio,
              imageSize: imageSize,
            },
          }
        }),
      }
    );

    await logEvent("info", "Processing AI response...", 70);

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("AI API error:", aiResponse.status, errorText);
      await logEvent("error", `AI processing failed: ${aiResponse.status}`, 0);
      await supabase.from("image_edit_jobs").update({
        status: "failed",
        last_error: `AI processing failed: ${aiResponse.status}`
      }).eq("id", job_id);
      return new Response(
        JSON.stringify({ error: "AI processing failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aiData = await aiResponse.json();
    console.log("[start-image-edit-job] AI response structure:", JSON.stringify(aiData).substring(0, 500));

    // Extract image from Gemini response - look for inlineData with image (camelCase from API)
    let generatedImageBase64: string | null = null;
    const candidates = aiData.candidates || [];
    for (const candidate of candidates) {
      const parts = candidate.content?.parts || [];
      for (const part of parts) {
        // API returns camelCase: inlineData, mimeType
        if (part.inlineData?.mimeType?.startsWith("image/")) {
          generatedImageBase64 = part.inlineData.data;
          break;
        }
      }
      if (generatedImageBase64) break;
    }

    if (!generatedImageBase64) {
      console.error("[start-image-edit-job] No image in response. Full response:", JSON.stringify(aiData).substring(0, 1000));
      await logEvent("error", "No image generated by AI", 0);
      await supabase.from("image_edit_jobs").update({
        status: "failed",
        last_error: "No image generated by AI"
      }).eq("id", job_id);
      return new Response(
        JSON.stringify({ error: "No image generated" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    await logEvent("info", "Saving output image...", 85);

    // Decode base64 to upload
    const imageData = Uint8Array.from(atob(generatedImageBase64), c => c.charCodeAt(0));

    // Upload to outputs bucket
    const outputPath = `${user.id}/${job.project_id}/edit-${job_id}-${Date.now()}.png`;
    const { error: uploadError } = await supabase.storage
      .from("outputs")
      .upload(outputPath, imageData, {
        contentType: "image/png",
        upsert: false
      });

    if (uploadError) {
      console.error("Upload error:", uploadError);
      await logEvent("error", "Failed to save output image", 0);
      await supabase.from("image_edit_jobs").update({
        status: "failed",
        last_error: "Failed to save output image"
      }).eq("id", job_id);
      return new Response(
        JSON.stringify({ error: "Failed to save output" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    await logEvent("info", "Creating upload record...", 95);

    // Create upload record
    const { data: outputUpload, error: insertError } = await supabase
      .from("uploads")
      .insert({
        owner_id: user.id,
        project_id: job.project_id,
        bucket: "outputs",
        path: outputPath,
        kind: "output",
        original_filename: `edited-${sourceUpload.original_filename || "image"}.png`,
        mime_type: "image/png",
        size_bytes: imageData.length
      })
      .select()
      .single();

    if (insertError || !outputUpload) {
      console.error("Insert error:", insertError);
      await logEvent("error", "Failed to create upload record", 0);
      await supabase.from("image_edit_jobs").update({
        status: "failed",
        last_error: "Failed to create upload record"
      }).eq("id", job_id);
      return new Response(
        JSON.stringify({ error: "Failed to create upload record" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update job with output
    await supabase
      .from("image_edit_jobs")
      .update({
        status: "completed",
        output_upload_id: outputUpload.id,
        progress_int: 100,
        progress_message: "Complete"
      })
      .eq("id", job_id);

    await logEvent("success", "Edit completed successfully!", 100);

    // Create notification
    await supabase.from("notifications").insert({
      owner_id: user.id,
      project_id: job.project_id,
      type: "image_edit_complete",
      title: "Image edit completed",
      message: `Your edit "${job.change_description.substring(0, 50)}..." is ready`,
      target_route: `/projects/${job.project_id}`,
      target_params: { tab: "image-editing-jobs", jobId: job_id }
    });

    console.log(`[start-image-edit-job] Job completed: ${job_id}`);

    return new Response(
      JSON.stringify({ success: true, output_upload_id: outputUpload.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[start-image-edit-job] Error:", error);
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
