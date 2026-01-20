import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const API_OPENAI = Deno.env.get("API_OPENAI");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Available templates for each step
const TEMPLATES: Record<number, { name: string; content: string }[]> = {
  1: [
    {
      name: "2D Floor Plan → Top-Down 3D Render",
      content: `Convert the uploaded 2D floor plan into a clean, top-down 3D render.

STRICT REQUIREMENTS:
- KEEP THE LAYOUT EXACT.
- Do NOT change wall positions, room sizes, proportions, or orientation.
- Doors and openings must remain in the same locations as in the plan.
- No creative reinterpretation of geometry.

RENDER STYLE:
- Top-down 3D perspective (architectural axonometric feel).
- Simple, realistic furniture matching each room's function.
- Neutral modern materials.
- Soft, even daylight.
- Clean background, no clutter.

GOAL:
A clear and accurate 3D visualization that faithfully represents the original 2D floor plan.`
    }
  ],
  2: [
    {
      name: "2D Floor Plan → Eye-Level Interior Render (Standard)",
      content: `Generate a photorealistic interior render based strictly on the uploaded floor plan visualization.

GEOMETRY & LAYOUT (CRITICAL):
- Use the floor plan as the single source of truth.
- Keep all walls, openings, doors, furniture placement, and room proportions EXACTLY as shown.
- Do NOT move, resize, rotate, or reinterpret any architectural or furniture elements.
- Translate the plan into a realistic 3D space without altering the layout.

CAMERA:
- Eye-level interior camera.
- Camera height: approximately 150–160 cm (human eye level).
- Natural perspective, realistic focal length (approx. 35–45mm).
- No wide-angle distortion, no fisheye.

SCENE & VIEW:
- Clear visual connection between rooms.
- Realistic lighting from windows.
- Modern, clean interior styling.`
    },
    {
      name: "2D Floor Plan → Eye-Level Interior Render (Detailed)",
      content: `Generate a photorealistic interior render based strictly on the uploaded floor plan visualization.

GEOMETRY & LAYOUT (CRITICAL):
- Use the floor plan as the single source of truth.
- Keep all walls, openings, doors, furniture placement, and room proportions EXACTLY as shown.
- Do NOT move, resize, rotate, or reinterpret any architectural or furniture elements.

CAMERA:
- Eye-level interior camera.
- Camera position: standing at the kitchen island countertop, slightly behind the island.
- Camera height: approximately 150–160 cm (human eye level).
- Camera is looking straight toward the living room seating area.
- Natural perspective, realistic focal length (approx. 35–45mm).
- No wide-angle distortion, no fisheye.

SCENE & VIEW:
- Foreground: kitchen island countertop edge visible at the bottom of the frame.
- Midground: dining table and chairs exactly as placed in the plan.
- Background: living room with sofa, armchairs, and coffee table as shown.
- Clear visual connection between kitchen, dining, and living areas.

MATERIALS & LIGHTING:
- Natural daylight from windows
- Warm interior tones
- High-quality materials with realistic textures`
    }
  ],
  3: [
    {
      name: "Camera-Angle Interior Render",
      content: `Generate a photorealistic interior render from a specific camera angle based on the provided image.

CAMERA SPECIFICATIONS:
- Camera angle: [CAMERA_ANGLE] (e.g., eye-level, low-angle, high-angle, corner view)
- Camera position: [CAMERA_POSITION] (e.g., center of room, entrance view, corner)
- Framing: [FRAMING] (e.g., wide shot, medium shot, detail focus)
- Perspective: Natural perspective with realistic focal length (35-50mm equivalent)

GEOMETRY & LAYOUT (CRITICAL):
- Use the source image as the single source of truth
- Preserve all walls, openings, doors, furniture placement, and room proportions EXACTLY
- Do NOT move, resize, rotate, or reinterpret any architectural or furniture elements

RENDERING REQUIREMENTS:
- Photorealistic quality
- Natural lighting from windows with accurate shadows
- High-quality materials with realistic textures
- Clean, professional architectural visualization

OUTPUT:
A photorealistic interior render from the specified camera angle that faithfully represents the source image.`
    }
  ],
  4: [
    {
      name: "360° Equirectangular Panorama",
      content: `Using the provided image as the ONLY reference, generate a photorealistic 360° equirectangular interior panorama.

Camera:
- Height: standing eye level (~1.6m)
- Position: [CAMERA_POSITION]

Primary forward direction (0° yaw):
- Facing [FORWARD_DIRECTION]

Preserve exactly (no redesign, no replacements):
- All furniture visible in the reference image
- All fixed elements (windows, doors, columns)
- Floor material and direction
- Wall curvature, room proportions, ceiling height

Do NOT add, remove, or reinterpret any elements.

Lighting:
- Natural daylight from windows
- Physically correct light direction and realistic falloff
- No dramatic or artificial lighting

Panorama requirements:
- True 360° equirectangular panorama (2:1)
- No fisheye circle
- No warped geometry
- Straight verticals and correct perspective
- Suitable for virtual tour viewers

Style:
- Photorealistic interior
- Real-world scale and materials
- Neutral camera, human-eye perspective`
    }
  ]
};

