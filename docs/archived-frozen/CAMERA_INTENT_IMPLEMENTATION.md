# ⚠️ DEPRECATED - FROZEN IMPLEMENTATION ⚠️

**Status**: DEPRECATED (2026-02-10)
**Reason**: Step 3 (Camera Intent) is architecturally FROZEN per pipeline specification
**Authority**: RETOUR – PIPELINE (UPDATED & LOCKED).txt

## Critical Notice

This document describes an implementation that **VIOLATES the locked architectural contract**. The Camera Intent system was implemented as an active, executing subsystem when it should have remained a **SPECIFICATION-ONLY** layer.

### What Was Wrong

❌ Active execution infrastructure (should be frozen)
❌ Database persistence with active writes (should be specification)
❌ UI workflows for user interaction (should not exist)
❌ Pipeline state transitions (should not execute)
❌ Deterministic generation logic (should not run)

### Why It Was Frozen

**Architectural Decision**: Image generation models do not reliably interpret geometric constraints. Step 3 exists as a **conceptual framework** for future capability when engine-class models exist, but must NOT execute now.

### What Remains

✅ Template definitions (A-H) as conceptual vocabulary
✅ View direction types as semantic framework
✅ Camera positioning vocabulary for prompts
✅ Specification for future activation

### What Was Removed

❌ `camera_intents` table (marked deprecated)
❌ `generate-camera-intents` edge function (deleted)
❌ `CameraIntentSelectionPanel` UI component (deleted)
❌ `useCameraIntents` React hook (deleted)
❌ `camera-intent-generator.ts` logic (deleted)
❌ `camera-intent-types.ts` types (deleted)
❌ Pipeline status values (commented out)

### Replacement Approach

Instead of formal Camera Intent execution:
- **Step 4** (active) generates prompts with natural language camera positioning
- Camera position vocabulary used as TEXT in prompts, not formal intents
- Example: "Camera positioned in kitchen, facing toward living room entrance"

### Document Purpose

This document is preserved for:
1. Historical record of what was implemented
2. Reference for template definitions (A-H remain valid conceptually)
3. Understanding of why the approach was frozen
4. Future reference if/when activation criteria are met

### Activation Criteria (Future)

Step 3 may be reactivated when:
- Image generation models reach "engine-class" (persistent 3D understanding)
- Geometric interpretation becomes reliable
- Explicit architectural review + new contract version
- Deliverable requirements change

**DO NOT IMPLEMENT until activation criteria are met.**

---

# Original Implementation Document (2026-02-10)

Below is the original implementation documentation, preserved for reference:

---

# Camera Intent System - Implementation Summary

## Implementation Date
2026-02-10

## Architectural Contract
Based on `system_planning_document.md.resolved` - Camera Intent Architecture & Capability Slot Specification (v1.0)

## What Was Implemented

This implementation delivers **Step 4: Camera Intent Architecture** - a deterministic intent-definition layer that translates architectural space definitions into concrete camera standing positions and viewing directions.

### Core Components

1. **Database Schema** (`20260210105014_*.sql`)
   - `camera_intents` table with all required fields
   - Custom ENUM types: `view_direction_type`, `camera_template_id`
   - RLS policies for owner-based access
   - Pipeline status extensions for camera intent phases
   - Timestamps: `camera_intent_generated_at`, `camera_intent_confirmed_at`

2. **TypeScript Type System** (`src/lib/camera-intent-types.ts`)
   - Complete type definitions matching database schema
   - Template definitions (A-H) with descriptions and requirements
   - Helper functions for deterministic ID generation
   - Grouping utilities (by space, by template)
   - Type guards and validation functions

3. **Generation Logic** (`supabase/functions/_shared/camera-intent-generator.ts`)
   - Deterministic camera intent generation algorithm
   - Template application logic (A→H in sequence)
   - Adjacency-based filtering
   - Input validation
   - Stable `camera_id` generation

4. **Edge Function** (`supabase/functions/generate-camera-intents/index.ts`)
   - REST endpoint for camera intent generation
   - Fetches spaces and adjacency data
   - Calls generation logic
   - Persists results to database
   - Updates pipeline status

5. **React Hook** (`src/hooks/useCameraIntents.ts`)
   - Query for fetching camera intents
   - Mutations for generation, selection, confirmation
   - Helper functions (select all, deselect all, group by space/template)
   - Computed values (counts, selection state)

6. **UI Component** (`src/components/whole-apartment/CameraIntentSelectionPanel.tsx`)
   - Display all generated intents
   - Group by space or template (tabbed interface)
   - Select/deselect individual intents or groups
   - Confirm selection for image generation
   - Visual badges for template types

