# STEP 4 OPERATIONAL CONTRACT

**Document Type**: Technical Specification
**Date**: 2026-02-10
**Authority**: RETOUR – PIPELINE (UPDATED & LOCKED).txt
**Status**: APPROVED

---

## PURPOSE

**What Step 4 Is**:
Step 4 is **Camera-Aware Space Renders** — a rendering orchestrator that converts the styled 2D floor plan (Step 2 output) into photorealistic eye-level interior renders using user-placed camera markers as the source of truth for camera position and viewing direction.

**Why It Exists**:
- Bridges the gap between 2D architectural plans and 3D navigable space representations
- Grounds image generation in user-controlled camera positions (not automatic template-based generation)
- Produces paired camera views (A and B) from each marker for panoramic assembly
- Maintains architectural accuracy while allowing creative style application

**Core Responsibility**:
Transform styled 2D plan + camera markers → photorealistic interior renders validated against architectural constraints.

---

## INPUTS

### Required Inputs (from previous steps)

1. **Styled 2D Plan** (from Step 2)
   - Path: `pipeline.styled_image_upload_id`
   - Format: 2D floor plan with style applied
   - Constraint: MUST have passed Step 2 internal QA

2. **Space Definitions** (from Step 0.2)
   - Path: `floorplan_pipeline_spaces` table
   - Data: Space ID, name, type, adjacencies, bounds
   - Constraint: Only spaces with `include_in_generation=true` and `is_excluded=false`

3. **Camera Markers** (from Camera Planning UI)
   - Path: `pipeline_camera_markers` table
   - Data: `x_norm`, `y_norm`, `yaw_deg`, `fov_deg`, `room_id`, `label`
   - Constraint: User-placed, bound to specific spaces

4. **Camera Anchors** (from pre-Step 4 anchor creation)
   - Path: Storage buckets + `pipeline_camera_markers.anchor_*_path`
   - Data: 3 visual anchor artifacts per marker:
     - `anchor_base_plan_path` - Clean floor plan with room labels
     - `anchor_single_overlay_path` - Camera overlay with direction arrow
     - `anchor_crop_overlay_path` - Space crop with camera position
   - Constraint: `anchor_status = "ready"` REQUIRED before Step 4 starts

5. **Camera Plan Confirmation** (from Camera Planning workflow)
   - Path: `pipeline.camera_plan_confirmed_at`
   - Constraint: MUST be set (gate enforcement)

### Assumptions Step 4 Is Allowed to Make

- ✓ All camera markers are intentionally placed by users
- ✓ Camera anchors accurately represent marker positions/directions
- ✓ Styled plan geometry is architecturally accurate (validated in Step 2)
- ✓ Space adjacencies are correct (validated in Step 0.2)
- ✓ User understands camera A/B pairing (A first, B opposite)

### Assumptions Step 4 MUST NOT Make

- ✗ Camera positions are optimal or complete coverage
- ✗ Camera intent decisions require separate runtime step (Step 3 logic may be implicit in Step 4)
- ✗ Panoramic stitching will work automatically
- ✗ Cross-image spatial coherence is validated (Step 6 is future)
- ✗ All spaces need renders (user may intentionally exclude spaces)

---

## OUTPUTS

### Primary Outputs

1. **Space Render Records**
   - Table: `floorplan_space_renders`
   - Count: 2 per camera marker (kinds: "A", "B")
   - Data: `output_upload_id`, `camera_marker_id`, `camera_label`, `kind`, `status`
   - Status flow: `pending` → `in_progress` → `qa_approved` → `locked_approved`

2. **Generated Images**
   - Storage: `uploads` table, linked via `output_upload_id`
   - Format: 16:9 aspect ratio (configurable), 2K resolution (configurable: 1K/2K/4K)
   - Type: Photorealistic interior eye-level renders

3. **QA Results** (per render)
   - Table: `floorplan_space_renders` QA fields
   - Data: `qa_score`, `qa_result`, `qa_details`, `qa_approved_at`
   - Validation: Architectural accuracy + room type consistency

### Intermediate Outputs (for downstream steps)

4. **Panorama Prompt Drafts** (optional)
   - Populated after both A+B complete for a space
   - Used by panorama generation (if applicable)
   - Auto-filled with camera metadata

### Terminal States

- `locked_approved = true` → Render is finalized, cannot regenerate
- `status = "failed"` + `attempt_count ≥ 5` → Blocked for human review
- `status = "qa_rejected"` + `severity = "critical"` → Blocked for human review

### Where Responsibility ENDS

- Step 4 does NOT assemble panoramas (Step 8 domain)
- Step 4 does NOT validate cross-image coherence (Step 6 domain, future)
- Step 4 does NOT optimize camera placement (user responsibility)
- Step 4 does NOT guarantee complete spatial coverage (user responsibility)

---

## CAMERA DESCRIPTION RULE

### How Camera Positioning Is Expressed

