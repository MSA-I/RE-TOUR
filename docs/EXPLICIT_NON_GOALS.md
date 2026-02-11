# EXPLICIT NON-GOALS

**Document Type**: Boundary Definition
**Date**: 2026-02-10
**Authority**: RETOUR – PIPELINE (UPDATED & LOCKED).txt
**Status**: APPROVED

---

## OVERVIEW

This document defines what the RE:TOUR pipeline **intentionally does NOT solve**. These are conscious architectural decisions based on current technology capabilities and architectural boundaries.

**Purpose**: Prevent scope creep and clarify system boundaries.

---

## ❌ CAMERA OPTIMIZATION

### What we DON'T do

- Automatically suggest optimal camera positions
- Evaluate coverage completeness
- Recommend additional cameras for better views
- Optimize camera angles for "best" viewpoints

### Why

- User-placed markers are authoritative
- System does not judge "better" camera placement
- Coverage decisions are user responsibility
- Step 3 (Camera Intent) is decision-only layer (may be implicit in Step 4)

### What we DO instead

- Execute user-placed camera markers exactly as specified
- Trust user judgment for camera positioning
- Provide camera placement UI tools
- Let users control all camera decisions

---

## ❌ MULTI-VIEW COVERAGE ANALYSIS

### What we DON'T do

- Analyze whether all spaces have cameras
- Check if panoramic coverage is complete
- Validate viewpoint overlap for stitching
- Suggest missing camera positions

### Why

- System executes user-placed markers as-is
- No automatic coverage optimization
- User controls which spaces get renders
- No assumption of complete 360° coverage

### What we DO instead

- Allow users to place cameras in any spaces they choose
- Support partial coverage (not all spaces need cameras)
- Let users decide coverage priorities
- Provide tools for manual camera planning

---

## ❌ PANORAMA GENERATION & ASSEMBLY

### What we DON'T do

- Generate panoramas within the pipeline
- Assume panoramas will be created
- Guarantee seamless panoramic stitching
- Validate cross-image spatial coherence
- Detect geometric contradictions between views
- Ensure perfect viewpoint alignment

### Why

- Current pipeline delivers individual renders (Step 5 outputs)
- Step 8 (Panorama Polish) is EXTERNAL post-processing only
- Step 8 runs ONLY if panorama received from external source
- Step 8 does NOT generate panoramas
- Panorama existence is NOT assumed or required
- Mandatory Happy Path ends at Step 5 → Step 10 (no panoramas)

### What we DO instead

- Deliver high-quality individual renders (Camera A and B)
- Validate each render independently (Step 5 QA)
- Provide approved renders as final deliverables
- Support external panorama assembly if needed
- Leave panoramic stitching to external tools or future pipeline versions

---

## ❌ SPATIAL REASONING

### What we DON'T do

- Validate 3D geometric consistency
- Check line-of-sight correctness
- Detect spatial impossibilities (camera inside wall)
- Verify volumetric coherence

### Why

- Image generation models lack persistent 3D understanding
- No 3D model exists in pipeline (Step 7 is TBD)
- Geometric reasoning requires engine-class models
- Current validation is 2D plan comparison only

### What we DO instead

- Validate renders against 2D floor plan geometry
- Check architectural accuracy per-image
- Compare openings and walls to floor plan
- Trust user-placed camera markers as geometrically valid

---

## ❌ GEOMETRIC ENFORCEMENT

### What we DON'T do

- Force camera positions to avoid collisions
- Validate camera ray-casting against 3D model
- Check physical plausibility of camera placement
- Enforce geometric constraints programmatically

### Why

- Models do not reliably interpret geometric constraints
- Attempts to enforce geometry (arrows, depth maps) have failed
- Step 3 is decision-only (defines intent, not geometric validation)
- Natural language prompts work better than formal constraints

### What we DO instead

- Use natural language camera descriptions in prompts
- Provide visual anchor artifacts (floor plan overlays)
- Trust image generation models to interpret text descriptions
- Let users validate geometric correctness visually

---

## ❌ AUTOMATIC CAMERA INTENT GENERATION

### What we DON'T do

- Generate camera positions via templates (A-H)
- Automatically bind templates to spaces
- Create combinatorial camera intents per space
- Persist formal camera intents in database

### Why

- Step 3 (Camera Intent) is decision-only layer (may be implicit)
- Templates A-H define intent vocabulary, not automatic executors
- User-placed markers are the input source of truth
- No separate runtime step required for camera intent decisions

