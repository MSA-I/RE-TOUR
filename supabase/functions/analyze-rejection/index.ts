import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";
import {
  buildHumanFeedbackMemory,
  type HumanFeedbackMemory,
} from "../_shared/human-feedback-memory.ts";

/**
 * REJECTION ANALYSIS ENGINE (v2 - WITH HUMAN FEEDBACK LEARNING)
 * 
 * AI-powered analysis of why an output was rejected.
 * This creates STRUCTURED failure analysis that drives prompt regeneration.
 * 
 * NOW INCLUDES: Similar past user rejections for context.
 * 
 * Input: rejected_image, reject_reason, step context
 * Output: StructuredRejectionAnalysis stored in DB
 * 
 * CRITICAL: This is NOT a simple categorization.
 * The AI must UNDERSTAND the rejection and produce actionable fixes.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const API_NANOBANANA = Deno.env.get("API_NANOBANANA");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const ANALYSIS_MODEL = "gemini-2.5-flash";

// FAILURE CATEGORIES - these are the only allowed categories
const FAILURE_CATEGORIES = [
  "wrong_room",
  "wrong_camera_direction",
  "hallucinated_opening",
  "missing_major_furniture",
  "extra_major_furniture",
  "layout_mismatch",
  "ignored_camera",
  "structural_change",
  "flooring_mismatch",
  "scale_mismatch",
  "artifact",
  "seam_issue",
  "perspective_distortion",
  "style_mismatch",
  "other"
] as const;

type FailureCategory = typeof FAILURE_CATEGORIES[number];

interface StructuredRejectionAnalysis {
  failure_categories: FailureCategory[];
  root_cause_summary: string;
  constraints_to_add: string[];
  constraints_to_remove: string[];
  confidence: number;
  analyzed_at: string;
}

interface AnalyzeRejectionRequest {
  asset_type: "render" | "panorama" | "final360" | "step";
  asset_id: string;
  step_number?: number;
  reject_reason: string;
  rejected_image_url?: string;
  source_image_url?: string;
  previous_prompt?: string;
  space_type?: string;
  camera_direction?: string;
  // NEW: Project ID for fetching human feedback memory
  project_id?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const body: AnalyzeRejectionRequest = await req.json();
    const {
      asset_type,
      asset_id,
      step_number,
      reject_reason,
      rejected_image_url,
      source_image_url,
      previous_prompt,
      space_type,
      camera_direction,
      project_id,
    } = body;

    if (!reject_reason?.trim()) {
      return new Response(JSON.stringify({ error: "reject_reason is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[analyze-rejection] Analyzing ${asset_type} ${asset_id} rejection: "${reject_reason.slice(0, 100)}..."`);

    // Build context for analysis
    const stepContext = getStepContext(step_number || 0, asset_type);

    // NEW: Fetch similar past rejections from human feedback for PATTERN learning only
    // CRITICAL: We extract CATEGORIES and PATTERNS, NOT verbatim user text
    let similarRejectionsContext = "";
    if (project_id) {
      try {
        const humanFeedbackMemory = await buildHumanFeedbackMemory(
          serviceClient,
          userId,
          project_id,
          step_number || 5,
          { limit: 10 }
        );

        // Extract rejection PATTERNS only (not verbatim text)
        const pastRejections = humanFeedbackMemory.recent_examples
          .filter(ex => ex.decision === "rejected")
          .slice(0, 5);

        if (pastRejections.length > 0) {
          // Build STRUCTURED pattern summary (no verbatim user text)
          const categoryPattern: Record<string, number> = {};
          const spaceTypePattern: Record<string, number> = {};

          pastRejections.forEach(r => {
            const spaceType = r.output_context.space_type || "unknown";
            spaceTypePattern[spaceType] = (spaceTypePattern[spaceType] || 0) + 1;

            // Extract categories from reason text via keyword matching (not verbatim)
            const reasonLower = (r.reason_text || "").toLowerCase();
            if (reasonLower.includes("furniture")) categoryPattern["furniture"] = (categoryPattern["furniture"] || 0) + 1;
            if (reasonLower.includes("wall") || reasonLower.includes("structural")) categoryPattern["structural"] = (categoryPattern["structural"] || 0) + 1;
            if (reasonLower.includes("camera") || reasonLower.includes("angle")) categoryPattern["camera"] = (categoryPattern["camera"] || 0) + 1;
            if (reasonLower.includes("scale") || reasonLower.includes("size")) categoryPattern["scale"] = (categoryPattern["scale"] || 0) + 1;
            if (reasonLower.includes("seam") || reasonLower.includes("artifact")) categoryPattern["quality"] = (categoryPattern["quality"] || 0) + 1;
          });

          similarRejectionsContext = `\n
=== USER REJECTION PATTERNS (structured learning, NOT verbatim text) ===
Past rejections count: ${pastRejections.length}
Common rejection categories: ${Object.entries(categoryPattern).sort((a, b) => b[1] - a[1]).map(([cat, cnt]) => `${cat}(${cnt}x)`).join(", ")}
Rejected space types: ${Object.entries(spaceTypePattern).sort((a, b) => b[1] - a[1]).map(([type, cnt]) => `${type}(${cnt}x)`).join(", ")}
User strictness: ${humanFeedbackMemory.calibration_hints.user_strictness}
=======================================================================
Use these PATTERNS to understand what this user typically rejects.
Focus on the CATEGORIES, not specific wording.
`;
          console.log(`[analyze-rejection] Injected pattern summary from ${pastRejections.length} past rejections`);
        }
      } catch (e) {
        console.warn(`[analyze-rejection] Could not fetch past rejections: ${e}`);
      }
    }

    // Construct the analysis prompt
    const analysisPrompt = buildAnalysisPrompt({
      reject_reason,
      step_context: stepContext,
      space_type,
      camera_direction,
      previous_prompt,
      has_rejected_image: !!rejected_image_url,
      has_source_image: !!source_image_url,
      similar_rejections_context: similarRejectionsContext,
    });

    // Call Gemini for analysis
    if (!API_NANOBANANA) {
      throw new Error("API_NANOBANANA not configured");
    }

    const geminiUrl = `${GEMINI_API_BASE}/${ANALYSIS_MODEL}:generateContent?key=${API_NANOBANANA}`;

    // Build request parts
    const parts: Array<{ text: string } | { inline_data: { mime_type: string; data: string } }> = [
      { text: analysisPrompt }
    ];

    // Add images if available (for multimodal analysis)
    if (rejected_image_url) {
      try {
        const imageData = await fetchImageAsBase64(rejected_image_url);
        if (imageData) {
          parts.push({
            inline_data: {
              mime_type: "image/jpeg",
              data: imageData
            }
          });
          parts.push({ text: "REJECTED IMAGE (above): Analyze what went wrong in this output." });
        }
      } catch (e) {
        console.warn(`[analyze-rejection] Could not fetch rejected image: ${e}`);
      }
    }

    if (source_image_url) {
      try {
        const imageData = await fetchImageAsBase64(source_image_url);
        if (imageData) {
          parts.push({
            inline_data: {
              mime_type: "image/jpeg",
              data: imageData
            }
          });
          parts.push({ text: "SOURCE IMAGE (above): Reference for comparison." });
        }
      } catch (e) {
        console.warn(`[analyze-rejection] Could not fetch source image: ${e}`);
      }
    }

    const response = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 2000,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[analyze-rejection] Gemini API error: ${errorText}`);
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const result = await response.json();
    const rawOutput = result.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawOutput) {
      throw new Error("No analysis output from Gemini");
    }

    // Parse the structured analysis
    let analysis: StructuredRejectionAnalysis;
    try {
      const parsed = JSON.parse(rawOutput);
      analysis = validateAndNormalizeAnalysis(parsed);
    } catch (e) {
      console.error(`[analyze-rejection] Failed to parse analysis: ${rawOutput}`);
      // Fallback to basic analysis
      analysis = createFallbackAnalysis(reject_reason);
    }

    console.log(`[analyze-rejection] Analysis complete:`, {
      categories: analysis.failure_categories,
      constraints_to_add: analysis.constraints_to_add.length,
    });

    // Store analysis in database
    const analysisRecord = {
      asset_type,
      asset_id,
      step_number,
      owner_id: userId,
      reject_reason,
      analysis_json: analysis,
      created_at: new Date().toISOString(),
    };

    // Also update the asset's qa_report with the analysis
    await storeAnalysisOnAsset(serviceClient, asset_type, asset_id, analysis);

    return new Response(JSON.stringify({
      ok: true,
      analysis,
      message: "Rejection analyzed successfully",
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[analyze-rejection] Error: ${message}`);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function getStepContext(stepNumber: number, assetType: string): string {
  if (assetType === "render") {
    return `STEP 5 (Eye-Level Room Render):
- Output should be a photorealistic interior view from a specific camera position
- Must respect room type (bedroom, bathroom, kitchen, etc.)
- Major furniture must match floor plan exactly
- Camera direction and FOV must match the camera marker
- No hallucinated openings to non-adjacent rooms`;
  }
  
  if (assetType === "panorama") {
    return `STEP 6 (360° Panorama Expansion):
- Output should be a 2:1 equirectangular panorama
- Must wrap seamlessly at edges
- Must preserve all elements from the source render
- No seam artifacts or ghosting
- Correct perspective for VR viewing`;
  }
  
  if (assetType === "final360") {
    return `STEP 7 (360° Merge):
- Output should merge two panorama views into one cohesive 360°
- Must have seamless blending
- No duplicate furniture or elements
- Consistent lighting and style`;
  }

  switch (stepNumber) {
    case 1:
      return `STEP 1 (Floor Plan → Top-Down 3D):
- Output should be a top-down 3D visualization of the floor plan
- Room count and types must match exactly
- Major furniture must be present and correctly scaled
- Walls, doors, windows must match the source plan
- TEXT AND LABELS ARE COMPLETELY IGNORED`;
    case 2:
      return `STEP 2 (Style Top-Down):
- Output should apply style/materials to the Step 1 output
- Layout must NOT change - same furniture, same positions
- Only textures, colors, materials may change
- Room structure is frozen`;
    default:
      return `Pipeline step ${stepNumber}`;
  }
}

interface PromptContext {
  reject_reason: string;
  step_context: string;
  space_type?: string;
  camera_direction?: string;
  previous_prompt?: string;
  has_rejected_image: boolean;
  has_source_image: boolean;
  // NEW: Similar past rejections for learning
  similar_rejections_context?: string;
}

/**
 * Extract structured rejection keywords WITHOUT showing verbatim user text
 * This prevents prompt pollution while still understanding the issue
 */
