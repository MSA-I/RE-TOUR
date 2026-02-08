/**
 * Centralized quality policy for the Whole Apartment Pipeline
 * 
 * POLICY:
 * - Steps 0-3 (Analysis, Top-Down, Style, Detect Spaces) → ALWAYS 2K
 * - Steps 4+ (Renders, Panoramas, Merge) → User-selectable via quality_post_step4
 * 
 * This file provides a single source of truth for quality enforcement.
 * 
 * INTEGRATION WITH PIPELINE SCHEMAS:
 * - This module is imported by schema-validator.ts for rule enforcement
 * - All quality checks are deterministic (no LLM)
 */

export type QualityTier = "1K" | "2K" | "4K";
export type AspectRatio = "1:1" | "4:3" | "16:9" | "2:1";

export interface QualityPolicyConfig {
  stepIndex: number;
  qualityPostStep4: string | null | undefined;
  outputResolution: string | null | undefined;
}

/**
 * STEP QUALITY OVERRIDE TABLE
 * Steps 0-3 ALWAYS use 2K regardless of user preference
 */
export const STEP_QUALITY_OVERRIDE: Record<number, QualityTier> = {
  0: "2K", // Space Analysis
  1: "2K", // Top-Down 3D
  2: "2K", // Style
  3: "2K", // Detect Spaces
  // Steps 4+ use user preference
};

/**
 * DIMENSION LIMITS PER QUALITY TIER
 * Used for validation after generation
 */
export const QUALITY_DIMENSIONS: Record<QualityTier, { min: number; max: number }> = {
  "1K": { min: 800, max: 1200 },
  "2K": { min: 1800, max: 2400 },
  "4K": { min: 3600, max: 4200 }
};

/**
 * SIZE LIMITS
 */
export const SIZE_LIMITS = {
  MAX_PREVIEW_BYTES: 2 * 1024 * 1024,      // 2MB
  MAX_ORIGINAL_BYTES: 50 * 1024 * 1024,    // 50MB
  MAX_IMAGES_PER_STEP: 12,
  URL_EXPIRY_SECONDS: 3600,                 // 1 hour
};

/**
 * Get the effective quality for a given step.
 * Steps 0-3 always return "2K" regardless of settings.
 * Steps 4+ use quality_post_step4 if set, otherwise fall back to output_resolution or "2K".
 */
export function getEffectiveQuality(config: QualityPolicyConfig): QualityTier {
  const { stepIndex, qualityPostStep4, outputResolution } = config;
  
  // Steps 0-3 (Analysis, Top-Down, Style, Detect Spaces) → ALWAYS 2K
  const override = STEP_QUALITY_OVERRIDE[stepIndex];
  if (override) {
    return override;
  }
  
  // Steps 4+ use quality_post_step4 if set
  const quality = qualityPostStep4 || outputResolution || "2K";
  
  // Validate and return
  if (quality === "1K" || quality === "2K" || quality === "4K") {
    return quality as QualityTier;
  }
  
  return "2K";
}

/**
 * Validate that dimensions match the expected quality tier
 */
export function validateDimensionsForQuality(
  width: number, 
  height: number, 
  expectedQuality: QualityTier
): { valid: boolean; message: string } {
  const limits = QUALITY_DIMENSIONS[expectedQuality];
  const maxDim = Math.max(width, height);
  
  if (maxDim < limits.min) {
    return { 
      valid: false, 
      message: `Dimensions ${width}x${height} too small for ${expectedQuality} (min ${limits.min}px)`
    };
  }
  
  if (maxDim > limits.max) {
    return { 
      valid: false, 
      message: `Dimensions ${width}x${height} too large for ${expectedQuality} (max ${limits.max}px)`
    };
  }
  
  return { valid: true, message: "OK" };
}

/**
 * Check if ratio can be modified for the given phase.
 * Ratio is locked once the pipeline starts (past upload phase).
 */
export function isRatioLocked(phase: string | null | undefined, ratioLocked: boolean | null | undefined): boolean {
  if (ratioLocked === true) return true;
  
  // Lock ratio after upload phase
  const unlockedPhases = ["upload", "space_analysis_pending"];
  return !unlockedPhases.includes(phase || "upload");
}

/**
 * Check if quality_post_step4 can be modified.
 * Only allowed if no Step 4+ jobs have been created yet.
 */
export function canModifyQualityPostStep4(phase: string | null | undefined): boolean {
  // Allow modification until renders start
  const allowedPhases = [
    "upload",
    "space_analysis_pending",
    "space_analysis_running",
    "space_analysis_complete",
    "top_down_3d_pending",
    "top_down_3d_running",
    "top_down_3d_review",
    "style_pending",
    "style_running",
    "style_review",
    "style_approved",
    "detect_spaces_pending",
    "detecting_spaces",
    "spaces_detected",
  ];
  
  return allowedPhases.includes(phase || "upload");
}

/**
 * Map step names to step indices for the Whole Apartment Pipeline
 */
export const STEP_INDEX_MAP: Record<string, number> = {
  "space_analysis": 0,
  "top_down_3d": 1,
  "style": 2,
  "detect_spaces": 3,
  "renders": 4,
  "panoramas": 5,
  "merge": 6,
};

/**
 * Get step index from phase name
 */
export function getStepIndexFromPhase(phase: string): number {
  if (phase.includes("space_analysis")) return 0;
  if (phase.includes("top_down")) return 1;
  if (phase.includes("style")) return 2;
  if (phase.includes("detect") || phase.includes("spaces_detected")) return 3;
  if (phase.includes("render")) return 4;
  if (phase.includes("panorama")) return 5;
  if (phase.includes("merg")) return 6;
  if (phase === "completed") return 7;
  return 0;
}

/**
 * VALIDATION HELPER: Check if step index requires 2K quality override
 */
export function requiresQualityOverride(stepIndex: number): boolean {
  return stepIndex in STEP_QUALITY_OVERRIDE;
}
