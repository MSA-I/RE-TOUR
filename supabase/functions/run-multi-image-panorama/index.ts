import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import {
  wrapModelGeneration,
  ensurePipelineTrace,
  logSimpleGeneration,
  flushLangfuse,
} from "../_shared/langfuse-generation-wrapper.ts";
import { STEP_4_GENERATIONS } from "../_shared/langfuse-constants.ts";
import { parseJsonFromLLM } from "../_shared/json-parsing.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// API Keys - using API_NANOBANANA exclusively
const API_NANOBANANA = Deno.env.get("API_NANOBANANA");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// DUAL-MODEL CONFIGURATION - All using Gemini via API_NANOBANANA
const MODELS = {
  // Image generation: Gemini 3 Pro Image Preview
  IMAGE_GENERATION: "gemini-3-pro-image-preview",
  // QA Primary: Gemini 3 Pro Preview
  QA_PRIMARY: "gemini-3-pro-preview",
  // QA Fallback: Gemini 2.5 Pro (stable)
  QA_FALLBACK: "gemini-2.5-pro",
};

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// Multi-Image Panorama prompt template - evidence-based, no hallucination
const MULTI_IMAGE_PANORAMA_PROMPT = (cameraPosition: string, forwardDirection: string, imageCount: number, customInstructions?: string) => `
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

${customInstructions ? `USER INSTRUCTIONS:\n${customInstructions}\n` : ""}

OUTPUT LABEL: Multi-Image Panorama (Evidence-Based)

PRINCIPLE: Better incomplete truth than complete fiction.
`;

// QA prompt for panorama validation
const QA_PROMPT = `You are a strict quality assurance system for 360° equirectangular panoramas.

ANALYZE THIS PANORAMA FOR:
1. REQUEST COMPLIANCE: Does the output match the requested merge of multiple images?
2. EQUIRECTANGULAR FORMAT: 2:1 aspect ratio, proper spherical projection
3. HORIZON: Centered, continuous, level
4. SEAMS: Check for visible join lines, duplicates, or blending artifacts
5. ARTIFACTS: Distorted objects, melted edges, impossible geometry, floating elements
6. CONSISTENCY: Materials, lighting, and style coherent throughout
7. HALLUCINATION: Look for invented elements not in the original sources

CRITICAL CHECKS:
- Verify seams between merged sources are invisible
- Check for ghosting, stretching, mismatched perspective
- Look for watermark-like noise or texture glitches
- Confirm geometry is consistent (walls align, floors are level)

OUTPUT JSON ONLY:
{
  "pass": true/false,
  "score": 0-100,
  "issues": [
    {
      "type": "artifact|seam|perspective|consistency|hallucination|other",
      "severity": "critical|major|minor",
      "description": "specific issue description",
      "location_hint": "where in the image"
    }
  ],
  "request_fulfilled": true/false,
  "request_analysis": "brief analysis of whether the panorama correctly merges the sources",
  "recommended_action": "approve|retry|reject",
  "corrected_instructions": "if retry, specific prompt improvements to fix issues"
}`;

// Helper functions
async function emitEvent(supabase: any, jobId: string, ownerId: string, type: string, message: string, progress: number) {
  await supabase.from("multi_image_panorama_events").insert({
    job_id: jobId,
    owner_id: ownerId,
    type,
    message,
    progress_int: progress,
  });
}

async function updateJob(supabase: any, jobId: string, updates: Record<string, any>) {
  const { error } = await supabase
    .from("multi_image_panorama_jobs")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", jobId);
  
  if (error) {
    console.error(`[updateJob] Failed to update job ${jobId}:`, error);
    throw new Error(`Failed to update job: ${error.message}`);
  }
}

