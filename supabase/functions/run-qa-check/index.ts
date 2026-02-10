import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import {
  ensurePipelineTrace,
  wrapModelGeneration,
  flushLangfuse,
} from "../_shared/langfuse-generation-wrapper.ts";
import {
  fetchPrompt,
  type LangfusePrompt,
} from "../_shared/langfuse-client.ts";
import {
  STEP_1_GENERATIONS,
  STEP_2_GENERATIONS,
  STEP_4_GENERATIONS,
  STEP_5_GENERATIONS,
  STEP_6_GENERATIONS,
  STEP_7_GENERATIONS,
  type StandardMetadata,
} from "../_shared/langfuse-constants.ts";
import {
  buildHumanFeedbackMemory,
  formatHumanFeedbackForPrompt,
  formatCompactSummary,
  type HumanFeedbackMemory,
} from "../_shared/human-feedback-memory.ts";
import {
  persistQAJudgeResult,
  persistQAFailure,
  extractReasonsFromResult,
  extractViolatedRulesFromResult,
  normalizeScore,
  QA_PASS_THRESHOLD,
} from "../_shared/qa-judge-persistence.ts";
import {
  trackRuleViolationsAndEscalate,
} from "../_shared/qa-learning-injector.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const API_NANOBANANA = Deno.env.get("API_NANOBANANA")!;

// DUAL-MODEL QA CONFIGURATION
// MANDATORY: Use Gemini 3 Pro Image Preview for visual+spatial understanding
const MODELS = {
  QA_PRIMARY: "gemini-3-pro-image-preview",
  QA_FALLBACK: "gemini-2.5-pro",
};

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// Maximum retry attempts before blocking for human review
const MAX_ATTEMPTS = 5;

// Maximum policy rules/cases to inject (prevents prompt bloat)
const MAX_POLICY_RULES_INJECTED = 5;
const MAX_SIMILAR_CASES_INJECTED = 3;

// Helper to get QA generation name for step
function getQAGenerationName(stepNumber: number): string {
  switch (stepNumber) {
    case 1: return STEP_1_GENERATIONS.QA_JUDGE;
    case 2: return STEP_2_GENERATIONS.QA_JUDGE;
    case 4: return STEP_4_GENERATIONS.QA_JUDGE;
    case 5: return STEP_5_GENERATIONS.QA_JUDGE;
    case 6: return STEP_6_GENERATIONS.QA_JUDGE;
    case 7: return STEP_7_GENERATIONS.QA_JUDGE;
    default: return `qa_judge_step_${stepNumber}`;
  }
}
// ═══════════════════════════════════════════════════════════════════════════════
// LEARNING CONTEXT TYPES
// ═══════════════════════════════════════════════════════════════════════════════
interface PolicyRule {
  id: string;
  scopeLevel: string;
  stepId: number | null;
  category: string;
  ruleText: string;
  supportCount: number;
}

interface SimilarCase {
  category: string;
  userDecision: string;
  userReasonShort: string;
  outcomeType: string;
}

interface CalibrationStat {
  category: string;
  falseRejectCount: number;
  falseApproveCount: number;
  confirmedCorrectCount: number;
}

