# ⚠️ DEPRECATED - FROZEN SPECIFICATION ⚠️

**Status**: DEPRECATED (2026-02-10)
**Reason**: Step 3 (Camera Intent) is architecturally FROZEN per pipeline specification
**Authority**: RETOUR – PIPELINE (UPDATED & LOCKED).txt

## Critical Notice

This document describes an architecture that was **implemented but should not have been**. Step 3 (Camera Intent) exists as a **SPECIFICATION-ONLY** layer and must not execute in the active pipeline.

### Architectural Violation

The implementation described below violated the locked architectural contract by:
- Creating active execution infrastructure (should remain conceptual)
- Implementing database persistence with active writes (should be specification)
- Building UI workflows for user interaction (should not exist)
- Adding pipeline state transitions (should not execute)

### Why Step 3 Is Frozen

**Core Problem**: Image generation models do not reliably interpret geometric constraints. Attempts to enforce camera positioning through formal systems fail because models lack persistent 3D understanding.

**Strategic Decision**: Stop attempting geometric enforcement. Instead, use camera positioning **vocabulary** in natural language prompts (Step 4), not formal Camera Intent execution.

### What Remains Valid

✅ **Template definitions (A-H)** - Remain valid as conceptual vocabulary
✅ **View direction types** - Remain valid as semantic framework
✅ **Camera positioning concepts** - Used as TEXT in prompts, not formal intents

### Replacement Approach

**Instead of formal Camera Intent execution:**
- Step 4 (active) generates prompts with natural language camera descriptions
- Example: "Camera positioned in kitchen at eye level, facing toward living room entrance"
- Camera vocabulary used as prompt text, not structured data

### Future Activation Criteria

Step 3 may be reactivated when:
- Image generation models reach "engine-class" (persistent 3D understanding)
- Geometric interpretation becomes reliable
- Explicit architectural review + new contract version
- Deliverable requirements change to need formal camera intents

**DO NOT IMPLEMENT until activation criteria are met.**

### Document Purpose

This document is preserved for:
1. Reference for template definitions (A-H remain conceptually valid)
2. Understanding of camera positioning vocabulary
3. Historical record of architectural approach
4. Future reference if activation criteria are met

---

# Original Architecture Document (2026-02-10)

Below is the original architecture documentation, preserved for reference:

---

# Camera Intent Architecture (Step 4)

## Overview

The Camera Intent system is a deterministic layer that translates architectural space definitions into concrete camera standing positions and viewing directions for image generation.

This document provides a developer-friendly guide to the Camera Intent Architecture as specified in `system_planning_document.md.resolved`.

## Key Concepts

### What is a Camera Intent?

A **Camera Intent** is a declarative specification of:
- Where a camera is standing (which space)
- What direction the camera is facing
- What the camera should capture

**Critical Rule**: One Camera Intent = One image generation operation.

### Determinism Guarantee

The Camera Intent generation process is **completely deterministic**:
- Same space definitions → Same camera intents
- Same adjacency relationships → Same output
- No randomness, no AI interpretation, no creative decisions

This means you can predict exactly what camera intents will be generated before running the process.

## Architecture Components

### 1. Database Schema

**Table**: `camera_intents`

Key fields:
- `camera_id` - Deterministic identifier (format: `{space_id}::{template}::{target_space_id?}`)
- `standing_space_id` - Where the camera is positioned
- `template_id` - Which template was used (A-H)
- `view_direction_type` - Semantic direction type
- `target_space_id` - Adjacent space (for templates B, C, D)
- `intent_description` - Natural language description
- `generation_order` - Deterministic ordering
- `is_selected` - User selection flag

### 2. Camera Position Templates (A–H)

Eight immutable templates define different camera perspectives:

| Template | Description | Requires Adjacent Space? |
|----------|-------------|--------------------------|
| **A** | Standing inside space, facing into space | No |
| **B** | Standing inside space, facing toward connection | Yes |
| **C** | At threshold, facing back into space | Yes |
| **D** | At threshold, facing into adjacent space | Yes |
| **E** | Capturing corner/junction | No |
| **F** | Facing feature wall/element | No |
| **G** | Angled view capturing context | No |
| **H** | Elevated/architectural vantage point | No |

