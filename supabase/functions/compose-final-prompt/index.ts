import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Full Nano Banana templates for architectural visualization
const PROMPT_TEMPLATES = [
  {
    id: "style_transfer",
    name: "Style Transfer",
    category: "style",
    keywords: ["style", "transfer", "artistic", "reference"],
    template: `Transform the provided photograph into the artistic style from the reference. Preserve the original composition and architectural integrity while rendering it with the stylistic elements from the reference.`
  },
  {
    id: "photobashing",
    name: "Photobashing / Style Transfer",
    category: "style",
    keywords: ["photobash", "lighting", "mood", "atmosphere"],
    template: `Generate a high-end architectural visualization that strictly uses the geometry, perspective, and composition from the base image but applies the lighting, color palette, and material mood from the reference. It is critical that you do not alter the building shape or architectural details at all. Simply wrap the photorealistic style and lighting atmosphere onto the existing structure.`
  },
  {
    id: "apply_material",
    name: "Apply Material",
    category: "materials",
    keywords: ["material", "texture", "floor", "wall", "ceiling", "tile", "marble", "wood", "concrete", "brick", "stone", "panel", "replace"],
    template: `Replace the specified material/surface with the new material. Ensure the new material looks realistic under the existing lighting and shadows. Everything else in the scene must remain exactly as it is in the original image.`
  },
  {
    id: "furniture_change",
    name: "Furniture Style Change",
    category: "elements",
    keywords: ["furniture", "minimalist", "modern", "classic", "mid-century", "scandinavian", "contemporary", "style"],
    template: `Change the furniture style in the scene to the requested style. Maintain the same room layout and architectural elements. Ensure the new furniture fits naturally with the existing lighting and atmosphere.`
  },
  {
    id: "add_elements",
    name: "Add Elements",
    category: "elements",
    keywords: ["add", "plant", "greenery", "decor", "accessory", "rug", "curtain", "lighting", "fixture"],
    template: `Add the specified elements to the architectural scene. Ensure they are placed naturally and their shadows, lighting, and color temperature blend perfectly with the existing environment. Do not change any other part of the scene.`
  },
  {
    id: "remove_elements",
    name: "Remove Elements",
    category: "elements",
    keywords: ["remove", "delete", "eliminate", "take out"],
    template: `Remove the specified elements from the scene. Fill the empty space naturally with appropriate background that matches the surrounding area. Keep everything else exactly the same.`
  },
  {
    id: "lighting_change",
    name: "Lighting Change",
    category: "lighting",
    keywords: ["lighting", "light", "fixture", "lamp", "chandelier", "pendant", "recessed", "ambient"],
    template: `Change or replace the lighting fixtures as specified. Adjust the light effect naturally to match the new fixtures. Maintain the architectural integrity of the space.`
  }
];

const BEST_PRACTICES = `
## Nano Banana Pro Best Practices for Architectural Visualization

### Be Hyper-Specific
Instead of vague descriptions, be precise: "white Carrara marble with grey veining" not just "marble."

### Maintain Architectural Integrity  
Always preserve: "Keep the architecture exactly as is" - geometry, perspective, and structural details must remain unchanged.

### Blend Elements Naturally
For any changes: "Ensure shadows, lighting, and color temperature blend perfectly with the existing environment."

### Preserve Scene Context
When making targeted changes: "Everything else in the scene must remain exactly as it is in the original image."
`;

