/**
 * generate-camera-prompts edge function
 *
 * Transform camera intents into NanoBanana prompts and create render records.
 * This implements Step 4 "Generate Prompts" action from the pipeline spec.
 *
 * Input: { pipeline_id: string, camera_intent_ids: string[] }
 * Output: { success: true, prompts_generated: number, render_ids: string[] }
 *
 * Process:
 * 1. Fetch selected camera intents
 * 2. For each intent, generate a NanoBanana prompt based on template
 * 3. Create floorplan_space_renders records with status='planned'
 * 4. Return list of created render IDs
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface CameraIntent {
  id: string;
  pipeline_id: string;
  standing_space_id: string;
  standing_space_name: string;
  template_id: string;
  template_description: string;
  view_direction_type: string;
  target_space_id: string | null;
  target_space_name: string | null;
  intent_description: string;
}

/**
 * Generate a NanoBanana prompt from a camera intent
 */
function generatePromptFromIntent(intent: CameraIntent): string {
  const spaceName = intent.standing_space_name;
  const viewDirection = intent.view_direction_type;
  const targetSpace = intent.target_space_name;

  let prompt = `Generate a photorealistic interior view of the ${spaceName}.

Camera Position: Human eye-level (1.5-1.7m height), standing in the ${spaceName}.
View Direction: ${viewDirection}`;

  if (targetSpace) {
    prompt += `\nTarget Space: Looking toward the ${targetSpace}`;
  }

  prompt += `\n\nTemplate: ${intent.template_id} - ${intent.template_description}

Rendering Requirements:
- Photorealistic quality with accurate lighting and materials
- Maintain architectural accuracy from the floor plan
- Natural human eye-level perspective (no drone/bird's eye views)
- Proper depth of field and spatial relationships
- Consistent with the overall apartment design style

Intent: ${intent.intent_description}`;

  return prompt;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await serviceClient.auth.getUser(token);
    if (claimsError || !claimsData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.user.id;

    const { pipeline_id, camera_intent_ids } = await req.json();

    console.log(`[generate-camera-prompts] Request: pipeline_id=${pipeline_id}, intent_count=${camera_intent_ids?.length || 0}`);

    if (!pipeline_id || !Array.isArray(camera_intent_ids) || camera_intent_ids.length === 0) {
      return new Response(
        JSON.stringify({ error: "Missing pipeline_id or camera_intent_ids" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch the camera intents
    const { data: intents, error: intentsError } = await serviceClient
      .from("camera_intents")
      .select("*")
      .in("id", camera_intent_ids)
      .eq("pipeline_id", pipeline_id);

    if (intentsError || !intents || intents.length === 0) {
      console.error("[generate-camera-prompts] Failed to fetch intents:", intentsError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch camera intents" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[generate-camera-prompts] Fetched ${intents.length} camera intent(s)`);

    // Fetch pipeline settings for quality/ratio
    const { data: pipeline } = await serviceClient
      .from("floorplan_pipelines")
      .select("aspect_ratio, quality_post_step4")
      .eq("id", pipeline_id)
      .single();

    const aspectRatio = pipeline?.aspect_ratio || "16:9";
    const quality = pipeline?.quality_post_step4 || "2K";

    // ═══════════════════════════════════════════════════════════════════════════
    // IDEMPOTENCY CHECK: Query for existing planned renders
    // Prevents duplicate records if "Generate Prompts" is clicked multiple times
    // ═══════════════════════════════════════════════════════════════════════════
    const templateIds = (intents as CameraIntent[]).map(i => i.template_id);
    const spaceIds = (intents as CameraIntent[]).map(i => i.standing_space_id);

    const { data: existingPlanned, error: existingError } = await serviceClient
      .from("floorplan_space_renders")
      .select("id, camera_label, space_id")
      .eq("pipeline_id", pipeline_id)
      .eq("status", "planned")
      .in("camera_label", templateIds);

    if (existingError) {
      console.warn("[generate-camera-prompts] Could not check existing renders:", existingError);
      // Continue anyway - better to potentially create duplicates than fail completely
    }

    // Build a set of existing (space_id, camera_label) combinations
    const existingKeys = new Set(
      (existingPlanned || []).map(r => `${r.space_id}:${r.camera_label}`)
    );

    console.log(`[generate-camera-prompts] Found ${existingKeys.size} existing planned render(s)`);

    // Generate prompts and create render records
    const renderRecords: any[] = [];
    const renderIds: string[] = [];
    const skippedCount = { existing: 0 };

    for (const intent of intents as CameraIntent[]) {
      // Check if this combination already exists
      const key = `${intent.standing_space_id}:${intent.template_id}`;
      if (existingKeys.has(key)) {
        console.log(`[generate-camera-prompts] Skipping duplicate: space=${intent.standing_space_name}, template=${intent.template_id}`);
        skippedCount.existing++;
        continue;
      }

      // Generate prompt from intent
      const promptText = generatePromptFromIntent(intent);

      // Create render record for this intent
      const renderRecord = {
        pipeline_id,
        space_id: intent.standing_space_id,
        owner_id: userId,
        kind: "A", // Default to kind A for camera intent renders
        status: "planned",
        prompt_text: promptText,
        ratio: aspectRatio,
        quality,
        model: null,
        attempt_index: 0,
        attempt_count: 0,
        locked_approved: false,
        qa_status: "pending",
        qa_report: null,
        structured_qa_result: null,
        camera_marker_id: null,
        camera_label: intent.template_id,
        final_composed_prompt: promptText,
        adjacency_context: {
          standing_space_name: intent.standing_space_name,
          target_space_name: intent.target_space_name,
          view_direction_type: intent.view_direction_type,
          template_id: intent.template_id,
          intent_id: intent.id,
        },
      };

      renderRecords.push(renderRecord);
    }

    // If all prompts already exist, return early with existing IDs
    if (renderRecords.length === 0) {
      console.log(`[generate-camera-prompts] All prompts already exist (idempotent). Skipped ${skippedCount.existing} duplicate(s).`);

      // Ensure pipeline phase is set to renders_pending
      await serviceClient
        .from("floorplan_pipelines")
        .update({
          whole_apartment_phase: "renders_pending",
          updated_at: new Date().toISOString(),
        })
        .eq("id", pipeline_id);

      // Return existing render IDs
      const existingRenderIds = (existingPlanned || [])
        .filter(r => templateIds.includes(r.camera_label))
        .map(r => r.id);

      return new Response(
        JSON.stringify({
          success: true,
          prompts_generated: existingRenderIds.length,
          render_ids: existingRenderIds,
          message: `Prompts already exist (idempotent). ${existingRenderIds.length} planned render(s) ready.`,
          idempotent: true,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Insert only new render records
    console.log(`[generate-camera-prompts] Creating ${renderRecords.length} new render record(s), skipped ${skippedCount.existing} existing`);

    const { data: createdRenders, error: insertError } = await serviceClient
      .from("floorplan_space_renders")
      .insert(renderRecords)
      .select("id");

    if (insertError) {
      console.error("[generate-camera-prompts] Failed to create render records:", insertError);
      return new Response(
        JSON.stringify({ error: "Failed to create render records", details: insertError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    renderIds.push(...(createdRenders?.map(r => r.id) || []));

    console.log(`[generate-camera-prompts] Created ${renderIds.length} new render record(s)`);

    // Update pipeline phase to renders_pending
    await serviceClient
      .from("floorplan_pipelines")
      .update({
        whole_apartment_phase: "renders_pending",
        updated_at: new Date().toISOString(),
      })
      .eq("id", pipeline_id);

    return new Response(
      JSON.stringify({
        success: true,
        prompts_generated: renderIds.length,
        render_ids: renderIds,
        message: `Generated ${renderIds.length} new prompt(s)${skippedCount.existing > 0 ? `, skipped ${skippedCount.existing} existing` : ''}`,
        skipped_existing: skippedCount.existing,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[generate-camera-prompts] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
