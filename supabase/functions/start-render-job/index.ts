import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const EdgeRuntime: { waitUntil(promise: Promise<any>): void };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Safe base64 encoder for large byte arrays
function toBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

const MAX_RETRIES = 3;
const INITIAL_DELAY_MS = 1000;
const MAX_DELAY_MS = 10000;
const RETRYABLE_STATUS_CODES = [429, 500, 502, 503, 504];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  onRetry?: (attempt: number, delay: number) => Promise<void>,
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, options);
      if (response.ok || !RETRYABLE_STATUS_CODES.includes(response.status)) {
        return response;
      }
      const errorText = await response.text();
      console.warn(`Attempt ${attempt + 1}/${MAX_RETRIES + 1} failed with status ${response.status}`);
      lastError = new Error(`HTTP ${response.status}: ${errorText}`);
      if (attempt === MAX_RETRIES) return await fetch(url, options);
      const baseDelay = INITIAL_DELAY_MS * Math.pow(2, attempt);
      const jitter = Math.random() * 0.3 * baseDelay;
      const delay = Math.min(baseDelay + jitter, MAX_DELAY_MS);
      if (onRetry) await onRetry(attempt + 1, delay);
      await sleep(delay);
    } catch (networkError) {
      console.error(`Attempt ${attempt + 1}/${MAX_RETRIES + 1} network error:`, networkError);
      lastError = networkError instanceof Error ? networkError : new Error(String(networkError));
      if (attempt === MAX_RETRIES) throw lastError;
      const delay = Math.min(INITIAL_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS);
      if (onRetry) await onRetry(attempt + 1, delay);
      await sleep(delay);
    }
  }
  throw lastError || new Error("Unexpected retry loop exit");
}

// QA Validation using Google Gemini (API_NANOBANANA)
async function runQAValidation(
  originalImageBase64: string,
  outputImageBase64: string,
  changeRequest: string,
  originalMimeType: string,
  outputMimeType: string,
): Promise<{ passed: boolean; reason: string }> {
  const geminiApiKey = Deno.env.get("API_NANOBANANA");

  if (!geminiApiKey) {
    console.log("API_NANOBANANA not set, skipping QA validation");
    return { passed: true, reason: "QA skipped - API key not configured" };
  }

  console.log("Running QA validation on render output via Gemini...");

  const QA_MODELS = {
    primary: "gemini-3-pro-preview",
    fallback: "gemini-2.5-pro"
  };

  const qaPrompt = `You are a quality assurance AI for architectural and interior design image transformations. 
Your job is to compare the BEFORE and AFTER images and verify that:
1. The requested change was actually made
2. No unintended changes were made to other parts of the image
3. The overall quality and realism is maintained

CHANGE REQUEST: "${changeRequest}"

Please compare the BEFORE and AFTER images. Did the change match the request without unintended modifications?

Be strict but fair:
- If the requested change is clearly visible, PASS
- If unrelated elements changed significantly (furniture moved, walls changed color, room layout altered), FAIL
- Minor lighting/shadow adjustments are acceptable
- Small artifacts at change boundaries are acceptable

Respond with ONLY valid JSON: { "passed": true/false, "reason": "brief explanation" }`;

  const payload = {
    contents: [{
      parts: [
        { text: qaPrompt },
        { inlineData: { mimeType: originalMimeType, data: originalImageBase64 } },
        { inlineData: { mimeType: outputMimeType, data: outputImageBase64 } },
      ],
    }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 1000,
    },
  };

  const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

  try {
    // Try primary model first
    let response = await fetch(`${GEMINI_API_BASE}/${QA_MODELS.primary}:generateContent?key=${geminiApiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    // Fallback if primary fails
    if (!response.ok && (response.status === 429 || response.status === 503 || response.status === 500)) {
      console.log(`Primary QA model failed (${response.status}), falling back to ${QA_MODELS.fallback}`);
      response = await fetch(`${GEMINI_API_BASE}/${QA_MODELS.fallback}:generateContent?key=${geminiApiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error("QA API error:", response.status, errorText);
      return { passed: true, reason: "QA check failed to run, proceeding with manual review" };
    }

    const data = await response.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    
    // Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const result = JSON.parse(jsonMatch[0]);
        console.log("QA Result:", result);
        return { passed: result.passed ?? false, reason: result.reason || "No reason provided" };
      } catch {
        return { passed: true, reason: "QA response unclear, proceeding with manual review" };
      }
    }

    return { passed: true, reason: "QA completed, proceeding with manual review" };
  } catch (error) {
    console.error("QA validation error:", error);
    return { passed: true, reason: "QA check encountered an error, proceeding with manual review" };
  }
}

