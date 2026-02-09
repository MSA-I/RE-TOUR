import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";
import { encode as encodeBase64 } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const API_NANOBANANA = Deno.env.get("API_NANOBANANA");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const TEXT_ANALYSIS_MODEL = "gemini-2.5-pro";

const STYLE_ANALYSIS_PROMPT = `You are an expert interior designer. Analyze the provided design reference image(s) and extract a STRUCTURED STYLE PROFILE.

IMPORTANT: Keep output COMPACT. Limit arrays to 3-5 items max. Total response should be under 1500 characters.

Extract:
1. OVERALL DESIGN STYLE (primary style, 1-2 secondary influences, 3-5 mood keywords)
2. COLOR PALETTE (primary, 2-3 secondary, 2-3 accent colors with hex codes)
3. MATERIAL LANGUAGE (key materials only: flooring, walls, wood_tone, metal_finish, fabrics, stone)
4. LIGHTING MOOD (temperature, intensity, mood)
5. TEXTURE LEVEL (density, 2-3 key elements)
6. STYLE RULES (3-5 do's, 3-5 avoid's)

OUTPUT FORMAT (JSON only, NO markdown, NO code fences):
{
  "design_style": { "primary": "Modern Minimalist", "secondary": ["Scandinavian"], "mood_keywords": ["serene", "airy", "refined"] },
  "color_palette": { "primary": "#F5F5F5", "secondary": ["#E8E8E8", "#D0D0D0"], "accent": ["#4A4A4A"], "temperature": "cool" },
  "materials": { "flooring": "light oak", "walls": "white plaster", "wood_tone": "natural", "metal_finish": "brushed steel", "fabrics": "linen", "stone": "marble" },
  "lighting": { "temperature": "warm white", "intensity": "soft", "mood": "ambient" },
  "texture_level": { "density": "minimal", "key_elements": ["smooth surfaces", "subtle grain"] },
  "style_rules": { "do": ["Use neutral palette", "Keep clean lines", "Add natural light"], "avoid": ["Bold patterns", "Dark colors", "Clutter"] },
  "summary_prompt": "Modern minimalist aesthetic with Scandinavian influences. Emphasizes clean lines, natural materials, and a serene neutral palette."
}

KEEP IT CONCISE: Each array should have 2-5 items MAXIMUM, not 10+. Be specific but brief.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user } } = await supabaseAdmin.auth.getUser(token);
    if (!user) {
      return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { pipeline_id, design_ref_ids } = await req.json();
    if (!pipeline_id || !design_ref_ids?.length) {
      return new Response(JSON.stringify({ ok: false, error: "pipeline_id and design_ref_ids required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: pipeline } = await supabaseAdmin.from("floorplan_pipelines").select("*").eq("id", pipeline_id).eq("owner_id", user.id).single();
    if (!pipeline) {
      return new Response(JSON.stringify({ ok: false, error: "Pipeline not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    await supabaseAdmin.from("floorplan_pipeline_events").insert({ pipeline_id, owner_id: user.id, step_number: 0, type: "style_analysis_start", message: `Analyzing style from ${design_ref_ids.length} reference(s)...`, progress_int: 5 });

    // Load reference images
    const referenceImages: { id: string; base64: string }[] = [];
    const loadErrors: string[] = [];

    for (const refId of design_ref_ids) {
      console.log(`[run-style-analysis] Loading reference image: ${refId}`);
      const { data: upload } = await supabaseAdmin.from("uploads").select("bucket, path").eq("id", refId).eq("owner_id", user.id).single();

      if (!upload) {
        loadErrors.push(`Reference ${refId} not found`);
        continue;
      }

      // 1. Try with transformation
      // Note: Don't specify format to preserve original (Supabase doesn't support 'webp' as output)
      let signedUrl = await supabaseAdmin.storage
        .from(upload.bucket)
        .createSignedUrl(upload.path, 3600, {
          transform: { width: 1600, height: 1600, quality: 60 }
        });

      let response = signedUrl.data?.signedUrl ? await fetch(signedUrl.data.signedUrl) : null;

      // 2. Fallback to raw if transformation fails (e.g. if not enabled on project)
      if (!response || !response.ok) {
        console.log(`[run-style-analysis] Transformation failed or not available for ${refId}, falling back to raw...`);
        signedUrl = await supabaseAdmin.storage.from(upload.bucket).createSignedUrl(upload.path, 3600);
        if (signedUrl.data?.signedUrl) {
          response = await fetch(signedUrl.data.signedUrl);
        }
      }

      if (response && response.ok) {
        try {
          const buffer = await response.arrayBuffer();
          const bytes = new Uint8Array(buffer);
          referenceImages.push({ id: refId, base64: encodeBase64(bytes) });
          console.log(`[run-style-analysis] Successfully loaded reference ${refId}`);
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Unknown error";
          console.error(`[run-style-analysis] Base64 conversion failed for ${refId}:`, msg);
          loadErrors.push(`Failed to process ${refId}: ${msg}`);
        }
      } else {
        const status = response ? response.status : "unknown";
        console.error(`[run-style-analysis] Failed to fetch ${refId}: HTTP ${status}`);
        loadErrors.push(`Failed to download ${refId} (HTTP ${status})`);
      }
    }

    if (!referenceImages.length) {
      console.error("[run-style-analysis] No reference images could be loaded. Errors:", loadErrors);
      return new Response(JSON.stringify({
        ok: false,
        error: "Failed to load reference images",
        details: loadErrors.join(", ")
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (!API_NANOBANANA) throw new Error("API_NANOBANANA not configured");

    await supabaseAdmin.from("floorplan_pipeline_events").insert({ pipeline_id, owner_id: user.id, step_number: 0, type: "style_analysis_running", message: "AI analyzing reference style...", progress_int: 15 });

    // Build parts with images
    const parts: any[] = [{ text: STYLE_ANALYSIS_PROMPT }];
    for (const ref of referenceImages) {
      parts.push({ inlineData: { mimeType: "image/jpeg", data: ref.base64 } });
    }

    const geminiUrl = `${GEMINI_API_BASE}/${TEXT_ANALYSIS_MODEL}:generateContent?key=${API_NANOBANANA}`;
    const aiResponse = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts }], generationConfig: { temperature: 0.3, maxOutputTokens: 4096 } }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("Gemini API error:", aiResponse.status, errorText);
      await supabaseAdmin.from("floorplan_pipeline_events").insert({ pipeline_id, owner_id: user.id, step_number: 0, type: "style_analysis_failed", message: `Style analysis failed: API error ${aiResponse.status}`, progress_int: 20 });
      return new Response(JSON.stringify({ ok: false, error: "AI analysis failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const aiData = await aiResponse.json();
    const responseContent = aiData.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";

    console.log("AI response content length:", responseContent.length);
    console.log("AI response preview:", responseContent.substring(0, 500));

    let styleAnalysis;
    try {
      // Try to extract JSON from markdown code blocks first
      const jsonBlockMatch = responseContent.match(/```(?:json)?\s*([\s\S]*?)```/);
      let jsonStr = jsonBlockMatch ? jsonBlockMatch[1].trim() : responseContent;

      // Try to find the outermost JSON object
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error("No JSON object found in response:", jsonStr.substring(0, 300));
        throw new Error("No JSON object found");
      }

      styleAnalysis = JSON.parse(jsonMatch[0]);

      // Validate we got meaningful data
      if (!styleAnalysis.design_style && !styleAnalysis.color_palette) {
        console.error("Parsed JSON missing expected fields:", JSON.stringify(styleAnalysis).substring(0, 300));
        throw new Error("Parsed JSON missing expected fields");
      }
    } catch (parseError) {
      console.error("Style analysis parse error:", parseError);
      console.error("Raw response:", responseContent.substring(0, 1000));
      await supabaseAdmin.from("floorplan_pipeline_events").insert({ pipeline_id, owner_id: user.id, step_number: 0, type: "style_analysis_failed", message: `Parse error: ${parseError instanceof Error ? parseError.message : "Unknown"}`, progress_int: 20 });
      return new Response(JSON.stringify({ ok: false, error: "Failed to parse style analysis", details: parseError instanceof Error ? parseError.message : "Unknown parse error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Build the style constraints block for Step 2 prompt injection
    const buildStyleConstraintsBlock = (styleData: any): string => {
      let block = "STYLE PROFILE (Extracted from Design References):\n";

      const ds = styleData.design_style;
      if (ds?.primary) {
        block += `\n• Design Style: ${ds.primary}`;
        if (ds.secondary?.length) {
          block += ` with ${ds.secondary.join(", ")} influences`;
        }
      }
      if (ds?.mood_keywords?.length) {
        block += `\n• Mood: ${ds.mood_keywords.join(", ")}`;
      }

      const cp = styleData.color_palette;
      if (cp?.primary) {
        block += `\n• Primary Color: ${cp.primary}`;
        if (cp.secondary?.length) {
          block += `, Secondary: ${cp.secondary.join(", ")}`;
        }
        if (cp.temperature) {
          block += ` (${cp.temperature} temperature)`;
        }
      }

      const mat = styleData.materials;
      if (mat) {
        const matParts: string[] = [];
        if (mat.flooring) matParts.push(`Flooring: ${mat.flooring}`);
        if (mat.walls) matParts.push(`Walls: ${mat.walls}`);
        if (mat.wood_tone) matParts.push(`Wood: ${mat.wood_tone}`);
        if (matParts.length) {
          block += `\n• Materials: ${matParts.join("; ")}`;
        }
      }

      const lt = styleData.lighting;
      if (lt?.mood || lt?.temperature) {
        block += `\n• Lighting: ${lt.mood || ""} ${lt.temperature || ""} ${lt.intensity || ""}`.trim();
      }

      const rules = styleData.style_rules;
      if (rules?.do?.length) {
        block += `\n\nSTYLE RULES - DO:\n${rules.do.map((r: string) => `  ✓ ${r}`).join("\n")}`;
      }
      if (rules?.avoid?.length) {
        block += `\n\nSTYLE RULES - AVOID:\n${rules.avoid.map((r: string) => `  ✗ ${r}`).join("\n")}`;
      }

      return block;
    };

    const styleConstraintsBlock = buildStyleConstraintsBlock(styleAnalysis);

    // Store in step_outputs with the constraints block
    const stepOutputs = (pipeline.step_outputs || {}) as Record<string, any>;
    stepOutputs.reference_style_analysis = {
      analyzed_at: new Date().toISOString(),
      design_ref_ids,
      style_data: styleAnalysis,
      style_constraints_block: styleConstraintsBlock,
      summary: styleAnalysis.summary_prompt
    };

    await supabaseAdmin.from("floorplan_pipelines").update({ step_outputs: stepOutputs, updated_at: new Date().toISOString() }).eq("id", pipeline_id);
    await supabaseAdmin.from("floorplan_pipeline_events").insert({ pipeline_id, owner_id: user.id, step_number: 0, type: "style_analysis_complete", message: `Style analysis complete: ${styleAnalysis.design_style?.primary || "Style extracted"}`, progress_int: 20 });

    return new Response(JSON.stringify({ ok: true, style_analysis: styleAnalysis, style_constraints_block: styleConstraintsBlock, summary: styleAnalysis.summary_prompt }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("Error in run-style-analysis:", error);
    return new Response(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
