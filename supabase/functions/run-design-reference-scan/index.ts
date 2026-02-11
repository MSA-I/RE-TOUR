// Edge Function: run-design-reference-scan
// Purpose: Step 0.1 - Design Reference Scan ONLY (isolated from Space Scan)
// Date: 2026-02-10

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing Authorization header");
    }

    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const userClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      throw new Error("Unauthorized");
    }

    const { pipeline_id, design_ref_ids } = await req.json();

    if (!pipeline_id) {
      throw new Error("Missing pipeline_id");
    }

    if (!design_ref_ids || !Array.isArray(design_ref_ids) || design_ref_ids.length === 0) {
      throw new Error("Missing or empty design_ref_ids array");
    }

    console.log(`[run-design-reference-scan] Starting for pipeline ${pipeline_id}, ${design_ref_ids.length} references`);

    // Validate pipeline exists and is in correct phase
    const { data: pipeline, error: pipelineError } = await serviceClient
      .from("floorplan_pipelines")
      .select("*")
      .eq("id", pipeline_id)
      .eq("owner_id", user.id)
      .single();

    if (pipelineError || !pipeline) {
      throw new Error("Pipeline not found or access denied");
    }

    // Allow phases: design_reference_pending, design_reference_failed (retry)
    const allowedPhases = ["design_reference_pending", "design_reference_failed"];
    if (!allowedPhases.includes(pipeline.whole_apartment_phase)) {
      throw new Error(`Invalid phase for design reference scan: ${pipeline.whole_apartment_phase}. Expected: ${allowedPhases.join(", ")}`);
    }

    // Set phase to running
    await serviceClient
      .from("floorplan_pipelines")
      .update({ whole_apartment_phase: "design_reference_running" })
      .eq("id", pipeline_id);

    // Load design reference images from uploads table
    const { data: uploads, error: uploadsError } = await serviceClient
      .from("uploads")
      .select("*")
      .in("id", design_ref_ids)
      .eq("owner_id", user.id);

    if (uploadsError || !uploads || uploads.length === 0) {
      throw new Error("Failed to load design reference images");
    }

    console.log(`[run-design-reference-scan] Loaded ${uploads.length} design reference images`);

    // Download images from storage
    const imageData: Array<{ base64: string; mimeType: string; filename: string }> = [];
    for (const upload of uploads) {
      const { data: fileData, error: downloadError } = await serviceClient.storage
        .from(upload.bucket)
        .download(upload.path);

      if (downloadError || !fileData) {
        console.error(`[run-design-reference-scan] Failed to download ${upload.filename}: ${downloadError?.message}`);
        continue;
      }

      const arrayBuffer = await fileData.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      const base64 = btoa(String.fromCharCode(...uint8Array));

      imageData.push({
        base64,
        mimeType: upload.mime_type || "image/jpeg",
        filename: upload.filename,
      });
    }

    if (imageData.length === 0) {
      throw new Error("No images could be loaded from storage");
    }

    // Call AI to analyze style (using Gemini via NanoBanana API)
    const API_NANOBANANA = Deno.env.get("API_NANOBANANA");
    if (!API_NANOBANANA) {
      throw new Error("API_NANOBANANA not configured");
    }

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${API_NANOBANANA}`;

    const prompt = `Analyze these interior design reference images and extract the following information in JSON format:

{
  "design_style": {
    "primary": "Main design style (e.g., Modern, Scandinavian, Industrial)",
    "secondary": ["List of secondary styles or influences"],
    "mood": "Overall mood/feeling (e.g., Cozy, Minimalist, Luxurious)"
  },
  "color_palette": {
    "dominant_colors": ["List of 3-5 dominant colors"],
    "accent_colors": ["List of 2-3 accent colors"],
    "color_temperature": "warm/cool/neutral"
  },
  "materials": {
    "primary_materials": ["List of primary materials (e.g., Wood, Concrete, Glass)"],
    "textures": ["List of textures (e.g., Smooth, Rough, Polished)"],
    "finishes": ["List of finishes (e.g., Matte, Glossy, Natural)"]
  },
  "lighting": {
    "type": "natural/artificial/mixed",
    "characteristics": "Describe lighting characteristics"
  },
  "furniture_style": {
    "shapes": ["Geometric forms (e.g., Curved, Angular, Organic)"],
    "density": "minimalist/moderate/maximalist"
  }
}