function extractRejectionKeywords(rejectReason: string): {
  categories: string[];
  concerns: string[];
} {
  const reasonLower = rejectReason.toLowerCase();
  const categories: string[] = [];
  const concerns: string[] = [];

  // Map user words to standard categories
  if (reasonLower.includes("furniture") || reasonLower.includes("chair") || reasonLower.includes("table") || reasonLower.includes("bed")) {
    categories.push("furniture");
    if (reasonLower.includes("missing") || reasonLower.includes("no ") || reasonLower.includes("lack")) {
      concerns.push("missing_furniture");
    }
    if (reasonLower.includes("extra") || reasonLower.includes("added") || reasonLower.includes("unwanted")) {
      concerns.push("extra_furniture");
    }
    if (reasonLower.includes("scale") || reasonLower.includes("size") || reasonLower.includes("too big") || reasonLower.includes("too small")) {
      concerns.push("furniture_scale");
    }
  }

  if (reasonLower.includes("wall") || reasonLower.includes("door") || reasonLower.includes("window") || reasonLower.includes("structural")) {
    categories.push("structural");
    concerns.push("structural_change");
  }

  if (reasonLower.includes("camera") || reasonLower.includes("angle") || reasonLower.includes("direction") || reasonLower.includes("view")) {
    categories.push("camera");
    concerns.push("camera_mismatch");
  }

  if (reasonLower.includes("room") && (reasonLower.includes("wrong") || reasonLower.includes("different"))) {
    categories.push("room_type");
    concerns.push("wrong_room");
  }

  if (reasonLower.includes("floor") || reasonLower.includes("flooring") || reasonLower.includes("carpet") || reasonLower.includes("tile")) {
    categories.push("flooring");
    concerns.push("flooring_mismatch");
  }

  if (reasonLower.includes("seam") || reasonLower.includes("artifact") || reasonLower.includes("distort") || reasonLower.includes("blur")) {
    categories.push("quality");
    concerns.push("visual_quality");
  }

  if (reasonLower.includes("scale") || reasonLower.includes("proportion") || reasonLower.includes("size")) {
    categories.push("scale");
    concerns.push("scale_mismatch");
  }

  if (reasonLower.includes("style") || reasonLower.includes("material") || reasonLower.includes("color")) {
    categories.push("style");
    concerns.push("style_mismatch");
  }

  // Default if no categories matched
  if (categories.length === 0) {
    categories.push("general");
    concerns.push("quality_issue");
  }

  return { categories, concerns };
}

