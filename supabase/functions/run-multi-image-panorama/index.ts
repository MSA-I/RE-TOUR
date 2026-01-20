import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const API_NANOBANANA = Deno.env.get("API_NANOBANANA");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Multi-Image Panorama prompt template - evidence-based, no hallucination
const MULTI_IMAGE_PANORAMA_PROMPT = (cameraPosition: string, forwardDirection: string, imageCount: number) => `
You are generating a TRUE 360° equirectangular interior panorama using MULTIPLE reference images as SPATIAL EVIDENCE.

CRITICAL INSTRUCTIONS - EVIDENCE-BASED GENERATION:

You have been provided with ${imageCount} reference images. These are NOT style references - they are SPATIAL EVIDENCE.

TREAT EACH IMAGE AS:
- Architectural ground truth
- Spatial evidence showing room layout
- Layout constraints for geometry
- Furniture placement documentation

EXTRACTION REQUIREMENTS:
1. Extract geometry, room layout, openings, walls from ALL images
2. Reconcile information between images to build coherent space
3. PRIORITIZE floor plan images for structural layout
4. PRIORITIZE rendered images for materials and furniture appearance
5. Cross-reference all images to verify spatial relationships

FORBIDDEN - ABSOLUTE NO HALLUCINATION:
- Do NOT invent rooms that are not visible in ANY reference
- Do NOT add openings (doors, windows) not shown in references
- Do NOT add furniture not evidenced in the references
- Do NOT extend spaces beyond what is documented
- Do NOT guess or "complete" areas with missing information

IF INFORMATION IS MISSING:
- Keep undefined areas neutral and simple
- Fade gracefully into neutral space
- Do NOT fabricate details to fill gaps
- Better incomplete than incorrect

Camera:
- Height: standing eye level (~1.6m)
- Position: ${cameraPosition}

Primary forward direction (0° yaw):
- Facing ${forwardDirection}

PANORAMA REQUIREMENTS (Same as Step 4):
- True 360° equirectangular panorama (2:1 aspect ratio)
- No fisheye circle distortion
- Correct straight verticals
- Proper perspective without warping
- Suitable for virtual tour viewers

LIGHTING:
- Natural daylight from windows as evidenced in references
- Physically correct light direction
- Realistic falloff based on reference images

STYLE:
- Photorealistic interior matching reference aesthetics
- Real-world scale matching floor plan proportions
- Materials and finishes as shown in render references

OUTPUT LABEL: Multi-Image Panorama (Evidence-Based)

PRINCIPLE: Better incomplete truth than complete fiction.
`;

async function emitEvent(
  supabase: any,
  jobId: string,
  ownerId: string,
  type: string,
  message: string,
  progress: number
) {
  await supabase.from("multi_image_panorama_events").insert({
    job_id: jobId,
    owner_id: ownerId,
    type,
    message,
    progress_int: progress,
  });
}