// Step-specific rules
const STEP_RULES: Record<number, string> = {
  1: `STEP 1 RULES - Photorealistic Top-Down 3D Render:
- Transform 2D floor plan into a PHOTOREALISTIC top-down 3D visualization
- Use only REALISTIC materials, textures, and lighting
- NO artistic styles, watercolor, sketch, blueprint aesthetics
- Real-world materials: wood, tile, marble, carpet with accurate textures
- Natural lighting simulation with proper shadows
- PRESERVE exact geometry, walls, room sizes, and proportions
- Output must be photorealistic, suitable for real estate or architectural presentation`,

  2: `STEP 2 RULES - Eye-Level Interior Render:
- Transform the plan into a photorealistic interior view
- Apply materials, lighting, furniture styles as specified
- Camera should be at eye-level looking into the space
- Preserve room layout and proportions from the plan
- Focus on interior design aesthetics and atmosphere`,

  3: `STEP 3 RULES - Camera-Angle Render:
- Generate a photorealistic render from a specific camera angle
- Focus on camera position, angle, framing, and perspective
- Preserve all elements from the source image exactly
- Apply only camera-related adjustments, no redesign of space
- Suitable for showcasing specific views of the interior`,

  4: `STEP 4 RULES - 360° Equirectangular Panorama:
- Generate a true 2:1 equirectangular panorama
- No fisheye circles or warped geometry
- Straight verticals, correct VR-ready perspective
- Preserve all elements from the source image
- Suitable for virtual tour viewers`
};

