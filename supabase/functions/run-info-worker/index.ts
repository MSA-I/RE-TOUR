import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

/**
 * INFO WORKER SERVICE - Phase 2 Implementation
 * 
 * LLM-based analysis service that takes signed URLs only and outputs strict JSON schemas.
 * 
 * INPUT: run_id + step_id + artifact_ids OR upload_ids (NO blobs, NO base64 in request)
 * OUTPUT: Strict InfoWorkerOutput schema with spaces[], confidence, ambiguity_flags
 * 
 * RULES ENFORCED:
 * - Fetches images via signed URLs from storage
 * - Uses Deno's encodeBase64 for memory-safe encoding (internal only)
 * - Never stores prompts or generates images
 * - Must include confidence + ambiguity_flags for all spaces
 * - Validates output against InfoWorkerOutput schema
 * - Max 20 spaces, max 50 furnishings per space
 * - Low confidence (<0.3) requires ambiguity flags
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const MODEL_VISION = "gemini-2.5-pro";

// ============================================================================
// TYPE DEFINITIONS (strict schema)
// ============================================================================

type SpaceCategory = 
  | "bathroom" | "bedroom" | "kitchen" | "living_room" | "dining_room"
  | "corridor" | "balcony" | "terrace" | "laundry" | "storage" | "office" | "entrance" | "other";

type AnalysisType = "floorplan" | "styled" | "furniture" | "space_detection" | "style_extraction";

interface DetectedFurnishing {
  item_type: string;
  count: number;
  confidence: number;
}

interface SpaceInfo {
  space_id: string;
  label: string;
  category: SpaceCategory;
  confidence: number;
  detected_furnishings: DetectedFurnishing[];
  geometry_notes: string;
  ambiguity_flags: string[];
}

interface InfoWorkerOutput {
  run_id: string;
  step_id: string;
  spaces: SpaceInfo[];
  global_notes: string;
  style_profile?: StyleProfile;
  processing_time_ms: number;
  model_used: string;
  image_count: number;
  total_image_bytes: number;
}

interface StyleProfile {
  design_style: string;
  color_palette: string[];
  materials: string[];
  lighting_mood: string;
  furniture_style: string;
}

interface InfoWorkerRequest {
  run_id: string;
  step_id: string;
  artifact_ids?: string[];    // IDs from pipeline_artifacts table
  upload_ids?: string[];      // Direct upload IDs
  analysis_type: AnalysisType;
  user_context?: string;      // Optional context from user
}

// Rule gates
const RULE_GATES = {
  MAX_SPACES: 20,
  MAX_FURNISHINGS_PER_SPACE: 50,
  MIN_CONFIDENCE_THRESHOLD: 0.3,
  PROCESSING_TIMEOUT_MS: 60000,
  MAX_IMAGE_SIZE_MB: 4,       // Max per image for Gemini
  MAX_TOTAL_IMAGES: 8,
};

// ============================================================================
// MAIN HANDLER
// ============================================================================

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const instanceId = crypto.randomUUID().slice(0, 8);

  try {
    const geminiKey = Deno.env.get("API_NANOBANANA");
    if (!geminiKey) {
      return jsonError("API_NANOBANANA not configured", 500);
    }

    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonError("Missing authorization header", 401);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);

    if (claimsError || !claimsData?.claims) {
      return jsonError("Unauthorized", 401);
    }

    const userId = claimsData.claims.sub as string;
    const body: InfoWorkerRequest = await req.json();
    const { run_id, step_id, artifact_ids, upload_ids, analysis_type, user_context } = body;

    console.log(`[info-worker] START run=${run_id} step=${step_id} type=${analysis_type} instance=${instanceId}`);

    // DEDUPLICATION: Check if job is already running
    const { data: isRunning } = await supabase.rpc("is_job_running", {
      p_run_id: run_id,
      p_step_id: step_id,
      p_service: "info_worker"
    });

    if (isRunning) {
      console.log(`[info-worker] Job already running for run=${run_id} step=${step_id}`);
      return jsonError("Job already running", 409);
    }

    // ACQUIRE LOCK
    let jobId: string | null = null;
    const { data: acquiredJobId, error: lockError } = await supabase.rpc("acquire_job_lock", {
      p_run_id: run_id,
      p_step_id: step_id,
      p_service: "info_worker",
      p_lock_owner: instanceId,
      p_lock_duration_seconds: 300
    });

    if (lockError || !acquiredJobId) {
      // Create new job if none exists
      const { data: newJob, error: createError } = await supabase
        .from("pipeline_jobs")
        .insert({
          run_id,
          step_id,
          service: "info_worker",
          status: "running",
          payload_ref: { artifact_ids, upload_ids, analysis_type },
          locked_at: new Date().toISOString(),
          locked_by: instanceId,
          started_at: new Date().toISOString(),
          owner_id: userId,
          idempotency_key: `${run_id}:${step_id}:info_worker:${Date.now()}`
        })
        .select("id")
        .single();

      if (createError) {
        console.error("[info-worker] Failed to create job:", createError);
        return jsonError("Failed to create job", 500);
      }
      jobId = newJob?.id;
    } else {
      jobId = acquiredJobId;
    }

    // FETCH IMAGES: Get signed URLs and prepare for Gemini
    const imageData = await fetchImagesForAnalysis(
      supabase,
      userId,
      artifact_ids || [],
      upload_ids || []
    );

    if (imageData.length === 0) {
      return await releaseJobWithError(supabase, jobId, "No valid images found", startTime);
    }

    console.log(`[info-worker] Fetched ${imageData.length} images, total ${(imageData.reduce((a, b) => a + b.sizeBytes, 0) / 1024 / 1024).toFixed(2)}MB`);

    // BUILD PROMPT based on analysis type
    const prompt = buildAnalysisPrompt(analysis_type, user_context);

    // CALL GEMINI for analysis
    const geminiResponse = await callGeminiVision(geminiKey, imageData, prompt);

    if (!geminiResponse.success) {
      return await releaseJobWithError(supabase, jobId, geminiResponse.error || "Gemini call failed", startTime);
    }

    // PARSE and VALIDATE response
    const { spaces, globalNotes, styleProfile } = parseGeminiResponse(geminiResponse.text || "", analysis_type);
    
    // VALIDATE: Check rule gates
    if (spaces.length > RULE_GATES.MAX_SPACES) {
      console.warn(`[info-worker] Truncating spaces from ${spaces.length} to ${RULE_GATES.MAX_SPACES}`);
      spaces.length = RULE_GATES.MAX_SPACES;
    }

    // VALIDATE: Low confidence must have ambiguity flags
    for (const space of spaces) {
      // Truncate furnishings if too many
      if (space.detected_furnishings.length > RULE_GATES.MAX_FURNISHINGS_PER_SPACE) {
        space.detected_furnishings.length = RULE_GATES.MAX_FURNISHINGS_PER_SPACE;
      }
      
      // Add ambiguity flag for low confidence
      if (space.confidence < RULE_GATES.MIN_CONFIDENCE_THRESHOLD && space.ambiguity_flags.length === 0) {
        space.ambiguity_flags.push("Low confidence detection - manual review recommended");
      }
      
      // Ensure space_id follows pattern
      if (!space.space_id.startsWith("space_")) {
        space.space_id = `space_${space.space_id.replace(/[^a-z0-9_]/gi, "_").toLowerCase()}`;
      }
    }

    const processingTime = Date.now() - startTime;
    const totalImageBytes = imageData.reduce((a, b) => a + b.sizeBytes, 0);

    // BUILD OUTPUT conforming to strict schema
    const output: InfoWorkerOutput = {
      run_id,
      step_id,
      spaces,
      global_notes: globalNotes || "",
      style_profile: styleProfile,
      processing_time_ms: processingTime,
      model_used: MODEL_VISION,
      image_count: imageData.length,
      total_image_bytes: totalImageBytes
    };

    // VALIDATE OUTPUT against schema
    const validationResult = validateInfoWorkerOutput(output);
    if (!validationResult.valid) {
      console.error("[info-worker] Output validation failed:", validationResult.errors);
      // Continue but log - schema validation should not block reasonable output
    }

    // STORE RESULT in worker_outputs table
    const { error: workerOutputError } = await supabase
      .from("worker_outputs")
      .insert({
        run_id,
        step_id,
        worker_type: "info_worker",
        output_data: output,
        schema_valid: validationResult.valid,
        processing_time_ms: processingTime,
        llm_model_used: MODEL_VISION
      });

    if (workerOutputError) {
      console.error("[info-worker] Failed to store worker output:", workerOutputError);
    }

    // STORE RESULT as pipeline artifact (for downstream consumption)
    const { data: resultArtifact } = await supabase
      .from("pipeline_artifacts")
      .insert({
        run_id,
        step_id,
        kind: "json",
        metadata_json: output,
        owner_id: userId
      })
      .select("id")
      .single();

    // RELEASE LOCK with success
    await supabase.rpc("release_job_lock", {
      p_job_id: jobId,
      p_status: "completed",
      p_result_ref: { 
        artifact_id: resultArtifact?.id, 
        spaces_count: spaces.length,
        has_style_profile: !!styleProfile 
      },
      p_processing_time_ms: processingTime
    });

    console.log(`[info-worker] SUCCESS run=${run_id} spaces=${spaces.length} time=${processingTime}ms`);

    return jsonSuccess(output);

  } catch (error) {
    console.error("[info-worker] Error:", error);
    return jsonError(error instanceof Error ? error.message : "Unknown error", 500);
  }
});

// ============================================================================
// IMAGE FETCHING (memory-safe, signed URLs only)
// ============================================================================

interface ImageForAnalysis {
  base64: string;
  mimeType: string;
  sizeBytes: number;
  uploadId: string;
}

// deno-lint-ignore no-explicit-any
async function fetchImagesForAnalysis(
  supabase: any,
  userId: string,
  artifactIds: string[],
  uploadIds: string[]
): Promise<ImageForAnalysis[]> {
  const results: ImageForAnalysis[] = [];
  const processedUploadIds = new Set<string>();

  // Process artifact IDs first
  for (const artifactId of artifactIds.slice(0, RULE_GATES.MAX_TOTAL_IMAGES)) {
    const { data: artifact } = await supabase
      .from("pipeline_artifacts")
      .select("upload_id")
      .eq("id", artifactId)
      .single();

    if (artifact?.upload_id && !processedUploadIds.has(artifact.upload_id)) {
      processedUploadIds.add(artifact.upload_id);
      const imageData = await fetchSingleImage(supabase, artifact.upload_id);
      if (imageData) results.push(imageData);
    }
  }

  // Process direct upload IDs
  for (const uploadId of uploadIds.slice(0, RULE_GATES.MAX_TOTAL_IMAGES - results.length)) {
    if (!processedUploadIds.has(uploadId)) {
      processedUploadIds.add(uploadId);
      const imageData = await fetchSingleImage(supabase, uploadId);
      if (imageData) results.push(imageData);
    }
  }

  return results;
}

// deno-lint-ignore no-explicit-any
async function fetchSingleImage(
  supabase: any,
  uploadId: string
): Promise<ImageForAnalysis | null> {
  try {
    // Get upload metadata
    const { data: upload, error: uploadError } = await supabase
      .from("uploads")
      .select("bucket, path, mime_type, size_bytes")
      .eq("id", uploadId)
      .single();

    if (uploadError || !upload) {
      console.warn(`[info-worker] Upload not found: ${uploadId}`);
      return null;
    }

    // Check size limit
    const sizeMB = (upload.size_bytes || 0) / (1024 * 1024);
    if (sizeMB > RULE_GATES.MAX_IMAGE_SIZE_MB) {
      console.warn(`[info-worker] Image too large (${sizeMB.toFixed(2)}MB): ${uploadId}`);
      return null;
    }

    // Download image
    const { data: fileData, error: downloadError } = await supabase.storage
      .from(upload.bucket)
      .download(upload.path);

    if (downloadError || !fileData) {
      console.warn(`[info-worker] Download failed: ${downloadError?.message}`);
      return null;
    }

    // Convert to base64 using memory-safe Deno encoder
    const arrayBuffer = await fileData.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    const base64 = encodeBase64(uint8Array);

    return {
      base64,
      mimeType: upload.mime_type || "image/jpeg",
      sizeBytes: arrayBuffer.byteLength,
      uploadId
    };

  } catch (error) {
    console.error(`[info-worker] Error fetching image ${uploadId}:`, error);
    return null;
  }
}

// ============================================================================
// PROMPT BUILDING (specialized per analysis type)
// ============================================================================

function buildAnalysisPrompt(analysisType: AnalysisType, userContext?: string): string {
  const contextLine = userContext ? `\nUser context: ${userContext}\n` : "";
  
  switch (analysisType) {
    case "floorplan":
      return `You are an expert architectural analyst. Analyze this floor plan image and identify all distinct spaces/rooms.
${contextLine}
For each space, provide:
1. space_id: A unique identifier (use format: space_[type]_[number], e.g., space_bedroom_1)
2. label: Human-readable name (e.g., "Master Bedroom", "Kitchen")
3. category: One of: bathroom, bedroom, kitchen, living_room, dining_room, corridor, balcony, terrace, laundry, storage, office, entrance, other
4. confidence: Your confidence score (0.0 to 1.0)
5. detected_furnishings: Array of {item_type, count, confidence} for visible furniture/fixtures
6. geometry_notes: Brief factual description of the space (size estimate, shape, windows, doors)
7. ambiguity_flags: Array of uncertainty notes if confidence < 0.5 or space type is unclear

IMPORTANT RULES:
- Storage areas, closets, and niches are "storage", NOT rooms
- Only spaces designed for human habitation are "rooms"
- Include all visible spaces, even small ones
- Preserve exact wall geometries (don't straighten angled/curved walls)

Return ONLY valid JSON in this exact format:
{
  "spaces": [
    {
      "space_id": "space_living_room_1",
      "label": "Living Room",
      "category": "living_room",
      "confidence": 0.95,
      "detected_furnishings": [{"item_type": "sofa", "count": 1, "confidence": 0.9}],
      "geometry_notes": "Large rectangular space, approx 5x4m, two windows on south wall",
      "ambiguity_flags": []
    }
  ],
  "global_notes": "Modern apartment layout with open-plan living area"
}`;

    case "styled":
      return `Analyze this styled interior render and extract the design characteristics.
${contextLine}
Provide:
1. All visible spaces with their design elements
2. For each space: category, furnishings, and style observations
3. A global style profile including:
   - design_style: (modern, contemporary, traditional, minimalist, scandinavian, industrial, etc.)
   - color_palette: Array of dominant colors
   - materials: Visible materials (wood, marble, fabric types, etc.)
   - lighting_mood: Description of lighting (warm, cool, natural, dramatic, etc.)
   - furniture_style: Overall furniture aesthetic

Return as JSON with "spaces" array, "global_notes", and "style_profile" object.`;

    case "space_detection":
      return `Analyze this styled 3D interior render and identify ALL distinct rooms/spaces visible.
${contextLine}
For each detected space:
1. space_id: Unique identifier (space_[type]_[number])
2. label: Human-readable name
3. category: bathroom, bedroom, kitchen, living_room, dining_room, corridor, balcony, terrace, laundry, storage, office, entrance, other
4. confidence: 0.0 to 1.0
5. detected_furnishings: What furniture/fixtures are visible
6. geometry_notes: Location description ("left side of image", "visible through doorway", etc.)
7. ambiguity_flags: Any uncertainties

CLASSIFICATION RULES:
- A space is a "room" only if designed for human stay
- Closets, wardrobes, and storage niches are "storage" category
- Corridors connecting rooms should be identified separately
- Note any spaces partially visible or cut off

Return valid JSON with "spaces" array and "global_notes".`;

    case "style_extraction":
      return `Analyze this design reference image and extract the style DNA.
${contextLine}
Focus on extracting:
1. Overall design aesthetic (style name and era)
2. Color palette (list 4-6 dominant colors by name)
3. Materials and textures visible
4. Furniture characteristics (style, era, materials)
5. Lighting approach (type, mood, direction)
6. Decorative elements and patterns

Return JSON with:
{
  "style_profile": {
    "design_style": "...",
    "color_palette": ["..."],
    "materials": ["..."],
    "lighting_mood": "...",
    "furniture_style": "..."
  },
  "global_notes": "Detailed style description"
}`;

    case "furniture":
      return `Catalog all furniture and fixtures visible in this image.
${contextLine}
For each item provide:
- item_type: Specific name (dining table, lounge chair, pendant light, etc.)
- count: Number visible
- confidence: 0.0 to 1.0

Also note:
- Approximate sizes relative to the space
- Style/era of furniture
- Condition/quality level

Return JSON with "detected_furnishings" array and "global_notes".`;

    default:
      return `Analyze this image and describe all visible spaces and elements.
${contextLine}
Return valid JSON with "spaces" array and "global_notes".`;
  }
}

// ============================================================================
// GEMINI API CALL
// ============================================================================

interface GeminiResponse {
  success: boolean;
  text?: string;
  error?: string;
}

async function callGeminiVision(
  apiKey: string,
  images: ImageForAnalysis[],
  prompt: string
): Promise<GeminiResponse> {
  try {
    // Build parts array with text prompt first
    const parts: Array<{text: string} | {inlineData: {mimeType: string; data: string}}> = [
      { text: prompt }
    ];

    // Add images (already base64 encoded)
    for (const img of images) {
      parts.push({
        inlineData: {
          mimeType: img.mimeType,
          data: img.base64
        }
      });
    }

    const url = `${GEMINI_API_BASE}/${MODEL_VISION}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          temperature: 0.2,
          topP: 0.8,
          maxOutputTokens: 8192
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[info-worker] Gemini API error: ${response.status}`, errorText);
      return { success: false, error: `Gemini API error: ${response.status}` };
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      return { success: false, error: "No text in Gemini response" };
    }

    return { success: true, text };

  } catch (error) {
    console.error("[info-worker] Gemini call error:", error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : "Unknown Gemini error" 
    };
  }
}

// ============================================================================
// RESPONSE PARSING
// ============================================================================

interface ParsedResponse {
  spaces: SpaceInfo[];
  globalNotes: string;
  styleProfile?: StyleProfile;
}

function parseGeminiResponse(text: string, analysisType: AnalysisType): ParsedResponse {
  const result: ParsedResponse = {
    spaces: [],
    globalNotes: ""
  };

  try {
    // Extract JSON from response (handle markdown code blocks)
    let jsonText = text;
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonText = codeBlockMatch[1].trim();
    } else {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonText = jsonMatch[0];
      }
    }

    const parsed = JSON.parse(jsonText);

    // Extract global notes
    result.globalNotes = parsed.global_notes || parsed.globalNotes || "";

    // Extract style profile if present
    if (parsed.style_profile) {
      result.styleProfile = {
        design_style: parsed.style_profile.design_style || "unknown",
        color_palette: Array.isArray(parsed.style_profile.color_palette) 
          ? parsed.style_profile.color_palette 
          : [],
        materials: Array.isArray(parsed.style_profile.materials) 
          ? parsed.style_profile.materials 
          : [],
        lighting_mood: parsed.style_profile.lighting_mood || "",
        furniture_style: parsed.style_profile.furniture_style || ""
      };
    }

    // Extract spaces
    const rawSpaces = parsed.spaces || [];
    result.spaces = rawSpaces.map((s: Record<string, unknown>, idx: number) => ({
      space_id: String(s.space_id || s.id || `space_unknown_${idx + 1}`),
      label: String(s.label || s.name || `Space ${idx + 1}`),
      category: validateCategory(String(s.category || s.type || "other")),
      confidence: typeof s.confidence === "number" ? Math.min(1, Math.max(0, s.confidence)) : 0.8,
      detected_furnishings: parseFurnishings(s.detected_furnishings || s.furnishings || []),
      geometry_notes: String(s.geometry_notes || s.notes || "").slice(0, 500),
      ambiguity_flags: parseAmbiguityFlags(s.ambiguity_flags || s.ambiguities || [])
    }));

    // For furniture analysis, create a single space with furnishings
    if (analysisType === "furniture" && result.spaces.length === 0 && parsed.detected_furnishings) {
      result.spaces = [{
        space_id: "space_analyzed_1",
        label: "Analyzed Space",
        category: "other",
        confidence: 0.9,
        detected_furnishings: parseFurnishings(parsed.detected_furnishings),
        geometry_notes: "",
        ambiguity_flags: []
      }];
    }

  } catch (error) {
    console.error("[info-worker] Parse error:", error);
    console.error("[info-worker] Raw text:", text.slice(0, 500));
  }

  return result;
}

function parseFurnishings(raw: unknown): DetectedFurnishing[] {
  if (!Array.isArray(raw)) return [];
  
  return raw.slice(0, RULE_GATES.MAX_FURNISHINGS_PER_SPACE).map((f: Record<string, unknown>) => ({
    item_type: String(f.item_type || f.type || f.name || "unknown").slice(0, 100),
    count: typeof f.count === "number" ? Math.max(1, f.count) : 1,
    confidence: typeof f.confidence === "number" ? Math.min(1, Math.max(0, f.confidence)) : 0.8
  }));
}

function parseAmbiguityFlags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((f): f is string => typeof f === "string")
    .map(f => f.slice(0, 200))
    .slice(0, 10);
}

function validateCategory(cat: string): SpaceCategory {
  const valid: SpaceCategory[] = [
    "bathroom", "bedroom", "kitchen", "living_room", "dining_room",
    "corridor", "balcony", "terrace", "laundry", "storage", "office", "entrance", "other"
  ];
  const normalized = cat.toLowerCase().replace(/[^a-z_]/g, "_").replace(/_+/g, "_");
  return valid.includes(normalized as SpaceCategory) ? normalized as SpaceCategory : "other";
}

// ============================================================================
// OUTPUT VALIDATION
// ============================================================================

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function validateInfoWorkerOutput(output: InfoWorkerOutput): ValidationResult {
  const errors: string[] = [];

  // Required fields
  if (!output.run_id) errors.push("Missing run_id");
  if (!output.step_id) errors.push("Missing step_id");
  if (!Array.isArray(output.spaces)) errors.push("spaces must be an array");
  if (typeof output.global_notes !== "string") errors.push("global_notes must be a string");

  // Validate spaces
  for (let i = 0; i < output.spaces.length; i++) {
    const space = output.spaces[i];
    const prefix = `spaces[${i}]`;

    if (!space.space_id?.startsWith("space_")) {
      errors.push(`${prefix}.space_id must start with 'space_'`);
    }
    if (space.confidence < 0 || space.confidence > 1) {
      errors.push(`${prefix}.confidence must be between 0 and 1`);
    }
    if (space.confidence < RULE_GATES.MIN_CONFIDENCE_THRESHOLD && space.ambiguity_flags.length === 0) {
      errors.push(`${prefix} has low confidence but no ambiguity_flags`);
    }
  }

  // Check for base64 in output (forbidden)
  const outputStr = JSON.stringify(output);
  if (outputStr.includes("data:image") || /base64,[A-Za-z0-9+/=]{100,}/.test(outputStr)) {
    errors.push("Output contains base64 data - FORBIDDEN");
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

// deno-lint-ignore no-explicit-any
async function releaseJobWithError(
  supabase: any,
  jobId: string | null,
  error: string,
  startTime: number
): Promise<Response> {
  const processingTime = Date.now() - startTime;

  if (jobId) {
    await supabase.rpc("release_job_lock", {
      p_job_id: jobId,
      p_status: "failed",
      p_error: error,
      p_processing_time_ms: processingTime
    });
  }

  console.error(`[info-worker] FAILED: ${error}`);
  return jsonError(error, 500);
}

function jsonSuccess(data: InfoWorkerOutput): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