7. **Documentation** (`docs/camera-intent-architecture.md`)
   - Developer guide
   - Architecture overview
   - Template descriptions
   - Usage examples
   - Testing guidelines
   - Frozen capability slots explanation

8. **Constants** (`src/lib/constants.ts`)
   - Camera intent status constants
   - Pipeline phase identifiers

## Architectural Guarantees Delivered

✅ **Determinism**: Same inputs → Same outputs (Section 6.5)
✅ **Model-Agnostic**: Independent of image generation model (Section 8.2)
✅ **No Geometric Reasoning**: Abstract spatial relationships only (Section 1.6)
✅ **No Creative Decisions**: Mechanical template application (Section 6.3)
✅ **Stable Identity**: Deterministic `camera_id` generation (Section 5.2)
✅ **Forbidden Fields Enforcement**: No coordinates, vectors, or geometry (Section 5.5)
✅ **Template Isolation**: Templates A-H are immutable (Section 1.3)

## What Was NOT Implemented (By Design)

### Frozen Capability Slots

As specified in the architectural contract, these components are **intentionally not implemented**:

1. **Legacy Step 4 (Geometric Enforcement)** - Section 2
   - Status: ❄️ FROZEN
   - Would provide: 3D geometric validation, collision detection, line-of-sight verification
   - Activation criteria: Model capabilities upgrade, architectural decision, deliverable requirement

2. **Step 6 (Spatial/Panoramic QA)** - Section 3
   - Status: 🔮 RESERVED
   - Would provide: Cross-image coherence, panoramic consistency, spatial contradiction detection
   - Activation criteria: Engine-class vision models, panoramic outputs requirement

**Critical Rule**: Active pipeline code MUST NOT depend on these frozen slots (Section 7.2)

## Data Flow

```
User initiates generation
        ↓
fetch spaces (include_in_generation=true, is_excluded=false)
        ↓
fetch adjacency relationships
        ↓
validate inputs
        ↓
generate camera intents (deterministic)
        ↓
delete existing intents for pipeline
        ↓
insert new intents (all selected by default)
        ↓
update pipeline status → step4_camera_intent_generated
        ↓
User reviews and selects intents
        ↓
User confirms selection
        ↓
update pipeline status → step4_camera_intent_confirmed
        ↓
Proceed to image generation
```

## Template Application Rules

For each space (in deterministic ID order):

1. **Template A** - Always applicable (1 intent)
2. **Templates B, C, D** - One per adjacency (N intents per N adjacencies)
3. **Templates E, F, G, H** - Always applicable (4 intents)

If a space has 3 adjacencies:
- 1 (A) + 3×3 (B,C,D) + 4 (E,F,G,H) = **14 camera intents**

## Testing Requirements

### Determinism Test
```typescript
const result1 = generateCameraIntents(spaces, adjacencies);
const result2 = generateCameraIntents(spaces, adjacencies);
expect(result1).toEqual(result2); // Must be identical
```

### Template Application Test
- Verify Templates B, C, D skip when no adjacencies
- Verify Templates A, E, F, G, H always generate
- Verify one intent per adjacency for B, C, D

### Adjacency Filtering Test
- Verify invalid space references are skipped
- Verify bidirectional adjacencies handled correctly

### Stable ID Test
```typescript
const id1 = generateCameraId(space_id, template, target);
const id2 = generateCameraId(space_id, template, target);
expect(id1).toBe(id2); // Must be identical
```

## Database Migration

### To Apply

```bash
# In Supabase Dashboard SQL Editor or via CLI
-- Migration will create:
-- 1. ENUMs: view_direction_type, camera_template_id
-- 2. Table: camera_intents
-- 3. Indexes for performance
-- 4. RLS policies
-- 5. Updated pipeline status constraints
```

### Rollback Considerations

If rollback is needed:
1. Drop `camera_intents` table
2. Drop ENUM types
3. Revert pipeline status constraint
4. Remove timestamp columns from `floorplan_pipelines`

## Integration Points

### With Existing System

1. **Space Detection (Step 3)** → Camera Intent (Step 4)
   - Requires: Spaces with `include_in_generation=true`
   - Requires: Adjacency relationships populated

2. **Camera Intent (Step 4)** → Image Generation (Step 5)
   - Provides: Selected camera intents
   - Each selected intent = one image generation job

