import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";

/**
 * REJECT AND RETRY ENGINE (v2 - WITH LEARNING LOOP)
 * 
 * MANDATORY BEHAVIOR:
 * 1. Receive rejection (AI-QA or user manual)
 * 2. Call analyze-rejection to UNDERSTAND why (structured analysis)
 * 3. Call optimize-pipeline-prompt to generate improved prompt with delta fixes
 * 4. Trigger new generation with the improved prompt
 * 
 * REJECT WITHOUT LEARNING IS NOT ACCEPTABLE.
 * 
 * Handles the full rejection flow:
 * 1. Persists AI_QA_FAIL with full reason/notes
 * 2. Calls analyze-rejection for structured failure analysis
 * 3. Calls optimize-pipeline-prompt for prompt regeneration
 * 4. Increments attempt_count
 * 5. Checks retry budget
 * 6. Triggers a new generation job with IMPROVED prompt
 * 
 * POST-APPROVAL USER REJECT → INPAINT/EDIT FLOW
 * If the image was already AI-approved and user manually rejects:
 * - DO NOT regenerate from scratch
 * - Instead, trigger an edit/inpaint job on the SAME image
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Retry configuration
const MAX_ATTEMPTS = 5;

interface RejectionAnalysis {
  failure_categories: string[];
  root_cause_summary: string;
  constraints_to_add: string[];
  constraints_to_remove: string[];
  confidence: number;
  analyzed_at: string;
}

interface RejectAndRetryRequest {
  asset_type: "render" | "panorama" | "final360";
  asset_id: string;
  rejection_notes?: string;
  rejection_category?: string;
  styled_image_upload_id?: string;
  auto_triggered?: boolean;
  is_post_approval_reject?: boolean;
}

function jsonError(message: string, status = 400) {
  return new Response(
    JSON.stringify({ ok: false, error: message }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

function jsonSuccess(data: Record<string, unknown>) {
  return new Response(
    JSON.stringify({ ok: true, ...data }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

/**
 * Detect if an asset was previously approved by AI-QA
 */
function wasAiApproved(asset: {
  qa_status?: string;
  locked_approved?: boolean;
  structured_qa_result?: { status?: string };
}): boolean {
  const qaStatus = asset.qa_status?.toLowerCase();
  const structuredStatus = (asset.structured_qa_result?.status || "").toLowerCase();
  
  return (
    qaStatus === "passed" ||
    qaStatus === "approved" ||
    structuredStatus === "pass" ||
    structuredStatus === "passed"
  );
}

/**
 * LEARNING STEP 1: Analyze the rejection to understand root cause
 */
