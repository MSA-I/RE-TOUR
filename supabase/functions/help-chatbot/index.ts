import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Gemini API configuration - uses API_NANOBANANA
const API_NANOBANANA = Deno.env.get("API_NANOBANANA");
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const ORCHESTRATION_MODEL = "gemini-3-flash-preview";

// Curated site guide knowledge base
const SITE_GUIDE = `
# RE:TOUR Site Guide

RE:TOUR is a virtual tour rendering platform that transforms panoramic images using AI-powered style transfer and editing.

## Main Sections

### 1. Projects
- View all your projects in a table with status, dates, and actions
- Create new projects with the "Create New Project" button
- Filter by status (Draft, Active, Completed, Failed) or search by name
- Click a project to open its detail page

### 2. Uploaded Images (within a project)
- **Panoramas**: Upload 1-5 panoramic images that you want to transform
- **Design References**: Upload 0-5 reference images to guide the AI's style
- Click any image thumbnail to preview it full-size
- Delete images with the trash icon

### 3. Render Jobs (within a project)
- Create render jobs by entering a change request (e.g., "Change floor to marble")
- Select output ratio (1:1, 16:9, etc.) and quality (1K, 2K, 4K)
- Use "Compose Final Prompt" to let AI optimize your request
- Jobs show status: Queued, Running, Needs Review, Approved, Rejected, Failed
- Running jobs show real-time progress bars
- View terminal logs for debugging

### 4. Edited Images
- Same as Render Jobs section - shows completed renders
- Compare before/after with the comparison slider
- Download outputs with the download button
- Approve or reject outputs for review

### 5. Image Editing
- For minor visual fixes: lighting, color, object removal
- Attach an image from Creations to edit it
- Add reference images to guide the style

### 6. Creations
- View all generated outputs from all pipeline stages
- Attach images to other workflows (panorama, image editing, pipeline)
- Start pipelines from intermediate steps

## How To...

### Upload Images
1. Go to a project's "Uploads" tab
2. Click "Upload" in the Panoramas or Design References section
3. Select up to 5 images from your device
4. Wait for upload to complete

### Run a Render
1. Upload at least one panorama
2. Enter your change request (e.g., "Make walls light gray")
3. Optionally: Upload design references and generate a style prompt
4. Select output ratio and quality
5. Click "Compose Final Prompt" or "Create Directly"
6. Select which panoramas to render
7. Click "Start Render" on queued jobs

### Review Outputs
1. Go to "Render Jobs" tab
2. Find jobs with "Needs Review" status
3. Click "Review" to see the output
4. Compare before/after
5. Approve or reject with optional notes

### Download Results
1. Find a completed job with output
2. Click the download button on the job card
3. File downloads to your device

## Navigation
- Use the Navigation dropdown in the top bar
- Or use "My Profile" menu for quick access
- Logo always takes you back to Projects list

## Quality Settings
- 1K: 1024px, fastest processing
- 2K: 2048px, balanced quality
- 4K: 4096px, highest quality (requires compatible model)

## Tips
- Be specific in change requests for better results
- Design references help maintain consistent style
- Use the style prompt generator for complex transformations
- Check terminal logs if jobs fail
`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { message } = await req.json();
    
    if (!message || typeof message !== "string") {
      return new Response(
        JSON.stringify({ error: "Message is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Help chatbot received:", message);

    if (!API_NANOBANANA) {
      // Fallback response if no API key - generic multilingual response
      return new Response(
        JSON.stringify({ 
          response: "I can help you navigate RE:TOUR! You can upload panoramas in the Uploads section, create render jobs with change requests, and review outputs when they're ready. Use the Navigation menu or My Profile dropdown to move between sections." 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const systemPrompt = `You are a helpful, multilingual support assistant for RE:TOUR, a virtual tour rendering platform.

LANGUAGE HANDLING - CRITICAL:
1. DETECT the language of the user's message automatically
2. ALWAYS respond in the SAME LANGUAGE as the user's message
3. If the user writes in Hebrew, respond in Hebrew
4. If the user writes in English, respond in English
5. If the user writes in any other language, respond in that same language
6. Language is NEVER a reason to reject a question

SCOPE RULES:
1. You can ONLY answer questions about RE:TOUR site navigation, features, and workflows
2. For off-topic questions (weather, coding, math, general knowledge, news, etc.), politely decline IN THE USER'S LANGUAGE:
   - English: "I can only help with RE:TOUR site navigation and features. Please ask about uploading images, running renders, reviewing results, or using the dashboard."
   - Hebrew: "אני יכול לעזור רק עם ניווט ותכונות האתר RE:TOUR. אנא שאל על העלאת תמונות, הפעלת רינדורים, סקירת תוצאות, או שימוש בלוח הבקרה."
   - For other languages, translate the same message
3. Do NOT provide any information not covered in the site guide below
4. Keep responses SHORT (2-3 sentences max) and professional

SITE GUIDE:
${SITE_GUIDE}

Remember: Respond in the user's language. A valid question about the site in Hebrew deserves a Hebrew answer about the site.`;

    const geminiUrl = `${GEMINI_API_BASE}/${ORCHESTRATION_MODEL}:generateContent?key=${API_NANOBANANA}`;

    const response = await fetch(geminiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: systemPrompt + "\n\nUser message: " + message }
          ]
        }],
        generationConfig: {
          temperature: 0.5,
          maxOutputTokens: 500,
        }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Gemini API error:", response.status, errorText);
      return new Response(
        JSON.stringify({ 
          response: "I'm here to help you use RE:TOUR! You can ask me about uploading images, running renders, reviewing outputs, or navigating between sections." 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    const aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || "I can help you navigate RE:TOUR. What would you like to know?";

    console.log("Help chatbot response:", aiResponse.substring(0, 100));

    return new Response(
      JSON.stringify({ response: aiResponse }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Help chatbot error:", error);
    return new Response(
      JSON.stringify({ 
        response: "I'm here to help with RE:TOUR! Ask me about uploading images, running renders, or any feature." 
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
