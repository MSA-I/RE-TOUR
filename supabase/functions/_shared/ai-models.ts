/**
 * Dual-Model AI Configuration for RE:TOUR
 * 
 * ALL AI TASKS USE API_NANOBANANA (Google Gemini API)
 * 
 * PRODUCTION MODELS:
 * - Orchestration (compose, prompt building): Gemini 3 Flash (fast, cheap)
 * - Image Generation: Gemini 3 Pro Image Preview
 * 
 * QA/VALIDATION MODELS:
 * - Primary: Gemini 3 Pro Preview (best reasoning)
 * - Fallback: Gemini 2.5 Pro (stable, reliable)
 */

export const AI_MODELS = {
  // QA/Validation - MANDATORY: Gemini 3 Pro Image Preview for visual QA
  // This model has visual+spatial understanding required for image QA
  QA: {
    primary: "gemini-3-pro-image-preview",
    fallback: "gemini-2.5-pro",
    provider: "google",
  },
  
  // Production orchestration - Gemini 3 Flash (fast, cheap)
  ORCHESTRATION: {
    model: "gemini-3-flash-preview",
    provider: "google",
  },
  
  // Image generation - Gemini 3 Pro Image Preview
  IMAGE_GENERATION: {
    model: "gemini-3-pro-image-preview",
    provider: "google",
  },

  // Text analysis (replaces OpenAI GPT-4o) - Gemini 2.5 Pro
  TEXT_ANALYSIS: {
    model: "gemini-2.5-pro",
    provider: "google",
  },
} as const;

// Gemini API base URL
export const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Get model URL for any Gemini model
 */
export function getGeminiModelUrl(modelName: string, apiKey: string): string {
  return `${GEMINI_API_BASE}/${modelName}:generateContent?key=${apiKey}`;
}

/**
 * Get QA model URL with fallback support
 */
export function getQAModelUrl(apiKey: string, useFallback = false): string {
  const model = useFallback ? AI_MODELS.QA.fallback : AI_MODELS.QA.primary;
  return `${GEMINI_API_BASE}/${model}:generateContent?key=${apiKey}`;
}

/**
 * Get orchestration model URL
 */
export function getOrchestrationUrl(apiKey: string): string {
  return `${GEMINI_API_BASE}/${AI_MODELS.ORCHESTRATION.model}:generateContent?key=${apiKey}`;
}

/**
 * Get text analysis model URL (for tasks that were using GPT-4o)
 */
export function getTextAnalysisUrl(apiKey: string): string {
  return `${GEMINI_API_BASE}/${AI_MODELS.TEXT_ANALYSIS.model}:generateContent?key=${apiKey}`;
}

/**
 * Get image generation model URL
 */
export function getImageGenerationUrl(apiKey: string): string {
  return `${GEMINI_API_BASE}/${AI_MODELS.IMAGE_GENERATION.model}:generateContent?key=${apiKey}`;
}

/**
 * QA Prompt for Multi-Image Panorama and general image validation
 */
export const QA_SYSTEM_PROMPT = `You are a strict quality assurance system for architectural interior renders and panoramas.

ANALYZE THE OUTPUT FOR:
1. REQUEST COMPLIANCE: Does the output match what was requested?
2. ARTIFACTS: Distorted objects, melted edges, impossible geometry, floating elements
3. SEAMS: Visible join lines, blending artifacts, duplicated elements
4. PERSPECTIVE: Correct eye-level view, no fisheye distortion, natural FOV
5. CONSISTENCY: Materials, lighting, and style coherent throughout
6. COMPLETENESS: No cut-off furniture, no missing walls, coherent space

CRITICAL CHECKS:
- Compare BEFORE and AFTER images if provided
- Verify the specific change/request was actually applied
- Check for ghosting, stretching, mismatched perspective
- Look for watermark-like noise or texture glitches

OUTPUT JSON ONLY:
{
  "pass": true/false,
  "score": 0-100,
  "issues": [
    {
      "type": "artifact|seam|perspective|consistency|compliance|other",
      "severity": "critical|major|minor",
      "description": "specific issue description",
      "location_hint": "where in the image"
    }
  ],
  "request_fulfilled": true/false,
  "request_analysis": "brief analysis of whether the request was fulfilled",
  "recommended_action": "approve|retry|reject",
  "corrected_instructions": "if retry, specific prompt improvements to fix issues"
}`;

/**
 * Call QA with automatic fallback on failure
 */
export async function callQAWithFallback(
  apiKey: string,
  payload: any,
  onFallback?: () => void
): Promise<{ response: any; usedFallback: boolean }> {
  // Try primary model first
  try {
    const primaryUrl = getQAModelUrl(apiKey, false);
    const response = await fetch(primaryUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      return { response: await response.json(), usedFallback: false };
    }

    // Check for rate limit or quota errors
    if (response.status === 429 || response.status === 503 || response.status === 500) {
      console.log(`Primary QA model returned ${response.status}, falling back...`);
      onFallback?.();
    } else {
      throw new Error(`Primary QA failed: ${response.status}`);
    }
  } catch (error) {
    console.log("Primary QA model error, trying fallback:", error);
    onFallback?.();
  }

  // Try fallback model
  const fallbackUrl = getQAModelUrl(apiKey, true);
  const fallbackResponse = await fetch(fallbackUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!fallbackResponse.ok) {
    const errorText = await fallbackResponse.text();
    throw new Error(`QA fallback also failed: ${fallbackResponse.status} - ${errorText}`);
  }

  return { response: await fallbackResponse.json(), usedFallback: true };
}

/**
 * Parse QA result from Gemini response
 */
export function parseQAResult(geminiResponse: any): {
  pass: boolean;
  score: number;
  issues: any[];
  request_fulfilled: boolean;
  request_analysis: string;
  recommended_action: string;
  corrected_instructions: string | null;
} {
  const content = geminiResponse.candidates?.[0]?.content?.parts?.[0]?.text || "";
  
  // Extract JSON from response
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error("No JSON found in QA response:", content);
    return {
      pass: false,
      score: 0,
      issues: [{ type: "parse_error", severity: "critical", description: "Failed to parse QA response" }],
      request_fulfilled: false,
      request_analysis: "Could not analyze - parse error",
      recommended_action: "retry",
      corrected_instructions: null,
    };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      pass: parsed.pass ?? false,
      score: parsed.score ?? 0,
      issues: parsed.issues || [],
      request_fulfilled: parsed.request_fulfilled ?? false,
      request_analysis: parsed.request_analysis || "",
      recommended_action: parsed.recommended_action || "retry",
      corrected_instructions: parsed.corrected_instructions || null,
    };
  } catch (e) {
    console.error("JSON parse error:", e);
    return {
      pass: false,
      score: 0,
      issues: [{ type: "parse_error", severity: "critical", description: "Failed to parse QA JSON" }],
      request_fulfilled: false,
      request_analysis: "Could not analyze - parse error",
      recommended_action: "retry",
      corrected_instructions: null,
    };
  }
}
