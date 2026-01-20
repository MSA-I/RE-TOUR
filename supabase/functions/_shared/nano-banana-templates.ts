/**
 * Nano Banana Pro Prompt Templates for Architectural Visualization
 * Based on official Google Gemini prompting tips and best practices
 */

export interface PromptTemplate {
  id: string;
  name: string;
  category: string;
  template: string;
  description: string;
}

export const PROMPT_TEMPLATES: PromptTemplate[] = [
  // FLOOR PLAN CONVERSIONS
  {
    id: "floor_plan_eye_level",
    name: "2D Floor Plan → Eye-Level Interior Render",
    category: "floor_plan",
    description: "Convert 2D floor plan to photorealistic eye-level interior view",
    template: `Generate a photorealistic interior render based strictly on the uploaded 2D floor plan.

GEOMETRY & LAYOUT (CRITICAL):
- Use the 2D floor plan as the single source of truth.
- Keep all walls, openings, doors, furniture placement, and room proportions EXACTLY as shown.
- Do NOT move, resize, rotate, or reinterpret any architectural or furniture elements.
- Translate the plan into a realistic 3D space without altering the layout.

CAMERA:
- Eye-level interior camera.
- Camera position: standing at the kitchen island countertop, slightly behind the island.
- Camera height: approximately 150–160 cm (human eye level).
- Camera is looking straight toward the living room seating area.
- Natural perspective, realistic focal length (approx. 35–45mm).
- No wide-angle distortion, no fisheye.

SCENE & VIEW:
- Foreground: kitchen island countertop edge visible at the bottom of the frame.
- Midground: dining table and chairs exactly as placed in the plan.
- Background: living room with sofa, armchairs, and coffee table as shown.
- Clear visual connection between kitchen, dining, and living areas.`
  },
  {
    id: "floor_plan_top_down",
    name: "2D Floor Plan → Top-Down 3D Render",
    category: "floor_plan",
    description: "Convert 2D floor plan to clean top-down 3D visualization",
    template: `Convert the uploaded 2D floor plan into a clean, top-down 3D render.

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
A clear and accurate 3D visualization that faithfully represents the original 2D floor plan.`
  },
  {
    id: "panorama_360_interior",
    name: "Nano Banana 360° Interior Panorama",
    category: "panorama",
    description: "Generate true 360° equirectangular interior panorama from reference image",
    template: `Using the provided image as the ONLY reference, generate a photorealistic 360° equirectangular interior panorama.

Camera:
- Height: standing eye level (~1.6m)
- Position: [DESCRIBE EXACT LOCATION – e.g. center of living room rug / near kitchen counter / between sofa and dining table]

Primary forward direction (0° yaw):
- Facing [DESCRIBE MAIN VIEW – e.g. sofa and coffee table / dining table and windows / TV wall]

Preserve exactly (no redesign, no replacements):
- [LIST FURNITURE – e.g. sofa, coffee table, rug, chairs]
- [LIST FIXED ELEMENTS – e.g. windows and their wall, doors, columns]
- Floor material and wood plank direction
- Wall curvature, room proportions, ceiling height

Do NOT add, remove, or reinterpret any elements.

Lighting:
- Natural daylight from [WINDOW LOCATION]
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
  },

  // STYLE TRANSFER
  {
    id: "style_transfer",
    name: "Style Transfer",
    category: "style",
    description: "Transform an image into a specific artistic style",
    template: `Transform the provided photograph of [subject] into the artistic style of [artist/art style]. Preserve the original composition but render it with [description of stylistic elements].`
  },
  {
    id: "photobashing",
    name: "Photobashing / Style Transfer",
    category: "style",
    description: "Apply lighting and mood from one image to another",
    template: `Generate a high-end architectural visualization that strictly uses the geometry, perspective, and composition from image1 but applies the lighting, color palette, and material mood from image2. It is critical that you do not alter the building shape or architectural details from the first image at all. Simply wrap the photorealistic V-Ray style and lighting atmosphere from the second image onto the existing structure of the first image.`
  },

  // MOOD VARIATIONS
  {
    id: "mood_misty_morning",
    name: "Misty Morning (Nordic Noir)",
    category: "mood",
    description: "Serene morning with thick mist",
    template: `Transform the provided image into a serene, early morning scene engulfed in thick, low-hanging mist. The lighting should be extremely soft and diffuse with cool blue-grey tones, typical of a Nordic dawn. Reduce the visibility of the background to create depth and mystery. The building should appear to emerge softly from the fog, with dew visible on the foreground surfaces. Keep the architecture exactly as is, but strip away strong contrasts to create a calm, ethereal atmosphere.`
  },
  {
    id: "mood_winter_day",
    name: "High-Key Winter Day",
    category: "mood",
    description: "Bright minimalist winter scene",
    template: `Change the season of the provided image to a bright, overcast winter day. Cover the entire landscape in a thick blanket of pristine white snow. The sky should be a flat, bright white, creating a "high-key" photography style with very soft, almost invisible shadows. The mood is silent, clean, and minimalist, focusing purely on the geometric form of the building against the white negative space.`
  },
  {
    id: "mood_autumn_sunset",
    name: "Autumn Sunset (Warm & Cozy)",
    category: "mood",
    description: "Golden hour autumn atmosphere",
    template: `Set the scene in the peak of autumn. Change the surrounding vegetation to display vibrant reds, oranges, and yellows. The lighting should be the "Golden Hour" shortly before sunset, bathing the entire scene in a rich, warm glow. The interior lights should be turned on and visible, creating a cozy mix of natural golden light outside and artificial warm light inside. The atmosphere should be inviting and nostalgic, emphasizing the texture of the materials through the low angle of the sun.`
  },
  {
    id: "mood_blue_hour_winter",
    name: "Winter Blue Hour",
    category: "mood",
    description: "Deep winter during blue hour twilight",
    template: `Place this scene in a deep winter setting during the blue hour. The lighting should be dominated by the cold blue twilight reflecting on glass surfaces, which contrasts strongly with warm yellow interior lights glowing from inside. Add a light layer of frost on surfaces and traces of snow to create a crisp, cold atmosphere.`
  },
  {
    id: "mood_summer_golden",
    name: "Summer Golden Hour",
    category: "mood",
    description: "Hot summer late afternoon",
    template: `Set the scene in a dry landscape during a hot summer late afternoon. The lighting should be low and intensely warm, casting long dramatic shadows and creating sun flares on glass surfaces. Create wild dry grasses and low green shrubs in the foreground.`
  },

  // ELEMENT MODIFICATIONS
  {
    id: "add_remove_element",
    name: "Add/Remove Elements",
    category: "elements",
    description: "Add or remove specific elements from scene",
    template: `Using the provided image, please [add/remove/modify] [element] to/from the scene. Ensure the change is [description of how the change should integrate].`
  },
  {
    id: "modify_specific_area",
    name: "Modify Specific Area",
    category: "elements",
    description: "Change only a specific part of the image",
    template: `Using the provided image, change only the [specific element] to [new element/description]. Keep everything else in the image exactly the same, preserving the original style, lighting, and composition.`
  },
  {
    id: "add_people",
    name: "Add People",
    category: "elements",
    description: "Populate scene with people",
    template: `Populate the architectural scene by adding [description of people] walking casually in the [location]. Ensure they are wearing clothing that fits the weather shown in the image. It is extremely important that their shadows, lighting, and color temperature blend perfectly with the existing environment. Make sure their scale is realistic relative to the architectural elements.`
  },
  {
    id: "add_asset",
    name: "Add Asset from Reference",
    category: "elements",
    description: "Insert an element from a reference image",
    template: `Insert the [element] exactly as seen in the reference image into the scene. It is critical that the element retains its exact appearance, color, and texture. Adjust the perspective and create realistic contact shadows so it looks physically present. Do not change any other part of the scene; focus solely on placing the new element realistically and blend it with the existing lighting.`
  },

  // MATERIAL CHANGES
  {
    id: "apply_material",
    name: "Apply Material",
    category: "materials",
    description: "Replace materials on surfaces",
    template: `Replace the [original material] on the [surface] with the [new material] from the reference image. Ensure the new material looks realistic under the existing lighting and shadows. Everything else in the scene must remain exactly as it is in the original image.`
  },

  // COMPOSITION CHANGES
  {
    id: "outpainting",
    name: "Outpainting (Format Change)",
    category: "composition",
    description: "Expand canvas and fill new areas",
    template: `Expand the canvas of the provided image from [original ratio] to [target ratio] format. Fill the new areas with realistic content that matches the existing image seamlessly. The transition between the original image and the generated parts must be invisible.`
  },
  {
    id: "new_perspective",
    name: "Create Extra Perspective",
    category: "composition",
    description: "Generate view from different angle",
    template: `Generate a new view of the building shown from a [angle description]. You will need to hallucinate the hidden parts, but make sure to maintain the exact same architectural style, materials, and lighting conditions as the original image. The result should look like a coherent photo taken from a different spot.`
  },

  // HIGH FIDELITY
  {
    id: "high_fidelity",
    name: "High-Fidelity Detail Preservation",
    category: "advanced",
    description: "Preserve critical details during editing",
    template: `Using the provided images, place [element from reference] onto [element in scene]. Ensure that the features of [element to preserve] remain completely unchanged. The added element should [description of how the element should integrate].`
  },

  // COMBINING IMAGES
  {
    id: "combine_images",
    name: "Combine Multiple Images",
    category: "advanced",
    description: "Merge elements from multiple images",
    template: `Create a new image by combining the elements from the provided images. Take the [element from image 1] and place it with/on the [element from image 2]. The final image should be a [description of the final scene].`
  }
];

export const BEST_PRACTICES = `
## Nano Banana Pro Best Practices for Architectural Visualization

### Be Hyper-Specific
The more detail you provide, the more control you have. Instead of "modern house," describe: "a modern two-story brutalist house made of rough textured beige concrete with timber-framed glass doors."

### Provide Context and Intent
Explain the purpose: "Create a photorealistic architectural rendering for a client presentation" yields better results than just describing the scene.

### Control Lighting and Camera
Use photographic and cinematic language:
- Lighting: "Golden hour backlighting creating long shadows," "blue hour twilight," "soft diffuse Nordic dawn light"
- Camera: "low-angle shot," "wide shot," "shallow depth of field (f/1.8)"

### Maintain Architectural Integrity
When editing, always specify: "Keep the architecture exactly as is" or "It is critical that you do not alter the building shape or architectural details."

### Blend Elements Naturally
For compositing: "Ensure shadows, lighting, and color temperature blend perfectly with the existing environment."

### Use Step-by-Step Instructions
For complex scenes: "First, [action 1]. Then, [action 2]. Finally, [action 3]."

### Preserve Specific Elements
Be explicit: "Everything else in the scene must remain exactly as it is in the original image."
`;

export function buildPrompt(
  templateId: string,
  changeRequest: string,
  styleProfile?: any
): string {
  const template = PROMPT_TEMPLATES.find(t => t.id === templateId);
  
  // Build base prompt
  let prompt = "";
  
  // Add style profile context if available
  if (styleProfile) {
    prompt += `## Style Bible Context\n`;
    if (styleProfile.overall_mood) {
      prompt += `Overall Mood: ${styleProfile.overall_mood}\n`;
    }
    if (styleProfile.color_palette) {
      prompt += `Color Palette: ${JSON.stringify(styleProfile.color_palette)}\n`;
    }
    if (styleProfile.materials) {
      prompt += `Materials: ${styleProfile.materials.join(", ")}\n`;
    }
    if (styleProfile.lighting) {
      prompt += `Lighting: Natural - ${styleProfile.lighting.natural}, Artificial - ${styleProfile.lighting.artificial}\n`;
    }
    if (styleProfile.rendering_guidance) {
      prompt += `Rendering Guidance: ${styleProfile.rendering_guidance}\n`;
    }
    prompt += "\n";
  }
  
  // Add template if found
  if (template) {
    prompt += `## Task Template: ${template.name}\n`;
    prompt += `${template.template}\n\n`;
  }
  
  // Add user's change request
  prompt += `## User Request\n${changeRequest}\n\n`;
  
  // Add best practices reminder
  prompt += `## Important Instructions\n`;
  prompt += `- Maintain the exact architectural details and geometry unless specifically asked to change them.\n`;
  prompt += `- Ensure all edits blend naturally with the existing lighting and shadows.\n`;
  prompt += `- Preserve the photorealistic quality of the original image.\n`;
  prompt += `- Make the requested changes while keeping everything else exactly the same.\n`;
  
  return prompt;
}

