import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";
import { encode as encodeBase64 } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const API_NANOBANANA = Deno.env.get("API_NANOBANANA");
const API_OPENAI = Deno.env.get("API_OPENAI");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Prompt templates for each step (4 steps now - removed Approval Gate)
const STEP_TEMPLATES = {
  1: `Convert the uploaded 2D floor plan into a clean, top-down 3D render.

STRICT REQUIREMENTS:
- KEEP THE LAYOUT EXACT.
- Do NOT change wall positions, room sizes, proportions, or orientation.
- Doors and openings must remain in the same locations as in the plan.
- No creative reinterpretation of geometry.

RENDER STYLE:
- Top-down 3D perspective (architectural axonometric feel).
- Simple, realistic furniture matching each room's function.
- Neutral modern materials.
- Soft, even daylight.
- Clean background, no clutter.

GOAL:
A clear and accurate 3D visualization that faithfully represents the original 2D floor plan.`,

  2: `Apply a DESIGN STYLE CHANGE to the interior render based on the input image.

DESIGN STYLE FOCUS (Step 2 is strictly about design, not camera):
- Apply the desired interior design aesthetic
- Update materials, finishes, and textures as specified
- Adjust color palette and lighting mood
- Ensure furniture style consistency with the chosen aesthetic
- Maintain photorealistic quality throughout

CRITICAL - DO NOT CHANGE:
- Room geometry, proportions, or layout
- Wall positions, doors, windows locations
- Camera angle or perspective (keep same as input)
- Overall furniture placement (only change style, not position)

GOAL:
Transform the visual design style while preserving the exact spatial configuration and camera view from the input.`,

  4: (cameraPosition: string, forwardDirection: string) => `Using the provided image as the ONLY reference, generate a photorealistic 360° equirectangular interior panorama.

Camera:
- Height: standing eye level (~1.6m)
- Position: ${cameraPosition}

Primary forward direction (0° yaw):
- Facing ${forwardDirection}

Preserve exactly (no redesign, no replacements):
- All furniture visible in the reference image
- All fixed elements (windows, doors, columns)
- Floor material and wood plank direction
- Wall curvature, room proportions, ceiling height

Do NOT add, remove, or reinterpret any elements.

Lighting:
- Natural daylight from windows
- Physically correct light direction and realistic falloff
- No dramatic or artificial lighting

Panorama requirements:
- True 360° equirectangular panorama (2:1)
- No fisheye circle
- No warped geometry
- Straight verticals and correct perspective
- Suitable for virtual tour viewers

Style:
- Photorealistic interior
- Real-world scale and materials
- Neutral camera, human-eye perspective`
};

// Step 3 Camera Presets - EYE-LEVEL ONLY (no corner, top-down, or overview shots)
const STEP_3_CAMERA_PRESETS = [
  {
    id: "eye_level_living_room",
    name: "Eye-Level – Living Room",
    viewpoint: "eye-level",
    yaw_target: "living_room",
    framing: "normal",
    height: "eye-level",
    prompt: `Generate a photorealistic interior render from EYE-LEVEL in the living room.

CAMERA REQUIREMENTS:
- Position: Standing eye-level (150-160 cm) in the living room area
- Yaw: Looking toward the main seating arrangement and focal point
- Lens: Normal focal length (40-50mm equivalent) for natural perspective
- Height: MUST be eye-level (150-160 cm) - NOT top-down, NOT corner, NOT overhead

SCENE REQUIREMENTS:
- Maintain EXACT geometry, furniture placement, and proportions from the input
- DO NOT move, resize, or add any furniture
- Photorealistic lighting with natural daylight
- Clean, professional interior photography style

OUTPUT:
A single high-quality photorealistic interior photograph from eye-level in the living room.`
  },
  {
    id: "eye_level_kitchen",
    name: "Eye-Level – Kitchen",
    viewpoint: "eye-level",
    yaw_target: "kitchen",
    framing: "normal",
    height: "eye-level",
    prompt: `Generate a photorealistic interior render from EYE-LEVEL in the kitchen.

CAMERA REQUIREMENTS:
- Position: Standing eye-level (150-160 cm) in or near the kitchen
- Yaw: Looking toward the kitchen counter, island, or cooking area
- Lens: Normal focal length (40-50mm equivalent) for natural perspective
- Height: MUST be eye-level (150-160 cm) - NOT top-down, NOT corner, NOT overhead

SCENE REQUIREMENTS:
- Maintain EXACT geometry, furniture placement, and proportions from the input
- DO NOT move, resize, or add any furniture
- Photorealistic lighting with natural daylight
- Clean, professional interior photography style

OUTPUT:
A single high-quality photorealistic interior photograph from eye-level in the kitchen.`
  },
  {
    id: "eye_level_dining",
    name: "Eye-Level – Dining Area",
    viewpoint: "eye-level",
    yaw_target: "dining",
    framing: "normal",
    height: "eye-level",
    prompt: `Generate a photorealistic interior render from EYE-LEVEL at the dining area.

CAMERA REQUIREMENTS:
- Position: Standing eye-level (150-160 cm) near the dining table
- Yaw: Looking toward the dining setup with table and chairs visible
- Lens: Normal focal length (40-50mm equivalent) for natural perspective
- Height: MUST be eye-level (150-160 cm) - NOT top-down, NOT corner, NOT overhead

SCENE REQUIREMENTS:
- Maintain EXACT geometry, furniture placement, and proportions from the input
- DO NOT move, resize, or add any furniture
- Photorealistic lighting with natural daylight
- Clean, professional interior photography style

OUTPUT:
A single high-quality photorealistic interior photograph from eye-level at the dining area.`
  },
  {
    id: "eye_level_bedroom",
    name: "Eye-Level – Bedroom",
    viewpoint: "eye-level",
    yaw_target: "bedroom",
    framing: "normal",
    height: "eye-level",
    prompt: `Generate a photorealistic interior render from EYE-LEVEL in the bedroom.

CAMERA REQUIREMENTS:
- Position: Standing eye-level (150-160 cm) in the bedroom
- Yaw: Looking toward the bed and main sleeping area
- Lens: Normal focal length (40-50mm equivalent) for natural perspective
- Height: MUST be eye-level (150-160 cm) - NOT top-down, NOT corner, NOT overhead

SCENE REQUIREMENTS:
- Maintain EXACT geometry, furniture placement, and proportions from the input
- DO NOT move, resize, or add any furniture
- Photorealistic lighting with natural daylight
- Clean, professional interior photography style

OUTPUT:
A single high-quality photorealistic interior photograph from eye-level in the bedroom.`
  },
  {
    id: "eye_level_corridor",
    name: "Eye-Level – Corridor",
    viewpoint: "eye-level",
    yaw_target: "corridor",
    framing: "normal",
    height: "eye-level",
    prompt: `Generate a photorealistic interior render from EYE-LEVEL in the corridor/hallway.

CAMERA REQUIREMENTS:
- Position: Standing eye-level (150-160 cm) in the corridor or hallway
- Yaw: Looking down the length of the corridor
- Lens: Normal focal length (40-50mm equivalent) for natural perspective
- Height: MUST be eye-level (150-160 cm) - NOT top-down, NOT corner, NOT overhead

SCENE REQUIREMENTS:
- Maintain EXACT geometry, furniture placement, and proportions from the input
- DO NOT move, resize, or add any furniture
- Photorealistic lighting with natural daylight
- Clean, professional interior photography style

OUTPUT:
A single high-quality photorealistic interior photograph from eye-level in the corridor.`
  },
  {
    id: "eye_level_entrance",
    name: "Eye-Level – Entrance",
    viewpoint: "eye-level",
    yaw_target: "entrance",
    framing: "normal",
    height: "eye-level",
    prompt: `Generate a photorealistic interior render from EYE-LEVEL at the entrance.

CAMERA REQUIREMENTS:
- Position: Standing eye-level (150-160 cm) near the entrance/foyer
- Yaw: Looking into the main living space from the entrance perspective
- Lens: Normal focal length (40-50mm equivalent) for natural perspective
- Height: MUST be eye-level (150-160 cm) - NOT top-down, NOT corner, NOT overhead

SCENE REQUIREMENTS:
- Maintain EXACT geometry, furniture placement, and proportions from the input
- DO NOT move, resize, or add any furniture
- Photorealistic lighting with natural daylight
- Clean, professional interior photography style

OUTPUT:
A single high-quality photorealistic interior photograph from eye-level at the entrance.`
  }
];