Be specific and concise. Focus on style characteristics that can guide AI image generation.`;

    const contentParts = [{ text: prompt }];
    for (const img of imageData) {
      contentParts.push({
        inlineData: {
          mimeType: img.mimeType,
          data: img.base64,
        },
      });
    }

    console.log(`[run-design-reference-scan] Calling Gemini API for style analysis...`);

    const geminiResponse = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: contentParts }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 2000,
        },
      }),
    });

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      throw new Error(`Gemini API error: ${geminiResponse.status} - ${errorText}`);
    }

    const geminiData = await geminiResponse.json();
    const modelText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!modelText) {
      throw new Error("No text response from Gemini API");
    }

    console.log(`[run-design-reference-scan] Received response from Gemini, parsing...`);

    // Extract JSON from model output
    const jsonMatch = modelText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Could not extract JSON from model response");
    }

    const styleData = JSON.parse(jsonMatch[0]);

    // Build style constraints block for Step 2 injection
    const styleConstraintsBlock = buildStyleConstraintsBlock(styleData);

    // Build design reference scan output
    const designReferenceScanOutput = {
      analyzed_at: new Date().toISOString(),
      design_ref_ids: design_ref_ids,
      style_data: styleData,
      style_constraints_block: styleConstraintsBlock,
      summary: `${styleData.design_style?.primary || "Style"} design with ${styleData.color_palette?.color_temperature || "balanced"} color palette and ${styleData.materials?.primary_materials?.join(", ") || "natural"} materials.`,
      _version: 1,
    };

    console.log(`[run-design-reference-scan] Style analysis complete, updating database...`);

    // CRITICAL: Use jsonb_set to ONLY update design_reference_scan path (preserves space_scan)
    const { error: updateError } = await serviceClient.rpc("update_step_output_path", {
      p_pipeline_id: pipeline_id,
      p_path: ["design_reference_scan"],
      p_value: designReferenceScanOutput,
    });

    // Fallback to direct SQL if RPC doesn't exist
    if (updateError) {
      console.warn(`[run-design-reference-scan] RPC failed, using direct UPDATE: ${updateError.message}`);

      const { error: directError } = await serviceClient
        .from("floorplan_pipelines")
        .update({
          whole_apartment_phase: "design_reference_complete",
          design_reference_scan_complete: true,
          design_reference_analyzed_at: new Date().toISOString(),
          step_outputs: serviceClient.rpc("jsonb_set", {
            target: pipeline.step_outputs || {},
            path: ["design_reference_scan"],
            new_value: designReferenceScanOutput,
            create_if_missing: true,
          }),
        })
        .eq("id", pipeline_id);

      if (directError) {
        // Last resort: manual merge
        const updatedOutputs = {
          ...(pipeline.step_outputs || {}),
          design_reference_scan: designReferenceScanOutput,
        };

        const { error: mergeError } = await serviceClient
          .from("floorplan_pipelines")
          .update({
            whole_apartment_phase: "design_reference_complete",
            design_reference_scan_complete: true,
            design_reference_analyzed_at: new Date().toISOString(),
            step_outputs: updatedOutputs,
          })
          .eq("id", pipeline_id);

        if (mergeError) {
          throw new Error(`Failed to update database: ${mergeError.message}`);
        }
      }
    }

    console.log(`[run-design-reference-scan] Complete for pipeline ${pipeline_id}`);

    return new Response(
      JSON.stringify({
        success: true,
        style_data: styleData,
        summary: designReferenceScanOutput.summary,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[run-design-reference-scan] Error: ${message}`);

    // Try to update pipeline to failed state
    try {
      const { pipeline_id } = await req.json();
      if (pipeline_id) {
        const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        await serviceClient.from("floorplan_pipelines").update({
          whole_apartment_phase: "design_reference_failed",
          last_error: message,
          step_outputs: {
            ...(await serviceClient.from("floorplan_pipelines").select("step_outputs").eq("id", pipeline_id).single()).data?.step_outputs,
            design_reference_scan: {
              error: message,
              failed_at: new Date().toISOString(),
            },
          },
        }).eq("id", pipeline_id);
      }
    } catch {
      // Ignore errors in error handler
    }

    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function buildStyleConstraintsBlock(styleData: any): string {
  const lines: string[] = [];

  if (styleData.design_style) {
    lines.push(`DESIGN STYLE: ${styleData.design_style.primary || "Modern"}`);
    if (styleData.design_style.secondary?.length > 0) {
      lines.push(`Influences: ${styleData.design_style.secondary.join(", ")}`);
    }
    if (styleData.design_style.mood) {
      lines.push(`Mood: ${styleData.design_style.mood}`);
    }
  }

  if (styleData.color_palette) {
    if (styleData.color_palette.dominant_colors?.length > 0) {
      lines.push(`COLORS (Dominant): ${styleData.color_palette.dominant_colors.join(", ")}`);
    }
    if (styleData.color_palette.accent_colors?.length > 0) {
      lines.push(`COLORS (Accent): ${styleData.color_palette.accent_colors.join(", ")}`);
    }
    if (styleData.color_palette.color_temperature) {
      lines.push(`Color Temperature: ${styleData.color_palette.color_temperature}`);
    }
  }

  if (styleData.materials) {
    if (styleData.materials.primary_materials?.length > 0) {
      lines.push(`MATERIALS: ${styleData.materials.primary_materials.join(", ")}`);
    }
    if (styleData.materials.textures?.length > 0) {
      lines.push(`Textures: ${styleData.materials.textures.join(", ")}`);
    }
    if (styleData.materials.finishes?.length > 0) {
      lines.push(`Finishes: ${styleData.materials.finishes.join(", ")}`);
    }
  }

  if (styleData.lighting) {
    lines.push(`LIGHTING: ${styleData.lighting.type || "natural"}`);
    if (styleData.lighting.characteristics) {
      lines.push(`Lighting Style: ${styleData.lighting.characteristics}`);
    }
  }

  if (styleData.furniture_style) {
    if (styleData.furniture_style.shapes?.length > 0) {
      lines.push(`FURNITURE SHAPES: ${styleData.furniture_style.shapes.join(", ")}`);
    }
    if (styleData.furniture_style.density) {
      lines.push(`Furniture Density: ${styleData.furniture_style.density}`);
    }
  }

  return lines.join("\n");
}
