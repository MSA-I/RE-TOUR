# RE:TOUR PIPELINE HAPPY PATH

**Document Type**: Execution Flow Definition
**Date**: 2026-02-10
**Authority**: RETOUR – PIPELINE (UPDATED & LOCKED).txt
**Status**: APPROVED

---

## SINGLE VALID EXECUTION PATH

**ONE PATH ONLY** (no branches except retry loops):

```
┌─────────────────────────────────────────────┐
│ USER UPLOADS FLOOR PLAN                     │
└─────────────────┬───────────────────────────┘
                  ↓
┌─────────────────────────────────────────────┐
│ STEP 0.1: Design Reference Scan (OPTIONAL)  │
│ - Analyze style from reference images       │
│ - Extract materials, colors, mood           │
│ - NO application, analysis only             │
└─────────────────┬───────────────────────────┘
                  ↓
┌─────────────────────────────────────────────┐
│ STEP 0.2: Space Scan (REQUIRED)             │
│ - Detect spaces from floor plan             │
│ - Identify adjacency relationships          │
│ - Output: Spatial source of truth           │
└─────────────────┬───────────────────────────┘
                  ↓
┌─────────────────────────────────────────────┐
│ STEP 1: Generate Realistic 2D Plan          │
│ - Convert to architecturally accurate 2D    │
│ - Internal QA: geometry, scale, readability │
│ ├─ PASS → Continue                          │
│ └─ FAIL → Retry with corrections            │
└─────────────────┬───────────────────────────┘
                  ↓ (MUST pass QA)
┌─────────────────────────────────────────────┐
│ STEP 2: Apply Style from Reference          │
│ - Apply style to realistic plan             │
│ - Internal QA: style match, no geometry break│
│ ├─ PASS → Continue                          │
│ └─ FAIL → Retry with corrections            │
└─────────────────┬───────────────────────────┘
                  ↓ (MUST pass QA)
┌─────────────────────────────────────────────┐
│ [STEP 3: ACTIVE DECISION-ONLY LAYER]        │
│ Camera Intent logic may be implicit in      │
│ Step 4. No separate runtime step required.  │
└─────────────────┬───────────────────────────┘
                  ↓
┌─────────────────────────────────────────────┐
│ USER: Camera Planning Workflow              │
│ - Place camera markers on floor plan        │
│ - Bind markers to spaces                    │
│ - Generate visual anchor artifacts          │
│ - Confirm camera plan                       │
└─────────────────┬───────────────────────────┘
                  ↓ (camera_plan_confirmed_at set)
┌─────────────────────────────────────────────┐
│ STEP 4: Camera-Aware Space Renders          │
│ - Create render records (2 per marker: A, B)│
│ - Generate Camera A (uses visual anchors)   │
│ - Generate Camera B (uses Camera A output)  │
│ - Submit each to image generation API       │
└─────────────────┬───────────────────────────┘
                  ↓ (per render)
┌─────────────────────────────────────────────┐
│ STEP 5: QA Validation (PER-IMAGE)           │
│ - Architectural accuracy check              │
│ - Room type consistency validation          │
│ - Camera direction fidelity check           │
│ - Style consistency validation              │
│ ├─ PASS (score ≥ 80, no critical) → Approve│
│ ├─ FAIL (minor/major) → Retry with prompt  │
│ │   correction (max 5 attempts)             │
│ └─ FAIL (critical) → Block for human review│
└─────────────────┬───────────────────────────┘
                  ↓ (all renders approved)
┌─────────────────────────────────────────────┐
│ [STEP 6: SKIPPED - FUTURE]                  │
│ MARBLE spatial/panoramic engine reserved    │
│ but NOT implemented. Pipeline continues.    │
└─────────────────┬───────────────────────────┘
                  ↓
┌─────────────────────────────────────────────┐
│ [STEP 7: SKIPPED - TBD]                     │
│ Intermediate product technology not locked. │
│ Pipeline proceeds without this step.        │
└─────────────────┬───────────────────────────┘
                  ↓
┌─────────────────────────────────────────────┐
│ [STEP 8: EXTERNAL POST-PROCESSING ONLY]     │
│ NOT PART OF MANDATORY HAPPY PATH            │
│ - Runs ONLY if panorama received externally │
│ - Does NOT generate panoramas               │
│ - Does NOT assume panorama existence        │
│ - External post-processing stage            │
└─────────────────────────────────────────────┘
                  ↓ (Happy Path continues WITHOUT Step 8)
┌─────────────────────────────────────────────┐
│ STEP 10: Final Approval & Lock              │
│ - Lock all approved renders from Step 5     │
│ - Archive to permanent storage              │
│ - Mark pipeline as completed                │
│ - Ready for delivery                        │
└─────────────────────────────────────────────┘

NOTE: Steps 8-9 are EXTERNAL to the mandatory Happy Path.
They execute ONLY if panoramas are received from external sources.
The current E2E Happy Path ends at Step 5 → Step 10.
```

---

## MANDATORY EXECUTION FLOW

**Core Path**: Steps 0 → 1 → 2 → 4 → 5 → 10

**Critical Clarification**:
- Steps 3, 6, 7, 8, 9 are NOT part of the mandatory Happy Path
- Step 8 (Panorama Polish) is EXTERNAL post-processing only
- Step 8 runs ONLY if panorama received from external source
- Pipeline completes WITHOUT requiring panoramas

---

## STEP CONTRIBUTIONS

