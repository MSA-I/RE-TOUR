import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const API_NANOBANANA = Deno.env.get("API_NANOBANANA");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Retries = 2 means total attempts = 3.
const MAX_RETRIES = 2;

// QA must be Gemini 3 Pro Preview, with fallback.
const PRIMARY_QA_MODEL = "gemini-3-pro-preview";
const FALLBACK_QA_MODEL = "gemini-2.5-pro";

// Image generation endpoint (Nano Banana) currently maps to an image-capable Gemini model.
const NANO_IMAGE_MODEL = "gemini-3-pro-image-preview";

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type SupabaseClient = ReturnType<typeof createClient>;

type GeminiInlineData = { mimeType?: string; data?: string };
type GeminiPart = { text?: string; inlineData?: GeminiInlineData };
type GeminiCandidate = { content?: { parts?: GeminiPart[] } };
type GeminiResponse = { candidates?: GeminiCandidate[]; error?: { message?: string } };

type QaIssueType =
  | "duplicated_objects"
  | "seam"
  | "ghosting"
  | "warping"
  | "color_mismatch"
  | "hallucination"
  | "blur_smear"
  | "other";

type QaSeverity = "low" | "medium" | "high";

type QaIssue = {
  type: QaIssueType;
  severity: QaSeverity;
  description: string;
};

type QaResult = {
  pass: boolean;
  issues: QaIssue[];
  summary: string;
  corrective_instruction: string;
};

const MULTI_IMAGE_PANORAMA_PROMPT = (imageCount: number, aspectRatio: string) =>
  `You are generating a TRUE 360° equirectangular interior panorama using MULTIPLE reference images as SPATIAL EVIDENCE.\n` +
  `You have ${imageCount} reference images. Treat each image as spatial evidence.\n` +
  `ABSOLUTE NO HALLUCINATION: do not invent rooms, openings, furniture, or structures not supported by the inputs.\n` +
  `Output must be a panorama-safe equirectangular panorama (aspect ratio ${aspectRatio}).\n` +
  `Avoid seams, ghosting, warped geometry, duplicated objects, smears, and stitching artifacts.\n`;

const buildQaPrompt = (requestJson: unknown) =>
  `You are an automated QA validator for Multi-Pano outputs.\n\n` +
  `You MUST inspect the OUTPUT image for panorama stitching/generation artifacts and compare against INPUT evidence when provided.\n\n` +
  `You will be provided with:\n` +
  `- The EXACT request JSON that was sent to the image model (text only)\n` +
  `- Input evidence images (0+ images)\n` +
  `- The output panorama image\n\n` +
  `CHECK FOR (fail if any medium/high):\n` +
  `- duplicated/echoed furniture (chairs/sofas/tables repeated unnaturally)\n` +
  `- visible seam lines / stitching boundaries\n` +
  `- ghosting / double edges\n` +
  `- warped straight lines (doors, cabinets, walls bending)\n` +
  `- inconsistent lighting/color across stitched regions\n` +
  `- missing/blurred regions, smears, obvious AI glitches\n` +
  `- hallucinated structures/objects not supported by the inputs\n\n` +
  `STRICT JSON OUTPUT ONLY (no markdown, no prose):\n` +
  `{"pass": boolean, "issues": [{"type": "duplicated_objects"|"seam"|"ghosting"|"warping"|"color_mismatch"|"hallucination"|"blur_smear"|"other", "severity": "low"|"medium"|"high", "description": string}], "summary": string, "corrective_instruction": string}\n\n` +
  `Rules:\n` +
  `- pass MUST be false if ANY issue has severity medium or high.\n` +
  `- corrective_instruction MUST focus ONLY on fixing found artifacts (no redesign, no style edits).\n\n` +
  `REQUEST JSON (text):\n${JSON.stringify(requestJson)}`;

function extensionForMimeType(mimeType: string) {
  const t = mimeType.toLowerCase();
  if (t.includes("png")) return "png";
  if (t.includes("jpeg") || t.includes("jpg")) return "jpg";
  if (t.includes("webp")) return "webp";
  return "bin";
}

function normalizeModelName(model: string) {
  const m = model.trim();
  return m.startsWith("models/") ? m.slice("models/".length) : m;
}

