import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface SpaceAnalysis {
  space_id: string;
  inferred_usage: string;
  confidence: number;
  detected_items?: Array<{
    item_type: string;
    count: number;
    confidence: number;
  }>;
  dimensions_summary?: string;
}

/**
 * Generate camera intent suggestions using Gemini AI vision
 */
async function generateAISuggestions(
  styledImageUrl: string,
  space: any,
  spaceAnalysis: SpaceAnalysis | null
): Promise<string[]> {
  if (!GEMINI_API_KEY) {
    console.warn("[save-camera-intents] GEMINI_API_KEY not set - using fallback templates");
    return generateFallbackSuggestions(space);
  }

  try {
    // Fetch the image as base64
    const imageResponse = await fetch(styledImageUrl);
    if (!imageResponse.ok) {
      throw new Error(`Failed to fetch image: ${imageResponse.status}`);
    }

    const imageBuffer = await imageResponse.arrayBuffer();
    const base64Image = btoa(String.fromCharCode(...new Uint8Array(imageBuffer)));

    // Build context about the space
    const spaceContext = spaceAnalysis ? `
Space Analysis:
- Detected usage: ${spaceAnalysis.inferred_usage}
- Confidence: ${(spaceAnalysis.confidence * 100).toFixed(0)}%
- Detected items: ${spaceAnalysis.detected_items?.map(i => `${i.count}x ${i.item_type}`).join(", ") || "None"}
- Dimensions: ${spaceAnalysis.dimensions_summary || "Not available"}
` : "No detailed analysis available.";

    const isLarge = ["living_room", "kitchen", "master_bedroom", "dining_room", "open_plan"].includes(space.space_type);

    // Large spaces: 4-8 suggestions, Normal spaces: 2-4 suggestions
    const minSuggestions = isLarge ? 4 : 2;
    const maxSuggestions = isLarge ? 8 : 4;
    const suggestionCount = isLarge ? 6 : 3; // Target count for prompt

    const prompt = `You are an expert real estate photographer analyzing a floor plan to suggest camera viewpoints for interior photos.

**Space:** ${space.name} (${space.space_type})
${spaceContext}

**Task:** Generate ${minSuggestions}-${maxSuggestions} unique, specific camera intent suggestions for THIS SPECIFIC SPACE based on the styled top-down floor plan image you see.

**CRITICAL REQUIREMENT - Comprehensive Spatial Coverage:**
Your suggestions MUST collectively cover the entire space from multiple viewing angles. Think strategically about camera placement to ensure:
- Every wall and corner of the room can be captured
- Different perspectives are provided (entry view, opposite corner, side angles, etc.)
- The full spatial layout is documented through the combination of all suggested viewpoints
- No significant area of the space is left uncaptured when all suggestions are combined

**Requirements:**
1. Analyze the actual layout, furniture placement, and architectural features visible in the image
2. Position camera suggestions at DIFFERENT locations around the perimeter of the space
3. Ensure suggestions provide diverse viewing angles that complement each other
4. Be specific about what the camera should focus on (e.g., "fireplace feature wall", "window with city view")
5. Consider human eye-level photography (not top-down)
6. Each suggestion should be 1-2 sentences describing what to photograph and why

**Format:** Return ${minSuggestions}-${maxSuggestions} suggestions, one per line, starting with a dash. No numbering, no extra text.

Example format for comprehensive coverage:
- Wide shot from entry doorway capturing the entire room flow and natural light from the bay windows
- Opposite corner angle showcasing the full length of the space and furniture arrangement
- Side angle from left wall highlighting the dining area connection and architectural details
- Side angle from right wall capturing the kitchen island and adjacent living space
${isLarge ? "- Detail view of the fireplace feature wall with surrounding built-ins\n- Close-up of the bay window seating area with natural light\n- Diagonal view from far corner emphasizing the room's depth and flow\n- Entrance perspective showing the transition from hallway into the open space" : "- Detail view focusing on key features and finishes"}

Generate ${minSuggestions}-${maxSuggestions} suggestions NOW that TOGETHER provide complete spatial coverage:`;

    // Call Gemini API with vision
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: prompt,
                },
                {
                  inline_data: {
                    mime_type: "image/jpeg",
                    data: base64Image,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.9,
            topK: 40,
            topP: 0.95,
            maxOutputTokens: 1024,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();

    if (!result.candidates || result.candidates.length === 0) {
      throw new Error("Gemini returned no candidates");
    }

    const text = result.candidates[0].content.parts[0].text;
    const suggestions = text
      .split("\n")
      .filter((line: string) => line.trim().startsWith("-"))
      .map((line: string) => line.trim().substring(1).trim())
      .slice(0, maxSuggestions); // Take up to max suggestions

    if (suggestions.length === 0) {
      console.warn("[save-camera-intents] AI returned no valid suggestions, using fallback");
      return generateFallbackSuggestions(space);
    }

    // Ensure we have at least minimum suggestions
    if (suggestions.length < minSuggestions) {
      console.warn(`[save-camera-intents] AI returned only ${suggestions.length} suggestions, expected ${minSuggestions}-${maxSuggestions}`);
      // If too few, supplement with fallback
      const fallback = generateFallbackSuggestions(space);
      return [...suggestions, ...fallback].slice(0, minSuggestions);
    }

    return suggestions;
  } catch (error) {
    console.error("[save-camera-intents] AI generation failed:", error);
    return generateFallbackSuggestions(space);
  }
}

/**
 * Fallback suggestions when AI is unavailable
 * Generates suggestions with spatial coverage logic
 */
function generateFallbackSuggestions(space: any): string[] {
  const isLarge = ["living_room", "kitchen", "master_bedroom", "dining_room", "open_plan"].includes(space.space_type);

  if (isLarge) {
    // Large spaces: 4-6 suggestions covering multiple angles
    return [
      `Wide shot from entry capturing the entire ${space.name} layout and natural light flow`,
      `Opposite corner angle showcasing the full depth and spatial arrangement of ${space.name}`,
      `Side angle highlighting key architectural features and design elements`,
      `Diagonal perspective emphasizing the room's flow and connection to adjacent spaces`,
      `Detail view focusing on unique fixtures and material finishes`,
      `Close-up of focal point features and decorative elements`,
    ];
  } else {
    // Normal spaces: 2-4 suggestions covering main views
    return [
      `Wide view from entry capturing the complete ${space.name} layout and functionality`,
      `Opposite angle showcasing the full space from the far wall perspective`,
      `Side angle highlighting key features and architectural details`,
      `Detail shot focusing on finishes and functional elements`,
    ];
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const { pipeline_id } = await req.json();
    if (!pipeline_id) {
      return new Response(JSON.stringify({ error: "Missing pipeline_id" }), { status: 400, headers: corsHeaders });
    }

    console.log(`[save-camera-intents] Starting generation for pipeline ${pipeline_id}`);

    // 1. Fetch pipeline to get Step 2 output and space analysis
    const { data: pipeline, error: pipelineError } = await supabase
      .from("floorplan_pipelines")
      .select("step_outputs, floor_plan_upload_id")
      .eq("id", pipeline_id)
      .single();

    if (pipelineError || !pipeline) {
      throw new Error("Pipeline not found");
    }

    const stepOutputs = (pipeline.step_outputs || {}) as Record<string, any>;
    const step2Output = stepOutputs.step2 || stepOutputs["2"];
    const spaceAnalysisOutput = stepOutputs.space_analysis;

    if (!step2Output?.output_upload_id) {
      throw new Error("Step 2 (Style) must be completed first - no styled image found");
    }

    // 2. Get signed URL for the styled image
    const { data: uploadData } = await supabase
      .from("uploads")
      .select("bucket, path")
      .eq("id", step2Output.output_upload_id)
      .single();

    if (!uploadData) {
      throw new Error("Step 2 styled image not found in storage");
    }

    const { data: signedUrlData } = await supabase.storage
      .from(uploadData.bucket)
      .createSignedUrl(uploadData.path, 3600); // 1 hour expiry

    if (!signedUrlData?.signedUrl) {
      throw new Error("Failed to create signed URL for styled image");
    }

    const styledImageUrl = signedUrlData.signedUrl;
    console.log(`[save-camera-intents] Using styled image: ${step2Output.output_upload_id}`);

    // 3. Parse space analysis data
    const spaceAnalysisMap = new Map<string, SpaceAnalysis>();
    if (spaceAnalysisOutput?.rooms || spaceAnalysisOutput?.zones) {
      const allAnalyzedSpaces = [
        ...(spaceAnalysisOutput.rooms || []),
        ...(spaceAnalysisOutput.zones || []),
      ];

      for (const analyzed of allAnalyzedSpaces) {
        if (analyzed.space_id) {
          spaceAnalysisMap.set(analyzed.space_id, analyzed);
        }
      }
    }

    // 4. Fetch detected spaces
    const { data: spaces, error: spacesError } = await supabase
      .from("floorplan_pipeline_spaces")
      .select("*")
      .eq("pipeline_id", pipeline_id);

    if (spacesError) throw spacesError;
    if (!spaces || spaces.length === 0) {
      return new Response(
        JSON.stringify({ message: "No spaces detected yet - run Step 3 (Detect Spaces) first" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[save-camera-intents] Generating AI suggestions for ${spaces.length} spaces`);

    // 5. Generate AI suggestions for each space
    const intentsToInsert = [];
    const LARGE_SPACE_TYPES = ["living_room", "kitchen", "master_bedroom", "dining_room", "open_plan"];

    for (const space of spaces) {
      const isLarge = LARGE_SPACE_TYPES.includes(space.space_type);
      const sizeCategory = isLarge ? "large" : "normal";
      const spaceAnalysis = spaceAnalysisMap.get(space.id) || null;

      console.log(`[save-camera-intents] Generating for: ${space.name} (${space.space_type})`);

      // Generate AI suggestions
      const suggestions = await generateAISuggestions(styledImageUrl, space, spaceAnalysis);

      for (let i = 0; i < suggestions.length; i++) {
        intentsToInsert.push({
          pipeline_id,
          space_id: space.id,
          owner_id: user.id,
          suggestion_text: suggestions[i],
          suggestion_index: i,
          space_size_category: sizeCategory,
          is_selected: false, // User must explicitly select
        });
      }
    }

    // 6. Clear existing intents and insert new ones
    await supabase.from("camera_intents").delete().eq("pipeline_id", pipeline_id);

    const { error: insertError } = await supabase
      .from("camera_intents")
      .insert(intentsToInsert);

    if (insertError) throw insertError;

    console.log(`[save-camera-intents] Successfully generated ${intentsToInsert.length} AI-powered suggestions`);

    return new Response(
      JSON.stringify({
        success: true,
        count: intentsToInsert.length,
        ai_powered: !!GEMINI_API_KEY,
        ai_model: "gemini-1.5-flash",
        spaces_processed: spaces.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[save-camera-intents] Error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
