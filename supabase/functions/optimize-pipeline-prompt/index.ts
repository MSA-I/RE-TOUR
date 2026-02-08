import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";
import {
  buildHumanFeedbackMemory,
  formatHumanFeedbackForPrompt,
  type HumanFeedbackMemory,
} from "../_shared/human-feedback-memory.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const API_NANOBANANA = Deno.env.get("API_NANOBANANA");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Gemini API configuration
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const ORCHESTRATION_MODEL = "gemini-3-flash-preview";

// Step-specific rules for prompt optimization
const STEP_RULES: Record<number, string> = {
  1: `STEP 1 RULES - 2D Realistic Plan Design:
- ONLY apply visual styles to the 2D floor plan (blueprint, sketch, watercolor, etc.)
- PRESERVE exact geometry, walls, room sizes, and proportions
- NO furniture, interior 3D rendering, or staging
- Focus on linework, textures, colors, and paper/print aesthetics
- Output must remain a top-down 2D plan view`,

  2: `STEP 2 RULES - Eye-Level Interior Render:
- Transform the plan into a photorealistic interior view
- Apply materials, lighting, furniture styles as specified
- Camera should be at eye-level looking into the space
- Preserve room layout and proportions from the plan
- Focus on interior design aesthetics and atmosphere`,

  3: `STEP 3 RULES - Camera-Angle Render:
- Generate a photorealistic render from a specific camera angle
- Focus ONLY on camera angle, camera position, framing, and perspective
- Preserve all walls, furniture, and proportions from the source image exactly
- Do NOT redesign the space, change style themes, or add/remove objects
- Use realistic focal length and avoid fisheye distortion`,

  4: `STEP 4 RULES - 360° Equirectangular Panorama:
- Generate a true 2:1 equirectangular panorama
- No fisheye circles or warped geometry
- Straight verticals, correct VR-ready perspective
- Preserve all elements from the source image
- Suitable for virtual tour viewers`
};

/**
 * BOUNDED CATEGORY PATCHES
 * These are the ONLY constraints that can be applied based on rejection categories.
 * Raw rejection reasons are NEVER injected into generation prompts.
 */