async function analyzeRejection(
  authHeader: string,
  asset_type: string,
  asset_id: string,
  reject_reason: string,
  step_number: number,
  rejected_image_url?: string,
  source_image_url?: string,
  previous_prompt?: string,
  space_type?: string,
  camera_direction?: string,
  project_id?: string // NEW: For learning context
): Promise<RejectionAnalysis | null> {
  console.log(`[reject-and-retry] Calling analyze-rejection for ${asset_type} ${asset_id}`);
  
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/analyze-rejection`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": authHeader,
      },
      body: JSON.stringify({
        asset_type,
        asset_id,
        step_number,
        reject_reason,
        rejected_image_url,
        source_image_url,
        previous_prompt,
        space_type,
        camera_direction,
        project_id, // NEW: Pass for learning context
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.warn(`[reject-and-retry] analyze-rejection failed: ${errorText}`);
      return null;
    }

    const result = await response.json();
    console.log(`[reject-and-retry] Rejection analysis:`, result.analysis);
    return result.analysis as RejectionAnalysis;
  } catch (error) {
    console.warn(`[reject-and-retry] analyze-rejection error:`, error);
    return null;
  }
}

/**
 * LEARNING STEP 2: Generate improved prompt based on analysis
 */
async function generateImprovedPrompt(
  authHeader: string,
  step_number: number,
  previous_prompt: string,
  rejection_analysis: RejectionAnalysis | null,
  rejection_category?: string
): Promise<string | null> {
  console.log(`[reject-and-retry] Calling optimize-pipeline-prompt for step ${step_number}`);
  
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/optimize-pipeline-prompt`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": authHeader,
      },
      body: JSON.stringify({
        step_number,
        previous_prompt,
        rejection_analysis,
        rejection_category: rejection_category || rejection_analysis?.failure_categories?.[0],
        mode: "improve_after_rejection",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.warn(`[reject-and-retry] optimize-pipeline-prompt failed: ${errorText}`);
      return null;
    }

    const result = await response.json();
    console.log(`[reject-and-retry] Improved prompt generated (length: ${result.optimized_prompt?.length})`);
    return result.optimized_prompt as string;
  } catch (error) {
    console.warn(`[reject-and-retry] optimize-pipeline-prompt error:`, error);
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth validation
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonError("Unauthorized", 401);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: userData } = await supabase.auth.getUser(token);
    if (!userData?.user) {
      return jsonError("Unauthorized", 401);
    }
    const userId = userData.user.id;

    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Parse request
    const body: RejectAndRetryRequest = await req.json();
    const { 
      asset_type, 
      asset_id, 
      rejection_notes, 
      rejection_category,
      styled_image_upload_id, 
      auto_triggered,
      is_post_approval_reject 
    } = body;

    console.log(`[reject-and-retry] Processing ${asset_type} rejection for: ${asset_id}`);
    console.log(`[reject-and-retry] Rejection reason: "${rejection_notes?.slice(0, 100)}..."`);
    console.log(`[reject-and-retry] auto_triggered: ${auto_triggered}, is_post_approval: ${is_post_approval_reject}`);

    if (!asset_type || !asset_id) {
      return jsonError("asset_type and asset_id are required");
    }

    // For post-approval rejects, rejection_notes (edit instructions) are MANDATORY
    if (is_post_approval_reject && !rejection_notes?.trim()) {
      return jsonError("Edit instructions are required for post-approval rejections");
    }

    // Handle based on asset type
    switch (asset_type) {
      case "render":
        return await handleRenderRejection(
          serviceClient, 
          authHeader, 
          asset_id, 
          userId, 
          rejection_notes,
          rejection_category,
          styled_image_upload_id,
          is_post_approval_reject
        );
      
      case "panorama":
        return await handlePanoramaRejection(
          serviceClient, 
          authHeader, 
          asset_id, 
          userId, 
          rejection_notes,
          rejection_category,
          is_post_approval_reject
        );
      
      case "final360":
        return await handleFinal360Rejection(
          serviceClient, 
          authHeader, 
          asset_id, 
          userId, 
          rejection_notes,
          rejection_category,
          is_post_approval_reject
        );
      
      default:
        return jsonError(`Unknown asset_type: ${asset_type}`);
    }

  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[reject-and-retry] Error: ${message}`);
    return jsonError(message, 500);
  }
});

// ============================================================================
// POST-APPROVAL INPAINT HANDLER
// ============================================================================

// deno-lint-ignore no-explicit-any
async function handlePostApprovalInpaint(
  serviceClient: any,
  authHeader: string,
  assetType: "render" | "panorama" | "final360",
  assetId: string,
  userId: string,
  asset: {
    pipeline_id: string;
    output_upload_id: string;
    qa_status?: string;
    space_id?: string;
    kind?: string;
  },
  userCorrectionText: string
) {
  console.log(`[reject-and-retry] POST-APPROVAL INPAINT for ${assetType} ${assetId}`);
  console.log(`[reject-and-retry] User correction: "${userCorrectionText}"`);
  console.log(`[reject-and-retry] Source image: ${asset.output_upload_id}`);

  const tableName = assetType === "render" 
    ? "floorplan_space_renders" 
    : assetType === "panorama" 
      ? "floorplan_space_panoramas" 
      : "floorplan_space_final360";

  const stepNumber = assetType === "render" ? 4 : assetType === "panorama" ? 5 : 6;

  // 1. Update the asset record for inpaint mode
  const { error: updateError } = await serviceClient
    .from(tableName)
    .update({
      status: "editing",
      job_type: "edit_inpaint",
      source_image_upload_id: asset.output_upload_id,
      user_correction_text: userCorrectionText,
      correction_mode: "inpaint",
      pre_rejection_qa_status: asset.qa_status,
      qa_status: "pending",
    })
    .eq("id", assetId);

  if (updateError) {
    console.error(`[reject-and-retry] Failed to update ${assetType} for inpaint:`, updateError);
    throw new Error(`Failed to update ${assetType}: ${updateError.message}`);
  }

  // 2. Emit event
  await serviceClient.from("floorplan_pipeline_events").insert({
    pipeline_id: asset.pipeline_id,
    owner_id: userId,
    step_number: stepNumber,
    type: "edit_inpaint_started",
    message: `✏ Editing ${assetType === "render" ? `Render ${asset.kind}` : assetType === "panorama" ? `Panorama ${asset.kind}` : "Final 360"} (preserving approved image)`,
    progress_int: 5,
  });

  // 3. Call the appropriate edge function with inpaint mode
  const functionName = assetType === "render" 
    ? "run-space-render" 
    : assetType === "panorama" 
      ? "run-space-panorama" 
      : "run-merge-360";

  const requestBody: Record<string, unknown> = {
    is_edit_inpaint: true,
    user_correction_text: userCorrectionText,
  };

  if (assetType === "render") {
    requestBody.render_id = assetId;
    const { data: pipeline } = await serviceClient
      .from("floorplan_pipelines")
      .select("step_outputs")
      .eq("id", asset.pipeline_id)
      .single();
    requestBody.styled_image_upload_id = pipeline?.step_outputs?.step2?.output_upload_id;
  } else if (assetType === "panorama") {
    requestBody.panorama_id = assetId;
    const { data: pano } = await serviceClient
      .from("floorplan_space_panoramas")
      .select("source_render_id")
      .eq("id", assetId)
      .single();
    requestBody.source_render_id = pano?.source_render_id;
  } else {
    requestBody.final360_id = assetId;
    const { data: f360 } = await serviceClient
      .from("floorplan_space_final360")
      .select("panorama_a_id, panorama_b_id")
      .eq("id", assetId)
      .single();
    requestBody.panorama_a_id = f360?.panorama_a_id;
    requestBody.panorama_b_id = f360?.panorama_b_id;
  }

  console.log(`[reject-and-retry] Calling ${functionName} for inpaint with:`, requestBody);

  const response = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": authHeader,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[reject-and-retry] ${functionName} failed:`, errorText);
    
    await serviceClient
      .from(tableName)
      .update({
        status: "failed",
        qa_report: { error: `Inpaint failed: ${errorText}` },
      })
      .eq("id", assetId);

    return jsonError(`Inpaint failed: ${errorText}`, 500);
  }

  const result = await response.json();
  console.log(`[reject-and-retry] Inpaint job triggered successfully:`, result);

  return jsonSuccess({
    inpaint_triggered: true,
    job_type: "edit_inpaint",
    source_image_id: asset.output_upload_id,
    user_correction_text: userCorrectionText,
    message: "Editing image with requested changes",
  });
}

