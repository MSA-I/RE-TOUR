/**
 * Shared QA Workflow for Steps 5-7
 * 
 * Implements the 5-attempt max retry loop with:
 * - AI-QA check after each generation
 * - Auto-fix prompt builder for retries
 * - Learning context injection
 * - Camera/Space binding validation
 * - ARCHITECTURAL VALIDATION (adjacency, wall/opening, camera direction)
 */

import { fetchLearningContext, formatLearningContextForPrompt, buildAutoFixPromptDelta } from "./qa-learning-injector.ts";
import { 
  runArchitecturalQA, 
  ArchitecturalQAInput, 
  ArchitecturalQAResult,
  ArchitecturalQAIssue 
} from "./architectural-qa-validator.ts";
import { SpatialMap, CameraMarker } from "./camera-context-builder.ts";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const QA_MODEL = "gemini-2.5-pro";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

export const QA_CONFIG = {
  MAX_ATTEMPTS: 5, // 5 attempts max as per spec
  BLOCK_AUTO_RETRY_SEVERITIES: ["critical"],
  MIN_SCORE_FOR_PASS: 80,
  // Architectural QA is mandatory for Steps 5-7
  ARCHITECTURAL_QA_ENABLED: true,
};

// ═══════════════════════════════════════════════════════════════════════════
// ENHANCED QA RESULT WITH ARCHITECTURAL VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

