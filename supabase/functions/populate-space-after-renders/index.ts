import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/**
 * Auto-Populate Spaces After Camera Renders Complete
 * 
 * FLOW (DETERMINISTIC):
 * 1. Called after both Camera A and Camera B complete for a marker
 * 2. Populates the associated space with:
 *    - Ready-to-use prompts from the camera metadata
 *    - Camera A + B output references
 *    - Pre-filled editable prompts for panorama generation
 * 
 * This is Step 4 of the Camera Planning render flow.
 */

interface PopulateSpaceInput {
  pipeline_id: string;
  marker_id: string;
  space_id: string;
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

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getUser(token);
    if (claimsError || !claimsData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.user.id;

    const { pipeline_id, marker_id, space_id }: PopulateSpaceInput = await req.json();

    if (!pipeline_id || !marker_id || !space_id) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: pipeline_id, marker_id, space_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Fetch the marker to get camera metadata
    const { data: marker, error: markerError } = await serviceClient
      .from("pipeline_camera_markers")
      .select("*")
      .eq("id", marker_id)
      .eq("owner_id", userId)
      .single();

    if (markerError || !marker) {
      return new Response(
        JSON.stringify({ error: "Marker not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch both Camera A and Camera B renders
    const { data: renders, error: rendersError } = await serviceClient
      .from("floorplan_space_renders")
      .select("*")
      .eq("space_id", space_id)
      .eq("pipeline_id", pipeline_id)
      .in("kind", ["A", "B"]);

    if (rendersError) {
      throw new Error(`Failed to fetch renders: ${rendersError.message}`);
    }

    const renderA = renders?.find((r) => r.kind === "A");
    const renderB = renders?.find((r) => r.kind === "B");

    // Validate both A and B are complete
    const aComplete = renderA?.output_upload_id && 
      (renderA.locked_approved || renderA.status === "needs_review" || renderA.status === "approved_ai");
    const bComplete = renderB?.output_upload_id && 
      (renderB.locked_approved || renderB.status === "needs_review" || renderB.status === "approved_ai");

    if (!aComplete || !bComplete) {
      return new Response(
        JSON.stringify({ 
          error: "INCOMPLETE_RENDERS",
          message: "Both Camera A and Camera B must be complete before populating space",
          a_complete: aComplete,
          b_complete: bComplete,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch space details
    const { data: space, error: spaceError } = await serviceClient
      .from("floorplan_pipeline_spaces")
      .select("*")
      .eq("id", space_id)
      .single();

    if (spaceError || !space) {
      return new Response(
        JSON.stringify({ error: "Space not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build pre-filled prompts for panorama generation
    const yawA = marker.yaw_deg;
    const yawB = (marker.yaw_deg + 180) % 360;
    const fov = marker.fov_deg;

    const basePromptA = `Generate a seamless 360° panorama from the interior render of ${space.name} (${space.space_type}).
Camera A direction: ${yawA}° (FOV: ${fov}°)
Position: (${Math.round(marker.x_norm * 100)}%, ${Math.round(marker.y_norm * 100)}%)
Maintain architectural consistency with the source render.`;

    const basePromptB = `Generate a seamless 360° panorama from the interior render of ${space.name} (${space.space_type}).
Camera B direction: ${yawB}° (opposite of Camera A)
Position: (${Math.round(marker.x_norm * 100)}%, ${Math.round(marker.y_norm * 100)}%)
This is the 180° opposite view - maintain continuity with Camera A panorama.`;

    // Check if panorama records exist, create if not
    const { data: existingPanoramas } = await serviceClient
      .from("floorplan_space_panoramas")
      .select("id, kind, prompt_text, source_render_id")
      .eq("space_id", space_id)
      .eq("pipeline_id", pipeline_id);

    const panoA = existingPanoramas?.find((p) => p.kind === "A");
    const panoB = existingPanoramas?.find((p) => p.kind === "B");

    const panoramasToCreate = [];

    if (!panoA) {
      panoramasToCreate.push({
        pipeline_id,
        space_id,
        owner_id: userId,
        kind: "A",
        status: "pending",
        source_render_id: renderA.id,
        camera_marker_id: marker_id,
        camera_label: `${marker.label} (A)`,
        prompt_text: basePromptA,
        ratio: renderA.ratio || "2:1",
        quality: renderA.quality || "2K",
      });
    }

    if (!panoB) {
      panoramasToCreate.push({
        pipeline_id,
        space_id,
        owner_id: userId,
        kind: "B",
        status: "pending",
        source_render_id: renderB.id,
        camera_marker_id: marker_id,
        camera_label: `${marker.label} (B)`,
        prompt_text: basePromptB,
        ratio: renderB.ratio || "2:1",
        quality: renderB.quality || "2K",
      });
    }

    let createdPanoramas = [];
    if (panoramasToCreate.length > 0) {
      const { data: newPanoramas, error: createError } = await serviceClient
        .from("floorplan_space_panoramas")
        .insert(panoramasToCreate)
        .select();

      if (createError) {
        console.error(`[populate-space] Failed to create panoramas:`, createError);
        throw new Error(`Failed to create panorama records: ${createError.message}`);
      }

      createdPanoramas = newPanoramas || [];
      console.log(`[populate-space] Created ${createdPanoramas.length} panorama records`);
    }

    // Update existing panorama prompts if they exist but have no prompt
    const panoramasToUpdate = [];
    if (panoA && !panoA.prompt_text) {
      panoramasToUpdate.push({ id: panoA.id, prompt_text: basePromptA, source_render_id: renderA.id });
    }
    if (panoB && !panoB.prompt_text) {
      panoramasToUpdate.push({ id: panoB.id, prompt_text: basePromptB, source_render_id: renderB.id });
    }

    for (const update of panoramasToUpdate) {
      await serviceClient
        .from("floorplan_space_panoramas")
        .update({ prompt_text: update.prompt_text, source_render_id: update.source_render_id })
        .eq("id", update.id);
    }

    // Update space render statuses
    await serviceClient
      .from("floorplan_pipeline_spaces")
      .update({
        render_a_status: renderA.locked_approved ? "approved" : "needs_review",
        render_b_status: renderB.locked_approved ? "approved" : "needs_review",
        status: "renders_complete",
        updated_at: new Date().toISOString(),
      })
      .eq("id", space_id);

    // Emit pipeline event
    await serviceClient
      .from("floorplan_pipeline_events")
      .insert({
        pipeline_id,
        owner_id: userId,
        step_number: 5,
        type: "SPACE_POPULATED",
        message: `Space "${space.name}" populated with Camera A+B renders. Ready for panorama generation.`,
        progress_int: 100,
      });

    console.log(`[populate-space] Successfully populated space "${space.name}" (${space_id})`);

    return new Response(
      JSON.stringify({
        success: true,
        space_id,
        space_name: space.name,
        render_a_id: renderA.id,
        render_b_id: renderB.id,
        panoramas_created: createdPanoramas.length,
        panoramas_updated: panoramasToUpdate.length,
        prompts: {
          panorama_a: basePromptA,
          panorama_b: basePromptB,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[populate-space] Error:", error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : "Unknown error" 
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