// ============================================================================
// RENDER REJECTION HANDLER (WITH LEARNING LOOP)
// ============================================================================

// deno-lint-ignore no-explicit-any
async function handleRenderRejection(
  serviceClient: any,
  authHeader: string,
  renderId: string,
  userId: string,
  rejectionNotes?: string,
  rejectionCategory?: string,
  styledImageUploadId?: string,
  isPostApprovalReject?: boolean
) {
  const { data: render, error: renderError } = await serviceClient
    .from("floorplan_space_renders")
    .select(`
      id, space_id, pipeline_id, owner_id, kind, status, 
      attempt_count, auto_retry_enabled, qa_report, structured_qa_result,
      prompt_text, output_upload_id, qa_status, locked_approved, camera_label
    `)
    .eq("id", renderId)
    .eq("owner_id", userId)
    .single();

  if (renderError || !render) {
    console.error(`[reject-and-retry] Render not found: ${renderError?.message}`);
    return jsonError("Render not found", 404);
  }

  // POST-APPROVAL INPAINT DETECTION
  const shouldInpaint = (isPostApprovalReject || wasAiApproved(render)) && render.output_upload_id;
  
  if (shouldInpaint && rejectionNotes?.trim()) {
    console.log(`[reject-and-retry] Detected post-approval rejection for render ${renderId}`);
    return await handlePostApprovalInpaint(
      serviceClient,
      authHeader,
      "render",
      renderId,
      userId,
      render,
      rejectionNotes
    );
  }

  // NORMAL FULL REGENERATION FLOW
  const currentAttempt = render.attempt_count || 1;
  const newAttemptCount = currentAttempt + 1;

  console.log(`[reject-and-retry] Render ${renderId}: attempt ${currentAttempt} → ${newAttemptCount} (max: ${MAX_ATTEMPTS})`);

  if (newAttemptCount > MAX_ATTEMPTS) {
    console.log(`[reject-and-retry] Max attempts reached for render ${renderId}`);
    
    const qaHistory = render.qa_report?.rejection_history || [];
    qaHistory.push({
      attempt: currentAttempt,
      notes: rejectionNotes,
      category: rejectionCategory,
      rejected_at: new Date().toISOString(),
      structured_qa: render.structured_qa_result,
    });
    
    await serviceClient
      .from("floorplan_space_renders")
      .update({
        status: "blocked_for_human",
        qa_status: "rejected",
        qa_report: {
          ...(render.qa_report || {}),
          rejection_notes: rejectionNotes,
          rejection_category: rejectionCategory,
          rejected_at: new Date().toISOString(),
          blocked_reason: "Max retry attempts reached",
          total_attempts: currentAttempt,
          rejection_history: qaHistory,
          all_rejection_reasons: qaHistory.map((h: { notes: string; category?: string }) => 
            h.notes || h.category || "Unknown"
          ),
        },
      })
      .eq("id", renderId);

    await serviceClient.from("floorplan_pipeline_events").insert({
      pipeline_id: render.pipeline_id,
      owner_id: userId,
      step_number: 5,
      type: "retry_exhausted",
      message: `⚠ Render ${render.kind} blocked after ${MAX_ATTEMPTS} attempts - MANUAL APPROVAL REQUIRED`,
      progress_int: 0,
    });

    return jsonSuccess({
      retry_triggered: false,
      blocked_for_human: true,
      attempt_count: currentAttempt,
      max_attempts: MAX_ATTEMPTS,
      message: `Max attempts (${MAX_ATTEMPTS}) reached. Manual review required.`,
      rejection_history: qaHistory,
    });
  }

  // Get styled image if not provided
  let resolvedStyledImageId = styledImageUploadId;
  if (!resolvedStyledImageId) {
    const { data: pipeline } = await serviceClient
      .from("floorplan_pipelines")
      .select("step_outputs")
      .eq("id", render.pipeline_id)
      .single();
    
    resolvedStyledImageId = pipeline?.step_outputs?.step2?.output_upload_id;
  }

  if (!resolvedStyledImageId) {
    return jsonError("Cannot retry: styled image not found");
  }

  // Get space info for context
  const { data: space } = await serviceClient
    .from("floorplan_pipeline_spaces")
    .select("space_type, name")
    .eq("id", render.space_id)
    .single();

  // ═══════════════════════════════════════════════════════════════════════════
  // LEARNING LOOP: Analyze → Improve Prompt → Retry
  // ═══════════════════════════════════════════════════════════════════════════
  
  console.log(`[reject-and-retry] Starting learning loop for render ${renderId}`);

  // Step 1: Analyze the rejection (with project_id for learning context)
  const rejectionAnalysis = await analyzeRejection(
    authHeader,
    "render",
    renderId,
    rejectionNotes || "AI-QA rejection",
    5, // Step 5 for renders
    undefined, // Would need signed URL for rejected image
    undefined, // Would need signed URL for source
    render.prompt_text,
    space?.space_type,
    render.camera_label,
    render.pipeline_id // Pass project context for learning
  );

  // Step 2: Generate improved prompt
  let improvedPrompt = render.prompt_text;
  if (rejectionAnalysis || rejectionNotes) {
    const newPrompt = await generateImprovedPrompt(
      authHeader,
      5,
      render.prompt_text || "",
      rejectionAnalysis,
      rejectionCategory
    );
    if (newPrompt && newPrompt !== render.prompt_text) {
      improvedPrompt = newPrompt;
      console.log(`[reject-and-retry] Using improved prompt for retry`);
    }
  }

  // Build retry patch from analysis
  const retryPatch = buildBoundedRetryPatch(
    render.structured_qa_result, 
    rejectionCategory,
    rejectionAnalysis
  );

  await serviceClient
    .from("floorplan_space_renders")
    .update({
      status: "retrying",
      qa_status: "pending",
      attempt_count: newAttemptCount,
      output_upload_id: null,
      job_type: "generate",
      source_image_upload_id: null,
      user_correction_text: null,
      prompt_text: improvedPrompt, // Use the improved prompt!
      qa_report: {
        ...(render.qa_report || {}),
        previous_rejection: {
          attempt: currentAttempt,
          notes: rejectionNotes,
          category: rejectionCategory,
          rejected_at: new Date().toISOString(),
          analysis: rejectionAnalysis,
        },
        retry_patch: retryPatch,
        improved_prompt_used: improvedPrompt !== render.prompt_text,
      },
    })
    .eq("id", renderId);

  await serviceClient.from("floorplan_pipeline_events").insert({
    pipeline_id: render.pipeline_id,
    owner_id: userId,
    step_number: 5,
    type: "retry_started",
    message: `🔄 Retrying Render ${render.kind} (attempt ${newAttemptCount}/${MAX_ATTEMPTS})${rejectionAnalysis ? ` - fixing: ${rejectionAnalysis.root_cause_summary.slice(0, 50)}` : ""}`,
    progress_int: 5,
  });

  console.log(`[reject-and-retry] Triggering run-space-render for retry with improved prompt`);
  
  const renderResponse = await fetch(`${SUPABASE_URL}/functions/v1/run-space-render`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": authHeader,
    },
    body: JSON.stringify({
      render_id: renderId,
      styled_image_upload_id: resolvedStyledImageId,
      is_retry: true,
      attempt_number: newAttemptCount,
      retry_patch: retryPatch,
      improved_prompt: improvedPrompt, // Pass the improved prompt
    }),
  });

  if (!renderResponse.ok) {
    const errorText = await renderResponse.text();
    console.error(`[reject-and-retry] run-space-render failed: ${errorText}`);
    
    await serviceClient
      .from("floorplan_space_renders")
      .update({
        status: "failed",
        qa_report: {
          ...(render.qa_report || {}),
          retry_error: errorText,
        },
      })
      .eq("id", renderId);

    return jsonError(`Retry failed: ${errorText}`, 500);
  }

  const renderResult = await renderResponse.json();
  console.log(`[reject-and-retry] Retry triggered successfully:`, renderResult);

  return jsonSuccess({
    retry_triggered: true,
    attempt_count: newAttemptCount,
    max_attempts: MAX_ATTEMPTS,
    retry_patch: retryPatch,
    learning_applied: !!rejectionAnalysis,
    improved_prompt_used: improvedPrompt !== render.prompt_text,
    message: `Retry ${newAttemptCount}/${MAX_ATTEMPTS} started with learning`,
  });
}