### 3. Processing Flow

```
Space Definitions + Adjacencies
          ↓
  Template Application (A→H)
          ↓
   Camera Intent Records
          ↓
  User Selection
          ↓
   Image Generation
```

## Implementation Guide

### Generating Camera Intents

**Edge Function**: `generate-camera-intents`

```typescript
// Call from frontend
const { data } = await supabase.functions.invoke("generate-camera-intents", {
  body: { pipeline_id: "..." }
});

// Returns
{
  success: true,
  camera_intents: [...],
  total_count: 15,
  skipped_spaces: [],
  generation_metadata: {
    deterministic: true,
    template_counts: { A: 3, B: 4, C: 4, D: 4, E: 0, F: 0, G: 0, H: 0 },
    timestamp: "..."
  }
}
```

### Using the React Hook

```typescript
import { useCameraIntents } from "@/hooks/useCameraIntents";

function MyCameraComponent() {
  const {
    cameraIntents,
    totalIntents,
    selectedCount,
    intentsBySpace,
    generateIntents,
    updateSelection,
    confirmSelection,
    isGenerating
  } = useCameraIntents(pipelineId);

  // Generate intents
  await generateIntents(pipelineId);

  // Toggle selection
  await updateSelection(intentId, true);

  // Confirm and proceed
  await confirmSelection(pipelineId);
}
```

### Using the UI Component

```typescript
import { CameraIntentSelectionPanel } from "@/components/whole-apartment/CameraIntentSelectionPanel";

<CameraIntentSelectionPanel
  pipelineId={pipelineId}
  onConfirm={() => {
    // User confirmed their selection
    // Proceed to image generation
  }}
/>
```

## Architectural Constraints

### What Camera Intent DOES

✅ Define spatial relationships (standing position + view direction)
✅ Apply templates mechanically based on adjacency data
✅ Generate deterministic, reproducible outputs
✅ Provide human-readable descriptions

### What Camera Intent DOES NOT DO

❌ Calculate geometric positions or coordinates
❌ Validate spatial feasibility
❌ Make creative decisions about "better" views
❌ Interact with image generation models
❌ Enforce panoramic consistency
❌ Perform any spatial validation

These forbidden behaviors are reserved for **frozen capability slots**:
- **Legacy Step 4** (Geometric Enforcement) - Currently inactive
- **Step 6** (Spatial/Panoramic QA) - Reserved for future

## Data Flow

### Input Requirements

Camera Intent generation requires:

1. **Space Definitions** (from `floorplan_pipeline_spaces`)
   - Space ID, name, type
   - Filtered to: `include_in_generation = true` AND `is_excluded = false`

2. **Adjacency Relationships**
   - From space `adjacencies` field
   - Format: `{ from_space_id, to_space_id, connection_type? }`

### Template Application Logic

For each space, in ID order:
1. Apply Template A (always applicable)
2. Apply Templates B, C, D (once per adjacency, if adjacencies exist)
3. Apply Templates E, F, G, H (always applicable)

Intents are generated in this deterministic order.

### Output Structure

```typescript
interface CameraIntent {
  id: string;                      // UUID
  camera_id: string;               // Deterministic: "space_id::template::target?"
  pipeline_id: string;
  owner_id: string;
  standing_space_id: string;
  standing_space_name: string;
  template_id: "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H";
  template_description: string;
  view_direction_type: ViewDirectionType;
  target_space_id: string | null;  // Required for B, C, D
  target_space_name: string | null;
  intent_description: string;
  generation_order: number;        // Deterministic ordering
  is_selected: boolean;
  created_at: string;
  updated_at: string;
}
```

## Pipeline Integration

### Status Flow

