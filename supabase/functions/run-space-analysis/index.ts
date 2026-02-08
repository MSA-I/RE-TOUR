import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const API_NANOBANANA = Deno.env.get("API_NANOBANANA")!;

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const TEXT_ANALYSIS_MODEL = "gemini-2.5-pro";

const SPACE_ANALYSIS_PROMPT = `You are an expert architectural analyst. Analyze this 2D floor plan image and identify all distinct spaces.

CRITICAL OUTPUT RULES - FOLLOW EXACTLY:
1. Return ONLY valid JSON. No markdown. No code fences. No commentary.
2. Use double quotes for ALL keys and string values.
3. Do NOT include trailing commas after the last item in arrays or objects.
4. All arrays and objects MUST be properly closed with ] and }.
5. The response must start with { and end with } - nothing before or after.

CLASSIFICATION RULES:
ROOMS - True habitable/functional spaces for human use:
- Living Room, Kitchen, Bedroom(s), Bathroom(s), Office, Study, Dining Room, Balcony, Laundry Room

ZONES - Storage areas, corridors, and non-habitable spaces (NOT counted as rooms):
- Closet, Wardrobe, Built-in storage, Pantry, Hallway, Corridor, Shaft, Niche

OUTPUT SCHEMA - Return exactly this structure:
{
  "rooms": [
    {
      "room_id": "uuid-style-or-slug-id",
      "room_name": "Kitchen",
      "room_type": "room",
      "confidence": 0.95,
      "center": {"x_norm": 0.5, "y_norm": 0.3},
      "boundary": [{"x_norm": 0.0, "y_norm": 0.0}],
      "furniture": [{"type": "sink", "count": 1, "confidence": 0.9}],
      "notes": "Brief description"
    }
  ],
  "zones": [
    {
      "zone_id": "uuid-style-or-slug-id",
      "zone_name": "Closet",
      "zone_type": "zone",
      "confidence": 0.9,
      "center": {"x_norm": 0.2, "y_norm": 0.8},
      "boundary": [{"x_norm": 0.0, "y_norm": 0.0}],
      "notes": "Brief description"
    }
  ]
}

NAMING RULES (CRITICAL - MUST FOLLOW):
• "room_name" MUST be human-readable Title Case (e.g., "Kitchen", "Master Bedroom", "Living Room")
• "zone_name" MUST be human-readable Title Case (e.g., "Closet", "Hallway", "Storage")
• NEVER use enum slugs like "living_room", "bathroom_1", "room_1"
• NEVER use numeric-only names like "Room 1" or "Space 2"
• If multiple rooms of same type exist, number them in the NAME: "Bedroom 1", "Bedroom 2", "Bathroom 1"
• "room_id" and "zone_id" are internal machine IDs - use stable slugs like "bedroom-1", "kitchen-main"

REQUIRED FIELDS:
• Always include BOTH "rooms" and "zones" keys (can be empty arrays)
• Every room MUST have: room_id, room_name, room_type, confidence
• Every zone MUST have: zone_id, zone_name, zone_type, confidence
• Do NOT omit any required fields

CLASSIFICATION PREFERENCE:
• If ambiguous, prefer zones over rooms
• Only true human-use spaces go to rooms
• Closets, storage, shafts, corridors always go to zones`;



async function fetchImageAsBase64(supabase: any, uploadId: string): Promise<string> {
  const { data: upload } = await supabase.from("uploads").select("*").eq("id", uploadId).single();
  if (!upload) throw new Error(`Upload not found: ${uploadId}`);

  // Log file size for diagnostics
  const fileSizeMB = (upload.size_bytes / (1024 * 1024)).toFixed(2);
  console.log(`[fetchImageAsBase64] Downloading image: ${upload.original_filename} (${fileSizeMB} MB)`);

  // MEMORY SAFETY: Reject excessively large files
  const MAX_IMAGE_SIZE_MB = 15; // Conservative limit for Edge Function memory
  if (upload.size_bytes > MAX_IMAGE_SIZE_MB * 1024 * 1024) {
    throw new Error(
      `Image file too large: ${fileSizeMB} MB (max ${MAX_IMAGE_SIZE_MB} MB). ` +
      `Please resize the floor plan image before uploading.`
    );
  }

  const { data: fileData } = await supabase.storage.from(upload.bucket).download(upload.path);
  if (!fileData) throw new Error("Failed to download image");

  const arrayBuffer = await fileData.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);

  console.log(`[fetchImageAsBase64] Converting to base64: ${uint8Array.length} bytes`);

  // Convert to base64 using more memory-efficient approach
  let binary = "";
  for (let i = 0; i < uint8Array.length; i++) {
    binary += String.fromCharCode(uint8Array[i]);
  }

  const base64 = btoa(binary);
  console.log(`[fetchImageAsBase64] Base64 size: ${(base64.length / (1024 * 1024)).toFixed(2)} MB`);

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