function safeJsonParse(text: string): unknown {
  const cleaned = text.replace(/```json\n?|```/g, "").trim();
  return JSON.parse(cleaned);
}

async function emitEvent(
  supabase: SupabaseClient,
  jobId: string,
  ownerId: string,
  type: string,
  message: string,
  progress: number
) {
  await supabase.from("multi_image_panorama_events").insert({
    job_id: jobId,
    owner_id: ownerId,
    type,
    message,
    progress_int: progress,
  });
}

async function updateJob(supabase: SupabaseClient, jobId: string, updates: Record<string, unknown>) {
  await supabase
    .from("multi_image_panorama_jobs")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", jobId);
}

async function callGenerateContent(apiKey: string, model: string, payload: unknown) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${normalizeModelName(model)}:generateContent`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  let json: GeminiResponse = {};
  try {
    json = (text ? (JSON.parse(text) as GeminiResponse) : {}) || {};
  } catch {
    json = {};
  }

  if (!response.ok) {
    const msg = json?.error?.message || text || `HTTP ${response.status}`;
    throw new Error(`Gemini error (${normalizeModelName(model)}): ${msg}`);
  }

  return json;
}

async function runAiQaWithFallback(
  apiKey: string,
  requestJson: unknown,
  output: { base64: string; mimeType: string },
  inputEvidence: Array<{ base64: string; mimeType: string }>
): Promise<QaResult> {
  const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];
  parts.push({ text: buildQaPrompt(requestJson) });

  // Provide up to 2 evidence images (best-effort).
  for (const img of inputEvidence.slice(0, 2)) {
    parts.push({ inlineData: { mimeType: img.mimeType, data: img.base64 } });
  }

  // Output image last.
  parts.push({ inlineData: { mimeType: output.mimeType, data: output.base64 } });

  const qaPayload = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0,
      maxOutputTokens: 800,
    },
  };

  const runOnce = async (model: string) => {
    const data = await callGenerateContent(apiKey, model, qaPayload);
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error(`No QA text response from ${normalizeModelName(model)}`);
    const parsed = safeJsonParse(text) as QaResult;

    const issues = Array.isArray(parsed.issues) ? parsed.issues : [];
    const hasBlocking = issues.some((i) => i?.severity === "medium" || i?.severity === "high");
    const pass = Boolean(parsed.pass) && !hasBlocking;
    return {
      pass,
      issues,
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      corrective_instruction: typeof parsed.corrective_instruction === "string" ? parsed.corrective_instruction : "",
    } satisfies QaResult;
  };

  try {
    return await runOnce(PRIMARY_QA_MODEL);
  } catch {
    return await runOnce(FALLBACK_QA_MODEL);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  let jobIdForFailure: string | undefined;

  try {
    if (!API_NANOBANANA) throw new HttpError(500, "API_NANOBANANA secret not configured");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new HttpError(401, "Unauthorized");

    const supabaseUser = createClient(
      SUPABASE_URL,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) throw new HttpError(401, "Unauthorized");

    const body = await req.json().catch(() => ({}));
    const bodyObj = (body && typeof body === "object") ? (body as Record<string, unknown>) : {};
    const job_id = typeof bodyObj.job_id === "string" ? bodyObj.job_id : undefined;
    if (!job_id) throw new HttpError(400, "job_id is required");
    jobIdForFailure = job_id;

    const { data: job, error: jobError } = await supabaseAdmin
      .from("multi_image_panorama_jobs")
      .select("*")
      .eq("id", job_id)
      .eq("owner_id", user.id)
      .single();
    if (jobError || !job) throw new HttpError(404, "Job not found");

    const inputUploadIds = job.input_upload_ids as string[];
    if (!Array.isArray(inputUploadIds) || inputUploadIds.length < 2) {
      throw new HttpError(400, "At least 2 input images required");
    }

    const aspectRatio = job.aspect_ratio || "2:1";
    const outputResolution = job.output_resolution || "2K";

    await updateJob(supabaseAdmin, job_id, {
      status: "running",
      progress_int: 5,
      retry_count: 0,
      qa_summary: null,
      qa_issues: [],
      last_error: null,
    });

    await emitEvent(supabaseAdmin, job_id, user.id, "START", "Starting Multi-Pano generation (AI QA enabled)", 5);

    // Fetch and base64 input images
    const inputEvidence: Array<{ base64: string; mimeType: string }> = [];
    const inputParts: Array<{ inlineData: { mimeType: string; data: string } }> = [];

    for (const id of inputUploadIds) {
      const { data: upload } = await supabaseAdmin
        .from("uploads")
        .select("bucket, path")
        .eq("id", id)
        .single();
      if (!upload) continue;

      const { data: fileData } = await supabaseAdmin.storage.from(upload.bucket).download(upload.path);
      if (!fileData) continue;

      const buffer = await fileData.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
      );
      const mimeType = fileData.type || "image/jpeg";

      inputEvidence.push({ base64, mimeType });
      inputParts.push({ inlineData: { mimeType, data: base64 } });
    }

    if (inputParts.length < 2) throw new HttpError(400, "Could not load at least 2 input images");

    const basePrompt = MULTI_IMAGE_PANORAMA_PROMPT(inputParts.length, aspectRatio);
    let currentPrompt = (job.prompt_used as string | null) || basePrompt;

    const totalAttempts = 1 + MAX_RETRIES;

    for (let attemptNumber = 1; attemptNumber <= totalAttempts; attemptNumber++) {
      const progressBase = Math.min(90, 10 + attemptNumber * 20);

      await updateJob(supabaseAdmin, job_id, {
        status: "running",
        progress_int: progressBase,
        retry_count: attemptNumber - 1,
      });

      const nanoRequestPayload = {
        model: NANO_IMAGE_MODEL,
        attempt_number: attemptNumber,
        aspect_ratio: aspectRatio,
        output_resolution: outputResolution,
        prompt: currentPrompt,
        input_upload_ids: inputUploadIds,
        generationConfig: { responseModalities: ["image", "text"], temperature: 0.8 },
      };

      await emitEvent(
        supabaseAdmin,
        job_id,
        user.id,
        "NANO_REQUEST",
        `Attempt ${attemptNumber}/${totalAttempts}: ${JSON.stringify({ aspect_ratio: aspectRatio, output_resolution: outputResolution, prompt: currentPrompt })}`,
        progressBase
      );

      if (attemptNumber > 1) {
        await emitEvent(supabaseAdmin, job_id, user.id, "RETRY_SENT", `Retry attempt ${attemptNumber} sent`, progressBase);
      }

      const genPayload = {
        contents: [{ role: "user", parts: [...inputParts, { text: currentPrompt }] }],
        generationConfig: { responseModalities: ["image", "text"], temperature: 0.8 },
      };

      const genData = await callGenerateContent(API_NANOBANANA, NANO_IMAGE_MODEL, genPayload);

      let outputBase64: string | null = null;
      let outputMimeType = "image/png";
      for (const part of (genData.candidates?.[0]?.content?.parts || [])) {
        if (part.inlineData?.data) {
          outputBase64 = part.inlineData.data;
          outputMimeType = part.inlineData.mimeType || "image/png";
          break;
        }
      }
      if (!outputBase64) throw new Error("No image generated");

      // Upload output for this attempt (even if QA fails)
      const outputBuffer = Uint8Array.from(atob(outputBase64), (c) => c.charCodeAt(0));
      const fileExt = extensionForMimeType(outputMimeType);
      const outputPath = `${user.id}/${job.project_id}/multi_pano_${job_id}_a${attemptNumber}_${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabaseAdmin.storage
        .from("outputs")
        .upload(outputPath, outputBuffer, { contentType: outputMimeType });
      if (uploadError) throw new Error(`Failed to upload output: ${uploadError.message}`);

      const { data: uploadRecord, error: uploadRecordError } = await supabaseAdmin
        .from("uploads")
        .insert({
          project_id: job.project_id,
          owner_id: user.id,
          bucket: "outputs",
          path: outputPath,
          kind: "output",
          mime_type: outputMimeType,
          original_filename: `multi_pano_${job_id}_a${attemptNumber}.${fileExt}`,
        })
        .select()
        .single();
      if (uploadRecordError || !uploadRecord?.id) throw new Error("Failed to create output record");

      const outputUploadId = uploadRecord.id as string;

      await updateJob(supabaseAdmin, job_id, {
        output_upload_id: outputUploadId,
        status: "qa_running",
        progress_int: Math.min(95, progressBase + 10),
      });

      await emitEvent(
        supabaseAdmin,
        job_id,
        user.id,
        "NANO_OUTPUT",
        `Attempt ${attemptNumber}/${totalAttempts}: output_upload_id=${outputUploadId}`,
        Math.min(95, progressBase + 10)
      );

      await emitEvent(supabaseAdmin, job_id, user.id, "QA_START", `Attempt ${attemptNumber}: AI QA started`, Math.min(96, progressBase + 12));

      let qa: QaResult;
      try {
        qa = await runAiQaWithFallback(
          API_NANOBANANA,
          nanoRequestPayload,
          { base64: outputBase64, mimeType: outputMimeType },
          inputEvidence
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : "QA failed";
        qa = {
          pass: false,
          issues: [{ type: "other", severity: "high", description: msg }],
          summary: "QA could not be completed.",
          corrective_instruction: "Regenerate focusing on removing seams, ghosting, warping, duplicated objects, and smears. Make geometry straight and panorama-safe.",
        };
      }

      const qaIssues = Array.isArray(qa.issues) ? qa.issues : [];
      const qaPass = Boolean(qa.pass);
      const qaSummary = qa.summary || (qaPass ? "PASSED" : "FAILED");
      const corrective = qa.corrective_instruction || "";

      // Persist attempt record
      await (supabaseAdmin as SupabaseClient).from("multi_image_panorama_attempts").insert({
        job_id: job_id,
        owner_id: user.id,
        attempt_number: attemptNumber,
        nano_request_payload: nanoRequestPayload,
        prompt_used: currentPrompt,
        output_upload_id: outputUploadId,
        qa_pass: qaPass,
        qa_issues: qaIssues,
        qa_summary: qaSummary,
        corrective_instruction: corrective || null,
      });

      await updateJob(supabaseAdmin, job_id, {
        qa_summary: qaSummary,
        qa_issues: qaIssues,
      });

      if (qaPass) {
        await emitEvent(supabaseAdmin, job_id, user.id, "QA_PASS", `Attempt ${attemptNumber}: ${qaSummary}`, 98);
        await updateJob(supabaseAdmin, job_id, {
          status: "approved",
          progress_int: 100,
          retry_count: attemptNumber - 1,
        });
        await emitEvent(supabaseAdmin, job_id, user.id, "FINAL_PASS", `Approved after AI QA (attempt ${attemptNumber})`, 100);
        return new Response(JSON.stringify({ success: true, output_upload_id: outputUploadId }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const issuesInline = qaIssues
        .slice(0, 6)
        .map((i) => `${i.type}:${i.severity}`)
        .join(", ");
      await emitEvent(
        supabaseAdmin,
        job_id,
        user.id,
        "QA_FAIL",
        `Attempt ${attemptNumber}: ${qaSummary}${issuesInline ? ` | issues: ${issuesInline}` : ""}`,
        98
      );

      if (attemptNumber < totalAttempts) {
        await emitEvent(supabaseAdmin, job_id, user.id, "RETRY_SCHEDULED", `Retry scheduled (attempt ${attemptNumber + 1}/${totalAttempts})`, 98);
        currentPrompt = `${basePrompt}\n\nFIX ARTIFACTS ONLY:\n${corrective || qaSummary}`;
        continue;
      }

      // Final failure
      await updateJob(supabaseAdmin, job_id, {
        status: "needs_review",
        progress_int: 100,
        retry_count: attemptNumber - 1,
        last_error: "AI QA failed after all attempts",
      });
      await emitEvent(supabaseAdmin, job_id, user.id, "FINAL_FAIL", `AI QA failed after ${totalAttempts} attempts`, 100);

      return new Response(JSON.stringify({ success: false, output_upload_id: outputUploadId }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error("Unexpected completion state");
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Multi-image panorama error:", error);

    if (jobIdForFailure) {
      await supabaseAdmin.from("multi_image_panorama_jobs").update({
        status: "failed",
        last_error: message,
        updated_at: new Date().toISOString(),
      }).eq("id", jobIdForFailure);

    }

    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
