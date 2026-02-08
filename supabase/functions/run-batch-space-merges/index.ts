import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { cleanupCameraArtifacts } from "../_shared/camera-visual-anchor.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const BATCH_SIZE = 4;

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

    const { pipeline_id, merge_quality } = await req.json();

    if (!pipeline_id) {
      return new Response(
        JSON.stringify({ error: "Missing pipeline_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Fetch pipeline and check if enabled
    // Also fetch quality_post_step4 for merge quality
    const { data: pipeline } = await serviceClient
      .from("floorplan_pipelines")
      .select("is_enabled, run_state, quality_post_step4")
      .eq("id", pipeline_id)
      .single();
    
    // Determine merge quality: user-provided > pipeline setting > default 2K
    // Step 7 Quality UI Gate: This is the ONLY place where 4K is selected
    const effectiveMergeQuality = merge_quality || pipeline?.quality_post_step4 || "2K";
    console.log(`[batch-merges] Using merge quality: ${effectiveMergeQuality}`);

    if (pipeline?.is_enabled === false) {
      console.log(`[batch-merges] Pipeline ${pipeline_id} is paused - skipping`);
      return new Response(
        JSON.stringify({
          success: false,
          paused: true,
          message: "Pipeline is paused. Resume to continue processing.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update pipeline phase
    await serviceClient
      .from("floorplan_pipelines")
      .update({ 
        whole_apartment_phase: "merging_in_progress",
        status: "step5_running",
      })
      .eq("id", pipeline_id);

    // Gate check: Ensure all active space panoramas are approved
    const { data: activeSpaces } = await serviceClient
      .from("floorplan_pipeline_spaces")
      .select("id")
      .eq("pipeline_id", pipeline_id)
      .eq("is_excluded", false)
      .eq("include_in_generation", true);

    const activeSpaceIds = (activeSpaces || []).map(s => s.id);

    const { data: panoramas } = await serviceClient
      .from("floorplan_space_panoramas")
      .select("space_id, kind, locked_approved")
      .eq("pipeline_id", pipeline_id)
      .in("space_id", activeSpaceIds);

    // Check gate: All panoramas must be approved
    const panosBySpace: Record<string, { A?: boolean; B?: boolean }> = {};
    for (const p of panoramas || []) {
      if (!panosBySpace[p.space_id]) panosBySpace[p.space_id] = {};
      panosBySpace[p.space_id][p.kind as "A" | "B"] = p.locked_approved;
    }

    const spacesWithUnapprovedPanos = activeSpaceIds.filter(
      id => !panosBySpace[id]?.A || !panosBySpace[id]?.B
    );

    if (spacesWithUnapprovedPanos.length > 0) {
      console.log(`[batch-merges] Gate failed: ${spacesWithUnapprovedPanos.length} spaces with unapproved panoramas`);
      
      await serviceClient
        .from("floorplan_pipelines")
        .update({ 
          whole_apartment_phase: "panoramas_review",
          last_error: `Cannot start merges: ${spacesWithUnapprovedPanos.length} spaces have unapproved panoramas`,
        })
        .eq("id", pipeline_id);

      return new Response(
        JSON.stringify({
          success: false,
          error: "Gate check failed",
          blocked_spaces: spacesWithUnapprovedPanos.length,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch pending final360s
    const { data: final360s } = await serviceClient
      .from("floorplan_space_final360")
      .select("*, panorama_a_id, panorama_b_id")
      .eq("pipeline_id", pipeline_id)
      .eq("owner_id", userId)
      .eq("locked_approved", false)
      .in("status", ["pending", "rejected", "failed"]);

    const pendingMerges = final360s || [];
    console.log(`[batch-merges] Found ${pendingMerges.length} pending merges`);

    if (pendingMerges.length === 0) {
      // Check if all are approved = completed
      const { data: allFinal360s } = await serviceClient
        .from("floorplan_space_final360")
        .select("locked_approved")
        .eq("pipeline_id", pipeline_id);

      const allApproved = allFinal360s?.every(f => f.locked_approved);

      await serviceClient
        .from("floorplan_pipelines")
        .update({ 
          whole_apartment_phase: allApproved ? "completed" : "merging_review",
          status: allApproved ? "completed" : "step5_waiting_approval",
        })
        .eq("id", pipeline_id);

      return new Response(
        JSON.stringify({
          success: true,
          message: allApproved ? "Pipeline completed!" : "No pending merges found",
          processed: 0,
          completed: allApproved,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Mark all as queued
    const mergeIds = pendingMerges.map(m => m.id);
    await serviceClient
      .from("floorplan_space_final360")
      .update({ status: "queued" })
      .in("id", mergeIds);

    // Process in background
    const processMerges = async () => {
      let completed = 0;
      let failed = 0;

      for (let i = 0; i < pendingMerges.length; i += BATCH_SIZE) {
        const batch = pendingMerges.slice(i, i + BATCH_SIZE);
        
        const batchPromises = batch.map(async (merge) => {
          try {
            const response = await fetch(
              `${SUPABASE_URL}/functions/v1/run-merge-360`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: authHeader,
                },
                body: JSON.stringify({
                  final360_id: merge.id,
                  panorama_a_id: merge.panorama_a_id,
                  panorama_b_id: merge.panorama_b_id,
                  // Pass the quality setting from Step 7 UI Gate
                  quality: effectiveMergeQuality,
                }),
              }
            );

            if (response.ok) {
              completed++;
              console.log(`[batch-merges] Merge ${merge.id} completed`);
            } else {
              failed++;
              const errorText = await response.text();
              console.error(`[batch-merges] Merge ${merge.id} failed: ${errorText}`);
            }
          } catch (error) {
            failed++;
            console.error(`[batch-merges] Merge ${merge.id} error:`, error);
          }
        });

        await Promise.all(batchPromises);
      }

      // Update pipeline phase
      const { data: allFinal360s } = await serviceClient
        .from("floorplan_space_final360")
        .select("status, locked_approved")
        .eq("pipeline_id", pipeline_id);

      const allApproved = allFinal360s?.every(f => f.locked_approved);
      const anyNeedsReview = allFinal360s?.some(f => f.status === "needs_review");

      if (allApproved) {
        // Pipeline complete - clean up camera artifacts
        console.log(`[batch-merges] Pipeline completed - cleaning up camera artifacts`);
        try {
          const deletedCount = await cleanupCameraArtifacts(serviceClient, pipeline_id, userId);
          console.log(`[batch-merges] Cleaned up ${deletedCount} camera artifacts`);
        } catch (cleanupErr) {
          console.error(`[batch-merges] Camera artifact cleanup failed: ${cleanupErr}`);
        }
        
        await serviceClient
          .from("floorplan_pipelines")
          .update({ 
            whole_apartment_phase: "completed",
            status: "completed",
          })
          .eq("id", pipeline_id);
      } else if (anyNeedsReview || completed > 0) {
        await serviceClient
          .from("floorplan_pipelines")
          .update({ whole_apartment_phase: "merging_review" })
          .eq("id", pipeline_id);
      }

      console.log(`[batch-merges] Completed: ${completed}, Failed: ${failed}`);
    };

    EdgeRuntime.waitUntil(processMerges());

    return new Response(
      JSON.stringify({
        success: true,
        message: `Started processing ${pendingMerges.length} merges`,
        total_merges: pendingMerges.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[batch-merges] Error: ${message}`);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