### What we DO instead

- Let users manually place camera markers
- Provide camera planning UI with floor plan overlay
- Generate visual anchor artifacts from user markers
- Use template vocabulary as text in prompts (not execution)

---

## ❌ CROSS-IMAGE SPATIAL VALIDATION

### What we DON'T do

- Validate consistency between different renders of same space
- Check architectural contradictions across images
- Ensure furniture placement matches between views
- Verify spatial coherence in multi-view sets

### Why

- Step 6 (MARBLE) is future/reserved
- Current QA is per-image only
- No cross-image validation infrastructure
- Spatial coherence requires engine-class models

### What we DO instead

- Validate each render independently (Step 5 QA)
- Check architectural accuracy against floor plan per-image
- Trust that consistent prompts produce consistent results
- Defer cross-image validation to future (Step 6)

---

## ❌ PANORAMIC ASSEMBLY WITHIN PIPELINE

### What we DON'T do

- Generate panoramas within the pipeline
- Promise seamless 360° panorama output
- Guarantee stitching success
- Ensure viewpoint alignment between A/B cameras
- Validate navigability of final panorama
- Assume panoramas will be created

### Why

- Current pipeline delivers QA-approved renders (Step 5 → Step 10)
- NO panorama generation within pipeline
- Step 8 (Panorama Polish) is EXTERNAL post-processing only
- Step 8 runs ONLY if panorama received from external source
- No formal panoramic engine (Step 6 is future)
- Panorama existence is NOT a pipeline requirement

### What we DO instead

- Deliver individual Camera A and B renders
- Ensure each render is independently high-quality
- Provide Camera A as input to Camera B generation (view consistency)
- Leave panoramic assembly to external tools
- Support external panorama polish (Step 8) if panoramas are received

---

## ❌ 3D MODEL INTERMEDIATE

### What we DON'T do

- Generate 3D mesh from floor plan
- Reconstruct volumetric space
- Provide 3D model as deliverable
- Use 3D model for validation

### Why

- Step 7 technology is TBD (not locked)
- 3D model may not be needed (Option B: direct panoramas)
- Current pipeline is 2D plan → 2D renders → panoramas
- No architectural requirement for 3D intermediate

### What we DO instead

- Work directly from 2D floor plan
- Generate eye-level renders from 2D plan context
- Use visual anchor artifacts (2D overlays) for camera positioning
- Defer 3D model decision to future Step 7 implementation

---

## WHY THESE ARE NON-GOALS

### Core Philosophy

**Work WITH current model capabilities, not against them.**

### Principles

1. **User Control > Automation**
   - Users place cameras, system executes them
   - No automatic optimization or suggestions
   - User judges coverage and quality

2. **Per-Image Validation > Cross-Image Reasoning**
   - Validate individual renders thoroughly
   - Defer cross-image validation to future (Step 6)
   - Avoid spatial reasoning models cannot support

3. **Natural Language > Formal Constraints**
   - Prompts with text descriptions work better
   - Formal geometric constraints fail
   - Camera positioning as vocabulary, not execution

4. **Best-Effort Polish > Guaranteed Panoramas**
   - Basic seam cleanup is achievable (external only)
   - Perfect panoramic stitching is future capability
   - User acceptance is final quality gate

5. **Focus on Achievable > Aspirational**
   - Deliver high-quality individual renders NOW
   - Defer panoramic/spatial features to future
   - Build stable foundation for future capabilities

---

## TECHNOLOGY MATURITY REALITY

| Capability | Current Models | Engine-Class Models (Future) |
|------------|----------------|------------------------------|
| Per-image generation | ✅ Reliable | ✅ Excellent |
| Natural language prompts | ✅ Works well | ✅ Works excellently |
| Camera positioning via text | ✅ Acceptable | ✅ Reliable |
| Geometric constraint enforcement | ❌ Fails | ✅ Achievable |
| Cross-image coherence | ❌ Not available | ✅ Achievable |
| Spatial reasoning | ❌ Unreliable | ✅ Reliable |
| 3D geometric validation | ❌ Not possible | ✅ Possible |
| Panoramic stitching guarantee | ❌ Best-effort | ✅ Reliable |

**Conclusion**: Build for today's capabilities, reserve slots for tomorrow's.

---

## WHAT WE DO INSTEAD

### Current Strengths

1. **High-Quality Individual Renders**
   - Photorealistic interior views
   - Architecturally accurate (validated against floor plan)
   - Style-consistent with reference images
   - Camera-direction accurate

