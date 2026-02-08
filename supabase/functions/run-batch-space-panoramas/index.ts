import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { QA_CONFIG } from "../_shared/space-qa-workflow.ts";

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

    const { pipeline_id } = await req.json();

    if (!pipeline_id) {
      return new Response(
        JSON.stringify({ error: "Missing pipeline_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Fetch pipeline and check if enabled
    const { data: pipeline } = await serviceClient
      .from("floorplan_pipelines")
      .select("is_enabled, run_state")
      .eq("id", pipeline_id)
      .single();

    if (pipeline?.is_enabled === false) {
      console.log(`[batch-panoramas] Pipeline ${pipeline_id} is paused - skipping`);
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
        whole_apartment_phase: "panoramas_in_progress",
        status: "step6_running",
      })
      .eq("id", pipeline_id);

    // Gate check: Ensure all active space renders are approved
    const { data: activeSpaces } = await serviceClient
      .from("floorplan_pipeline_spaces")
      .select("id")
      .eq("pipeline_id", pipeline_id)
      .eq("is_excluded", false)
      .eq("include_in_generation", true);

    const activeSpaceIds = (activeSpaces || []).map(s => s.id);

    const { data: renders } = await serviceClient
      .from("floorplan_space_renders")
      .select("space_id, kind, locked_approved")
      .eq("pipeline_id", pipeline_id)
      .in("space_id", activeSpaceIds);

    // Check gate: All renders must be approved
    const rendersBySpace: Record<string, { A?: boolean; B?: boolean }> = {};
    for (const r of renders || []) {
      if (!rendersBySpace[r.space_id]) rendersBySpace[r.space_id] = {};
      rendersBySpace[r.space_id][r.kind as "A" | "B"] = r.locked_approved;
    }

    const spacesWithUnapprovedRenders = activeSpaceIds.filter(
      id => !rendersBySpace[id]?.A || !rendersBySpace[id]?.B
    );

    if (spacesWithUnapprovedRenders.length > 0) {
      console.log(`[batch-panoramas] Gate failed: ${spacesWithUnapprovedRenders.length} spaces with unapproved renders`);
      
      await serviceClient
        .from("floorplan_pipelines")
        .update({ 
          whole_apartment_phase: "renders_review",
          last_error: `Cannot start panoramas: ${spacesWithUnapprovedRenders.length} spaces have unapproved renders`,
        })
        .eq("id", pipeline_id);

      return new Response(
        JSON.stringify({
          success: false,
          error: "Gate check failed",
          blocked_spaces: spacesWithUnapprovedRenders.length,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch pending panoramas (including qa_retry for auto-retry support)
    const { data: panoramas } = await serviceClient
      .from("floorplan_space_panoramas")
      .select("*, source_render_id")
      .eq("pipeline_id", pipeline_id)
      .eq("owner_id", userId)
      .eq("locked_approved", false)
      .in("status", ["pending", "rejected", "failed", "qa_retry"]);

    // Filter out panoramas that have exceeded max attempts
    const pendingPanoramas = (panoramas || []).filter(
      p => (p.attempt_count || 0) < QA_CONFIG.MAX_ATTEMPTS
    );
    
    const blockedPanoramas = (panoramas || []).filter(
      p => (p.attempt_count || 0) >= QA_CONFIG.MAX_ATTEMPTS
    );
    
    console.log(`[batch-panoramas] Found ${pendingPanoramas.length} pending, ${blockedPanoramas.length} blocked (max attempts)`);

    if (pendingPanoramas.length === 0) {
      // Check if any are blocked for human review
      if (blockedPanoramas.length > 0) {
        await serviceClient
          .from("floorplan_pipelines")
          .update({ 
            whole_apartment_phase: "panoramas_review",
            last_error: `${blockedPanoramas.length} panoramas require manual review (max ${QA_CONFIG.MAX_ATTEMPTS} attempts reached)`,
          })
          .eq("id", pipeline_id);

        return new Response(
          JSON.stringify({
            success: false,
            message: `${blockedPanoramas.length} panoramas blocked for manual review`,
            blocked_count: blockedPanoramas.length,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      await serviceClient
        .from("floorplan_pipelines")
        .update({ whole_apartment_phase: "panoramas_review" })
        .eq("id", pipeline_id);

      return new Response(
        JSON.stringify({
          success: true,
          message: "No pending panoramas found",
          processed: 0,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Mark all as queued
    const panoIds = pendingPanoramas.map(p => p.id);
    await serviceClient
      .from("floorplan_space_panoramas")
      .update({ status: "queued" })
      .in("id", panoIds);

    // Process in background with auto-retry loop
    const processPanoramas = async () => {
      let completed = 0;
      let failed = 0;
      let retriesTriggered = 0;

      for (let i = 0; i < pendingPanoramas.length; i += BATCH_SIZE) {
        const batch = pendingPanoramas.slice(i, i + BATCH_SIZE);
        
        const batchPromises = batch.map(async (pano) => {
          try {
            const response = await fetch(
              `${SUPABASE_URL}/functions/v1/run-space-panorama`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: authHeader,
                },
                body: JSON.stringify({
                  panorama_id: pano.id,
                  source_render_id: pano.source_render_id,
                }),
              }
            );

            if (response.ok) {
              const result = await response.json();
              
              if (result.needs_retry) {
                // Schedule retry with exponential backoff
                retriesTriggered++;
                const delayMs = Math.min(2000 * Math.pow(2, (pano.attempt_count || 0)), 30000);
                
                console.log(`[batch-panoramas] Panorama ${pano.id} needs retry, scheduling in ${delayMs}ms`);
                
                // Add to pending list for next batch iteration
                pendingPanoramas.push({
                  ...pano,
                  attempt_count: (pano.attempt_count || 0) + 1,
                  _retry_delay: delayMs,
                });
              } else if (result.status === "needs_review" || result.status === "blocked_for_human") {
                completed++;
              }
              
              console.log(`[batch-panoramas] Panorama ${pano.id} result: ${result.status}`);
            } else {
              failed++;
              const errorText = await response.text();
              console.error(`[batch-panoramas] Panorama ${pano.id} failed: ${errorText}`);
            }
          } catch (error) {
            failed++;
            console.error(`[batch-panoramas] Panorama ${pano.id} error:`, error);
          }
        });

        await Promise.all(batchPromises);
        
        // Small delay between batches
        if (i + BATCH_SIZE < pendingPanoramas.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      // Update pipeline phase
      const { data: allPanos } = await serviceClient
        .from("floorplan_space_panoramas")
        .select("status, locked_approved, attempt_count")
        .eq("pipeline_id", pipeline_id);

      const allApproved = allPanos?.every(p => p.locked_approved);
      const anyNeedsReview = allPanos?.some(p => p.status === "needs_review" || p.status === "blocked_for_human");
      const anyBlocked = allPanos?.some(p => (p.attempt_count || 0) >= QA_CONFIG.MAX_ATTEMPTS && !p.locked_approved);

      if (allApproved) {
        await serviceClient
          .from("floorplan_pipelines")
          .update({ whole_apartment_phase: "merging_pending" })
          .eq("id", pipeline_id);
      } else if (anyNeedsReview || anyBlocked || completed > 0) {
        await serviceClient
          .from("floorplan_pipelines")
          .update({ 
            whole_apartment_phase: "panoramas_review",
            last_error: anyBlocked ? `Some panoramas require manual review` : null,
          })
          .eq("id", pipeline_id);
      }

      console.log(`[batch-panoramas] Completed: ${completed}, Failed: ${failed}, Retries: ${retriesTriggered}`);
    };

    EdgeRuntime.waitUntil(processPanoramas());

    return new Response(
      JSON.stringify({
        success: true,
        message: `Started processing ${pendingPanoramas.length} panoramas (max ${QA_CONFIG.MAX_ATTEMPTS} attempts each)`,
        total_panoramas: pendingPanoramas.length,
        blocked_for_review: blockedPanoramas.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[batch-panoramas] Error: ${message}`);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});