function buildAnalysisPrompt(ctx: PromptContext): string {
  // CRITICAL: We INTERPRET the rejection reason, not copy it verbatim
  // Extract structured categories from the rejection for analysis
  const rejectionKeywords = extractRejectionKeywords(ctx.reject_reason);

  return `You are an expert QA analyst for an AI architectural visualization pipeline.

A generated image was REJECTED. Your task is to analyze WHY and produce a STRUCTURED analysis.

=== REJECTION SIGNAL (interpreted, not verbatim) ===
Rejection indication detected with categories: ${rejectionKeywords.categories.join(", ")}
Key concerns: ${rejectionKeywords.concerns.join(", ")}
Your task: Provide structured analysis with failure_categories and corrective constraints.

=== STEP CONTEXT ===
${ctx.step_context}

${ctx.space_type ? `=== SPACE TYPE ===\n${ctx.space_type}` : ""}
${ctx.camera_direction ? `=== CAMERA DIRECTION ===\n${ctx.camera_direction}` : ""}
${ctx.previous_prompt ? `=== PREVIOUS PROMPT USED ===\n"${ctx.previous_prompt.slice(0, 500)}..."` : ""}
${ctx.similar_rejections_context || ""}

=== YOUR TASK ===
Analyze the rejection and output a JSON object with this EXACT structure:

{
  "failure_categories": ["category1", "category2"],
  "root_cause_summary": "One clear sentence explaining the core issue",
  "constraints_to_add": [
    "Specific instruction to add to prevent this failure",
    "Another specific instruction if needed"
  ],
  "constraints_to_remove": [
    "Any existing instruction that caused the problem (if applicable)"
  ],
  "confidence": 0.85
}

=== ALLOWED FAILURE CATEGORIES ===
- "wrong_room" - Output shows different room than intended
- "wrong_camera_direction" - Camera facing wrong direction
- "hallucinated_opening" - Shows door/window to non-adjacent room
- "missing_major_furniture" - Expected furniture is absent
- "extra_major_furniture" - Furniture added that wasn't in plan
- "layout_mismatch" - Room layout doesn't match floor plan
- "ignored_camera" - Camera position/angle not respected
- "structural_change" - Walls/doors/windows modified
- "flooring_mismatch" - Wrong flooring type
- "scale_mismatch" - Furniture/room scale is wrong
- "artifact" - Visual artifacts or distortions
- "seam_issue" - Visible seams or edge problems (panoramas)
- "perspective_distortion" - Fisheye or perspective errors
- "style_mismatch" - Style inconsistent with design references
- "other" - Only if nothing else fits

=== RULES ===
1. Choose 1-3 failure categories maximum (most specific ones)
2. constraints_to_add should be SHORT, SPECIFIC instructions (1 sentence each)
3. Do NOT add generic constraints like "be more careful"
4. If the rejection mentions something specific, address THAT specifically
5. confidence should be 0.5-1.0 based on how clear the rejection reason is

${ctx.has_rejected_image ? "You will see the REJECTED IMAGE - analyze what went wrong visually." : ""}
${ctx.has_source_image ? "You will see the SOURCE IMAGE - compare against it." : ""}

Output ONLY valid JSON, no other text.`;
}

