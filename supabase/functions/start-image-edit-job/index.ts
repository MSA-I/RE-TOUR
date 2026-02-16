import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  encode as encodeBase64,
  decode as decodeBase64
} from "https://deno.land/std@0.168.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// AI Models configuration (inlined to avoid shared dependency)
const AI_MODELS = {
  IMAGE_GENERATION: {
    model: "gemini-3-pro-image-preview",
    provider: "google",
  },
} as const;

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

function getGeminiModelUrl(modelName: string, apiKey: string): string {
  return `${GEMINI_API_BASE}/${modelName}:generateContent?key=${apiKey}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

    console.log("[start-image-edit-job] Starting request, anon key available:", !!supabaseAnonKey);

    if (!supabaseAnonKey) {
      console.error("[start-image-edit-job] SUPABASE_ANON_KEY not configured");
      return new Response(
        JSON.stringify({ error: "Server configuration error - SUPABASE_ANON_KEY missing" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Auth check
    const authHeader = req.headers.get("Authorization");
    console.log("[start-image-edit-job] Auth header present:", !!authHeader);

    if (!authHeader?.startsWith("Bearer ")) {
      console.error("[start-image-edit-job] Missing or invalid authorization header");
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[start-image-edit-job] Creating supabase client for auth...");
    const supabaseAnon = createClient(SUPABASE_URL, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    console.log("[start-image-edit-job] Calling getUser()...");
    const { data: userData, error: authError } = await supabaseAnon.auth.getUser();

    if (authError || !userData?.user) {
      console.error("[start-image-edit-job] Auth verification failed:", {
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

    console.log("[start-image-edit-job] Auth successful, user ID:", userData.user.id);
    const user = { id: userData.user.id };

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
        // Apply downscaling transformation when fetching images to stay within memory and API limits
        // 1600px is enough for Gemini to understand style and detail
        let signedData = await supabase.storage
          .from(upload.bucket)
          .createSignedUrl(upload.path, 3600, {
            transform: {
              width: 1600,
              height: 1600,
              resize: 'contain',
              quality: 80
            }
          });

        // Fallback to original if transform fails
        if (signedData.error || !signedData.data?.signedUrl) {
          console.warn(`[start-image-edit-job] Transform failed, falling back to original`);
          signedData = await supabase.storage
            .from(upload.bucket)
            .createSignedUrl(upload.path, 3600);
        }

        if (signedData.data?.signedUrl) {
          const imgResp = await fetch(signedData.data.signedUrl);
          const imgBuf = await imgResp.arrayBuffer();

          // Check size to prevent OOM
          const sizeMB = imgBuf.byteLength / 1024 / 1024;
          if (sizeMB > 5) {
            console.warn(`[start-image-edit-job] Image too large (${sizeMB.toFixed(2)}MB), skipping`);
            continue;
          }

          imageParts.push({
            inlineData: {
              mimeType: upload.mime_type || "image/png",
              data: encodeBase64(imgBuf)
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
      getGeminiModelUrl(AI_MODELS.IMAGE_GENERATION.model, nanoBananaKey),
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
      console.error("[start-image-edit-job] AI API error:", aiResponse.status, errorText);
      await logEvent("error", `AI processing failed: ${aiResponse.status}`, 0);
      await supabase.from("image_edit_jobs").update({
        status: "failed",
        last_error: `AI processing failed: ${aiResponse.status} - ${errorText.substring(0, 200)}`
      }).eq("id", job_id);
      return new Response(
        JSON.stringify({ error: "AI processing failed", details: errorText.substring(0, 200) }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Use a more memory-efficient way to get JSON if possible, but for Deno fetch, .json() is standard.
    // The main OOM trigger was likely logging JSON.stringify of the entire data.
    const aiData = await aiResponse.json();
    console.log("[start-image-edit-job] AI response received successfully. Candidate count:", aiData.candidates?.length || 0);

    // Extract image from Gemini response - look for inlineData with image (camelCase from API)
    let generatedImageBase64: string | null = null;
    const candidates = aiData.candidates || [];
    for (const candidate of candidates) {
      const parts = candidate.content?.parts || [];
      for (const part of parts) {
        // API returns camelCase: inlineData, mimeType
        if (part.inlineData?.mimeType?.startsWith("image/")) {
          generatedImageBase64 = part.inlineData.data;
          console.log("[start-image-edit-job] Found image in response part. MimeType:", part.inlineData.mimeType);
          break;
        }
      }
      if (generatedImageBase64) break;
    }

    if (!generatedImageBase64) {
      console.error("[start-image-edit-job] No image in response candidates.");
      await logEvent("error", "No image generated by AI", 0);
      await supabase.from("image_edit_jobs").update({
        status: "failed",
        last_error: "No image generated by AI - check Gemini logs"
      }).eq("id", job_id);
      return new Response(
        JSON.stringify({ error: "No image generated" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    await logEvent("info", "Saving output image...", 85);

    // Decode base64 to upload - using standard library for efficiency
    const imageData = decodeBase64(generatedImageBase64);
    console.log("[start-image-edit-job] Image decoded successfully. Byte length:", imageData.length);
    await logEvent("info", `Image decoded (${(imageData.length / 1024 / 1024).toFixed(2)}MB). Uploading...`, 90);

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
