import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const API_OPENAI = Deno.env.get("API_OPENAI");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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
      rejection_reason,
      previous_prompt
    } = await req.json();

    if (!step_number) {
      throw new Error("step_number is required");
    }

    const stepRules = STEP_RULES[step_number];
    if (!stepRules) {
      throw new Error(`Invalid step number: ${step_number}`);
    }

    let systemPrompt = "";
    let userPrompt = "";

    if (mode === "improve_after_rejection") {
      // Generate improved prompt after rejection
      systemPrompt = `You are an AI prompt engineer specializing in image generation.
The previous prompt was rejected for the following reason: "${rejection_reason}"

Your task is to improve the prompt to address this issue while following these rules:

${stepRules}

Generate an improved prompt that:
1. Addresses the rejection reason directly
2. Maintains the original intent
3. Adds more specific guidance to prevent the issue
4. Follows all step rules strictly`;

      userPrompt = `Previous prompt that was rejected:
"${previous_prompt}"

Rejection reason: "${rejection_reason}"

Generate an improved prompt that addresses this issue. Return ONLY the improved prompt text, nothing else.`;

    } else {
      // Merge and optimize suggestion + user additions
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

    console.log("Calling AI for prompt optimization...");

    if (!API_OPENAI) {
      throw new Error("API_OPENAI secret not configured");
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
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
        ]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI API error:", errorText);
      throw new Error(`AI API error: ${response.status}`);
    }

    const result = await response.json();
    const optimizedPrompt = result.choices?.[0]?.message?.content?.trim();

    if (!optimizedPrompt) {
      throw new Error("Failed to generate optimized prompt");
    }

    console.log("Prompt optimized successfully");

    return new Response(JSON.stringify({ 
      optimized_prompt: optimizedPrompt,
      step_number,
      mode
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
