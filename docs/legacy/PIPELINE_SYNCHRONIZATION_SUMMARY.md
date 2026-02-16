# RE:TOUR Pipeline Synchronization Summary

**Date**: 2026-02-10
**Action**: Synchronize codebase with authoritative pipeline specification
**Authority**: RETOUR – PIPELINE (UPDATED & LOCKED).txt
**Status**: COMPLETE

---

## Executive Summary

The RE:TOUR codebase has been synchronized with the locked pipeline specification. A critical violation was identified and corrected: **Step 3 (Camera Intent) was implemented as an active, executing subsystem when it should remain FROZEN (specification-only)**.

All Camera Intent execution infrastructure has been removed or deprecated. The pipeline now correctly implements the locked architectural contract.

---

## Violation Identified

### What Was Wrong

**Step 3 (Camera Intent)** was specified as:
> "Step 3 — Camera Intent ❄️ FROZEN
> └─ Use Camera Position Templates A–H
> └─ Bind each template to a specific space
> └─ Define human eye-level position and view direction
> └─ NO RENDERING, NO DESIGN, NO QA, NO EXECUTION"

**But the codebase contained**:
- ✗ Active database table (`camera_intents`) with writes
- ✗ Edge function (`generate-camera-intents`) executing Step 3 logic
- ✗ UI component (`CameraIntentSelectionPanel`) for user workflows
- ✗ React hook (`useCameraIntents`) with mutations
- ✗ Type definitions (`camera-intent-types.ts`) for active system
- ✗ Generation logic (`camera-intent-generator.ts`) with deterministic algorithm
- ✗ Pipeline status values (`step4_camera_intent_*`) in constants
- ✗ Complete end-to-end execution flow

**Severity**: CRITICAL - Violated frozen constraint and architectural contract.

---

## Corrections Made

### 1. Removed UI Components
- ✅ Deleted `src/components/whole-apartment/CameraIntentSelectionPanel.tsx`
- ✅ Removed user-facing camera intent selection interface

### 2. Removed React Hook
- ✅ Deleted `src/hooks/useCameraIntents.ts`
- ✅ Removed React Query integration for camera intents

### 3. Removed Type Definitions
- ✅ Deleted `src/lib/camera-intent-types.ts`
- ✅ Removed TypeScript types for active Camera Intent system

### 4. Removed Edge Function
- ✅ Deleted `supabase/functions/generate-camera-intents/` directory
- ✅ Removed REST endpoint for camera intent generation

### 5. Removed Generation Logic
- ✅ Deleted `supabase/functions/_shared/camera-intent-generator.ts`
- ✅ Removed deterministic generation algorithm

### 6. Deprecated Database Infrastructure
- ✅ Created migration `20260210114213_deprecate_camera_intents.sql`
- ✅ Added deprecation comments to `camera_intents` table
- ✅ Added deprecation comments to ENUMs (`camera_template_id`, `view_direction_type`)
- ✅ Added `deprecated_at` and `deprecation_reason` columns
- ✅ Marked table as frozen/inactive

### 7. Updated Constants
- ✅ Commented out `CAMERA_INTENT_STATUS` constants in `src/lib/constants.ts`
- ✅ Added deprecation notice explaining frozen status

### 8. Archived Documentation
- ✅ Moved `docs/CAMERA_INTENT_IMPLEMENTATION.md` to `docs/archived-frozen/`
- ✅ Moved `docs/camera-intent-architecture.md` to `docs/archived-frozen/`
- ✅ Prepended deprecation notices to all archived documents
- ✅ Created `docs/archived-frozen/README.md` explaining frozen status

### 9. Verified No Remaining References
- ✅ Searched codebase for camera intent imports/usages
- ✅ Confirmed only documentation and migration files reference deprecated infrastructure
- ✅ Verified QA validators use "camera intent" as validation concept (correct - Step 5 validation)

### 10. Evaluated Related Systems
- ✅ Confirmed `pipeline_camera_markers` is SEPARATE user annotation tool (KEEP)
- ✅ Confirmed `pipeline_camera_scans` is SEPARATE validation utility (KEEP)
- ✅ Confirmed `run-camera-scan` is SEPARATE from Step 3 (KEEP)
- ✅ Confirmed active camera systems are user-driven, not automatic template-based

---

## What Remains

### Conceptual Frameworks (Valid)
These concepts remain valid for reference but must not execute:
- ✅ Template definitions (A-H) as camera positioning vocabulary
- ✅ View direction types as semantic framework
- ✅ Camera positioning concepts for natural language prompts