// ============================================================================
// PANORAMA REJECTION HANDLER
// ============================================================================

// deno-lint-ignore no-explicit-any
async function handlePanoramaRejection(
  serviceClient: any,
  authHeader: string,
  panoramaId: string,
  userId: string,
  rejectionNotes?: string,
  rejectionCategory?: string,
  isPostApprovalReject?: boolean
) {
  const { data: panorama, error: panoramaError } = await serviceClient
    .from("floorplan_space_panoramas")
    .select(`
      id, space_id, pipeline_id, owner_id, kind, status,
      attempt_count, source_render_id, qa_report, structured_qa_result,
      output_upload_id, qa_status, locked_approved
    `)
    .eq("id", panoramaId)
    .eq("owner_id", userId)
    .single();

  if (panoramaError || !panorama) {
    return jsonError("Panorama not found", 404);
  }

  const shouldInpaint = (isPostApprovalReject || wasAiApproved(panorama)) && panorama.output_upload_id;
  
  if (shouldInpaint && rejectionNotes?.trim()) {
    console.log(`[reject-and-retry] Detected post-approval rejection for panorama ${panoramaId}`);
    return await handlePostApprovalInpaint(
      serviceClient,
      authHeader,
      "panorama",
      panoramaId,
      userId,
      panorama,
      rejectionNotes
    );
  }

  const currentAttempt = panorama.attempt_count || 1;
  const newAttemptCount = currentAttempt + 1;

  if (newAttemptCount > MAX_ATTEMPTS) {
    await serviceClient
      .from("floorplan_space_panoramas")
      .update({
        status: "blocked_for_human",
        qa_status: "rejected",
        qa_report: {
          ...(panorama.qa_report || {}),
          rejection_notes: rejectionNotes,
          rejection_category: rejectionCategory,
          blocked_reason: "Max retry attempts reached",
        },
      })
      .eq("id", panoramaId);

    await serviceClient.from("floorplan_pipeline_events").insert({
      pipeline_id: panorama.pipeline_id,
      owner_id: userId,
      step_number: 5,
      type: "retry_exhausted",
      message: `Panorama ${panorama.kind} blocked after ${MAX_ATTEMPTS} attempts`,
      progress_int: 0,
    });

    return jsonSuccess({
      retry_triggered: false,
      blocked_for_human: true,
      attempt_count: currentAttempt,
      max_attempts: MAX_ATTEMPTS,
    });
  }

  const retryPatch = buildBoundedRetryPatch(panorama.structured_qa_result, rejectionCategory);

  await serviceClient
    .from("floorplan_space_panoramas")
    .update({
      status: "retrying",
      qa_status: "pending",
      attempt_count: newAttemptCount,
      output_upload_id: null,
      job_type: "generate",
      source_image_upload_id: null,
      user_correction_text: null,
      qa_report: {
        ...(panorama.qa_report || {}),
        previous_rejection: {
          attempt: currentAttempt,
          notes: rejectionNotes,
          category: rejectionCategory,
          rejected_at: new Date().toISOString(),
        },
        retry_patch: retryPatch,
      },
    })
    .eq("id", panoramaId);

  await serviceClient.from("floorplan_pipeline_events").insert({
    pipeline_id: panorama.pipeline_id,
    owner_id: userId,
    step_number: 5,
    type: "retry_started",
    message: `Retrying Panorama ${panorama.kind} (attempt ${newAttemptCount}/${MAX_ATTEMPTS})`,
    progress_int: 5,
  });

  const panoResponse = await fetch(`${SUPABASE_URL}/functions/v1/run-space-panorama`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": authHeader,
    },
    body: JSON.stringify({
      panorama_id: panoramaId,
      source_render_id: panorama.source_render_id,
      is_retry: true,
      attempt_number: newAttemptCount,
      retry_patch: retryPatch,
    }),
  });

  if (!panoResponse.ok) {
    const errorText = await panoResponse.text();
    await serviceClient
      .from("floorplan_space_panoramas")
      .update({ status: "failed" })
      .eq("id", panoramaId);
    return jsonError(`Retry failed: ${errorText}`, 500);
  }

  return jsonSuccess({
    retry_triggered: true,
    attempt_count: newAttemptCount,
    max_attempts: MAX_ATTEMPTS,
    message: `Retry ${newAttemptCount}/${MAX_ATTEMPTS} started`,
  });
}

