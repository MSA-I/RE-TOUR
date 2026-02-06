import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import {
  type LogicalQAInput,
  type LogicalQAResult,
  type LogicalQAReason,
  buildLogicalQAPrompt,
  validateLogicalQAResult,
  createApprovedResult,
  createRejectResult,
  getAdjacentRooms,
  getRoomLocks,
} from "../_shared/logical-qa-schema.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const API_NANOBANANA = Deno.env.get("API_NANOBANANA")!;

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const MODELS = {
  LOGICAL_QA: "gemini-3-pro-preview",
  FALLBACK: "gemini-2.5-pro",
};

const MAX_ATTEMPTS = 5;

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

// deno-lint-ignore no-explicit-any
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

async function callGeminiWithFallback(
  payload: unknown,
  authHeader: string
): Promise<{ response: unknown; modelUsed: string }> {
  // Try primary model
  try {
    const url = `${GEMINI_API_BASE}/${MODELS.LOGICAL_QA}:generateContent?key=${API_NANOBANANA}`;
    console.log(`[logical-qa] Trying primary model: ${MODELS.LOGICAL_QA}`);
    
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      return { response: await response.json(), modelUsed: MODELS.LOGICAL_QA };
    }

    if (response.status === 429 || response.status === 503) {
      console.log(`[logical-qa] Primary model rate limited, trying fallback...`);
    } else {
      throw new Error(`Primary failed: ${response.status}`);
    }
  } catch (e) {
    console.log(`[logical-qa] Primary model error: ${e}`);
  }

  // Fallback
  const fallbackUrl = `${GEMINI_API_BASE}/${MODELS.FALLBACK}:generateContent?key=${API_NANOBANANA}`;
  console.log(`[logical-qa] Using fallback: ${MODELS.FALLBACK}`);
  
  const fallbackResponse = await fetch(fallbackUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!fallbackResponse.ok) {
    throw new Error(`Fallback also failed: ${fallbackResponse.status}`);
  }

  return { response: await fallbackResponse.json(), modelUsed: MODELS.FALLBACK };
}

