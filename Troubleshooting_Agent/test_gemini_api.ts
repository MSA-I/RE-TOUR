// Test script to diagnose Gemini API issues
// Run this with: deno run --allow-net --allow-env test_gemini_api.ts

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");

if (!GEMINI_API_KEY) {
  console.error("❌ GEMINI_API_KEY not set in environment");
  Deno.exit(1);
}

console.log("✅ GEMINI_API_KEY found:", GEMINI_API_KEY.substring(0, 10) + "...");

// Test 1: Simple text-only API call
console.log("\n🧪 Test 1: Simple text generation...");
try {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: "Say hello in 3 words" }]
        }]
      }),
    }
  );

  const result = await response.json();

  if (!response.ok) {
    console.error("❌ API Error:", result);
    console.error("Status:", response.status);

    if (response.status === 400) {
      console.error("\n🔍 Error 400 usually means:");
      console.error("  - Invalid API key format");
      console.error("  - API key not enabled for Gemini API");
      console.error("  - Project billing not enabled");
    }

    if (response.status === 403) {
      console.error("\n🔍 Error 403 usually means:");
      console.error("  - API key doesn't have permission for this API");
      console.error("  - Need to enable Gemini API in Google Cloud Console");
    }

    Deno.exit(1);
  }

  const text = result.candidates[0].content.parts[0].text;
  console.log("✅ Success! Response:", text);

} catch (error) {
  console.error("❌ Network error:", error.message);
  Deno.exit(1);
}

// Test 2: Vision API call with a small test image
console.log("\n🧪 Test 2: Vision API with base64 image...");
try {
  // Simple 1x1 pixel red PNG image
  const testImageBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: "What do you see in this image? Answer in 5 words." },
            {
              inline_data: {
                mime_type: "image/png",
                data: testImageBase64
              }
            }
          ]
        }],
        generationConfig: {
          temperature: 0.9,
          maxOutputTokens: 100,
        },
      }),
    }
  );

  const result = await response.json();

  if (!response.ok) {
    console.error("❌ Vision API Error:", result);
    console.error("Status:", response.status);

    if (response.status === 400) {
      console.error("\n🔍 Vision API errors could mean:");
      console.error("  - Image format not supported");
      console.error("  - Base64 encoding issue");
      console.error("  - Image too large (max 4MB for free tier)");
    }

    Deno.exit(1);
  }

  const text = result.candidates[0].content.parts[0].text;
  console.log("✅ Success! Vision response:", text);

} catch (error) {
  console.error("❌ Network error:", error.message);
  Deno.exit(1);
}

console.log("\n✅ All tests passed! Gemini API is working correctly.");
console.log("\n🔍 Next steps:");
console.log("  1. Check edge function logs in Supabase dashboard");
console.log("  2. Look for '[save-camera-intents] AI generation failed' messages");
console.log("  3. The actual error will tell you what's failing");
