import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encode as encodeBase64 } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import {
  createPipelineRunTrace,
  isLangfuseEnabled,
  fetchPrompt,
  flushLangfuse,
  STEP_0_GENERATIONS,
  PROMPT_NAMES,
  TRACE_NAMES,
} from "../_shared/langfuse-client.ts";
import {
  wrapModelGeneration,
  logPipelineEvent,
  flushLangfuse as flushWrapper,
} from "../_shared/langfuse-generation-wrapper.ts";
import {
  parseJsonFromLLM,
  buildParseErrorOutput,
  buildParseDebugInfo,
  validateSpaceAnalysisSchema,
  type ParseDebugInfo,
} from "../_shared/json-parsing.ts";

// ═══════════════════════════════════════════════════════════════
// VERSION MARKER: Increment on each deploy for verification
// ═══════════════════════════════════════════════════════════════
const VERSION = "2.3.2-compact-json";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const API_NANOBANANA = Deno.env.get("API_NANOBANANA")!;

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const TEXT_ANALYSIS_MODEL = "gemini-2.5-pro";

// ═══════════════════════════════════════════════════════════════
// HELPER: Non-blocking Langfuse flush wrapper
// Ensures Langfuse failures NEVER break the pipeline
// ═══════════════════════════════════════════════════════════════
async function safeFlushLangfuse(context: string): Promise<void> {
  if (!isLangfuseEnabled()) {
    return; // No-op if disabled
  }

  try {
    console.log(`[safeFlushLangfuse] Flushing Langfuse events (context: ${context})...`);
    await flushLangfuse();
    console.log(`[safeFlushLangfuse] Flush successful (context: ${context})`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[safeFlushLangfuse] WARN: Langfuse flush failed (context: ${context}): ${errorMsg}`);
    console.error(`[safeFlushLangfuse] Pipeline will continue despite Langfuse error`);
    // DO NOT throw - Langfuse failures must not break the pipeline
  }
}

const SPACE_ANALYSIS_PROMPT = `You are an expert architectural analyst. Analyze this 2D floor plan image and identify all distinct spaces.

CRITICAL: Keep JSON output COMPACT and CONCISE. For a typical apartment with 5-10 spaces, your response should be under 2000 characters.

OUTPUT RULES - FOLLOW EXACTLY:
1. Return ONLY valid JSON. No markdown. No code fences. No commentary.
2. Use double quotes for ALL keys and string values.
3. Do NOT include trailing commas.
4. The response must start with { and end with }.

CLASSIFICATION:
ROOMS = habitable spaces: Living Room, Kitchen, Bedroom, Bathroom, Office, Dining Room, Balcony
ZONES = non-habitable: Closet, Storage, Hallway, Corridor, Pantry, Utility Room

OUTPUT SCHEMA (MINIMAL):
{
  "rooms": [
    {
      "room_id": "kitchen-1",
      "room_name": "Kitchen",
      "room_type": "room",
      "confidence": 0.95
    }
  ],
  "zones": [
    {
      "zone_id": "closet-1",
      "zone_name": "Closet",
      "zone_type": "zone",
      "confidence": 0.9
    }
  ]
}

NAMING RULES:
• room_name/zone_name: Human-readable Title Case (e.g., "Kitchen", "Master Bedroom", "Storage Closet")
• NEVER use slugs like "living_room" or numbers like "Room 1"
• If multiple same type: "Bedroom 1", "Bedroom 2", "Bathroom 1"
• room_id/zone_id: machine slugs like "bedroom-1", "kitchen-main"

REQUIRED FIELDS (ONLY THESE):
• room_id, room_name, room_type, confidence
• zone_id, zone_name, zone_type, confidence
• Always include BOTH "rooms" and "zones" keys (can be empty arrays)

DO NOT INCLUDE:
• boundary coordinates (we don't need them)
• furniture lists (omit completely)
• center coordinates (not needed)
• notes or descriptions (omit completely)
• any other fields

KEEP IT SHORT: A 10-space apartment should produce ~500 characters of JSON, not 8000+.`;



async function fetchImageAsBase64(supabase: any, uploadId: string): Promise<string> {
  console.log(`[fetchImageAsBase64] ENTRY - Upload ID: ${uploadId}`);

  // VALIDATION 1: Check upload record exists
  const { data: upload, error: uploadError } = await supabase.from("uploads").select("*").eq("id", uploadId).single();
  if (uploadError || !upload) {
    console.error(`[fetchImageAsBase64] Upload not found: ${uploadId}`, uploadError);
    throw new Error(`Floor plan upload not found (${uploadId}). Please re-upload the floor plan.`);
  }

  // VALIDATION 2: Check required fields
  if (!upload.bucket || !upload.path) {
    console.error(`[fetchImageAsBase64] Upload missing bucket or path:`, upload);
    throw new Error("Floor plan upload is corrupted. Please re-upload the floor plan.");
  }

  const fileSizeMB = (upload.size_bytes / (1024 * 1024)).toFixed(2);
  console.log(`[fetchImageAsBase64] Original file: ${upload.original_filename} (${fileSizeMB} MB)`);
  console.log(`[fetchImageAsBase64] Bucket: ${upload.bucket}, Path: ${upload.path}`);

  // VALIDATION 3: Enforce reasonable original file size
  // For free tier without transformations, we need stricter limits
  const MAX_ORIGINAL_SIZE_MB = 10; // Reduced from 50 for safety without transformations
  if (upload.size_bytes > MAX_ORIGINAL_SIZE_MB * 1024 * 1024) {
    console.error(`[fetchImageAsBase64] Original file too large: ${fileSizeMB} MB`);
    throw new Error(
      `Floor plan file is too large (${fileSizeMB} MB). Maximum allowed: ${MAX_ORIGINAL_SIZE_MB} MB. ` +
      `Please resize or compress the image before uploading. ` +
      `Tip: Use online tools like TinyPNG or compress to 80% quality JPEG.`
    );
  }

  // PREPROCESSING: Try transformations first (if available), fall back to raw
  const TRANSFORM_CONFIG = {
    width: 1600,
    height: 1600,
    quality: 60,
    // format not specified = use original format (Supabase Storage doesn't support 'webp' as output)
  };

  console.log(`[fetchImageAsBase64] Attempting to use transformations...`);
  let response: Response | null = null;
  let usedTransformations = false;

  // TRY PATH 1: Signed URL with transformations (requires paid plan)
  try {
    const signedUrlResult = await supabase.storage
      .from(upload.bucket)
      .createSignedUrl(upload.path, 3600, { transform: TRANSFORM_CONFIG });

    if (signedUrlResult.data?.signedUrl) {
      console.log(`[fetchImageAsBase64] Transformation URL created, fetching...`);
      const transformResponse = await fetch(signedUrlResult.data.signedUrl);

      if (transformResponse.ok) {
        // Check if we actually got a transformed image (not just the original)
        const contentType = transformResponse.headers.get('content-type');
        const contentLength = transformResponse.headers.get('content-length');

        console.log(`[fetchImageAsBase64] Transform response: ${transformResponse.status}, type: ${contentType}, size: ${contentLength}`);

        // If transformations work, the size should be significantly smaller
        if (contentLength) {
          const downloadedSizeMB = parseInt(contentLength) / (1024 * 1024);
          const originalSizeMB = upload.size_bytes / (1024 * 1024);

          // Heuristic: If downloaded size is < 90% of original, transformations worked
          if (downloadedSizeMB < originalSizeMB * 0.9) {
            console.log(`[fetchImageAsBase64] ✅ Transformations WORKED - Size: ${downloadedSizeMB.toFixed(2)} MB (reduced from ${fileSizeMB} MB)`);
            response = transformResponse;
            usedTransformations = true;
          } else {
            console.log(`[fetchImageAsBase64] ⚠️ Transformations FAILED - Size unchanged: ${downloadedSizeMB.toFixed(2)} MB`);
            console.log(`[fetchImageAsBase64] Falling back to raw download...`);
          }
        }
      }
    }
  } catch (transformErr) {
    console.log(`[fetchImageAsBase64] Transformation attempt failed:`, transformErr instanceof Error ? transformErr.message : String(transformErr));
    console.log(`[fetchImageAsBase64] This is expected on free tier - falling back to raw download`);
  }

  // PATH 2: Raw download (fallback for free tier)
  if (!response) {
    console.log(`[fetchImageAsBase64] Using raw download (no transformations available)`);

    const rawUrlResult = await supabase.storage
      .from(upload.bucket)
      .createSignedUrl(upload.path, 3600);

    if (!rawUrlResult.data?.signedUrl) {
      console.error(`[fetchImageAsBase64] Failed to create signed URL:`, rawUrlResult.error);
      throw new Error(
        `Failed to prepare floor plan image. Please check the file is accessible.`
      );
    }

    response = await fetch(rawUrlResult.data.signedUrl);

    if (!response.ok) {
      console.error(`[fetchImageAsBase64] Failed to fetch image: HTTP ${response.status}`);
      throw new Error(`Failed to download floor plan image (HTTP ${response.status}).`);
    }

    // CRITICAL: Validate raw download size
    const contentLength = response.headers.get('content-length');
    if (contentLength) {
      const downloadedSizeMB = parseInt(contentLength) / (1024 * 1024);
      console.log(`[fetchImageAsBase64] Raw download size: ${downloadedSizeMB.toFixed(2)} MB`);

      // Stricter limit for raw downloads
      const MAX_DOWNLOAD_SIZE_MB = 10;
      if (downloadedSizeMB > MAX_DOWNLOAD_SIZE_MB) {
        console.error(`[fetchImageAsBase64] Downloaded image too large: ${downloadedSizeMB.toFixed(2)} MB`);
        throw new Error(
          `Floor plan image is too large (${downloadedSizeMB.toFixed(2)} MB, max ${MAX_DOWNLOAD_SIZE_MB} MB). ` +
          `Please compress the image before uploading. Tip: Export as JPEG with 70-80% quality.`
        );
      }
    }
  }

  // VALIDATION: Check we have a valid response
  if (!response || !response.ok) {
    console.error(`[fetchImageAsBase64] No valid response obtained`);
    throw new Error("Failed to download floor plan image. Please try again.");
  }

  const arrayBuffer = await response.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);

  // VALIDATION: Check downloaded data is non-empty
  if (uint8Array.length === 0) {
    console.error(`[fetchImageAsBase64] Downloaded image is empty (0 bytes)`);
    throw new Error("Downloaded floor plan image is empty. Please re-upload the floor plan.");
  }

  const downloadedSizeMB = (uint8Array.length / (1024 * 1024)).toFixed(2);
  console.log(`[fetchImageAsBase64] Converting ${uint8Array.length} bytes (${downloadedSizeMB} MB) to base64...`);

  const base64 = encodeBase64(uint8Array);
  const base64SizeMB = (base64.length / (1024 * 1024)).toFixed(2);
  console.log(`[fetchImageAsBase64] Base64 size: ${base64SizeMB} MB (${usedTransformations ? 'transformed' : 'raw'})`);

  // VALIDATION: Check base64 format
  if (base64.length < 100 || !/^[A-Za-z0-9+/]/.test(base64)) {
    console.error(`[fetchImageAsBase64] Invalid base64 format detected`);
    throw new Error("Floor plan image encoding is invalid. Please try re-uploading the image.");
  }

  console.log(`[fetchImageAsBase64] ✅ SUCCESS - Method: ${usedTransformations ? 'TRANSFORMED' : 'RAW'}`);
  return base64;
}


async function emitEvent(supabase: any, pipelineId: string, ownerId: string, stepNumber: number, type: string, message: string, progress: number) {
  await supabase.from("floorplan_pipeline_events").insert({
    pipeline_id: pipelineId, owner_id: ownerId, step_number: stepNumber, type, message, progress_int: progress,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// STYLE ANALYSIS HELPER: Analyze design references and extract style profile
// ═══════════════════════════════════════════════════════════════════════════
const STYLE_ANALYSIS_PROMPT = `You are an expert interior designer. Analyze the provided design reference image(s) and extract a STRUCTURED STYLE PROFILE.

IMPORTANT: Keep output COMPACT. Limit arrays to 3-5 items max. Total response should be under 1500 characters.

Extract:
1. OVERALL DESIGN STYLE (primary style, 1-2 secondary influences, 3-5 mood keywords)
2. COLOR PALETTE (primary, 2-3 secondary, 2-3 accent colors with hex codes)
3. MATERIAL LANGUAGE (key materials only: flooring, walls, wood_tone, metal_finish, fabrics, stone)
4. LIGHTING MOOD (temperature, intensity, mood)
5. TEXTURE LEVEL (density, 2-3 key elements)
6. STYLE RULES (3-5 do's, 3-5 avoid's)

OUTPUT FORMAT - Return ONLY this JSON object (NO markdown, NO code fences):
{
  "design_style": { "primary": "Modern Minimalist", "secondary": ["Scandinavian"], "mood_keywords": ["serene", "airy", "refined"] },
  "color_palette": { "primary": "#F5F5F5", "secondary": ["#E8E8E8", "#D0D0D0"], "accent": ["#4A4A4A"], "temperature": "cool" },
  "materials": { "flooring": "light oak", "walls": "white plaster", "wood_tone": "natural", "metal_finish": "brushed steel", "fabrics": "linen", "stone": "marble" },
  "lighting": { "temperature": "warm white", "intensity": "soft", "mood": "ambient" },
  "texture_level": { "density": "minimal", "key_elements": ["smooth surfaces", "subtle grain"] },
  "style_rules": { "do": ["Use neutral palette", "Keep clean lines", "Add natural light"], "avoid": ["Bold patterns", "Dark colors", "Clutter"] },
  "summary_prompt": "Modern minimalist aesthetic with Scandinavian influences. Emphasizes clean lines, natural materials, and a serene neutral palette."
}

STRICT RULES:
- Output ONLY the JSON object above, nothing else
- Do NOT wrap in markdown code blocks (\`\`\`)
- Do NOT include any explanatory text before or after the JSON
- The response must start with { and end with }
- Keep arrays to 2-5 items MAXIMUM - be concise and specific`;

interface StyleAnalysisResult {
  analyzed_at: string;
  design_ref_ids: string[];
  style_data: Record<string, unknown>;
  style_constraints_block?: string;
  summary?: string;
}

async function runStyleAnalysis(
  supabase: any,
  pipelineId: string,
  projectId: string,
  ownerId: string,
  designRefIds: string[],
  traceId: string
): Promise<StyleAnalysisResult | null> {
  // Load reference images as base64
  const referenceImages: { id: string; base64: string }[] = [];

  for (const refId of designRefIds) {
    try {
      console.log(`[runStyleAnalysis] Loading design reference: ${refId}`);

      const { data: upload, error: uploadError } = await supabase
        .from("uploads")
        .select("bucket, path, original_filename, size_bytes")
        .eq("id", refId)
        .eq("owner_id", ownerId)
        .single();

      if (uploadError || !upload) {
        console.error(`[runStyleAnalysis] Design reference not found: ${refId}`, uploadError);
        throw new Error(`Design reference ${refId} not found or inaccessible`);
      }

      if (!upload.bucket || !upload.path) {
        console.error(`[runStyleAnalysis] Design reference missing bucket or path:`, upload);
        throw new Error(`Design reference ${refId} is corrupted`);
      }

      const fileSizeMB = (upload.size_bytes / (1024 * 1024)).toFixed(2);
      console.log(`[runStyleAnalysis] Original file: ${upload.original_filename} (${fileSizeMB} MB)`);

      // Enforce reasonable original file size
      const MAX_ORIGINAL_SIZE_MB = 10; // Reduced for free tier
      if (upload.size_bytes > MAX_ORIGINAL_SIZE_MB * 1024 * 1024) {
        throw new Error(
          `Design reference ${upload.original_filename} is too large (${fileSizeMB} MB, max ${MAX_ORIGINAL_SIZE_MB} MB). ` +
          `Please compress before uploading.`
        );
      }

      // Try transformations first, fall back to raw
      const TRANSFORM_CONFIG = {
        width: 1600,
        height: 1600,
        quality: 60,
        // format not specified = use original format (Supabase Storage doesn't support 'webp' as output)
      };

      console.log(`[runStyleAnalysis] Attempting transformations for ${upload.original_filename}...`);
      let imageResponse: Response | null = null;
      let usedTransformations = false;

      // TRY PATH 1: Transformations
      try {
        const { data: signedUrlData, error: urlError } = await supabase.storage
          .from(upload.bucket)
          .createSignedUrl(upload.path, 3600, { transform: TRANSFORM_CONFIG });

        if (!urlError && signedUrlData?.signedUrl) {
          const transformResponse = await fetch(signedUrlData.signedUrl);

          if (transformResponse.ok) {
            const contentLength = transformResponse.headers.get('content-length');
            if (contentLength) {
              const downloadedSizeMB = parseInt(contentLength) / (1024 * 1024);
              const originalSizeMB = upload.size_bytes / (1024 * 1024);

              if (downloadedSizeMB < originalSizeMB * 0.9) {
                console.log(`[runStyleAnalysis] ✅ Transformations worked: ${downloadedSizeMB.toFixed(2)} MB`);
                imageResponse = transformResponse;
                usedTransformations = true;
              } else {
                console.log(`[runStyleAnalysis] Transformations didn't reduce size, using raw`);
              }
            }
          }
        }
      } catch (transformErr) {
        console.log(`[runStyleAnalysis] Transformation attempt failed (expected on free tier)`);
      }

      // PATH 2: Raw download
      if (!imageResponse) {
        console.log(`[runStyleAnalysis] Using raw download for ${upload.original_filename}`);
        const rawUrlResult = await supabase.storage
          .from(upload.bucket)
          .createSignedUrl(upload.path, 3600);

        if (!rawUrlResult.data?.signedUrl) {
          throw new Error(`Failed to create signed URL for ${upload.original_filename}`);
        }

        imageResponse = await fetch(rawUrlResult.data.signedUrl);

        if (!imageResponse.ok) {
          throw new Error(`Failed to download ${upload.original_filename} (HTTP ${imageResponse.status})`);
        }

        // Validate raw download size
        const contentLength = imageResponse.headers.get('content-length');
        if (contentLength) {
          const downloadedSizeMB = parseInt(contentLength) / (1024 * 1024);
          console.log(`[runStyleAnalysis] Raw download size: ${downloadedSizeMB.toFixed(2)} MB`);

          const MAX_DOWNLOAD_SIZE_MB = 10;
          if (downloadedSizeMB > MAX_DOWNLOAD_SIZE_MB) {
            throw new Error(
              `Design reference ${upload.original_filename} is too large (${downloadedSizeMB.toFixed(2)} MB). ` +
              `Please compress before uploading.`
            );
          }
        }
      }

      const arrayBuffer = await imageResponse.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      if (uint8Array.length === 0) {
        throw new Error(`Design reference ${upload.original_filename} is empty`);
      }

      console.log(`[runStyleAnalysis] Converting to base64: ${uint8Array.length} bytes`);

      let binary = "";
      for (let i = 0; i < uint8Array.length; i++) {
        binary += String.fromCharCode(uint8Array[i]);
      }
      const base64 = btoa(binary);

      if (base64.length < 100 || !/^[A-Za-z0-9+/]/.test(base64)) {
        throw new Error(`Design reference ${upload.original_filename} encoding is invalid`);
      }

      referenceImages.push({ id: refId, base64 });
      console.log(`[runStyleAnalysis] ✅ Loaded ${upload.original_filename} (${usedTransformations ? 'transformed' : 'raw'})`);
    } catch (err) {
      // Log error but continue loading other references
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[runStyleAnalysis] Failed to load reference ${refId}:`, errorMsg);
      // Note: We continue instead of throwing to allow partial success
    }
  }

  if (referenceImages.length === 0) {
    console.log("[runStyleAnalysis] No reference images could be loaded");
    return null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 0.1: Fetch prompt from Langfuse Prompt Management
  // ═══════════════════════════════════════════════════════════════════════════
  let promptTemplate = STYLE_ANALYSIS_PROMPT;
  let promptVersion: string | undefined;
  let promptSource: "langfuse_prompt_management" | "code" = "code";

  if (isLangfuseEnabled()) {
    console.log(`[STEP 0.1] Fetching prompt: ${PROMPT_NAMES.DESIGN_REFERENCE_ANALYSIS} (label: production)`);
    const langfusePrompt = await fetchPrompt(PROMPT_NAMES.DESIGN_REFERENCE_ANALYSIS, "production");
    if (langfusePrompt) {
      promptTemplate = langfusePrompt.prompt;
      promptVersion = String(langfusePrompt.version);
      promptSource = "langfuse_prompt_management";
      console.log(`[STEP 0.1] Using Langfuse prompt v${promptVersion}`);
    } else {
      console.log(`[STEP 0.1] Langfuse prompt not found, using default template`);
    }
  }

  // Build parts with images
  const parts: { text?: string; inlineData?: { mimeType: string; data: string } }[] = [{ text: promptTemplate }];
  for (const ref of referenceImages) {
    parts.push({ inlineData: { mimeType: "image/jpeg", data: ref.base64 } });
  }

  const requestParams = { temperature: 0.3, maxOutputTokens: 2000 };
  const geminiUrl = `${GEMINI_API_BASE}/${TEXT_ANALYSIS_MODEL}:generateContent?key=${API_NANOBANANA}`;

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 0.1: Use wrapModelGeneration for full input/output logging
  // ═══════════════════════════════════════════════════════════════════════════
  const generationResult = await wrapModelGeneration<Record<string, unknown>>(
    {
      traceId,
      generationName: STEP_0_GENERATIONS.DESIGN_REFERENCE_ANALYSIS,
      model: TEXT_ANALYSIS_MODEL,
      metadata: {
        project_id: projectId,
        pipeline_id: pipelineId,
        step_number: 0,
        sub_step: "0.1",
        model_name: TEXT_ANALYSIS_MODEL,
        prompt_name: PROMPT_NAMES.DESIGN_REFERENCE_ANALYSIS,
        prompt_version: promptVersion,
      },
      promptInfo: {
        name: PROMPT_NAMES.DESIGN_REFERENCE_ANALYSIS,
        version: promptVersion,
        label: "production",
        source: promptSource,
      },
      finalPromptText: promptTemplate,
      variables: { reference_count: referenceImages.length, reference_ids: designRefIds },
      requestParams,
      imageCount: referenceImages.length,
    },
    async () => {
      // Call Gemini API
      const aiResponse = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: requestParams,
        }),
      });

      if (!aiResponse.ok) {
        const errorText = await aiResponse.text();
        console.error("[runStyleAnalysis] Gemini API error:", aiResponse.status, errorText);
        throw new Error(`Style analysis API error: ${aiResponse.status}`);
      }

      const aiData = await aiResponse.json();
      const responseContent = aiData.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";

      console.log(`[runStyleAnalysis] Response length: ${responseContent.length}`);

      // Use robust JSON parsing
      const parseResult = parseJsonFromLLM<Record<string, unknown>>(responseContent, TEXT_ANALYSIS_MODEL);

      if (!parseResult.success) {
        console.error("[runStyleAnalysis] JSON parse failed:", parseResult.error);
        console.error("[runStyleAnalysis] Raw response preview:", parseResult.rawResponse);
        // Throw error with raw content for Langfuse logging
        const error = new Error(parseResult.error || "JSON parse failed");
        (error as any).rawResponse = parseResult.rawResponse;
        (error as any).extractedJson = parseResult.extractedJson;
        throw error;
      }

      return parseResult.data!;
    }
  );

  if (!generationResult.success || !generationResult.data) {
    throw generationResult.error || new Error("Style analysis failed");
  }

  const styleData = generationResult.data;

  // Build style_constraints_block for Step 2 prompt injection
  const styleConstraintsBlock = buildStyleConstraintsBlock(styleData);

  return {
    analyzed_at: new Date().toISOString(),
    design_ref_ids: designRefIds,
    style_data: styleData,
    style_constraints_block: styleConstraintsBlock,
    summary: (styleData as any).summary_prompt,
  };
}

/**
 * Build a prompt block from style analysis data for Step 2 injection
 */
function buildStyleConstraintsBlock(styleData: Record<string, unknown>): string {
  const ds = styleData.design_style as any;
  const cp = styleData.color_palette as any;
  const mat = styleData.materials as any;
  const light = styleData.lighting as any;
  const rules = styleData.style_rules as any;

  let block = "STYLE PROFILE (Extracted from Design References):\n";

  if (ds?.primary) {
    block += `\n• Design Style: ${ds.primary}`;
    if (ds.secondary?.length) block += ` (with ${ds.secondary.join(", ")} influences)`;
    if (ds.mood_keywords?.length) block += `\n• Mood: ${ds.mood_keywords.join(", ")}`;
  }

  if (cp?.primary) {
    block += `\n• Primary Color: ${cp.primary}`;
    if (cp.secondary?.length) block += `, Secondary: ${cp.secondary.join(", ")}`;
    if (cp.temperature) block += ` (${cp.temperature} temperature)`;
  }

  if (mat) {
    const matParts: string[] = [];
    if (mat.flooring) matParts.push(`Flooring: ${mat.flooring}`);
    if (mat.walls) matParts.push(`Walls: ${mat.walls}`);
    if (mat.wood_tone) matParts.push(`Wood: ${mat.wood_tone}`);
    if (mat.metal_finish) matParts.push(`Metal: ${mat.metal_finish}`);
    if (mat.fabrics) matParts.push(`Fabrics: ${mat.fabrics}`);
    if (matParts.length) block += `\n• Materials: ${matParts.join("; ")}`;
  }

  if (light) {
    const lightParts: string[] = [];
    if (light.temperature) lightParts.push(light.temperature);
    if (light.intensity) lightParts.push(light.intensity);
    if (light.mood) lightParts.push(light.mood);
    if (lightParts.length) block += `\n• Lighting: ${lightParts.join(", ")}`;
  }

  if (rules?.do?.length) {
    block += `\n\nSTYLE RULES - DO:\n${rules.do.map((r: string) => `  ✓ ${r}`).join("\n")}`;
  }
  if (rules?.avoid?.length) {
    block += `\n\nSTYLE RULES - AVOID:\n${rules.avoid.map((r: string) => `  ✗ ${r}`).join("\n")}`;
  }

  return block;
}

// ═══════════════════════════════════════════════════════════════════════════
// ALLOWED PHASES FOR THIS FUNCTION
// ═══════════════════════════════════════════════════════════════════════════
const ALLOWED_PHASES = ["upload", "space_analysis_pending", "space_analysis_running", "space_analysis_complete"];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const actionId = crypto.randomUUID();
  console.log(`[SPACE_ANALYSIS] VERSION: ${VERSION}`);
  console.log(`[SPACE_ANALYSIS] Action ${actionId} started`);

  // Parse request body once and store pipeline_id for use in catch block
  let pipeline_id: string | undefined;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData } = await serviceClient.auth.getUser(token);
    if (!claimsData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const userId = claimsData.user.id;

    const body = await req.json();
    pipeline_id = body.pipeline_id;
    if (!pipeline_id) {
      return new Response(JSON.stringify({ error: "Missing pipeline_id" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: pipeline } = await serviceClient.from("floorplan_pipelines").select("*").eq("id", pipeline_id).eq("owner_id", userId).single();
    if (!pipeline) {
      return new Response(JSON.stringify({ error: "Pipeline not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE GUARD: Validate this function is allowed for current phase
    // ═══════════════════════════════════════════════════════════════════════════
    const currentPhase = pipeline.whole_apartment_phase ?? "upload";
    console.log(`[SPACE_ANALYSIS] Pipeline ${pipeline_id} current phase: ${currentPhase}`);

    if (!ALLOWED_PHASES.includes(currentPhase)) {
      console.error(`[SPACE_ANALYSIS] Phase mismatch: expected one of [${ALLOWED_PHASES.join(", ")}], got "${currentPhase}"`);
      return new Response(
        JSON.stringify({
          error: `Phase mismatch: run-space-analysis handles Space Analysis (Step 0), but pipeline is at phase "${currentPhase}"`,
          hint: "Check frontend routing: this function should only be called for upload or space_analysis_* phases",
          expected_phases: ALLOWED_PHASES,
          current_phase: currentPhase,
          action_id: actionId,
        }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Emit action start event
    await emitEvent(serviceClient, pipeline_id, userId, 0, "ACTION_START", JSON.stringify({
      action_name: "SPACE_ANALYSIS_START",
      action_id: actionId,
      phase_at_start: currentPhase,
      function_name: "run-space-analysis",
    }), 0);

    await serviceClient.from("floorplan_pipelines").update({ whole_apartment_phase: "space_analysis_running", last_error: null }).eq("id", pipeline_id);
    await emitEvent(serviceClient, pipeline_id, userId, 0, "info", "[SPACE_ANALYSIS] Starting space analysis...", 5);

    // ═══════════════════════════════════════════════════════════════════════════
    // LANGFUSE: Create or ensure trace for this pipeline run (non-blocking)
    // ═══════════════════════════════════════════════════════════════════════════
    let traceId = pipeline_id; // Use pipeline_id as trace_id for easy linking

    // TEMPORARY DIAGNOSTIC: Test Langfuse connectivity (non-blocking)
    if (isLangfuseEnabled()) {
      console.log("[LANGFUSE_DIAGNOSTIC] Step 0 starting - testing Langfuse connectivity");
      try {
        const { testLangfuseConnectivity } = await import("../_shared/langfuse-client.ts");
        const connectivityTest = await testLangfuseConnectivity();
        console.log("[LANGFUSE_DIAGNOSTIC] Connectivity test result:", connectivityTest);
      } catch (testErr) {
        console.warn("[LANGFUSE_DIAGNOSTIC] Connectivity test failed:", testErr);
      }
    }

    if (isLangfuseEnabled()) {
      try {
        console.log(`[LANGFUSE] Creating/ensuring trace for pipeline: ${pipeline_id}`);
        // TEMPORARY DIAGNOSTIC: Log before trace creation
        console.log("[LANGFUSE_DIAGNOSTIC] About to call createPipelineRunTrace");

        const traceResult = await createPipelineRunTrace(
          pipeline_id,
          pipeline.project_id,
          userId,
          { action_id: actionId }
        );
        traceId = traceResult.traceId;
        console.log(`[LANGFUSE] Trace ID: ${traceId}`);

        // TEMPORARY DIAGNOSTIC: Log after trace creation
        console.log("[LANGFUSE_DIAGNOSTIC] createPipelineRunTrace returned:", {
          success: traceResult.success,
          traceId: traceResult.traceId
        });
      } catch (langfuseErr) {
        const errMsg = langfuseErr instanceof Error ? langfuseErr.message : String(langfuseErr);
        console.error(`[LANGFUSE] WARN: Failed to create trace: ${errMsg}`);
        console.error(`[LANGFUSE] Pipeline will continue without Langfuse tracing`);
        // TEMPORARY DIAGNOSTIC: Log full error
        console.error("[LANGFUSE_DIAGNOSTIC] Trace creation error:", langfuseErr);
        // Continue execution - Langfuse is observability, not critical path
      }
    } else {
      console.log("[LANGFUSE_DIAGNOSTIC] Langfuse disabled - skipping trace creation");
    }

    // VALIDATION: Ensure pipeline state is clean (no stale outputs from previous failed runs)
    const existingSpaceAnalysis = (pipeline.step_outputs as any)?.space_analysis;
    if (existingSpaceAnalysis && currentPhase === "space_analysis_pending") {
      console.warn(`[run-space-analysis] WARNING: Pipeline ${pipeline_id} has existing space_analysis but is in pending phase`);
      console.warn(`[run-space-analysis] This may indicate a previous failed run. Clearing stale data.`);
      // Note: We'll overwrite this when we update step_outputs later
    }

    // CRITICAL: Fetch and validate floor plan image
    console.log(`[run-space-analysis] Fetching floor plan image for upload: ${pipeline.floor_plan_upload_id}`);
    const imageBase64 = await fetchImageAsBase64(serviceClient, pipeline.floor_plan_upload_id);

    // VALIDATION: Image is now validated inside fetchImageAsBase64, but double-check here
    if (!imageBase64 || imageBase64.length < 100) {
      console.error("[run-space-analysis] Invalid base64 image data returned from fetchImageAsBase64");
      throw new Error("Floor plan image validation failed. Please try re-uploading the image.");
    }

    console.log(`[run-space-analysis] Floor plan image loaded and validated successfully`);
    await emitEvent(serviceClient, pipeline_id, userId, 0, "info", "Analyzing floor plan structure...", 20);

    // ═══════════════════════════════════════════════════════════════════════════
    // MEMORY OPTIMIZATION: Flush Langfuse early before heavy operations
    // ═══════════════════════════════════════════════════════════════════════════
    await safeFlushLangfuse("before-space-analysis");

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 0.2: Space Analysis (Always runs)
    // ═══════════════════════════════════════════════════════════════════════════

    // Fetch prompt from Langfuse Prompt Management
    let spaceAnalysisPrompt = SPACE_ANALYSIS_PROMPT;
    let spacePromptVersion: string | undefined;
    let spacePromptSource: "langfuse_prompt_management" | "code" = "code";

    if (isLangfuseEnabled()) {
      console.log(`[STEP 0.2] Fetching prompt: ${PROMPT_NAMES.SPACE_ANALYSIS} (label: production)`);
      const langfusePrompt = await fetchPrompt(PROMPT_NAMES.SPACE_ANALYSIS, "production");
      if (langfusePrompt) {
        spaceAnalysisPrompt = langfusePrompt.prompt;
        spacePromptVersion = String(langfusePrompt.version);
        spacePromptSource = "langfuse_prompt_management";
        console.log(`[STEP 0.2] Using Langfuse prompt v${spacePromptVersion}`);
      } else {
        console.log(`[STEP 0.2] Langfuse prompt not found, using default template`);
      }
    }

    // TOKEN LIMIT: Allow sufficient tokens for complex floor plans
    // Gemini 2.5 Pro supports up to 32K output tokens
    // Using 16K as a good balance between completeness and performance
    const spaceRequestParams = { temperature: 0.3, maxOutputTokens: 16384, responseMimeType: "application/json" };
    const geminiUrl = `${GEMINI_API_BASE}/${TEXT_ANALYSIS_MODEL}:generateContent?key=${API_NANOBANANA}`;

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 0.2: Use wrapModelGeneration for full input/output logging
    // ═══════════════════════════════════════════════════════════════════════════
    const spaceAnalysisResult = await wrapModelGeneration<{ rooms: unknown[]; zones: unknown[]; overall_notes?: string }>(
      {
        traceId,
        generationName: STEP_0_GENERATIONS.SPACE_ANALYSIS_STRUCTURAL,
        model: TEXT_ANALYSIS_MODEL,
        metadata: {
          project_id: pipeline.project_id,
          pipeline_id: pipeline_id,
          step_number: 0,
          sub_step: "0.2",
          model_name: TEXT_ANALYSIS_MODEL,
          prompt_name: PROMPT_NAMES.SPACE_ANALYSIS,
          prompt_version: spacePromptVersion,
        },
        promptInfo: {
          name: PROMPT_NAMES.SPACE_ANALYSIS,
          version: spacePromptVersion,
          label: "production",
          source: spacePromptSource,
        },
        finalPromptText: spaceAnalysisPrompt,
        variables: { floor_plan_upload_id: pipeline.floor_plan_upload_id },
        requestParams: spaceRequestParams,
        imageCount: 1,
      },
      async () => {
        // MEMORY DIAGNOSTICS: Log memory state before heavy operations
        console.log(`[run-space-analysis] Starting Gemini API call...`);
        console.log(`[run-space-analysis] Prompt length: ${spaceAnalysisPrompt.length} chars`);
        console.log(`[run-space-analysis] Image base64 length: ${(imageBase64.length / 1024).toFixed(0)} KB`);

        // VALIDATION: Check base64 is valid (should start with valid chars)
        const base64Sample = imageBase64.substring(0, 50);
        console.log(`[run-space-analysis] Base64 sample: ${base64Sample}...`);
        if (!/^[A-Za-z0-9+/]/.test(imageBase64)) {
          console.error("[run-space-analysis] Invalid base64 format detected");
          throw new Error("Floor plan image encoding is invalid. Please re-upload the image.");
        }

        // Build request payload
        const requestPayload = {
          contents: [{
            parts: [
              { text: spaceAnalysisPrompt },
              { inlineData: { mimeType: "image/jpeg", data: imageBase64 } },
            ]
          }],
          generationConfig: spaceRequestParams,
        };

        console.log(`[run-space-analysis] Serializing request payload...`);
        const requestBody = JSON.stringify(requestPayload);
        const payloadSizeMB = (requestBody.length / (1024 * 1024)).toFixed(2);
        console.log(`[run-space-analysis] Request payload size: ${payloadSizeMB} MB`);

        // VALIDATION: Ensure payload is not malformed
        if (requestBody.length < 1000) {
          console.error("[run-space-analysis] Request payload is suspiciously small");
          console.error("[run-space-analysis] Payload preview:", requestBody.substring(0, 500));
          throw new Error("Request payload is malformed. Please try again.");
        }

        // Call Gemini API
        console.log(`[run-space-analysis] Sending request to Gemini...`);
        const geminiResponse = await fetch(geminiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: requestBody,
        });

        console.log(`[run-space-analysis] Gemini response received: ${geminiResponse.status}`);

        if (!geminiResponse.ok) {
          const errorText = await geminiResponse.text();
          console.error(`[run-space-analysis] Gemini error: ${errorText}`);
          throw new Error(`Gemini API error: ${geminiResponse.status}`);
        }

        const geminiData = await geminiResponse.json();

        // CRITICAL: Log full response structure for debugging
        console.log("[run-space-analysis] Gemini response structure:", JSON.stringify({
          hasCandidates: !!geminiData.candidates,
          candidatesLength: geminiData.candidates?.length,
          hasContent: !!geminiData.candidates?.[0]?.content,
          hasParts: !!geminiData.candidates?.[0]?.content?.parts,
          partsLength: geminiData.candidates?.[0]?.content?.parts?.length,
          finishReason: geminiData.candidates?.[0]?.finishReason,
          promptFeedback: geminiData.promptFeedback,
          usageMetadata: geminiData.usageMetadata,
        }));

        // Check for safety filters or other blocking reasons
        if (geminiData.promptFeedback?.blockReason) {
          console.error("[run-space-analysis] Prompt blocked by safety filter:", geminiData.promptFeedback);
          throw new Error(`Gemini blocked request: ${geminiData.promptFeedback.blockReason}`);
        }

        const content = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "";
        const finishReason = geminiData.candidates?.[0]?.finishReason;

        console.log(`[run-space-analysis] Response length: ${content.length}`);
        console.log(`[run-space-analysis] Finish reason: ${finishReason}`);

        // CRITICAL: Check for empty response BEFORE parsing
        if (!content || content.trim().length === 0) {
          console.error("[run-space-analysis] CRITICAL: Gemini returned empty content");
          console.error("[run-space-analysis] Full response:", JSON.stringify(geminiData, null, 2).substring(0, 2000));
          throw new Error(
            `Gemini returned empty response. Finish reason: ${finishReason || "unknown"}. ` +
            `Check if the image is valid and readable.`
          );
        }

        // Log preview of response for debugging parse issues
        const preview = content.length > 500 ? content.substring(0, 500) + "..." : content;
        console.log(`[run-space-analysis] Response preview:`, preview);

        // Warn about truncation but still attempt parsing (repair might succeed)
        if (finishReason === "MAX_TOKENS") {
          console.warn("[run-space-analysis] WARNING: Response truncated at token limit");
          console.warn("[run-space-analysis] Token usage:", geminiData.usageMetadata);
          console.warn("[run-space-analysis] Attempting JSON repair...");
        }

        // Use robust JSON parsing with repair logic
        const parseResult = parseJsonFromLLM<{ rooms: unknown[]; zones: unknown[]; overall_notes?: string }>(
          content,
          TEXT_ANALYSIS_MODEL
        );

        if (!parseResult.success) {
          const wasTruncated = finishReason === "MAX_TOKENS";
          console.error("[run-space-analysis] JSON parse failed:", parseResult.error);
          console.error("[run-space-analysis] Error code:", parseResult.errorCode);
          console.error("[run-space-analysis] Raw response length:", content.length);
          console.error("[run-space-analysis] Was truncated:", wasTruncated);
          if (parseResult.parsePosition) {
            console.error("[run-space-analysis] Parse failed at position:", parseResult.parsePosition);
            // Show context around error position
            const pos = parseResult.parsePosition;
            const contextStart = Math.max(0, pos - 100);
            const contextEnd = Math.min(content.length, pos + 100);
            const errorContext = content.substring(contextStart, contextEnd);
            console.error("[run-space-analysis] Error context:", errorContext);
          }

          // Log the extracted JSON that failed to parse
          if (parseResult.extractedJson) {
            const extractedPreview = parseResult.extractedJson.length > 1000
              ? parseResult.extractedJson.substring(0, 1000) + "..."
              : parseResult.extractedJson;
            console.error("[run-space-analysis] Extracted JSON preview:", extractedPreview);
          }

          // Build debug info for storage
          const debugInfo = buildParseDebugInfo(content, parseResult);

          // Create error object with all debug data attached
          let errorMessage = parseResult.error || "JSON parse failed";
          if (wasTruncated) {
            errorMessage = `${errorMessage} (Response was truncated at ${spaceRequestParams.maxOutputTokens} token limit - repair failed)`;
          } else {
            errorMessage = `${errorMessage}. The AI model returned malformed JSON. Please try again.`;
          }

          const error = new Error(errorMessage);
          (error as any).errorCode = wasTruncated ? "TRUNCATED_PARSE_FAILED" : (parseResult.errorCode || "PARSE_FAILED");
          (error as any).rawResponse = content; // Full raw response, not truncated
          (error as any).extractedJson = parseResult.extractedJson;
          (error as any).debugInfo = debugInfo;
          (error as any).isParseError = true;
          (error as any).wasTruncated = wasTruncated;
          throw error;
        }

        // Validate the schema has required fields
        const validation = validateSpaceAnalysisSchema(parseResult.data);
        if (!validation.valid) {
          console.warn("[run-space-analysis] Schema validation warnings:", validation.errors);
        }

        return parseResult.data!;
      }
    );

    if (!spaceAnalysisResult.success || !spaceAnalysisResult.data) {
      throw spaceAnalysisResult.error || new Error("Space analysis failed");
    }

    // MEMORY OPTIMIZATION: Flush Langfuse immediately after generation to free memory
    await safeFlushLangfuse("after-space-analysis-generation");

    const analysisData = spaceAnalysisResult.data;
    const rawRooms = analysisData.rooms || [];
    const rawZones = analysisData.zones || [];

    // ═══════════════════════════════════════════════════════════════════════════
    // VALIDATION: Enforce room_name data contract - MUST have human-readable names
    // ═══════════════════════════════════════════════════════════════════════════
    interface SpaceData {
      space_id?: string;
      room_name?: string;
      inferred_usage?: string;
      confidence?: number;
      classification_reason?: string;
      dimensions_summary?: string;
      geometry_flags?: { has_angled_walls?: boolean; has_curved_walls?: boolean };
      detected_items?: string[];
    }

    function normalizeSpace(space: SpaceData, index: number, type: "room" | "zone"): SpaceData {
      // Get the human-readable name from room_name OR inferred_usage (backward compat)
      const rawName = space.room_name || space.inferred_usage || "";

      // Validate: reject numeric-only or generic names
      const isGenericName = /^(room|space|zone|area)[\s_-]?\d*$/i.test(rawName.trim());
      const isNumericOnly = /^\d+$/.test(rawName.trim());

      let roomName = rawName;
      if (!roomName || isGenericName || isNumericOnly) {
        // Fallback: construct descriptive name from context if available
        if (space.detected_items && space.detected_items.length > 0) {
          // Infer from detected items (e.g., "sofa" → "Living Room")
          const items = space.detected_items.map(i => i.toLowerCase());
          if (items.some(i => i.includes("bed"))) roomName = `Bedroom ${index + 1}`;
          else if (items.some(i => i.includes("sofa") || i.includes("couch"))) roomName = "Living Room";
          else if (items.some(i => i.includes("stove") || i.includes("oven") || i.includes("sink"))) roomName = "Kitchen";
          else if (items.some(i => i.includes("toilet") || i.includes("shower") || i.includes("bath"))) roomName = `Bathroom ${index + 1}`;
          else if (items.some(i => i.includes("desk") || i.includes("chair"))) roomName = "Office";
          else roomName = `${type === "zone" ? "Zone" : "Room"} ${index + 1}`;
        } else {
          roomName = `${type === "zone" ? "Zone" : "Room"} ${index + 1}`;
        }
        console.warn(`[run-space-analysis] Space "${rawName}" had invalid name, normalized to "${roomName}"`);
      }

      return {
        ...space,
        space_id: space.space_id || `${type}_${index + 1}`,
        room_name: roomName,
        inferred_usage: roomName, // Keep in sync for backward compatibility
        confidence: space.confidence ?? 0.9,
      };
    }

    const rooms = (rawRooms as SpaceData[]).map((r, i) => normalizeSpace(r, i, "room"));
    const zones = (rawZones as SpaceData[]).map((z, i) => normalizeSpace(z, i, "zone"));

    // Validate: Log warning if any space still has a problematic name
    const allSpaces = [...rooms, ...zones];
    const invalidSpaces = allSpaces.filter((s: SpaceData) => !s.room_name || s.room_name.trim().length < 2);
    if (invalidSpaces.length > 0) {
      console.error(`[run-space-analysis] VALIDATION WARNING: ${invalidSpaces.length} spaces have invalid room_name:`,
        invalidSpaces.map((s: SpaceData) => ({ id: s.space_id, name: s.room_name })));
    }

    console.log(`[run-space-analysis] Detected ${rooms.length} rooms and ${zones.length} zones`);
    console.log(`[run-space-analysis] Room names: ${rooms.map((r: SpaceData) => r.room_name).join(", ")}`);

    // VALIDATION: Ensure we have valid output data before persisting
    if (rooms.length === 0 && zones.length === 0) {
      console.error(`[run-space-analysis] CRITICAL: No rooms or zones detected`);
      throw new Error(
        "Space analysis returned no rooms or zones. This indicates the model could not interpret the floor plan. " +
        "Please ensure the uploaded image is a clear floor plan with visible room boundaries."
      );
    }

    // STATE FLOW: Build outputs atomically (no partial updates)
    const existingOutputs = (pipeline.step_outputs || {}) as Record<string, unknown>;

    // CRITICAL: Overwrite space_analysis completely (no merge) to prevent stale data
    const spaceAnalysisOutput = {
      rooms_count: rooms.length,
      zones_count: zones.length,
      rooms,
      zones,
      overall_notes: analysisData.overall_notes,
      analyzed_at: new Date().toISOString(),
      pipeline_id: pipeline_id, // Include pipeline_id for verification
    };

    let updatedOutputs: Record<string, unknown> = {
      ...existingOutputs,
      space_analysis: spaceAnalysisOutput,
    };

    console.log(`[run-space-analysis] Prepared space_analysis output for persistence (pipeline: ${pipeline_id})`);

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 0.1: STYLE ANALYSIS (Conditional - only if design references attached)
    // ═══════════════════════════════════════════════════════════════════════════
    const designRefIds = existingOutputs.design_reference_ids as string[] | undefined;
    if (designRefIds && designRefIds.length > 0) {
      await emitEvent(serviceClient, pipeline_id, userId, 0, "info", `[STEP 0.1] Analyzing style from ${designRefIds.length} reference(s)...`, 60);
      console.log(`[STEP 0.1] Running design reference analysis for ${designRefIds.length} references`);

      try {
        const styleAnalysis = await runStyleAnalysis(
          serviceClient,
          pipeline_id,
          pipeline.project_id,
          userId,
          designRefIds,
          traceId
        );
        if (styleAnalysis) {
          updatedOutputs = {
            ...updatedOutputs,
            reference_style_analysis: styleAnalysis,
          };
          const stylePrimary = (styleAnalysis.style_data as any)?.design_style?.primary || "Style extracted";
          await emitEvent(serviceClient, pipeline_id, userId, 0, "info", `[STEP 0.1] Complete: ${stylePrimary}`, 80);
          console.log(`[STEP 0.1] Design reference analysis complete: ${stylePrimary}`);
        }
      } catch (styleError) {
        const styleMsg = styleError instanceof Error ? styleError.message : String(styleError);
        console.error(`[STEP 0.1] Design reference analysis failed (non-blocking): ${styleMsg}`);
        await emitEvent(serviceClient, pipeline_id, userId, 0, "warning", `[STEP 0.1] Style analysis failed: ${styleMsg}`, 75);
      }
    } else {
      console.log(`[STEP 0.1] No design references attached, skipping design reference analysis`);
    }

    // STATE FLOW: Atomic update with validation
    console.log(`[run-space-analysis] Persisting outputs to database (pipeline: ${pipeline_id})...`);

    const { error: updateError } = await serviceClient
      .from("floorplan_pipelines")
      .update({
        whole_apartment_phase: "space_analysis_complete",
        step_outputs: updatedOutputs,
        last_error: null, // Clear any previous errors
      })
      .eq("id", pipeline_id)
      .eq("owner_id", userId); // Extra validation: ensure owner matches

    if (updateError) {
      console.error(`[run-space-analysis] CRITICAL: Failed to persist outputs:`, updateError);
      throw new Error(`Failed to save space analysis results: ${updateError.message}`);
    }

    console.log(`[run-space-analysis] Outputs persisted successfully (pipeline: ${pipeline_id})`);
    await emitEvent(serviceClient, pipeline_id, userId, 0, "success", `[SPACE_ANALYSIS] Complete: ${rooms.length} rooms + ${zones.length} zones`, 100);

    // Emit action complete event
    await emitEvent(serviceClient, pipeline_id, userId, 0, "ACTION_COMPLETE", JSON.stringify({
      action_name: "SPACE_ANALYSIS_START",
      action_id: actionId,
      phase_before: currentPhase,
      phase_after: "space_analysis_complete",
      function_name: "run-space-analysis",
      rooms_count: rooms.length,
      zones_count: zones.length,
    }), 100);

    console.log(`[SPACE_ANALYSIS] Action ${actionId} completed successfully`);

    // CRITICAL: Flush Langfuse events before returning (non-blocking)
    await safeFlushLangfuse("before-success-response");

    return new Response(JSON.stringify({ success: true, rooms_count: rooms.length, zones_count: zones.length, rooms, zones, action_id: actionId }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[SPACE_ANALYSIS] Error: ${message}`);

    // Check if this is a parse error - return structured response, NOT 500
    const isParseError = (error as any)?.isParseError === true;
    const errorCode = (error as any)?.errorCode || "UNKNOWN_ERROR";
    const debugInfo = (error as any)?.debugInfo as ParseDebugInfo | undefined;

    // Flush Langfuse even on error (non-blocking)
    await safeFlushLangfuse("error-handler");

    if (isParseError) {
      // Return structured error with debug info - HTTP 200 with ok:false
      // This prevents the frontend from showing a blank screen
      const responseBody = {
        ok: false,
        success: false,
        error_code: "SPACE_ANALYSIS_PARSE_FAILED",
        error: message,
        user_message: "Space analysis returned invalid data. The AI model's response could not be parsed. Please retry.",
        retry_available: true,
        debug: debugInfo ? {
          raw_model_output_length: debugInfo.total_length,
          raw_model_output_preview: debugInfo.raw_model_output?.substring(0, 1000),
          extracted_json_preview: debugInfo.extracted_json_candidate?.substring(0, 1000),
          parse_error_message: debugInfo.parse_error_message,
          parse_error_position: debugInfo.parse_error_position,
          repair_attempted: debugInfo.repair_attempted,
        } : undefined,
      };

      // Store debug info in pipeline for later analysis
      try {
        if (pipeline_id) {
          const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
          await serviceClient.from("floorplan_pipelines").update({
            last_error: message,
            step_outputs: {
              space_analysis_error: {
                error_code: errorCode,
                error_message: message,
                debug_info: debugInfo,
                failed_at: new Date().toISOString(),
              }
            }
          }).eq("id", pipeline_id);
        }
      } catch (dbErr) {
        console.error("[SPACE_ANALYSIS] Failed to store debug info:", dbErr);
      }

      return new Response(JSON.stringify(responseBody), {
        status: 200, // NOT 500 - let frontend handle gracefully
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // For non-parse errors, still return structured error
    return new Response(JSON.stringify({
      ok: false,
      success: false,
      error_code: errorCode,
      error: message,
      user_message: "Space analysis failed. Please retry.",
      retry_available: true,
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
