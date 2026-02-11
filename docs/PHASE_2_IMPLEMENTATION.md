# RE-TOUR Pipeline Repair - Phase 2 Implementation

## Phase 2: Merge New Features

This document tracks the integration of new features from the current version into the restored working baseline.

### Features to Integrate

#### 1. Step 0 Sub-steps (0.1 Design Reference + 0.2 Space Scan)

**Status**: ✅ Already Present in Current Version

**Location**: `useWholeApartmentPipeline.ts` lines 299-314

**Description**: Splits Step 0 into two sub-steps:
- **0.1 Design Reference Scan**: Analyze style, colors, and materials from reference images (optional)
- **0.2 Space Scan**: Detect rooms, zones, and spatial relationships from floor plan (required)

**Integration Status**: 
- Constants defined in `STEP_0_SUBSTEPS`
- No conflicts with restored mutations
- ✅ **No action needed** - feature already compatible

---

#### 2. Locked Pipeline Display Structure

**Status**: ✅ Already Present in Current Version

**Location**: `useWholeApartmentPipeline.ts` lines 321-334

**Description**: User-facing step labels and numbering for the top stepper UI component.

**Structure**:
```typescript
[
  { stepNum: "0.1", label: "Design Ref", internalStep: 0 },
  { stepNum: "0.2", label: "Space Scan", internalStep: 0 },
  { stepNum: "1", label: "2D Plan", internalStep: 1 },
  { stepNum: "2", label: "Style", internalStep: 2 },
  { stepNum: "3", label: "Camera Intent", internalStep: 4 },
  { stepNum: "4", label: "Prompts", internalStep: 5 },
  { stepNum: "5", label: "Outputs+QA", internalStep: 5 },
  { stepNum: "6-9", label: "Future", internalStep: 6, futurePhase: true },
  { stepNum: "10", label: "Final Approval", internalStep: 7 }
]
```

**Integration Status**:
- Used by UI components for stepper display
- No conflicts with restored mutations
- ✅ **No action needed** - feature already compatible

**UI Components Using This**:
- Need to verify which components import and use `LOCKED_PIPELINE_DISPLAY`

---

#### 3. Camera Context Fields

**Status**: ✅ Already Present in Type Definitions

**Location**: `useWholeApartmentPipeline.ts` lines 30-34

**Description**: New fields for camera planning feature:
```typescript
camera_marker_id?: string | null;
camera_label?: string | null;
final_composed_prompt?: string | null;
adjacency_context?: Record<string, unknown> | null;
```

**Integration Status**:
- Type definitions present in `SpaceRender` interface
- Database schema needs verification
- ✅ **No action needed** - type definitions compatible

**Action Items**:
- [ ] Verify database schema has these columns
- [ ] Check if migrations exist for these fields

---

#### 4. Toast Notifications

**Status**: ✅ Integrated During Phase 1

**Location**: All restored mutations (`runTopDown3D`, `runStyleTopDown`, `runDetectSpaces`)

**Description**: User-friendly toast notifications for:
- Success: "Step X Started - Generating..."
- Error: "Failed to start Step X - [error message]"

**Integration Status**:
- ✅ Added to all restored mutations
- Uses `useToast` hook from `@/hooks/use-toast`
- 10-second duration for error messages

---

#### 5. Step Names and Badges

**Status**: ✅ Already Present in Current Version

**Location**: `useWholeApartmentPipeline.ts` lines 272-296

**Description**: Updated step names aligned with spec:
```typescript
WHOLE_APARTMENT_STEP_NAMES = [
  "Input Analysis (0.1 + 0.2)",  // Step 0
  "Realistic 2D Plan",            // Step 1
  "Style Application",            // Step 2
  "Space Scan",                   // Step 3
  "Camera Intent",                // Step 4
  "Render + QA",                  // Step 5
  "Capability Slots",             // Step 6 (Future/Disabled)
  "Final Approval",               // Step 7
]

STEP_BADGES = {
  4: "Decision-Only",
  6: "Future / Disabled",
}
```

**Integration Status**:
- ✅ Already compatible with restored mutations
- Provides better UI labels

---

### Verification Checklist

#### Database Schema Verification

```sql
-- Check if camera context fields exist
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'floorplan_space_renders' 
  AND column_name IN (
    'camera_marker_id', 
    'camera_label', 
    'final_composed_prompt', 
    'adjacency_context'
  );
```

**Expected Result**: All 4 columns should exist

---

#### UI Component Integration

Files to check for `LOCKED_PIPELINE_DISPLAY` usage:

```bash
# Find components using LOCKED_PIPELINE_DISPLAY
grep -r "LOCKED_PIPELINE_DISPLAY" src/components/
```

**Action**: Verify these components work with restored mutations

---

### Integration Summary

| Feature | Status | Action Required |
|---------|--------|-----------------|
| Step 0 Sub-steps | ✅ Compatible | None |
| Locked Pipeline Display | ✅ Compatible | Verify UI components |
| Camera Context Fields | ✅ Compatible | Verify DB schema |
| Toast Notifications | ✅ Integrated | None |
| Step Names & Badges | ✅ Compatible | None |

---

### Next Steps

1. **Verify Database Schema**
   ```bash
   # Check for camera context columns
   supabase db diff
   ```

2. **Test UI Components**
   - Open application in browser
   - Navigate through pipeline steps
   - Verify stepper displays correctly

3. **Full Pipeline Test**
   - Run Step 0 → Step 1 → Step 2 → Step 3
   - Verify all new features work with restored mutations

---

### Potential Issues

#### Issue 1: UI Components Not Updated

**Symptom**: Stepper shows old step numbering

**Fix**: Update UI components to use `LOCKED_PIPELINE_DISPLAY`

**Files to Check**:
- `src/components/pipeline/GlobalStepIndicator.tsx` (or similar)
- Any component rendering the pipeline stepper

#### Issue 2: Database Schema Missing Columns

**Symptom**: Errors when saving camera context data

**Fix**: Create migration to add missing columns

**Migration Template**:
```sql
ALTER TABLE floorplan_space_renders 
ADD COLUMN IF NOT EXISTS camera_marker_id TEXT,
ADD COLUMN IF NOT EXISTS camera_label TEXT,
ADD COLUMN IF NOT EXISTS final_composed_prompt TEXT,
ADD COLUMN IF NOT EXISTS adjacency_context JSONB;
```

---

### Completion Criteria

Phase 2 is complete when:
- [x] All new features identified and documented
- [ ] Database schema verified
- [ ] UI components verified
- [ ] Full pipeline test passes (Step 0 → Step 3)
- [ ] No regressions from Phase 1 repairs

---

### Rollback Plan

If Phase 2 integration causes issues:

1. **Revert UI Components**
   ```bash
   git checkout HEAD -- src/components/pipeline/
   ```

2. **Keep Phase 1 Repairs**
   - Phase 1 mutations are stable and should not be reverted
   - Only revert Phase 2 feature integrations

3. **Document Issues**
   - Create GitHub issue with reproduction steps
   - Include error messages and screenshots