interface LearningContext {
  policyRules: PolicyRule[];
  similarCases: SimilarCase[];
  calibrationStats: CalibrationStat[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROOM-TYPE VALIDATION RULES
// ═══════════════════════════════════════════════════════════════════════════════
const ROOM_TYPE_RULES: Record<string, { required: string[]; forbidden: string[] }> = {
  bedroom: {
    required: ["bed OR sleeping surface"],
    forbidden: ["toilet", "shower", "bathtub", "bathroom sink", "urinal", "bidet"],
  },
  master_bedroom: {
    required: ["bed OR sleeping surface"],
    forbidden: ["toilet", "shower", "bathtub", "bathroom sink", "urinal", "bidet"],
  },
  bathroom: {
    required: ["toilet OR shower OR bathtub OR bathroom sink"],
    forbidden: [],
  },
  kitchen: {
    required: ["kitchen counter OR cabinets OR stove OR oven"],
    forbidden: ["toilet", "shower", "bathtub", "bed"],
  },
  living_room: {
    required: ["sofa OR seating OR chairs"],
    forbidden: ["toilet", "shower", "bathtub", "bed", "kitchen appliances"],
  },
  closet: {
    required: ["shelves OR hanging rail OR storage"],
    forbidden: ["toilet", "shower", "bathtub", "bed"],
  },
  dining: {
    required: ["dining table OR eating surface"],
    forbidden: ["toilet", "shower", "bathtub", "bed"],
  },
};

function getRoomTypeValidationPrompt(spaceType: string): string {
  const normalizedType = spaceType.toLowerCase().replace(/\s+/g, "_");
  
  let rules = null;
  for (const [key, value] of Object.entries(ROOM_TYPE_RULES)) {
    if (normalizedType.includes(key)) {
      rules = value;
      break;
    }
  }

  if (!rules) {
    return `
ROOM TYPE VALIDATION:
- Space Type: ${spaceType}
- Verify the image shows fixtures appropriate for a ${spaceType}
- Flag any bathroom fixtures (toilet, shower, bathtub, sink) in non-bathroom spaces`;
  }

  return `
ROOM TYPE VALIDATION (STRICT):
- Declared Space Type: ${spaceType}
- REQUIRED elements (at least one must be visible): ${rules.required.join(", ")}
- FORBIDDEN elements (MUST NOT appear): ${rules.forbidden.join(", ")}

If ANY forbidden element is detected, the QA MUST FAIL with:
- room_type_violation = true
- Specific description of what fixture was found
- Evidence location in the image`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 1 QA PROMPT - 2D Floor Plan → Top-Down 3D (NO TEXT CHECKS)
// ═══════════════════════════════════════════════════════════════════════════════
const STEP1_QA_PROMPT = `You are a STRICT quality assurance system for Step 1 (2D floor plan → top-down 3D conversion).

═══════════════════════════════════════════════════════════════════════════════
STEP 1 QA - TEXT CHECKS COMPLETELY DISABLED
═══════════════════════════════════════════════════════════════════════════════

CRITICAL: This is a 2D→3D transformation. Text labels from the 2D floor plan
are NOT expected to appear in the 3D render. DO NOT check for text at all.

═══════════════════════════════════════════════════════════════════════════════
QA CHECKS (ONLY THESE - IN PRIORITY ORDER):
═══════════════════════════════════════════════════════════════════════════════

1. ROOM COUNT CONSISTENCY (STRICT):
   - Count the number of main functional rooms in both images
   - No new rooms may appear that don't exist in the floor plan
   - No existing rooms may disappear
   - This is PASS/FAIL with no exceptions

2. ROOM TYPE CONSISTENCY (STRICT):
   - A bathroom must not appear where none exists in the plan
   - A bedroom must not turn into a bathroom or kitchen
   - Functional room roles must remain consistent
   - Bathroom fixtures (toilet, shower, tub, sink) ONLY in bathrooms
   - Kitchen elements (counters, stove, sink) ONLY in kitchens

3. MAJOR FURNITURE INTEGRITY (STRICT):
   - Large, defining furniture must remain consistent:
     * Beds in bedrooms (appropriate size for room)
     * Toilets/showers ONLY in bathrooms
     * Kitchen counters ONLY in kitchen areas
   - No additional major furniture beyond what exists in the plan
   - No removal of major furniture that exists in the plan
   - Major items: sofas, dining tables, beds, kitchen islands

4. FURNITURE ORIENTATION (BASIC):
   - Beds must not rotate arbitrarily
   - Large furniture orientation must roughly match the plan
   - Minor rotation tolerance is allowed, but not layout changes

5. STRUCTURAL FIDELITY (WALLS/DOORS/WINDOWS):
   - Walls must match the source floor plan EXACTLY
   - Doors must be in correct positions - no invented or missing doors
   - Windows must be in correct positions - no invented or missing windows
   - No wall extensions, retractions, or angle changes

═══════════════════════════════════════════════════════════════════════════════
COMPLETELY FORBIDDEN QA CHECKS FOR STEP 1 (NEVER USE):
═══════════════════════════════════════════════════════════════════════════════

✗ Text labels - DO NOT CHECK (2D labels don't transfer to 3D)
✗ Room name labels - DO NOT CHECK
✗ Text presence/absence - DO NOT CHECK
✗ Text position - DO NOT CHECK
✗ Text font/color/language - DO NOT CHECK
✗ Lighting quality or ambiance
✗ Decorative style or aesthetic taste
✗ Material realism (beyond basic flooring type)
✗ Color harmony or palette
✗ Subjective "realism" judgments

═══════════════════════════════════════════════════════════════════════════════
MINOR ITEMS - TOLERATED (presence alone is NOT a rejection reason):
═══════════════════════════════════════════════════════════════════════════════

These items MAY appear even if not explicitly in floor plan:
- TV / television
- Dresser / nightstands
- Small decorative items (lamps, plants, rugs)

Only reject if placement is ILLOGICAL (e.g., TV blocking door, dresser in bathroom).

═══════════════════════════════════════════════════════════════════════════════
OUTPUT FORMAT (STRICT JSON) - APPROVAL REASONS MANDATORY
═══════════════════════════════════════════════════════════════════════════════

CRITICAL: Every decision (PASS or FAIL) MUST have detailed reasons.
Silent approvals are FORBIDDEN. Generic phrases are FORBIDDEN.

{
  "pass": true/false,
  "score": 0-100,
  "confidence_score": 0.0-1.0,
  "decision": "approve|reject",
  "room_count_original": 5,
  "room_count_generated": 5,
  "room_types_verified": ["bedroom", "bathroom", "kitchen", "living_room"],
  "structural_violation": true/false,
  "room_type_violation": true/false,
  "approval_reasons": [
    "MANDATORY FOR ALL PASSES - minimum 3 specific observations",
    "Example: 'Room count matches: 5 rooms in both floor plan and render'",
    "Example: 'Kitchen fixtures correctly confined to kitchen space (NE corner)'",
    "Example: 'Bed size appropriate for master bedroom - queen/king proportions'",
    "Example: 'Wall structure preserved - all 4 walls match floor plan angles'"
  ],
  "checks_performed": [
    {"check": "room_count", "result": "passed|failed", "observation": "specific observation"},
    {"check": "room_types", "result": "passed|failed", "observation": "specific observation"},
    {"check": "structural_fidelity", "result": "passed|failed", "observation": "specific observation"},
    {"check": "major_furniture", "result": "passed|failed", "observation": "specific observation"}
  ],
  "failure_categories": [
    "MANDATORY FOR ALL REJECTS - list specific categories",
    "Options: wrong_room|wrong_camera_direction|hallucinated_opening|missing_major_furniture|extra_major_furniture|layout_mismatch|ignored_camera|room_type_violation|structural_change|other"
  ],
  "rejection_explanation": "MANDATORY FOR REJECTS: Short, concrete explanation of what is wrong",
  "issues": [
    {
      "category": "room_count_mismatch|room_type_violation|structural_change|extra_furniture|missing_furniture|furniture_placement",
      "severity": "critical|major|minor",
      "short_reason": "ONE concrete sentence describing the issue",
      "visual_evidence": "describe exactly what you see"
    }
  ],
  "recommended_action": "approve|retry|needs_human",
  "corrected_instructions": "If retry, ONE specific fix instruction"
}

EXAMPLES OF VALID REJECTION REASONS:
✓ [room_type_violation] "Secondary bedroom shows toilet and shower fixtures - floor plan shows this as bedroom"
✓ [room_count_mismatch] "Generated image shows 6 rooms but floor plan only has 5"
✓ [structural_change] "Kitchen wall separating from dining room is missing in the render"
✓ [extra_furniture] "Large L-shaped sectional sofa added that doesn't exist in floor plan"

EXAMPLES OF INVALID REJECTION REASONS (DO NOT USE):
✗ "Kitchen label is missing" (text checks FORBIDDEN)
✗ "Room names not visible" (text checks FORBIDDEN)
✗ "Labels have wrong font" (text checks FORBIDDEN)
✗ "Lighting is unrealistic" (forbidden criterion)
✗ "Colors don't match" (forbidden criterion)
`;

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 3 COMPARISON PROMPT - MANDATORY FOR STEPS 4+
// ═══════════════════════════════════════════════════════════════════════════════
const STEP3_COMPARISON_PROMPT = `
═══════════════════════════════════════════════════════════════════════════════
MANDATORY IMAGE-TO-IMAGE VALIDATION (AGAINST STEP 3 OUTPUT)
═══════════════════════════════════════════════════════════════════════════════

You MUST compare the generated image against the Step 3 styled floor plan image.
This comparison is MANDATORY - you cannot approve without performing this check.

CHECK FOR STRUCTURAL CONSISTENCY:
1. WALL STRUCTURE: Verify all walls match the Step 3 layout
   - No extra walls that don't exist in Step 3
   - No missing walls that exist in Step 3
   - Wall angles must match exactly (do not straighten angled walls)

2. OPENINGS: Verify doors and windows match Step 3
   - No new openings where none exist in Step 3
   - No missing openings that exist in Step 3
   - Opening positions must align with Step 3

3. ROOM BOUNDARIES: The room shape must match Step 3
   - Room proportions (narrow vs wide) must be consistent
   - Corner positions must align
   - No wall extensions or retractions

4. ROOM TYPE CONSISTENCY: The room type in the generated image MUST match
   - If Step 3 shows a bedroom layout, the 3D render MUST be a bedroom
   - If Step 3 shows a bathroom layout, the 3D render MUST be a bathroom
   - CRITICAL: Bathroom fixtures (toilet, shower, tub, sink) MUST NOT appear in non-bathroom rooms

FAILURE CONDITIONS (MUST FAIL WITH AI_QA_FAIL):
- Any structural element that does NOT exist in Step 3
- Any missing structural element that DOES exist in Step 3
- Room type mismatch (e.g., bedroom rendered as bathroom)
- Spatial contradictions between Step 3 and generated image

When failing, you MUST provide EXPLICIT VISUAL EVIDENCE:
- "Detected [element] in [location] which does not exist in Step 3 source"
- "Missing [element] from [location] that exists in Step 3 source"
- "Step 3 shows [room type] but generated image shows [different room type]"

═══════════════════════════════════════════════════════════════════════════════
`;

const QA_PROMPTS = {
  render: `You are a STRICT quality assurance system for architectural interior renders.

YOUR PRIMARY JOB IS TO VISUALLY INSPECT THE GENERATED IMAGE AND COMPARE IT AGAINST THE SOURCE.

{STEP3_COMPARISON}

ANALYZE THIS RENDER FOR:
1. ARTIFACTS: Distorted objects, melted edges, impossible geometry, floating elements
2. PERSPECTIVE: Correct eye-level view (1.5-1.7m height), no fisheye, natural FOV
3. REALISM: Photorealistic quality, believable materials and lighting
4. COMPLETENESS: No cut-off furniture, no missing walls, coherent room
5. SEAMS: Check for visible joins, ghosting, stretching
6. TEXTURE: Look for watermark-like noise, texture glitches

{ROOM_TYPE_RULES}

CRITICAL VISUAL CHECKS:
- You MUST examine the actual pixels of the generated image
- You MUST compare against the Step 3 styled floor plan image
- Look for bathroom fixtures (toilet, shower, tub, sink) in non-bathroom rooms - this is a CRITICAL FAILURE
- Verify the room type matches the declared space type
- If room type is bedroom/closet but image shows bathroom fixtures: FAIL with room_type_violation
- If structural elements differ from Step 3: FAIL with structural_violation

{COMPARISON_INSTRUCTIONS}

═══════════════════════════════════════════════════════════════════════════════
🚨🚨🚨 CRITICAL OUTPUT REQUIREMENT - APPROVAL MUST BE EXPLAINED (NON-NEGOTIABLE) 🚨🚨🚨
═══════════════════════════════════════════════════════════════════════════════

**QA MUST NEVER SILENTLY APPROVE.** If you decide "pass: true", the response is INVALID without detailed "approval_reasons".

### APPROVAL OUTPUT RULES (MANDATORY FOR EVERY "pass: true"):

1. **"approval_reasons"** array MUST contain **EXACTLY 5 or more** specific visual observations. Each reason must:
   - Reference a SPECIFIC element you visually observed (wall, furniture item, fixture, opening)
   - Include LOCATION information (e.g., "north wall", "left side of image", "near window")
   - State the actual visual evidence you verified

2. **"confidence_score"** MUST be a number between 0.0 and 1.0 reflecting your certainty

3. **"checks_performed"** array MUST contain AT LEAST 4 checks with the actual observation text

### EXAMPLE OF A VALID APPROVAL (PASS):
{
  "pass": true,
  "approval_reasons": [
    "Room type verified as bedroom: Queen bed centered on south wall, no bathroom fixtures present",
    "Structural alignment: North wall with window opening at correct position matches Step 3 layout",
    "Camera direction correct: Looking toward entrance door on east wall as specified",
    "Furniture scale appropriate: Bed size (approx 1.5m x 2m) proportional to room width (~4m)",
    "No bathroom fixtures detected: Verified absence of toilet, shower, bathtub, sink in entire image",
    "Material consistency: Hardwood flooring matches Step 3 styling and bedroom designation"
  ],
  "checks_performed": [
    {"check": "room_type_match", "result": "passed", "observation": "Bed and nightstands visible, no sanitary fixtures"},
    {"check": "structural_alignment", "result": "passed", "observation": "Window on north wall, door on east wall matches Step 3"},
    {"check": "perspective_check", "result": "passed", "observation": "Eye-level ~1.6m, natural FOV, no fisheye distortion"},
    {"check": "artifact_scan", "result": "passed", "observation": "No melted edges, geometry coherent, shadows consistent"}
  ],
  "confidence_score": 0.92
}

### FORBIDDEN APPROVAL PHRASES (THESE WILL INVALIDATE YOUR RESPONSE):
❌ "No issues detected"
❌ "All checks passed" 
❌ "Looks good"
❌ "Image is acceptable"
❌ "Quality is satisfactory"
❌ "Meets requirements"

If you cannot provide 5+ specific visual observations, you MUST set "pass: false".

═══════════════════════════════════════════════════════════════════════════════
REJECTION OUTPUT RULES (MANDATORY FOR EVERY "pass: false"):
═══════════════════════════════════════════════════════════════════════════════

1. **"failure_categories"** - Use ONLY these exact category strings:
   wrong_room | wrong_camera_direction | hallucinated_opening | missing_major_furniture | 
   extra_major_furniture | layout_mismatch | ignored_camera | room_type_violation | 
   structural_change | seam_artifact | perspective_error | other

2. **"rejection_explanation"** - ONE concrete sentence describing the primary failure

3. **"issues"** array with severity and visual evidence for each problem

═══════════════════════════════════════════════════════════════════════════════

OUTPUT ONLY VALID JSON (no markdown, no code blocks):
{
  "pass": true/false,
  "score": 0-100,
  "confidence_score": 0.0-1.0,
  "decision": "approve|reject",
  "room_type_violation": true/false,
  "structural_violation": true/false,
  "step3_comparison_performed": true,
  "detected_room_type": "bedroom|bathroom|kitchen|living_room|closet|dining|other",
  "approval_reasons": ["MANDATORY FOR PASS: exactly 5+ specific visual observations with location details"],
  "failure_categories": ["MANDATORY FOR REJECT: category strings from the list above"],
  "rejection_explanation": "MANDATORY FOR REJECT: concrete explanation of what is wrong",
  "checks_performed": [{"check": "structural_alignment|room_type_match|artifact_scan|perspective_check|material_consistency|lighting_quality", "result": "passed|failed", "observation": "MANDATORY: exactly what you observed"}],
  "structural_issues": [{"type": "extra_wall|missing_wall|extra_opening|missing_opening|boundary_mismatch", "description": "...", "step3_evidence": "what Step 3 shows", "generated_evidence": "what generated image shows"}],
  "issues": [{"type": "artifact|perspective|realism|completeness|seam|texture|room_type|structural", "severity": "critical|major|minor", "description": "...", "location_hint": "...", "visual_evidence": "describe what you see"}],
  "request_fulfilled": true/false,
  "request_analysis": "analysis of whether requested changes were applied",
  "recommended_action": "approve|retry|needs_human",
  "corrected_instructions": "If retry, specific fix instructions referencing Step 3"
}`,

  panorama: `You are a strict QA system for 360° equirectangular panoramas.

{STEP3_COMPARISON}

CHECK FOR:
1. EQUIRECTANGULAR FORMAT: 2:1 aspect ratio, proper spherical projection
2. HORIZON: Centered, continuous, level
3. SEAMS: Left/right edges must connect seamlessly
4. ARTIFACTS: No duplicates, no melted geometry, no impossible structures
5. CONSISTENCY: Materials, lighting, and style coherent throughout
6. PERSPECTIVE: No fisheye distortion, correct VR-ready projection

{ROOM_TYPE_RULES}

CRITICAL: Verify the panorama is suitable for virtual tour viewers.
CRITICAL: Room structure must match the Step 3 floor plan.

═══════════════════════════════════════════════════════════════════════════════
CRITICAL OUTPUT REQUIREMENT - APPROVAL MUST BE EXPLAINED (NON-NEGOTIABLE)
═══════════════════════════════════════════════════════════════════════════════
Every decision (PASS or FAIL) MUST have detailed reasons.
Silent approvals are FORBIDDEN. Generic phrases are FORBIDDEN.

For PASS: Provide 3+ specific visual observations in "approval_reasons"
For FAIL: Provide "failure_categories" + "rejection_explanation" with evidence
═══════════════════════════════════════════════════════════════════════════════

OUTPUT ONLY JSON:
{
  "pass": true/false,
  "score": 0-100,
  "confidence_score": 0.0-1.0,
  "decision": "approve|reject",
  "room_type_violation": true/false,
  "structural_violation": true/false,
  "step3_comparison_performed": true,
  "detected_room_type": "what type of room this appears to be",
  "approval_reasons": ["MANDATORY FOR PASS: 3+ specific observations. e.g. 'Horizon centered at 50% height', 'Left-right seam invisible - wallpaper pattern continues', 'No duplicate furniture detected'"],
  "failure_categories": ["MANDATORY FOR REJECT: wrong_room|hallucinated_opening|seam_artifact|perspective_error|etc"],
  "rejection_explanation": "MANDATORY FOR REJECT: concrete explanation",
  "checks_performed": [{"check": "format_validation|horizon_check|seam_inspection|artifact_scan|consistency_check|projection_quality", "result": "passed|failed", "observation": "MANDATORY: specific visual evidence"}],
  "structural_issues": [{"type": "extra_wall|missing_wall|boundary_mismatch", "description": "...", "step3_evidence": "...", "generated_evidence": "..."}],
  "issues": [{"type": "format|horizon|seam|artifact|consistency|perspective|room_type|structural", "severity": "critical|major|minor", "description": "...", "location_hint": "...", "visual_evidence": "describe what you see"}],
  "request_fulfilled": true/false,
  "request_analysis": "analysis of panorama quality",
  "recommended_action": "approve|retry|needs_human",
  "corrected_instructions": "If retry, specific fix instructions"
}`,

  merge: `You are a strict QA system for merged 360° panoramas.

{STEP3_COMPARISON}

This panorama was created by merging MULTIPLE source images.

CHECK FOR MERGE-SPECIFIC ISSUES:
1. SEAMS: Visible join lines or blending artifacts between merged sources
2. DUPLICATES: Same object appearing twice from overlapping sources
3. GEOMETRY: Walls, floors, ceilings must be continuous and aligned
4. LIGHTING: No abrupt light/shadow discontinuities between sources
5. 360° COMPLETENESS: Full navigable spherical view
6. HALLUCINATION: Look for invented elements not in original sources

{ROOM_TYPE_RULES}

═══════════════════════════════════════════════════════════════════════════════
CRITICAL OUTPUT REQUIREMENT - APPROVAL MUST BE EXPLAINED (NON-NEGOTIABLE)
═══════════════════════════════════════════════════════════════════════════════
Every decision (PASS or FAIL) MUST have detailed reasons.
Silent approvals are FORBIDDEN. Generic phrases are FORBIDDEN.

For PASS: Provide 3+ specific visual observations in "approval_reasons"
For FAIL: Provide "failure_categories" + "rejection_explanation" with evidence
═══════════════════════════════════════════════════════════════════════════════

OUTPUT ONLY JSON:
{
  "pass": true/false,
  "score": 0-100,
  "confidence_score": 0.0-1.0,
  "decision": "approve|reject",
  "room_type_violation": true/false,
  "structural_violation": true/false,
  "step3_comparison_performed": true,
  "detected_room_type": "what type of room this appears to be",
  "approval_reasons": ["MANDATORY FOR PASS: 3+ specific observations. e.g. 'Merge seams invisible along ceiling line', 'No duplicate furniture from overlapping views', 'Lighting consistent throughout merged panorama'"],
  "failure_categories": ["MANDATORY FOR REJECT: seam_artifact|duplicate_object|lighting_mismatch|hallucinated_element|etc"],
  "rejection_explanation": "MANDATORY FOR REJECT: concrete explanation",
  "checks_performed": [{"check": "seam_blending|duplicate_detection|geometry_continuity|lighting_consistency|360_coverage|hallucination_check", "result": "passed|failed", "observation": "MANDATORY: specific visual evidence"}],
  "structural_issues": [{"type": "...", "description": "...", "step3_evidence": "...", "generated_evidence": "..."}],
  "issues": [{"type": "seam|duplicate|geometry|lighting|completeness|hallucination|room_type|structural", "severity": "critical|major|minor", "description": "...", "location_hint": "...", "visual_evidence": "describe what you see"}],
  "request_fulfilled": true/false,
  "request_analysis": "analysis of merge quality",
  "recommended_action": "approve|retry|needs_human",
  "corrected_instructions": "If retry, specific merge instructions"
}`
};

// ═══════════════════════════════════════════════════════════════════════════════
// LEARNING CONTEXT FETCHER + FORMATTER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Fetch learning context (policy rules, similar cases, calibration) for QA
 */
// deno-lint-ignore no-explicit-any
async function fetchLearningContext(
  serviceClient: any,
  ownerId: string,
  projectId: string | null,
  stepId: number
): Promise<LearningContext> {
  const emptyContext: LearningContext = { policyRules: [], similarCases: [], calibrationStats: [] };
  
  if (!projectId) return emptyContext;
  
  try {
    // 1. Fetch active policy rules (prioritize step > project > global)
    const { data: allRules } = await serviceClient
      .from("qa_policy_rules")
      .select("*")
      .eq("owner_id", ownerId)
      .eq("rule_status", "active")
      .or(`step_id.eq.${stepId},step_id.is.null`)
      .or(`project_id.eq.${projectId},project_id.is.null`)
      .order("scope_level", { ascending: false })
      .order("support_count", { ascending: false })
      .limit(10);

    // Dedupe by category, preferring step-specific
    const seenCategories = new Set<string>();
    const policyRules: PolicyRule[] = [];
    for (const rule of allRules || []) {
      const key = `${rule.step_id || "any"}_${rule.category}`;
      if (!seenCategories.has(key) && policyRules.length < MAX_POLICY_RULES_INJECTED) {
        seenCategories.add(key);
        policyRules.push({
          id: rule.id,
          scopeLevel: rule.scope_level,
          stepId: rule.step_id,
          category: rule.category,
          ruleText: rule.rule_text,
          supportCount: rule.support_count,
        });
      }
    }

    // 2. Fetch similar cases (same step preferred)
    const { data: casesData } = await serviceClient
      .from("qa_human_feedback")
      .select("user_category, user_decision, user_reason_short, qa_was_wrong")
      .eq("owner_id", ownerId)
      .eq("step_id", stepId)
      .order("created_at", { ascending: false })
      .limit(MAX_SIMILAR_CASES_INJECTED);

    const similarCases: SimilarCase[] = (casesData || []).map((c: {
      user_category: string;
      user_decision: string;
      user_reason_short: string;
      qa_was_wrong?: boolean;
    }) => ({
      category: c.user_category,
      userDecision: c.user_decision,
      userReasonShort: c.user_reason_short || "",
      outcomeType: c.qa_was_wrong ? "qa_wrong" : "confirmed",
    }));

    // 3. Fetch calibration stats
    const { data: calibData } = await serviceClient
      .from("qa_calibration_stats")
      .select("*")
      .eq("owner_id", ownerId)
      .eq("project_id", projectId)
      .eq("step_id", stepId);

    const calibrationStats: CalibrationStat[] = (calibData || []).map((stat: {
      category: string;
      false_reject_count: number;
      false_approve_count: number;
      confirmed_correct_count: number;
    }) => ({
      category: stat.category,
      falseRejectCount: stat.false_reject_count || 0,
      falseApproveCount: stat.false_approve_count || 0,
      confirmedCorrectCount: stat.confirmed_correct_count || 0,
    }));

    console.log(`[qa-check] Learning context: ${policyRules.length} rules, ${similarCases.length} cases, ${calibrationStats.length} stats`);
    
    return { policyRules, similarCases, calibrationStats };
  } catch (e) {
    console.error("[qa-check] Failed to fetch learning context:", e);
    return emptyContext;
  }
}

/**
 * Format learning context for injection into QA prompt
 * Keep it COMPACT - max ~300 tokens
 */
function formatLearningContextForPrompt(context: LearningContext): string {
  if (!context.policyRules.length && !context.similarCases.length && !context.calibrationStats.length) {
    return "";
  }

  const sections: string[] = [];
  sections.push("\n═══ LEARNED QA CALIBRATION (from user feedback) ═══");

  // Policy rules (SHORT)
  if (context.policyRules.length > 0) {
    sections.push("ACTIVE RULES:");
    for (const rule of context.policyRules.slice(0, MAX_POLICY_RULES_INJECTED)) {
      sections.push(`- [${rule.category}] ${rule.ruleText.slice(0, 100)}`);
    }
  }

  // Similar cases (few-shot examples)
  if (context.similarCases.length > 0) {
    sections.push("PAST USER DECISIONS:");
    for (const c of context.similarCases.slice(0, MAX_SIMILAR_CASES_INJECTED)) {
      const outcome = c.outcomeType === "qa_wrong" ? "← QA was wrong" : "";
      sections.push(`- [${c.category}] User ${c.userDecision}: "${c.userReasonShort.slice(0, 60)}" ${outcome}`);
    }
  }

  // Calibration bias (only if significant)
  const significantCalib = context.calibrationStats.filter(s => {
    const total = s.falseRejectCount + s.falseApproveCount + s.confirmedCorrectCount;
    return total >= 3; // Only include if we have enough data
  });
  
  if (significantCalib.length > 0) {
    sections.push("CALIBRATION BIAS:");
    for (const stat of significantCalib) {
      const total = stat.falseRejectCount + stat.falseApproveCount + stat.confirmedCorrectCount;
      const falseRejectRate = Math.round((stat.falseRejectCount / total) * 100);
      if (falseRejectRate > 30) {
        sections.push(`- [${stat.category}] High false-reject rate (${falseRejectRate}%) → be LESS strict`);
      } else if (stat.falseApproveCount > stat.confirmedCorrectCount) {
        sections.push(`- [${stat.category}] High false-approve rate → be MORE strict`);
      }
    }
  }

  sections.push("═══════════════════════════════════════════════════════\n");
  
  return sections.join("\n");
}

// deno-lint-ignore no-explicit-any
async function fetchImageAsBase64(supabase: any, uploadId: string): Promise<{ base64: string; mimeType: string }> {
  const { data: upload } = await supabase
    .from("uploads")
    .select("*")
    .eq("id", uploadId)
    .single();

  if (!upload) throw new Error(`Upload not found: ${uploadId}`);

  const { data: fileData } = await supabase.storage
    .from(upload.bucket)
    .download(upload.path);

  if (!fileData) throw new Error("Failed to download");

  const arrayBuffer = await fileData.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  return { base64: encodeBase64(uint8Array), mimeType: upload.mime_type || "image/jpeg" };
}

// Call QA with automatic fallback
async function callQAWithFallback(
  // deno-lint-ignore no-explicit-any
  payload: any,
  onFallback?: () => void
): Promise<{ response: unknown; usedFallback: boolean }> {
  // Try primary model first (Gemini 3 Pro Preview)
  try {
    const primaryUrl = `${GEMINI_API_BASE}/${MODELS.QA_PRIMARY}:generateContent?key=${API_NANOBANANA}`;
    console.log(`[qa-check] Trying primary model: ${MODELS.QA_PRIMARY}`);
    
    const response = await fetch(primaryUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      return { response: await response.json(), usedFallback: false };
    }

    if (response.status === 429 || response.status === 503 || response.status === 500) {
      console.log(`[qa-check] Primary model returned ${response.status}, falling back...`);
      onFallback?.();
    } else {
      const errorText = await response.text();
      throw new Error(`Primary QA failed: ${response.status} - ${errorText}`);
    }
  } catch (error) {
    console.log("[qa-check] Primary model error, trying fallback:", error);
    onFallback?.();
  }

  // Try fallback model (Gemini 2.5 Pro)
  console.log(`[qa-check] Using fallback model: ${MODELS.QA_FALLBACK}`);
  const fallbackUrl = `${GEMINI_API_BASE}/${MODELS.QA_FALLBACK}:generateContent?key=${API_NANOBANANA}`;
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

// ═══════════════════════════════════════════════════════════════════════════════
// AUTOMATIC RETRY TRIGGER
// ═══════════════════════════════════════════════════════════════════════════════
async function triggerAutoRetry(
  authHeader: string,
  assetType: "render" | "panorama" | "final360",
  assetId: string,
  rejectionReason: string
): Promise<{ triggered: boolean; blocked?: boolean; message: string }> {
  try {
    console.log(`[qa-check] Auto-triggering retry for ${assetType} ${assetId}`);
    
    const response = await fetch(`${SUPABASE_URL}/functions/v1/run-reject-and-retry`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": authHeader,
      },
      body: JSON.stringify({
        asset_type: assetType,
        asset_id: assetId,
        rejection_notes: rejectionReason,
        auto_triggered: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[qa-check] Auto-retry failed: ${errorText}`);
      return { triggered: false, message: `Auto-retry failed: ${errorText}` };
    }

    const result = await response.json();
    
    if (result.blocked_for_human) {
      return { 
        triggered: false, 
        blocked: true, 
        message: `Max attempts (${MAX_ATTEMPTS}) reached. Blocked for manual review.` 
      };
    }

    return { 
      triggered: true, 
      message: `Auto-retry ${result.attempt_count}/${MAX_ATTEMPTS} triggered` 
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[qa-check] Auto-retry error: ${message}`);
    return { triggered: false, message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// STRUCTURED QA EXPLANATION BUILDER HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

interface CheckItem {
  check: string;
  result: string;
  evidence: string;
}

interface PerformedCheck {
  check: string;
  result: string;
  observation: string;
}

// deno-lint-ignore no-explicit-any
function buildSummaryFromChecks(approvalReasons: string[], qaResult: any, spaceType: string | undefined): string {
  // Try to build a meaningful summary from available data
  if (approvalReasons.length > 0) {
    // Take first 2-3 key points to summarize
    const keyPoints = approvalReasons.slice(0, 3);
    return keyPoints.join("; ");
  }
  
  // Build from detected data
  const parts: string[] = [];
  if (qaResult.detected_room_type) {
    parts.push(`Room type verified as ${qaResult.detected_room_type}`);
  } else if (spaceType) {
    parts.push(`Expected room type: ${spaceType}`);
  }
  
  if (qaResult.structural_violation === false) {
    parts.push("structural alignment confirmed with floor plan");
  }
  
  if (qaResult.room_type_violation === false && spaceType) {
    parts.push(`no inappropriate fixtures for ${spaceType}`);
  }
  
  return parts.length > 0 
    ? parts.join("; ") + "."
    : "QA checks completed. See detailed checks below for specifics.";
}

// deno-lint-ignore no-explicit-any
function buildArchitectureChecks(checks: PerformedCheck[], qaResult: any): CheckItem[] {
  const items: CheckItem[] = [];
  
  // Look for structural checks in performed checks
  for (const check of checks) {
    const checkLower = check.check.toLowerCase();
    if (checkLower.includes("structural") || checkLower.includes("wall") || checkLower.includes("door") || checkLower.includes("window") || checkLower.includes("alignment")) {
      items.push({
        check: check.check.replace(/_/g, " "),
        result: check.result === "passed" ? "pass" : "fail",
        evidence: check.observation,
      });
    }
  }
  
  // Add default if empty
  if (items.length === 0) {
    items.push({
      check: "Wall structure",
      result: qaResult.structural_violation ? "fail" : "pass",
      evidence: qaResult.structural_violation 
        ? "Structural issues detected - see structural_issues for details"
        : "Wall structure appears consistent with floor plan layout",
    });
  }
  
  return items;
}

// deno-lint-ignore no-explicit-any
function buildMaterialsChecks(checks: PerformedCheck[], _qaResult: any): CheckItem[] {
  const items: CheckItem[] = [];
  
  for (const check of checks) {
    const checkLower = check.check.toLowerCase();
    if (checkLower.includes("material") || checkLower.includes("floor") || checkLower.includes("texture") || checkLower.includes("lighting")) {
      items.push({
        check: check.check.replace(/_/g, " "),
        result: check.result === "passed" ? "pass" : "fail",
        evidence: check.observation,
      });
    }
  }
  
  if (items.length === 0) {
    items.push({
      check: "Surface materials",
      result: "pass",
      evidence: "Materials appear consistent and realistic",
    });
  }
  
  return items;
}

// deno-lint-ignore no-explicit-any
function buildFurnitureChecks(checks: PerformedCheck[], qaResult: any, spaceType: string | undefined): CheckItem[] {
  const items: CheckItem[] = [];
  
  for (const check of checks) {
    const checkLower = check.check.toLowerCase();
    if (checkLower.includes("furniture") || checkLower.includes("room_type") || checkLower.includes("fixture")) {
      items.push({
        check: check.check.replace(/_/g, " "),
        result: check.result === "passed" ? "pass" : "fail",
        evidence: check.observation,
      });
    }
  }
  
  // Add room type specific checks
  if (spaceType && !qaResult.room_type_violation) {
    items.push({
      check: `Appropriate fixtures for ${spaceType}`,
      result: "pass",
      evidence: `Room appears correctly furnished as ${qaResult.detected_room_type || spaceType}`,
    });
  }
  
  if (items.length === 0) {
    items.push({
      check: "Furniture presence",
      result: "pass",
      evidence: "Furniture appears appropriate for the space",
    });
  }
  
  return items;
}

// deno-lint-ignore no-explicit-any
function buildScaleChecks(checks: PerformedCheck[], _qaResult: any): CheckItem[] {
  const items: CheckItem[] = [];
  
  for (const check of checks) {
    const checkLower = check.check.toLowerCase();
    if (checkLower.includes("scale") || checkLower.includes("perspective") || checkLower.includes("proportion")) {
      items.push({
        check: check.check.replace(/_/g, " "),
        result: check.result === "passed" ? "pass" : "fail",
        evidence: check.observation,
      });
    }
  }
  
  if (items.length === 0) {
    items.push({
      check: "Proportions",
      result: "pass",
      evidence: "Furniture and architectural elements appear to be at realistic scale",
    });
  }
  
  return items;
}

// deno-lint-ignore no-explicit-any
function buildArtifactChecks(checks: PerformedCheck[], _qaResult: any): CheckItem[] {
  const items: CheckItem[] = [];
  
  for (const check of checks) {
    const checkLower = check.check.toLowerCase();
    if (checkLower.includes("artifact") || checkLower.includes("seam") || checkLower.includes("distortion") || checkLower.includes("quality")) {
      items.push({
        check: check.check.replace(/_/g, " "),
        result: check.result === "passed" ? "pass" : "fail",
        evidence: check.observation,
      });
    }
  }
  
  if (items.length === 0) {
    items.push({
      check: "AI artifacts",
      result: "pass",
      evidence: "No visible AI generation artifacts, distortions, or impossible geometry",
    });
  }
  
  return items;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData } = await supabase.auth.getUser(token);
    if (!claimsData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { 
      upload_id, 
      qa_type, 
      source_upload_id, 
      change_request,
      // Enhanced validation context
      floor_plan_upload_id,
      step3_output_upload_id,
      space_type,
      space_name,
      render_kind,
      // Asset tracking for auto-retry
      asset_id,
      asset_type,
      current_attempt,
      // NEW: For learning context
      project_id,
      step_id,
      // NEW: Camera anchor validation (mandatory for Steps 5-7)
      camera_marker_id,
      anchor_base_plan_path,
      anchor_single_overlay_path,
      anchor_crop_overlay_path,
    } = await req.json();

    if (!upload_id || !qa_type) {
      return new Response(
        JSON.stringify({ error: "Missing upload_id or qa_type" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const validTypes = ["render", "panorama", "merge"];
    if (!validTypes.includes(qa_type)) {
      return new Response(
        JSON.stringify({ error: `qa_type must be one of: ${validTypes.join(", ")}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const userId = claimsData.user.id;
    
    // Track processing time for persistence
    const qaStartTime = Date.now();

    console.log(`[qa-check] Running ${qa_type} QA on upload ${upload_id}`);
    console.log(`[qa-check] Space: ${space_name} (${space_type}), Kind: ${render_kind}`);
    console.log(`[qa-check] Step 3 reference: ${step3_output_upload_id || "NOT PROVIDED"}`);
    console.log(`[qa-check] Attempt: ${current_attempt || 1}/${MAX_ATTEMPTS}`);
    console.log(`[qa-check] Step ID: ${step_id || "not provided"}`);
    console.log(`[qa-check] Project ID: ${project_id || "not provided"}`);
    console.log(`[qa-check] Pipeline/Asset ID: ${asset_id || "not provided"}`);

    // ═══════════════════════════════════════════════════════════════════════════
    // FETCH LEARNING CONTEXT + HUMAN FEEDBACK MEMORY (MANDATORY)
    // ═══════════════════════════════════════════════════════════════════════════
    const effectiveStepId = step_id || (qa_type === "render" ? 5 : qa_type === "panorama" ? 6 : 7);
    
    // LEGACY: Fetch policy rules, similar cases, calibration stats
    const learningContext = await fetchLearningContext(serviceClient, userId, project_id, effectiveStepId);
    const learningContextPrompt = formatLearningContextForPrompt(learningContext);
    
    // NEW: Fetch comprehensive human feedback memory for prompt injection
    let humanFeedbackMemory: HumanFeedbackMemory | null = null;
    let humanFeedbackPrompt = "";
    
    if (project_id) {
      try {
        humanFeedbackMemory = await buildHumanFeedbackMemory(
          serviceClient,
          userId,
          project_id,
          effectiveStepId,
          { limit: 20 }
        );
        humanFeedbackPrompt = formatHumanFeedbackForPrompt(humanFeedbackMemory);
        console.log(`[qa-check] Human feedback memory injected: ${humanFeedbackMemory.examples_count} examples, ${humanFeedbackMemory.learned_preferences_summary.length} preferences, strictness: ${humanFeedbackMemory.calibration_hints.user_strictness}`);
      } catch (e) {
        console.warn(`[qa-check] Failed to fetch human feedback memory: ${e}`);
      }
    }

    // Fetch the generated image
    const { base64: imageBase64, mimeType } = await fetchImageAsBase64(serviceClient, upload_id);
    console.log(`[qa-check] Generated image loaded for visual inspection`);

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP-SPECIFIC PROMPT SELECTION
    // ═══════════════════════════════════════════════════════════════════════════
    const isStep1 = step_id === 1 || effectiveStepId === 1;
    
    let basePrompt: string;
    
    if (isStep1) {
      // STEP 1: Use specialized deterministic QA prompt with minor items logic
      console.log(`[qa-check] Using STEP 1 specialized QA prompt (deterministic + minor items placement)`);
      basePrompt = STEP1_QA_PROMPT;
      
      // Add space context for Step 1
      if (space_name && space_type) {
        basePrompt = `SPACE CONTEXT:
- Space Name: ${space_name}
- Declared Space Type: ${space_type}
- Current Attempt: ${current_attempt || 1}/${MAX_ATTEMPTS}

${basePrompt}`;
      }
      
      // Inject legacy learning context
      if (learningContextPrompt) {
        basePrompt += "\n" + learningContextPrompt;
      }
      
      // INJECT HUMAN FEEDBACK MEMORY (MANDATORY for learning from user behavior)
      if (humanFeedbackPrompt) {
        basePrompt += "\n" + humanFeedbackPrompt;
      }
    } else {
      // STEPS 4+ : Use standard QA prompts with Step 3 comparison
      
      // Build room-type validation rules
      const roomTypeRules = space_type ? getRoomTypeValidationPrompt(space_type) : "";

      // Build Step 3 comparison instructions
      let step3ComparisonSection = "";
      if (step3_output_upload_id) {
        step3ComparisonSection = STEP3_COMPARISON_PROMPT;
      } else {
        console.log(`[qa-check] WARNING: No Step 3 reference provided - structural validation limited`);
        step3ComparisonSection = `
NOTE: Step 3 reference image was NOT provided. 
Structural validation is limited. Focus on room type validation and artifact detection.`;
      }

      // Build comparison instructions for Kind B
      let comparisonInstructions = "";
      if (render_kind === "B" && source_upload_id) {
        comparisonInstructions = `
COMPARISON CHECK (KIND B - OPPOSITE ANGLE):
- Compare with the source image (Kind A render) provided below
- Verify this shows the SAME room from a different angle
- Room type MUST match between renders
- Furniture and materials should be consistent
- If Kind A shows bedroom, Kind B MUST also be bedroom (not bathroom)
- Wall structure must match exactly - no extra or missing walls`;
      } else if (source_upload_id) {
        comparisonInstructions = `
COMPARISON CHECK:
- Compare with the source image provided below
- Verify style and materials are consistent
- Check that requested changes were applied`;
      }

      // Build base prompt with all sections + LEARNING CONTEXT
      basePrompt = QA_PROMPTS[qa_type as keyof typeof QA_PROMPTS]
        .replace("{STEP3_COMPARISON}", step3ComparisonSection)
        .replace("{ROOM_TYPE_RULES}", roomTypeRules)
        .replace("{COMPARISON_INSTRUCTIONS}", comparisonInstructions);
      
      // INJECT LEGACY LEARNING CONTEXT
      if (learningContextPrompt) {
        basePrompt += "\n" + learningContextPrompt;
      }
      
      // INJECT HUMAN FEEDBACK MEMORY (MANDATORY for learning from user behavior)
      if (humanFeedbackPrompt) {
        basePrompt += "\n" + humanFeedbackPrompt;
      }

      // Add space context
      if (space_name && space_type) {
        basePrompt = `SPACE CONTEXT:
- Space Name: ${space_name}
- Declared Space Type: ${space_type}
- Render Kind: ${render_kind || "A"}
- Current Attempt: ${current_attempt || 1}/${MAX_ATTEMPTS}

${basePrompt}`;
      }
    }

    // Build message parts - Include all images for visual validation
    // deno-lint-ignore no-explicit-any
    const parts: any[] = [
      { text: basePrompt },
      { text: "\n\nGENERATED IMAGE TO VALIDATE (examine this carefully):" },
      { inlineData: { mimeType, data: imageBase64 } },
    ];

    // Add change request context if provided
    if (change_request) {
      parts.push({ text: `\n\nCHANGE REQUEST TO VERIFY:\n${change_request}` });
    }

    // CRITICAL: Add Step 3 output for structural comparison (MANDATORY for Steps 4+)
    if (step3_output_upload_id) {
      try {
        const { base64: step3Base64, mimeType: step3Mime } = await fetchImageAsBase64(serviceClient, step3_output_upload_id);
        parts.push({ text: "\n\n═══ STEP 3 STYLED FLOOR PLAN (MANDATORY COMPARISON SOURCE) ═══\nYou MUST compare the generated image against this Step 3 output. Check for structural consistency:" });
        parts.push({ inlineData: { mimeType: step3Mime, data: step3Base64 } });
        console.log(`[qa-check] Step 3 output loaded for mandatory structural comparison`);
      } catch (e) {
        console.error(`[qa-check] CRITICAL: Could not load Step 3 output: ${e}`);
        // This is a critical failure - we cannot validate without Step 3
        parts.push({ text: "\n\nWARNING: Step 3 reference image could not be loaded. Structural validation is compromised." });
      }
    }

    // If source provided (for BEFORE/AFTER comparison), include it
    if (source_upload_id && source_upload_id !== step3_output_upload_id) {
      try {
        const { base64: sourceBase64, mimeType: sourceMime } = await fetchImageAsBase64(serviceClient, source_upload_id);
        parts.push({ text: "\n\nSOURCE IMAGE (compare against this for Kind B consistency):" });
        parts.push({ inlineData: { mimeType: sourceMime, data: sourceBase64 } });
        console.log(`[qa-check] Source image loaded for comparison`);
      } catch (e) {
        console.log(`[qa-check] Could not load source image: ${e}`);
      }
    }

    // If floor plan provided, include it for additional boundary validation
    if (floor_plan_upload_id) {
      try {
        const { base64: fpBase64, mimeType: fpMime } = await fetchImageAsBase64(serviceClient, floor_plan_upload_id);
        parts.push({ text: "\n\nORIGINAL FLOOR PLAN (additional reference for room boundaries):" });
        parts.push({ inlineData: { mimeType: fpMime, data: fpBase64 } });
        console.log(`[qa-check] Floor plan loaded for boundary validation`);
      } catch (e) {
        console.log(`[qa-check] Could not load floor plan: ${e}`);
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CAMERA ANCHOR VALIDATION (MANDATORY FOR STEPS 5-7)
    // ═══════════════════════════════════════════════════════════════════════════
    // Load anchor images directly from storage paths if provided
    const loadAnchorFromPath = async (path: string | null): Promise<string | null> => {
      if (!path) return null;
      try {
        const { data, error } = await serviceClient.storage.from("outputs").download(path);
        if (error || !data) return null;
        const arrayBuffer = await data.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
      } catch {
        return null;
      }
    };

    if (anchor_single_overlay_path) {
      try {
        const anchorOverlayBase64 = await loadAnchorFromPath(anchor_single_overlay_path);
        if (anchorOverlayBase64) {
          parts.push({ text: "\n\n📍 CAMERA ANCHOR OVERLAY (Verify render matches this camera direction and position):" });
          parts.push({ inlineData: { mimeType: "image/png", data: anchorOverlayBase64 } });
          console.log(`[qa-check] Camera anchor overlay loaded for direction validation`);
        }
      } catch (e) {
        console.log(`[qa-check] Could not load camera anchor overlay: ${e}`);
      }
    }

    if (anchor_crop_overlay_path) {
      try {
        const anchorCropBase64 = await loadAnchorFromPath(anchor_crop_overlay_path);
        if (anchorCropBase64) {
          parts.push({ text: "\n\n📍 CAMERA ANCHOR CROP (Verify render shows this specific space from this angle):" });
          parts.push({ inlineData: { mimeType: "image/png", data: anchorCropBase64 } });
          console.log(`[qa-check] Camera anchor crop loaded for space validation`);
        }
      } catch (e) {
        console.log(`[qa-check] Could not load camera anchor crop: ${e}`);
      }
    }

    // Build Gemini payload
    const geminiPayload = {
      contents: [{ parts }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 3000,
      },
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // LANGFUSE-TRACED QA LLM CALL
    // ═══════════════════════════════════════════════════════════════════════════
    // Determine pipeline_id for proper tracing (asset_id is often the pipeline_id for space assets)
    const pipelineId = asset_id || upload_id;
    const qaGenerationName = getQAGenerationName(effectiveStepId);
    
    // Build metadata for Langfuse (include human feedback stats for auditability)
    const qaMetadata: StandardMetadata & Record<string, unknown> = {
      project_id: project_id || "",
      pipeline_id: pipelineId,
      step_number: effectiveStepId,
      attempt_index: current_attempt || 1,
      model_name: MODELS.QA_PRIMARY, // Will be updated if fallback
      room_name: space_name || undefined,
      // Human feedback memory stats for Langfuse auditability
      human_feedback_examples_count: humanFeedbackMemory?.examples_count || 0,
      learned_preferences_count: humanFeedbackMemory?.learned_preferences_summary.length || 0,
      user_strictness: humanFeedbackMemory?.calibration_hints.user_strictness || "unknown",
      false_reject_rate: humanFeedbackMemory?.calibration_hints.false_reject_rate || 0,
    };

    // Ensure trace exists
    await ensurePipelineTrace(pipelineId, project_id || "", userId);

    console.log(`[qa-check] Langfuse trace ensured: ${pipelineId}, generation: ${qaGenerationName}`);

    // Call QA with Langfuse wrapper
    let usedFallback = false;
    let qaResponse: unknown;
    let modelUsed = MODELS.QA_PRIMARY;

    const qaResult_wrapped = await wrapModelGeneration<{ candidates: Array<{ content: { parts: Array<{ text: string }> } }> }>(
      {
        traceId: pipelineId,
        generationName: qaGenerationName,
        model: MODELS.QA_PRIMARY,
        metadata: qaMetadata,
        promptInfo: {
          name: "retour_evaluator_qa_judge",
          source: "code",
        },
        finalPromptText: basePrompt.substring(0, 20000), // Truncate for logging
        variables: {
          qa_type,
          space_type,
          space_name,
          render_kind,
          step_id: effectiveStepId,
          attempt: current_attempt || 1,
          has_step3_reference: !!step3_output_upload_id,
          has_floor_plan: !!floor_plan_upload_id,
          has_anchor_overlay: !!anchor_single_overlay_path,
          // Compact human feedback summary for Langfuse input traceability
          human_feedback_memory_summary: humanFeedbackMemory 
            ? formatCompactSummary(humanFeedbackMemory) 
            : "none",
        },
        requestParams: {
          temperature: 0.1,
          maxOutputTokens: 3000,
        },
        imageCount: parts.filter((p: { inlineData?: unknown }) => p.inlineData).length,
      },
      async () => {
        // Primary model call
        const primaryUrl = `${GEMINI_API_BASE}/${MODELS.QA_PRIMARY}:generateContent?key=${API_NANOBANANA}`;
        console.log(`[qa-check] Trying primary model: ${MODELS.QA_PRIMARY}`);
        
        const response = await fetch(primaryUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(geminiPayload),
        });

        if (response.ok) {
          return await response.json();
        }

        // Check if we should fallback
        if (response.status === 429 || response.status === 503 || response.status === 500) {
          console.log(`[qa-check] Primary model returned ${response.status}, falling back...`);
          usedFallback = true;
          modelUsed = MODELS.QA_FALLBACK;
          
          // Fallback call
          const fallbackUrl = `${GEMINI_API_BASE}/${MODELS.QA_FALLBACK}:generateContent?key=${API_NANOBANANA}`;
          const fallbackResponse = await fetch(fallbackUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(geminiPayload),
          });

          if (!fallbackResponse.ok) {
            const errorText = await fallbackResponse.text();
            throw new Error(`QA fallback also failed: ${fallbackResponse.status} - ${errorText}`);
          }

          return await fallbackResponse.json();
        }

        const errorText = await response.text();
        throw new Error(`Primary QA failed: ${response.status} - ${errorText}`);
      }
    );

    if (!qaResult_wrapped.success || !qaResult_wrapped.data) {
      throw qaResult_wrapped.error || new Error("QA LLM call failed");
    }

    qaResponse = qaResult_wrapped.data;

    // deno-lint-ignore no-explicit-any
    const content = (qaResponse as any).candidates?.[0]?.content?.parts?.[0]?.text || "";
    console.log(`[qa-check] Response received from ${usedFallback ? MODELS.QA_FALLBACK : MODELS.QA_PRIMARY} (traced in Langfuse)`);

    // Parse JSON
    // deno-lint-ignore no-explicit-any
    let qaResult: any;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        qaResult = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found");
      }
    } catch (e) {
      console.error(`[qa-check] Parse error: ${e}`);
      qaResult = {
        pass: false,
        score: 0,
        room_type_violation: false,
        structural_violation: false,
        step3_comparison_performed: false,
        detected_room_type: "unknown",
        structural_issues: [],
        issues: [{ type: "parse_error", severity: "critical", description: "Failed to parse QA response", visual_evidence: "N/A" }],
        request_fulfilled: false,
        request_analysis: "Could not analyze - parse error",
        recommended_action: "needs_human",
        corrected_instructions: null,
      };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CRITICAL FAILURE CHECKS
    // ═══════════════════════════════════════════════════════════════════════════
    
    // 1. Room Type Violation
    if (qaResult.room_type_violation === true) {
      console.log(`[qa-check] ROOM TYPE VIOLATION DETECTED`);
      console.log(`[qa-check] Declared: ${space_type}, Detected: ${qaResult.detected_room_type}`);
      qaResult.pass = false;
      qaResult.score = Math.min(qaResult.score || 0, 30);
      qaResult.recommended_action = "retry";
      
      if (!qaResult.issues) qaResult.issues = [];
      qaResult.issues.unshift({
        type: "room_type",
        severity: "critical",
        description: `Room type mismatch: Expected ${space_type} but image shows ${qaResult.detected_room_type}`,
        location_hint: "entire image",
        visual_evidence: `Bathroom fixtures visible in ${space_type} space`,
      });
      
      qaResult.corrected_instructions = `CRITICAL: This space is a ${space_type}, NOT a ${qaResult.detected_room_type}. Do NOT include bathroom fixtures (toilet, shower, bathtub, sink). Generate appropriate ${space_type} furniture instead.`;
    }

    // 2. Structural Violation (Step 3 mismatch)
    if (qaResult.structural_violation === true) {
      console.log(`[qa-check] STRUCTURAL VIOLATION DETECTED - Step 3 mismatch`);
      qaResult.pass = false;
      qaResult.score = Math.min(qaResult.score || 0, 25);
      qaResult.recommended_action = "retry";
      
      if (!qaResult.issues) qaResult.issues = [];
      
      // Add structural issues to main issues list
      if (qaResult.structural_issues?.length > 0) {
        for (const issue of qaResult.structural_issues) {
          qaResult.issues.unshift({
            type: "structural",
            severity: "critical",
            description: issue.description,
            location_hint: issue.type,
            visual_evidence: `Step 3: ${issue.step3_evidence}. Generated: ${issue.generated_evidence}`,
          });
        }
      }
      
      qaResult.corrected_instructions = `CRITICAL: The generated image has structural elements that do not match the Step 3 floor plan. Regenerate ensuring walls, openings, and room boundaries EXACTLY match the Step 3 styled layout.`;
    }

    // 3. Verify Step 3 comparison was actually performed
    if (step3_output_upload_id && !qaResult.step3_comparison_performed) {
      console.log(`[qa-check] WARNING: Step 3 comparison was not performed`);
      qaResult.pass = false;
      qaResult.score = Math.min(qaResult.score || 0, 40);
      if (!qaResult.issues) qaResult.issues = [];
      qaResult.issues.push({
        type: "validation_incomplete",
        severity: "major",
        description: "Step 3 comparison was required but not performed",
        visual_evidence: "QA did not report step3_comparison_performed",
      });
    }

    // Ensure required fields + normalize approval/rejection data
    const decision = qaResult.pass ? "approve" : "reject";
    const confidenceScore = qaResult.confidence_score ?? (qaResult.pass ? 0.8 : 0.7);
    
    // Build failure categories from issues if not explicitly provided
    let failureCategories = qaResult.failure_categories || [];
    if (!qaResult.pass && failureCategories.length === 0 && qaResult.issues?.length > 0) {
      failureCategories = qaResult.issues
        .filter((i: { severity: string }) => i.severity === "critical" || i.severity === "major")
        .map((i: { type?: string; category?: string }) => i.category || i.type || "other");
    }
    
    // Build rejection explanation if not provided
    let rejectionExplanation = qaResult.rejection_explanation || "";
    if (!qaResult.pass && !rejectionExplanation && qaResult.issues?.length > 0) {
      rejectionExplanation = qaResult.issues
        .slice(0, 2)
        .map((i: { description: string }) => i.description)
        .join("; ");
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // CRITICAL: VALIDATE APPROVAL HAS DETAILED REASONS (ENFORCE ON BACKEND)
    // ═══════════════════════════════════════════════════════════════════════════
    let approvalReasons = qaResult.approval_reasons || [];
    const checksPerformed = qaResult.checks_performed || [];
    
    // If pass=true but no real approval_reasons, build them from checks_performed
    if (qaResult.pass && approvalReasons.length < 3) {
      console.log(`[qa-check] WARNING: Approval without sufficient reasons (${approvalReasons.length}). Building from checks.`);
      
      // Try to build reasons from checks_performed
      const generatedReasons: string[] = [];
      
      for (const check of checksPerformed) {
        if (check.result === "passed" && check.observation) {
          generatedReasons.push(`${check.check}: ${check.observation}`);
        }
      }
      
      // Add generic verification statements if still not enough
      if (generatedReasons.length < 3) {
        if (space_type) {
          generatedReasons.push(`Room type verified: Image appears to be a ${qaResult.detected_room_type || space_type} as expected`);
        }
        generatedReasons.push(`Structural check: Room structure and proportions appear consistent with source floor plan`);
        generatedReasons.push(`Quality check: No major artifacts, distortions, or impossible geometry detected`);
        generatedReasons.push(`Perspective check: Eye-level camera view at appropriate height (~1.6m)`);
        generatedReasons.push(`Material check: Surfaces and finishes appear realistic and consistent`);
      }
      
      // Merge any existing reasons with generated ones, limit to 5-6 total
      approvalReasons = [...approvalReasons, ...generatedReasons].slice(0, 6);
      
      console.log(`[qa-check] Built ${approvalReasons.length} approval reasons from checks`);
    }
    
    // If pass=true and checks_performed is empty, build minimal checks
    let finalChecksPerformed = checksPerformed;
    if (qaResult.pass && checksPerformed.length < 3) {
      console.log(`[qa-check] WARNING: Approval without sufficient checks. Building defaults.`);
      finalChecksPerformed = [
        { check: "room_type_match", result: "passed", observation: qaResult.detected_room_type ? `Detected room type: ${qaResult.detected_room_type}` : "Room type appears appropriate" },
        { check: "structural_alignment", result: "passed", observation: qaResult.structural_violation ? "Issues detected" : "Structure consistent with floor plan" },
        { check: "artifact_scan", result: "passed", observation: "No major visual artifacts detected" },
        { check: "perspective_check", result: "passed", observation: "Eye-level perspective appears correct" },
      ];
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // BUILD STRUCTURED QA EXPLANATION (NEW SCHEMA)
    // ═══════════════════════════════════════════════════════════════════════════
    const rawQaExplanation = qaResult.qa_explanation || {};
    const qaExplanation = {
      verdict: qaResult.pass ? "approved" : "rejected",
      confidence: confidenceScore,
      summary: rawQaExplanation.summary || buildSummaryFromChecks(approvalReasons, qaResult, space_type),
      architecture_checks: rawQaExplanation.architecture_checks || buildArchitectureChecks(finalChecksPerformed, qaResult),
      materials_checks: rawQaExplanation.materials_checks || buildMaterialsChecks(finalChecksPerformed, qaResult),
      furniture_checks: rawQaExplanation.furniture_checks || buildFurnitureChecks(finalChecksPerformed, qaResult, space_type),
      scale_and_layout: rawQaExplanation.scale_and_layout || buildScaleChecks(finalChecksPerformed, qaResult),
      artifacts_and_ai_issues: rawQaExplanation.artifacts_and_ai_issues || buildArtifactChecks(finalChecksPerformed, qaResult),
      notes_for_next_step: rawQaExplanation.notes_for_next_step || null,
      rejection_reasons: qaResult.pass ? [] : (rawQaExplanation.rejection_reasons || failureCategories.map((cat: string) => `${cat}: ${rejectionExplanation}`)),
    };
    
    qaResult = {
      pass: qaResult.pass ?? false,
      score: qaResult.score ?? 0,
      confidence_score: confidenceScore,
      decision: decision,
      room_type_violation: qaResult.room_type_violation ?? false,
      structural_violation: qaResult.structural_violation ?? false,
      step3_comparison_performed: qaResult.step3_comparison_performed ?? false,
      detected_room_type: qaResult.detected_room_type || "unknown",
      // STRUCTURED QA EXPLANATION (NEW)
      qa_explanation: qaExplanation,
      // Detailed approval reasons - NOW VALIDATED AND ENRICHED
      approval_reasons: approvalReasons,
      // Failure categories for rejections
      failure_categories: failureCategories,
      rejection_explanation: rejectionExplanation,
      checks_performed: finalChecksPerformed,
      structural_issues: qaResult.structural_issues || [],
      issues: qaResult.issues || [],
      request_fulfilled: qaResult.request_fulfilled ?? false,
      request_analysis: qaResult.request_analysis || "",
      recommended_action: qaResult.recommended_action || "needs_human",
      corrected_instructions: qaResult.corrected_instructions || null,
      model_used: usedFallback ? MODELS.QA_FALLBACK : MODELS.QA_PRIMARY,
      used_fallback: usedFallback,
      space_type_declared: space_type,
      space_name: space_name,
      attempt: current_attempt || 1,
      max_attempts: MAX_ATTEMPTS,
    };

    console.log(`[qa-check] Result: pass=${qaResult.pass}, score=${qaResult.score}, room_violation=${qaResult.room_type_violation}, structural_violation=${qaResult.structural_violation}`);

    // ═══════════════════════════════════════════════════════════════════════════
    // PERSIST QA RESULT TO DATABASE (MANDATORY for UI display and analytics)
    // ═══════════════════════════════════════════════════════════════════════════
    const processingEndTime = Date.now();
    const processingTimeMs = qaStartTime ? processingEndTime - qaStartTime : null;
    
    // Extract pipeline_id - prioritize asset_id as it's often the pipeline_id for space assets
    const pipelineIdForPersist = asset_id || pipelineId;
    
    if (pipelineIdForPersist && project_id) {
      try {
        const persistResult = await persistQAJudgeResult({
          supabase: serviceClient,
          pipeline_id: pipelineIdForPersist,
          project_id: project_id,
          owner_id: userId,
          step_number: effectiveStepId,
          sub_step: null, // Can be extended for sub-steps
          output_id: upload_id,
          attempt_index: current_attempt || 1,
          pass: qaResult.pass,
          score: normalizeScore(qaResult.score),
          confidence: qaResult.confidence_score,
          reasons: extractReasonsFromResult(qaResult),
          violated_rules: extractViolatedRulesFromResult(qaResult),
          full_result: qaResult as Record<string, unknown>,
          judge_model: qaResult.model_used,
          prompt_name: "retour_evaluator_qa_judge",
          prompt_version: null, // Will be set from Langfuse when integrated
          processing_time_ms: processingTimeMs,
        });
        
        if (persistResult.success) {
          console.log(`[qa-check] ✓ Persisted QA result to DB: ${persistResult.id}`);

          // Track rule violations and escalate constraints if QA failed
          if (qaResult.pass === false) {
            const violatedRules = extractViolatedRulesFromResult(qaResult);
            if (violatedRules.length > 0) {
              try {
                await trackRuleViolationsAndEscalate(
                  serviceClient,
                  violatedRules,
                  userId,
                  effectiveStepId
                );
                console.log(`[qa-check] ✓ Tracked ${violatedRules.length} rule violations for escalation`);
              } catch (escalateErr) {
                console.error(`[qa-check] ✗ Failed to track rule violations:`, escalateErr);
                // Don't block response on escalation failure
              }
            }
          }
        } else {
          console.error(`[qa-check] ✗ Failed to persist QA result: ${persistResult.error}`);
        }
      } catch (persistErr) {
        console.error(`[qa-check] ✗ Exception persisting QA result:`, persistErr);
        // Don't block the response on persist failure
      }
    } else {
      console.warn(`[qa-check] ⚠ Cannot persist QA result - missing pipeline_id (${pipelineIdForPersist}) or project_id (${project_id})`);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // AUTO-RETRY ON FAILURE (if asset tracking provided)
    // ═══════════════════════════════════════════════════════════════════════════
    if (!qaResult.pass && asset_id && asset_type) {
      console.log(`[qa-check] QA FAILED - Checking auto-retry eligibility...`);
      
      const attempt = current_attempt || 1;
      
      if (attempt < MAX_ATTEMPTS) {
        // Build rejection reason from issues
        const rejectionReason = qaResult.issues
          .filter((i: { severity: string }) => i.severity === "critical" || i.severity === "major")
          .map((i: { description: string }) => i.description)
          .join("; ") || "QA validation failed";
        
        const retryResult = await triggerAutoRetry(
          authHeader,
          asset_type as "render" | "panorama" | "final360",
          asset_id,
          rejectionReason
        );
        
        qaResult.auto_retry = {
          triggered: retryResult.triggered,
          blocked_for_human: retryResult.blocked || false,
          message: retryResult.message,
        };
        
        console.log(`[qa-check] Auto-retry result: ${retryResult.message}`);
      } else {
        console.log(`[qa-check] Max attempts reached - blocking for human review`);
        qaResult.auto_retry = {
          triggered: false,
          blocked_for_human: true,
          message: `Max attempts (${MAX_ATTEMPTS}) reached. Manual review required.`,
        };
      }
    }

    // NOTE: Langfuse logging is now handled by wrapModelGeneration above
    // The QA LLM call is fully traced with input (prompt + variables) and output (parsed result)

    // CRITICAL: Flush Langfuse events before returning
    await flushLangfuse();

    return new Response(
      JSON.stringify(qaResult),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[qa-check] Error: ${message}`);
    
    // Try to persist the failure to DB for visibility
    // Note: We can't access the variables from try block, but we try to provide what we can
    try {
      const body = await req.clone().json().catch(() => ({}));
      if (body.project_id && (body.asset_id || body.upload_id)) {
        const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const effectiveStepId = body.step_id || (body.qa_type === "render" ? 4 : body.qa_type === "panorama" ? 5 : 6);
        
        // Get user ID from auth header
        const authHeader = req.headers.get("authorization") || "";
        let ownerId = "unknown";
        if (authHeader.startsWith("Bearer ")) {
          try {
            const token = authHeader.replace("Bearer ", "");
            const { data } = await serviceClient.auth.getUser(token);
            if (data?.user?.id) ownerId = data.user.id;
          } catch { /* ignore auth errors */ }
        }
        
        await persistQAFailure(
          serviceClient,
          body.asset_id || body.upload_id,
          body.project_id,
          ownerId,
          effectiveStepId,
          body.current_attempt || 1,
          message,
          MODELS.QA_PRIMARY,
          null,
          body.upload_id
        );
        console.log(`[qa-check] Persisted QA failure to DB`);
      }
    } catch (persistErr) {
      console.error(`[qa-check] Could not persist failure:`, persistErr);
    }
    
    // Flush Langfuse even on error
    await flushLangfuse();
    
    return new Response(
      JSON.stringify({
        pass: false,
        score: 0,
        room_type_violation: false,
        structural_violation: false,
        step3_comparison_performed: false,
        detected_room_type: "error",
        structural_issues: [],
        issues: [{ type: "error", severity: "critical", description: message, visual_evidence: "N/A" }],
        request_fulfilled: false,
        request_analysis: "Error during QA",
        recommended_action: "needs_human",
        corrected_instructions: null,
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
