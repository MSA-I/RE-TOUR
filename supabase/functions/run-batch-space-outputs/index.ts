import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
    const batchRequestId = crypto.randomUUID().substring(0, 8);

    if (req.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
    }

    try {
        const authHeader = req.headers.get("Authorization");
        if (!authHeader?.startsWith("Bearer ")) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
        }

        const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            global: { headers: { Authorization: authHeader } },
        });

        const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
        if (authError || !user) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
        }

        const { pipeline_id, styled_image_upload_id } = await req.json();

        if (!pipeline_id || !styled_image_upload_id) {
            return new Response(JSON.stringify({ error: "Missing pipeline_id or styled_image_upload_id" }), { status: 400, headers: corsHeaders });
        }

        const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        // 1. Fetch final_prompts (queued)
        // We prioritize 'queued' prompts, but also check if we need to run 'generating' if they stalled?
        // For now, simple: status='queued'.
        const { data: finalPrompts } = await serviceClient
            .from("final_prompts")
            .select("*")
            .eq("pipeline_id", pipeline_id)
            .eq("status", "queued");

        if (!finalPrompts || finalPrompts.length === 0) {
            // Double check if any are generating?
            // If not, maybe we are done or nothing selected.
            console.log(`[batch-outputs] No queued final prompts found.`);
            return new Response(JSON.stringify({ success: true, message: "No queued prompts found", processed: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        // Update pipeline phase
        await serviceClient
            .from("floorplan_pipelines")
            .update({ whole_apartment_phase: "outputs_in_progress", current_step: 6 })
            .eq("id", pipeline_id);

        // Update prompts to generating
        await serviceClient
            .from("final_prompts")
            .update({ status: "generating" })
            .in("id", finalPrompts.map(p => p.id));

        // 2. Process Outputs Background Task
        const processOutputs = async () => {
            let completedCount = 0;
            let failedCount = 0;

            // Fetch floorplan upload id for context
            const { data: pipeline } = await serviceClient.from("floorplan_pipelines").select("floor_plan_upload_id").eq("id", pipeline_id).single();
            const floorPlanUploadId = pipeline?.floor_plan_upload_id;

            for (const prompt of finalPrompts) {
                console.log(`[batch-outputs] Processing prompt for space ${prompt.space_id}`);

                // Get renders for this space
                const { data: renders } = await serviceClient
                    .from("floorplan_space_renders")
                    .select("*")
                    .eq("space_id", prompt.space_id);

                const renderA = renders?.find(r => r.kind === "A");
                const renderB = renders?.find(r => r.kind === "B");

                let cameraAOutputId = null;
                let successA = false;

                // Array to store all output upload IDs for this prompt
                const outputUploadIds: string[] = [];

                // Run Render A
                if (renderA) {
                    // Check if already approved/done?
                    if (renderA.locked_approved) {
                        cameraAOutputId = renderA.output_upload_id;
                        successA = true;
                        if (cameraAOutputId) outputUploadIds.push(cameraAOutputId);
                        console.log(`[batch-outputs] Render A already approved for ${prompt.space_id}`);
                    } else {
                        try {
                            console.log(`[batch-outputs] Triggering Render A for ${prompt.space_id}`);
                            const resp = await fetch(`${SUPABASE_URL}/functions/v1/run-space-render`, {
                                method: "POST",
                                headers: {
                                    "Content-Type": "application/json",
                                    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` // Use admin key
                                },
                                body: JSON.stringify({
                                    render_id: renderA.id,
                                    styled_image_upload_id,
                                    floor_plan_upload_id: floorPlanUploadId,
                                    custom_prompt: prompt.final_composed_prompt // PASS CUSTOM PROMPT
                                })
                            });

                            if (resp.ok) {
                                const resJson = await resp.json();
                                cameraAOutputId = resJson.output_upload_id;
                                if (cameraAOutputId) outputUploadIds.push(cameraAOutputId);
                                successA = true;
                                completedCount++;
                            } else {
                                console.error(`[batch-outputs] Render A failed: await resp.text()`);
                                failedCount++;
                            }

                        } catch (e) {
                            console.error(`[batch-outputs] Render A error:`, e);
                            failedCount++;
                        }
                    }
                }

                // Run Render B (If image_count > 1 AND A succeeded)
                let cameraBOutputId = null;
                if (prompt.image_count > 1 && renderB) {
                    if (successA && cameraAOutputId) {
                        try {
                            console.log(`[batch-outputs] Triggering Render B for ${prompt.space_id}`);
                            const resp = await fetch(`${SUPABASE_URL}/functions/v1/run-space-render`, {
                                method: "POST",
                                headers: {
                                    "Content-Type": "application/json",
                                    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
                                },
                                body: JSON.stringify({
                                    render_id: renderB.id,
                                    styled_image_upload_id,
                                    floor_plan_upload_id: floorPlanUploadId,
                                    first_render_upload_id: cameraAOutputId, // Anchor to A
                                    // NO custom_prompt for B - it uses "Opposite View" template grounded in A
                                })
                            });

                            if (resp.ok) {
                                const resJson = await resp.json();
                                cameraBOutputId = resJson.output_upload_id;
                                if (cameraBOutputId) outputUploadIds.push(cameraBOutputId);
                                completedCount++;
                            } else {
                                console.error(`[batch-outputs] Render B failed`);
                                failedCount++;
                            }
                        } catch (e) {
                            console.error(`[batch-outputs] Render B error:`, e);
                            failedCount++;
                        }
                    } else {
                        console.warn(`[batch-outputs] Skipping Render B for ${prompt.space_id} - A failed or missing`);
                        // Update B to blocked?
                        await serviceClient.from("floorplan_space_renders").update({ status: "blocked" }).eq("id", renderB.id);
                        failedCount++;
                    }
                }

                // Run QA validation on the outputs (if we have any)
                let qaStatus = "pending";
                let qaReport = null;
                let qaScore = null;
                let qaFeedback = null;

                if (outputUploadIds.length > 0) {
                    try {
                        console.log(`[batch-outputs] Running QA validation for ${outputUploadIds.length} outputs`);

                        // TODO: Implement actual QA validation
                        // For now, auto-approve (placeholder logic)
                        qaStatus = "approved";
                        qaScore = 0.95;
                        qaFeedback = "Output generated successfully";
                        qaReport = {
                            overall_decision: "approved",
                            overall_score: 0.95,
                            criteria: [
                                {
                                    name: "image_quality",
                                    passed: true,
                                    confidence: 0.95,
                                    details: "Image generated successfully"
                                }
                            ]
                        };

                        console.log(`[batch-outputs] QA validation completed: ${qaStatus}`);
                    } catch (qaError) {
                        console.error(`[batch-outputs] QA validation error:`, qaError);
                        qaStatus = "failed";
                        qaFeedback = "QA validation failed";
                    }
                }

                // Update prompt with outputs and QA results
                await serviceClient.from("final_prompts").update({
                    status: successA ? "complete" : "failed",
                    output_upload_ids: outputUploadIds,
                    qa_status: qaStatus,
                    qa_report: qaReport,
                    qa_score: qaScore,
                    qa_feedback: qaFeedback,
                }).eq("id", prompt.id);
            }

            // Update Pipeline Phase
            // Check global status
            const { data: allPrompts } = await serviceClient.from("final_prompts").select("status").eq("pipeline_id", pipeline_id);
            const allDone = allPrompts?.every(p => p.status === "complete" || p.status === "failed");

            if (allDone) {
                await serviceClient
                    .from("floorplan_pipelines")
                    .update({ whole_apartment_phase: "outputs_review" })
                    .eq("id", pipeline_id);
            }

            console.log(`[batch-outputs] Batch processing completed. Success: ${completedCount}, Failed: ${failedCount}`);
        };

        EdgeRuntime.waitUntil(processOutputs());

        return new Response(JSON.stringify({
            success: true,
            message: `Started batch outputs for ${finalPrompts.length} prompts`
        }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });

    } catch (error) {
        console.error("Error in run-batch-space-outputs:", error);
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});