// Call QA with automatic fallback
async function runQACheck(
  imageBase64: string,
  mimeType: string,
  emitter: (type: string, message: string, progress: number) => Promise<void>
): Promise<{ pass: boolean; score: number; issues: any[]; corrected_instructions: string | null; usedFallback: boolean }> {
  const qaPayload = {
    contents: [{
      parts: [
        { text: QA_PROMPT },
        { inlineData: { mimeType, data: imageBase64 } },
      ],
    }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 2000,
    },
  };

  // Try primary QA model (Gemini 3 Pro Preview)
  await emitter("qa", `Running QA with ${MODELS.QA_PRIMARY}...`, 85);
  
  let qaResponse;
  let usedFallback = false;

  try {
    const primaryUrl = `${GEMINI_API_BASE}/${MODELS.QA_PRIMARY}:generateContent?key=${API_NANOBANANA}`;
    qaResponse = await fetch(primaryUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(qaPayload),
    });

    if (!qaResponse.ok) {
      const status = qaResponse.status;
      console.log(`Primary QA model returned ${status}, trying fallback...`);
      
      if (status === 429 || status === 503 || status === 500) {
        throw new Error(`Primary model unavailable: ${status}`);
      }
    }
  } catch (e) {
    console.log("Primary QA model error, falling back:", e);
    usedFallback = true;
    
    await emitter("qa", `Fallback to ${MODELS.QA_FALLBACK}...`, 86);
    
    const fallbackUrl = `${GEMINI_API_BASE}/${MODELS.QA_FALLBACK}:generateContent?key=${API_NANOBANANA}`;
    qaResponse = await fetch(fallbackUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(qaPayload),
    });
  }

  if (!qaResponse || !qaResponse.ok) {
    console.error("QA check failed with both models");
    return {
      pass: false,
      score: 0,
      issues: [{ type: "error", severity: "critical", description: "QA system unavailable" }],
      corrected_instructions: null,
      usedFallback,
    };
  }

  const qaData = await qaResponse.json();
  const qaContent = qaData.candidates?.[0]?.content?.parts?.[0]?.text || "";

  // Parse QA result
  const jsonMatch = qaContent.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error("No JSON in QA response:", qaContent);
    return {
      pass: false,
      score: 0,
      issues: [{ type: "parse_error", severity: "critical", description: "Failed to parse QA response" }],
      corrected_instructions: null,
      usedFallback,
    };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      pass: parsed.pass ?? false,
      score: parsed.score ?? 0,
      issues: parsed.issues || [],
      corrected_instructions: parsed.corrected_instructions || null,
      usedFallback,
    };
  } catch (e) {
    console.error("JSON parse error:", e);
    return {
      pass: false,
      score: 0,
      issues: [{ type: "parse_error", severity: "critical", description: "Failed to parse QA JSON" }],
      corrected_instructions: null,
      usedFallback,
    };
  }
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

    // ═══════════════════════════════════════════════════════════════════════
    // LANGFUSE: Ensure pipeline trace exists (use job_id as pipeline_id for standalone jobs)
    // ═══════════════════════════════════════════════════════════════════════
    const pipelineId = job_id; // For standalone multi-image panorama jobs
    await ensurePipelineTrace(pipelineId, job.project_id, user.id, {
      job_type: "multi_image_panorama",
      step_number: 4,
    });

    // Helper for emitting events
    const emit = async (type: string, message: string, progress: number) => {
      await emitEvent(supabaseAdmin, job_id, user.id, type, message, progress);
    };

    // Update status to running
    await updateJob(supabaseAdmin, job_id, { status: "running", progress_int: 5 });
    await emit("start", "Starting multi-image panorama generation...", 5);
    await emit("info", `Using model: ${MODELS.IMAGE_GENERATION}`, 6);

    // Fetch all input images
    await emit("fetch", `Fetching ${inputUploadIds.length} input images...`, 10);

    const inputImages: Array<{ base64: string; mimeType: string; filename: string }> = [];

    for (let i = 0; i < inputUploadIds.length; i++) {
      const uploadId = inputUploadIds[i];

      const { data: upload } = await supabaseAdmin
        .from("uploads")
        .select("bucket, path, original_filename")
        .eq("id", uploadId)
        .single();

      if (!upload) {
        console.log(`Upload ${uploadId} not found, skipping`);
        continue;
      }

      const { data: fileData, error: downloadError } = await supabaseAdmin.storage
        .from(upload.bucket)
        .download(upload.path);

      if (downloadError || !fileData) {
        console.log(`Failed to download ${upload.path}, skipping`);
        continue;
      }

      const buffer = await fileData.arrayBuffer();
      const uint8Array = new Uint8Array(buffer);
      // Use safe base64 encoding for large files
      const base64 = encodeBase64(uint8Array);
      const mimeType = fileData.type || "image/jpeg";

      inputImages.push({
        base64,
        mimeType,
        filename: upload.original_filename || `image_${i + 1}`,
      });

      await emit("fetch", `Loaded image ${i + 1}/${inputUploadIds.length}: ${upload.original_filename || "image"}`, 
        10 + Math.floor((i / inputUploadIds.length) * 20));
    }

    if (inputImages.length < 2) {
      throw new Error("Could not load at least 2 valid input images");
    }

    // QA retry loop
    const MAX_ATTEMPTS = 3;
    let currentAttempt = 0;
    let outputBase64: string | null = null;
    let outputMimeType = "image/png";
    let qaResult: any = null;
    let customInstructions = job.prompt_used || "";

    while (currentAttempt < MAX_ATTEMPTS) {
      currentAttempt++;
      
      await emit("generate", `Attempt ${currentAttempt}/${MAX_ATTEMPTS}: Building prompt...`, 32 + (currentAttempt - 1) * 5);

      // Build the prompt
      const cameraPosition = job.camera_position || "center of the main living space at eye-level";
      const forwardDirection = job.forward_direction || "toward the primary focal point";
      const prompt = MULTI_IMAGE_PANORAMA_PROMPT(cameraPosition, forwardDirection, inputImages.length, customInstructions || undefined);

      await updateJob(supabaseAdmin, job_id, { prompt_used: prompt, progress_int: 35 + (currentAttempt - 1) * 5 });
      await emit("prompt", `Built evidence-based panorama prompt (attempt ${currentAttempt})`, 35 + (currentAttempt - 1) * 5);

      // Log exact request being sent
      await emit("info", `Sending to ${MODELS.IMAGE_GENERATION} with ${inputImages.length} images...`, 40 + (currentAttempt - 1) * 5);

      const imageParts = inputImages.map((img) => ({
        inlineData: {
          mimeType: img.mimeType,
          data: img.base64,
        },
      }));

      const geminiPayload = {
        contents: [{
          parts: [
            ...imageParts,
            { text: prompt },
          ],
        }],
        generationConfig: {
          responseModalities: ["image", "text"],
          temperature: 0.8,
        },
      };

      const geminiUrl = `${GEMINI_API_BASE}/${MODELS.IMAGE_GENERATION}:generateContent?key=${API_NANOBANANA}`;

      const geminiResponse = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(geminiPayload),
      });

      if (!geminiResponse.ok) {
        const errorText = await geminiResponse.text();
        console.error("Gemini API error:", errorText);
        
        if (currentAttempt >= MAX_ATTEMPTS) {
          throw new Error(`Gemini API error after ${MAX_ATTEMPTS} attempts: ${geminiResponse.status}`);
        }
        
        await emit("error", `Generation failed (attempt ${currentAttempt}), retrying...`, 45 + (currentAttempt - 1) * 5);
        continue;
      }

      const geminiData = await geminiResponse.json();
      await emit("generate", "Received response from image generation model", 70);

      // Extract output image
      outputBase64 = null;
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
        if (currentAttempt >= MAX_ATTEMPTS) {
          throw new Error("No image generated after all attempts");
        }
        await emit("error", "No image in response, retrying...", 72);
        continue;
      }

      // Run QA check
      await emit("qa", "Running QA validation...", 80);
      qaResult = await runQACheck(outputBase64, outputMimeType, emit);
      
      const qaModel = qaResult.usedFallback ? MODELS.QA_FALLBACK : MODELS.QA_PRIMARY;
      await emit("qa", `QA complete (${qaModel}): Score ${qaResult.score}/100, Pass: ${qaResult.pass}`, 90);

      if (qaResult.pass) {
        await emit("qa", "QA PASSED - Output approved", 92);
        break;
      }

      // QA failed - check if we should retry
      if (currentAttempt >= MAX_ATTEMPTS) {
        await emit("qa", `QA FAILED after ${MAX_ATTEMPTS} attempts - needs manual review`, 92);
        break;
      }

      // Use corrected instructions for next attempt
      if (qaResult.corrected_instructions) {
        customInstructions = qaResult.corrected_instructions;
        await emit("qa", `QA FAILED - Using corrected instructions for attempt ${currentAttempt + 1}`, 93);
        await emit("info", `Corrected: ${qaResult.corrected_instructions.substring(0, 100)}...`, 94);
      } else {
        // Generic improvement
        customInstructions = "Pay extra attention to: seamless merging, no visible seams, consistent lighting, no duplicated elements, correct 2:1 aspect ratio.";
        await emit("qa", `QA FAILED - Retrying with enhanced instructions`, 93);
      }
    }

    // Upload the output
    if (!outputBase64) {
      throw new Error("Failed to generate output image");
    }

    await emit("upload", "Uploading panorama output...", 95);

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

    // Determine final status based on QA
    // Note: DB constraint only allows pending/running/completed/failed - not 'needs_review'
    // QA results are tracked via the message and qa_result in notification, but status is always 'completed'
    const finalStatus = "completed";
    const statusMessage = qaResult?.pass 
      ? "Multi-image panorama generated and QA passed!" 
      : `Multi-image panorama generated but needs review (QA score: ${qaResult?.score || 0}/100)`;

    // CRITICAL: Update job FIRST, then emit event
    // This ensures the UI can fetch the output when it receives the complete event
    await updateJob(supabaseAdmin, job_id, {
      status: finalStatus,
      output_upload_id: uploadRecord.id,
      progress_int: 100,
      progress_message: statusMessage,
    });

    // Emit complete event AFTER job is updated
    await emit("complete", statusMessage, 100);

    // Create notification
    await supabaseAdmin.from("notifications").insert({
      owner_id: user.id,
      project_id: job.project_id,
      type: qaResult?.pass ? "multi_panorama_complete" : "multi_panorama_review",
      title: qaResult?.pass ? "Multi-Image Panorama Complete" : "Panorama Needs Review",
      message: `Evidence-based panorama from ${inputImages.length} sources. ${qaResult?.pass ? "QA passed." : `QA score: ${qaResult?.score || 0}/100`}`,
      target_route: `/projects/${job.project_id}`,
      target_params: { tab: "multi-image-panorama" },
    });

    // CRITICAL: Flush Langfuse events before returning
    await flushLangfuse();

    return new Response(
      JSON.stringify({ 
        success: true, 
        output_upload_id: uploadRecord.id,
        qa_result: qaResult,
        status: finalStatus,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Multi-image panorama error:", error);

    // Flush Langfuse even on error
    await flushLangfuse();

    // Try to update job status to failed
    try {
      const requestBody = await req.clone().json().catch(() => ({}));
      const job_id = requestBody.job_id;
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