### Active Camera Systems (Keep)
These are SEPARATE from frozen Step 3 and should remain active:
- ✅ `pipeline_camera_markers` - User-placed camera markers
- ✅ `pipeline_camera_scans` - AI-powered validation and label detection
- ✅ `pipeline_camera_scan_items` - Per-marker scan results
- ✅ `run-camera-scan` edge function
- ✅ `confirm-camera-plan` edge function
- ✅ `create-camera-anchor` edge function

### Deprecated Infrastructure (Frozen)
These exist in database but should not be used:
- ⚠️ `camera_intents` table (marked deprecated, do not write)
- ⚠️ `camera_template_id` ENUM (marked deprecated)
- ⚠️ `view_direction_type` ENUM (marked deprecated)
- ⚠️ Camera intent status values (commented out)

---

## Architectural Alignment

### Pipeline Steps (Corrected)

| Step | Name | Status | Execution |
|------|------|--------|-----------|
| **0.1** | Design Reference Scan | ✅ Active | Analysis only |
| **0.2** | Space Scan | ✅ Active | Detection only |
| **1** | Generate Realistic 2D Plan | ✅ Active | With internal QA |
| **2** | Apply Style from Reference | ✅ Active | With internal QA |
| **3** | Camera Intent | ❄️ FROZEN | Specification only, NO EXECUTION |
| **4** | Prompt Templates + NanoBanana | ⚠️ Needs realignment | Should be prompt generation, not camera planning |
| **5** | Receive Outputs + QA | ✅ Active | Validation only |
| **6** | MARBLE | 🔮 FUTURE | No implementation authorized |
| **7** | Receive Intermediate Product | 🔮 TBD | Technology not locked |
| **8** | Panorama Polish | ⚠️ Partial | Needs clarification |
| **9** | Final QA + Fixes | ⚠️ Partial | Needs fix-only boundary |
| **10** | Final Approval | ✅ Active | Locking + archival |

### Critical Path (Active Steps Only)

```
User uploads floor plan
    ↓
Step 0.1: Design Reference Scan (analysis)
Step 0.2: Space Scan (detection)
    ↓
Step 1: Generate Realistic 2D Plan
    └─ Internal QA gate
    ↓
Step 2: Apply Style
    └─ Internal QA gate
    ↓
[Step 3: SKIPPED - frozen]
    ↓
Step 4: Generate prompts (with camera positioning as TEXT)
    └─ Submit to NanoBanana
    ↓
Step 5: Receive images + QA validation
    └─ Validate architectural accuracy
    └─ Validate style consistency
    └─ Validate camera positioning (as QA check)
    ↓
[Steps 6-7: SKIPPED - future/TBD]
    ↓
Step 8: (If applicable) Polish panoramas
    ↓
Step 9: Final QA + fixes only
    ↓
Step 10: Lock & archive
```

---

## Why Step 3 Is Frozen

### Architectural Rationale

**Problem**: Image generation models do not reliably interpret geometric constraints. Previous attempts (arrows, depth maps, geometric bridges, 3D intermediates) failed due to fundamental model limitations.

**Decision**: Stop attempting geometric enforcement. Instead:
- Define camera positioning vocabulary (Templates A-H remain valid conceptually)
- Use vocabulary in natural language prompts (Step 4)
- Validate camera positioning in QA (Step 5)
- NO formal Camera Intent execution

### Activation Criteria (Future)

Step 3 may be reactivated when:
1. ✗ Image generation models reach "engine-class" (persistent 3D understanding)
2. ✗ Geometric interpretation becomes reliable
3. ✗ Explicit architectural review + new contract version
4. ✗ Deliverable requirements change

**Current Status**: NONE of the activation criteria are met. Step 3 remains FROZEN.

---

## Replacement Approach

### How Camera Positioning Works NOW

**Instead of formal Camera Intent execution**:
- Step 4 (active) generates prompts with natural language camera descriptions
- Camera positioning vocabulary used as TEXT in prompts, not structured data
- Example: "Camera positioned in kitchen at eye level, facing toward living room entrance"

**Result**: Same semantic meaning, different representation. No dependency on frozen Step 3.

### Why This Works

- Models understand natural language descriptions better than formal constraints
- Prompts can include camera vocabulary without executing Step 3
- QA (Step 5) validates that generated images match requested camera angles
- System remains stable without frozen infrastructure

---

## Files Changed