export function detectTemplateFromRequest(changeRequest: string): string | null {
  const request = changeRequest.toLowerCase();
  
  // Floor plan detection (NEW - check first as highest priority)
  if (request.includes("floor plan") || request.includes("floorplan")) {
    if (request.includes("eye level") || request.includes("eye-level") || request.includes("interior render") || request.includes("interior view")) {
      return "floor_plan_eye_level";
    }
    if (request.includes("top down") || request.includes("top-down") || request.includes("axonometric") || request.includes("3d render")) {
      return "floor_plan_top_down";
    }
    // Default to top-down for generic floor plan requests
    return "floor_plan_top_down";
  }
  
  // Style/mood detection
  if (request.includes("style") || request.includes("artistic")) return "style_transfer";
  if (request.includes("mist") || request.includes("fog") || request.includes("morning")) return "mood_misty_morning";
  if (request.includes("winter") || request.includes("snow")) {
    if (request.includes("blue hour") || request.includes("twilight")) return "mood_blue_hour_winter";
    return "mood_winter_day";
  }
  if (request.includes("autumn") || request.includes("fall") || request.includes("sunset")) return "mood_autumn_sunset";
  if (request.includes("summer") || request.includes("golden hour")) return "mood_summer_golden";
  
  // Element modifications
  if (request.includes("add") && request.includes("people")) return "add_people";
  if (request.includes("add") || request.includes("insert") || request.includes("place")) return "add_asset";
  if (request.includes("remove") || request.includes("delete")) return "add_remove_element";
  if (request.includes("change only") || request.includes("modify only")) return "modify_specific_area";
  
  // Material changes
  if (request.includes("material") || request.includes("texture") || request.includes("tile") || request.includes("replace the")) return "apply_material";
  
  // Composition
  if (request.includes("expand") || request.includes("outpaint") || request.includes("format")) return "outpainting";
  if (request.includes("perspective") || request.includes("angle") || request.includes("view from")) return "new_perspective";
  
  // Combining
  if (request.includes("combine") || request.includes("merge") || request.includes("blend")) return "combine_images";
  
  return null;
}
