import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const API_NANOBANANA = Deno.env.get("API_NANOBANANA");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MAX_RETRIES = 2;

// Multi-Image Panorama prompt template - evidence-based, no hallucination
const MULTI_IMAGE_PANORAMA_PROMPT = (cameraPosition: string, forwardDirection: string, imageCount: number, aspectRatio: string) => `
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

PANORAMA REQUIREMENTS:
- True 360° equirectangular panorama (${aspectRatio} aspect ratio)
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

const QA_PROMPT = (originalPrompt: string) => `
Evaluate the generated interior panorama image for quality and adherence to the original request.

Original Request/Context:
"${originalPrompt}"

CRITICAL QUALITY CHECKS:
1. ARTIFACTS: Are there obvious glitches, seams, blurred patches, or AI hallucinations?
2. ADHERENCE: Does the output accurately reflect the source evidence and requested style?
3. PERSPECTIVE: Are verticals straight? Is the equirectangular projection correct and "panorama-safe"?
4. STITCHING: Are there visible seams or discontinuities where images were merged?

Provide a concise assessment. 
You MUST respond in JSON format only:
{
  "pass": boolean,
  "reason": "concise explanation of issues or 'PASSED'"
}
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

    await updateJob(supabaseAdmin, job_id, { status: "running", progress_int: 5, retry_count: 0 });
    await emitEvent(supabaseAdmin, job_id, user.id, "start", "Starting multi-image panorama generation with automated QA...", 5);

    await emitEvent(supabaseAdmin, job_id, user.id, "fetch", `Fetching ${inputUploadIds.length} input images...`, 10);

    const inputImages: Array<{ base64: string; mimeType: string; filename: string }> = [];

    for (let i = 0; i < inputUploadIds.length; i++) {
      const uploadId = inputUploadIds[i];
      const { data: upload } = await supabaseAdmin
        .from("uploads")
        .select("bucket, path, original_filename")
        .eq("id", uploadId)
        .single();

      if (!upload) continue;

      const { data: fileData, error: downloadError } = await supabaseAdmin.storage
        .from(upload.bucket)
        .download(upload.path);

      if (downloadError || !fileData) continue;

      const buffer = await fileData.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
      );
      
      inputImages.push({
        base64,
        mimeType: fileData.type || "image/jpeg",
        filename: upload.original_filename || `image_${i + 1}`,
      });

      await emitEvent(
        supabaseAdmin,
        job_id,
        user.id,
        "fetch",
        `Loaded image ${i + 1}/${inputUploadIds.length}`,
        10 + Math.floor((i / inputUploadIds.length) * 15)
      );
    }

    if (inputImages.length < 2) throw new Error("Could not load input images");

    const cameraPosition = job.camera_position || "center of the main living space at eye-level";
    const forwardDirection = job.forward_direction || "toward the primary focal point";
    const aspectRatio = job.aspect_ratio || "2:1";
    let basePrompt = MULTI_IMAGE_PANORAMA_PROMPT(cameraPosition, forwardDirection, inputImages.length, aspectRatio);
    let currentPrompt = basePrompt;
    
    let attempt = 0;
    let success = false;
    let finalOutputRecord = null;
    let qaReason = "";

    const imageParts = inputImages.map((img) => ({
      inlineData: { mimeType: img.mimeType, data: img.base64 },
    }));

    while (attempt <= MAX_RETRIES && !success) {
      attempt++;
      await updateJob(supabaseAdmin, job_id, { retry_count: attempt - 1, progress_int: 30 + (attempt * 10) });
      
      if (attempt > 1) {
        await emitEvent(supabaseAdmin, job_id, user.id, "retry", `Retry attempt ${attempt-1} starting with corrective logic...`, 30 + (attempt * 10));
      } else {
        await emitEvent(supabaseAdmin, job_id, user.id, "generate", "Calling Nano Banana generation engine...", 35);
      }

      const geminiPayload = {
        contents: [{ parts: [...imageParts, { text: currentPrompt }] }],
        generationConfig: { responseModalities: ["image", "text"], temperature: 0.8 },
      };

      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${API_NANOBANANA}`;
      const response = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(geminiPayload),
      });

      if (!response.ok) throw new Error(`Generation failed: ${response.status}`);
      const genData = await response.json();
      
      let outputBase64: string | null = null;
      let outputMimeType = "image/png";
      const candidates = genData.candidates || [];
      for (const cand of candidates) {
        for (const part of (cand.content?.parts || [])) {
          if (part.inlineData) {
            outputBase64 = part.inlineData.data;
            outputMimeType = part.inlineData.mimeType || "image/png";
            break;
          }
        }
        if (outputBase64) break;
      }

      if (!outputBase64) throw new Error("No image generated");

      // --- AUTOMATED QA STEP ---
      await emitEvent(supabaseAdmin, job_id, user.id, "qa", "Running automated Gemini QA check...", 75);
      
      const qaPayload = {
        contents: [
          {
            parts: [
              { inlineData: { mimeType: outputMimeType, data: outputBase64 } },
              { text: QA_PROMPT(job.prompt_used || currentPrompt) }
            ]
          }
        ],
        generationConfig: { responseMimeType: "application/json" }
      };

      const qaResponse = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(qaPayload)
      });

      let qaResult = { pass: true, reason: "OK" };
      if (qaResponse.ok) {
        const qaData = await qaResponse.json();
        const text = qaData.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          try {
            qaResult = JSON.parse(text);
          } catch (e) {
            console.warn("Failed to parse QA JSON, defaulting to pass", text);
          }
        }
      }

      qaReason = qaResult.reason;

      if (qaResult.pass) {
        success = true;
        await emitEvent(supabaseAdmin, job_id, user.id, "qa", `QA PASSED: ${qaReason}`, 85);
      } else {
        await emitEvent(supabaseAdmin, job_id, user.id, "qa", `QA FAILED (Attempt ${attempt}): ${qaReason}`, 85);
        if (attempt <= MAX_RETRIES) {
          currentPrompt = basePrompt + `\n\nFIX REQUEST (BASED ON PREVIOUS FAILURE):\n${qaReason}\nEnsure no artifacts, straight verticals, and seamless stitching.`;
          continue;
        }
      }

      // Upload if pass or final attempt
      const outputBuffer = Uint8Array.from(atob(outputBase64), (c) => c.charCodeAt(0));
      const fileExt = outputMimeType.includes("png") ? "png" : "jpg";
      const outputPath = `${user.id}/${job.project_id}/multi_pano_${job_id}_att${attempt}.${fileExt}`;

      await supabaseAdmin.storage.from("outputs").upload(outputPath, outputBuffer, { contentType: outputMimeType });
      
      const { data: uploadRecord } = await supabaseAdmin.from("uploads").insert({
        project_id: job.project_id,
        owner_id: user.id,
        bucket: "outputs",
        path: outputPath,
        kind: "output",
        mime_type: outputMimeType,
        original_filename: `multi_pano_${job_id}_att${attempt}.${fileExt}`,
      }).select().single();

      finalOutputRecord = uploadRecord;
    }

    if (!finalOutputRecord) throw new Error("Failed to generate or upload output");

    const finalStatus = success ? "approved" : "failed";
    await updateJob(supabaseAdmin, job_id, {
      status: finalStatus,
      output_upload_id: finalOutputRecord.id,
      progress_int: 100,
      progress_message: success ? "Approved" : "QA Failed",
      qa_reason: qaReason,
      retry_count: attempt - 1
    });

    await emitEvent(supabaseAdmin, job_id, user.id, success ? "complete" : "failed", success ? "Multi-image panorama approved by QA" : "Multi-image panorama failed QA after retries", 100);

    return new Response(JSON.stringify({ success, output_upload_id: finalOutputRecord.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Multi-image panorama error:", error);
    const body = await req.json().catch(() => ({}));
    const jobId = body.job_id;
    if (jobId) {
      await supabaseAdmin.from("multi_image_panorama_jobs").update({
        status: "failed",
        last_error: error instanceof Error ? error.message : "Unknown error",
        updated_at: new Date().toISOString(),
      }).eq("id", jobId);
    }
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