function detectTemplate(request: string): typeof PROMPT_TEMPLATES[0] | null {
  const r = request.toLowerCase();
  
  // Score each template based on keyword matches
  let bestMatch: typeof PROMPT_TEMPLATES[0] | null = null;
  let bestScore = 0;
  
  for (const template of PROMPT_TEMPLATES) {
    let score = 0;
    for (const keyword of template.keywords) {
      if (r.includes(keyword)) {
        score++;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = template;
    }
  }
  
  return bestScore > 0 ? bestMatch : null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      console.error("No authorization header provided");
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const openaiApiKey = Deno.env.get("API_OPENAI");

    if (!openaiApiKey) {
      console.error("API_OPENAI secret not configured");
      return new Response(JSON.stringify({ error: "OpenAI API key not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get user from auth header
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    
    if (userError || !user) {
      console.error("Auth error:", userError);
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { change_request, style_prompt, include_style, context } = await req.json();

    if (!change_request || !change_request.trim()) {
      return new Response(JSON.stringify({ error: "Change request is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("Composing final prompt...");
    console.log("Change request:", change_request);
    console.log("Style prompt:", style_prompt);
    console.log("Include style:", include_style);

    // Detect relevant template
    const detectedTemplate = detectTemplate(change_request);
    console.log("Detected template:", detectedTemplate?.name || "None");

    // Build context for AI
    let contextParts = [];
    
    if (include_style && style_prompt) {
      contextParts.push(`STYLE REFERENCE (from design references):\n"${style_prompt}"`);
    }
    
    if (detectedTemplate) {
      contextParts.push(`SUGGESTED TEMPLATE (${detectedTemplate.name}):\n${detectedTemplate.template}`);
    }
    
    contextParts.push(`USER'S CHANGE REQUEST:\n${change_request}`);
    contextParts.push(`BEST PRACTICES:\n${BEST_PRACTICES}`);

    // Use OpenAI to compose the final prompt - MINIMAL AI creativity, just merge inputs
    let systemPrompt = `You are a prompt merger for Nano Banana Pro (architectural visualization AI).

Your ONLY job is to combine the provided inputs into a single coherent prompt. DO NOT invent, add, or create new content.

STRICT RULES:
1. Use the EXACT template structure provided - do not modify it significantly
2. Insert the user's specific change request into the template naturally
3. If style reference is provided, prepend it as context for atmosphere/mood
4. DO NOT add weather, seasons, time of day, or any details the user did not request
5. DO NOT invent materials, colors, or elements not mentioned
6. Keep the prompt focused ONLY on what the user asked for
7. Always include: "Keep everything else in the scene exactly as it is"
8. Output ONLY the final prompt - no explanations

Example:
If user says "replace floor with marble" and template says "Replace the specified material..."
Output: "Replace the floor with marble tiles. Ensure the new material looks realistic under the existing lighting and shadows. Keep everything else in the scene exactly as it is in the original image."

DO NOT add creative embellishments.`;

    if (context === "multi_image_panorama") {
      systemPrompt = `You are an expert image merger for architectural panoramas.
Your ONLY job is to create a prompt that instructs the AI to merge multiple images into a seamless panorama based strictly on provided spatial evidence.

STRICT RULES:
1. Focus exclusively on MERGING, ALIGNING, and BLENDING the provided images.
2. DO NOT invent new furniture, lighting, or architectural elements not seen in the source images.
3. Emphasize "maintaining consistency" and "geometric coherence" across the stitched area.
4. Use evidence from the images (walls, floors, horizons) to guide the merge accurately.
5. NO HALLUCINATIONS: If a corner is not visible in any source, it must remain neutral or empty. Do not fill gaps with fictional content.
6. IGNORE generic style requests: This operation is about spatial reconstruction, not style transfer or enhancement.

Example Output:
"Merge the provided images into a single seamless equirectangular panorama using only visible evidence. Align horizons perfectly and blend overlapping edges without inventing new details. Ensure material and lighting consistency across the reconstruction."`;
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: contextParts.join("\n\n---\n\n") }
        ],
        max_tokens: 800,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("OpenAI API error:", response.status, errorText);
      return new Response(JSON.stringify({ error: "Failed to generate prompt" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const composedPrompt = data.choices?.[0]?.message?.content?.trim();

    if (!composedPrompt) {
      console.error("No content in OpenAI response");
      return new Response(JSON.stringify({ error: "Failed to generate prompt" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("Composed prompt:", composedPrompt);

    return new Response(JSON.stringify({ 
      composed_prompt: composedPrompt,
      detected_template: detectedTemplate?.name || null
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Error in compose-final-prompt:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