Extract:
1. OVERALL DESIGN STYLE (primary style, secondary influences, mood keywords)
2. COLOR PALETTE (primary, secondary, accent colors with hex codes)
3. MATERIAL LANGUAGE (flooring, walls, wood tones, metal finishes, fabrics, stone)
4. LIGHTING MOOD (temperature, intensity, mood)
5. TEXTURE LEVEL (density, key elements)
6. STYLE RULES (do/don't guidelines)

OUTPUT FORMAT - Return ONLY this JSON object:
{
  "design_style": { "primary": "...", "secondary": [...], "mood_keywords": [...] },
  "color_palette": { "primary": "#...", "secondary": [...], "accent": [...], "temperature": "..." },
  "materials": { "flooring": "...", "walls": "...", "wood_tone": "...", "metal_finish": "...", "fabrics": "...", "stone": "..." },
  "lighting": { "temperature": "...", "intensity": "...", "mood": "..." },
  "texture_level": { "density": "...", "key_elements": [...] },
  "style_rules": { "do": [...], "avoid": [...] },
  "summary_prompt": "A concise 2-3 sentence style description."
}

STRICT RULES:
- Output ONLY the JSON object above, nothing else
- Do NOT wrap in markdown code blocks (\`\`\`)
- Do NOT include any explanatory text before or after the JSON
- The response must start with { and end with }`;

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
      const { data: upload } = await supabase.from("uploads").select("bucket, path").eq("id", refId).eq("owner_id", ownerId).single();
      if (upload) {
        const { data: fileData } = await supabase.storage.from(upload.bucket).download(upload.path);
        if (fileData) {
          const arrayBuffer = await fileData.arrayBuffer();
          const uint8Array = new Uint8Array(arrayBuffer);
          let binary = "";
          for (let i = 0; i < uint8Array.length; i++) {
            binary += String.fromCharCode(uint8Array[i]);
          }
          referenceImages.push({ id: refId, base64: btoa(binary) });
        }
      }
    } catch (err) {
      console.error(`[runStyleAnalysis] Failed to load reference ${refId}:`, err);
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
  console.log(`[SPACE_ANALYSIS] Action ${actionId} started`);

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

    const { pipeline_id } = await req.json();
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
    // LANGFUSE: Create or ensure trace for this pipeline run
    // ═══════════════════════════════════════════════════════════════════════════
    let traceId = pipeline_id; // Use pipeline_id as trace_id for easy linking
    if (isLangfuseEnabled()) {
      console.log(`[LANGFUSE] Creating/ensuring trace for pipeline: ${pipeline_id}`);
      const traceResult = await createPipelineRunTrace(
        pipeline_id,
        pipeline.project_id,
        userId,
        { action_id: actionId }
      );
      traceId = traceResult.traceId;
      console.log(`[LANGFUSE] Trace ID: ${traceId}`);
    }

    const imageBase64 = await fetchImageAsBase64(serviceClient, pipeline.floor_plan_upload_id);

    // VALIDATION: Ensure base64 is valid
    if (!imageBase64 || imageBase64.length < 100) {
      console.error("[run-space-analysis] Invalid base64 image data");
      throw new Error("Floor plan image could not be loaded or is corrupted. Please re-upload the image.");
    }

    await emitEvent(serviceClient, pipeline_id, userId, 0, "info", "Analyzing floor plan structure...", 20);

    // ═══════════════════════════════════════════════════════════════════════════
    // MEMORY OPTIMIZATION: Flush Langfuse early before heavy operations
    // ═══════════════════════════════════════════════════════════════════════════
    console.log("[run-space-analysis] Flushing Langfuse before Gemini call to free memory...");
    await flushLangfuse();

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

    // MEMORY OPTIMIZATION: Conservative token limit to prevent memory exhaustion
    // 8K is more conservative and matches the original limit before issues
    // Style analysis (Step 0.1) uses only 2K tokens successfully
    const spaceRequestParams = { temperature: 0.3, maxOutputTokens: 8192, responseMimeType: "application/json" };
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
    console.log("[run-space-analysis] Generation complete, flushing Langfuse events...");
    await flushLangfuse();

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

    const existingOutputs = (pipeline.step_outputs || {}) as Record<string, unknown>;
    let updatedOutputs: Record<string, unknown> = {
      ...existingOutputs,
      space_analysis: {
        rooms_count: rooms.length, zones_count: zones.length, rooms, zones,
        overall_notes: analysisData.overall_notes, analyzed_at: new Date().toISOString(),
      },
    };

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

    await serviceClient.from("floorplan_pipelines").update({ whole_apartment_phase: "space_analysis_complete", step_outputs: updatedOutputs }).eq("id", pipeline_id);
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
    
    // CRITICAL: Flush Langfuse events before returning
    await flushLangfuse();
    
    return new Response(JSON.stringify({ success: true, rooms_count: rooms.length, zones_count: zones.length, rooms, zones, action_id: actionId }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[SPACE_ANALYSIS] Error: ${message}`);
    
    // Check if this is a parse error - return structured response, NOT 500
    const isParseError = (error as any)?.isParseError === true;
    const errorCode = (error as any)?.errorCode || "UNKNOWN_ERROR";
    const debugInfo = (error as any)?.debugInfo as ParseDebugInfo | undefined;
    
    // Flush Langfuse even on error
    await flushLangfuse();
    
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
        const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const authHeader = req.headers.get("Authorization");
        const token = authHeader?.replace("Bearer ", "") || "";
        const { data: claimsData } = await serviceClient.auth.getUser(token);
        
        if (claimsData?.user) {
          const { pipeline_id } = await req.json().catch(() => ({}));
          if (pipeline_id) {
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