function validateAndNormalizeAnalysis(parsed: unknown): StructuredRejectionAnalysis {
  const obj = parsed as Record<string, unknown>;
  
  // Validate and normalize failure_categories
  const rawCategories = Array.isArray(obj.failure_categories) ? obj.failure_categories : [];
  const validCategories = rawCategories
    .filter((c): c is string => typeof c === "string")
    .map(c => c.toLowerCase().replace(/\s+/g, "_"))
    .filter((c): c is FailureCategory => FAILURE_CATEGORIES.includes(c as FailureCategory))
    .slice(0, 3);
  
  if (validCategories.length === 0) {
    validCategories.push("other");
  }

  // Validate constraints
  const constraintsToAdd = Array.isArray(obj.constraints_to_add)
    ? obj.constraints_to_add.filter((c): c is string => typeof c === "string").slice(0, 5)
    : [];
  
  const constraintsToRemove = Array.isArray(obj.constraints_to_remove)
    ? obj.constraints_to_remove.filter((c): c is string => typeof c === "string").slice(0, 3)
    : [];

  return {
    failure_categories: validCategories,
    root_cause_summary: typeof obj.root_cause_summary === "string" 
      ? obj.root_cause_summary.slice(0, 200) 
      : "Analysis unavailable",
    constraints_to_add: constraintsToAdd,
    constraints_to_remove: constraintsToRemove,
    confidence: typeof obj.confidence === "number" ? Math.min(1, Math.max(0, obj.confidence)) : 0.5,
    analyzed_at: new Date().toISOString(),
  };
}