| Step | What It Contributes | Output Type | Next Step Dependency |
|------|---------------------|-------------|---------------------|
| **0.1** | Style guidelines (materials, colors, mood) | Analysis JSON | Step 2 (style application) |
| **0.2** | Space definitions + adjacencies | Space records | Steps 1, 2, 4 |
| **1** | Realistic 2D plan (geometry corrected) | 2D image | Step 2 (style input) |
| **2** | Styled 2D plan (style applied to geometry) | 2D image | Step 4 (render input) |
| **3** | [DECISION-ONLY] Camera intent (may be implicit) | Intent definitions | Step 4 (render execution) |
| **4** | Photorealistic interior renders (A, B per marker) | Images | Step 5 (QA validation) |
| **5** | QA-approved renders | Validated images | Step 10 (lock and archive) |
| **6** | [FUTURE] Cross-image validation | None | None (skipped) |
| **7** | [TBD] Intermediate product | None | None (skipped) |
| **8** | [EXTERNAL] Panorama polish (if received) | Polished panoramas | Step 9 (if applicable) |
| **9** | [EXTERNAL] Final panorama corrections (if applicable) | Fixed panoramas | Step 10 (if applicable) |
| **10** | Locked, archived deliverables | Delivery package | End |

---

## QA GATES

### Internal QA Gates (auto-retry, no user approval)

1. **Step 1 Internal QA**
   - Check: Geometry accuracy, scale, readability
   - Action: Auto-retry with corrections if fails
   - Blocker: None (always retries until pass)

2. **Step 2 Internal QA**
   - Check: Style match, no geometry breakage
   - Action: Auto-retry with corrections if fails
   - Blocker: None (always retries until pass)

### External QA Gates (may require human review)

3. **Step 5 Per-Image QA** (MANDATORY)
   - Check: Architectural accuracy, room type, camera direction, style
   - Action:
     - PASS (score ≥ 80, no critical) → Approve → Proceed to Step 10
     - FAIL (minor/major, attempt < 5) → Auto-retry with improved prompt
     - FAIL (critical OR attempt ≥ 5) → Block for human review
   - Blocker: Critical severity, max attempts exhausted

4. **Step 9 Final QA** (EXTERNAL ONLY - NOT MANDATORY)
   - Scope: ONLY if panoramas received from external source
   - Check: Panorama seams, completeness, consistency
   - Action:
     - PASS → Lock and approve
     - FAIL → Apply inpaint corrections, re-validate
   - Blocker: None (inpainting is fix-only, always succeeds or requires human)
   - **NOT part of mandatory Happy Path**

---

## DECISION POINTS

### Allowed Decisions (system can make automatically)

1. **Retry vs Block** (Step 5 QA)
   - Decision: Based on severity + attempt count
   - Logic: `if (severity == "critical" OR attempt >= 5) block else retry`

2. **Regenerate vs Inpaint** (Step 5 rejection)
   - Decision: Based on approval state
   - Logic: `if (was_ai_approved) inpaint else regenerate`

3. **Prompt Correction Strategy** (retry path)
   - Decision: Based on rejection analysis
   - Logic: Analyze failure → generate prompt delta → merge with original

4. **Camera A vs B Execution Order** (Step 4)
   - Decision: Fixed (A always first, B waits for A output)
   - Logic: B is blocked until A has `output_upload_id`

5. **Space Render Parallelization** (Step 4)
   - Decision: All spaces can render in parallel (within each space: A then B)
   - Logic: No inter-space dependencies

### Forbidden Decisions (system MUST NOT make)

1. ❌ **Camera Placement Optimization**
   - User places markers, system executes as-is

2. ❌ **Coverage Completeness Judgment**
   - User decides how many cameras/spaces, system does not suggest

3. ❌ **Geometric Architecture Changes**
   - Step 2 geometry is locked, renders must match

4. ❌ **Skip QA for Speed**
   - All QA gates are mandatory

5. ❌ **Regenerate After Lock**
   - `locked_approved = true` is terminal state

---

## PATH CHARACTERISTICS

### This path MUST

- ✓ Allow Step 3 (Camera Intent) to be implicit in implementation
- ✓ Work without Step 6 (MARBLE) executing
- ✓ Work without Step 7 (Intermediate Product)
- ✓ Work without Step 8 (Panorama Polish) - external only
- ✓ Work without Step 9 (Final Panorama QA) - external only
- ✓ Function with user-placed camera markers only
- ✓ Validate per-image, not cross-image
- ✓ Support retry loops with learning
- ✓ Block for human review when appropriate
- ✓ Deliver approved renders as final output (Step 5 → Step 10)

### This path AVOIDS

- ✗ Branching execution (optional steps create complexity)
- ✗ Speculative features (no "nice to have" logic)
- ✗ Optimization attempts (no "better camera placement")
- ✗ Geometric reasoning (no 3D validation)
- ✗ Cross-image validation (no panoramic coherence checks)

---

## EXECUTION VERIFICATION

### How to verify the Happy Path is executing correctly

1. **Trace the flow through logs**
   - Each step should log entry/exit
   - Step 3 may be implicit (no separate execution required)
   - Verify Step 8-9 only run if panoramas received

2. **Check database state**
   - Pipeline status should progress: `step_0_complete` → `step_1_complete` → `step_2_complete` → `step_4_complete` → `step_5_complete` → `completed`
   - Step 3 may not have separate status marker (implicit in Step 4)

3. **Validate outputs**
   - Step 1: `realistic_image_upload_id` populated
   - Step 2: `styled_image_upload_id` populated
   - Step 4: `floorplan_space_renders` records created
   - Step 5: QA validation completed
   - Step 10: `locked_approved = true` set

4. **Confirm gates enforced**
   - Step 2 cannot start without Step 1 QA pass
   - Step 4 cannot start without `camera_plan_confirmed_at`
   - Step 5 QA cannot be bypassed
   - Step 10 cannot proceed without Step 5 approval

---

**Status**: APPROVED - Happy Path locked
**Last Updated**: 2026-02-10
