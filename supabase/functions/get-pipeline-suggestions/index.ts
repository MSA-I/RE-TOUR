import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Gemini API configuration - uses API_NANOBANANA
const API_NANOBANANA = Deno.env.get("API_NANOBANANA");
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const ORCHESTRATION_MODEL = "gemini-3-flash-preview";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Category definitions for each step
const STEP_CATEGORIES = {
  1: ["realistic", "photorealistic", "architectural", "professional"],
  2: ["style", "aesthetic", "ambiance", "mood"],
  3: ["camera", "angle", "framing", "perspective", "composition"],
  4: ["panorama", "area"]
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    // Get user from auth header
    const supabaseUser = createClient(
      SUPABASE_URL,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      throw new Error("Unauthorized");
    }

    const { step_number, category, generate_more } = await req.json();

    console.log(`Getting pipeline suggestions: step=${step_number}, category=${category}, generate=${generate_more}`);

    // If generating more, use AI to create new suggestions
    if (generate_more && step_number) {
      const newSuggestions = await generateSuggestions(supabaseAdmin, step_number, category);
      
      // Fetch all suggestions after generating
      const { data: allSuggestions, error: fetchError } = await supabaseAdmin
        .from("pipeline_suggestions")
        .select("*")
        .eq("step_number", step_number)
        .order("created_at", { ascending: false });

      if (fetchError) throw fetchError;

      const categories = [...new Set(allSuggestions?.map(s => s.category) || [])];

      return new Response(JSON.stringify({ 
        suggestions: allSuggestions || [],
        categories,
        generated_count: newSuggestions.length
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Fetch suggestions
    let query = supabaseAdmin
      .from("pipeline_suggestions")
      .select("*");

    if (step_number) {
      query = query.eq("step_number", step_number);
    }

    if (category) {
      query = query.eq("category", category);
    }

    const { data: suggestions, error } = await query.order("created_at", { ascending: false });

    if (error) throw error;

    const categories = [...new Set(suggestions?.map(s => s.category) || [])];

    return new Response(JSON.stringify({ 
      suggestions: suggestions || [],
      categories 
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error("Get pipeline suggestions error:", error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : "Unknown error" 
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});

async function generateSuggestions(supabase: any, stepNumber: number, category?: string): Promise<any[]> {
  const stepDescriptions: Record<number, string> = {
    1: `Step 1 produces a PHOTOREALISTIC 2D floor plan visualization. Generate suggestions ONLY for REALISTIC styles.

CRITICAL: Only generate suggestions that result in photorealistic, real-world visual outcomes:
- Professional architectural rendering (realistic materials, proper shadows)
- Photorealistic top-down visualization (accurate textures, real lighting)
- High-end real estate presentation (warm natural tones, realistic finishes)

ABSOLUTELY DO NOT suggest:
- Artistic, watercolor, or sketch styles
- Abstract or stylized visuals
- Anime, cartoon, or illustration styles`,
    2: `Step 2 is DESIGN STYLE CHANGE only. Generate suggestions for INTERIOR DESIGN STYLES ONLY.

ALLOWED - Interior/Architectural Design Styles:
- Scandinavian, Nordic, Japandi
- Minimalist, Modern Minimal, Contemporary  
- Industrial, Urban Loft, Warehouse Chic
- Mid-Century Modern, Retro Modern

STRICTLY FORBIDDEN - Do NOT generate suggestions about:
- Lighting, camera angles, materials specifications`,
    3: `Step 3 generates an EYE-LEVEL Camera-Angle Render.

EACH SUGGESTION MUST INCLUDE:
1. A clear CAMERA POSITION (where the camera stands)
2. A clear FORWARD DIRECTION (what the camera faces)`,
    4: `Step 4 creates a 360° equirectangular panorama for VR viewing.

Generate suggestions using this EXACT format:
- "360° – Kitchen Area" - Panorama centered in the kitchen space
- "360° – Living Room" - Panorama from the main living area`
  };

  const stepContext = stepDescriptions[stepNumber] || "Architectural visualization pipeline step.";
  const categoryContext = category ? `Focus specifically on the "${category}" category.` : "Generate suggestions across all relevant categories.";

  const prompt = `Generate 5 unique prompt suggestions for an architectural visualization AI pipeline.

Context: ${stepContext}
${categoryContext}

Categories for Step ${stepNumber}: ${(STEP_CATEGORIES[stepNumber as keyof typeof STEP_CATEGORIES] || []).join(", ")}

Return a JSON array with exactly 5 objects, each having:
- category: one of the categories listed above
- title: short descriptive title (3-5 words)
- prompt: detailed instruction for the AI (1-2 sentences)

Return ONLY the JSON array, no other text.`;

  if (!API_NANOBANANA) {
    console.error("API_NANOBANANA not configured");
    return [];
  }

  try {
    const geminiUrl = `${GEMINI_API_BASE}/${ORCHESTRATION_MODEL}:generateContent?key=${API_NANOBANANA}`;

    const response = await fetch(geminiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: prompt }]
        }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1500,
        }
      })
    });

    if (!response.ok) {
      console.error("Gemini API error:", await response.text());
      return [];
    }

    const result = await response.json();
    const content = result.candidates?.[0]?.content?.parts?.[0]?.text || "";

    // Parse JSON from response
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.error("Could not parse suggestions JSON");
      return [];
    }

    const suggestions = JSON.parse(jsonMatch[0]);

    // Insert generated suggestions
    const toInsert = suggestions.map((s: any) => ({
      step_number: stepNumber,
      category: s.category,
      title: s.title,
      prompt: s.prompt,
      is_generated: true
    }));

    const { error: insertError } = await supabase
      .from("pipeline_suggestions")
      .insert(toInsert);

    if (insertError) {
      console.error("Failed to insert suggestions:", insertError);
      return [];
    }

    return toInsert;
  } catch (error) {
    console.error("Failed to generate suggestions:", error);
    return [];
  }
}