async function updateJob(
  supabase: any,
  jobId: string,
  updates: Record<string, any>
) {
  await supabase
    .from("multi_image_panorama_jobs")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", jobId);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization header");

    const supabaseUser = createClient(
      SUPABASE_URL,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) throw new Error("Unauthorized");

    const { job_id } = await req.json();
    if (!job_id) throw new Error("job_id is required");

    // Get job
    const { data: job, error: jobError } = await supabaseAdmin
      .from("multi_image_panorama_jobs")
      .select("*")
      .eq("id", job_id)
      .eq("owner_id", user.id)
      .single();

    if (jobError || !job) throw new Error("Job not found");

    const inputUploadIds = job.input_upload_ids as string[];
    if (!inputUploadIds || inputUploadIds.length < 2) {
      throw new Error("At least 2 input images required");
    }

    // Update status to running
    await updateJob(supabaseAdmin, job_id, { status: "running", progress_int: 5 });
    await emitEvent(supabaseAdmin, job_id, user.id, "start", "Starting multi-image panorama generation...", 5);

    // Fetch all input images
    await emitEvent(supabaseAdmin, job_id, user.id, "fetch", `Fetching ${inputUploadIds.length} input images...`, 10);

    const inputImages: Array<{ base64: string; mimeType: string; filename: string }> = [];

    for (let i = 0; i < inputUploadIds.length; i++) {
      const uploadId = inputUploadIds[i];

      // Get upload details
      const { data: upload } = await supabaseAdmin
        .from("uploads")
        .select("bucket, path, original_filename")
        .eq("id", uploadId)
        .single();

      if (!upload) {
        console.log(`Upload ${uploadId} not found, skipping`);
        continue;
      }

      // Download the file
      const { data: fileData, error: downloadError } = await supabaseAdmin.storage
        .from(upload.bucket)
        .download(upload.path);

      if (downloadError || !fileData) {
        console.log(`Failed to download ${upload.path}, skipping`);
        continue;
      }

      const buffer = await fileData.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
      );
      const mimeType = fileData.type || "image/jpeg";

      inputImages.push({
        base64,
        mimeType,
        filename: upload.original_filename || `image_${i + 1}`,
      });

      await emitEvent(
        supabaseAdmin,
        job_id,
        user.id,
        "fetch",
        `Loaded image ${i + 1}/${inputUploadIds.length}: ${upload.original_filename || "image"}`,
        10 + Math.floor((i / inputUploadIds.length) * 20)
      );
    }

    if (inputImages.length < 2) {
      throw new Error("Could not load at least 2 valid input images");
    }

    // Build the prompt
    const cameraPosition = job.camera_position || "center of the main living space at eye-level";
    const forwardDirection = job.forward_direction || "toward the primary focal point";
    const prompt = MULTI_IMAGE_PANORAMA_PROMPT(cameraPosition, forwardDirection, inputImages.length);

    await updateJob(supabaseAdmin, job_id, { prompt_used: prompt, progress_int: 35 });
    await emitEvent(supabaseAdmin, job_id, user.id, "prompt", "Built evidence-based panorama prompt", 35);

    // Call Nano Banana (Google Gemini) with multi-image input
    await emitEvent(supabaseAdmin, job_id, user.id, "generate", "Calling Nano Banana with multi-image input...", 40);

    const imageParts = inputImages.map((img) => ({
      inlineData: {
        mimeType: img.mimeType,
        data: img.base64,
      },
    }));

    const geminiPayload = {
      contents: [
        {
          parts: [
            ...imageParts,
            { text: prompt },
          ],
        },
      ],
      generationConfig: {
        responseModalities: ["image", "text"],
        temperature: 0.8,
      },
    };

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${API_NANOBANANA}`;

    const geminiResponse = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(geminiPayload),
    });

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      console.error("Gemini API error:", errorText);
      throw new Error(`Gemini API error: ${geminiResponse.status}`);
    }

    const geminiData = await geminiResponse.json();
    await emitEvent(supabaseAdmin, job_id, user.id, "generate", "Received response from Nano Banana", 70);

    // Extract output image
    let outputBase64: string | null = null;
    let outputMimeType = "image/png";

    const candidates = geminiData.candidates || [];
    for (const candidate of candidates) {
      const parts = candidate.content?.parts || [];
      for (const part of parts) {
        if (part.inlineData) {
          outputBase64 = part.inlineData.data;
          outputMimeType = part.inlineData.mimeType || "image/png";
          break;
        }
      }
      if (outputBase64) break;
    }

    if (!outputBase64) {
      throw new Error("No image generated by Nano Banana");
    }

    await emitEvent(supabaseAdmin, job_id, user.id, "upload", "Uploading panorama output...", 80);

    // Upload the output
    const outputBuffer = Uint8Array.from(atob(outputBase64), (c) => c.charCodeAt(0));
    const fileExt = outputMimeType.includes("png") ? "png" : "jpg";
    const outputPath = `${user.id}/${job.project_id}/multi_panorama_${job_id}_${Date.now()}.${fileExt}`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from("outputs")
      .upload(outputPath, outputBuffer, { contentType: outputMimeType });

    if (uploadError) {
      throw new Error(`Failed to upload output: ${uploadError.message}`);
    }

    // Create upload record
    const { data: uploadRecord, error: recordError } = await supabaseAdmin
      .from("uploads")
      .insert({
        project_id: job.project_id,
        owner_id: user.id,
        bucket: "outputs",
        path: outputPath,
        kind: "output",
        mime_type: outputMimeType,
        original_filename: `multi_panorama_${job_id}.${fileExt}`,
      })
      .select()
      .single();

    if (recordError) {
      throw new Error(`Failed to create upload record: ${recordError.message}`);
    }

    await emitEvent(supabaseAdmin, job_id, user.id, "complete", "Multi-image panorama generated successfully!", 100);

    // Update job as completed
    await updateJob(supabaseAdmin, job_id, {
      status: "completed",
      output_upload_id: uploadRecord.id,
      progress_int: 100,
      progress_message: "Completed",
    });

    // Create notification
    await supabaseAdmin.from("notifications").insert({
      owner_id: user.id,
      project_id: job.project_id,
      type: "multi_panorama_complete",
      title: "Multi-Image Panorama Complete",
      message: `Evidence-based panorama generated from ${inputImages.length} sources`,
      target_route: `/projects/${job.project_id}`,
      target_params: { tab: "multi-image-panorama" },
    });

    return new Response(
      JSON.stringify({ success: true, output_upload_id: uploadRecord.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Multi-image panorama error:", error);

    // Try to update job status to failed
    try {
      const { job_id } = await req.json().catch(() => ({}));
      if (job_id) {
        await supabaseAdmin
          .from("multi_image_panorama_jobs")
          .update({
            status: "failed",
            last_error: error instanceof Error ? error.message : "Unknown error",
            updated_at: new Date().toISOString(),
          })
          .eq("id", job_id);
      }
    } catch {}

    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
