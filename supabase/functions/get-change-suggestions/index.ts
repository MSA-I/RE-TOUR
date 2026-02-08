import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Gemini API configuration - uses API_NANOBANANA
const API_NANOBANANA = Deno.env.get("API_NANOBANANA");
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const ORCHESTRATION_MODEL = "gemini-3-flash-preview";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey);
    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: authError,
    } = await supabaseClient.auth.getUser(token);

    if (authError || !user) {
      throw new Error("Unauthorized");
    }

    const { category, search, generate_more, surprise_me, context } = await req.json();

    console.log(`Getting suggestions: category=${category}, search=${search}, generate_more=${generate_more}, surprise_me=${surprise_me}, context=${context}`);

    // Handle "Surprise me" - return random suggestion
    if (surprise_me) {
      let surpriseQuery = supabaseClient
        .from("change_suggestions")
        .select("*");
      
      // Filter by context if provided
      if (context) {
        surpriseQuery = surpriseQuery.eq("category", context);
      }
      
      const { data: randomSuggestion, error } = await surpriseQuery
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;

      if (randomSuggestion && randomSuggestion.length > 0) {
        const randomIndex = Math.floor(Math.random() * randomSuggestion.length);
        return new Response(
          JSON.stringify({
            suggestions: [randomSuggestion[randomIndex]],
            is_random: true,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Build query for existing suggestions
    let query = supabaseClient.from("change_suggestions").select("*");

    // If context is provided, use it as the primary filter (overrides category)
    if (context) {
      query = query.eq("category", context);
    } else if (category && category !== "all") {
      query = query.eq("category", category);
    }

    if (search) {
      query = query.or(`title.ilike.%${search}%,prompt.ilike.%${search}%`);
    }

    query = query.order("is_generated", { ascending: true }).order("created_at", { ascending: true });

    const { data: suggestions, error: fetchError } = await query;

    if (fetchError) throw fetchError;

    // If generate_more is requested and we have API key, generate new suggestions
    if (generate_more && API_NANOBANANA) {
      console.log("Generating more suggestions via Gemini API...");

      const existingPrompts = suggestions?.map(s => s.prompt).join(", ") || "";

      const promptText = `You are an expert interior designer. Generate creative interior design change suggestions.
RULES:
- Focus ONLY on interior design: materials, colors, furniture, lighting, decor, atmosphere
- NEVER suggest structural changes (walls, windows, doors, room layout, geometry)
- Keep suggestions specific and actionable
- Each suggestion should be a single focused change
- Avoid these existing suggestions: ${existingPrompts.substring(0, 500)}

Generate 5 unique interior design change suggestions${category && category !== "all" ? ` in the "${category}" category` : ""}.

Return ONLY a JSON array with objects containing "category" (one of: materials, walls, furniture, lighting, decor, atmosphere), "title", and "prompt" fields.`;

      try {
        const geminiUrl = `${GEMINI_API_BASE}/${ORCHESTRATION_MODEL}:generateContent?key=${API_NANOBANANA}`;

        const response = await fetch(geminiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            contents: [{
              parts: [{ text: promptText }]
            }],
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 1500,
            }
          }),
        });

        if (response.ok) {
          const data = await response.json();
          const content = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

          // Parse JSON from response
          const jsonMatch = content.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            const newSuggestions = JSON.parse(jsonMatch[0]);

            // Insert new suggestions (deduplicated)
            for (const suggestion of newSuggestions) {
              // Check if prompt already exists
              const { data: existing } = await supabaseClient
                .from("change_suggestions")
                .select("id")
                .eq("prompt", suggestion.prompt)
                .single();

              if (!existing) {
                await supabaseClient.from("change_suggestions").insert({
                  category: suggestion.category,
                  title: suggestion.title,
                  prompt: suggestion.prompt,
                  is_generated: true,
                });
                console.log(`Added new suggestion: ${suggestion.title}`);
              }
            }

            // Re-fetch all suggestions
            const { data: updatedSuggestions } = await supabaseClient
              .from("change_suggestions")
              .select("*")
              .order("is_generated", { ascending: true })
              .order("created_at", { ascending: true });

            return new Response(
              JSON.stringify({
                suggestions: updatedSuggestions || [],
                generated_count: newSuggestions.length,
              }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
        } else {
          console.warn("AI generation failed:", response.status);
        }
      } catch (aiError) {
        console.error("AI generation error:", aiError);
        // Continue with existing suggestions
      }
    }

    // Get unique categories for UI
    const { data: categories } = await supabaseClient
      .from("change_suggestions")
      .select("category")
      .order("category");

    const uniqueCategories = [...new Set(categories?.map(c => c.category) || [])];

    return new Response(
      JSON.stringify({
        suggestions: suggestions || [],
        categories: uniqueCategories,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