// Parse rejection reason to determine camera adjustment strategy
function parseRejectionReason(reason: string): {
  changeViewpoint: boolean;
  changeYaw: boolean;
  changeFraming: boolean;
  suggestedChange: string;
} {
  const lower = reason.toLowerCase();
  
  if (lower.includes("same angle") || lower.includes("too similar") || lower.includes("identical")) {
    return { changeViewpoint: true, changeYaw: true, changeFraming: false, suggestedChange: "different_viewpoint" };
  }
  if (lower.includes("zoomed") || lower.includes("too close") || lower.includes("cramped")) {
    return { changeViewpoint: false, changeYaw: false, changeFraming: true, suggestedChange: "wider_framing" };
  }
  if (lower.includes("wrong focus") || lower.includes("facing wrong") || lower.includes("look at")) {
    return { changeViewpoint: false, changeYaw: true, changeFraming: false, suggestedChange: "different_yaw" };
  }
  if (lower.includes("not realistic") || lower.includes("distorted")) {
    return { changeViewpoint: false, changeYaw: false, changeFraming: true, suggestedChange: "normal_lens" };
  }
  
  // Default: change at least viewpoint and yaw
  return { changeViewpoint: true, changeYaw: true, changeFraming: false, suggestedChange: "full_change" };
}

