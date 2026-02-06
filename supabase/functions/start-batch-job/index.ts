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
  photobashing: `Generate a high-end architectural visualization that strictly uses the geometry, perspective, and composition from the original image but applies the lighting, color palette, and material mood from the style reference.`,
  apply_material: `Replace the specified material on the surface. Ensure the new material looks realistic under existing lighting and shadows. Everything else must remain exactly as is.`,
  furniture_change: `Change the furniture style to the requested style. Maintain the same room layout and architectural elements.`,
  add_elements: `Add the specified elements to the scene. Ensure they are placed naturally and their shadows, lighting, and color temperature blend perfectly.`,
  remove_elements: `Remove the specified elements from the scene. Fill the empty space naturally with appropriate background.`,
  lighting_change: `Change or replace the lighting fixtures as specified. Adjust the light effect naturally to match the new fixtures.`,
  color_change: `Change the color scheme of the specified elements. Ensure the new colors integrate naturally with the existing lighting and materials.`,
  floor_plan_eye_level: `Generate a photorealistic interior render based strictly on the uploaded 2D floor plan. GEOMETRY RULES: KEEP WALLS, DOORS, WINDOWS, AND ROOM PROPORTIONS EXACT. Do NOT move or resize any architectural elements. Use the floor plan as the single source of truth for geometry. CAMERA: Eye-level interior view. Realistic focal length, natural perspective. DESIGN: Modern, clean interior style. Realistic materials and lighting. Natural daylight, soft shadows. No exaggerated or artistic distortion. GOAL: A realistic interior image that accurately translates the 2D plan into a real-world space.`,
  floor_plan_top_down: `Convert the uploaded 2D floor plan into a clean, top-down 3D render. STRICT REQUIREMENTS: KEEP THE LAYOUT EXACT. Do NOT change wall positions, room sizes, proportions, or orientation. Doors and openings must remain in the same locations as in the plan. No creative reinterpretation of geometry. RENDER STYLE: Top-down 3D perspective (architectural axonometric feel). Simple, realistic furniture matching each room's function. Neutral modern materials. Soft, even daylight. Clean background, no clutter. GOAL: A clear and accurate 3D visualization that faithfully represents the original 2D floor plan.`,
};

