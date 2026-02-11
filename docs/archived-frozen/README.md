# Archived & Frozen Camera Intent Documentation

**Date Archived**: 2026-02-10
**Reason**: Step 3 (Camera Intent) is architecturally FROZEN per pipeline specification
**Authority**: RETOUR – PIPELINE (UPDATED & LOCKED).txt

## Purpose of This Folder

This folder contains documentation for the **Camera Intent system** that was implemented on 2026-02-10 but should not have been executed according to the locked architectural contract.

## What Is Frozen

Step 3 (Camera Intent) exists as a **SPECIFICATION-ONLY** layer in the RE:TOUR pipeline. It was incorrectly implemented as an active, executing subsystem, violating the architectural contract.

### Why It Was Frozen

**Core Problem**: Image generation models do not reliably interpret geometric constraints. Previous attempts to enforce camera positioning through formal systems failed because models lack persistent 3D understanding.

**Strategic Decision**: Work WITH model capabilities, not against them. Use camera positioning vocabulary in natural language prompts (Step 4), not formal Camera Intent execution.

## Contents of This Folder

### 1. `CAMERA_INTENT_IMPLEMENTATION.md`
Complete implementation summary including:
- Database schema (`camera_intents` table, ENUMs)
- Edge function (`generate-camera-intents`)
- React hook (`useCameraIntents`)
- UI component (`CameraIntentSelectionPanel`)
- Type definitions (`camera-intent-types.ts`)
- Generation logic (`camera-intent-generator.ts`)

**Status**: All implementation files have been REMOVED or DEPRECATED.

### 2. `camera-intent-architecture.md`
Architecture and developer guide including:
- Template definitions (A-H)
- View direction types
- Deterministic generation algorithm
- Pipeline integration points
- Testing requirements

**Status**: Architecture remains valid as CONCEPTUAL FRAMEWORK but must not execute.

## What Remains Valid

Even though Step 3 is frozen, the following concepts remain useful:

✅ **Template Definitions (A-H)** - Can be referenced as camera positioning vocabulary
✅ **View Direction Types** - Semantic framework for describing views
✅ **Camera Positioning Concepts** - Used as TEXT in prompts, not structured data

## What Was Removed

The following components were removed from the active codebase on 2026-02-10:

### Files Deleted
- `src/components/whole-apartment/CameraIntentSelectionPanel.tsx`
- `src/hooks/useCameraIntents.ts`
- `src/lib/camera-intent-types.ts`
- `supabase/functions/generate-camera-intents/` (entire directory)
- `supabase/functions/_shared/camera-intent-generator.ts`

### Database Changes
- `camera_intents` table marked as DEPRECATED
- Added deprecation comments to table and ENUMs
- Added `deprecated_at` and `deprecation_reason` columns

### Code Changes
- `src/lib/constants.ts` - `CAMERA_INTENT_STATUS` constants commented out

### Documentation Moved
- Original docs moved from `docs/` to `docs/archived-frozen/`
- Deprecation notices prepended to all documents

## Replacement Approach

Instead of formal Camera Intent execution, Step 4 now:
- Generates prompts with natural language camera descriptions
- Uses camera vocabulary as TEXT in prompts
- Example: "Camera positioned in kitchen at eye level, facing toward living room entrance"

## Future Activation Criteria

Step 3 may be reactivated when:
1. Image generation models reach "engine-class" (persistent 3D understanding)
2. Geometric interpretation becomes reliable
3. Explicit architectural review + new contract version
4. Deliverable requirements change to need formal camera intents

**DO NOT IMPLEMENT until all activation criteria are met.**

## Related Systems

### Active Camera Systems (Keep)
These are SEPARATE from frozen Step 3 and should be KEPT:

- **`pipeline_camera_markers`** - User-placed camera markers on floor plans
- **`pipeline_camera_scans`** - AI-powered validation and label detection
- **`pipeline_camera_scan_items`** - Per-marker scan results and crops
- **`run-camera-scan`** - Edge function for camera scanning
- **`confirm-camera-plan`** - User confirmation workflow
- **`create-camera-anchor`** - Camera anchor generation

These represent **user annotation tools**, not automatic template-based intent generation.

### Frozen Systems (Do Not Use)
- **`camera_intents` table** - Deprecated, do not write to
- **Camera Intent generation** - Do not create new generation logic
- **Camera Intent UI** - Do not create user interfaces for Step 3
- **step4_camera_intent_*** status values - Do not use in pipeline

## Questions?

If you have questions about:
- **Why Step 3 is frozen**: Read RETOUR – PIPELINE (UPDATED & LOCKED).txt
- **Template definitions**: See `camera-intent-architecture.md` (conceptual reference)
- **Implementation history**: See `CAMERA_INTENT_IMPLEMENTATION.md`
- **Active camera systems**: Check database schema for `pipeline_camera_markers`

## Migration Timeline

| Date | Action | Status |
|------|--------|--------|
| 2026-02-10 (morning) | Camera Intent system implemented | ✅ Complete |
| 2026-02-10 (afternoon) | Violation identified via pipeline sync | ⚠️ Found |
| 2026-02-10 (afternoon) | Camera Intent infrastructure removed | ✅ Complete |
| 2026-02-10 (afternoon) | Documentation archived with deprecation notices | ✅ Complete |
| 2026-02-10 (afternoon) | Database deprecation migration created | ✅ Complete |

---

**Status**: FROZEN (2026-02-10)
**Do Not Reactivate Without**: Architectural review + activation criteria met
**See**: RETOUR – PIPELINE (UPDATED & LOCKED).txt for authoritative specification