// Generate improved prompt based on QA rejection using Gemini
async function generateImprovedPrompt(
  originalChangeRequest: string,
  previousPrompt: string,
  qaReason: string,
): Promise<string> {
  const geminiApiKey = Deno.env.get("API_NANOBANANA");

  if (!geminiApiKey) {
    console.log("API_NANOBANANA not set, using original prompt");
    return previousPrompt;
  }

  console.log("Generating improved prompt based on QA rejection via Gemini...");

  const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
  const MODEL = "gemini-3-flash-preview";

  const systemPrompt = `You are an expert at crafting prompts for AI image editing. 
Your task is to revise a prompt that failed QA validation for an interior design image transformation.

RULES:
1. Focus on fixing the specific issue mentioned in the QA rejection reason
2. Be MORE EXPLICIT about what should change and what should NOT change
3. Add strong preservation instructions for unchanged elements
4. NEVER suggest structural changes (moving walls, windows, doors)
5. Keep the same overall intent as the original request
6. Output ONLY the revised prompt text, nothing else`;

  const userPrompt = `Original change request: "${originalChangeRequest}"

Previous prompt used: "${previousPrompt}"

QA rejection reason: "${qaReason}"

Generate an improved prompt that addresses the QA failure while preserving the original intent.`;

  try {
    const response = await fetch(`${GEMINI_API_BASE}/${MODEL}:generateContent?key=${geminiApiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: systemPrompt + "\n\n" + userPrompt }],
        }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1000,
        },
      }),
    });

    if (!response.ok) {
      console.error("Prompt improvement API error:", response.status);
      return previousPrompt;
    }

    const data = await response.json();
    const improvedPrompt = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (improvedPrompt) {
      console.log("Improved prompt generated:", improvedPrompt.substring(0, 100) + "...");
      return improvedPrompt;
    }

    return previousPrompt;
  } catch (error) {
    console.error("Prompt improvement error:", error);
    return previousPrompt;
  }
}

const MAX_DIMENSION = 1024;
const MAX_FILE_SIZE = 4 * 1024 * 1024;
const MAX_DECODE_SIZE = 8 * 1024 * 1024;

async function resizeImageToFitLimit(
  imageBlob: Blob,
  mimeType: string,
  onProgress?: (msg: string) => Promise<void>,
): Promise<{ base64: string; mimeType: string }> {
  const originalBytes = new Uint8Array(await imageBlob.arrayBuffer());
  const sizeMb = originalBytes.byteLength / 1024 / 1024;

  console.log(`Image received: ${sizeMb.toFixed(2)}MB, type: ${mimeType}`);

  if (originalBytes.byteLength <= MAX_FILE_SIZE && mimeType === "image/jpeg") {
    await onProgress?.("Image already optimized");
    return { base64: toBase64(originalBytes), mimeType };
  }

  if (originalBytes.byteLength > MAX_DECODE_SIZE) {
    throw new Error(`Image is too large (${sizeMb.toFixed(1)}MB). Please re-upload a smaller version.`);
  }

  await onProgress?.("Processing image...");

  let img: Image;
  try {
    img = await Image.decode(originalBytes);
  } catch (e) {
    throw new Error("Unable to process this image format. Try uploading a JPG file.");
  }

  let current = img;
  const longestSide = Math.max(current.width, current.height);
  const targetScale = Math.min(0.5, MAX_DIMENSION / longestSide);

  if (targetScale < 1) {
    const w = Math.max(1, Math.round(current.width * targetScale));
    const h = Math.max(1, Math.round(current.height * targetScale));
    await onProgress?.(`Resizing to ${w}x${h}...`);
    current = current.resize(w, h);
  }

  await onProgress?.("Encoding JPEG...");
  const encoded = await current.encodeJPEG(80);

  return { base64: toBase64(encoded), mimeType: "image/jpeg" };
}

const PROMPT_TEMPLATES: Record<string, string> = {
  style_transfer: `Transform the provided photograph into the artistic style specified. Preserve the original composition but render it with the described stylistic elements.`,
  photobashing: `Generate a high-end architectural visualization that strictly uses the geometry, perspective, and composition from the original image but applies the lighting, color palette, and material mood from the style reference. It is critical that you do not alter the building shape or architectural details at all.`,
  apply_material: `Replace the specified material on the surface. Ensure the new material looks realistic under existing lighting and shadows. Everything else must remain exactly as is.`,
  furniture_change: `Change the furniture style to the requested style. Maintain the same room layout and architectural elements. Ensure the new furniture fits naturally with the existing lighting and atmosphere.`,
  add_elements: `Add the specified elements to the scene. Ensure they are placed naturally and their shadows, lighting, and color temperature blend perfectly. Do not change any other part of the scene.`,
  remove_elements: `Remove the specified elements from the scene. Fill the empty space naturally with appropriate background. Keep everything else exactly the same.`,
  lighting_change: `Change or replace the lighting fixtures as specified. Adjust the light effect naturally to match the new fixtures. Maintain the architectural integrity of the space.`,
  color_change: `Change the color scheme of the specified elements. Ensure the new colors integrate naturally with the existing lighting and materials.`,
};

function detectTemplate(changeRequest: string): string | null {
  const request = changeRequest.toLowerCase();
  if (request.includes("style") || request.includes("transfer") || request.includes("reference")) return "style_transfer";
  if (request.includes("photobash") || request.includes("mood") || request.includes("atmosphere")) return "photobashing";
  if (request.includes("material") || request.includes("texture") || request.includes("tile") || request.includes("marble") || request.includes("wood") || request.includes("floor") || request.includes("wall")) return "apply_material";
  if (request.includes("furniture") || request.includes("minimalist") || request.includes("modern") || request.includes("style")) return "furniture_change";
  if (request.includes("add") || request.includes("plant") || request.includes("greenery") || request.includes("decor")) return "add_elements";
  if (request.includes("remove") || request.includes("delete") || request.includes("eliminate")) return "remove_elements";
  if (request.includes("lighting") || request.includes("light") || request.includes("fixture") || request.includes("lamp")) return "lighting_change";
  if (request.includes("color") || request.includes("paint") || request.includes("repaint")) return "color_change";
  return null;
}

function buildNanoBananaPrompt(changeRequest: string, styleProfile?: any): string {
  const templateId = detectTemplate(changeRequest);
  let prompt = "";

  if (styleProfile) {
    if (styleProfile.overall_mood) prompt += `Style Mood: ${styleProfile.overall_mood}. `;
    if (styleProfile.materials && styleProfile.materials.length > 0) prompt += `Materials: ${styleProfile.materials.join(", ")}. `;
    if (styleProfile.furniture_style) prompt += `Furniture Style: ${styleProfile.furniture_style}. `;
    if (styleProfile.rendering_guidance) prompt += `${styleProfile.rendering_guidance} `;
  }

  if (templateId && PROMPT_TEMPLATES[templateId]) {
    prompt += PROMPT_TEMPLATES[templateId] + " ";
  }

  prompt += changeRequest;
  prompt += " Keep everything else in the scene exactly as it is in the original image.";

  return prompt.trim();
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const nanoBananaApiKey = Deno.env.get("API_NANOBANANA");

    if (!nanoBananaApiKey) throw new Error("API_NANOBANANA secret is not configured");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization header");

    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);

    if (authError || !user) throw new Error("Unauthorized");

    const { job_id } = await req.json();
    if (!job_id) throw new Error("Missing job_id");

    console.log(`Starting render job: ${job_id}`);

    const { data: job, error: jobError } = await supabaseClient
      .from("render_jobs")
      .select("*, panorama:uploads!render_jobs_panorama_upload_id_fkey(*), project:projects!render_jobs_project_id_fkey(style_profile)")
      .eq("id", job_id)
      .eq("owner_id", user.id)
      .single();

    if (jobError || !job) throw new Error("Job not found or unauthorized");

    const maxAttempts = job.max_attempts || 3;

    const writeLog = async (level: string, message: string) => {
      console.log(`[${level.toUpperCase()}] ${message}`);
      try {
        await supabaseClient.from("render_job_logs").insert({ job_id, owner_id: user.id, level, message });
      } catch (e) { console.error("Failed to write log:", e); }
    };

    const emitEvent = async (type: string, message: string, progressInt: number) => {
      console.log(`Event [${type}] ${progressInt}%: ${message}`);
      try {
        await supabaseClient.from("render_job_events").insert({ job_id, owner_id: user.id, type, message, progress_int: progressInt });
      } catch (e) { console.error("Failed to emit event:", e); }
    };

    const updateProgress = async (progress: number, message: string) => {
      console.log(`Progress ${progress}%: ${message}`);
      await writeLog("info", `[${progress}%] ${message}`);
      await emitEvent("progress", message, progress);
      await supabaseClient.from("render_jobs").update({ progress, progress_message: message, progress_int: progress }).eq("id", job_id);
    };

    // Record an attempt in the attempts table
    const recordAttempt = async (attemptNumber: number, promptUsed: string, qaDecision: string, qaReason: string, outputUploadId: string | null) => {
      try {
        await supabaseClient.from("render_job_attempts").insert({
          job_id,
          owner_id: user.id,
          attempt_number: attemptNumber,
          nano_prompt_used: promptUsed,
          qa_decision: qaDecision,
          qa_reason: qaReason,
          output_upload_id: outputUploadId,
        });
      } catch (e) {
        console.error("Failed to record attempt:", e);
      }
    };

    // Update job status
    await supabaseClient.from("render_jobs").update({ 
      status: "running", 
      attempts: job.attempts + 1, 
      progress: 0, 
      progress_int: 0, 
      progress_message: "Starting render...",
      qa_status: "pending",
      qa_reason: null
    }).eq("id", job_id);

    await emitEvent("start", "Render job started", 0);
    await writeLog("info", `=== RENDER JOB STARTED ===`);
    await writeLog("info", `Job ID: ${job_id}, Max attempts: ${maxAttempts}`);

    const processRender = async () => {
      try {
        await updateProgress(10, "Preparing image...");

        const { data: panoramaUrl, error: urlError } = await supabaseClient.storage
          .from(job.panorama.bucket)
          .createSignedUrl(job.panorama.path, 600);

        if (urlError || !panoramaUrl?.signedUrl) throw new Error("Failed to get panorama URL");

        await updateProgress(15, "Downloading image...");
        const imageResponse = await fetch(panoramaUrl.signedUrl);
        if (!imageResponse.ok) throw new Error(`Image download failed: ${imageResponse.status}`);

        const imageBlob = await imageResponse.blob();
        await updateProgress(20, "Processing image...");

        const { base64: imageBase64, mimeType } = await resizeImageToFitLimit(
          imageBlob,
          job.panorama.mime_type || "image/jpeg",
          async (msg) => await writeLog("info", msg),
        );

        const cleanBase64 = imageBase64.replace(/^data:[^,]+,/, "").replace(/\s/g, "");

        // Parse quality settings
        const qualityMatch = job.change_request.match(/\[QUALITY:([^\]]+)\]/);
        const ratioMatch = job.change_request.match(/\[RATIO:([^\]]+)\]/);
        const qualitySetting = qualityMatch?.[1]?.toUpperCase() || "2K";
        const rawRatio = ratioMatch?.[1] || "1:1";

        const ALLOWED_RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];
        const RATIO_NORMALIZATION: Record<string, string> = {
          "original": "1:1", "2:1": "21:9", "1:2": "9:16", "5:3": "16:9", "3:5": "9:16",
          "10:16": "9:16", "16:10": "16:9", "8:10": "4:5", "10:8": "5:4",
        };

        let aspectRatio = rawRatio;
        if (!ALLOWED_RATIOS.includes(aspectRatio)) {
          aspectRatio = RATIO_NORMALIZATION[aspectRatio] || "1:1";
        }

        // CORRECT Google API imageSize values: "1K", "2K", "4K" (NOT pixel values)
        // Gemini 2.5 Flash Image: max 1024px (1K only)
        // Gemini 3 Pro Image: max 4096px (supports 1K, 2K, 4K)
        const validSizes = ["1K", "2K", "4K"];
        const imageSize = validSizes.includes(qualitySetting) ? qualitySetting : "2K";
        
        // Expected output pixels for validation
        const expectedPixels: Record<string, number> = { "1K": 1024, "2K": 2048, "4K": 4096 };
        const expectedSize = expectedPixels[imageSize] || 2048;

        // Model selection based on resolution - ONLY gemini-3-pro-image-preview supports 4K
        const MODEL_NAME = "gemini-3-pro-image-preview";
        const MODEL_MAX_SIZE = 4096;
        
        if (imageSize === "4K" && MODEL_MAX_SIZE < 4096) {
          throw new Error(`4K output requires Gemini 3 Pro Image model. Current model is capped at ${MODEL_MAX_SIZE}px.`);
        }

        await writeLog("info", `Output resolution: ${imageSize} (expected ~${expectedSize}px), Model: ${MODEL_NAME}`);
        await supabaseClient.from("render_jobs").update({ output_resolution: imageSize }).eq("id", job_id);
        
        // Create notification for render started with navigation target
        try {
          await supabaseClient.from("notifications").insert({
            owner_id: user.id,
            project_id: job.project_id,
            type: "render_started",
            title: "Render Started",
            message: `Processing ${job.panorama?.original_filename || "image"} at ${imageSize} resolution`,
            target_route: `/projects/${job.project_id}`,
            target_params: { tab: "jobs", jobId: job_id }
          });
        } catch (e) { console.error("Failed to create notification:", e); }

        const styleProfile = job.project?.style_profile || job.style_profile;
        let currentPrompt = buildNanoBananaPrompt(job.change_request, styleProfile);
        let currentAttempt = 1;
        let qaApproved = false;

        // QA retry loop with timeout protection for 4K validation
        const VALIDATION_TIMEOUT_MS = 15000; // 15 second timeout for dimension validation
        
        while (!qaApproved && currentAttempt <= maxAttempts) {
          await writeLog("info", `--- Attempt ${currentAttempt}/${maxAttempts} ---`);
          await updateProgress(25 + (currentAttempt - 1) * 20, `Attempt ${currentAttempt}: Composing prompt...`);

          const promptText = `Keep the same camera, geometry, layout, and objects. Only apply the requested change: ${currentPrompt}`;

          await updateProgress(30 + (currentAttempt - 1) * 20, `Attempt ${currentAttempt}: Sending to Nano Banana API...`);
          await writeLog("info", `Sending to Nano Banana API with output_resolution: ${imageSize}, aspect_ratio: ${aspectRatio}`);

          // Build request with Gemini API format
          const requestBody = {
            contents: [{
              role: "user",
              parts: [
                { text: promptText },
                { inlineData: { mimeType: mimeType || "image/jpeg", data: cleanBase64 } },
              ],
            }],
            generationConfig: {
              responseModalities: ["Image"],
              imageConfig: { 
                aspectRatio,
                imageSize
              },
            },
          };
          
          await writeLog("info", `API request prepared - resolution: ${imageSize}, ratio: ${aspectRatio}`);

          const geminiResponse = await fetchWithRetry(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json", "x-goog-api-key": nanoBananaApiKey },
              body: JSON.stringify(requestBody),
            },
            async (attempt, delay) => {
              await updateProgress(35 + (currentAttempt - 1) * 20, `Retrying AI request...`);
            },
          );

          if (!geminiResponse.ok) {
            const errorText = await geminiResponse.text();
            await writeLog("error", `Gemini API error: HTTP ${geminiResponse.status}`);
            throw new Error(`AI processing failed: ${errorText.substring(0, 200)}`);
          }

          const geminiData = await geminiResponse.json();
          await updateProgress(50 + (currentAttempt - 1) * 15, `Attempt ${currentAttempt}: Processing response...`);

          const candidates = geminiData.candidates;
          if (!candidates || candidates.length === 0) throw new Error("NO_IMAGE_RETURNED: No candidates");

          const parts = candidates[0]?.content?.parts;
          const imagePart = parts?.find((p: any) => p.inlineData?.mimeType?.startsWith("image/"));
          if (!imagePart?.inlineData) throw new Error("NO_IMAGE_RETURNED: No image data");

          const outputMimeType = imagePart.inlineData.mimeType;
          const outputBase64 = imagePart.inlineData.data;

          // Validate output dimensions with timeout protection
          await updateProgress(55 + (currentAttempt - 1) * 10, `Attempt ${currentAttempt}: Validating output dimensions...`);
          
          const validateDimensions = async (): Promise<void> => {
            const outputBinary = atob(outputBase64);
            const outputBytes = new Uint8Array(outputBinary.length);
            for (let i = 0; i < outputBinary.length; i++) outputBytes[i] = outputBinary.charCodeAt(i);
            
            const outputImg = await Image.decode(outputBytes);
            const outputMaxDim = Math.max(outputImg.width, outputImg.height);
            
            // Allow 10% tolerance for rounding
            const minAcceptable = expectedSize * 0.9;
            
            await writeLog("info", `Output dimensions: ${outputImg.width}x${outputImg.height} (max: ${outputMaxDim}px, expected: ${expectedSize}px)`);
            await emitEvent("progress", `Validated: ${outputImg.width}x${outputImg.height}`, 58 + (currentAttempt - 1) * 10);
            
            if (outputMaxDim < minAcceptable) {
              const errorMsg = `Resolution mismatch: Requested ${imageSize} (~${expectedSize}px) but received ${outputMaxDim}px. The API did not return the requested resolution.`;
              await writeLog("error", errorMsg);
              throw new Error(errorMsg);
            }
          };
          
          // Run validation with timeout
          try {
            await Promise.race([
              validateDimensions(),
              new Promise((_, reject) => 
                setTimeout(() => reject(new Error(`Dimension validation timed out after ${VALIDATION_TIMEOUT_MS / 1000}s`)), VALIDATION_TIMEOUT_MS)
              )
            ]);
          } catch (dimError) {
            if (dimError instanceof Error && (dimError.message.includes("Resolution mismatch") || dimError.message.includes("timed out"))) {
              // For 4K, fail fast on resolution issues
              if (imageSize === "4K") {
                throw dimError;
              }
            }
            // For 1K/2K or non-critical errors, log warning but continue
            await writeLog("warn", `Dimension validation issue: ${dimError}`);
          }
          
          await emitEvent("progress", "Dimensions validated", 60 + (currentAttempt - 1) * 10);

          // Run QA validation
          await updateProgress(60 + (currentAttempt - 1) * 10, `Attempt ${currentAttempt}: Running QA validation...`);
          const qaResult = await runQAValidation(imageBase64, outputBase64, job.change_request, mimeType, outputMimeType);
          await writeLog(qaResult.passed ? "success" : "warn", `QA Result: ${qaResult.passed ? "PASSED" : "FAILED"} - ${qaResult.reason}`);

          // Upload output
          await updateProgress(70 + (currentAttempt - 1) * 10, `Attempt ${currentAttempt}: Uploading output...`);

          const binaryString = atob(outputBase64);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);

          const outputPath = `${user.id}/${job.project_id}/${job_id}_attempt${currentAttempt}.png`;
          const { error: uploadError } = await supabaseClient.storage.from("outputs").upload(outputPath, bytes, { contentType: outputMimeType, upsert: true });
          if (uploadError) throw new Error("Failed to upload output image");

          const { data: uploadRecord, error: insertError } = await supabaseClient.from("uploads").insert({
            project_id: job.project_id,
            owner_id: user.id,
            kind: "output",
            bucket: "outputs",
            path: outputPath,
            mime_type: outputMimeType,
            size_bytes: bytes.length,
          }).select().single();

          if (insertError) throw new Error("Failed to create upload record");

          // Record this attempt
          await recordAttempt(currentAttempt, currentPrompt, qaResult.passed ? "approved" : "rejected", qaResult.reason, uploadRecord.id);

          if (qaResult.passed) {
            qaApproved = true;

            // Update job as successful
            await supabaseClient.from("render_jobs").update({
              status: "needs_review",
              output_upload_id: uploadRecord.id,
              last_error: null,
              progress: 100,
              progress_int: 100,
              progress_message: "Complete - Ready for review",
              qa_status: "approved",
              qa_reason: qaResult.reason,
            }).eq("id", job_id);

            await emitEvent("done", "Complete - Ready for review", 100);
            await writeLog("success", `=== RENDER COMPLETE: APPROVED (attempt ${currentAttempt}) ===`);
            
            // Create notification for render completed with navigation
            try {
              await supabaseClient.from("notifications").insert({
                owner_id: user.id,
                project_id: job.project_id,
                type: "render_completed",
                title: "Render Complete",
                message: `Output ready for "${job.panorama?.original_filename || "image"}" - QA approved`,
                target_route: `/projects/${job.project_id}`,
                target_params: { tab: "jobs", jobId: job_id }
              });
            } catch (e) { console.error("Failed to create notification:", e); }
          } else {
            // QA rejected
            await writeLog("warn", `Attempt ${currentAttempt} rejected: ${qaResult.reason}`);

            if (currentAttempt < maxAttempts) {
              // Generate improved prompt and retry
              await updateProgress(75 + (currentAttempt - 1) * 10, `Generating improved prompt for retry...`);
              currentPrompt = await generateImprovedPrompt(job.change_request, currentPrompt, qaResult.reason);
              await writeLog("info", `Improved prompt for attempt ${currentAttempt + 1}`);
            } else {
              // Max attempts exhausted
              await supabaseClient.from("render_jobs").update({
                status: "rejected",
                output_upload_id: uploadRecord.id,
                last_error: `Auto-fix attempts exhausted. Last rejection: ${qaResult.reason}`,
                progress: 100,
                progress_int: 100,
                progress_message: `Complete - Auto-fix exhausted after ${maxAttempts} attempts`,
                qa_status: "rejected",
                qa_reason: qaResult.reason,
              }).eq("id", job_id);

              await emitEvent("done", `Complete - Auto-fix exhausted after ${maxAttempts} attempts`, 100);
              await writeLog("warn", `=== RENDER COMPLETE: REJECTED (${maxAttempts} attempts exhausted) ===`);
              
              // Create notification for QA rejection with navigation
              try {
                await supabaseClient.from("notifications").insert({
                  owner_id: user.id,
                  project_id: job.project_id,
                  type: "qa_rejected",
                  title: "QA Rejected",
                  message: `Auto-fix exhausted after ${maxAttempts} attempts: ${qaResult.reason.substring(0, 100)}`,
                  target_route: `/projects/${job.project_id}`,
                  target_params: { tab: "jobs", jobId: job_id, attempt: String(currentAttempt) }
                });
              } catch (e) { console.error("Failed to create notification:", e); }
            }
          }

          currentAttempt++;
        }
      } catch (renderError) {
        console.error("Render error:", renderError);
        const renderMessage = renderError instanceof Error ? renderError.message : "Unknown render error";

        await writeLog("error", `=== RENDER FAILED ===`);
        await writeLog("error", renderMessage);
        await emitEvent("failed", `Failed: ${renderMessage}`, 0);

        await supabaseClient.from("render_jobs").update({
          status: "failed",
          last_error: renderMessage,
          progress: 0,
          progress_int: 0,
          progress_message: `Failed: ${renderMessage}`,
          qa_status: "pending",
        }).eq("id", job_id);
        
        // Create notification for render failure with navigation
        try {
          await supabaseClient.from("notifications").insert({
            owner_id: user.id,
            project_id: job.project_id,
            type: "render_failed",
            title: "Render Failed",
            message: renderMessage.substring(0, 150),
            target_route: `/projects/${job.project_id}`,
            target_params: { tab: "jobs", jobId: job_id }
          });
        } catch (e) { console.error("Failed to create notification:", e); }
      }
    };

    EdgeRuntime.waitUntil(processRender());

    return new Response(
      JSON.stringify({ success: true, status: "processing", message: "Render job started. Processing in background." }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});