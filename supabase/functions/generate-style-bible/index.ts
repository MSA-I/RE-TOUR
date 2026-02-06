import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
    const geminiApiKey = Deno.env.get("API_NANOBANANA");

    if (!geminiApiKey) {
      console.error("API_NANOBANANA not configured");
      return new Response(JSON.stringify({ error: "Gemini API key not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
    const MODEL = "gemini-2.5-pro";

    const supabase = createClient(supabaseUrl, supabaseKey);
    const { project_id, panorama_upload_id, selected_ref_ids } = await req.json();

    if (!project_id) {
      return new Response(JSON.stringify({ error: "project_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify user owns the project
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get project
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("*")
      .eq("id", project_id)
      .eq("owner_id", user.id)
      .single();

    if (projectError || !project) {
      console.error("Project not found:", projectError);
      return new Response(JSON.stringify({ error: "Project not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get design reference uploads - filter by selected IDs if provided
    let query = supabase
      .from("uploads")
      .select("*")
      .eq("project_id", project_id)
      .eq("kind", "design_ref");

    // If specific IDs are provided, filter by them
    if (selected_ref_ids && Array.isArray(selected_ref_ids) && selected_ref_ids.length > 0) {
      query = query.in("id", selected_ref_ids);
    }

    const { data: designRefs, error: refsError } = await query;

    if (refsError) {
      console.error("Error fetching design refs:", refsError);
      return new Response(JSON.stringify({ error: "Failed to fetch design references" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!designRefs || designRefs.length === 0) {
      return new Response(JSON.stringify({ error: "No design references found. Upload design references first." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Generating style prompt for project ${project_id} with ${designRefs.length} design references`);
    console.log(`Selected ref IDs: ${selected_ref_ids ? selected_ref_ids.join(", ") : "all"}`);

    // Get panorama image if provided (for panorama-aware mixing)
    let panoramaSignedUrl: string | null = null;
    if (panorama_upload_id) {
      const { data: panorama, error: panoError } = await supabase
        .from("uploads")
        .select("*")
        .eq("id", panorama_upload_id)
        .eq("owner_id", user.id)
        .single();

      if (!panoError && panorama) {
        const { data: signedData } = await supabase.storage
          .from(panorama.bucket)
          .createSignedUrl(panorama.path, 3600);
        
        if (signedData?.signedUrl) {
          panoramaSignedUrl = signedData.signedUrl;
          console.log("Panorama loaded for panorama-aware style mixing");
        }
      }
    }

    // Generate signed URLs for each design reference with labels
    const refData: { url: string; id: string; filename: string; label?: string }[] = [];
    const usedRefIds: string[] = [];
    
    for (const ref of designRefs) {
      const { data: signedData, error: signedError } = await supabase.storage
        .from(ref.bucket)
        .createSignedUrl(ref.path, 3600);

      if (signedError || !signedData?.signedUrl) {
        console.error(`Failed to get signed URL for ${ref.path}:`, signedError);
        continue;
      }
      refData.push({
        url: signedData.signedUrl,
        id: ref.id,
        filename: ref.original_filename || `Reference ${refData.length + 1}`,
        label: ref.label || undefined
      });
      usedRefIds.push(ref.id);
    }

    if (refData.length === 0) {
      return new Response(JSON.stringify({ error: "Failed to access design reference images" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build message content with all images
    const messageContent: any[] = [];

    // Build the prompt text based on whether we have a panorama
    let promptText = "";
    if (panoramaSignedUrl) {
      promptText = `You are analyzing design reference images to create a UNIFIED STYLE PROMPT that will be applied to a specific panorama/room photo.

TASK:
1. First, analyze the PANORAMA image to identify what rooms/spaces actually exist (kitchen, living room, bedroom, bathroom, hallway, etc.)
2. Then, analyze each DESIGN REFERENCE image to extract its STYLE DNA:
   - Materials (flooring, walls, counters, fabrics)
   - Color palette (primary, secondary, accent colors)
   - Lighting mood (warm/cool, natural/artificial, intensity)
   - Furniture language (modern, classic, industrial, scandinavian, etc.)
   - Key finishes and textures
3. MIX the selected references into ONE coherent style direction:
   - If a reference shows a room type NOT in the panorama, extract its STYLE elements (materials, mood, colors) and apply them to the actual spaces in the panorama
   - Example: A "kitchen reference" applied to a bedroom should inspire material choices and color mood, not add a kitchen
4. Create a PANORAMA-AWARE unified prompt that describes how to style the ACTUAL spaces visible in the panorama

OUTPUT FORMAT (JSON):
{
  "unified_style_prompt": "A single paragraph (3-5 sentences) describing the cohesive style direction to apply to the panorama. Be specific about materials, colors, lighting, and furniture style. This should be ready to use as a rendering prompt.",
  "style_profile_json": {
    "color_palette": ["primary", "secondary", "accent"],
    "materials": ["material1", "material2"],
    "lighting_mood": "description",
    "furniture_style": "description",
    "key_finishes": ["finish1", "finish2"]
  },
  "per_reference_notes": [
    {"ref_id": "id1", "contribution": "What style elements this reference contributed"}
  ],
  "detected_spaces": ["space1", "space2"]
}

REFERENCE IMAGES (${refData.length} total):`;
      
      for (let i = 0; i < refData.length; i++) {
        const ref = refData[i];
        promptText += `\n- Reference ${i + 1}: "${ref.filename}"${ref.label ? ` (labeled as: ${ref.label})` : ""}`;
      }
    } else {
      // No panorama - just analyze references
      promptText = `Analyze the following ${refData.length} design reference image(s) and create a UNIFIED STYLE PROMPT that MIXES their styles into one coherent direction.

TASK:
1. Extract STYLE DNA from each reference:
   - Materials, colors, lighting mood, furniture language, finishes
2. BLEND them into a single cohesive style that could work for any interior space
3. Note what each reference contributed

OUTPUT FORMAT (JSON):
{
  "unified_style_prompt": "A single paragraph (3-5 sentences) describing the cohesive style direction. Be specific about materials, colors, lighting, and furniture style.",
  "style_profile_json": {
    "color_palette": ["primary", "secondary", "accent"],
    "materials": ["material1", "material2"],
    "lighting_mood": "description",
    "furniture_style": "description",
    "key_finishes": ["finish1", "finish2"]
  },
  "per_reference_notes": [
    {"ref_id": "id1", "contribution": "What style elements this reference contributed"}
  ]
}

REFERENCE IMAGES:`;
      
      for (let i = 0; i < refData.length; i++) {
        const ref = refData[i];
        promptText += `\n- Reference ${i + 1} (ID: ${ref.id}): "${ref.filename}"${ref.label ? ` (labeled as: ${ref.label})` : ""}`;
      }
    }

    messageContent.push({ type: "text", text: promptText });

    // Add panorama first if available
    if (panoramaSignedUrl) {
      messageContent.push({
        type: "image_url",
        image_url: { url: panoramaSignedUrl }
      });
    }

    // Add each reference image
    for (const ref of refData) {
      messageContent.push({
        type: "image_url",
        image_url: { url: ref.url }
      });
    }

    // Call Gemini API for intelligent style mixing
    console.log("Calling Gemini API for intelligent style mixing...");
    
    // Build image parts for Gemini
    const imageParts: any[] = [];
    
    // Add panorama first if available
    if (panoramaSignedUrl) {
      // Fetch panorama image
      const panoRes = await fetch(panoramaSignedUrl);
      if (panoRes.ok) {
        const panoBlob = await panoRes.arrayBuffer();
        const panoBase64 = btoa(String.fromCharCode(...new Uint8Array(panoBlob)));
        imageParts.push({ inlineData: { mimeType: "image/jpeg", data: panoBase64 } });
      }
    }
    
    // Add each reference image
    for (const ref of refData) {
      const refRes = await fetch(ref.url);
      if (refRes.ok) {
        const refBlob = await refRes.arrayBuffer();
        const refBase64 = btoa(String.fromCharCode(...new Uint8Array(refBlob)));
        imageParts.push({ inlineData: { mimeType: "image/jpeg", data: refBase64 } });
      }
    }
    
    const systemPrompt = `You are an expert interior designer and visual analyst. Your specialty is analyzing multiple design references and BLENDING their styles into one cohesive direction. You understand that style elements (materials, colors, mood, lighting) can be extracted from any room type and applied to different spaces. Always respond with valid JSON.`;
    
    const aiResponse = await fetch(`${GEMINI_API_BASE}/${MODEL}:generateContent?key=${geminiApiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: systemPrompt + "\n\n" + promptText },
            ...imageParts,
          ],
        }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 2000,
        },
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("AI API error:", aiResponse.status, errorText);
      
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again later." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add credits." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      return new Response(JSON.stringify({ error: "AI analysis failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiResponse.json();
    const responseContent = aiData.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (!responseContent) {
      console.error("No content in AI response");
      return new Response(JSON.stringify({ error: "AI returned empty response" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse the JSON response
    let parsedResponse;
    try {
      parsedResponse = JSON.parse(responseContent);
    } catch (parseError) {
      console.error("Failed to parse AI response as JSON:", responseContent);
      // Fallback: treat the response as a plain prompt
      parsedResponse = {
        unified_style_prompt: responseContent,
        style_profile_json: {},
        per_reference_notes: []
      };
    }

    // Build the style profile for storage
    const styleProfile = {
      prompt: parsedResponse.unified_style_prompt || responseContent,
      profile: parsedResponse.style_profile_json || {},
      per_reference_notes: parsedResponse.per_reference_notes || [],
      detected_spaces: parsedResponse.detected_spaces || [],
      generated_at: new Date().toISOString(),
      used_ref_ids: usedRefIds,
      panorama_upload_id: panorama_upload_id || null
    };

    // Update the project with the style profile
    const { error: updateError } = await supabase
      .from("projects")
      .update({ style_profile: styleProfile })
      .eq("id", project_id);

    if (updateError) {
      console.error("Failed to save style profile:", updateError);
      return new Response(JSON.stringify({ error: "Failed to save style profile" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("Style prompt generated successfully for project:", project_id);
    console.log("Used reference IDs:", usedRefIds);

    return new Response(JSON.stringify({ 
      success: true, 
      style_profile: styleProfile,
      unified_style_prompt: parsedResponse.unified_style_prompt,
      per_reference_notes: parsedResponse.per_reference_notes || []
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Error in generate-style-bible:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