async function triggerAutoRetry(
  authHeader: string,
  assetType: "render" | "panorama" | "final360",
  assetId: string,
  rejectionReason: string,
  requiredChanges: LogicalQAResult["required_changes"]
): Promise<{ triggered: boolean; blocked?: boolean; message: string }> {
  try {
    console.log(`[logical-qa] Auto-triggering retry for ${assetType} ${assetId}`);
    
    // Build rejection notes from required changes
    const rejectionNotes = [
      rejectionReason,
      ...requiredChanges.map(c => `[${c.type}] ${c.instruction}`)
    ].join("\n");
    
    const response = await fetch(`${SUPABASE_URL}/functions/v1/run-reject-and-retry`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": authHeader,
      },
      body: JSON.stringify({
        asset_type: assetType,
        asset_id: assetId,
        rejection_notes: rejectionNotes,
        auto_triggered: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[logical-qa] Auto-retry failed: ${errorText}`);
      return { triggered: false, message: `Auto-retry failed: ${errorText}` };
    }

    const result = await response.json();
    
    if (result.blocked_for_human) {
      return { 
        triggered: false, 
        blocked: true, 
        message: `Max attempts (${MAX_ATTEMPTS}) reached. Manual review required.` 
      };
    }

    return { 
      triggered: true, 
      message: `Auto-retry ${result.attempt_count}/${MAX_ATTEMPTS} triggered` 
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[logical-qa] Auto-retry error: ${message}`);
    return { triggered: false, message };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
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

    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Parse request body
    const body = await req.json();
    const {
      upload_id,
      asset_id,
      asset_type,
      camera_spec,
      space_graph,
      space_type,
      space_name,
      current_attempt,
      step3_output_upload_id,
    } = body;

    if (!upload_id) {
      return jsonError("upload_id is required");
    }

    console.log(`[logical-qa] Starting logical QA for upload ${upload_id}`);
    console.log(`[logical-qa] Space: ${space_name} (${space_type}), Camera: ${camera_spec?.label}`);
    console.log(`[logical-qa] Attempt: ${current_attempt || 1}/${MAX_ATTEMPTS}`);

    // Build input object
    const input: LogicalQAInput = {
      upload_id,
      camera_spec: camera_spec || {
        id: "default",
        label: "Camera",
        x_norm: 0.5,
        y_norm: 0.5,
        yaw_deg: 0,
        fov_deg: 80,
        room_id: null,
      },
      space_graph: space_graph || { rooms: [], edges: [], locks: [] },
      space_type: space_type || "room",
      space_name: space_name || "Unknown",
      current_attempt: current_attempt || 1,
      max_attempts: MAX_ATTEMPTS,
      step3_output_upload_id,
    };

    // Fetch the generated image
    const { base64: imageBase64, mimeType } = await fetchImageAsBase64(serviceClient, upload_id);
    console.log(`[logical-qa] Image loaded for validation`);

    // Build the prompt
    const prompt = buildLogicalQAPrompt(input);

    // Build message parts
    // deno-lint-ignore no-explicit-any
    const parts: any[] = [
      { text: prompt },
      { text: "\n\nGENERATED IMAGE TO VALIDATE:" },
      { inlineData: { mimeType, data: imageBase64 } },
    ];

    // Optionally include Step 3 reference
    if (step3_output_upload_id) {
      try {
        const { base64: step3Base64, mimeType: step3Mime } = await fetchImageAsBase64(serviceClient, step3_output_upload_id);
        parts.push({ text: "\n\nSTEP 3 STYLED FLOOR PLAN (for structural reference):" });
        parts.push({ inlineData: { mimeType: step3Mime, data: step3Base64 } });
        console.log(`[logical-qa] Step 3 reference loaded`);
      } catch (e) {
        console.log(`[logical-qa] Could not load Step 3 reference: ${e}`);
      }
    }

    // Call Gemini
    const geminiPayload = {
      contents: [{ parts }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 3000,
        responseMimeType: "application/json",
      },
    };

    const { response: geminiResponse, modelUsed } = await callGeminiWithFallback(geminiPayload, authHeader);
    
    // deno-lint-ignore no-explicit-any
    const content = (geminiResponse as any).candidates?.[0]?.content?.parts?.[0]?.text || "";
    console.log(`[logical-qa] Response from ${modelUsed}`);

    // Parse the result
    let qaResult: LogicalQAResult;
    try {
      // Try to extract JSON
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        
        // Validate the result
        const validation = validateLogicalQAResult(parsed);
        if (!validation.valid) {
          console.warn(`[logical-qa] Validation warnings: ${validation.errors.join(", ")}`);
        }
        
        // Build the result with defaults
        qaResult = {
          status: parsed.status || "reject",
          reasons: parsed.reasons || [],
          required_changes: parsed.required_changes || [],
          confidence: parsed.confidence ?? 0.5,
          room_type_check: parsed.room_type_check || {
            passed: true,
            expected_type: input.space_type,
            detected_type: null,
          },
          adjacency_check: parsed.adjacency_check || {
            passed: true,
            expected_adjacent_rooms: getAdjacentRooms(input.camera_spec.room_id, input.space_graph.edges, input.space_graph.rooms),
            detected_connections: [],
            hallucinated_connections: [],
          },
          locks_check: parsed.locks_check || {
            passed: true,
            must_include_violations: [],
            must_not_include_violations: [],
          },
          attempt_number: input.current_attempt,
          max_attempts: input.max_attempts,
          model_used: modelUsed,
          processing_time_ms: Date.now() - startTime,
        };
      } else {
        throw new Error("No JSON found in response");
      }
    } catch (e) {
      console.error(`[logical-qa] Parse error: ${e}`);
      // Default to reject with parse error
      qaResult = {
        status: "reject",
        reasons: [{
          code: "UNKNOWN",
          description: "Failed to parse QA response",
          severity: "major",
        }],
        required_changes: [{
          type: "seed_change",
          instruction: "Regenerate with different seed",
          priority: 1,
        }],
        confidence: 0.3,
        room_type_check: {
          passed: false,
          expected_type: input.space_type,
          detected_type: null,
          mismatch_evidence: "Could not validate",
        },
        adjacency_check: {
          passed: false,
          expected_adjacent_rooms: [],
          hallucinated_connections: [],
        },
        locks_check: {
          passed: false,
          must_include_violations: [],
          must_not_include_violations: [],
        },
        attempt_number: input.current_attempt,
        max_attempts: input.max_attempts,
        model_used: modelUsed,
        processing_time_ms: Date.now() - startTime,
      };
    }

    console.log(`[logical-qa] Result: status=${qaResult.status}, confidence=${qaResult.confidence}`);
    console.log(`[logical-qa] Checks: room_type=${qaResult.room_type_check.passed}, adjacency=${qaResult.adjacency_check.passed}, locks=${qaResult.locks_check.passed}`);

    // ═══════════════════════════════════════════════════════════════════════════
    // AUTO-RETRY ON REJECTION
    // ═══════════════════════════════════════════════════════════════════════════
    if (qaResult.status === "reject" && asset_id && asset_type) {
      console.log(`[logical-qa] REJECTED - Checking auto-retry eligibility...`);
      
      if (input.current_attempt < MAX_ATTEMPTS) {
        // Build rejection reason from the most critical reason
        const criticalReasons = qaResult.reasons.filter(r => r.severity === "critical");
        const majorReasons = qaResult.reasons.filter(r => r.severity === "major");
        const primaryReason = criticalReasons[0] || majorReasons[0] || qaResult.reasons[0];
        
        const rejectionReason = primaryReason?.description || "Logical QA validation failed";
        
        const retryResult = await triggerAutoRetry(
          authHeader,
          asset_type,
          asset_id,
          rejectionReason,
          qaResult.required_changes
        );
        
        (qaResult as LogicalQAResult & { auto_retry?: unknown }).auto_retry = {
          triggered: retryResult.triggered,
          blocked_for_human: retryResult.blocked || false,
          message: retryResult.message,
        };
        
        console.log(`[logical-qa] Auto-retry result: ${retryResult.message}`);
      } else {
        console.log(`[logical-qa] Max attempts reached - blocking for human review`);
        (qaResult as LogicalQAResult & { auto_retry?: unknown }).auto_retry = {
          triggered: false,
          blocked_for_human: true,
          message: `Max attempts (${MAX_ATTEMPTS}) reached. Manual review required.`,
        };
      }
    }

    // Update the asset record with the logical QA result
    if (asset_id && asset_type) {
      const tableName = asset_type === "render" 
        ? "floorplan_space_renders" 
        : asset_type === "panorama" 
          ? "floorplan_space_panoramas" 
          : "floorplan_space_final360";

      await serviceClient
        .from(tableName)
        .update({
          structured_qa_result: qaResult,
          qa_status: qaResult.status === "approved" ? "passed" : "failed",
        })
        .eq("id", asset_id);

      console.log(`[logical-qa] Updated ${tableName} record`);
    }

    return jsonSuccess({
      qa_result: qaResult,
      processing_time_ms: Date.now() - startTime,
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[logical-qa] Error: ${message}`);
    return jsonError(message, 500);
  }
});
