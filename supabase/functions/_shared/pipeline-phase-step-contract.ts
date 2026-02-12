/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PHASE → STEP CONTRACT (AUTHORITATIVE)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * ⚠️  WARNING: DO NOT MODIFY WITHOUT UPDATING ALL LOCATIONS  ⚠️
 * 
 * This mapping MUST be kept in sync across:
 *   1. This file (backend edge functions)
 *   2. Database trigger: enforce_phase_step_consistency (migration SQL)
 *   3. Frontend: src/hooks/useWholeApartmentPipeline.ts (PHASE_STEP_MAP)
 *   4. Frontend: src/lib/pipeline-action-contract.ts (PHASE_ACTION_CONTRACT)
 * 
 * Any change to a phase name or step number MUST be updated in all 4 places.
 * 
 * PHASE → STEP TABLE:
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │   Phase                          │  Step                                │
 * ├─────────────────────────────────────────────────────────────────────────┤
 * │   upload                         │  0                                   │
 * │   space_analysis_pending         │  0                                   │
 * │   space_analysis_running         │  0                                   │
 * │   space_analysis_complete        │  0                                   │
 * │   top_down_3d_pending            │  1                                   │
 * │   top_down_3d_running            │  1                                   │
 * │   top_down_3d_review             │  1                                   │
 * │   style_pending                  │  2                                   │
 * │   style_running                  │  2                                   │
 * │   style_review                   │  2                                   │
 * │   detect_spaces_pending          │  3                                   │
 * │   detecting_spaces               │  3                                   │
 * │   spaces_detected                │  3                                   │
 * │   camera_intent_pending          │  4  (Decision-only, no renders)      │
 * │   camera_intent_confirmed        │  4                                   │
 * │   prompt_templates_pending       │  5  (NEW phase for templates)        │
 * │   prompt_templates_confirmed     │  5                                   │
 * │   outputs_pending                │  6  (Renamed from renders)           │
 * │   renders_in_progress            │  5                                   │
 * │   renders_review                 │  5                                   │
 * │   panoramas_pending              │  6                                   │
 * │   panoramas_in_progress          │  6                                   │
 * │   panoramas_review               │  6                                   │
 * │   merging_pending                │  7                                   │
 * │   merging_in_progress            │  7                                   │
 * │   merging_review                 │  7                                   │
 * │   completed                      │  7                                   │
 * │   failed                         │  0                                   │
 * └─────────────────────────────────────────────────────────────────────────┘
 * ═══════════════════════════════════════════════════════════════════════════
 */

export const PHASE_STEP_CONTRACT: Record<string, number> = {
  // Step 0: Initial / Analysis
  "upload": 0,
  "space_analysis_pending": 0,
  "space_analysis_running": 0,
  "space_analysis_complete": 0,

  // Step 1: Top-Down 3D
  "top_down_3d_pending": 1,
  "top_down_3d_running": 1,
  "top_down_3d_review": 1,

  // Step 2: Style
  "style_pending": 2,
  "style_running": 2,
  "style_review": 2,

  // Step 3: Detect Spaces (Spec 0.2)
  "detect_spaces_pending": 3,
  "detecting_spaces": 3,
  "spaces_detected": 3,

  // Step 4: Camera Intent (Spec 3 - Decision Only)
  "camera_intent_pending": 4,
  "camera_intent_confirmed": 4,

  // Step 5: Prompt Templates (Spec 4)
  "prompt_templates_pending": 5,
  "prompt_templates_confirmed": 5,

  // Step 6: Outputs + QA (Spec 5)
  "outputs_pending": 6,
  "outputs_in_progress": 6,
  "outputs_review": 6,

  // Step 7: Panoramas
  "panoramas_pending": 7,
  "panoramas_in_progress": 7,
  "panoramas_review": 7,

  // Step 8: Merge/Completion
  "merging_pending": 8,
  "merging_in_progress": 8,
  "merging_review": 8,
  "completed": 8,

  // Terminal/Error
  "failed": 0,
};

/**
 * Legal phase transitions for continue-pipeline-step edge function.
 * Maps from a "review" or "confirmed" phase to the next "pending" phase.
 * 
 * ⚠️  WARNING: Update this when adding new phases  ⚠️
 *
 * FLOW ORDER:
 * Step 2 (style_review) → Step 3 (detect_spaces_pending)
 * Step 3 (spaces_detected) → Step 4 (camera_intent_pending)
 * Step 4 (camera_intent_confirmed) → Step 5 (prompt_templates_pending)
 * Step 5 (prompt_templates_confirmed) → Step 6 (outputs_pending)
 */
export const LEGAL_PHASE_TRANSITIONS: Record<string, string> = {
  // Step 0 → Step 1
  "space_analysis_complete": "top_down_3d_pending",
  // Step 1 → Step 2
  "top_down_3d_review": "style_pending",
  // Step 2 → Step 3 (Space Scan)
  "style_review": "detect_spaces_pending",
  // Step 3 → Step 4 (Camera Intent)
  "spaces_detected": "camera_intent_pending",
  // Step 4 → Step 5 (Prompt Templates)
  "camera_intent_confirmed": "prompt_templates_pending",
  // Step 5 → Step 6 (Outputs)
  "prompt_templates_confirmed": "outputs_pending",
  // Step 6 → Step 7 (Panoramas)
  "outputs_review": "panoramas_pending",
  // Step 7 → Step 8 (Final Approval)
  "panoramas_review": "merging_pending",
  "merging_review": "completed",
};

/**
 * Helper to get expected step from phase
 */
export function getStepFromPhase(phase: string): number {
  return PHASE_STEP_CONTRACT[phase] ?? 0;
}

/**
 * Helper to validate if a phase transition is legal
 */
export function isLegalTransition(fromPhase: string, toPhase: string): boolean {
  return LEGAL_PHASE_TRANSITIONS[fromPhase] === toPhase;
}

/**
 * Get the next legal phase from a given phase
 */
export function getNextPhase(currentPhase: string): string | null {
  return LEGAL_PHASE_TRANSITIONS[currentPhase] || null;
}