### Deleted Files
```
src/components/whole-apartment/CameraIntentSelectionPanel.tsx
src/hooks/useCameraIntents.ts
src/lib/camera-intent-types.ts
supabase/functions/generate-camera-intents/index.ts
supabase/functions/_shared/camera-intent-generator.ts
docs/CAMERA_INTENT_IMPLEMENTATION.md (moved to archived-frozen/)
docs/camera-intent-architecture.md (moved to archived-frozen/)
```

### Created Files
```
supabase/migrations/20260210114213_deprecate_camera_intents.sql
docs/archived-frozen/CAMERA_INTENT_IMPLEMENTATION.md (with deprecation notice)
docs/archived-frozen/camera-intent-architecture.md (with deprecation notice)
docs/archived-frozen/README.md
docs/PIPELINE_SYNCHRONIZATION_SUMMARY.md (this file)
```

### Modified Files
```
src/lib/constants.ts (commented out CAMERA_INTENT_STATUS)
```

---

## Verification Checklist

- [x] All Camera Intent execution files removed
- [x] Database infrastructure marked as deprecated
- [x] Constants commented out with deprecation notices
- [x] Documentation archived with clear warnings
- [x] No remaining active references to camera intent execution
- [x] Active camera systems (markers/scans) identified as separate and kept
- [x] Pipeline orchestration does not depend on Step 3
- [x] QA validators correctly use camera positioning as validation concept (Step 5)
- [x] Replacement approach documented (natural language prompts in Step 4)

---

## Next Steps

### Immediate (Complete)
- ✅ Remove Camera Intent execution infrastructure
- ✅ Deprecate database tables
- ✅ Archive documentation
- ✅ Update constants

### Short-Term (Recommended)
- ⚠️ Realign Step 4 implementation as prompt generation + NanoBanana submission
- ⚠️ Clarify Step 8 (panorama polish) boundaries
- ⚠️ Clarify Step 9 (final QA) as fix-only, no regeneration
- ⚠️ Update API documentation to remove camera intent references
- ⚠️ Update user guides to remove camera intent workflows

### Long-Term (Future)
- 🔮 Monitor image model capabilities for "engine-class" emergence
- 🔮 Re-evaluate Step 3 activation criteria when models improve
- 🔮 Plan MARBLE (Step 6) integration when panoramic engine available
- 🔮 Define Step 7 technology when requirements clarified

---

## Lessons Learned

### What Went Wrong
1. Implementation proceeded before checking frozen constraint in pipeline spec
2. "Step 4" naming in planning doc was misinterpreted as current Step 4
3. Deterministic generation seemed like a "safe" implementation
4. Lack of clear "FROZEN - DO NOT IMPLEMENT" markers in planning docs

### What Went Right
1. Violation identified before production deployment
2. Clear separation between frozen Step 3 and active camera marker systems
3. Documentation preserved for future reference
4. Template definitions remain valid as conceptual vocabulary
5. Systematic removal process ensured no orphaned code

### Improvements for Future
1. Add explicit "FROZEN" markers to all frozen/future steps in planning docs
2. Cross-reference pipeline spec before implementing any step
3. Distinguish between "specification" and "execution" more clearly
4. Add activation criteria checklists to frozen capability docs

---

## Compliance Status

| Requirement | Status |
|-------------|--------|
| Step 3 remains specification-only | ✅ Compliant |
| No Camera Intent execution | ✅ Compliant |
| No database writes to camera_intents | ✅ Compliant |
| No UI workflows for Step 3 | ✅ Compliant |
| Pipeline functions without Step 3 | ✅ Compliant |
| Active camera systems preserved | ✅ Compliant |
| Template vocabulary available for reference | ✅ Compliant |
| Step 6 (MARBLE) remains future | ✅ Compliant |
| Activation criteria documented | ✅ Compliant |

---

## Contact & Questions

For questions about:
- **Pipeline specification**: See RETOUR – PIPELINE (UPDATED & LOCKED).txt
- **Step 3 frozen status**: See docs/archived-frozen/README.md
- **Template definitions**: See docs/archived-frozen/camera-intent-architecture.md (conceptual reference)
- **Active camera systems**: Check database schema for pipeline_camera_markers
- **This synchronization**: See this document

---

**Synchronization Date**: 2026-02-10
**Performed By**: Claude Code (Assistant)
**Status**: ✅ COMPLETE
**Result**: Codebase now compliant with locked pipeline specification
**Next Review**: When Step 3 activation criteria are met (TBD)
