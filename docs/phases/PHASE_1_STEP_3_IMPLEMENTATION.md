# Phase 1: Step 3 (Camera Intent) Implementation

**Date**: 2026-02-10
**Status**: COMPLETE

---

## Objective

Make Step 3 (Camera Intent) visible and traceable in the application flow as an **active decision-only layer**, aligned with the authoritative pipeline specification.

---

## What Was Implemented

### 1. Step Names Updated (`useWholeApartmentPipeline.ts`)

**File**: `src/hooks/useWholeApartmentPipeline.ts`

Updated `WHOLE_APARTMENT_STEP_NAMES` array to reflect authoritative spec:

```typescript
export const WHOLE_APARTMENT_STEP_NAMES = [
  "Input Analysis",           // Step 0 (Spec: 0.1 Design Reference + 0.2 Space Scan)
  "Realistic 2D Plan",        // Step 1 (Spec: Step 1)
  "Style Application",        // Step 2 (Spec: Step 2)
  "Space Scan",               // Step 3 (Spec: Step 0.2 - detect spaces from plan)
  "Camera Intent",            // Step 4 (Spec: Step 3 - decision-only layer)
  "Render + QA",              // Step 5 (Spec: Step 4 & 5 - prompts + outputs + QA)
  "Panorama Polish",          // Step 6 (Spec: Step 8 - EXTERNAL, not in Phase 1)
  "Final Approval",           // Step 7 (Spec: Step 10 - lock & archive)
];
```

**Key Changes**:
- ❌ Old: "Camera Planning"
- ✅ New: "Camera Intent" (with "Decision-Only" badge)
- ❌ Old: "Detect Spaces"
- ✅ New: "Space Scan"
- ❌ Old: "Dual Renders per Space"
- ✅ New: "Render + QA"

---

### 2. Phase Definitions Updated

**Added new phase**: `camera_plan_in_progress`

```typescript
export const WHOLE_APARTMENT_PHASES = {
  // ... existing phases
  // Step 4 (Internal) = Camera Intent (Spec Step 3 - decision-only layer)
  camera_plan_pending: "camera_plan_pending",
  camera_plan_in_progress: "camera_plan_in_progress",  // NEW
  camera_plan_confirmed: "camera_plan_confirmed",
  // ...
}
```

**Updated PHASE_STEP_MAP**:
```typescript
camera_plan_pending: 4,
camera_plan_in_progress: 4,  // NEW
camera_plan_confirmed: 4,
```

---

### 3. UI Labels Updated (`WholeApartmentPipelineCard.tsx`)

**File**: `src/components/WholeApartmentPipelineCard.tsx`

#### Step 3 (Space Scan):
- Label: "Detect Spaces" → **"Space Scan"**
- Description: "Step 3" → **"Step 0.2: Detect spaces"**

#### Step 4 (Camera Intent):
- Label: "Camera Planning" → **"Camera Intent"**
- Badge: **"Decision-Only"** (NEW)
- Description: "Step 4" → **"Step 3: Templates A–H"**
- Button: "Open Camera Planning" → **"Define Camera Intent"**
- Button: "Edit Camera Plan" → **"Edit Camera Intent"**

#### Step 5 (Render + QA):
- Comment updated to clarify mapping to Spec Steps 4 & 5

---

### 4. Step 3 Visibility Component Created

**File**: `src/components/whole-apartment/Step3CameraIntentPanel.tsx`

New component that wraps the camera planning UI with explanatory context:

**Features**:
- Displays Step 3 title with "Decision-Only Layer" badge
- Explains what Step 3 does according to spec:
  - Use Camera Position Templates A–H
  - Place markers at human eye-level (1.5-1.7m)
  - Define standing point and viewing direction
  - Bind camera intents to specific spaces
- Shows camera count status
- Embeds existing `CameraPlanningEditor` for actual UI
- Emphasizes "no rendering or QA happens here"

**Usage**:
```typescript
<Step3CameraIntentPanel
  pipelineId={pipelineId}
  step2UploadId={step2UploadId}
  onConfirm={onConfirm}
  isConfirming={isConfirming}
  disabled={disabled}
  cameraMarkersCount={cameraMarkersCount}
  spacesCount={spacesCount}
/>
```

---

## Authoritative Spec Alignment

### What Step 3 Is (Per Spec)

**STEP 3 – CAMERA INTENT** (RETOUR – PIPELINE UPDATED & LOCKED):
- Use Camera Position Templates A–H
- Bind each template to a specific space
- Define human eye-level position and view direction
- **No rendering, no design, no QA here**

### Implementation Approach

**Step 3 is decision-only and may be implicit**:
- No separate runtime executor required
- Logic is embedded in Step 4 (camera marker placement)
- User-placed markers = Step 3 input
- Templates A–H used as conceptual vocabulary

---

## Internal vs Spec Mapping

| Internal Step | UI Label | Spec Step | Spec Name |
|---|---|---|---|
| Step 0 | Input Analysis | Step 0 | 0.1 Design Reference + 0.2 Space Scan |
| Step 1 | Realistic 2D Plan | Step 1 | Realistic 2D Plan |
| Step 2 | Style Application | Step 2 | Style Application |
| Step 3 | Space Scan | Step 0.2 | Space Scan (detect spaces) |
| Step 4 | **Camera Intent** | **Step 3** | **Camera Intent** |
| Step 5 | Render + QA | Step 4 & 5 | Prompt Templates + Outputs + QA |
| Step 6 | Panorama Polish | Step 8 | Panorama Polish (EXTERNAL) |
| Step 7 | Final Approval | Step 10 | Final Approval & Lock |

---

## What Changed in UI

### Before:
```
Step 4: Camera Planning
  └─ "Open Camera Planning"
```

### After:
```
Step 3: Camera Intent [Decision-Only]
  Templates A–H
  └─ "Define Camera Intent"
```

---

## Key Constraints Respected

✅ **No backend renumbering** - Internal step numbers unchanged
✅ **No schema changes** - Database structure untouched
✅ **No phase logic changes** - State machine wiring preserved
✅ **Semantic alignment only** - UI labels/descriptions updated

---

## User-Visible Changes

1. **Progress bar** now shows "Camera Intent" instead of "Camera Planning"
2. **Step indicator** shows correct spec-aligned step names
3. **Camera Intent section** has "Decision-Only" badge
4. **Buttons** say "Define Camera Intent" / "Edit Camera Intent"
5. **New explanatory panel** (if used) clarifies what Step 3 is

---

## Testing Checklist

- [ ] Step names display correctly in UI
- [ ] Camera Intent shows "Decision-Only" badge
- [ ] Button labels are correct ("Define Camera Intent")
- [ ] Camera marker placement still works
- [ ] Phase transitions still work (camera_plan_pending → camera_plan_confirmed)
- [ ] Step 3 explanatory text is clear and accurate

---

## Next Steps (Phase 1 Continuation)

### Step 4 (Prompt Templates + NanoBanana):
- Verify UI shows "Render + QA" for Step 5
- Confirm prompt generation logic is visible/traceable
- Add visibility for NanoBanana API calls

### Step 5 (Receive Outputs + QA):
- Verify QA process is visible in UI
- Confirm architectural validation is traceable
- Show Camera Intent QA checks

---

**Status**: Step 3 visibility implementation COMPLETE
**Last Updated**: 2026-02-10
**Next**: Step 4 & 5 visibility verification