// ============================================================================
// FINAL 360 REJECTION HANDLER
// ============================================================================

// deno-lint-ignore no-explicit-any
async function handleFinal360Rejection(
  serviceClient: any,
  authHeader: string,
  final360Id: string,
  userId: string,
  rejectionNotes?: string,
  rejectionCategory?: string,
  isPostApprovalReject?: boolean
) {
  const { data: final360, error: final360Error } = await serviceClient
    .from("floorplan_space_final360")
    .select(`
      id, space_id, pipeline_id, owner_id, status,
      attempt_count, panorama_a_id, panorama_b_id, qa_report, structured_qa_result,
      output_upload_id, qa_status, locked_approved
    `)
    .eq("id", final360Id)
    .eq("owner_id", userId)
    .single();

  if (final360Error || !final360) {
    return jsonError("Final360 not found", 404);
  }

  const shouldInpaint = (isPostApprovalReject || wasAiApproved(final360)) && final360.output_upload_id;
  
  if (shouldInpaint && rejectionNotes?.trim()) {
    return await handlePostApprovalInpaint(
      serviceClient,
      authHeader,
      "final360",
      final360Id,
      userId,
      final360,
      rejectionNotes
    );
  }

  const currentAttempt = final360.attempt_count || 1;
  const newAttemptCount = currentAttempt + 1;

  if (newAttemptCount > MAX_ATTEMPTS) {
    await serviceClient
      .from("floorplan_space_final360")
      .update({
        status: "blocked_for_human",
        qa_status: "rejected",
        qa_report: {
          ...(final360.qa_report || {}),
          rejection_notes: rejectionNotes,
          rejection_category: rejectionCategory,
          blocked_reason: "Max retry attempts reached",
        },
      })
      .eq("id", final360Id);

    await serviceClient.from("floorplan_pipeline_events").insert({
      pipeline_id: final360.pipeline_id,
      owner_id: userId,
      step_number: 6,
      type: "retry_exhausted",
      message: `Final 360 blocked after ${MAX_ATTEMPTS} attempts`,
      progress_int: 0,
    });

    return jsonSuccess({
      retry_triggered: false,
      blocked_for_human: true,
      attempt_count: currentAttempt,
      max_attempts: MAX_ATTEMPTS,
    });
  }

  const retryPatch = buildBoundedRetryPatch(final360.structured_qa_result, rejectionCategory);

  await serviceClient
    .from("floorplan_space_final360")
    .update({
      status: "retrying",
      qa_status: "pending",
      attempt_count: newAttemptCount,
      output_upload_id: null,
      job_type: "generate",
      source_image_upload_id: null,
      user_correction_text: null,
      qa_report: {
        ...(final360.qa_report || {}),
        previous_rejection: {
          attempt: currentAttempt,
          notes: rejectionNotes,
          category: rejectionCategory,
          rejected_at: new Date().toISOString(),
        },
        retry_patch: retryPatch,
      },
    })
    .eq("id", final360Id);

  await serviceClient.from("floorplan_pipeline_events").insert({
    pipeline_id: final360.pipeline_id,
    owner_id: userId,
    step_number: 6,
    type: "retry_started",
    message: `Retrying Final 360 (attempt ${newAttemptCount}/${MAX_ATTEMPTS})`,
    progress_int: 5,
  });

  const mergeResponse = await fetch(`${SUPABASE_URL}/functions/v1/run-merge-360`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": authHeader,
    },
    body: JSON.stringify({
      final360_id: final360Id,
      panorama_a_id: final360.panorama_a_id,
      panorama_b_id: final360.panorama_b_id,
      is_retry: true,
      attempt_number: newAttemptCount,
      retry_patch: retryPatch,
    }),
  });

  if (!mergeResponse.ok) {
    const errorText = await mergeResponse.text();
    await serviceClient
      .from("floorplan_space_final360")
      .update({ status: "failed" })
      .eq("id", final360Id);
    return jsonError(`Retry failed: ${errorText}`, 500);
  }

  return jsonSuccess({
    retry_triggered: true,
    attempt_count: newAttemptCount,
    max_attempts: MAX_ATTEMPTS,
    message: `Retry ${newAttemptCount}/${MAX_ATTEMPTS} started`,
  });
}