function createFallbackAnalysis(rejectReason: string): StructuredRejectionAnalysis {
  // Simple keyword matching for fallback
  const reason = rejectReason.toLowerCase();
  const categories: FailureCategory[] = [];

  if (reason.includes("room") && (reason.includes("wrong") || reason.includes("different"))) {
    categories.push("wrong_room");
  }
  if (reason.includes("camera") || reason.includes("direction") || reason.includes("angle")) {
    categories.push("wrong_camera_direction");
  }
  if (reason.includes("furniture") && (reason.includes("missing") || reason.includes("no "))) {
    categories.push("missing_major_furniture");
  }
  if (reason.includes("furniture") && (reason.includes("extra") || reason.includes("added"))) {
    categories.push("extra_major_furniture");
  }
  if (reason.includes("wall") || reason.includes("door") || reason.includes("window") || reason.includes("structural")) {
    categories.push("structural_change");
  }
  if (reason.includes("seam") || reason.includes("edge") || reason.includes("wrap")) {
    categories.push("seam_issue");
  }
  if (reason.includes("artifact") || reason.includes("distort")) {
    categories.push("artifact");
  }

  if (categories.length === 0) {
    categories.push("other");
  }

  return {
    failure_categories: categories.slice(0, 3) as FailureCategory[],
    root_cause_summary: rejectReason.slice(0, 200),
    constraints_to_add: [`Fix issue: ${rejectReason.slice(0, 100)}`],
    constraints_to_remove: [],
    confidence: 0.5,
    analyzed_at: new Date().toISOString(),
  };
}

async function fetchImageAsBase64(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
    return base64;
  } catch {
    return null;
  }
}

// deno-lint-ignore no-explicit-any
async function storeAnalysisOnAsset(
  serviceClient: any,
  assetType: string,
  assetId: string,
  analysis: StructuredRejectionAnalysis
): Promise<void> {
  const tableName = assetType === "render"
    ? "floorplan_space_renders"
    : assetType === "panorama"
    ? "floorplan_space_panoramas"
    : assetType === "final360"
    ? "floorplan_space_final360"
    : null;

  if (!tableName) {
    // For step-level rejections, store on pipeline
    console.log(`[analyze-rejection] Asset type ${assetType} not mapped to table, skipping storage`);
    return;
  }

  const { data: asset } = await serviceClient
    .from(tableName)
    .select("qa_report")
    .eq("id", assetId)
    .single();

  const updatedQaReport = {
    ...(asset?.qa_report || {}),
    rejection_analysis: analysis,
  };

  await serviceClient
    .from(tableName)
    .update({ qa_report: updatedQaReport })
    .eq("id", assetId);

  console.log(`[analyze-rejection] Stored analysis on ${tableName}.${assetId}`);
}