2. **User-Controlled Camera Planning**
   - Interactive marker placement UI
   - Visual anchor generation
   - Clear camera direction indication
   - Space-bound camera markers

3. **Robust Per-Image QA**
   - Architectural accuracy validation
   - Room type consistency checks
   - Camera direction fidelity
   - Retry with learning (max 5 attempts)
   - Human escalation for critical failures

4. **Reliable Execution Path**
   - Steps 0 → 1 → 2 → 4 → 5 → 10
   - No branching or optional steps
   - Clear QA gates
   - Predictable outcomes

5. **Clear Architectural Boundaries**
   - Step 3 may be implicit (decision-only layer)
   - Steps 6, 7, 8, 9 NOT in mandatory path
   - No scope creep
   - Focus on achievable deliverables
   - Clear boundaries

### Future Capabilities (Reserved but NOT Implemented)

- **Step 6 (MARBLE)**: Cross-image spatial validation, panoramic coherence
- **Step 7**: 3D model intermediate (technology TBD)
- **Step 8**: Panorama generation and polish (external post-processing)
- **Step 9**: Final panorama QA (external validation)

---

## ANTI-PATTERNS TO AVOID

### ❌ Anti-Pattern 1: "Let's generate camera positions automatically"
**Correct**: User places markers, Step 4 executes them

### ❌ Anti-Pattern 2: "We should validate camera views stitch correctly"
**Correct**: Step 4 validates per-image only, Step 6 (future) handles stitching

### ❌ Anti-Pattern 3: "This space needs more cameras for coverage"
**Correct**: Coverage decisions are user responsibility

### ❌ Anti-Pattern 4: "Let's fix the architecture to match the render"
**Correct**: Render must match architecture, not vice versa

### ❌ Anti-Pattern 5: "Let's retry with a different camera angle"
**Correct**: Camera angle is fixed (user-placed marker), retry with corrected prompt only

### ❌ Anti-Pattern 6: "Let's guarantee seamless panoramas"
**Correct**: Current pipeline delivers approved individual renders; panoramas are external

### ❌ Anti-Pattern 7: "Let's validate spatial consistency across views"
**Correct**: Per-image validation only; cross-image validation is Step 6 (future)

### ❌ Anti-Pattern 8: "Let's optimize camera placement for better views"
**Correct**: User controls all camera decisions; system executes as-is

---

## SCOPE BOUNDARY ENFORCEMENT

### How to Prevent Scope Creep

1. **Read This Document First**
   - Before proposing new features
   - Before expanding system responsibilities
   - Before adding validation logic

2. **Check Against Non-Goals**
   - Does this fall into a non-goal category?
   - Is this trying to solve something we intentionally don't?
   - Does this require separate runtime infrastructure we've decided against?

3. **Ask These Questions**
   - Is this user responsibility or system responsibility?
   - Is this achievable with current models or requires future tech?
   - Is this per-image or cross-image validation?
   - Is this mandatory path or external post-processing?

4. **Default to NO**
   - If uncertain, do NOT add feature
   - Prefer user control over automation
   - Prefer simple over complex
   - Prefer explicit over implicit

---

## IMPLEMENTATION VERIFICATION

### How to verify non-goals are NOT being violated

1. **Code Review Checklist**
   - [ ] No automatic camera position generation
   - [ ] No cross-image spatial validation
   - [ ] No panorama generation within pipeline
   - [ ] No 3D geometric reasoning
   - [ ] No Step 3/6/7 execution in mandatory path
   - [ ] No coverage optimization suggestions
   - [ ] No geometric constraint enforcement

2. **Database Schema Check**
   - [ ] No `camera_intents` table writes
   - [ ] No cross-image coherence tracking
   - [ ] No 3D model storage
   - [ ] Step 3/6/7 not referenced in pipeline status

3. **Edge Function Audit**
   - [ ] `run-space-render` does NOT execute camera intent logic
   - [ ] `run-qa-check` validates per-image ONLY
   - [ ] No MARBLE engine calls
   - [ ] No panorama assembly functions in mandatory path

4. **UI Component Review**
   - [ ] Camera markers are user-placed only
   - [ ] No automatic camera suggestion UI
   - [ ] No coverage analysis displays
   - [ ] No optimal placement recommendations

---

**Status**: APPROVED - Non-goals locked
**Last Updated**: 2026-02-10
