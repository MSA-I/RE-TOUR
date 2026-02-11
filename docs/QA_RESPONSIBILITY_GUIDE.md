# QA RESPONSIBILITY GUIDE

**Document Type**: QA Boundary Definition
**Date**: 2026-02-10
**Authority**: RETOUR – PIPELINE (UPDATED & LOCKED).txt
**Status**: APPROVED

---

## OVERVIEW

**CRITICAL NOTE**: The mandatory Happy Path includes ONLY Step 5 QA.
Step 9 QA is an EXTERNAL post-processing stage that executes ONLY if panoramas are received from external sources.
The current E2E pipeline does NOT depend on Step 9 existing.

---

## STEP 5 QA (PER-IMAGE VALIDATION) — MANDATORY

### Scope
Individual render validation ONLY

### What Step 5 QA Validates

1. **Architectural Accuracy** (within single image)
   - Walls, openings, room boundaries match Step 2 plan
   - No hallucinated doors, windows, or structural elements
   - Room dimensions proportionally correct

2. **Room Type Consistency**
   - Bedroom MUST have bed, MUST NOT have toilet
   - Kitchen MUST have counter, MUST NOT have bed
   - Bathroom MUST have toilet/shower, etc.

3. **Camera Direction Fidelity**
   - Render matches camera yaw/position from marker
   - No "better angle" substitutions
   - Accuracy > aesthetics

4. **Style Consistency** (within single image)
   - Materials, colors match Step 2 styled plan
   - Lighting style consistent with reference
   - No style hallucinations

5. **Adjacent Space Correctness** (visibility check)
   - Openings lead to declared adjacent spaces only
   - No invented connections
   - Wall vs opening consistency with floor plan

### What Step 5 QA DOES NOT Validate

- ❌ Cross-image consistency (different renders of same space)
- ❌ Panoramic stitching quality (seams between A/B views)
- ❌ 360° navigability
- ❌ Spatial contradictions across multiple images
- ❌ Camera coverage completeness

### Validation Process

```
1. Load render + styled plan + floor plan + camera marker data
2. Run dual-model QA (Primary: Gemini 3 Pro Image, Fallback: Gemini 2.5 Pro)
3. Execute checks:
   - Adjacent space correctness
   - Wall vs opening consistency
   - Camera direction fidelity
   - NO camera intent override
   - Room type consistency
4. Calculate score (standard 40% + architectural 60%)
5. Decision:
   - score ≥ 80 AND no critical issues → APPROVE
   - score < 80 OR major issues AND attempt < 5 → RETRY
   - critical issues OR attempt ≥ 5 → BLOCK FOR HUMAN
```

### Output

- `qa_score`: 0-100
- `qa_result`: JSON with checks performed, issues found, approval reasons
- `qa_approved_at`: timestamp if approved
- `status`: `qa_approved` or `qa_rejected`

### Implementation

**Edge Function**: `supabase/functions/run-qa-check/index.ts`

**Key Features**:
- Dual-model validation (Gemini 3 Pro Image primary, Gemini 2.5 Pro fallback)
- Architectural validation against floor plan geometry
- Room type consistency checks
- Camera direction fidelity validation
- Retry with learning (max 5 attempts)
- Critical failure blocking with human escalation

---

## STEP 9 QA (FINAL PANORAMA VALIDATION) — EXTERNAL ONLY

### Scope
Merged panorama validation (if panoramas received from external source)

**CRITICAL**: Step 9 is NOT part of the mandatory Happy Path.
It executes ONLY if a panorama is received from an external source.
The current pipeline does NOT generate panoramas and does NOT assume they exist.

### What Step 9 QA Validates

1. **Seam Artifacts**
   - No visible seams where panoramas merge
   - Smooth transitions between source images

2. **Duplicate Elements**
   - No duplicated furniture/features from overlapping regions
   - No ghosting or double-vision effects

3. **Geometry Continuity**
   - Walls, floor patterns aligned across seams
   - Architectural elements continuous

4. **Lighting Consistency**
   - Uniform lighting throughout 360° view
   - No abrupt lighting changes at seams

5. **Style Consistency** (across merged regions)
   - Materials and colors match throughout
   - No style discontinuities

6. **Completeness**
   - Full 360° coverage achieved
   - No missing regions or gaps

### What Step 9 QA DOES NOT Validate

- ❌ Per-image architectural accuracy (Step 5 responsibility)
- ❌ Room type correctness (Step 5 responsibility)
- ❌ Camera direction accuracy (Step 5 responsibility)
- ❌ Individual render quality (Step 5 responsibility)

### Validation Process

```
1. Load merged panorama
2. Run QA model with merge-specific checks
3. Identify issues by type:
   - seam | duplicate | geometry | lighting | style | completeness
4. Classify severity: critical | major | minor
5. Decision:
   - score ≥ 80 AND no critical → APPROVE → Lock
   - score < 80 OR issues found → Generate inpaint instructions → Apply fixes → Re-validate
```

### Output

- `qa_score`: 0-100
- `qa_issues`: Array of `{type, severity, description, location}`
- `inpaint_instructions`: Correction directives if needed
- Final state: `locked_approved = true` (terminal)

### Implementation

**Status**: External post-processing only - NOT implemented in current pipeline

**Note**: Step 9 QA would be invoked only if panoramas are received from external sources. The mandatory Happy Path does not include this step.

---

## REGENERATION VS FIX DECISION MATRIX