Step 4 uses **camera markers** (user-placed geometric points) as the source of truth. Step 3 (Camera Intent) is an active decision-only layer that may be implicit in Step 4's implementation.

### Camera Data Structure

```
Camera Marker = {
  x_norm: 0.0-1.0,           // Normalized X position on floor plan
  y_norm: 0.0-1.0,           // Normalized Y position on floor plan
  yaw_deg: 0-360,            // Viewing direction in degrees
  fov_deg: 10-180,           // Field of view (default 80)
  room_id: UUID,             // Space binding
  label: string              // User-assigned identifier
}
```

### Camera Logic is TEXT ONLY in Prompts

When Step 4 builds prompts for image generation, camera positioning is expressed as **natural language descriptions** derived from marker data:

**Example Camera A prompt fragment**:
```
"Camera positioned at (x=45%, y=60%) in Living Room,
facing 90° (East direction), field of view 80°,
eye level 1.5-1.7 meters above floor."
```

**Example Camera B prompt fragment**:
```
"Camera at same position as Camera A,
facing 270° (opposite direction, 180° rotation),
capturing the view behind Camera A's perspective."
```

### Critical Rules

1. Camera intent decisions (Step 3) may be implicit - no separate runtime step required
2. Templates A-H are decision-only vocabulary (not automatic generation executors)
3. Camera descriptions are PROMPT TEXT, not data structures
4. No separate camera intent persistence layer required
5. User-placed markers are the input source of truth

### Translation Process

```
Camera Marker (geometric data)
    ↓
Visual Anchor Artifacts (3 images with overlays)
    ↓
Prompt Text (natural language camera description)
    ↓
Image Generation API (Gemini receives prompt + anchors)
```

### Step 3 Vocabulary MAY Be Used

- Template descriptions (A-H) MAY be referenced as vocabulary in prompts
- Example: "Camera A (standing inside space, facing into space)"
- Step 3 is an active decision-only layer - templates define camera intent conceptually

---

## HARD BOUNDARIES

### What Step 4 MUST NEVER Do

1. **❌ Execute Step 3 Logic**
   - NO automatic camera intent generation
   - NO template-based positioning (A-H templates)
   - NO writes to `camera_intents` table
   - NO camera intent selection workflows

2. **❌ Assume Step 6 Exists**
   - NO cross-image spatial validation
   - NO panoramic coherence checks
   - NO spatial contradiction detection
   - NO dependence on MARBLE engine

3. **❌ Modify Geometry or Architecture**
   - NO changes to walls, openings, room boundaries
   - NO spatial restructuring
   - NO room type reassignment
   - Step 2 geometry is LOCKED

4. **❌ Make Creative Camera Decisions**
   - NO optimization of camera placement
   - NO suggestion of additional cameras
   - NO judgment of coverage completeness
   - User-placed markers are authoritative

5. **❌ Guarantee Panoramic Outputs**
   - NO assumption that A+B will stitch perfectly
   - NO promise of seamless 360° navigation
   - NO automatic viewpoint alignment
   - Panoramic assembly is Step 8 responsibility

6. **❌ Bypass QA Gates**
   - NO skipping architectural validation
   - NO auto-approval of critical failures
   - NO retry beyond MAX_ATTEMPTS (5)
   - Human review REQUIRED for blocked states

7. **❌ Persist After Lock**
   - NO regeneration if `locked_approved = true`
   - NO edits after final approval
   - Terminal state is permanent

### Explicit Anti-Patterns to Avoid

- **Anti-Pattern 1**: "Let's generate camera positions automatically"
  - **Correct**: User places markers, Step 4 executes them

- **Anti-Pattern 2**: "We should validate camera views stitch correctly"
  - **Correct**: Step 4 validates per-image only, Step 6 (future) handles stitching

- **Anti-Pattern 3**: "This space needs more cameras for coverage"
  - **Correct**: Coverage decisions are user responsibility

- **Anti-Pattern 4**: "Let's fix the architecture to match the render"
  - **Correct**: Render must match architecture, not vice versa

- **Anti-Pattern 5**: "Let's retry with a different camera angle"
  - **Correct**: Camera angle is fixed (user-placed marker), retry with corrected prompt only

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

## IMPLEMENTATION FILES

**Primary Edge Function**:
- `supabase/functions/run-space-render/index.ts`

**Related Components**:
- Camera marker management: `src/components/floorplan/CameraMarkerOverlay.tsx`
- Camera planning UI: `src/components/floorplan/CameraPlanning.tsx`
- Visual anchor generation: `supabase/functions/generate-camera-anchors/index.ts`

**Database Tables**:
- `pipeline_camera_markers` - User-placed camera positions
- `floorplan_space_renders` - Generated render records
- `floorplan_pipeline_spaces` - Space definitions from Step 0.2

---

**Status**: APPROVED - Operational contract locked
**Last Updated**: 2026-02-10