// ============================================================================
// BOUNDED CATEGORY-DRIVEN RETRY PATCH BUILDER (ENHANCED WITH LEARNING)
// ============================================================================

/**
 * CATEGORY PATCH DEFINITIONS
 * Each category has ONE bounded constraint text.
 * These are NEVER accumulated - only the categories flagged in THIS rejection apply.
 */
const CATEGORY_PATCHES: Record<string, string> = {
  // Room/Layout issues
  wrong_room: "Generate ONLY the specified room - do not show adjacent rooms or different spaces.",
  wrong_camera_direction: "Camera MUST face the specified direction exactly.",
  hallucinated_opening: "Do NOT create doorways or windows that don't exist in the floor plan.",
  layout_mismatch: "Match room layout EXACTLY to the floor plan.",
  
  // Furniture issues
  missing_major_furniture: "Include ALL major furniture shown in the floor plan.",
  extra_major_furniture: "Do NOT add furniture beyond what appears in the floor plan.",
  furniture_scale: "Maintain correct furniture scale - beds sized appropriately for room type.",
  extra_furniture: "Do not add furniture not explicitly present in the floor plan.",
  scale_mismatch: "Verify furniture and room scale matches real-world proportions.",
  
  // Structural issues
  structural_change: "Preserve all walls, doors, and windows exactly as shown in the plan.",
  ignored_camera: "Respect the camera position and viewing angle specified.",
  
  // Surface/Material issues
  flooring_mismatch: "Use flooring materials consistent with the room type and style.",
  style_mismatch: "Apply the specified design style consistently.",
  room_type_violation: "This is NOT a bathroom - do not include bathroom fixtures.",
  
  // Quality issues
  artifact: "Generate clean image without visual artifacts or distortions.",
  perspective: "Use correct eye-level perspective without fisheye distortion.",
  perspective_distortion: "Avoid fisheye distortion - use natural perspective.",
  seam: "Ensure seamless blending without visible joins or ghosting.",
  seam_issue: "Ensure seamless blending at all edges.",
  hallucination: "Only include elements present in the source images - no invented objects.",
};