export interface QAResult {
  pass: boolean;
  overall_score: number;
  issues: Array<{
    type: string;
    severity: "critical" | "major" | "minor";
    description: string;
    location_hint?: string;
    expected?: string;
    actual?: string;
  }>;
  recommended_action: "approve" | "retry" | "needs_human";
  corrected_instructions?: string;
  // NEW: Architectural validation details
  architectural_validation?: {
    adjacency_check: "pass" | "fail" | "skipped";
    wall_opening_check: "pass" | "fail" | "skipped";
    camera_direction_check: "pass" | "fail" | "skipped";
    camera_override_check: "pass" | "fail" | "skipped";
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// ENHANCED QA CHECK PARAMS WITH ARCHITECTURAL CONTEXT
// ═══════════════════════════════════════════════════════════════════════════

export interface QACheckParams {
  imageBase64: string;
  mimeType: string;
  qaType: "RENDER" | "PANORAMA" | "MERGE";
  spaceContext: {
    space_name: string;
    space_type: string;
    space_id?: string;
    camera_kind?: string;
    x_norm?: number;
    y_norm?: number;
    yaw_deg?: number;
    fov_deg?: number;
  };
  learningContext: string;
  apiKey: string;
  // NEW: Architectural validation inputs
  architecturalContext?: {
    floorPlanBase64?: string;
    floorPlanMimeType?: string;
    cameraMarker?: CameraMarker | null;
    spatialMap?: SpatialMap | null;
    stepNumber: 5 | 6 | 7;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// QA PROMPTS WITH SPACE/CAMERA BINDING RULES (LEGACY - still used for basic checks)
// ═══════════════════════════════════════════════════════════════════════════

export const QA_PROMPTS = {
  RENDER: `You are a STRICT quality assurance system for interior renders.

CAMERA/SPACE BINDING RULES (CRITICAL):
- The render MUST match the specified space type: {space_type}
- Camera position was at: ({x_norm}, {y_norm}) looking at yaw={yaw_deg}°
- FAIL if room type doesn't match (e.g., bathroom fixtures in bedroom = FAIL)
- FAIL if furniture placement violates room scale or proportions

ARCHITECTURAL CHECKS:
- Wall angles MUST match the floor plan (no straightening angled walls)
- Door/window placements must be consistent
- Scale must be realistic (furniture fits room proportions)

FURNITURE RULES (FLEXIBLE):
- Adding/removing decorative items (TV, artwork, plants) is ACCEPTABLE
- However, any added item must be PLACED PLAUSIBLY (TV on wall, not floating)
- Core furniture for room type must be present (bed in bedroom, sofa in living room)

{LEARNING_CONTEXT}

OUTPUT JSON ONLY:
{
  "pass": true/false,
  "overall_score": 0-100,
  "issues": [
    {"type": "room_mismatch|scale_error|geometry|placement|missing_furniture", "severity": "critical|major|minor", "description": "...", "location_hint": "..."}
  ],
  "recommended_action": "approve|retry|needs_human",
  "corrected_instructions": "If retry needed, specific fix instructions"
}`,

  PANORAMA: `You are a STRICT quality assurance system for 360° panoramic images.

CAMERA/SPACE BINDING RULES (CRITICAL):
- This panorama is for space: {space_name} ({space_type})
- Camera view: {camera_kind} ({camera_kind === "A" ? "Primary" : "Opposite angle"})
- The panorama MUST represent the same room as the source render

360° FORMAT CHECKS:
- Valid 2:1 equirectangular format with centered horizon
- Left and right edges must connect seamlessly
- No visible seams or stitching artifacts

CONTENT CHECKS:
- No hallucinated objects (only what's in source render)
- No duplicated furniture
- No major distortions (warped geometry, melted edges)

{LEARNING_CONTEXT}

OUTPUT JSON ONLY:
{
  "pass": true/false,
  "overall_score": 0-100,
  "issues": [
    {"type": "hallucination|duplicate|distortion|format|seam|room_mismatch", "severity": "critical|major|minor", "description": "...", "location_hint": "..."}
  ],
  "recommended_action": "approve|retry|needs_human",
  "corrected_instructions": "If retry needed, specific fix instructions"
}`,

  MERGE: `You are a STRICT quality assurance system for merged 360° panoramas.

SPACE BINDING RULES (CRITICAL):
- This merged panorama is for space: {space_name}
- It combines two opposite-angle panoramas of the SAME room
- FAIL if the merged result shows two different rooms

MERGE-SPECIFIC CHECKS:
- No visible seam artifacts where the two sources meet
- No duplicated elements from overlapping source content
- Geometry continues properly (walls, floor patterns aligned)
- Lighting is consistent throughout
- Style and materials match between regions
- The 360° feels complete and navigable

{LEARNING_CONTEXT}

OUTPUT JSON ONLY:
{
  "pass": true/false,
  "overall_score": 0-100,
  "issues": [
    {"type": "seam|duplicate|geometry|lighting|style|completeness|room_mismatch", "severity": "critical|major|minor", "description": "...", "location_hint": "..."}
  ],
  "recommended_action": "approve|retry|needs_human",
  "corrected_instructions": "If retry needed, specific merge fix instructions"
}`,
};

// ═══════════════════════════════════════════════════════════════════════════
// QA EXECUTION - Enhanced with Architectural Validation
// ═══════════════════════════════════════════════════════════════════════════

export async function runQACheck(params: QACheckParams): Promise<QAResult> {
  const { imageBase64, mimeType, qaType, spaceContext, learningContext, apiKey, architecturalContext } = params;
  
  // ═══════════════════════════════════════════════════════════════════════════
  // RUN ARCHITECTURAL QA FIRST (if context is provided for Steps 5-7)
  // ═══════════════════════════════════════════════════════════════════════════
  let architecturalResult: ArchitecturalQAResult | null = null;
  
  if (QA_CONFIG.ARCHITECTURAL_QA_ENABLED && architecturalContext && spaceContext.space_id) {
    console.log(`[space-qa] Running architectural QA for step ${architecturalContext.stepNumber}`);
    
    try {
      architecturalResult = await runArchitecturalQA({
        renderedImageBase64: imageBase64,
        renderedMimeType: mimeType,
        floorPlanBase64: architecturalContext.floorPlanBase64,
        floorPlanMimeType: architecturalContext.floorPlanMimeType,
        spaceName: spaceContext.space_name,
        spaceType: spaceContext.space_type,
        spaceId: spaceContext.space_id,
        cameraKind: (spaceContext.camera_kind as "A" | "B") || "A",
        cameraMarker: architecturalContext.cameraMarker || null,
        spatialMap: architecturalContext.spatialMap || null,
        stepNumber: architecturalContext.stepNumber,
        apiKey,
        learningContext,
      });
      
      console.log(`[space-qa] Architectural QA result: pass=${architecturalResult.pass}, score=${architecturalResult.overall_score}`);
      
      // If architectural QA fails with critical issues, return immediately
      const hasCriticalArchIssues = architecturalResult.issues.some(i => i.severity === "critical");
      if (hasCriticalArchIssues) {
        console.log(`[space-qa] Architectural QA found critical issues - blocking approval`);
        return {
          pass: false,
          overall_score: architecturalResult.overall_score,
          issues: architecturalResult.issues.map(i => ({
            type: i.rule,
            severity: i.severity,
            description: i.description,
            location_hint: i.location_hint,
            expected: i.expected,
            actual: i.actual,
          })),
          recommended_action: architecturalResult.recommended_action,
          corrected_instructions: architecturalResult.corrected_instructions,
          architectural_validation: architecturalResult.validation_summary,
        };
      }
    } catch (archError) {
      console.error(`[space-qa] Architectural QA error: ${archError}`);
      // Continue with standard QA if architectural fails
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // RUN STANDARD QA (format, content, style checks)
  // ═══════════════════════════════════════════════════════════════════════════
  
  // Get appropriate prompt template
  let promptTemplate = QA_PROMPTS[qaType];
  
  // Inject space/camera context
  promptTemplate = promptTemplate
    .replace("{space_name}", spaceContext.space_name)
    .replace("{space_type}", spaceContext.space_type)
    .replaceAll("{camera_kind}", spaceContext.camera_kind || "A")
    .replace("{x_norm}", String(spaceContext.x_norm || 0.5))
    .replace("{y_norm}", String(spaceContext.y_norm || 0.5))
    .replace("{yaw_deg}", String(spaceContext.yaw_deg || 0))
    .replace("{LEARNING_CONTEXT}", learningContext);

  const qaUrl = `${GEMINI_API_BASE}/${QA_MODEL}:generateContent?key=${apiKey}`;
  
  try {
    const response = await fetch(qaUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: promptTemplate },
            { inlineData: { mimeType, data: imageBase64 } },
          ]
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 1000,
        }
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`[space-qa] QA API error: ${error}`);
      return {
        pass: false,
        overall_score: 0,
        issues: [{ type: "api_error", severity: "critical", description: "QA system failed to respond" }],
        recommended_action: "needs_human",
        architectural_validation: architecturalResult?.validation_summary,
      };
    }

    const data = await response.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    
    // Parse JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      
      // Merge issues from both QA passes
      const allIssues = [
        ...(parsed.issues || []),
        ...(architecturalResult?.issues.map(i => ({
          type: i.rule,
          severity: i.severity,
          description: i.description,
          location_hint: i.location_hint,
          expected: i.expected,
          actual: i.actual,
        })) || []),
      ];
      
      // Calculate combined score (weighted average if both exist)
      let combinedScore = parsed.overall_score || 0;
      if (architecturalResult) {
        combinedScore = Math.round((parsed.overall_score * 0.4) + (architecturalResult.overall_score * 0.6));
      }
      
      // Pass only if both checks pass
      const standardPasses = parsed.pass === true && (parsed.overall_score || 0) >= QA_CONFIG.MIN_SCORE_FOR_PASS;
      const architecturalPasses = architecturalResult?.pass !== false;
      const overallPass = standardPasses && architecturalPasses;
      
      return {
        pass: overallPass,
        overall_score: combinedScore,
        issues: allIssues,
        recommended_action: overallPass ? "approve" : (parsed.recommended_action || "retry"),
        corrected_instructions: parsed.corrected_instructions || architecturalResult?.corrected_instructions,
        architectural_validation: architecturalResult?.validation_summary,
      };
    }
  } catch (e) {
    console.error(`[space-qa] QA parse error: ${e}`);
  }

  return {
    pass: false,
    overall_score: 0,
    issues: [{ type: "parse_error", severity: "critical", description: "Failed to parse QA response" }],
    recommended_action: "needs_human",
    architectural_validation: architecturalResult?.validation_summary,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// RETRY WORKFLOW
// ═══════════════════════════════════════════════════════════════════════════

export interface RetryDecision {
  shouldRetry: boolean;
  reason: string;
  promptDelta?: {
    promptAdjustments: string[];
    settingsAdjustments: Record<string, unknown>;
    changes: string[];
  };
}

export function evaluateRetryDecision(
  qaResult: QAResult,
  currentAttempt: number,
  learningContext: ReturnType<typeof fetchLearningContext> extends Promise<infer T> ? T : never
): RetryDecision {
  // Check attempt limit
  if (currentAttempt >= QA_CONFIG.MAX_ATTEMPTS) {
    return {
      shouldRetry: false,
      reason: `Max attempts reached (${currentAttempt}/${QA_CONFIG.MAX_ATTEMPTS}). Manual review required.`,
    };
  }

  // Check for critical severity issues that block auto-retry
  const criticalIssues = qaResult.issues.filter(
    i => QA_CONFIG.BLOCK_AUTO_RETRY_SEVERITIES.includes(i.severity)
  );
  if (criticalIssues.length > 0) {
    return {
      shouldRetry: false,
      reason: `Critical issue found: ${criticalIssues[0].description}. Manual review required.`,
    };
  }

  // Check if manual review is recommended
  if (qaResult.recommended_action === "needs_human") {
    return {
      shouldRetry: false,
      reason: "QA recommends manual review for this output.",
    };
  }

  // Eligible for auto-retry
  const promptDelta = buildAutoFixPromptDelta(qaResult, learningContext, currentAttempt + 1);
  
  return {
    shouldRetry: true,
    reason: `Auto-retry eligible (attempt ${currentAttempt + 1}/${QA_CONFIG.MAX_ATTEMPTS})`,
    promptDelta,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// ATTEMPT PERSISTENCE
// ═══════════════════════════════════════════════════════════════════════════

export interface AttemptRecord {
  pipelineId: string;
  stepNumber: number;
  assetType: "render" | "panorama" | "final360";
  assetId: string;
  attemptIndex: number;
  outputUploadId: string | null;
  qaResult: QAResult;
  promptUsed: string;
  modelUsed: string;
  settingsUsed: Record<string, unknown>;
}

export async function persistAttempt(
  supabase: any,
  attempt: AttemptRecord,
  ownerId: string
) {
  // Store in floorplan_pipeline_step_attempts for unified history
  const { error } = await supabase
    .from("floorplan_pipeline_step_attempts")
    .insert({
      pipeline_id: attempt.pipelineId,
      owner_id: ownerId,
      step_number: attempt.stepNumber,
      attempt_index: attempt.attemptIndex,
      output_upload_id: attempt.outputUploadId,
      qa_status: attempt.qaResult.pass ? "approved" : "rejected",
      qa_reason_short: attempt.qaResult.issues[0]?.description || (attempt.qaResult.pass ? "All checks passed" : "QA failed"),
      qa_reason_full: JSON.stringify(attempt.qaResult),
      qa_result_json: attempt.qaResult,
      prompt_used: attempt.promptUsed.slice(0, 5000), // Truncate for DB
      model_used: attempt.modelUsed,
    });

  if (error) {
    console.error(`[space-qa] Failed to persist attempt: ${error.message}`);
  }
}