```
step3_running (Camera Planning)
      ↓
step4_camera_intent_pending
      ↓
[User triggers generation]
      ↓
step4_camera_intent_generated
      ↓
[User selects intents]
      ↓
step4_camera_intent_confirmed
      ↓
step4_pending (Image Generation)
```

### Pipeline Timestamps

- `camera_intent_generated_at` - When intents were generated
- `camera_intent_confirmed_at` - When user confirmed selection

## Testing Determinism

To verify deterministic behavior:

```typescript
// Test: Same inputs → Same outputs
const result1 = await generateCameraIntents(spaces, adjacencies);
const result2 = await generateCameraIntents(spaces, adjacencies);

// These should be identical
expect(result1.camera_intents).toEqual(result2.camera_intents);
```

## Common Scenarios

### Scenario 1: Isolated Room (No Adjacencies)

A room with no connections will generate intents for:
- Template A (into space)
- Templates E, F, G, H (corner, feature, angled, elevated)

Templates B, C, D are skipped (require adjacencies).

### Scenario 2: Hallway with 3 Doors

A hallway connected to 3 rooms will generate:
- 1 × Template A (into hallway)
- 3 × Template B (facing each door)
- 3 × Template C (at each threshold, facing back)
- 3 × Template D (at each threshold, facing into adjacent room)
- 1 × Template E, F, G, H (corner, feature, angled, elevated)

Total: **15 camera intents** from one space!

### Scenario 3: User Selection

After generation:
1. All intents start with `is_selected = true`
2. User can deselect intents they don't want
3. User confirms selection
4. Only selected intents proceed to image generation

## Frozen Capability Slots

### Legacy Step 4 (Geometric Enforcement)

**Status**: ❄️ FROZEN - Not currently active

**Would provide**:
- 3D geometric validation
- Camera position collision detection
- Line-of-sight verification

**Activation criteria**:
- Image models support geometric input
- 3D representation becomes available
- Geometric validation becomes beneficial

### Step 6 (Spatial/Panoramic QA)

**Status**: 🔮 RESERVED - Future capability

**Would provide**:
- Cross-image spatial coherence validation
- Panoramic consistency checking
- Architectural feature tracking

**Activation criteria**:
- Models maintain cross-image spatial memory
- Panoramic outputs become deliverables
- Engine-class vision models available

**Important**: Active pipeline code MUST NOT depend on these frozen slots.

## Developer Checklist

When working with Camera Intents:

- [ ] Understand determinism guarantee
- [ ] Know the 8 templates (A-H) and their requirements
- [ ] Respect forbidden fields (no coordinates, no geometry)
- [ ] Use stable `camera_id` format
- [ ] Maintain generation order
- [ ] Don't skip templates based on creative judgment
- [ ] Don't add cross-intent references
- [ ] Don't assume frozen slots are active

## File Locations

| Component | Path |
|-----------|------|
| **Database Migration** | `supabase/migrations/20260210105014_*.sql` |
| **TypeScript Types** | `src/lib/camera-intent-types.ts` |
| **Generator Logic** | `supabase/functions/_shared/camera-intent-generator.ts` |
| **Edge Function** | `supabase/functions/generate-camera-intents/index.ts` |
| **React Hook** | `src/hooks/useCameraIntents.ts` |
| **UI Component** | `src/components/whole-apartment/CameraIntentSelectionPanel.tsx` |
| **Constants** | `src/lib/constants.ts` |

## Further Reading

- `system_planning_document.md.resolved` - Full architectural specification
- Section 1: Step 4 definition
- Section 5: Output contract
- Section 6: Spatial binding rules
- Section 7: Capability slot isolation
- Section 8: Architectural guarantees

## Support

For questions or issues:
- Review the architectural contract first
- Check frozen capability slots aren't being activated
- Verify determinism with test cases
- Confirm adjacency data is valid

---

**Document Version**: 1.0 (then DEPRECATED)
**Last Updated**: 2026-02-10 (deprecated same day)
**Architectural Contract**: RETOUR – PIPELINE (UPDATED & LOCKED).txt
**Status**: FROZEN - Do not use this architecture in active pipeline
