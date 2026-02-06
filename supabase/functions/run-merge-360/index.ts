import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import { 
  QA_CONFIG, 
  runQACheck, 
  evaluateRetryDecision, 
  persistAttempt,
  QAResult 
} from "../_shared/space-qa-workflow.ts";
import { 
  fetchLearningContext, 
  formatLearningContextForPrompt,
  buildAutoFixPromptDelta 
} from "../_shared/qa-learning-injector.ts";
import { SpatialMap } from "../_shared/camera-context-builder.ts";
import {
  wrapModelGeneration,
  ensurePipelineTrace,
  logSimpleGeneration,
  flushLangfuse,
} from "../_shared/langfuse-generation-wrapper.ts";
import { STEP_7_GENERATIONS } from "../_shared/langfuse-constants.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const API_NANOBANANA = Deno.env.get("API_NANOBANANA")!;

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// ═══════════════════════════════════════════════════════════════════════════
// MERGE PROMPT - Camera/Space Binding Enforced
// ═══════════════════════════════════════════════════════════════════════════
const MERGE_PROMPT_BASE = `You are merging TWO 360° panoramas of the SAME SPACE into ONE complete, seamless 360° panorama.

SPACE BINDING (CRITICAL):
Space Name: {space_name}
Space Type: {space_type}
Both panoramas MUST represent the same room. DO NOT mix content from different rooms.

CRITICAL RULES:
1. EVIDENCE-BASED ONLY: Use ONLY what is visible in the two source panoramas
2. NO INVENTION: Do not add any furniture, objects, or architectural elements not present in sources
3. SEAMLESS STITCHING: The merged panorama must have no visible seams or duplicated elements
4. CONSISTENT LIGHTING: Blend lighting naturally between the two views
5. GEOMETRY ALIGNMENT: Wall lines, floor patterns, and ceiling must align perfectly
6. OUTPUT: Single 2:1 equirectangular panorama covering the full 360°

The two panoramas represent opposite viewing directions within the same room:
- Panorama A: Primary view direction
- Panorama B: Opposite view direction (180° rotated)

{ADDITIONAL_CONSTRAINTS}

Merge these into a single cohesive 360° panorama that a viewer could rotate through naturally.`;

async function fetchImageAsBase64(supabase: any, uploadId: string): Promise<{ base64: string; mimeType: string }> {
  const { data: upload } = await supabase
    .from("uploads")
    .select("*")
    .eq("id", uploadId)
    .single();

  if (!upload) throw new Error(`Upload not found: ${uploadId}`);

  const { data: fileData } = await supabase.storage
    .from(upload.bucket)
    .download(upload.path);

  if (!fileData) throw new Error("Failed to download");

  const arrayBuffer = await fileData.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  return { base64: encodeBase64(uint8Array), mimeType: upload.mime_type || "image/jpeg" };
}