3. **Pipeline Router**
   - Add handling for `step4_camera_intent_*` statuses
   - Route to CameraIntentSelectionPanel when appropriate

### API Endpoints

New edge function:
- `POST /functions/v1/generate-camera-intents`
- Body: `{ pipeline_id: string }`
- Auth: Required (RLS enforced)

## Performance Considerations

### Query Optimization

Indexes created for:
- `pipeline_id` lookups (most common)
- `standing_space_id` for space-based queries
- `template_id` for template-based queries
- `is_selected` for filtering selected intents
- `generation_order` for deterministic ordering

### Batch Operations

- Generation: Single transaction deletes + inserts all intents
- Selection: Bulk update mutation supports multiple intents

## Known Limitations

1. **No Geometric Validation** (by design)
   - Camera intents may specify infeasible positions
   - Image generation models interpret as best they can

2. **No Cross-Intent Awareness** (by design)
   - Each intent is independent
   - No sequencing or relationship metadata

3. **No Spatial QA** (by design)
   - No validation of spatial coherence
   - No panoramic stitching checks

These limitations are **architectural decisions**, not implementation gaps.

## Future Enhancements (Conditionally)

### If Legacy Step 4 Activates

Would add:
- 3D geometric model input
- Camera position validation
- Collision detection
- Line-of-sight verification

### If Step 6 Activates

Would add:
- Cross-image consistency checking
- Panoramic stitching validation
- Spatial contradiction detection

**Activation Process**:
1. Model capabilities reach threshold
2. Architectural review and approval
3. New contract version published
4. Implementation as separate pipeline stage

## Maintenance Notes

### When Adding New Templates

1. Update `camera_template_id` ENUM in database
2. Add template definition to `camera-intent-generator.ts`
3. Update `camera-intent-types.ts` TypeScript types
4. Add template to documentation
5. Update UI badge colors

### When Modifying Adjacency Logic

1. Ensure determinism is preserved
2. Update input validation
3. Update tests
4. Document behavior changes

### When Debugging Generation Issues

Check:
1. Space data: `include_in_generation=true`, `is_excluded=false`
2. Adjacency data: Valid space IDs, no orphaned references
3. Determinism: Run generation twice, compare outputs
4. Template applicability: Verify adjacency requirements met

## Compliance Checklist

✅ Implements Section 1: Camera Intent (Final Definition)
✅ Implements Section 5: Output Contract (MANDATORY)
✅ Implements Section 6: Spatial Binding Decision Rules (MANDATORY)
✅ Respects Section 7: Capability Slot Isolation Rules (CRITICAL)
✅ Delivers Section 8: Final Guarantees (REQUIRED)

## Files Created/Modified

### Created
- `supabase/migrations/20260210105014_*.sql`
- `supabase/functions/generate-camera-intents/index.ts`
- `supabase/functions/_shared/camera-intent-generator.ts`
- `src/lib/camera-intent-types.ts`
- `src/hooks/useCameraIntents.ts`
- `src/components/whole-apartment/CameraIntentSelectionPanel.tsx`
- `docs/camera-intent-architecture.md`
- `docs/CAMERA_INTENT_IMPLEMENTATION.md` (this file)

### Modified
- `src/lib/constants.ts` (added camera intent status constants)

## Verification Steps

1. **Database**
   ```sql
   -- Verify table exists
   SELECT * FROM camera_intents LIMIT 1;

   -- Verify ENUMs
   SELECT enum_range(NULL::camera_template_id);
   SELECT enum_range(NULL::view_direction_type);
   ```

2. **Edge Function**
   ```bash
   # Test locally
   supabase functions serve generate-camera-intents

   # Deploy
   supabase functions deploy generate-camera-intents
   ```

3. **Frontend**
   ```typescript
   import { useCameraIntents } from '@/hooks/useCameraIntents';
   // Test in component
   ```

## Conclusion

This implementation delivers a **complete, deterministic, and architecturally compliant** Camera Intent system that serves as a stable foundation for image generation while preserving forward compatibility with future geometric and spatial validation capabilities.

All architectural guarantees have been met, and the system is ready for integration into the RE:TOUR pipeline.

---

**Implementation Status**: ✅ COMPLETE (then DEPRECATED)
**Contract Compliance**: ❌ VIOLATED (execution not allowed)
**Ready for Production**: ❌ NO (frozen by architectural contract)

**Implemented By**: Claude Code (Assistant)
**Deprecated By**: Claude Code (Assistant) - 2026-02-10
**Reason**: Synchronization with RETOUR – PIPELINE (UPDATED & LOCKED).txt
