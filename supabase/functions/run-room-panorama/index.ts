import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ROOM_PANORAMA_PROMPT = `You are generating a 360° equirectangular panorama for a SINGLE ROOM based on multiple camera angle reference images.

CRITICAL RULES - EVIDENCE-BASED GENERATION:
1. ONLY use geometry, furniture, and materials that are VISIBLE in the provided camera renders
2. DO NOT invent, hallucinate, or add ANY elements not shown in the references
3. If a wall or area is not visible in any reference, leave it neutral/undefined rather than guessing
4. Maintain EXACT proportions and spatial relationships from the camera renders
5. The panorama MUST be seamless when wrapped as a 360° sphere

ROOM TYPE: {ROOM_TYPE}
ROOM LABEL: {ROOM_LABEL}

STYLE CONTEXT: {STYLE_PROMPT}

TECHNICAL REQUIREMENTS:
- Output: 360° equirectangular panorama format (2:1 aspect ratio)
- Seamless horizontal wrap (left edge connects to right edge)
- Consistent lighting direction across the entire panorama
- Eye-level perspective (approximately 1.6m height)
- No visible seams or discontinuities

The provided images show different camera angles of the SAME room. Synthesize them into a coherent 360° view that could be experienced in VR.`;

// deno-lint-ignore no-explicit-any
async function emitEvent(
  supabase: any,
  roomSubPipelineId: string,
  ownerId: string,
  stepType: string,
  type: string,
  message: string,
  progress: number
) {
  await supabase.from("room_sub_pipeline_events").insert({
    room_sub_pipeline_id: roomSubPipelineId,
    owner_id: ownerId,
    step_type: stepType,
    type,
    message,
    progress_int: progress,
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const nanoBananaKey = Deno.env.get("API_NANOBANANA");

    if (!nanoBananaKey) {
      return new Response(JSON.stringify({ error: "Nano Banana API key not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const { room_sub_pipeline_id } = await req.json();

    if (!room_sub_pipeline_id) {
      return new Response(JSON.stringify({ error: "room_sub_pipeline_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify user
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get room sub-pipeline with parent pipeline
    const { data: roomSubPipeline, error: roomError } = await supabase
      .from("room_sub_pipelines")
      .select("*, floorplan_pipelines!inner(*)")
      .eq("id", room_sub_pipeline_id)
      .eq("owner_id", user.id)
      .single();

    if (roomError || !roomSubPipeline) {
      return new Response(JSON.stringify({ error: "Room sub-pipeline not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // deno-lint-ignore no-explicit-any
    const pipeline = roomSubPipeline.floorplan_pipelines as any;
    const cameraRenders = (roomSubPipeline.camera_renders || []) as {
      upload_id: string;
      camera_preset: string;
      qa_decision: string;
    }[];

    // Filter to only approved renders (or all if none reviewed yet)
    const approvedRenders = cameraRenders.filter(r => r.qa_decision === "approved");
    const rendersToUse = approvedRenders.length > 0 ? approvedRenders : cameraRenders;

    if (rendersToUse.length === 0) {
      throw new Error("No camera renders available for panorama generation");
    }

    // Update status
    await supabase
      .from("room_sub_pipelines")
      .update({ status: "generating_panorama" })
      .eq("id", room_sub_pipeline_id);

    await emitEvent(supabase, room_sub_pipeline_id, user.id, "panorama", "info", 
      `Starting panorama generation from ${rendersToUse.length} camera renders...`, 10);

    // Fetch all camera render images
    const imageInputs: { data: string; mimeType: string }[] = [];
    
    for (const render of rendersToUse) {
      const { data: upload, error: uploadError } = await supabase
        .from("uploads")
        .select("*")
        .eq("id", render.upload_id)
        .single();

      if (uploadError || !upload) {
        console.error(`Failed to get upload for ${render.upload_id}`);
        continue;
      }

      const { data: signedData } = await supabase.storage
        .from(upload.bucket)
        .createSignedUrl(upload.path, 3600);

      if (!signedData?.signedUrl) {
        continue;
      }

      try {
        const imageResponse = await fetch(signedData.signedUrl);
        const imageArrayBuffer = await imageResponse.arrayBuffer();
        imageInputs.push({
          data: encode(imageArrayBuffer),
          mimeType: "image/jpeg",
        });
      } catch (fetchError) {
        console.error(`Failed to fetch image ${render.upload_id}:`, fetchError);
      }
    }

    if (imageInputs.length === 0) {
      throw new Error("Failed to load any camera render images");
    }

    await emitEvent(supabase, room_sub_pipeline_id, user.id, "panorama", "info", 
      `Loaded ${imageInputs.length} reference images, generating panorama...`, 30);

    // Build the prompt
    const styleBible = pipeline.global_style_bible || {};
    const prompt = ROOM_PANORAMA_PROMPT
      .replace("{ROOM_TYPE}", roomSubPipeline.room_type)
      .replace("{ROOM_LABEL}", roomSubPipeline.room_label || roomSubPipeline.room_type)
      .replace("{STYLE_PROMPT}", styleBible.unified_prompt || "Contemporary interior design");

    // Build the content parts with all images
    const contentParts: ({ text: string } | { inlineData: { mimeType: string; data: string } })[] = [
      { text: prompt },
    ];

    for (const img of imageInputs) {
      contentParts.push({
        inlineData: {
          mimeType: img.mimeType,
          data: img.data,
        },
      });
    }

    // Call Nano Banana for panorama generation
    await emitEvent(supabase, room_sub_pipeline_id, user.id, "panorama", "info", 
      "Generating 360° panorama...", 50);

    const nanoBananaResponse = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp-image-generation:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": nanoBananaKey,
        },
        body: JSON.stringify({
          contents: [{ parts: contentParts }],
          generationConfig: {
            responseModalities: ["image", "text"],
            responseMimeType: "image/jpeg",
          },
        }),
      }
    );

    if (!nanoBananaResponse.ok) {
      const errorText = await nanoBananaResponse.text();
      console.error("Nano Banana error:", errorText);
      await emitEvent(supabase, room_sub_pipeline_id, user.id, "panorama", "error", 
        `Panorama generation failed: ${nanoBananaResponse.status}`, 0);
      throw new Error(`Panorama generation failed: ${nanoBananaResponse.status}`);
    }

    const nanoBananaData = await nanoBananaResponse.json();
    const parts = nanoBananaData.candidates?.[0]?.content?.parts || [];
    // deno-lint-ignore no-explicit-any
    const imagePart = parts.find((p: any) => p.inlineData?.data);

    if (!imagePart?.inlineData?.data) {
      throw new Error("No panorama image in response");
    }

    await emitEvent(supabase, room_sub_pipeline_id, user.id, "panorama", "info", 
      "Uploading panorama...", 80);

    // Decode and upload panorama
    const panoramaData = Uint8Array.from(atob(imagePart.inlineData.data), c => c.charCodeAt(0));
    const fileName = `${user.id}/${pipeline.id}/room_${roomSubPipeline.room_id}_panorama_${Date.now()}.jpg`;

    const { error: uploadError } = await supabase.storage
      .from("outputs")
      .upload(fileName, panoramaData, { contentType: "image/jpeg" });

    if (uploadError) {
      throw new Error(`Failed to upload panorama: ${uploadError.message}`);
    }

    // Create upload record
    const { data: uploadRecord, error: recordError } = await supabase
      .from("uploads")
      .insert({
        project_id: pipeline.project_id,
        owner_id: user.id,
        kind: "output",
        bucket: "outputs",
        path: fileName,
        original_filename: `${roomSubPipeline.room_type}_panorama.jpg`,
        mime_type: "image/jpeg",
        size_bytes: panoramaData.length,
      })
      .select()
      .single();

    if (recordError || !uploadRecord) {
      throw new Error("Failed to create panorama upload record");
    }

    // Update room sub-pipeline
    await supabase
      .from("room_sub_pipelines")
      .update({
        status: "completed",
        panorama_upload_id: uploadRecord.id,
        panorama_qa_decision: "pending",
      })
      .eq("id", room_sub_pipeline_id);

    await emitEvent(supabase, room_sub_pipeline_id, user.id, "panorama", "success", 
      "Room panorama generated successfully!", 100);

    console.log(`Panorama complete for room ${roomSubPipeline.room_id}`);

    return new Response(JSON.stringify({
      success: true,
      panorama_upload_id: uploadRecord.id,
      room_id: roomSubPipeline.room_id,
      room_type: roomSubPipeline.room_type,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Error in run-room-panorama:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
