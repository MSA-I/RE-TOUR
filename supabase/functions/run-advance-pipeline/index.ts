import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

    const { pipeline_id, from_step, styled_image_upload_id } = await req.json();

    if (!pipeline_id) {
      return new Response(
        JSON.stringify({ error: "Missing pipeline_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Fetch pipeline
    const { data: pipeline, error: pipelineError } = await serviceClient
      .from("floorplan_pipelines")
      .select("*")
      .eq("id", pipeline_id)
      .eq("owner_id", userId)
      .single();

    if (pipelineError || !pipeline) {
      return new Response(JSON.stringify({ error: "Pipeline not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if pipeline is paused - do NOT create new jobs if disabled
    if (pipeline.is_enabled === false) {
      console.log(`[advance-pipeline] Pipeline ${pipeline_id} is paused - skipping job creation`);
      return new Response(
        JSON.stringify({
          success: false,
          paused: true,
          message: "Pipeline is paused. Resume to continue processing.",
          run_state: pipeline.run_state,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ============= OUTDATED STEP TRANSITION GUARD =============
    // Prevent advancing to a step we've already passed.
    // from_step should match current_step (or current_step - 1 for the transition)
    const currentStep = pipeline.current_step || 0;
    
    if (from_step < currentStep) {
      console.log(`[advance-pipeline] BLOCKED: Outdated step transition. from_step=${from_step}, current_step=${currentStep}`);
      return new Response(
        JSON.stringify({
          success: false,
          error: "Invalid step transition: pipeline has already advanced past this step",
          from_step,
          current_step: currentStep,
          blocked_reason: "outdated_step",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch active spaces
    const { data: spaces } = await serviceClient
      .from("floorplan_pipeline_spaces")
      .select("*")
      .eq("pipeline_id", pipeline_id)
      .eq("is_excluded", false)
      .eq("include_in_generation", true);

    const activeSpaces = spaces || [];
    console.log(`[advance-pipeline] From step ${from_step}, ${activeSpaces.length} active spaces`);

    // Determine the next phase based on from_step
    let updateData: Record<string, unknown> = {};
    let actionTaken = "none";

    // ============= SERVER-SIDE APPROVAL VERIFICATION =============
    // Verify that ALL required outputs are approved before advancing.
    // This prevents race conditions where the UI might be stale.
    
    if (from_step === 4) {
      // Verify ALL renders are approved before advancing to panoramas
      const { data: allRenders } = await serviceClient
        .from("floorplan_space_renders")
        .select("id, space_id, kind, locked_approved, status")
        .eq("pipeline_id", pipeline_id)
        .in("space_id", activeSpaces.map(s => s.id));
      
      const requiredRenderCount = activeSpaces.length * 2; // A and B per space
      const approvedRenderCount = (allRenders || []).filter(r => r.locked_approved === true).length;
      
      if (approvedRenderCount < requiredRenderCount) {
        console.log(`[advance-pipeline] BLOCKED: Only ${approvedRenderCount}/${requiredRenderCount} renders approved`);
        return new Response(
          JSON.stringify({
            success: false,
            error: "Cannot continue: not all renders are approved",
            approved: approvedRenderCount,
            required: requiredRenderCount,
            blocked_reason: "approval_incomplete",
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }
    
    if (from_step === 5) {
      // Verify ALL panoramas are approved before advancing to merge
      const { data: allPanoramas } = await serviceClient
        .from("floorplan_space_panoramas")
        .select("id, space_id, kind, locked_approved, status")
        .eq("pipeline_id", pipeline_id)
        .in("space_id", activeSpaces.map(s => s.id));
      
      const requiredPanoCount = activeSpaces.length * 2; // A and B per space
      const approvedPanoCount = (allPanoramas || []).filter(p => p.locked_approved === true).length;
      
      if (approvedPanoCount < requiredPanoCount) {
        console.log(`[advance-pipeline] BLOCKED: Only ${approvedPanoCount}/${requiredPanoCount} panoramas approved`);
        return new Response(
          JSON.stringify({
            success: false,
            error: "Cannot continue: not all panoramas are approved",
            approved: approvedPanoCount,
            required: requiredPanoCount,
            blocked_reason: "approval_incomplete",
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    if (from_step === 3) {
      // Step 3 → Step 4: Initialize renders for all active spaces
      console.log(`[advance-pipeline] Advancing to Step 4: Renders`);
      
      // Load camera markers to assign to renders
      const { data: cameraMarkers } = await serviceClient
        .from("pipeline_camera_markers")
        .select("*")
        .eq("pipeline_id", pipeline_id)
        .order("sort_order", { ascending: true });
      
      console.log(`[advance-pipeline] Found ${cameraMarkers?.length || 0} camera markers to assign`);
      
      // Build a map of room_id -> markers for assignment
      // Also track used markers to distribute evenly when room_id not set
      type CameraMarkerRow = { id: string; label: string; room_id: string | null; sort_order: number };
      const markersByRoom: Record<string, CameraMarkerRow[]> = {};
      const unassignedMarkers: CameraMarkerRow[] = [...(cameraMarkers || [])];
      
      for (const marker of cameraMarkers || []) {
        if (marker.room_id) {
          if (!markersByRoom[marker.room_id]) markersByRoom[marker.room_id] = [];
          markersByRoom[marker.room_id]!.push(marker);
        }
      }
      
      // Check if renders already exist
      const { data: existingRenders } = await serviceClient
        .from("floorplan_space_renders")
        .select("id, space_id, kind")
        .eq("pipeline_id", pipeline_id);
      
      const existingRenderMap = new Set((existingRenders || []).map(r => `${r.space_id}-${r.kind}`));
      
      // Helper to get next marker for a space
      const getMarkerForSpace = (spaceId: string): { id: string; label: string } | null => {
        // First try room-specific markers
        if (markersByRoom[spaceId] && markersByRoom[spaceId].length > 0) {
          const marker = markersByRoom[spaceId].shift()!;
          return { id: marker.id, label: marker.label };
        }
        // Then try any unassigned marker
        if (unassignedMarkers.length > 0) {
          const marker = unassignedMarkers.shift()!;
          return { id: marker.id, label: marker.label };
        }
        return null;
      };
      
      // Create render records for spaces that don't have them
      const rendersToCreate = [];
      for (const space of activeSpaces) {
        // Try to assign a camera marker to each render
        const markerA = getMarkerForSpace(space.id);
        const markerB = getMarkerForSpace(space.id);
        
        if (!existingRenderMap.has(`${space.id}-A`)) {
          rendersToCreate.push({
            space_id: space.id,
            pipeline_id: pipeline_id,
            owner_id: userId,
            kind: "A",
            status: "pending",
            ratio: pipeline.aspect_ratio || "16:9",
            quality: pipeline.quality_post_step4 || "2K",
            camera_marker_id: markerA?.id || null,
            camera_label: markerA?.label || null,
          });
        }
        if (!existingRenderMap.has(`${space.id}-B`)) {
          rendersToCreate.push({
            space_id: space.id,
            pipeline_id: pipeline_id,
            owner_id: userId,
            kind: "B",
            status: "pending",
            ratio: pipeline.aspect_ratio || "16:9",
            quality: pipeline.quality_post_step4 || "2K",
            camera_marker_id: markerB?.id || null,
            camera_label: markerB?.label || null,
          });
        }
      }

      if (rendersToCreate.length > 0) {
        const { error: insertError } = await serviceClient
          .from("floorplan_space_renders")
          .insert(rendersToCreate);
        if (insertError) console.error("Error creating renders:", insertError);
        else {
          const linkedCount = rendersToCreate.filter(r => r.camera_marker_id).length;
          console.log(`[advance-pipeline] Created ${rendersToCreate.length} renders (${linkedCount} with camera markers)`);
        }
      }

      updateData = {
        whole_apartment_phase: "renders_pending",
        current_step: 4,
        status: "step4_pending",
      };
      actionTaken = `initialized_renders_${rendersToCreate.length}`;
    } else if (from_step === 4) {
      // Step 4 → Step 5: Initialize panoramas for all spaces with approved renders
      console.log(`[advance-pipeline] Advancing to Step 5: Panoramas`);
      
      // Get approved renders
      const { data: approvedRenders } = await serviceClient
        .from("floorplan_space_renders")
        .select("id, space_id, kind")
        .eq("pipeline_id", pipeline_id)
        .eq("locked_approved", true);

      // Check if panoramas already exist
      const { data: existingPanoramas } = await serviceClient
        .from("floorplan_space_panoramas")
        .select("id, space_id, kind")
        .eq("pipeline_id", pipeline_id);
      
      const existingPanoMap = new Set((existingPanoramas || []).map(p => `${p.space_id}-${p.kind}`));
      
      // Create panorama records
      const panoramasToCreate = [];
      for (const render of approvedRenders || []) {
        if (!existingPanoMap.has(`${render.space_id}-${render.kind}`)) {
          panoramasToCreate.push({
            space_id: render.space_id,
            pipeline_id: pipeline_id,
            owner_id: userId,
            kind: render.kind,
            source_render_id: render.id,
            status: "pending",
            ratio: "2:1",
            quality: pipeline.quality_post_step4 || "2K",
          });
        }
      }

      if (panoramasToCreate.length > 0) {
        const { error: insertError } = await serviceClient
          .from("floorplan_space_panoramas")
          .insert(panoramasToCreate);
        if (insertError) console.error("Error creating panoramas:", insertError);
      }

      updateData = {
        whole_apartment_phase: "panoramas_pending",
        current_step: 5,
        status: "step5_pending",
      };
      actionTaken = `initialized_panoramas_${panoramasToCreate.length}`;
    } else if (from_step === 5) {
      // Step 5 → Step 6: Initialize final360 for all spaces with approved panoramas
      console.log(`[advance-pipeline] Advancing to Step 6: Merge`);
      
      // Get spaces with both panoramas approved
      const { data: approvedPanoramas } = await serviceClient
        .from("floorplan_space_panoramas")
        .select("id, space_id, kind")
        .eq("pipeline_id", pipeline_id)
        .eq("locked_approved", true);

      // Group by space
      const panosBySpace: Record<string, { A?: string; B?: string }> = {};
      for (const p of approvedPanoramas || []) {
        if (!panosBySpace[p.space_id]) panosBySpace[p.space_id] = {};
        panosBySpace[p.space_id][p.kind as "A" | "B"] = p.id;
      }

      // Check existing final360s
      const { data: existingFinal360s } = await serviceClient
        .from("floorplan_space_final360")
        .select("id, space_id")
        .eq("pipeline_id", pipeline_id);
      
      const existingFinal360Set = new Set((existingFinal360s || []).map(f => f.space_id));

      // Create final360 records for spaces that have both panoramas
      const final360sToCreate = [];
      for (const [spaceId, panos] of Object.entries(panosBySpace)) {
        if (panos.A && panos.B && !existingFinal360Set.has(spaceId)) {
          final360sToCreate.push({
            space_id: spaceId,
            pipeline_id: pipeline_id,
            owner_id: userId,
            panorama_a_id: panos.A,
            panorama_b_id: panos.B,
            status: "pending",
          });
        }
      }

      if (final360sToCreate.length > 0) {
        const { error: insertError } = await serviceClient
          .from("floorplan_space_final360")
          .insert(final360sToCreate);
        if (insertError) console.error("Error creating final360s:", insertError);
      }

      updateData = {
        whole_apartment_phase: "merging_pending",
        current_step: 6,
        status: "step5_waiting_approval",
      };
      actionTaken = `initialized_final360s_${final360sToCreate.length}`;
    }

    // Update pipeline
    if (Object.keys(updateData).length > 0) {
      await serviceClient
        .from("floorplan_pipelines")
        .update(updateData)
        .eq("id", pipeline_id);
    }

    console.log(`[advance-pipeline] Action taken: ${actionTaken}`);

    return new Response(
      JSON.stringify({
        success: true,
        action: actionTaken,
        active_spaces: activeSpaces.length,
        new_phase: updateData.whole_apartment_phase,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[advance-pipeline] Error: ${message}`);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