// Helper function to fetch with timeout
async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('AI request timed out after 25 seconds');
    }
    throw error;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ 
        ok: false, 
        error_code: "AUTH_MISSING",
        error_message: "Missing authorization header" 
      }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Verify user auth
    const supabaseUser = createClient(
      SUPABASE_URL,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ 
        ok: false, 
        error_code: "UNAUTHORIZED",
        error_message: "Unauthorized" 
      }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const { 
      step_number, 
      selected_suggestions,
      user_prompt_text
    } = await req.json();

    if (!step_number) {
      return new Response(JSON.stringify({ 
        ok: false, 
        error_code: "MISSING_STEP",
        error_message: "step_number is required" 
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const stepTemplates = TEMPLATES[step_number];
    if (!stepTemplates || stepTemplates.length === 0) {
      return new Response(JSON.stringify({ 
        ok: false, 
        error_code: "NO_TEMPLATES",
        error_message: `No templates available for step ${step_number}` 
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const stepRules = STEP_RULES[step_number];
    if (!stepRules) {
      return new Response(JSON.stringify({ 
        ok: false, 
        error_code: "INVALID_STEP",
        error_message: `Invalid step number: ${step_number}` 
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Build list of selected suggestions
    const suggestionsText = selected_suggestions && selected_suggestions.length > 0
      ? selected_suggestions.map((s: { title: string; prompt: string }) => `- ${s.title}: ${s.prompt}`).join("\n")
      : "No specific suggestions selected.";

    // Build list of available templates
    const templatesText = stepTemplates
      .map((t, i) => `[${i + 1}] ${t.name}:\n${t.content}`)
      .join("\n\n---\n\n");

    const systemPrompt = `You are an AI prompt engineer specializing in architectural visualization prompts for floor plan pipelines.

Your task is to compose ONE final optimized prompt by:
1. Analyzing the user's requirements and selected suggestions
2. Choosing the BEST template from the available options for Step ${step_number}
3. Merging the template structure with the suggestions and user requirements
4. Ensuring the final prompt strictly follows the step rules

${stepRules}

COMPOSITION RULES:
- The final prompt MUST follow the chosen template's structure
- Integrate selected suggestions naturally into the prompt
- Incorporate user's custom text requirements
- Remove any contradictions between suggestions
- Block any content that violates the step rules (e.g., interior styling in Step 1)
- Make the prompt clear, specific, and actionable

OUTPUT FORMAT:
You MUST respond with valid JSON only:
{
  "chosen_template_name": "Name of the template you chose",
  "composed_prompt": "The full composed prompt ready for AI image generation",
  "short_merge_summary": "Brief 1-2 sentence explanation of how you merged the inputs"
}`;

    const userPrompt = `AVAILABLE TEMPLATES FOR STEP ${step_number}:
${templatesText}

SELECTED SUGGESTIONS:
${suggestionsText}

USER'S CUSTOM REQUIREMENTS:
${user_prompt_text || "No custom requirements provided."}

Analyze these inputs and compose the final optimized prompt. Choose the best template and merge all inputs into a cohesive prompt that follows the template structure.`;

    console.log(`Composing prompt for step ${step_number}...`);

    if (!API_OPENAI) {
      return new Response(JSON.stringify({ 
        ok: false,
        error_code: "CONFIG_ERROR",
        error_message: "API_OPENAI secret not configured" 
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Use timeout of 25 seconds for AI call
    const response = await fetchWithTimeout(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${API_OPENAI}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ],
          max_completion_tokens: 2000
        })
      },
      25000 // 25 second timeout
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI API error:", errorText);
      
      if (response.status === 429) {
        return new Response(JSON.stringify({ 
          ok: false,
          error_code: "RATE_LIMIT",
          error_message: "Rate limits exceeded, please try again later." 
        }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ 
          ok: false,
          error_code: "PAYMENT_REQUIRED",
          error_message: "Payment required, please add funds." 
        }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      
      return new Response(JSON.stringify({ 
        ok: false,
        error_code: "AI_ERROR",
        error_message: `AI API error: ${response.status}` 
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content?.trim();

    if (!content) {
      return new Response(JSON.stringify({ 
        ok: false,
        error_code: "EMPTY_RESPONSE",
        error_message: "Failed to generate composed prompt - empty response" 
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Parse JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("Failed to parse AI response:", content);
      return new Response(JSON.stringify({ 
        ok: false,
        error_code: "PARSE_ERROR",
        error_message: "Failed to parse AI response as JSON" 
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error("JSON parse error:", parseError);
      return new Response(JSON.stringify({ 
        ok: false,
        error_code: "JSON_PARSE_ERROR",
        error_message: "Failed to parse AI response JSON" 
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    console.log(`Prompt composed successfully using template: ${parsed.chosen_template_name}`);

    return new Response(JSON.stringify({ 
      ok: true,
      chosen_template_name: parsed.chosen_template_name,
      composed_prompt: parsed.composed_prompt,
      short_merge_summary: parsed.short_merge_summary,
      step_number
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error("Compose pipeline prompt error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    const isTimeout = errorMessage.includes('timed out');
    
    return new Response(JSON.stringify({ 
      ok: false,
      error_code: isTimeout ? "TIMEOUT" : "UNKNOWN_ERROR",
      error_message: errorMessage
    }), {
      status: isTimeout ? 504 : 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