interface StructuredQAResult {
  status?: string;
  reason_short?: string;
  reasons?: Array<{ code: string; description: string }>;
  severity?: string;
  retry_suggestion?: {
    type: string;
    instruction: string;
  };
  room_type_violation?: boolean;
  structural_violation?: boolean;
  detected_room_type?: string;
  issues?: Array<{ type: string; severity: string; description: string }>;
}

interface RetryPatch {
  category_patches: Array<{ category: string; patch_text: string }>;
  new_seed: number;
  reduce_creativity: boolean;
  learning_applied: boolean;
}

function buildBoundedRetryPatch(
  structuredQaResult: unknown,
  userCategory?: string,
  rejectionAnalysis?: RejectionAnalysis | null
): RetryPatch {
  const patch: RetryPatch = {
    category_patches: [],
    new_seed: Math.floor(Math.random() * 2147483647),
    reduce_creativity: false,
    learning_applied: false,
  };

  const qa = structuredQaResult as StructuredQAResult | null;
  const categoriesApplied = new Set<string>();

  // NEW: Apply categories from rejection analysis FIRST (learning loop)
  if (rejectionAnalysis?.failure_categories) {
    patch.learning_applied = true;
    for (const category of rejectionAnalysis.failure_categories) {
      const normalizedCat = normalizeCategory(category) || category;
      if (CATEGORY_PATCHES[normalizedCat] && !categoriesApplied.has(normalizedCat)) {
        categoriesApplied.add(normalizedCat);
        patch.category_patches.push({
          category: normalizedCat,
          patch_text: CATEGORY_PATCHES[normalizedCat],
        });
      }
    }
    
    // Also add constraints_to_add from analysis (limited to 2)
    for (const constraint of (rejectionAnalysis.constraints_to_add || []).slice(0, 2)) {
      if (constraint.length < 100) {
        patch.category_patches.push({
          category: "learned_constraint",
          patch_text: constraint,
        });
      }
    }
  }

  // 1. Extract categories from QA issues (ONLY critical/major)
  if (qa?.issues) {
    for (const issue of qa.issues) {
      if (issue.severity === "critical" || issue.severity === "major") {
        const category = normalizeCategory(issue.type);
        if (category && CATEGORY_PATCHES[category] && !categoriesApplied.has(category)) {
          categoriesApplied.add(category);
          patch.category_patches.push({
            category,
            patch_text: CATEGORY_PATCHES[category],
          });
        }
      }
    }
  }

  // 2. Handle explicit room type violation
  if (qa?.room_type_violation) {
    if (!categoriesApplied.has("room_type_violation")) {
      categoriesApplied.add("room_type_violation");
      const detectedType = qa.detected_room_type || "bathroom";
      patch.category_patches.push({
        category: "room_type_violation",
        patch_text: `This is NOT a ${detectedType} - do not include ${detectedType} fixtures.`,
      });
    }
    patch.reduce_creativity = true;
  }

  // 3. Handle structural violation
  if (qa?.structural_violation) {
    if (!categoriesApplied.has("structural_change")) {
      categoriesApplied.add("structural_change");
      patch.category_patches.push({
        category: "structural_change",
        patch_text: CATEGORY_PATCHES.structural_change,
      });
    }
    patch.reduce_creativity = true;
  }

  // 4. Add user-provided category (if different from QA)
  if (userCategory && !categoriesApplied.has(userCategory)) {
    const normalizedUserCat = normalizeCategory(userCategory);
    if (normalizedUserCat && CATEGORY_PATCHES[normalizedUserCat]) {
      categoriesApplied.add(normalizedUserCat);
      patch.category_patches.push({
        category: normalizedUserCat,
        patch_text: CATEGORY_PATCHES[normalizedUserCat],
      });
    }
  }

  // IMPORTANT: Do NOT add raw rejection notes as a patch
  // This prevents "memory dump" constraint bloat

  console.log(`[reject-and-retry] Built retry patch: ${patch.category_patches.length} categories, learning: ${patch.learning_applied}`,
    patch.category_patches.map(p => p.category));

  return patch;
}