async function emitEvent(
  serviceClient: any,
  pipelineId: string,
  ownerId: string,
  type: string,
  message: string,
  progressInt: number = 0
) {
  try {
    await serviceClient.from("floorplan_pipeline_events").insert({
      pipeline_id: pipelineId,
      owner_id: ownerId,
      step_number: 7, // Merge is Step 7
      type,
      message,
      progress_int: progressInt,
    });
  } catch (err) {
    console.error(`[merge-360] Failed to emit event: ${err}`);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData } = await supabase.auth.getUser(token);
    if (!claimsData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.user.id;

    const { final360_id, panorama_a_id, panorama_b_id, merge_instructions, merge_quality } = await req.json();

    if (!final360_id || !panorama_a_id || !panorama_b_id) {
      return new Response(
        JSON.stringify({ error: "Missing required IDs" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Fetch final360 record with space info
    const { data: final360 } = await serviceClient
      .from("floorplan_space_final360")
      .select(`*, space:floorplan_pipeline_spaces(*)`)
      .eq("id", final360_id)
      .eq("owner_id", userId)
      .single();

    if (!final360) {
      return new Response(JSON.stringify({ error: "Final360 not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (final360.locked_approved) {
      return new Response(
        JSON.stringify({ error: "Final 360 is locked" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch both panoramas
    const { data: panoA } = await serviceClient
      .from("floorplan_space_panoramas")
      .select("*")
      .eq("id", panorama_a_id)
      .single();

    const { data: panoB } = await serviceClient
      .from("floorplan_space_panoramas")
      .select("*")
      .eq("id", panorama_b_id)
      .single();

    if (!panoA?.output_upload_id || !panoB?.output_upload_id) {
      return new Response(
        JSON.stringify({ error: "Both panoramas must have outputs" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get current attempt count
    const currentAttempt = (final360.attempt_count || 0) + 1;
    const spaceName = final360.space?.name || "Room";
    const spaceType = final360.space?.space_type || "room";
    const pipelineId = final360.pipeline_id;

    console.log(`[merge-360] Starting attempt ${currentAttempt}/${QA_CONFIG.MAX_ATTEMPTS} for final360 ${final360_id}`);
    console.log(`[merge-360] Space: ${spaceName} (${spaceType})`);

    // Update status
    await serviceClient
      .from("floorplan_space_final360")
      .update({ 
        status: "merging",
        attempt_count: currentAttempt,
      })
      .eq("id", final360_id);

    await serviceClient
      .from("floorplan_pipeline_spaces")
      .update({ final_360_status: "merging" })
      .eq("id", final360.space_id);

    await emitEvent(serviceClient, pipelineId, userId, "merge_start",
      `🔀 Merging panoramas for ${spaceName} (attempt ${currentAttempt}/${QA_CONFIG.MAX_ATTEMPTS})`, 10);

    // Fetch pipeline for quality and project settings
    const { data: pipelineConfig } = await serviceClient
      .from("floorplan_pipelines")
      .select("output_resolution, quality_post_step4, project_id, floor_plan_upload_id")
      .eq("id", pipelineId)
      .single();

    // ═══════════════════════════════════════════════════════════════════════
    // LANGFUSE: Ensure pipeline trace exists (after pipelineConfig is fetched)
    // ═══════════════════════════════════════════════════════════════════════
    await ensurePipelineTrace(pipelineId, pipelineConfig?.project_id || pipelineId, userId, {
      step_number: 7,
      sub_step: "merge_360",
      space_name: spaceName,
      space_type: spaceType,
    });

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 7 QUALITY GATE: Use merge_quality if provided (from Step7PreRunSettings)
    // ═══════════════════════════════════════════════════════════════════════
    const requestedQuality = merge_quality || pipelineConfig?.quality_post_step4 || "2K";
    const validSizes = ["1K", "2K", "4K"];
    const imageSize = validSizes.includes(requestedQuality) ? requestedQuality : "2K";

    console.log(`[merge-360] Using quality: ${imageSize} (requested: ${merge_quality})`);

    // ═══════════════════════════════════════════════════════════════════════
    // LOAD SPATIAL MAP FOR ARCHITECTURAL QA
    // ═══════════════════════════════════════════════════════════════════════
    let spatialMap: SpatialMap | null = null;
    let floorPlanBase64: string | undefined;
    let floorPlanMimeType: string | undefined;
    
    // Load spatial map for adjacency context
    const { data: spatialMapData } = await serviceClient
      .from("pipeline_spatial_maps")
      .select("*")
      .eq("pipeline_id", pipelineId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    
    if (spatialMapData) {
      spatialMap = {
        id: spatialMapData.id,
        pipeline_id: spatialMapData.pipeline_id,
        version: spatialMapData.version || 1,
        rooms: (spatialMapData.rooms as any[]) || [],
        adjacency_graph: (spatialMapData.adjacency_graph as any[]) || [],
        locks_json: (spatialMapData.locks_json as any) || {},
      } as SpatialMap;
      console.log(`[merge-360] Loaded spatial map v${spatialMap.version}`);
    }
    
    // Load floor plan for architectural QA
    if (pipelineConfig?.floor_plan_upload_id) {
      try {
        const fpData = await fetchImageAsBase64(serviceClient, pipelineConfig.floor_plan_upload_id);
        floorPlanBase64 = fpData.base64;
        floorPlanMimeType = fpData.mimeType;
        console.log(`[merge-360] Loaded floor plan for QA`);
      } catch (e) {
        console.error(`[merge-360] Failed to load floor plan: ${e}`);
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // FETCH LEARNING CONTEXT FOR QA
    // ═══════════════════════════════════════════════════════════════════════
    const learningContext = await fetchLearningContext(
      serviceClient,
      pipelineConfig?.project_id || "",
      7, // Step 7 = Merge
      userId
    );
    const learningContextFormatted = formatLearningContextForPrompt(learningContext);

    // Fetch both panorama images
    const { base64: panoABase64, mimeType: mimeTypeA } = await fetchImageAsBase64(serviceClient, panoA.output_upload_id);
    const { base64: panoBBase64, mimeType: mimeTypeB } = await fetchImageAsBase64(serviceClient, panoB.output_upload_id);

    // ═══════════════════════════════════════════════════════════════════════
    // BUILD PROMPT WITH SPACE BINDING
    // ═══════════════════════════════════════════════════════════════════════
    let additionalConstraints = "";
    
    // If this is a retry, add auto-fix constraints
    if (currentAttempt > 1 && final360.qa_report) {
      const retryDelta = buildAutoFixPromptDelta(final360.qa_report, learningContext, currentAttempt);
      if (retryDelta.promptAdjustments.length > 0) {
        additionalConstraints = "\nRETRY CONSTRAINTS (from previous failure):\n" + 
          retryDelta.promptAdjustments.map(a => `- ${a}`).join("\n");
      }
    }

    // Add user merge instructions if provided
    if (merge_instructions) {
      additionalConstraints += `\n\nUSER INSTRUCTIONS:\n${merge_instructions}`;
    }

    const prompt = MERGE_PROMPT_BASE
      .replace("{space_name}", spaceName)
      .replace("{space_type}", spaceType)
      .replace("{ADDITIONAL_CONSTRAINTS}", additionalConstraints);

    // Call Gemini 3 Pro Image Preview with Langfuse logging
    const geminiUrl = `${GEMINI_API_BASE}/gemini-3-pro-image-preview:generateContent?key=${API_NANOBANANA}`;

    console.log(`[merge-360] Calling API with quality: ${imageSize}`);

    // ═══════════════════════════════════════════════════════════════════════
    // LANGFUSE: Wrap model call with generation logging
    // ═══════════════════════════════════════════════════════════════════════
    const generationResult = await wrapModelGeneration({
      traceId: pipelineId,
      generationName: STEP_7_GENERATIONS.MERGE_PANOS,
      model: "gemini-3-pro-image-preview",
      metadata: {
        project_id: pipelineConfig?.project_id || pipelineId,
        pipeline_id: pipelineId,
        step_number: 7,
        sub_step: "merge_360",
        room_id: final360.space_id,
        room_name: spaceName,
        attempt_index: currentAttempt,
        model_name: "gemini-3-pro-image-preview",
      },
      promptInfo: {
        name: "merge_prompt_base",
        source: "code",
      },
      finalPromptText: prompt,
      variables: {
        space_name: spaceName,
        space_type: spaceType,
        image_size: imageSize,
        has_merge_instructions: !!merge_instructions,
      },
      requestParams: {
        temperature: currentAttempt > 2 ? 0.3 : 0.5,
        imageSize,
        aspectRatio: "2:1",
      },
      imageCount: 2,
    }, async () => {
      const geminiResponse = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inlineData: { mimeType: mimeTypeA, data: panoABase64 } },
              { inlineData: { mimeType: mimeTypeB, data: panoBBase64 } },
            ],
          }],
          generationConfig: {
            responseModalities: ["IMAGE"],
            temperature: currentAttempt > 2 ? 0.3 : 0.5,
            imageConfig: {
              aspectRatio: "2:1",
              imageSize: imageSize,
            },
          },
        }),
      });

      if (!geminiResponse.ok) {
        const errorText = await geminiResponse.text();
        throw new Error(`Gemini error: ${geminiResponse.status} - ${errorText}`);
      }

      return await geminiResponse.json();
    });

    if (!generationResult.success) {
      throw generationResult.error || new Error("Merge generation failed");
    }

    const geminiData = generationResult.data;
    let generatedImageData: string | null = null;
    let generatedMimeType = "image/png";

    for (const candidate of geminiData?.candidates || []) {
      for (const part of candidate.content?.parts || []) {
        if (part.inlineData?.data) {
          generatedImageData = part.inlineData.data;
          generatedMimeType = part.inlineData.mimeType || "image/png";
          break;
        }
      }
      if (generatedImageData) break;
    }

    if (!generatedImageData) {
      throw new Error("No merged panorama generated");
    }

    // ═══════════════════════════════════════════════════════════════════════
    // RUN QA WITH LEARNING CONTEXT + ARCHITECTURAL VALIDATION
    // ═══════════════════════════════════════════════════════════════════════
    await emitEvent(serviceClient, pipelineId, userId, "merge_qa",
      `🔍 Running QA check for ${spaceName} merged 360...`, 70);

    const qaResult = await runQACheck({
      imageBase64: generatedImageData,
      mimeType: generatedMimeType,
      qaType: "MERGE",
      spaceContext: {
        space_name: spaceName,
        space_type: spaceType,
        space_id: final360.space_id,
      },
      learningContext: learningContextFormatted,
      apiKey: API_NANOBANANA,
      // NEW: Architectural context for Steps 5-7 QA
      architecturalContext: {
        floorPlanBase64,
        floorPlanMimeType,
        cameraMarker: null, // Merge doesn't have single camera
        spatialMap,
        stepNumber: 7,
      },
    });

    console.log(`[merge-360] QA result: pass=${qaResult.pass}, score=${qaResult.overall_score}`);
    if (qaResult.architectural_validation) {
      console.log(`[merge-360] Architectural validation:`, qaResult.architectural_validation);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // LANGFUSE: Log QA result as a generation
    // ═══════════════════════════════════════════════════════════════════════
    await logSimpleGeneration({
      traceId: pipelineId,
      name: STEP_7_GENERATIONS.QA_JUDGE,
      model: "gemini-2.5-pro",
      input: {
        pipeline_id: pipelineId,
        step_number: 7,
        sub_step: "qa_judge",
        qa_type: "MERGE",
        space_name: spaceName,
        space_type: spaceType,
        attempt_index: currentAttempt,
      },
      output: {
        pass: qaResult.pass,
        overall_score: qaResult.overall_score,
        issues: qaResult.issues || [],
        recommended_action: qaResult.recommended_action,
        architectural_validation: qaResult.architectural_validation,
        corrected_instructions: qaResult.corrected_instructions,
      },
      metadata: {
        project_id: pipelineConfig?.project_id || pipelineId,
        pipeline_id: pipelineId,
        step_number: 7,
        sub_step: "qa_judge",
        room_id: final360.space_id,
        room_name: spaceName,
        attempt_index: currentAttempt,
      },
    });

    // Upload
    const ext = generatedMimeType.includes("png") ? "png" : "jpg";
    const outputPath = `${userId}/space_final360/${final360_id}_attempt${currentAttempt}_${Date.now()}.${ext}`;
    const imageBytes = Uint8Array.from(atob(generatedImageData), (c) => c.charCodeAt(0));

    await serviceClient.storage.from("outputs").upload(outputPath, imageBytes, {
      contentType: generatedMimeType, upsert: true,
    });

    const { data: uploadRecord } = await serviceClient
      .from("uploads")
      .insert({
        project_id: pipelineConfig?.project_id,
        owner_id: userId,
        kind: "output",
        bucket: "outputs",
        path: outputPath,
        original_filename: `final_360_${spaceName}_attempt${currentAttempt}.${ext}`,
        mime_type: generatedMimeType,
        size_bytes: imageBytes.length,
      })
      .select()
      .single();

    // ═══════════════════════════════════════════════════════════════════════
    // PERSIST ATTEMPT FOR HISTORY
    // ═══════════════════════════════════════════════════════════════════════
    await persistAttempt(serviceClient, {
      pipelineId,
      stepNumber: 7,
      assetType: "final360",
      assetId: final360_id,
      attemptIndex: currentAttempt,
      outputUploadId: uploadRecord?.id || null,
      qaResult,
      promptUsed: prompt,
      modelUsed: "gemini-3-pro-image-preview",
      settingsUsed: { imageSize, temperature: currentAttempt > 2 ? 0.3 : 0.5, merge_quality: imageSize },
    }, userId);

    // ═══════════════════════════════════════════════════════════════════════
    // DECIDE NEXT ACTION
    // ═══════════════════════════════════════════════════════════════════════
    let finalStatus: string;
    let shouldAutoRetry = false;

    if (qaResult.pass) {
      finalStatus = "needs_review";
      await emitEvent(serviceClient, pipelineId, userId, "merge_qa_pass",
        `✅ Merged 360 for ${spaceName} passed QA (score: ${qaResult.overall_score})`, 90);
    } else {
      const retryDecision = evaluateRetryDecision(qaResult, currentAttempt, learningContext);
      
      if (retryDecision.shouldRetry) {
        finalStatus = "qa_retry";
        shouldAutoRetry = true;
        await emitEvent(serviceClient, pipelineId, userId, "merge_qa_retry",
          `🔄 Merge failed QA, auto-retrying (attempt ${currentAttempt}/${QA_CONFIG.MAX_ATTEMPTS})`, 50);
      } else {
        finalStatus = "blocked_for_human";
        await emitEvent(serviceClient, pipelineId, userId, "merge_blocked",
          `⚠️ Merged 360 requires manual review: ${retryDecision.reason}`, 80);
      }
    }

    // Update final360 record
    await serviceClient
      .from("floorplan_space_final360")
      .update({
        status: finalStatus,
        output_upload_id: uploadRecord?.id,
        merge_instructions: merge_instructions || null,
        model: "gemini-3-pro-image-preview",
        attempt_count: currentAttempt,
        qa_status: qaResult.pass ? "passed" : "failed",
        qa_report: qaResult,
        structured_qa_result: qaResult,
        panorama_a_id,
        panorama_b_id,
      })
      .eq("id", final360_id);

    await serviceClient
      .from("floorplan_pipeline_spaces")
      .update({ final_360_status: finalStatus })
      .eq("id", final360.space_id);

    console.log(`[merge-360] Merge completed with status: ${finalStatus}`);

    // CRITICAL: Flush Langfuse events before returning
    await flushLangfuse();

    return new Response(
      JSON.stringify({
        success: true,
        final360_id,
        output_upload_id: uploadRecord?.id,
        status: finalStatus,
        attempt: currentAttempt,
        max_attempts: QA_CONFIG.MAX_ATTEMPTS,
        qa_result: qaResult,
        quality_used: imageSize,
        needs_retry: shouldAutoRetry,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[merge-360] Error: ${message}`);
    
    // Flush Langfuse even on error
    await flushLangfuse();
    
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
