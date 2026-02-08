import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Camera presets by room type
const ROOM_CAMERA_PRESETS: Record<string, { name: string; position: string; direction: string; prompt_suffix: string }[]> = {
  living_room: [
    { name: "corner_wide", position: "room corner at 1.6m height", direction: "diagonal across room", prompt_suffix: "wide view capturing seating area and natural light" },
    { name: "sofa_view", position: "behind main seating", direction: "towards focal wall/window", prompt_suffix: "intimate perspective from seating position" },
    { name: "entrance_view", position: "room entrance", direction: "into the room", prompt_suffix: "first impression view entering the space" },
    { name: "window_view", position: "near window", direction: "back into room", prompt_suffix: "natural backlight silhouette composition" },
  ],
  bedroom: [
    { name: "bed_corner", position: "foot of bed corner", direction: "towards headboard", prompt_suffix: "classic bedroom composition with bed centered" },
    { name: "door_view", position: "doorway entrance", direction: "into bedroom", prompt_suffix: "entry perspective showing bed and window" },
    { name: "window_side", position: "beside window", direction: "across bed", prompt_suffix: "side view with natural window light" },
  ],
  kitchen: [
    { name: "counter_view", position: "opposite main counter", direction: "towards appliances", prompt_suffix: "functional view of workspace and storage" },
    { name: "dining_connection", position: "dining area threshold", direction: "into kitchen", prompt_suffix: "open plan connection perspective" },
    { name: "sink_view", position: "near stove", direction: "towards sink/window", prompt_suffix: "chef's perspective of prep area" },
  ],
  bathroom: [
    { name: "door_view", position: "bathroom entrance", direction: "into bathroom", prompt_suffix: "compact full bathroom view" },
    { name: "vanity_view", position: "opposite vanity", direction: "towards mirror", prompt_suffix: "vanity and mirror reflection composition" },
  ],
  dining_room: [
    { name: "table_corner", position: "corner of dining area", direction: "across table", prompt_suffix: "full table setting with overhead lighting" },
    { name: "host_view", position: "head of table position", direction: "down the table", prompt_suffix: "host perspective towards guests" },
  ],
  office: [
    { name: "desk_view", position: "opposite desk", direction: "towards workspace", prompt_suffix: "focused workspace composition" },
    { name: "door_view", position: "office entrance", direction: "into office", prompt_suffix: "professional entry perspective" },
  ],
  hallway: [
    { name: "length_view", position: "hallway end", direction: "down the length", prompt_suffix: "linear perspective through corridor" },
    { name: "junction_view", position: "hallway junction", direction: "towards main connection", prompt_suffix: "transitional space perspective" },
  ],
  default: [
    { name: "corner_wide", position: "room corner at 1.6m height", direction: "diagonal across room", prompt_suffix: "comprehensive room overview" },
    { name: "entrance_view", position: "room entrance", direction: "into the room", prompt_suffix: "entry perspective" },
    { name: "opposite_corner", position: "opposite corner", direction: "back across room", prompt_suffix: "alternate angle coverage" },
  ],
};

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

    // Get room sub-pipeline
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

    // Update status to generating
    await supabase
      .from("room_sub_pipelines")
      .update({ status: "generating_cameras" })
      .eq("id", room_sub_pipeline_id);

    await emitEvent(supabase, room_sub_pipeline_id, user.id, "cameras", "info", 
      `Starting camera batch for ${roomSubPipeline.room_type}...`, 5);

    // Get the global 3D render (geometry reference)
    if (!pipeline.global_3d_render_id) {
      throw new Error("Global 3D render not found. Complete Step 1 first.");
    }

    const { data: geometryRef, error: geoError } = await supabase
      .from("uploads")
      .select("*")
      .eq("id", pipeline.global_3d_render_id)
      .single();

    if (geoError || !geometryRef) {
      throw new Error("Geometry reference image not found");
    }

    // Get signed URL for geometry reference
    const { data: geoSignedData } = await supabase.storage
      .from(geometryRef.bucket)
      .createSignedUrl(geometryRef.path, 3600);

    if (!geoSignedData?.signedUrl) {
      throw new Error("Failed to access geometry reference");
    }

    // Fetch geometry image
    const geoImageResponse = await fetch(geoSignedData.signedUrl);
    const geoImageArrayBuffer = await geoImageResponse.arrayBuffer();
    const geoImageBase64 = encode(geoImageArrayBuffer);

    // Get camera presets for this room type
    const presets = ROOM_CAMERA_PRESETS[roomSubPipeline.room_type] || ROOM_CAMERA_PRESETS.default;
    const styleBible = pipeline.global_style_bible || {};
    const stylePrompt = styleBible.unified_prompt || "";

    const cameraRenders: {
      upload_id: string;
      camera_preset: string;
      prompt_used: string;
      qa_decision: string;
      created_at: string;
    }[] = [];

    await emitEvent(supabase, room_sub_pipeline_id, user.id, "cameras", "info", 
      `Generating ${presets.length} camera angles...`, 10);

    // Generate each camera angle
    for (let i = 0; i < presets.length; i++) {
      const preset = presets[i];
      const progress = 10 + Math.floor((i / presets.length) * 80);

      await emitEvent(supabase, room_sub_pipeline_id, user.id, "cameras", "info", 
        `Rendering camera ${i + 1}/${presets.length}: ${preset.name}`, progress);

      const prompt = `Transform this top-down 3D architectural visualization into a photorealistic eye-level interior render.

CAMERA SETUP:
- Position: ${preset.position}
- Looking: ${preset.direction}
- Height: Eye-level (approximately 1.6 meters)
- Lens: Natural perspective, no distortion

ROOM: ${roomSubPipeline.room_type}${roomSubPipeline.room_label ? ` (${roomSubPipeline.room_label})` : ""}

STYLE: ${stylePrompt || "Contemporary interior with natural materials and balanced lighting"}

COMPOSITION: ${preset.prompt_suffix}

REQUIREMENTS:
- Maintain exact room geometry and proportions from the reference
- Apply consistent materials and finishes throughout
- Natural lighting through windows where present
- No text, labels, or dimensions
- Photorealistic quality`;

      try {
        // Call Nano Banana API
        const nanoBananaResponse = await fetch(
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp-image-generation:generateContent",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": nanoBananaKey,
            },
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    { text: prompt },
                    {
                      inlineData: {
                        mimeType: "image/jpeg",
                        data: geoImageBase64,
                      },
                    },
                  ],
                },
              ],
              generationConfig: {
                responseModalities: ["image", "text"],
                responseMimeType: "image/jpeg",
              },
            }),
          }
        );

        if (!nanoBananaResponse.ok) {
          console.error(`Camera ${i + 1} generation failed:`, await nanoBananaResponse.text());
          continue;
        }

        const nanoBananaData = await nanoBananaResponse.json();
        const parts = nanoBananaData.candidates?.[0]?.content?.parts || [];
        // deno-lint-ignore no-explicit-any
        const imagePart = parts.find((p: any) => p.inlineData?.data);

        if (!imagePart?.inlineData?.data) {
          console.error(`No image in response for camera ${i + 1}`);
          continue;
        }

        // Decode and upload the image
        const imageData = Uint8Array.from(atob(imagePart.inlineData.data), c => c.charCodeAt(0));
        const fileName = `${user.id}/${pipeline.id}/room_${roomSubPipeline.room_id}_camera_${preset.name}_${Date.now()}.jpg`;

        const { error: uploadError } = await supabase.storage
          .from("outputs")
          .upload(fileName, imageData, { contentType: "image/jpeg" });

        if (uploadError) {
          console.error(`Failed to upload camera ${i + 1}:`, uploadError);
          continue;
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
            original_filename: `${roomSubPipeline.room_type}_${preset.name}.jpg`,
            mime_type: "image/jpeg",
            size_bytes: imageData.length,
          })
          .select()
          .single();

        if (recordError || !uploadRecord) {
          console.error(`Failed to create upload record for camera ${i + 1}:`, recordError);
          continue;
        }

        cameraRenders.push({
          upload_id: uploadRecord.id,
          camera_preset: preset.name,
          prompt_used: prompt,
          qa_decision: "pending",
          created_at: new Date().toISOString(),
        });

      } catch (cameraError) {
        console.error(`Error generating camera ${i + 1}:`, cameraError);
      }
    }

    if (cameraRenders.length === 0) {
      await supabase
        .from("room_sub_pipelines")
        .update({ status: "failed" })
        .eq("id", room_sub_pipeline_id);

      await emitEvent(supabase, room_sub_pipeline_id, user.id, "cameras", "error", 
        "Failed to generate any camera renders", 0);

      throw new Error("Failed to generate any camera renders");
    }

    // Update room sub-pipeline with camera renders
    await supabase
      .from("room_sub_pipelines")
      .update({ 
        status: "cameras_review",
        camera_renders: cameraRenders,
      })
      .eq("id", room_sub_pipeline_id);

    await emitEvent(supabase, room_sub_pipeline_id, user.id, "cameras", "success", 
      `Generated ${cameraRenders.length}/${presets.length} camera renders`, 100);

    console.log(`Camera batch complete for room ${roomSubPipeline.room_id}: ${cameraRenders.length} renders`);

    return new Response(JSON.stringify({
      success: true,
      renders_generated: cameraRenders.length,
      renders_attempted: presets.length,
      camera_renders: cameraRenders,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Error in run-room-camera-batch:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