const CATEGORY_BOUNDED_PATCHES: Record<string, string> = {
  // Room/Layout issues
  wrong_room: "Generate ONLY the specified room - do not show adjacent rooms or different spaces.",
  wrong_camera_direction: "Camera MUST face the specified direction - verify camera orientation before rendering.",
  hallucinated_opening: "Do NOT create doorways or windows that don't exist in the floor plan.",
  layout_mismatch: "Match room layout EXACTLY to the floor plan - same proportions and arrangement.",
  
  // Furniture issues
  missing_major_furniture: "Include ALL major furniture shown in the floor plan.",
  extra_major_furniture: "Do NOT add furniture beyond what appears in the floor plan.",
  furniture_scale: "Ensure furniture scale is proportional to room dimensions.",
  scale_mismatch: "Verify furniture and room scale matches real-world proportions.",
  
  // Structural issues
  structural_change: "Preserve exact wall positions, doors, and windows from source.",
  ignored_camera: "Respect the camera position and viewing angle specified in the request.",
  
  // Surface/Material issues
  flooring_mismatch: "Match flooring materials to room type expectations.",
  style_mismatch: "Apply the specified design style consistently throughout.",
  
  // Quality issues
  artifact: "Generate clean image without visual artifacts or distortions.",
  perspective: "Use correct eye-level perspective without distortion.",
  perspective_distortion: "Avoid fisheye distortion - use natural perspective.",
  seam_issue: "Ensure seamless blending at all edges - no visible joins or ghosting.",
  
  // Legacy compatibility
  room_type_violation: "Generate appropriate fixtures for the declared room type.",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    // Verify user auth
    const supabaseUser = createClient(
      SUPABASE_URL,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      throw new Error("Unauthorized");
    }

    const { 
      step_number, 
      suggestion_prompt, 
      user_additions, 
      mode,
      rejection_category, // Structured category from analyze-rejection
      rejection_analysis, // Full structured analysis from analyze-rejection
      previous_prompt,
      // NEW: QA Feedback signals for learning
      qa_feedback,
      // NEW: Human feedback memory from caller
      human_feedback_memory,
      // NEW: Project context for fetching feedback if not provided
      project_id,
    } = await req.json();

    if (!step_number) {
      throw new Error("step_number is required");
    }

    const stepRules = STEP_RULES[step_number];
    if (!stepRules) {
      throw new Error(`Invalid step number: ${step_number}`);
    }

    // Parse QA feedback if provided
    interface QAFeedbackSignal {
      user_score?: number;
      user_comment?: string;
      last_qa_reason_text?: string;
      last_qa_decision?: "approved" | "rejected";
    }
    const feedbackSignal = qa_feedback as QAFeedbackSignal | undefined;
    
    // NEW: Fetch human feedback memory if not provided but project_id is available
    let effectiveHumanFeedbackMemory = human_feedback_memory as HumanFeedbackMemory | undefined;
    let humanFeedbackPrompt = "";
    
    if (!effectiveHumanFeedbackMemory && project_id) {
      try {
        const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        effectiveHumanFeedbackMemory = await buildHumanFeedbackMemory(
          serviceClient,
          user.id,
          project_id,
          step_number,
          { limit: 15 }
        );
        humanFeedbackPrompt = formatHumanFeedbackForPrompt(effectiveHumanFeedbackMemory);
        console.log(`[optimize-pipeline-prompt] Fetched human feedback: ${effectiveHumanFeedbackMemory.examples_count} examples`);
      } catch (e) {
        console.warn(`[optimize-pipeline-prompt] Could not fetch human feedback: ${e}`);
      }
    } else if (effectiveHumanFeedbackMemory) {
      humanFeedbackPrompt = formatHumanFeedbackForPrompt(effectiveHumanFeedbackMemory);
    }

    let systemPrompt = "";
    let userPrompt = "";

    if (mode === "improve_after_rejection") {
      // ═══════════════════════════════════════════════════════════════════
      // LEARNING LOOP: Use structured rejection analysis for prompt improvement
      // ═══════════════════════════════════════════════════════════════════
      
      interface RejectionAnalysis {
        failure_categories?: string[];
        root_cause_summary?: string;
        constraints_to_add?: string[];
        constraints_to_remove?: string[];
      }
      
      const analysis = rejection_analysis as RejectionAnalysis | undefined;
      
      // Build delta patches from analysis
      const deltaPatches: string[] = [];
      
      // 1. Add patches based on failure categories
      if (analysis?.failure_categories) {
        for (const category of analysis.failure_categories) {
          const patch = CATEGORY_BOUNDED_PATCHES[category];
          if (patch && !deltaPatches.includes(patch)) {
            deltaPatches.push(patch);
          }
        }
      }
      
      // 2. Add constraints from analysis (AI-generated specific fixes)
      if (analysis?.constraints_to_add) {
        for (const constraint of analysis.constraints_to_add.slice(0, 3)) {
          // Only add if it's concise and actionable
          if (constraint.length < 150 && !deltaPatches.some(p => p.includes(constraint))) {
            deltaPatches.push(constraint);
          }
        }
      }
      
      // 3. Fallback: Use single category if no analysis
      if (deltaPatches.length === 0 && rejection_category) {
        const categoryPatch = CATEGORY_BOUNDED_PATCHES[rejection_category];
        if (categoryPatch) {
          deltaPatches.push(categoryPatch);
        }
      }
      
      if (deltaPatches.length === 0) {
        // No valid patches - return previous prompt unchanged
        console.log("[optimize-pipeline-prompt] No valid patches - returning base prompt");
        return new Response(JSON.stringify({ 
          optimized_prompt: previous_prompt || suggestion_prompt || "",
          step_number,
          mode,
          note: "No bounded patches applied - analysis empty"
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // Build the improved prompt using AI with user feedback integration
      const userFeedbackNote = feedbackSignal?.user_score !== undefined
        ? `\nUSER FEEDBACK SIGNAL:
- User rated the rejected output ${feedbackSignal.user_score}/100
- ${feedbackSignal.user_score >= 70 
    ? "User thought output was GOOD despite rejection - QA may be too strict. Relax constraints slightly."
    : feedbackSignal.user_score < 40 
      ? "User agreed output was POOR - QA rejection confirmed. Apply stricter constraints."
      : "User rated output as FAIR - balanced improvements needed."}
${feedbackSignal.user_comment ? `- User comment: "${feedbackSignal.user_comment}"` : ""}`
        : "";

      // NEW: Build historical user patterns section from human feedback memory
      let userHistoricalPatternsSection = "";
      if (effectiveHumanFeedbackMemory && effectiveHumanFeedbackMemory.learned_preferences_summary.length > 0) {
        userHistoricalPatternsSection = `\n
═══════════════════════════════════════════════════════════════════
USER HISTORICAL PATTERNS (learned from past feedback)
═══════════════════════════════════════════════════════════════════
${effectiveHumanFeedbackMemory.learned_preferences_summary.map((p, i) => `${i + 1}. ${p}`).join("\n")}

USER STRICTNESS LEVEL: ${effectiveHumanFeedbackMemory.calibration_hints.user_strictness.toUpperCase()}
${effectiveHumanFeedbackMemory.calibration_hints.user_strictness === "strict" 
  ? "→ User is strict - apply tighter constraints and be more conservative"
  : effectiveHumanFeedbackMemory.calibration_hints.user_strictness === "lenient"
    ? "→ User is lenient - only fix clear issues, don't over-constrain"
    : "→ User is balanced - apply standard improvements"}
═══════════════════════════════════════════════════════════════════`;
      }

      systemPrompt = `You are an AI prompt engineer specializing in image generation.
The previous prompt resulted in a rejected output. You must create an IMPROVED prompt.

STEP ${step_number} RULES:
${stepRules}

ROOT CAUSE OF REJECTION:
${analysis?.root_cause_summary || "See delta constraints below"}

DELTA CONSTRAINTS TO ADD:
${deltaPatches.map((p, i) => `${i + 1}. ${p}`).join("\n")}

${analysis?.constraints_to_remove?.length ? `
CONSTRAINTS TO REMOVE/AVOID:
${analysis.constraints_to_remove.map((c, i) => `${i + 1}. ${c}`).join("\n")}
` : ""}
${userFeedbackNote}
${userHistoricalPatternsSection}

CRITICAL RULES:
1. Keep the original prompt's intent and style
2. ADD the delta constraints naturally into the prompt
3. Keep it concise - do NOT bloat the prompt
4. The new prompt must be DIFFERENT from the previous one
5. Focus on fixing the SPECIFIC issue, not general improvements
${feedbackSignal?.user_score && feedbackSignal.user_score >= 70 
  ? "6. User liked the output - preserve core visual approach, only fix the specific rejection reason"
  : ""}
${effectiveHumanFeedbackMemory?.calibration_hints.user_strictness === "strict"
  ? "7. User is historically strict - ensure constraints are strongly applied"
  : ""}`;

      userPrompt = `Previous prompt:
"${previous_prompt}"

Apply the delta constraints and return the improved prompt text only.`;

    } else {
      // ═══════════════════════════════════════════════════════════════════
      // STANDARD MODE: Merge suggestion + user additions
      // ═══════════════════════════════════════════════════════════════════
      systemPrompt = `You are an AI prompt engineer for architectural visualization.
Your task is to merge a suggestion prompt with user additions into one optimized final prompt.

STRICT RULES FOR STEP ${step_number}:
${stepRules}

Guidelines for merging:
1. Preserve the core intent of the suggestion
2. Integrate user additions naturally
3. Ensure the final prompt is clear and specific
4. Remove any redundancy
5. Block any instructions that violate the step rules
6. Output should be a single, cohesive prompt ready for AI image generation`;

      userPrompt = `Suggestion prompt:
"${suggestion_prompt || ""}"

User additions:
"${user_additions || ""}"

Merge these into one optimized prompt for Step ${step_number}. Return ONLY the final merged prompt text, nothing else.`;
    }

    console.log("[optimize-pipeline-prompt] Calling Gemini API for prompt optimization...");
    console.log("[optimize-pipeline-prompt] Mode:", mode, "Category:", rejection_category || "N/A");

    if (!API_NANOBANANA) {
      throw new Error("API_NANOBANANA secret not configured");
    }

    const geminiUrl = `${GEMINI_API_BASE}/${ORCHESTRATION_MODEL}:generateContent?key=${API_NANOBANANA}`;

    const response = await fetch(geminiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: systemPrompt + "\n\n" + userPrompt }
          ]
        }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 1000,
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Gemini API error:", errorText);
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const result = await response.json();
    const optimizedPrompt = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (!optimizedPrompt) {
      throw new Error("Failed to generate optimized prompt");
    }

    console.log("[optimize-pipeline-prompt] Prompt optimized successfully");

    return new Response(JSON.stringify({ 
      optimized_prompt: optimizedPrompt,
      step_number,
      mode,
      category_applied: rejection_category || null
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error("Optimize pipeline prompt error:", error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : "Unknown error" 
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
