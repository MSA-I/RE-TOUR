/**
 * Centralized Template Loader for System Prompt Templates
 * 
 * Provides utilities for loading, caching, and instantiating 
 * database-stored prompt templates (e.g., opposite-view template for Camera B).
 */

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getOrchestrationUrl } from "./ai-models.ts";

// ═══════════════════════════════════════════════════════════════════════════════
// DEFAULT OPPOSITE VIEW TEMPLATE (Fallback until AI generates one)
// ═══════════════════════════════════════════════════════════════════════════════
export const DEFAULT_OPPOSITE_VIEW_TEMPLATE = `Generate the OPPOSITE-FACING VIEW from the EXACT SAME camera position as Camera A.

═══════════════════════════════════════════════════════════════
ANCHORING CONTEXT
═══════════════════════════════════════════════════════════════
Camera Position: {{camera_position}}
Camera B Yaw: {{yaw_opposite}} (Camera A was facing the opposite direction)
Space Name: {{space_name}}
Space Type: {{space_type}}

MANDATORY ANCHOR:
{{image_A}}

FLOOR PLAN REFERENCE:
{{floor_plan}}

═══════════════════════════════════════════════════════════════
HARD CONSTRAINTS
═══════════════════════════════════════════════════════════════
1. SAME PHYSICAL POSITION: Camera B is at the exact same (x, y) coordinates as Camera A
2. OPPOSITE DIRECTION: Turn exactly 180° from Camera A's viewing direction
3. SAME SPACE: You are showing the OTHER SIDE of the same room - NOT a different room
4. STYLE CONTINUITY: Match all materials, lighting, colors, and furniture style from Camera A
5. NO SPACE JUMPING: Do NOT generate a different room, hallway, or adjacent space
6. NO HALLUCINATED GEOMETRY: Only render architectural features that exist on the floor plan
7. CONSISTENT FURNITURE: Any furniture partially visible in Camera A should appear correctly from the opposite angle

{{constraints}}

═══════════════════════════════════════════════════════════════
VERIFICATION CHECKLIST
═══════════════════════════════════════════════════════════════
Before finalizing, verify:
☑ This shows the OPPOSITE wall/direction from Camera A
☑ The room type matches Camera A (bedroom → bedroom, not bedroom → bathroom)
☑ Visible doorways/windows align with the floor plan
☑ Lighting direction is consistent with Camera A
☑ Material finishes match Camera A exactly

═══════════════════════════════════════════════════════════════
OUTPUT
═══════════════════════════════════════════════════════════════
Generate the opposite-facing view that completes the 360° coverage of this exact space.
This image will be merged with Camera A to create a seamless panorama.`;

// Template generation prompt for AI
const TEMPLATE_GENERATION_PROMPT = `Create a reusable prompt template for generating the opposite-facing view (Camera B) of an architectural interior render, anchored to an existing Camera A image.

TEMPLATE REQUIREMENTS:
- Must include these exact placeholders: {{camera_position}}, {{yaw_opposite}}, {{floor_plan}}, {{image_A}}, {{constraints}}, {{space_name}}, {{space_type}}
- Must explicitly state: same physical position, opposite viewing direction (180°)
- Must require visual and style continuity with Camera A output
- Must forbid space jumping or hallucinated geometry
- Must preserve style, lighting, and materials from Camera A
- Must include a verification checklist for the model to self-check
- Should be structured with clear sections for context, constraints, and output requirements

OUTPUT FORMAT: Return ONLY the template text with placeholders. No explanations, no markdown formatting around the template.`;

// In-memory cache to avoid repeated DB lookups within same request
const templateCache: Map<string, { content: string; timestamp: number }> = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface SystemPromptTemplate {
  id: string;
  template_type: string;
  template_version: number;
  template_content: string;
  placeholders: string[];
  description: string | null;
  generated_by_ai: boolean;
  ai_generation_prompt: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface OppositeViewTemplateParams {
  camera_position: string;
  yaw_opposite: string;
  floor_plan: string;
  image_A: string;
  constraints: string;
  space_name: string;
  space_type: string;
}

/**
 * Load the opposite-view template from database.
 * Falls back to default if not found or not yet generated.
 */
export async function getOppositeViewTemplate(
  serviceClient: SupabaseClient
): Promise<string> {
  // Check in-memory cache first
  const cached = templateCache.get("opposite_view_template");
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    console.log("[template-loader] Using cached opposite-view template");
    return cached.content;
  }

  try {
    const { data: template, error } = await serviceClient
      .from("system_prompt_templates")
      .select("*")
      .eq("template_type", "opposite_view_template")
      .eq("is_active", true)
      .single();

    if (error || !template) {
      console.log("[template-loader] No active template found, using default");
      return DEFAULT_OPPOSITE_VIEW_TEMPLATE;
    }

    // Check if template is pending AI generation
    if (template.template_content === "PENDING_AI_GENERATION") {
      console.log("[template-loader] Template pending generation, triggering AI generation...");
      const generatedContent = await generateOppositeViewTemplateViaAI(serviceClient);
      
      // Cache the generated content
      templateCache.set("opposite_view_template", {
        content: generatedContent,
        timestamp: Date.now(),
      });
      
      return generatedContent;
    }

    // Cache valid template
    templateCache.set("opposite_view_template", {
      content: template.template_content,
      timestamp: Date.now(),
    });

    console.log(`[template-loader] Loaded template v${template.template_version} from database`);
    return template.template_content;
  } catch (err) {
    console.error("[template-loader] Error loading template:", err);
    return DEFAULT_OPPOSITE_VIEW_TEMPLATE;
  }
}

