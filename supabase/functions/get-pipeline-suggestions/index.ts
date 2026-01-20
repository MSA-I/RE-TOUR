import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Category definitions for each step
// Step 1 is ONLY for REALISTIC/PHOTOREALISTIC styles - no artistic/abstract options
// Step 2 is DESIGN STYLE only - STRICTLY interior design styles, NO lighting/camera/materials breakdown
// Step 3 is camera-angle focused ONLY
const STEP_CATEGORIES = {
  1: ["realistic", "photorealistic", "architectural", "professional"],
  2: ["style", "aesthetic", "ambiance", "mood"], // Removed "materials" and "palette" - too technical
  3: ["camera", "angle", "framing", "perspective", "composition"],
  4: ["panorama", "area"] // Human-readable: panorama type + room area
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
  // Step 1 is ONLY for REALISTIC/PHOTOREALISTIC styles - no artistic, abstract, anime, or stylized options
  const stepDescriptions: Record<number, string> = {
    1: `Step 1 produces a PHOTOREALISTIC 2D floor plan visualization. Generate suggestions ONLY for REALISTIC styles.

CRITICAL: Only generate suggestions that result in photorealistic, real-world visual outcomes:
- Professional architectural rendering (realistic materials, proper shadows)
- Photorealistic top-down visualization (accurate textures, real lighting)
- High-end real estate presentation (warm natural tones, realistic finishes)
- Professional CAD with realistic materials (wood, tile, carpet textures)
- Construction-ready documentation style (accurate dimensions, real material callouts)
- Property marketing quality (inviting, realistic natural light simulation)
- Architectural photography style (realistic depth, material accuracy)
- Interior design portfolio quality (true-to-life colors, realistic scale)
- Real materials visualization (marble, hardwood, stone, fabric textures)
- Natural lighting simulation (daylight, window reflections, ambient occlusion)

Each suggestion must describe a REALISTIC visual style with:
- Real-world materials and textures
- Accurate lighting behavior
- Photographic quality output
- Architectural precision

ABSOLUTELY DO NOT suggest:
- Artistic, watercolor, or sketch styles
- Abstract or stylized visuals
- Anime, cartoon, or illustration styles
- Fantasy or surreal aesthetics
- Hand-drawn or pencil effects
- Any non-photorealistic rendering`,
    2: `Step 2 is DESIGN STYLE CHANGE only. Generate suggestions for INTERIOR DESIGN STYLES ONLY.

ALLOWED - Interior/Architectural Design Styles:
- Scandinavian, Nordic, Japandi
- Minimalist, Modern Minimal, Contemporary  
- Industrial, Urban Loft, Warehouse Chic
- Mid-Century Modern, Retro Modern
- Coastal, Mediterranean, Tropical
- Bohemian, Eclectic, Maximalist
- Art Deco, Hollywood Regency
- Traditional, Classic, Transitional
- Farmhouse, Rustic, Country
- Luxe Modern, Hotel Chic, Boutique Style

STRICTLY FORBIDDEN - Do NOT generate suggestions about:
- Lighting (no "warm lighting", "natural light", "dramatic shadows")
- Camera angles or perspectives
- Material specifications or breakdowns (no "marble floors", "wood panels")
- Color palette details (no "earth tones", "neutral colors")
- Rendering quality or resolution
- Layout changes or furniture placement
- Any technical instructions

Each suggestion must be a NAMED DESIGN STYLE with a brief stylistic description.
Example: "Japandi Minimalism" - "Blend of Japanese zen and Scandinavian simplicity with clean lines and natural textures."`,
    3: `Step 3 generates an EYE-LEVEL Camera-Angle Render. 

MANDATORY CONSTRAINTS - STRICT EYE-LEVEL ONLY:
- Camera height: ALWAYS 1.5–1.7m (normal human standing height)
- NO fisheye, NO ultra-wide warping, NO curved perspectives
- NO dutch/tilted angles, NO dramatic low/high angles
- NO bird's eye or top-down views
- STRAIGHT verticals, natural lens distortion only (35-50mm equivalent)

EACH SUGGESTION MUST INCLUDE:
1. A clear CAMERA POSITION (where the camera stands)
   Examples: "near the kitchen counter", "from the living room corner", "at the entrance"
2. A clear FORWARD DIRECTION (what the camera faces)
   Examples: "looking toward the living room", "facing the balcony", "toward the dining area"

SUGGESTION FORMAT:
- Short title: "Eye-level from [POSITION] → [DIRECTION]"
- Brief descriptor explaining the view

EXAMPLE SUGGESTIONS:
- "Eye-level from Kitchen → Living Room" - Standing near kitchen island, facing the sofa and living area
- "Eye-level from Balcony → Interior" - At balcony entrance looking inward toward the full space
- "Eye-level opposite current direction" - 180° turn from current view, same height
- "Eye-level from Sofa corner → Dining" - Corner position near seating, facing dining table

Each regeneration MUST provide DIFFERENT camera placements and directions, not the same ones rephrased.`,
    4: `Step 4 creates a 360° equirectangular panorama for VR viewing.

CRITICAL: Suggestions must be SIMPLE, HUMAN-READABLE room area options. NO technical camera terms.

Generate suggestions using this EXACT format:
- "360° – Kitchen Area" - Panorama centered in the kitchen space
- "360° – Living Room" - Panorama from the main living area
- "360° – Main Space" - Central panorama capturing the open-plan area
- "360° – Dining Area" - Panorama focused on the dining zone
- "360° – Near Windows" - Panorama positioned by the main windows
- "360° – Bedroom" - Panorama from the bedroom center
- "360° – Custom Area" - User-defined panorama location

RULES:
- Titles must start with "360° –" followed by a simple room/area name
- NO technical terms (no "camera position", "yaw", "equirectangular", "VR-ready")
- Descriptions should be 1 short sentence explaining the view intent
- Categories: "panorama" for format, "area" for room-specific

These guide user INTENT, not exact camera math.`
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

${stepNumber === 1 ? "CRITICAL: All suggestions MUST result in PHOTOREALISTIC output. Do NOT suggest artistic, abstract, sketch, watercolor, anime, or any non-realistic styles. Only realistic materials, lighting, and textures." : "Be creative and specific. Focus on practical, actionable suggestions that improve render quality."}

Return ONLY the JSON array, no other text.`;

  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "user", content: prompt }
        ]
      })
    });

    if (!response.ok) {
      console.error("AI API error:", await response.text());
      return [];
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content || "";

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