// Select next camera preset avoiding previously used ones
function selectStep3CameraPreset(
  usedPresetIds: string[],
  rejectionReason?: string
): typeof STEP_3_CAMERA_PRESETS[0] | null {
  const availablePresets = STEP_3_CAMERA_PRESETS.filter(p => !usedPresetIds.includes(p.id));
  
  if (availablePresets.length === 0) {
    console.log("[Step 3] All presets exhausted, cycling with increased variation");
    // Reset and use first available with modified prompt
    return STEP_3_CAMERA_PRESETS[0];
  }
  
  if (rejectionReason) {
    const adjustments = parseRejectionReason(rejectionReason);
    console.log(`[Step 3] Rejection analysis:`, adjustments);
    
    // Find a preset that differs in the required ways
    const lastUsed = STEP_3_CAMERA_PRESETS.find(p => p.id === usedPresetIds[usedPresetIds.length - 1]);
    if (lastUsed) {
      for (const preset of availablePresets) {
        let changes = 0;
        if (adjustments.changeViewpoint && preset.viewpoint !== lastUsed.viewpoint) changes++;
        if (adjustments.changeYaw && preset.yaw_target !== lastUsed.yaw_target) changes++;
        if (adjustments.changeFraming && preset.framing !== lastUsed.framing) changes++;
        
        // Must change at least 2 parameters
        if (changes >= 2) {
          console.log(`[Step 3] Selected preset ${preset.id} with ${changes} changes from previous`);
          return preset;
        }
      }
    }
  }
  
  // Default: return first available
  console.log(`[Step 3] Using first available preset: ${availablePresets[0].id}`);
  return availablePresets[0];
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    // Get user from auth header
    const supabaseUser = createClient(
      SUPABASE_URL,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      throw new Error("Unauthorized");
    }

    const { pipeline_id, camera_position, forward_direction, design_ref_upload_ids, style_title, output_count, auto_rerender_attempt, step_3_preset_id, step_3_custom_prompt } = await req.json();

    if (!pipeline_id) {
      throw new Error("pipeline_id is required");
    }
    
    // Validate design_ref_upload_ids if provided
    const designRefIds: string[] = Array.isArray(design_ref_upload_ids) ? design_ref_upload_ids : [];
    
    // Style title for Step 2 (human-readable name from suggestion selection)
    const selectedStyleTitle: string | null = style_title || null;
    
    // Number of outputs to generate (1-4 for Steps 2, 3, 4; always 1 for Step 1)
    const requestedOutputCount = Math.max(1, Math.min(4, parseInt(output_count) || 1));
    
    // Auto-rerender tracking for panorama QA rejection
    const MAX_AUTO_RERENDER_ATTEMPTS = 4;
    const currentAutoAttempt = parseInt(auto_rerender_attempt) || 0;

    // Get pipeline
    const { data: pipeline, error: pipelineError } = await supabaseAdmin
      .from("floorplan_pipelines")
      .select("*, floor_plan:uploads!floorplan_pipelines_floor_plan_upload_id_fkey(*)")
      .eq("id", pipeline_id)
      .eq("owner_id", user.id)
      .single();

    if (pipelineError || !pipeline) {
      throw new Error("Pipeline not found");
    }

    const currentStep = pipeline.current_step;
    console.log(`[run-pipeline-step] Pipeline ${pipeline_id}: Starting step ${currentStep}`);

    // For step 4, derive camera position from previous step outputs or use sensible defaults
    let effectiveCameraPosition = camera_position || pipeline.camera_position;
    let effectiveForwardDirection = forward_direction || pipeline.forward_direction;
    
    if (currentStep === 4 && (!effectiveCameraPosition || !effectiveForwardDirection)) {
      // Derive from Step 3 output if available
      const outputs = pipeline.step_outputs as Record<string, any> || {};
      const step3Output = outputs["step3"];
      
      if (step3Output?.camera_angle) {
        // Use camera angle info from Step 3 to derive position (now eye-level only)
        const cameraInfo = (step3Output.camera_angle || "").toLowerCase();
        console.log(`[Step 4] Deriving camera from Step 3 camera angle: ${cameraInfo}`);
        
        // Map eye-level room areas to panorama positions
        if (cameraInfo.includes("living")) {
          effectiveCameraPosition = effectiveCameraPosition || "center of the living room at eye-level";
          effectiveForwardDirection = effectiveForwardDirection || "toward the main seating area";
        } else if (cameraInfo.includes("kitchen")) {
          effectiveCameraPosition = effectiveCameraPosition || "center of the kitchen at eye-level";
          effectiveForwardDirection = effectiveForwardDirection || "toward the kitchen counter/island";
        } else if (cameraInfo.includes("dining")) {
          effectiveCameraPosition = effectiveCameraPosition || "near the dining table at eye-level";
          effectiveForwardDirection = effectiveForwardDirection || "toward the main living space";
        } else if (cameraInfo.includes("bedroom")) {
          effectiveCameraPosition = effectiveCameraPosition || "center of the bedroom at eye-level";
          effectiveForwardDirection = effectiveForwardDirection || "toward the bed and main area";
        } else if (cameraInfo.includes("corridor") || cameraInfo.includes("hallway")) {
          effectiveCameraPosition = effectiveCameraPosition || "midpoint of the corridor at eye-level";
          effectiveForwardDirection = effectiveForwardDirection || "down the length of the corridor";
        } else if (cameraInfo.includes("entrance")) {
          effectiveCameraPosition = effectiveCameraPosition || "near room entrance at eye-level";
          effectiveForwardDirection = effectiveForwardDirection || "straight into the main living space";
        } else {
          effectiveCameraPosition = effectiveCameraPosition || "center of the main room at eye-level";
          effectiveForwardDirection = effectiveForwardDirection || "toward the primary focal point";
        }
      } else {
        // Sensible defaults for panorama
        effectiveCameraPosition = effectiveCameraPosition || "center of the main living space at eye-level";
        effectiveForwardDirection = effectiveForwardDirection || "toward the main window or feature wall";
      }
      
      console.log(`[Step 4] Using camera position: ${effectiveCameraPosition}, forward: ${effectiveForwardDirection}`);
    }

    // Update pipeline status to running
    await supabaseAdmin
      .from("floorplan_pipelines")
      .update({ 
        status: `step${currentStep}_running`,
        camera_position: effectiveCameraPosition || pipeline.camera_position,
        forward_direction: effectiveForwardDirection || pipeline.forward_direction,
        updated_at: new Date().toISOString()
      })
      .eq("id", pipeline_id);

    await emitEvent(supabaseAdmin, pipeline_id, user.id, currentStep, "step_start", `Step ${currentStep} started`, (currentStep - 1) * 25);

    // Get input image (floor plan for step 1, previous step output for others)
    let inputUploadId: string;
    if (currentStep === 1) {
      inputUploadId = pipeline.floor_plan_upload_id;
      console.log(`[run-pipeline-step] Step 1: Using floor plan upload ${inputUploadId}`);
    } else {
      // For step 2+, get the previous completed step's output
      // Handle skipped steps: walk backwards to find the most recent valid output
      const outputs = pipeline.step_outputs as Record<string, any> || {};
      console.log(`[run-pipeline-step] Step ${currentStep}: Looking for previous step output in:`, JSON.stringify(outputs));
      
      let prevStepOutput: string | null = null;
      let usedStepNumber = 0;
      
      // Walk backwards from the previous step to find a valid output
      for (let stepNum = currentStep - 1; stepNum >= 1; stepNum--) {
        const stepData = outputs[`step${stepNum}`];
        if (stepData?.output_upload_id) {
          prevStepOutput = stepData.output_upload_id;
          usedStepNumber = stepNum;
          
          // Check if this step was skipped forward (meaning we should use its output)
          if (stepData.skipped_forward) {
            console.log(`[run-pipeline-step] Step ${stepNum} was skipped forward, using its output`);
          }
          break;
        }
      }
      
      if (!prevStepOutput) {
        console.error(`[run-pipeline-step] No valid previous step output found for step ${currentStep}`);
        throw new Error(`No previous step output found. Please ensure at least step 1 has completed successfully.`);
      }
      
      inputUploadId = prevStepOutput;
      console.log(`[run-pipeline-step] Step ${currentStep}: Using step ${usedStepNumber} output ${inputUploadId}`);
    }

    // Get signed URL for input image
    const { data: inputUpload } = await supabaseAdmin
      .from("uploads")
      .select("bucket, path")
      .eq("id", inputUploadId)
      .single();

    if (!inputUpload) {
      throw new Error("Input image not found");
    }

    const { data: signedUrlData } = await supabaseAdmin.storage
      .from(inputUpload.bucket)
      .createSignedUrl(inputUpload.path, 3600);

    if (!signedUrlData?.signedUrl) {
      throw new Error("Failed to get signed URL for input image");
    }

    await emitEvent(supabaseAdmin, pipeline_id, user.id, currentStep, "download_complete", "Input image loaded", (currentStep - 1) * 25 + 5);

    // Download image
    const imageResponse = await fetch(signedUrlData.signedUrl);
    const imageBlob = await imageResponse.blob();
    const imageBuffer = await imageBlob.arrayBuffer();
    // Use chunked encoding to avoid stack overflow with large images
    const base64Image = encodeBase64(imageBuffer);

    // Get prompt for current step
    let prompt: string;
    let selectedPresetId: string | null = null;
    
    if (currentStep === 4) {
      prompt = (STEP_TEMPLATES[4] as Function)(effectiveCameraPosition, effectiveForwardDirection);
    } else if (currentStep === 3) {
      // Step 3: Camera-Angle Render - EYE-LEVEL ONLY
      // Priority: 1) User-selected preset, 2) Custom prompt, 3) Auto-select from remaining presets
      const stepOutputs = pipeline.step_outputs as Record<string, any> || {};
      const step3Data = stepOutputs.step3 || {};
      const usedPresetIds: string[] = step3Data.used_preset_ids || [];
      const lastRejectionReason = step3Data.qa_reason;
      
      // Check if user explicitly selected a preset
      if (step_3_preset_id) {
        const userSelectedPreset = STEP_3_CAMERA_PRESETS.find(p => p.id === step_3_preset_id);
        if (userSelectedPreset) {
          prompt = userSelectedPreset.prompt;
          selectedPresetId = userSelectedPreset.id;
          console.log(`[Step 3] USER SELECTED preset: ${userSelectedPreset.name} (${userSelectedPreset.id})`);
          await emitEvent(supabaseAdmin, pipeline_id, user.id, currentStep, "preset_selected", `User selected: ${userSelectedPreset.name}`, (currentStep - 1) * 25 + 8);
        } else {
          // Invalid preset ID provided - reject rather than silently fallback
          throw new Error(`Invalid Step 3 preset ID: ${step_3_preset_id}. Available presets: ${STEP_3_CAMERA_PRESETS.map(p => p.id).join(", ")}`);
        }
      } else if (step_3_custom_prompt) {
        // User provided a custom prompt - use it directly
        prompt = `${step_3_custom_prompt}

CAMERA REQUIREMENTS (ENFORCED):
- Height: MUST be eye-level (150-160 cm) - NOT top-down, NOT corner, NOT overhead
- Lens: Normal focal length (40-50mm equivalent) for natural perspective
- This is an EYE-LEVEL interior photograph

SCENE REQUIREMENTS:
- Maintain EXACT geometry, furniture placement, and proportions from the input
- DO NOT move, resize, or add any furniture
- Photorealistic lighting with natural daylight`;
        selectedPresetId = "custom";
        console.log(`[Step 3] Using CUSTOM user prompt`);
        await emitEvent(supabaseAdmin, pipeline_id, user.id, currentStep, "custom_prompt", `Using custom camera prompt`, (currentStep - 1) * 25 + 8);
      } else {
        // No user selection - auto-select from available presets (avoiding used ones)
        const selectedPreset = selectStep3CameraPreset(usedPresetIds, lastRejectionReason);
        if (selectedPreset) {
          prompt = selectedPreset.prompt;
          selectedPresetId = selectedPreset.id;
          console.log(`[Step 3] Auto-selected preset: ${selectedPreset.name} (${selectedPreset.id})`);
          await emitEvent(supabaseAdmin, pipeline_id, user.id, currentStep, "preset_selected", `Auto-selected: ${selectedPreset.name}`, (currentStep - 1) * 25 + 8);
        } else {
          // Fallback to generic EYE-LEVEL prompt (no corner/wide views)
          prompt = `Generate a photorealistic interior render from EYE-LEVEL.

CAMERA REQUIREMENTS (MANDATORY):
- Height: MUST be eye-level (150-160 cm) - NOT top-down, NOT corner, NOT overhead
- Lens: Normal focal length (40-50mm equivalent) for natural perspective
- Position: Standing naturally in the room at human height

FORBIDDEN:
- NO corner views
- NO top-down/overhead views
- NO wide architectural shots
- NO bird's eye perspective

SCENE REQUIREMENTS:
- Maintain EXACT geometry, furniture placement, and proportions from the input
- Photorealistic lighting with natural daylight

OUTPUT: High-quality professional EYE-LEVEL interior photograph.`;
        }
      }
    } else if (currentStep === 1) {
      prompt = STEP_TEMPLATES[1];
    } else if (currentStep === 2) {
      // Step 2: Design Style Change - may include design references for style transfer
      if (designRefIds.length > 0) {
        console.log(`[run-pipeline-step] Step 2: Using ${designRefIds.length} design reference(s) for style transfer`);
        await emitEvent(supabaseAdmin, pipeline_id, user.id, currentStep, "style_transfer", 
          `Applying style from ${designRefIds.length} reference image(s)`, (currentStep - 1) * 25 + 7);
        
        prompt = `Apply a STYLE TRANSFER to the interior using the provided reference images as design inspiration.

STYLE TRANSFER FOCUS:
- Extract the design aesthetic, materials, color palette, and mood from the reference images
- Apply these visual characteristics to the input interior render
- Blend multiple reference styles harmoniously if multiple references provided
- Maintain photorealistic quality throughout

WHAT TO TRANSFER FROM REFERENCES:
- Color palette and color temperature
- Material finishes (wood tones, metal finishes, fabric textures)
- Lighting mood and ambiance
- Furniture and decor style language
- Overall design aesthetic (modern, minimal, warm, industrial, etc.)

CRITICAL - DO NOT CHANGE:
- Room geometry, proportions, or layout
- Wall positions, doors, windows locations  
- Camera angle or perspective (keep same as input)
- Overall furniture placement (only change style, not position)

GOAL:
Transform the visual design style by borrowing from the reference images while preserving the exact spatial configuration.`;
      } else {
        prompt = STEP_TEMPLATES[2];
      }
    } else {
      throw new Error(`Invalid step number: ${currentStep}`);
    }

    // For Step 2 with design references, load reference images
    let referenceImagesBase64: string[] = [];
    if (currentStep === 2 && designRefIds.length > 0) {
      await emitEvent(supabaseAdmin, pipeline_id, user.id, currentStep, "loading_refs", 
        `Loading ${designRefIds.length} reference image(s)...`, (currentStep - 1) * 25 + 8);
      
      for (const refId of designRefIds) {
        const { data: refUpload } = await supabaseAdmin
          .from("uploads")
          .select("bucket, path")
          .eq("id", refId)
          .single();
        
        if (refUpload) {
          const { data: refSignedUrl } = await supabaseAdmin.storage
            .from(refUpload.bucket)
            .createSignedUrl(refUpload.path, 3600);
          
          if (refSignedUrl?.signedUrl) {
            const refResponse = await fetch(refSignedUrl.signedUrl);
            const refBlob = await refResponse.blob();
            const refBuffer = await refBlob.arrayBuffer();
            const refBase64 = encodeBase64(refBuffer);
            referenceImagesBase64.push(refBase64);
          }
        }
      }
      console.log(`[run-pipeline-step] Loaded ${referenceImagesBase64.length} reference images`);
    }

    // Determine actual output count (Step 1 always produces 1 output)
    const actualOutputCount = currentStep === 1 ? 1 : requestedOutputCount;
    console.log(`[run-pipeline-step] Generating ${actualOutputCount} output(s) for step ${currentStep}`);
    
    await emitEvent(supabaseAdmin, pipeline_id, user.id, currentStep, "api_request", 
      actualOutputCount > 1 
        ? `Generating ${actualOutputCount} outputs...` 
        : referenceImagesBase64.length > 0 
          ? `Sending to AI with ${referenceImagesBase64.length} style reference(s)...` 
          : "Sending to AI...", 
      (currentStep - 1) * 25 + 10);

    // Build message content: text prompt + main image + optional reference images
    const messageContent: any[] = [
      { type: "text", text: prompt },
      {
        type: "image_url",
        image_url: {
          url: `data:image/jpeg;base64,${base64Image}`
        }
      }
    ];

    // Add reference images for Step 2 style transfer
    if (currentStep === 2 && referenceImagesBase64.length > 0) {
      // Add a label for the reference images
      messageContent.push({
        type: "text",
        text: "DESIGN REFERENCE IMAGES (use these as style inspiration):"
      });
      
      for (let i = 0; i < referenceImagesBase64.length; i++) {
        messageContent.push({
          type: "image_url",
          image_url: {
            url: `data:image/jpeg;base64,${referenceImagesBase64[i]}`
          }
        });
      }
    }

    // Multi-output generation loop
    const generatedOutputs: Array<{
      output_upload_id: string;
      qa_decision: string;
      qa_reason: string;
      prompt_used: string;
      variation_index: number;
      camera_angle?: string;
      preset_id?: string;
    }> = [];
    
    const stepOutputs = (pipeline.step_outputs as Record<string, any>) || {};
    const existingStep3Presets = stepOutputs.step3?.used_preset_ids || [];
    let usedPresetIds = [...existingStep3Presets];
    let lastApiError: string | null = null;

    for (let outputIndex = 0; outputIndex < actualOutputCount; outputIndex++) {
      const isMultiOutput = actualOutputCount > 1;
      const outputLabel = isMultiOutput ? ` (${outputIndex + 1}/${actualOutputCount})` : "";
      
      await emitEvent(supabaseAdmin, pipeline_id, user.id, currentStep, "generating", 
        `Generating output${outputLabel}...`, (currentStep - 1) * 25 + 11 + outputIndex);

      // For Step 3 with multiple outputs, select different camera presets
      let currentPrompt = prompt;
      let currentPresetId: string | null = selectedPresetId;
      
      if (currentStep === 3 && isMultiOutput && outputIndex > 0) {
        // Select a different camera preset for each additional output
        const nextPreset = selectStep3CameraPreset(usedPresetIds);
        if (nextPreset) {
          currentPrompt = nextPreset.prompt;
          currentPresetId = nextPreset.id;
          usedPresetIds.push(nextPreset.id);
          console.log(`[Step 3] Output ${outputIndex + 1}: Using camera preset ${nextPreset.name}`);
        }
      }
      
      // Build message for this specific output
      const outputMessageContent = [
        { type: "text", text: currentPrompt },
        ...messageContent.slice(1) // Keep the images
      ];
      
      // For multi-output, add variation instruction
      if (isMultiOutput && currentStep !== 3) {
        const variationInstruction = currentStep === 2 
          ? `\n\nVARIATION ${outputIndex + 1}: Create a unique style interpretation. Vary color tones, material textures, or lighting mood while maintaining the same design direction.`
          : `\n\nVARIATION ${outputIndex + 1}: Create a unique panorama interpretation. Vary the specific details, lighting nuances, or subtle atmosphere changes.`;
        outputMessageContent[0] = { type: "text", text: currentPrompt + variationInstruction };
      }

      // Call Gemini via Google Generative AI API
      if (!API_NANOBANANA) {
        throw new Error("API_NANOBANANA secret not configured");
      }
      
      // Build request with Gemini API format
      const geminiRequestBody = {
        contents: [{
          role: "user",
          parts: [
            { text: outputMessageContent.find((c: any) => c.type === "text")?.text || currentPrompt },
            ...outputMessageContent
              .filter((c: any) => c.type === "image_url")
              .map((c: any) => {
                const url = c.image_url.url;
                const base64Match = url.match(/^data:([^;]+);base64,(.+)$/);
                if (base64Match) {
                  return { inlineData: { mimeType: base64Match[1], data: base64Match[2] } };
                }
                return null;
              })
              .filter(Boolean)
          ],
        }],
        generationConfig: {
          responseModalities: ["Image"],
        },
      };
      
      const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": API_NANOBANANA,
        },
        body: JSON.stringify(geminiRequestBody)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[run-pipeline-step] Gemini API error for output ${outputIndex + 1}:`, errorText);
        
        // Parse specific error types for better user feedback
        try {
          const errorJson = JSON.parse(errorText);
          if (errorJson.type === "payment_required" || errorJson.message?.includes("credits")) {
            // Store specific error for user feedback
            lastApiError = "Not enough AI credits. Please check your billing settings.";
          } else if (errorJson.message) {
            lastApiError = errorJson.message;
          }
        } catch {
          lastApiError = `API error: ${response.status}`;
        }
        
        // Continue with other outputs if one fails
        continue;
      }

      const result = await response.json();
      
      // Parse Gemini API response format
      const candidates = result.candidates;
      if (!candidates || candidates.length === 0) {
        console.error(`[run-pipeline-step] No candidates for output ${outputIndex + 1}`);
        continue;
      }
      
      const parts = candidates[0]?.content?.parts;
      const imagePart = parts?.find((p: any) => p.inlineData?.mimeType?.startsWith("image/"));
      if (!imagePart?.inlineData) {
        console.error(`[run-pipeline-step] No image data for output ${outputIndex + 1}`);
        continue;
      }
      
      const outputBase64 = imagePart.inlineData.data;
      const outputMimeType = imagePart.inlineData.mimeType;

      await emitEvent(supabaseAdmin, pipeline_id, user.id, currentStep, "api_complete", 
        `AI generation complete${outputLabel}`, (currentStep - 1) * 25 + 13 + outputIndex);

      // Upload output
      const outputBuffer = Uint8Array.from(atob(outputBase64), c => c.charCodeAt(0));
      const fileExt = outputMimeType.includes("png") ? "png" : "jpg";
      const outputPath = `${user.id}/${pipeline.project_id}/pipeline_${pipeline_id}_step${currentStep}_v${outputIndex + 1}_${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabaseAdmin.storage
        .from("outputs")
        .upload(outputPath, outputBuffer, { contentType: outputMimeType });

      if (uploadError) {
        console.error(`Failed to upload output ${outputIndex + 1}:`, uploadError.message);
        continue;
      }

      // Create upload record
      const { data: uploadRecord, error: recordError } = await supabaseAdmin
        .from("uploads")
        .insert({
          project_id: pipeline.project_id,
          owner_id: user.id,
          bucket: "outputs",
          path: outputPath,
          kind: "output",
          mime_type: "image/png",
          original_filename: `pipeline_step${currentStep}_output_v${outputIndex + 1}.png`
        })
        .select()
        .single();

      if (recordError) {
        console.error(`Failed to create upload record for output ${outputIndex + 1}:`, recordError.message);
        continue;
      }

      await emitEvent(supabaseAdmin, pipeline_id, user.id, currentStep, "upload_complete", 
        `Output saved${outputLabel}`, (currentStep - 1) * 25 + 15 + outputIndex);

      // Run QA validation
      await emitEvent(supabaseAdmin, pipeline_id, user.id, currentStep, "qa_start", 
        `Running QA${outputLabel}...`, (currentStep - 1) * 25 + 17 + outputIndex);

      const qaResult = await runQAValidation(base64Image, outputBase64, currentStep);

      await emitEvent(supabaseAdmin, pipeline_id, user.id, currentStep, "qa_complete", 
        `QA${outputLabel}: ${qaResult.decision}`, (currentStep - 1) * 25 + 19 + outputIndex);

      generatedOutputs.push({
        output_upload_id: uploadRecord.id,
        qa_decision: qaResult.decision,
        qa_reason: qaResult.reason,
        prompt_used: currentPrompt,
        variation_index: outputIndex,
        ...(currentStep === 3 && currentPresetId ? {
          camera_angle: STEP_3_CAMERA_PRESETS.find(p => p.id === currentPresetId)?.name || currentPresetId,
          preset_id: currentPresetId
        } : {})
      });
    }

    // Check if we generated any outputs
    if (generatedOutputs.length === 0) {
      const errorMsg = lastApiError || "Failed to generate any outputs";
      throw new Error(errorMsg);
    }

    await emitEvent(supabaseAdmin, pipeline_id, user.id, currentStep, "generation_complete", 
      `Generated ${generatedOutputs.length} output(s)`, (currentStep - 1) * 25 + 22);
    
    // Auto-rerender for Step 4 (360° Panorama) QA rejection
    // Check if the primary output was rejected and we haven't hit max attempts
    const primaryOutput = generatedOutputs[0];
    const isPanoramaStep = currentStep === 4;
    const wasRejected = primaryOutput?.qa_decision === "rejected";
    const canAutoRerender = isPanoramaStep && wasRejected && currentAutoAttempt < MAX_AUTO_RERENDER_ATTEMPTS;
    
    if (canAutoRerender) {
      const nextAttempt = currentAutoAttempt + 1;
      console.log(`[Step 4] QA rejected - auto-rerender attempt ${nextAttempt}/${MAX_AUTO_RERENDER_ATTEMPTS}`);
      
      await emitEvent(supabaseAdmin, pipeline_id, user.id, currentStep, "auto_rerender", 
        `QA rejected: "${primaryOutput.qa_reason?.slice(0, 50)}..." - auto-retry ${nextAttempt}/${MAX_AUTO_RERENDER_ATTEMPTS}`, 
        (currentStep - 1) * 25 + 23);
      
      // Store the failed attempt in history
      const currentStepHistory = (stepOutputs[`step${currentStep}_history`] as any[]) || [];
      currentStepHistory.push({
        attempt: nextAttempt,
        output_upload_id: primaryOutput.output_upload_id,
        qa_decision: primaryOutput.qa_decision,
        qa_reason: primaryOutput.qa_reason,
        timestamp: new Date().toISOString()
      });
      stepOutputs[`step${currentStep}_history`] = currentStepHistory;
      
      // Update pipeline to keep running state for retry
      await supabaseAdmin
        .from("floorplan_pipelines")
        .update({ 
          step_outputs: stepOutputs,
          updated_at: new Date().toISOString()
        })
        .eq("id", pipeline_id);
      
      // Return with auto-rerender flag so frontend can continue the loop
      return new Response(JSON.stringify({ 
        success: true, 
        autoRerender: true,
        attempt: nextAttempt,
        maxAttempts: MAX_AUTO_RERENDER_ATTEMPTS,
        qaReason: primaryOutput.qa_reason,
        pipeline_id,
        camera_position,
        forward_direction
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    
    // Check if we hit max retries for panorama
    if (isPanoramaStep && wasRejected && currentAutoAttempt >= MAX_AUTO_RERENDER_ATTEMPTS) {
      console.log(`[Step 4] Max auto-rerender attempts (${MAX_AUTO_RERENDER_ATTEMPTS}) reached - manual review required`);
      
      await emitEvent(supabaseAdmin, pipeline_id, user.id, currentStep, "max_retries", 
        `Max retries (${MAX_AUTO_RERENDER_ATTEMPTS}) reached - manual review required`, 
        (currentStep - 1) * 25 + 24);
      
      // Create notification for manual review
      await supabaseAdmin.from("notifications").insert({
        owner_id: user.id,
        project_id: pipeline.project_id,
        type: "pipeline_max_retries",
        title: `Panorama Step - Manual Review Required`,
        message: `After ${MAX_AUTO_RERENDER_ATTEMPTS} attempts, manual intervention is needed`,
        target_route: `/projects/${pipeline.project_id}`,
        target_params: { tab: "floor-plan-jobs", pipelineId: pipeline_id }
      });
    }

    // Update pipeline with step outputs
    // For multi-output, store as an array; for single output, maintain backward compatibility
    const isSingleOutput = generatedOutputs.length === 1;
    
    // PARTIAL SUCCESS LOGIC: Count approved vs rejected outputs
    const approvedCount = generatedOutputs.filter(o => o.qa_decision === "approved").length;
    const rejectedCount = generatedOutputs.filter(o => o.qa_decision === "rejected").length;
    const totalCount = generatedOutputs.length;
    
    // Determine overall step QA decision:
    // - "approved" if ALL outputs are approved
    // - "partial_success" if at least ONE output is approved but some are rejected
    // - "rejected" ONLY if ALL outputs are rejected
    let overallQaDecision: string;
    let overallQaReason: string;
    
    if (rejectedCount === 0) {
      overallQaDecision = "approved";
      overallQaReason = `All ${totalCount} output(s) passed QA`;
    } else if (approvedCount > 0) {
      overallQaDecision = "partial_success";
      overallQaReason = `${approvedCount}/${totalCount} outputs passed QA, ${rejectedCount} rejected`;
    } else {
      overallQaDecision = "rejected";
      overallQaReason = `All ${totalCount} output(s) rejected by QA`;
    }
    
    console.log(`[run-pipeline-step] Step ${currentStep} QA summary: ${overallQaDecision} - ${overallQaReason}`);
    
    if (isSingleOutput) {
      // Single output - backward compatible format
      const output = generatedOutputs[0];
      stepOutputs[`step${currentStep}`] = {
        output_upload_id: output.output_upload_id,
        qa_decision: output.qa_decision,
        qa_reason: output.qa_reason,
        overall_qa_decision: overallQaDecision,
        overall_qa_reason: overallQaReason,
        aspect_ratio: pipeline.aspect_ratio || "16:9",
        output_quality: pipeline.output_resolution || "2K",
        prompt_used: output.prompt_used,
        ...(currentStep === 3 && output.preset_id ? {
          camera_angle: output.camera_angle,
          used_preset_ids: usedPresetIds,
          last_preset_id: output.preset_id
        } : {}),
        ...(currentStep === 4 ? {
          camera_position: camera_position,
          forward_direction: forward_direction
        } : {}),
        ...(currentStep === 2 ? {
          ...(designRefIds.length > 0 ? {
            design_ref_upload_ids: designRefIds,
            style_transfer_applied: true
          } : {}),
          ...(selectedStyleTitle ? { style_title: selectedStyleTitle } : {})
        } : {})
      };
    } else {
      // Multi-output - new array format
      stepOutputs[`step${currentStep}`] = {
        outputs: generatedOutputs.map((output, idx) => ({
          output_upload_id: output.output_upload_id,
          qa_decision: output.qa_decision,
          qa_reason: output.qa_reason,
          approval_status: output.qa_decision === "approved" ? "approved" : "pending", // Per-output approval tracking
          prompt_used: output.prompt_used,
          variation_index: idx,
          ...(output.camera_angle ? { camera_angle: output.camera_angle } : {}),
          ...(output.preset_id ? { preset_id: output.preset_id } : {})
        })),
        // Step metadata with partial success info
        overall_qa_decision: overallQaDecision,
        overall_qa_reason: overallQaReason,
        approved_count: approvedCount,
        rejected_count: rejectedCount,
        aspect_ratio: pipeline.aspect_ratio || "16:9",
        output_quality: pipeline.output_resolution || "2K",
        output_count: generatedOutputs.length,
        ...(currentStep === 3 ? { used_preset_ids: usedPresetIds } : {}),
        ...(currentStep === 4 ? {
          camera_position: camera_position,
          forward_direction: forward_direction
        } : {}),
        ...(currentStep === 2 ? {
          ...(designRefIds.length > 0 ? {
            design_ref_upload_ids: designRefIds,
            style_transfer_applied: true
          } : {}),
          ...(selectedStyleTitle ? { style_title: selectedStyleTitle } : {})
        } : {})
      };
    }

    // PARTIAL SUCCESS HANDLING: Step goes to waiting_approval if at least ONE output is valid
    // The step is NOT marked as failed/rejected if partial success
    // Only mark as step{N}_rejected if ALL outputs failed
    const stepStatus = overallQaDecision === "rejected" 
      ? `step${currentStep}_rejected` 
      : `step${currentStep}_waiting_approval`;

    await supabaseAdmin
      .from("floorplan_pipelines")
      .update({ 
        status: stepStatus,
        step_outputs: stepOutputs,
        updated_at: new Date().toISOString()
      })
      .eq("id", pipeline_id);

    await emitEvent(supabaseAdmin, pipeline_id, user.id, currentStep, "step_complete", 
      `Step ${currentStep} complete - ${generatedOutputs.length} output(s) awaiting approval`, currentStep * 25);

    // Create notification
    await supabaseAdmin.from("notifications").insert({
      owner_id: user.id,
      project_id: pipeline.project_id,
      type: "pipeline_step_complete",
      title: `Pipeline Step ${currentStep} Complete`,
      message: generatedOutputs.length > 1 
        ? `Step ${currentStep} generated ${generatedOutputs.length} outputs ready for review`
        : `Step ${currentStep} is ready for your review`,
      target_route: `/projects/${pipeline.project_id}`,
      target_params: { tab: "floor-plan-jobs", pipelineId: pipeline_id }
    });

    return new Response(JSON.stringify({ 
      success: true, 
      outputCount: generatedOutputs.length,
      outputs: generatedOutputs.map(o => ({ uploadId: o.output_upload_id, qa: o.qa_decision }))
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error("[run-pipeline-step] Pipeline step error:", error);
    
    // Try to reset pipeline status back to pending on error
    try {
      const body = await req.clone().json().catch(() => ({}));
      if (body.pipeline_id) {
        const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const { data: pipeline } = await supabaseAdmin
          .from("floorplan_pipelines")
          .select("current_step, status")
          .eq("id", body.pipeline_id)
          .maybeSingle();
        
        if (pipeline && pipeline.status?.includes("running")) {
          await supabaseAdmin
            .from("floorplan_pipelines")
            .update({ 
              status: `step${pipeline.current_step}_pending`,
              last_error: error instanceof Error ? error.message : "Unknown error",
              updated_at: new Date().toISOString()
            })
            .eq("id", body.pipeline_id);
          console.log(`[run-pipeline-step] Reset pipeline ${body.pipeline_id} to step${pipeline.current_step}_pending`);
        }
      }
    } catch (resetError) {
      console.error("[run-pipeline-step] Failed to reset pipeline status:", resetError);
    }
    
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});

// Helper function to determine if rejection is structural (walls/openings/floor/boundaries)
function isStructuralIssue(reason: string): boolean {
  const lowerReason = reason.toLowerCase();
  const structuralKeywords = [
    "wall", "walls", "door", "doors", "window", "windows", "opening", "openings",
    "floor", "boundary", "boundaries", "room", "geometry", "proportion", "proportions",
    "position", "positions", "size", "sizes", "layout", "structure", "structural",
    "moved", "missing", "added", "removed", "changed", "distorted", "inconsistent"
  ];
  
  // Check if the rejection reason contains structural keywords
  return structuralKeywords.some(keyword => lowerReason.includes(keyword));
}

async function emitEvent(
  supabase: any, 
  pipelineId: string, 
  ownerId: string, 
  stepNumber: number,
  type: string, 
  message: string, 
  progressInt: number
) {
  await supabase.from("floorplan_pipeline_events").insert({
    pipeline_id: pipelineId,
    owner_id: ownerId,
    step_number: stepNumber,
    type,
    message,
    progress_int: progressInt
  });
}

async function runQAValidation(inputBase64: string, outputBase64: string, stepNumber: number): Promise<{ decision: string; reason: string; qa_executed: boolean }> {
  // EXPLICIT QA EXECUTION TRACKING
  const qaStartTime = Date.now();
  console.log(`[QA EXECUTION] ═══════════════════════════════════════════════════════`);
  console.log(`[QA EXECUTION] Step ${stepNumber} QA STARTED at ${new Date().toISOString()}`);
  console.log(`[QA EXECUTION] Input image size: ${inputBase64.length} chars`);
  console.log(`[QA EXECUTION] Output image size: ${outputBase64.length} chars`);
  
  try {
    // Step-specific QA prompts with structural focus for Step 1
    let qaPrompt: string;
    
    if (stepNumber === 1) {
      // Step 1: Structural validation for 2D to 3D conversion
      // CRITICAL: Completely ignore all text, labels, dimensions, and annotations
      qaPrompt = `You are validating a 2D floor plan to top-down 3D render conversion.

CRITICAL INSTRUCTION - COMPLETELY IGNORE:
- ALL text, labels, room names, annotations on the floor plan
- ALL dimension values, measurements, scale markers, numbers
- ALL symbols (north arrows, scale bars, legends, reference marks)
- ALL watermarks, logos, or overlays on the plan
- Any OCR-extracted text or metadata
- Missing or changed text/labels in the output is NEVER a rejection reason

YOUR ONLY FOCUS - STRUCTURAL INTEGRITY:

1. WALLS (geometry only):
   - Are walls in the SAME positions as shown in the floor plan layout?
   - Are wall thicknesses visually consistent?
   - NO walls incorrectly added, removed, or relocated?

2. DOORS & OPENINGS (positions only):
   - Are door openings in the SAME locations as marked in the plan?
   - Are passage widths preserved?
   - NO doors blocked, removed, or relocated?

3. WINDOWS (positions only):
   - Are windows in the SAME positions?
   - NO windows blocked, removed, or relocated?

4. ROOM PROPORTIONS (shapes only):
   - Are room sizes and shapes visually preserved?
   - Are room boundaries accurate to the plan layout?

5. FURNITURE & FIXTURES (appropriateness only):
   - Are furniture pieces appropriate for each room type?
   - Sanitary elements (toilet, sink) ONLY in bathrooms?
   - Kitchen elements ONLY in kitchen areas?

ALWAYS APPROVE IF:
- Structure matches (walls, doors, windows in correct positions)
- Only appropriate furniture added for room functions
- Even if ALL text/labels/dimensions are missing or different

ONLY REJECT IF:
- Walls physically moved, removed, or added incorrectly
- Doors or windows physically blocked or relocated
- Room proportions significantly changed
- Furniture placed in completely wrong room types

Respond with ONLY valid JSON: {"decision": "approved" or "rejected", "reason": "Specific STRUCTURAL issue if rejected, or 'Structure verified' if approved"}`;
    } else if (stepNumber === 3) {
      // ═══════════════════════════════════════════════════════════════
      // STEP 3 QA - EXPLICIT EXECUTION VERIFICATION
      // ═══════════════════════════════════════════════════════════════
      console.log(`[Step 3 QA] ▶▶▶ EXECUTING Step 3 QA validation`);
      console.log(`[Step 3 QA] Comparing Step 2 output (input) vs Step 3 output`);
      
      qaPrompt = `You are performing MANDATORY QA validation on Step 3 (Camera-Angle Render).

═══════════════════════════════════════════════════════════════
STEP 3 QA - EXECUTION REQUIRED
═══════════════════════════════════════════════════════════════

This is a REAL validation. You MUST:
1. Actually examine BOTH images carefully
2. Report REAL observations, not assumptions
3. Make a deterministic decision based on evidence

═══════════════════════════════════════════════════════════════
COMPARISON METHODOLOGY - Step 2 Output vs Step 3 Output
═══════════════════════════════════════════════════════════════

PHASE 1 - STRUCTURAL ELEMENT CHECK:

Examine and report on EACH of these elements:

□ WALLS: Are walls in the SAME positions in both images?
□ DOORS: Are door openings in the SAME locations?
□ WINDOWS: Are windows in the SAME positions?
□ OPENINGS: Are passages/archways unchanged?

PHASE 2 - FURNITURE ELEMENT CHECK:

□ FURNITURE COUNT: Same number of major furniture pieces?
□ FURNITURE POSITIONS: Furniture in same relative locations?
□ FURNITURE TYPES: Same furniture types (sofa is still sofa)?

PHASE 3 - CAMERA/VIEW CHECK (EXPECTED CHANGE):

□ CAMERA ANGLE: Has the viewing angle changed? (EXPECTED)
□ PERSPECTIVE: Is this now eye-level view? (EXPECTED)

═══════════════════════════════════════════════════════════════
DECISION RULES (STRICT):
═══════════════════════════════════════════════════════════════

APPROVE if:
- Walls, doors, windows in correct positions
- Furniture preserved (positions may shift due to perspective)
- Camera angle is the only major change

REJECT if:
- Wall added, removed, or relocated
- Door blocked, removed, or relocated
- Window blocked, removed, or relocated
- Major furniture piece missing or drastically repositioned

NO-CHANGE if:
- Output appears identical to input (no camera change applied)

═══════════════════════════════════════════════════════════════
COMPLETELY IGNORE (NEVER rejection reasons):
═══════════════════════════════════════════════════════════════
- Text, labels, annotations, room names
- Dimension markings, measurements
- Color/lighting variations
- Material/texture differences
- Style changes

═══════════════════════════════════════════════════════════════
FORBIDDEN:
═══════════════════════════════════════════════════════════════
- DO NOT claim changes that don't exist
- DO NOT hallucinate differences
- DO NOT approve without actual comparison
- DO NOT use vague language

═══════════════════════════════════════════════════════════════
RESPONSE FORMAT (JSON ONLY):
═══════════════════════════════════════════════════════════════

You MUST respond with this exact JSON structure:
{
  "decision": "approved" | "rejected" | "no_change",
  "reason": "SPECIFIC observation based on actual visual comparison",
  "structural_check": "passed" | "failed",
  "furniture_check": "passed" | "failed" | "minor_change",
  "camera_changed": true | false
}`;
    } else if (stepNumber === 4) {
      // Step 4: 360° Panorama validation
      qaPrompt = `Compare the input image with the generated 360° panorama output.

Check:
1. Is it a true 2:1 equirectangular panorama?
2. Are there any fisheye circles or warped geometry?
3. Are vertical lines straight?
4. Is the perspective correct for VR viewing?
5. Are the original elements preserved?

COMPLETELY IGNORE (NEVER use as rejection reasons):
- ALL textual annotations, labels, room names
- ALL dimension markings, measurements
- Color/material/lighting variations (expected for rendering)

Respond with ONLY valid JSON: {"decision": "approved" or "rejected", "reason": "brief explanation"}`;
    } else if (stepNumber === 2) {
      // Step 2: Design Style Change validation
      // STEP 2 QA IS ACTIVE - Log entry to confirm execution
      console.log(`[Step 2 QA] EXECUTING Step 2 validation - comparing input vs styled output`);
      
      qaPrompt = `You are performing QA validation on a STEP 2 (Design Style Change) output.

═══════════════════════════════════════════════════════════════
STEP 2 PURPOSE: Apply interior design style changes.
Style differences (colors, textures, lighting) are EXPECTED and CORRECT.
═══════════════════════════════════════════════════════════════

YOUR TASK: Validate STRUCTURAL CONSISTENCY ONLY.

CHECK THESE STRUCTURAL ELEMENTS (must match input):

1. WALL POSITIONS:
   - Are walls in the SAME positions?
   - Walls NOT added, removed, or relocated?

2. DOORS & OPENINGS:
   - Are door openings in the EXACT same locations?
   - Doors NOT blocked, removed, or relocated?

3. WINDOWS:
   - Are windows in the SAME positions?
   - Windows NOT blocked, removed, or relocated?

4. ROOM BOUNDARIES:
   - Are room proportions visually preserved?
   - Room shapes NOT distorted?

═══════════════════════════════════════════════════════════════
COMPLETELY IGNORE (NEVER use as rejection reasons):
═══════════════════════════════════════════════════════════════
- ALL text, labels, room names, annotations
- ALL dimension markings, measurements, numbers
- ALL scale bars, legends, symbols
- Color changes (EXPECTED)
- Texture changes (EXPECTED)
- Material variations (EXPECTED)
- Lighting mood changes (EXPECTED)
- Furniture style changes (EXPECTED)
- Any aesthetic/stylistic differences

═══════════════════════════════════════════════════════════════
DECISION RULES:
═══════════════════════════════════════════════════════════════

APPROVE IF:
- All walls, doors, windows in correct positions
- Room proportions preserved
- Only style/design changes applied (which is the goal)

REJECT ONLY IF:
- Walls physically moved, removed, or incorrectly added
- Doors or windows blocked, removed, or relocated
- Room geometry/proportions significantly distorted

═══════════════════════════════════════════════════════════════
RESPONSE FORMAT (JSON only):
═══════════════════════════════════════════════════════════════

Respond with ONLY valid JSON:
{
  "decision": "approved" or "rejected",
  "reason": "SPECIFIC structural observation - what you verified"
}

Examples:
- {"decision": "approved", "reason": "Structural layout verified: walls, doors, windows in correct positions. Style changes applied as expected."}
- {"decision": "rejected", "reason": "Door between bedroom and hallway appears blocked in styled output."}
- {"decision": "rejected", "reason": "Kitchen wall extended incorrectly, reducing dining room size."}`;
    } else {
      // Fallback for any other step
      qaPrompt = `Compare the input image with the generated output and verify structural consistency.
Respond with ONLY valid JSON: {"decision": "approved" or "rejected", "reason": "brief explanation"}`;
    }

    if (!API_OPENAI) {
      console.warn(`[QA EXECUTION] API_OPENAI not configured - QA cannot run`);
      return { decision: "rejected", reason: "QA could not run (missing API key)", qa_executed: false };
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_OPENAI}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: qaPrompt },
              {
                type: "image_url",
                image_url: { url: `data:image/jpeg;base64,${inputBase64}`, detail: "high" }
              },
              {
                type: "image_url",
                image_url: { url: `data:image/png;base64,${outputBase64}`, detail: "high" }
              }
            ]
          }
        ],
        max_completion_tokens: 1000
      })
    });

    if (!response.ok) {
      // Do NOT auto-approve on QA API error (any step): return rejected so it can't silently pass.
      console.error(`[QA EXECUTION] Step ${stepNumber} API error. Status: ${response.status}`);
      return { decision: "rejected", reason: `QA API error (${response.status})`, qa_executed: false };
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content || "";
    
    const qaEndTime = Date.now();
    console.log(`[QA EXECUTION] Step ${stepNumber} QA completed in ${qaEndTime - qaStartTime}ms`);
    console.log(`[QA EXECUTION] Raw response length: ${content.length} chars`);
    
    // Parse JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      console.log(`[QA EXECUTION] Step ${stepNumber} RESULT:`, JSON.stringify(parsed));
      console.log(`[QA EXECUTION] ═══════════════════════════════════════════════════════`);
      
      // Validate that we got a real decision, not empty/undefined
      if (!parsed.decision || (parsed.decision !== "approved" && parsed.decision !== "rejected" && parsed.decision !== "no_change")) {
        console.error(`[QA EXECUTION] Step ${stepNumber} invalid decision: "${parsed.decision}"`);
        // Step 3 must hard-fail to prevent proceeding with an unvalidated camera step.
        if (stepNumber === 3) {
          throw new Error(`Step 3 QA returned invalid decision: ${parsed.decision}`);
        }
        return { decision: "rejected", reason: "QA returned invalid decision format", qa_executed: false };
      }
      
      return { ...parsed, qa_executed: true };
    }
    
    // Parsing failed: never silently approve.
    console.warn(`[QA EXECUTION] Step ${stepNumber} could not parse response`);
    if (stepNumber === 3) {
      throw new Error("Step 3 QA failed to parse - cannot validate output");
    }
    return { decision: "rejected", reason: "QA response parse failure", qa_executed: false };
  } catch (error) {
    console.error(`[QA EXECUTION] Step ${stepNumber} ERROR:`, error);

    if (stepNumber === 3) {
      throw error;
    }

    // Reject on QA execution failures (prevents silent approvals).
    return { decision: "rejected", reason: "QA validation error", qa_executed: false };
  }
}