/**
 * Generate the opposite-view template using AI (one-time operation)
 */
async function generateOppositeViewTemplateViaAI(
  serviceClient: SupabaseClient
): Promise<string> {
  const apiKey = Deno.env.get("API_NANOBANANA");
  if (!apiKey) {
    console.error("[template-loader] No API_NANOBANANA key, using default template");
    return DEFAULT_OPPOSITE_VIEW_TEMPLATE;
  }

  try {
    console.log("[template-loader] Generating opposite-view template via AI...");

    const url = getOrchestrationUrl(apiKey);
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: TEMPLATE_GENERATION_PROMPT }],
          },
        ],
        generationConfig: {
          temperature: 0.3, // Low temperature for consistent output
          maxOutputTokens: 2000,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[template-loader] AI generation failed:", response.status, errorText);
      return DEFAULT_OPPOSITE_VIEW_TEMPLATE;
    }

    const result = await response.json();
    const generatedText = result.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!generatedText || generatedText.length < 100) {
      console.error("[template-loader] AI returned empty or too short template");
      return DEFAULT_OPPOSITE_VIEW_TEMPLATE;
    }

    // Validate that required placeholders are present
    const requiredPlaceholders = [
      "{{camera_position}}",
      "{{yaw_opposite}}",
      "{{floor_plan}}",
      "{{image_A}}",
      "{{constraints}}",
      "{{space_name}}",
      "{{space_type}}",
    ];

    const missingPlaceholders = requiredPlaceholders.filter(
      (p) => !generatedText.includes(p)
    );

    if (missingPlaceholders.length > 0) {
      console.error(
        "[template-loader] AI template missing placeholders:",
        missingPlaceholders
      );
      return DEFAULT_OPPOSITE_VIEW_TEMPLATE;
    }

    // Store the generated template in database
    const { error: insertError } = await serviceClient
      .from("system_prompt_templates")
      .insert({
        template_type: "opposite_view_template",
        template_version: 1,
        template_content: generatedText,
        placeholders: requiredPlaceholders,
        description: "AI-generated template for Camera B (opposite-facing view) renders",
        generated_by_ai: true,
        ai_generation_prompt: TEMPLATE_GENERATION_PROMPT,
        is_active: true,
      });

    if (insertError) {
      // Try update instead (in case placeholder record exists)
      const { error: updateError } = await serviceClient
        .from("system_prompt_templates")
        .update({
          template_content: generatedText,
          generated_by_ai: true,
          ai_generation_prompt: TEMPLATE_GENERATION_PROMPT,
          is_active: true,
          updated_at: new Date().toISOString(),
        })
        .eq("template_type", "opposite_view_template");

      if (updateError) {
        console.error("[template-loader] Failed to store template:", updateError);
      } else {
        console.log("[template-loader] ✓ AI-generated template stored (updated existing)");
      }
    } else {
      console.log("[template-loader] ✓ AI-generated template stored in database");
    }

    return generatedText;
  } catch (err) {
    console.error("[template-loader] AI generation error:", err);
    return DEFAULT_OPPOSITE_VIEW_TEMPLATE;
  }
}

/**
 * Instantiate the opposite-view template with runtime parameters
 */
export function instantiateOppositeViewTemplate(
  template: string,
  params: OppositeViewTemplateParams
): string {
  let result = template;
  
  // Replace all placeholders with actual values
  result = result.replaceAll("{{camera_position}}", params.camera_position);
  result = result.replaceAll("{{yaw_opposite}}", params.yaw_opposite);
  result = result.replaceAll("{{floor_plan}}", params.floor_plan);
  result = result.replaceAll("{{image_A}}", params.image_A);
  result = result.replaceAll("{{constraints}}", params.constraints);
  result = result.replaceAll("{{space_name}}", params.space_name);
  result = result.replaceAll("{{space_type}}", params.space_type);
  
  return result;
}

/**
 * Load any system template by type
 */
export async function loadSystemTemplate(
  serviceClient: SupabaseClient,
  templateType: string
): Promise<SystemPromptTemplate | null> {
  const { data, error } = await serviceClient
    .from("system_prompt_templates")
    .select("*")
    .eq("template_type", templateType)
    .eq("is_active", true)
    .single();

  if (error || !data) {
    console.log(`[template-loader] No active template found for type: ${templateType}`);
    return null;
  }

  return data as SystemPromptTemplate;
}

/**
 * Clear the in-memory cache (useful after template updates)
 */
export function clearTemplateCache(): void {
  templateCache.clear();
  console.log("[template-loader] Template cache cleared");
}