/**
 * Normalize issue types to standard categories
 */
function normalizeCategory(issueType: string): string | null {
  const type = issueType.toLowerCase().replace(/[_\s-]+/g, "_");
  
  const mapping: Record<string, string> = {
    "furniture_scale": "furniture_scale",
    "scale_mismatch": "scale_mismatch",
    "extra_furniture": "extra_furniture",
    "extra_major_furniture": "extra_major_furniture",
    "missing_major_furniture": "missing_major_furniture",
    "structural": "structural_change",
    "structural_change": "structural_change",
    "wall_rectification": "structural_change",
    "geometry_distortion": "structural_change",
    "flooring": "flooring_mismatch",
    "flooring_mismatch": "flooring_mismatch",
    "room_type": "room_type_violation",
    "room_type_violation": "room_type_violation",
    "wrong_room": "wrong_room",
    "wrong_camera_direction": "wrong_camera_direction",
    "hallucinated_opening": "hallucinated_opening",
    "layout_mismatch": "layout_mismatch",
    "ignored_camera": "ignored_camera",
    "artifact": "artifact",
    "perspective": "perspective",
    "perspective_distortion": "perspective_distortion",
    "seam": "seam",
    "seam_issue": "seam_issue",
    "hallucination": "hallucination",
    "duplicate": "hallucination",
    "style_mismatch": "style_mismatch",
  };

  return mapping[type] || null;
}