function detectTemplate(changeRequest: string): string | null {
  const request = changeRequest.toLowerCase();
  if (request.includes("floor plan") && (request.includes("eye level") || request.includes("eye-level") || request.includes("interior"))) return "floor_plan_eye_level";
  if (request.includes("floor plan") && (request.includes("top down") || request.includes("top-down") || request.includes("axonometric"))) return "floor_plan_top_down";
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

// Resolution mappings
const RESOLUTION_MAP: Record<string, { size: string; expectedPx: number }> = {
  "1k": { size: "1K", expectedPx: 1024 },
  "2k": { size: "2K", expectedPx: 2048 },
  "4k": { size: "4K", expectedPx: 4096 },
};

const ASPECT_RATIO_MAP: Record<string, string> = {
  "1:1": "1:1",
  "2:3": "2:3",
  "3:2": "3:2",
  "3:4": "3:4",
  "4:3": "4:3",
  "4:5": "4:5",
  "5:4": "5:4",
  "9:16": "9:16",
  "16:9": "16:9",
  "21:9": "21:9",
};

// QA Validation function using OpenAI
async function validateWithQA(
  originalBase64: string,
  outputBase64: string,
  changeRequest: string,
  openaiApiKey: string,
): Promise<{ decision: "approved" | "rejected"; reason: string }> {
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        max_tokens: 500,
        messages: [
          {
            role: "system",
            content: `You are a QA validator for architectural visualization. Compare the original image with the output image based on the requested change. 
            
Your job is to verify:
1. The requested change was applied correctly
2. No unintended changes were made to the scene
3. The output maintains photorealistic quality
4. The architectural elements remain intact unless explicitly asked to change

Respond with JSON only: {"decision": "approved" or "rejected", "reason": "brief explanation"}`
          },
          {
            role: "user",
            content: [
              { type: "text", text: `Requested change: "${changeRequest}"\n\nCompare the original (first) with the output (second). Did the AI correctly apply ONLY the requested change?` },
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${originalBase64}` } },
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${outputBase64}` } },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      console.warn("QA API call failed, auto-approving:", await response.text());
      return { decision: "approved", reason: "QA validation skipped (API error)" };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";
    
    // Parse JSON response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        decision: parsed.decision === "rejected" ? "rejected" : "approved",
        reason: parsed.reason || "No reason provided",
      };
    }
    
    return { decision: "approved", reason: "QA response parsing fallback" };
  } catch (error) {
    console.error("QA validation error:", error);
    return { decision: "approved", reason: "QA validation skipped (error)" };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const nanoBananaApiKey = Deno.env.get("API_NANOBANANA");
    const openaiApiKey = Deno.env.get("API_OPENAI");

    if (!nanoBananaApiKey) throw new Error("API_NANOBANANA secret is not configured");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization header");

    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);

    if (authError || !user) throw new Error("Unauthorized");

    const { batch_job_id } = await req.json();
    if (!batch_job_id) throw new Error("Missing batch_job_id");

    console.log(`=== BATCH JOB STARTED: ${batch_job_id} ===`);

    // Get the batch job
    const { data: batchJob, error: batchError } = await supabaseClient
      .from("batch_jobs")
      .select("*")
      .eq("id", batch_job_id)
      .eq("owner_id", user.id)
      .single();

    if (batchError || !batchJob) throw new Error("Batch job not found or unauthorized");

    // Get all items for this batch with panorama details
    const { data: items, error: itemsError } = await supabaseClient
      .from("batch_jobs_items")
      .select("*, panorama:uploads!batch_jobs_items_panorama_upload_id_fkey(id, original_filename, bucket, path, mime_type)")
      .eq("batch_job_id", batch_job_id)
      .order("created_at", { ascending: true });

    if (itemsError) throw new Error("Failed to get batch items");

    const totalItems = items?.length || 0;
    
    // Enforce limits: max 20 panoramas per batch
    if (totalItems > 20) {
      throw new Error(`Batch exceeds maximum limit of 20 images (got ${totalItems})`);
    }
    if (totalItems === 0) {
      throw new Error("Batch job has no images");
    }
    
    console.log(`Batch contains ${totalItems} images - processing sequentially with real-time progress`);

    // Update batch job to running
    await supabaseClient
      .from("batch_jobs")
      .update({ 
        status: "running", 
        progress_int: 0,
        total_items: totalItems
      })
      .eq("id", batch_job_id);

    // Emit batch event to NEW batch_job_events table
    const emitBatchEvent = async (type: string, message: string, progressInt: number, itemId?: string) => {
      console.log(`[BATCH ${batch_job_id}] ${type} ${progressInt}%: ${message}`);
      try {
        await supabaseClient.from("batch_job_events").insert({
          batch_job_id,
          item_id: itemId || null,
          owner_id: user.id,
          type,
          message,
          progress_int: progressInt
        });
      } catch (e) { console.error("Failed to emit batch event:", e); }
    };

    // Create notification for batch started
    try {
      await supabaseClient.from("notifications").insert({
        owner_id: user.id,
        project_id: batchJob.project_id,
        type: "render_started",
        title: "Batch Render Started",
        message: `Processing ${totalItems} images`,
        target_route: `/projects/${batchJob.project_id}`,
        target_params: { tab: "jobs", batchId: batch_job_id }
      });
    } catch (e) { console.error("Failed to create notification:", e); }

    await emitBatchEvent("batch_start", `Batch started - processing ${totalItems} images sequentially`, 0);

    // Process batch in background
    const processBatch = async () => {
      let completedCount = 0;
      let failedCount = 0;
      let approvedCount = 0;
      let rejectedCount = 0;
      
      const styleProfile = batchJob.style_profile;
      const promptBase = buildNanoBananaPrompt(batchJob.change_request, styleProfile);
      
      // Parse resolution from change_request or use default
      const qualityMatch = batchJob.change_request.match(/\[QUALITY:(\w+)\]/i);
      const ratioMatch = batchJob.change_request.match(/\[RATIO:([\d:]+)\]/i);
      
      const qualityKey = qualityMatch?.[1]?.toLowerCase() || "2k";
      const ratioKey = ratioMatch?.[1] || "1:1";
      
      const resolution = RESOLUTION_MAP[qualityKey] || RESOLUTION_MAP["2k"];
      const aspectRatio = ASPECT_RATIO_MAP[ratioKey] || "1:1";
      
      await emitBatchEvent("batch_info", `Resolution: ${resolution.size}, Aspect: ${aspectRatio}`, 2);

      for (let i = 0; i < totalItems; i++) {
        const item = items![i];
        const itemProgress = Math.round((i / totalItems) * 100);
        const itemProgressEnd = Math.round(((i + 1) / totalItems) * 100);
        const filename = item.panorama?.original_filename || `Image ${i + 1}`;

        try {
          // Update item to running
          await supabaseClient
            .from("batch_jobs_items")
            .update({ status: "running" })
            .eq("id", item.id);

          await emitBatchEvent("item_start", `[${i + 1}/${totalItems}] Starting ${filename}`, itemProgress, item.id);
          
          // Update batch progress
          await supabaseClient
            .from("batch_jobs")
            .update({ 
              progress_int: itemProgress,
              last_error: null
            })
            .eq("id", batch_job_id);

          // Download the panorama image
          await emitBatchEvent("item_download", `[${i + 1}/${totalItems}] Downloading ${filename}...`, itemProgress + 2, item.id);
          
          const { data: imageData, error: downloadError } = await supabaseClient.storage
            .from(item.panorama.bucket)
            .download(item.panorama.path);
          
          if (downloadError || !imageData) {
            throw new Error(`Failed to download image: ${downloadError?.message || "Unknown error"}`);
          }

          // Resize/optimize image
          await emitBatchEvent("item_resize", `[${i + 1}/${totalItems}] Optimizing ${filename}...`, itemProgress + 5, item.id);
          
          let originalBase64 = "";
          const { base64: imageBase64, mimeType } = await resizeImageToFitLimit(
            imageData,
            item.panorama.mime_type || "image/jpeg",
            async (msg) => {
              await emitBatchEvent("item_resize", `[${i + 1}/${totalItems}] ${msg}`, itemProgress + 8, item.id);
            }
          );
          
          originalBase64 = imageBase64;
          const cleanBase64 = imageBase64.replace(/^data:[^;]+;base64,/, "");

          // Build prompt
          const promptText = `Keep the same camera, geometry, layout, and objects. Only apply the requested change: ${promptBase}`;

          await emitBatchEvent("item_api", `[${i + 1}/${totalItems}] Sending to Nano Banana API...`, itemProgress + 15, item.id);

          // Call Gemini API
          const requestBody = {
            contents: [{
              role: "user",
              parts: [
                { text: promptText },
                { inlineData: { mimeType, data: cleanBase64 } },
              ],
            }],
            generationConfig: {
              responseModalities: ["Image"],
              imageConfig: { 
                aspectRatio,
                imageSize: resolution.size
              },
            },
          };

          const geminiResponse = await fetchWithRetry(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json", "x-goog-api-key": nanoBananaApiKey },
              body: JSON.stringify(requestBody),
            },
            async (attempt, delay) => {
              await emitBatchEvent("item_retry", `[${i + 1}/${totalItems}] Retrying API call (attempt ${attempt})...`, itemProgress + 20, item.id);
            },
          );

          if (!geminiResponse.ok) {
            const errorText = await geminiResponse.text();
            throw new Error(`API error: ${errorText.substring(0, 200)}`);
          }

          const geminiData = await geminiResponse.json();
          const candidates = geminiData.candidates;
          if (!candidates || candidates.length === 0) throw new Error("No image returned from API");

          const parts = candidates[0]?.content?.parts;
          const imagePart = parts?.find((p: any) => p.inlineData?.mimeType?.startsWith("image/"));
          if (!imagePart?.inlineData) throw new Error("No image data in response");

          const outputMimeType = imagePart.inlineData.mimeType;
          const outputBase64 = imagePart.inlineData.data;

          await emitBatchEvent("item_received", `[${i + 1}/${totalItems}] Received output for ${filename}`, itemProgress + 50, item.id);

          // QA Validation
          let qaDecision: "approved" | "rejected" = "approved";
          let qaReason = "QA validation skipped";
          
          if (openaiApiKey) {
            await emitBatchEvent("item_qa", `[${i + 1}/${totalItems}] Running QA validation...`, itemProgress + 55, item.id);
            
            const qaResult = await validateWithQA(
              originalBase64,
              outputBase64,
              batchJob.change_request,
              openaiApiKey
            );
            
            qaDecision = qaResult.decision;
            qaReason = qaResult.reason;
            
            if (qaDecision === "approved") {
              approvedCount++;
              await emitBatchEvent("item_qa_pass", `[${i + 1}/${totalItems}] QA Approved: ${qaReason}`, itemProgress + 60, item.id);
            } else {
              rejectedCount++;
              await emitBatchEvent("item_qa_fail", `[${i + 1}/${totalItems}] QA Rejected: ${qaReason}`, itemProgress + 60, item.id);
            }
          }

          await emitBatchEvent("item_upload", `[${i + 1}/${totalItems}] Uploading output...`, itemProgress + 70, item.id);

          // Convert and upload output
          const binaryString = atob(outputBase64);
          const bytes = new Uint8Array(binaryString.length);
          for (let j = 0; j < binaryString.length; j++) bytes[j] = binaryString.charCodeAt(j);

          const outputPath = `${user.id}/${batchJob.project_id}/batch_${batch_job_id}_item_${i}.png`;
          const { error: uploadError } = await supabaseClient.storage
            .from("outputs")
            .upload(outputPath, bytes, { contentType: outputMimeType, upsert: true });
          
          if (uploadError) throw new Error("Failed to upload output image");

          // Create upload record
          const { data: uploadRecord, error: insertError } = await supabaseClient
            .from("uploads")
            .insert({
              project_id: batchJob.project_id,
              owner_id: user.id,
              kind: "output",
              bucket: "outputs",
              path: outputPath,
              mime_type: outputMimeType,
              size_bytes: bytes.length,
              original_filename: `batch_${filename}`
            })
            .select()
            .single();

          if (insertError) throw new Error("Failed to create upload record");

          // Update batch item as completed with QA results
          await supabaseClient
            .from("batch_jobs_items")
            .update({ 
              status: "completed",
              output_upload_id: uploadRecord.id,
              qa_decision: qaDecision,
              qa_reason: qaReason
            })
            .eq("id", item.id);

          completedCount++;
          await emitBatchEvent("item_complete", `[${i + 1}/${totalItems}] Completed ${filename} (QA: ${qaDecision})`, itemProgressEnd, item.id);

        } catch (itemError) {
          console.error(`Error processing item ${item.id}:`, itemError);
          failedCount++;
          
          const errorMessage = itemError instanceof Error ? itemError.message : "Unknown error";
          await supabaseClient
            .from("batch_jobs_items")
            .update({ 
              status: "failed",
              last_error: errorMessage
            })
            .eq("id", item.id);
          
          await emitBatchEvent("item_failed", `[${i + 1}/${totalItems}] Failed ${filename}: ${errorMessage.substring(0, 100)}`, itemProgressEnd, item.id);
        }

        // Update batch counts
        await supabaseClient
          .from("batch_jobs")
          .update({ 
            completed_items: completedCount,
            failed_items: failedCount,
            progress_int: itemProgressEnd
          })
          .eq("id", batch_job_id);
      }

      // Mark batch as complete
      const finalStatus = failedCount === totalItems ? "failed" : 
                          failedCount > 0 ? "completed_with_errors" : "completed";
      
      await supabaseClient
        .from("batch_jobs")
        .update({ 
          status: finalStatus,
          progress_int: 100,
          completed_items: completedCount,
          failed_items: failedCount
        })
        .eq("id", batch_job_id);

      await emitBatchEvent("batch_complete", `Batch finished: ${completedCount} completed, ${failedCount} failed | QA: ${approvedCount} approved, ${rejectedCount} rejected`, 100);

      // Create completion notification
      try {
        const notificationType = failedCount === totalItems ? "batch_failed" : "batch_completed";
        const message = failedCount > 0 
          ? `${completedCount} completed, ${failedCount} failed`
          : `All ${completedCount} images processed successfully`;
        
        await supabaseClient.from("notifications").insert({
          owner_id: user.id,
          project_id: batchJob.project_id,
          type: notificationType,
          title: failedCount === totalItems ? "Batch Render Failed" : "Batch Render Complete",
          message,
          target_route: `/projects/${batchJob.project_id}`,
          target_params: { tab: "jobs", batchId: batch_job_id, autoOpenReview: true }
        });
      } catch (e) { console.error("Failed to create notification:", e); }

      console.log(`=== BATCH JOB ${batch_job_id} COMPLETED: ${completedCount} success, ${failedCount} failed ===`);
    };

    EdgeRuntime.waitUntil(processBatch());

    return new Response(
      JSON.stringify({ 
        success: true, 
        status: "processing", 
        message: `Batch job started - processing ${totalItems} images` 
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