| Scenario | Step | Action | Reasoning |
|----------|------|--------|-----------|
| AI-QA rejects before approval | 5 | **REGENERATE** with improved prompt | Full generation needed to fix architectural/room type issues |
| User rejects after AI approval | 5 or 9 | **INPAINT** with edit instructions | Minor refinements on validated base |
| Critical severity failure | 5 | **BLOCK** for human review | System cannot auto-correct critical issues |
| Max attempts exhausted (≥5) | 5 | **BLOCK** for human review | Learning loop failed, human judgment needed |
| Panorama seam artifact | 9 | **INPAINT** with seam correction | Fix-only, no regeneration |
| Locked approval set | Any | **NO ACTION** (terminal state) | Locked outputs are immutable |

### Key Principle

- **Regenerate** = Full new generation with corrected prompt (for QA failures)
- **Inpaint** = Minimal-change edit on existing approved output (for refinements)
- **Block** = Escalate to human review (for critical failures or exhausted retries)

---

## WHAT MUST BE REJECTED VS FIXED

### MUST Reject and Retry (regenerate path)

1. Room type violation (bedroom has toilet, kitchen has bed)
2. Hallucinated openings (door/window not in floor plan)
3. Structural changes (wall moved, room resized)
4. Camera direction override (wrong viewing angle)
5. Missing major furniture (bedroom without bed)
6. Wrong adjacent space (opening leads to undeclared room)

### CAN Fix via Inpaint (correction path)

1. Minor furniture adjustments (chair position, lamp style)
2. Color/material refinements (wall color adjustment)
3. Lighting adjustments (brightness, shadow correction)
4. Seam artifacts (panorama merge issues)
5. Style consistency refinements (post-approval user requests)

### MUST Block for Human (escalation path)

1. Critical severity issues (Step 5 cannot auto-correct)
2. Attempt count ≥ 5 (learning loop failed)
3. Confidence score < 0.3 (QA model uncertain)
4. Parse errors or API failures (technical issues)
5. Manual review explicitly recommended by QA

---

## QA SCORING SYSTEM

### Step 5 QA Scoring (Per-Image)

**Total Score**: 0-100

**Weighting**:
- Standard checks (style, lighting, composition): 40%
- Architectural checks (geometry, room type, camera direction): 60%

**Pass Threshold**: ≥ 80 points

**Approval Logic**:
```
if (score >= 80 && no critical issues) {
  status = "qa_approved"
  proceed to Step 10
} else if (attempt < 5) {
  status = "qa_rejected"
  retry with improved prompt
} else {
  status = "blocked"
  require human review
}
```

### Step 9 QA Scoring (Panorama - External Only)

**Total Score**: 0-100

**Weighting**:
- Seam quality: 30%
- Geometric continuity: 25%
- Lighting consistency: 20%
- Style consistency: 15%
- Completeness: 10%

**Pass Threshold**: ≥ 80 points

**Approval Logic**:
```
if (score >= 80 && no critical issues) {
  locked_approved = true
  finalize and archive
} else {
  generate inpaint instructions
  apply fixes
  re-validate
}
```

---

## RETRY WITH LEARNING

### How Learning Works

When Step 5 QA rejects a render, the system:

1. **Analyzes Failure**
   - Extracts specific issues from QA result
   - Identifies root causes (prompt, model, constraints)
   - Categorizes by type (architectural, room type, style, camera)

2. **Generates Prompt Delta**
   - Creates correction instructions based on failures
   - Adds constraints to prevent repeat issues
   - Emphasizes critical validation points

3. **Merges with Original Prompt**
   - Preserves original creative intent
   - Adds learned corrections
   - Increases constraint specificity

4. **Regenerates with Improved Prompt**
   - Submits to image generation API
   - Tracks attempt count
   - Re-validates with Step 5 QA

5. **Blocks After Max Attempts**
   - If attempt ≥ 5, escalate to human review
   - System has exhausted learning capacity
   - Human judgment required

### Example Learning Loop

**Attempt 1 Failure**:
- Issue: "Bedroom has toilet instead of bed"
- Prompt Delta: "CRITICAL: This is a bedroom. MUST include bed as primary furniture. MUST NOT include toilet, shower, or bathroom fixtures."

**Attempt 2 Failure**:
- Issue: "Door position doesn't match floor plan"
- Prompt Delta: "Door MUST be positioned at [coordinates] as shown in floor plan. Do NOT add or move doors."

**Attempt 3 Success**:
- Score: 85
- Approved, proceed to Step 10

---

## VALIDATION ARTIFACTS

### Step 5 QA Artifacts

Stored in `floorplan_space_renders` table:

- `qa_score`: Numeric score 0-100
- `qa_result`: JSON with detailed validation results
- `qa_details`: Human-readable summary
- `qa_approved_at`: Approval timestamp
- `attempt_count`: Number of regeneration attempts
- `status`: Current state (qa_approved, qa_rejected, blocked)

### Step 9 QA Artifacts (External Only)

Would be stored in panorama records if implemented:

- `qa_score`: Numeric score 0-100
- `qa_issues`: Array of identified issues
- `inpaint_instructions`: Correction directives
- `locked_approved`: Terminal approval flag
- `final_qa_result`: Complete validation summary

---

## IMPLEMENTATION STATUS

### Step 5 QA: ✅ FULLY IMPLEMENTED

**File**: `supabase/functions/run-qa-check/index.ts`

**Features**:
- Dual-model validation
- Architectural accuracy checks
- Room type consistency
- Camera direction fidelity
- Retry with learning
- Human escalation for critical failures

**Status**: Production-ready, mandatory in Happy Path

### Step 9 QA: ⚠️ EXTERNAL POST-PROCESSING ONLY

**Status**: NOT implemented in current pipeline

**Reason**: Current pipeline delivers individual approved renders (Step 5 → Step 10). Panorama generation and validation are external post-processing stages that run ONLY if panoramas are received from external sources.

**Future**: If panorama generation is added, Step 9 QA would validate merged panoramas before final lock.

---

**Status**: APPROVED - QA boundaries locked
**Last Updated**: 2026-02-10
