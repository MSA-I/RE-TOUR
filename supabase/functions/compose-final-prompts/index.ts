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
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
            { global: { headers: { Authorization: authHeader } } }
        );

        const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
        if (authError || !user) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
        }

        const { pipeline_id, selected_intent_ids } = await req.json();
        if (!pipeline_id || !selected_intent_ids || !Array.isArray(selected_intent_ids)) {
            return new Response(JSON.stringify({ error: "Missing pipeline_id or selected_intent_ids" }), { status: 400, headers: corsHeaders });
        }

        // 1. Fetch selected intents with space info
        const { data: intents, error: intentsError } = await supabase
            .from("camera_intents")
            .select("*, space:space_id(*)")
            .in("id", selected_intent_ids)
            .eq("pipeline_id", pipeline_id);

        if (intentsError) throw intentsError;
        if (!intents || intents.length === 0) {
            throw new Error("No valid intents found for selection");
        }

        // 2. Mark intents as selected in DB
        // Reset all first
        await supabase.from("camera_intents").update({ is_selected: false }).eq("pipeline_id", pipeline_id);
        // Set selected
        await supabase.from("camera_intents").update({ is_selected: true }).in("id", selected_intent_ids);

        // 3. Compose Final Prompts
        const promptsToInsert = [];
        const nanoBananaJobs = [];

        // Group intents by space (if multiple allowed per space, though current logic implies 1 per space? Schema allows array of intents)
        // For now assuming 1 prompt row per space, which might combine intents?
        // final_prompts has UNIQUE(pipeline_id, space_id). So one row per space.

        // Group by space_id
        const intentsBySpace = intents.reduce((acc, intent) => {
            if (!acc[intent.space_id]) acc[intent.space_id] = [];
            acc[intent.space_id].push(intent);
            return acc;
        }, {});

        for (const spaceId in intentsBySpace) {
            const spaceIntents = intentsBySpace[spaceId];
            const space = spaceIntents[0].space; // Assumes all intents in group belong to same space

            // Determine image count based on space size category
            // Large spaces (Living Room, Kitchen, Master Bedroom, Dining Area) get 2-4 images
            // Normal spaces get 1-2 images
            const spaceSizeCategory = spaceIntents[0].space_size_category || 'normal';
            const imageCount = spaceSizeCategory === 'large'
                ? Math.min(spaceIntents.length, 4)  // Large spaces: 2-4 images based on intent count
                : Math.min(spaceIntents.length, 2); // Normal spaces: 1-2 images

            // Composing prompt - Combines intent texts + space attributes
            // Real logic would also incorporate global style profile from pipeline
            const promptTemplate = spaceIntents.map(i => i.suggestion_text).join(" + ");
            const finalPrompt = `Photorealistic render of ${space.name}, ${promptTemplate}, 8k resolution, interior design photography`;

            const jobId = `nano_${crypto.randomUUID()}`; // Placeholder Nanobanana Job ID (will be real job ID when queued)
            nanoBananaJobs.push({ spaceId, jobId, imageCount });

            promptsToInsert.push({
                pipeline_id,
                space_id: spaceId,
                owner_id: user.id,
                prompt_template: promptTemplate,
                final_composed_prompt: finalPrompt,
                image_count: imageCount,
                source_camera_intent_ids: spaceIntents.map(i => i.id),
                nanobanana_job_id: jobId,
                status: 'queued' // Queued for generation (actual generation happens in Step 6)
            });
        }

        // 4. Clear old final prompts
        await supabase.from("final_prompts").delete().eq("pipeline_id", pipeline_id);

        // 5. Insert new final prompts
        const { error: insertError } = await supabase
            .from("final_prompts")
            .insert(promptsToInsert);

        if (insertError) throw insertError;

        // 6. Transition Pipeline Phase
        // Step 5 confirmed -> Ready for Output (Step 6)
        // Actually the Plan said: "Transition to prompt_templates_confirmed"
        await supabase
            .from("floorplan_pipelines")
            .update({
                whole_apartment_phase: "prompt_templates_confirmed",
                current_step: 5
            })
            .eq("id", pipeline_id);

        return new Response(JSON.stringify({
            success: true,
            prompts_created: promptsToInsert.length,
            jobs: nanoBananaJobs
        }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });

    } catch (error) {
        console.error("Error in compose-final-prompts:", error);
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});
