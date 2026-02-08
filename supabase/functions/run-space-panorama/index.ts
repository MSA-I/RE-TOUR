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
import { SpatialMap, CameraMarker } from "../_shared/camera-context-builder.ts";
import {
  wrapModelGeneration,
  ensurePipelineTrace,
  logSimpleGeneration,
  flushLangfuse,
} from "../_shared/langfuse-generation-wrapper.ts";
import { STEP_6_GENERATIONS } from "../_shared/langfuse-constants.ts";

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
// PROMPT TEMPLATE - Camera/Space Binding Enforced
// ═══════════════════════════════════════════════════════════════════════════
const PANORAMA_PROMPT_BASE = `Convert this eye-level interior render into a complete 360° equirectangular panorama.

CAMERA/SPACE BINDING (CRITICAL):
Space: {space_name} ({space_type})
Camera View: {camera_kind} ({camera_kind === "A" ? "Primary view" : "Opposite angle"})
Camera Position: ({x_norm}, {y_norm})
Yaw Direction: {yaw_deg}°

CRITICAL REQUIREMENTS:
1. OUTPUT FORMAT: Full 360° equirectangular projection with 2:1 aspect ratio
2. PRESERVE EXACTLY: All furniture, materials, colors, and lighting from the source image
3. EXTEND NATURALLY: Continue the room geometry in all directions based on visible architectural cues
4. NO HALLUCINATION: Do not invent furniture or objects not implied by the source
5. HORIZON LINE: Must be perfectly centered and continuous
6. SEAMLESS: Left and right edges must connect seamlessly

{ADDITIONAL_CONSTRAINTS}

Generate a single 360° equirectangular panorama that wraps around naturally from the provided perspective.`;

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

  if (!fileData) throw new Error("Failed to download image");

  const arrayBuffer = await fileData.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  const base64 = encodeBase64(uint8Array);

  return { base64, mimeType: upload.mime_type || "image/jpeg" };
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
      step_number: 6, // Panoramas are Step 6
      type,
      message,
      progress_int: progressInt,
    });
  } catch (err) {
    console.error(`[space-panorama] Failed to emit event: ${err}`);
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

    const { panorama_id, source_render_id } = await req.json();

    if (!panorama_id || !source_render_id) {
      return new Response(
        JSON.stringify({ error: "Missing panorama_id or source_render_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Fetch panorama record with space and camera info
    const { data: panorama } = await serviceClient
      .from("floorplan_space_panoramas")
      .select(`
        *, 
        space:floorplan_pipeline_spaces(*),
        camera:pipeline_camera_markers(*)
      `)
      .eq("id", panorama_id)
      .eq("owner_id", userId)
      .single();

    if (!panorama) {
      return new Response(JSON.stringify({ error: "Panorama not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (panorama.locked_approved) {
      return new Response(
        JSON.stringify({ error: "Panorama is locked" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch source render
    const { data: render } = await serviceClient
      .from("floorplan_space_renders")
      .select("*, camera:pipeline_camera_markers(*)")
      .eq("id", source_render_id)
      .single();

    if (!render?.output_upload_id) {
      return new Response(
        JSON.stringify({ error: "Source render has no output" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get current attempt count
    const currentAttempt = (panorama.attempt_count || 0) + 1;
    const spaceName = panorama.space?.name || "Room";
    const spaceType = panorama.space?.space_type || "room";
    const pipelineId = panorama.pipeline_id;
    
    // Camera binding info
    const camera = render.camera || panorama.camera;
    const xNorm = camera?.x_norm || 0.5;
    const yNorm = camera?.y_norm || 0.5;
    const yawDeg = camera?.yaw_deg || 0;

    // ═══════════════════════════════════════════════════════════════════════
    // LANGFUSE: Ensure pipeline trace exists
    // ═══════════════════════════════════════════════════════════════════════
    await ensurePipelineTrace(pipelineId, panorama.space?.pipeline_id || pipelineId, userId, {
      step_number: 6,
      sub_step: "panorama_generation",
      space_name: spaceName,
      space_type: spaceType,
    });

    console.log(`[space-panorama] Starting attempt ${currentAttempt}/${QA_CONFIG.MAX_ATTEMPTS} for panorama ${panorama_id}`);
    console.log(`[space-panorama] Space: ${spaceName} (${spaceType}), Camera: (${xNorm}, ${yNorm}), Yaw: ${yawDeg}°`);

    // Update status
    await serviceClient
      .from("floorplan_space_panoramas")
      .update({ 
        status: "generating",
        attempt_count: currentAttempt,
      })
      .eq("id", panorama_id);

    const statusField = panorama.kind === "A" ? "panorama_a_status" : "panorama_b_status";
    await serviceClient
      .from("floorplan_pipeline_spaces")
      .update({ [statusField]: "generating" })
      .eq("id", panorama.space_id);

    await emitEvent(serviceClient, pipelineId, userId, "panorama_start",
      `🎯 Generating panorama ${panorama.kind} for ${spaceName} (attempt ${currentAttempt}/${QA_CONFIG.MAX_ATTEMPTS})`, 10);

    // Fetch pipeline for quality and project settings
    const { data: pipelineConfig } = await serviceClient
      .from("floorplan_pipelines")
      .select("output_resolution, quality_post_step4, project_id, floor_plan_upload_id")
      .eq("id", pipelineId)
      .single();

    const qualityPostStep4 = pipelineConfig?.quality_post_step4 || "2K";
    const validSizes = ["1K", "2K", "4K"];
    const imageSize = validSizes.includes(qualityPostStep4) ? qualityPostStep4 : "2K";

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
      console.log(`[space-panorama] Loaded spatial map v${spatialMap.version}`);
    }
    
    // Load floor plan for architectural QA
    if (pipelineConfig?.floor_plan_upload_id) {
      try {
        const fpData = await fetchImageAsBase64(serviceClient, pipelineConfig.floor_plan_upload_id);
        floorPlanBase64 = fpData.base64;
        floorPlanMimeType = fpData.mimeType;
        console.log(`[space-panorama] Loaded floor plan for QA`);
      } catch (e) {
        console.error(`[space-panorama] Failed to load floor plan: ${e}`);
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // FETCH LEARNING CONTEXT FOR QA
    // ═══════════════════════════════════════════════════════════════════════
    const learningContext = await fetchLearningContext(
      serviceClient,
      pipelineConfig?.project_id || "",
      6, // Step 6 = Panoramas
      userId
    );
    const learningContextFormatted = formatLearningContextForPrompt(learningContext);

    // Fetch render image
    const { base64: renderBase64, mimeType } = await fetchImageAsBase64(serviceClient, render.output_upload_id);

    // ═══════════════════════════════════════════════════════════════════════
    // BUILD PROMPT WITH CAMERA/SPACE BINDING
    // ═══════════════════════════════════════════════════════════════════════
    let additionalConstraints = "";
    
    // If this is a retry, add auto-fix constraints
    if (currentAttempt > 1 && panorama.qa_report) {
      const retryDelta = buildAutoFixPromptDelta(panorama.qa_report, learningContext, currentAttempt);
      if (retryDelta.promptAdjustments.length > 0) {
        additionalConstraints = "\nRETRY CONSTRAINTS (from previous failure):\n" + 
          retryDelta.promptAdjustments.map(a => `- ${a}`).join("\n");
      }
    }

    const prompt = PANORAMA_PROMPT_BASE
      .replace("{space_name}", spaceName)
      .replace("{space_type}", spaceType)
      .replaceAll("{camera_kind}", panorama.kind)
      .replace("{x_norm}", String(xNorm))
      .replace("{y_norm}", String(yNorm))
      .replace("{yaw_deg}", String(yawDeg))
      .replace("{ADDITIONAL_CONSTRAINTS}", additionalConstraints);

    // Call Gemini 3 Pro Image Preview with Langfuse logging
    const geminiUrl = `${GEMINI_API_BASE}/gemini-3-pro-image-preview:generateContent?key=${API_NANOBANANA}`;

    console.log(`[space-panorama] Calling API with quality: ${imageSize}`);

    // ═══════════════════════════════════════════════════════════════════════
    // LANGFUSE: Wrap model call with generation logging
    // ═══════════════════════════════════════════════════════════════════════
    const generationResult = await wrapModelGeneration({
      traceId: pipelineId,
      generationName: STEP_6_GENERATIONS.PANO_360_GEN,
      model: "gemini-3-pro-image-preview",
      metadata: {
        project_id: pipelineConfig?.project_id || pipelineId,
        pipeline_id: pipelineId,
        step_number: 6,
        sub_step: "panorama_generation",
        room_id: panorama.space_id,
        room_name: spaceName,
        camera_id: camera?.id,
        attempt_index: currentAttempt,
        model_name: "gemini-3-pro-image-preview",
      },
      promptInfo: {
        name: "panorama_prompt_base",
        source: "code",
      },
      finalPromptText: prompt,
      variables: {
        space_name: spaceName,
        space_type: spaceType,
        camera_kind: panorama.kind,
        x_norm: xNorm,
        y_norm: yNorm,
        yaw_deg: yawDeg,
        image_size: imageSize,
      },
      requestParams: {
        temperature: currentAttempt > 2 ? 0.3 : 0.6,
        imageSize,
        aspectRatio: "2:1",
      },
      imageCount: 1,
    }, async () => {
      const geminiResponse = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [
            { text: prompt },
            { inlineData: { mimeType, data: renderBase64 } },
          ]}],
          generationConfig: {
            responseModalities: ["IMAGE"],
            temperature: currentAttempt > 2 ? 0.3 : 0.6,
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
      throw generationResult.error || new Error("Generation failed");
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
      throw new Error("No panorama generated");
    }

    // ═══════════════════════════════════════════════════════════════════════
    // RUN QA WITH LEARNING CONTEXT + ARCHITECTURAL VALIDATION
    // ═══════════════════════════════════════════════════════════════════════
    await emitEvent(serviceClient, pipelineId, userId, "panorama_qa",
      `🔍 Running QA check for ${spaceName} panorama ${panorama.kind}...`, 70);

    const qaResult = await runQACheck({
      imageBase64: generatedImageData,
      mimeType: generatedMimeType,
      qaType: "PANORAMA",
      spaceContext: {
        space_name: spaceName,
        space_type: spaceType,
        space_id: panorama.space_id,
        camera_kind: panorama.kind,
        x_norm: xNorm,
        y_norm: yNorm,
        yaw_deg: yawDeg,
        fov_deg: camera?.fov_deg || 90,
      },
      learningContext: learningContextFormatted,
      apiKey: API_NANOBANANA,
      // NEW: Architectural context for Steps 5-7 QA
      architecturalContext: {
        floorPlanBase64,
        floorPlanMimeType,
        cameraMarker: camera as CameraMarker | null,
        spatialMap,
        stepNumber: 6,
      },
    });

    console.log(`[space-panorama] QA result: pass=${qaResult.pass}, score=${qaResult.overall_score}`);
    if (qaResult.architectural_validation) {
      console.log(`[space-panorama] Architectural validation:`, qaResult.architectural_validation);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // LANGFUSE: Log QA result as a generation
    // ═══════════════════════════════════════════════════════════════════════
    await logSimpleGeneration({
      traceId: pipelineId,
      name: STEP_6_GENERATIONS.QA_JUDGE,
      model: "gemini-2.5-pro",
      input: {
        pipeline_id: pipelineId,
        step_number: 6,
        sub_step: "qa_judge",
        qa_type: "PANORAMA",
        space_name: spaceName,
        space_type: spaceType,
        camera_kind: panorama.kind,
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
        step_number: 6,
        sub_step: "qa_judge",
        room_id: panorama.space_id,
        room_name: spaceName,
        attempt_index: currentAttempt,
      },
    });

    // Upload to storage
    const ext = generatedMimeType.includes("png") ? "png" : "jpg";
    const outputPath = `${userId}/space_panoramas/${panorama_id}_attempt${currentAttempt}_${Date.now()}.${ext}`;
    const imageBytes = Uint8Array.from(atob(generatedImageData), (c) => c.charCodeAt(0));

    await serviceClient.storage.from("outputs").upload(outputPath, imageBytes, {
      contentType: generatedMimeType, upsert: true,
    });

    // Create upload record
    const { data: uploadRecord } = await serviceClient
      .from("uploads")
      .insert({
        project_id: pipelineConfig?.project_id,
        owner_id: userId,
        kind: "output",
        bucket: "outputs",
        path: outputPath,
        original_filename: `space_panorama_${spaceName}_${panorama.kind}_attempt${currentAttempt}.${ext}`,
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
      stepNumber: 6,
      assetType: "panorama",
      assetId: panorama_id,
      attemptIndex: currentAttempt,
      outputUploadId: uploadRecord?.id || null,
      qaResult,
      promptUsed: prompt,
      modelUsed: "gemini-3-pro-image-preview",
      settingsUsed: { imageSize, temperature: currentAttempt > 2 ? 0.3 : 0.6 },
    }, userId);

    // ═══════════════════════════════════════════════════════════════════════
    // DECIDE NEXT ACTION
    // ═══════════════════════════════════════════════════════════════════════
    let finalStatus: string;
    let shouldAutoRetry = false;

    if (qaResult.pass) {
      finalStatus = "needs_review"; // AI-QA passed, awaiting manual QA
      await emitEvent(serviceClient, pipelineId, userId, "panorama_qa_pass",
        `✅ Panorama ${panorama.kind} for ${spaceName} passed QA (score: ${qaResult.overall_score})`, 90);
    } else {
      // Evaluate retry decision
      const retryDecision = evaluateRetryDecision(qaResult, currentAttempt, learningContext);
      
      if (retryDecision.shouldRetry) {
        finalStatus = "qa_retry";
        shouldAutoRetry = true;
        await emitEvent(serviceClient, pipelineId, userId, "panorama_qa_retry",
          `🔄 Panorama ${panorama.kind} failed QA, auto-retrying (attempt ${currentAttempt}/${QA_CONFIG.MAX_ATTEMPTS})`, 50);
      } else {
        finalStatus = "blocked_for_human";
        await emitEvent(serviceClient, pipelineId, userId, "panorama_blocked",
          `⚠️ Panorama ${panorama.kind} requires manual review: ${retryDecision.reason}`, 80);
      }
    }

    // Update panorama record
    await serviceClient
      .from("floorplan_space_panoramas")
      .update({
        status: finalStatus,
        output_upload_id: uploadRecord?.id,
        final_composed_prompt: prompt,
        model: "gemini-3-pro-image-preview",
        attempt_count: currentAttempt,
        qa_status: qaResult.pass ? "passed" : "failed",
        qa_report: qaResult,
        structured_qa_result: qaResult,
      })
      .eq("id", panorama_id);

    await serviceClient
      .from("floorplan_pipeline_spaces")
      .update({ [statusField]: finalStatus })
      .eq("id", panorama.space_id);

    console.log(`[space-panorama] Panorama ${panorama_id} completed with status: ${finalStatus}`);

    // ═══════════════════════════════════════════════════════════════════════
    // TRIGGER AUTO-RETRY IF NEEDED
    // ═══════════════════════════════════════════════════════════════════════
    if (shouldAutoRetry && currentAttempt < QA_CONFIG.MAX_ATTEMPTS) {
      // Delay before retry (exponential backoff)
      const delaySeconds = Math.min(2 * Math.pow(2, currentAttempt - 1), 30);
      console.log(`[space-panorama] Scheduling auto-retry in ${delaySeconds}s`);
      
      // Note: In production, this would use a queue. For now, we return and let the batch job handle retries.
    }

    // CRITICAL: Flush Langfuse events before returning
    await flushLangfuse();

    return new Response(
      JSON.stringify({
        success: true,
        panorama_id,
        output_upload_id: uploadRecord?.id,
        status: finalStatus,
        attempt: currentAttempt,
        max_attempts: QA_CONFIG.MAX_ATTEMPTS,
        qa_result: qaResult,
        needs_retry: shouldAutoRetry,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[space-panorama] Error: ${message}`);
    
    // Flush Langfuse even on error
    await flushLangfuse();
    
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
