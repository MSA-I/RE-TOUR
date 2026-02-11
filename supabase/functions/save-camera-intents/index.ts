import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, // Use service role for admin tasks
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const { pipeline_id } = await req.json();
    if (!pipeline_id) {
      return new Response(JSON.stringify({ error: "Missing pipeline_id" }), { status: 400, headers: corsHeaders });
    }

    // 1. Fetch detected spaces
    const { data: spaces, error: spacesError } = await supabase
      .from("floorplan_pipeline_spaces")
      .select("*")
      .eq("pipeline_id", pipeline_id)
      .eq("is_excluded", false); // Only generate for included spaces

    if (spacesError) throw spacesError;
    if (!spaces || spaces.length === 0) {
      return new Response(JSON.stringify({ message: "No active spaces found" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 2. Generate Suggestions
    const intentsToInsert = [];
    const LARGE_SPACE_TYPES = ["living_room", "kitchen", "master_bedroom", "dining_room", "open_plan"];

    for (const space of spaces) {
      const isLarge = LARGE_SPACE_TYPES.includes(space.space_type) || space.name.toLowerCase().includes("living") || space.name.toLowerCase().includes("kitchen");
      const suggestionCount = isLarge ? 4 : 2;
      const sizeCategory = isLarge ? "large" : "normal";

      // Template logic (Placeholder for actual AI generation or complex template mapping)
      const templates = isLarge
        ? ["Wide shot showing flow", "Focus on key feature", "Detail oriented angle", "Alternative perspective led by light"]
        : ["Standard wide view", "Detail focus"];

      for (let i = 0; i < suggestionCount; i++) {
        const templateText = templates[i] || `View Option ${i + 1}`;

        intentsToInsert.push({
          pipeline_id,
          space_id: space.id,
          owner_id: user.id,
          suggestion_text: `${templateText} for ${space.name}`,
          suggestion_index: i,
          space_size_category: sizeCategory,
          is_selected: i === 0, // Default select the first one? Or none? Plan says "Transition... once user selects". Let's default false.
        });
      }
    }

    // 3. Clear existing intents for this pipeline to avoid duplicates if re-run
    await supabase.from("camera_intents").delete().eq("pipeline_id", pipeline_id);

    // 4. Insert new intents
    const { error: insertError } = await supabase
      .from("camera_intents")
      .insert(intentsToInsert);

    if (insertError) throw insertError;

    return new Response(JSON.stringify({ success: true, count: intentsToInsert.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Error in save-camera-intents:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
