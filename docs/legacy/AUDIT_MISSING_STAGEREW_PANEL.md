# AUDIT: Missing StageReviewPanel from Modular Components

**Date**: 2026-02-12
**Discovery**: Old code used `StageReviewPanel` - new modular components don't
**Impact**: Critical missing functionality

---

## Key Discovery

The old `GlobalStepsSection` code (lines 1420-1583) used **`StageReviewPanel`** for Steps 1 and 2. This component provided:

1. ✅ Before/After image comparison
2. ✅ Image preview with zoom
3. ✅ QA status display
4. ✅ QA report accordion
5. ✅ Approval button (conditional on QA)
6. ✅ Rejection button (with notes)
7. ✅ Continue button (to next step)
8. ✅ Manual QA override support
9. ✅ Locked approval state
10. ✅ Prompt display (what was used to generate)

**ALL OF THIS IS MISSING** from the new modular step components!

---

## Old Code Analysis

### Step 1: Realistic 2D Plan (Old Implementation)

**Location**: `WholeApartmentPipelineCard.tsx` lines 1420-1460

```tsx
<StageReviewPanel
  title="Floor Plan → Top-Down 3D"
  stepNumber={1}
  currentStep={currentStep}
  beforeUploadId={pipeline.floor_plan_upload_id}
  beforeLabel="Floor Plan"
  afterAsset={{
    id: `step1-${pipeline.id}`,
    uploadId: step1UploadId,
    status: (manualQAEnabled && !step1ManualApproved && step1UploadId)
      ? "needs_review"
      : step1Asset.status,
    qaStatus: step1Output?.qa_status || step1Output?.qa_decision,
    qaReport: buildQaReport(step1Output),
    lockedApproved: step1ManualApproved,
    promptText: step1Output?.prompt_text || step1Output?.prompt_used,
  }}
  afterLabel="Top-Down 3D"
  onApprove={() => {
    onAction("approve", { step: 1 });
    onApproveStep(1);
  }}
  onReject={(notes) => {
    onAction("reject", { step: 1 });
    onRejectStep(1, notes);
  }}
  onContinue={step1Done ? () => {
    onAction("continue", { fromStep: 1, toStep: 2 });
    onRunStyle();
  } : undefined}
  continueLabel="Continue to Step 2"
  isLoading={isRunning}
  bucket="floor_plans"
/>
```

### Step 2: Style Application (Old Implementation)

**Location**: `WholeApartmentPipelineCard.tsx` lines 1542-1583

```tsx
<StageReviewPanel
  title="Style Top-Down"
  stepNumber={2}
  currentStep={currentStep}
  beforeUploadId={step1UploadIdForStep2 || null}
  beforeLabel="Unstyled"
  afterAsset={{
    id: `step2-${pipeline.id}`,
    uploadId: step2UploadId,
    status: (manualQAEnabled && !step2ManualApproved && step2UploadId)
      ? "needs_review"
      : step2Asset.status,
    qaStatus: step2Output?.qa_status || step2Output?.qa_decision,
    qaReport: buildQaReport(step2Output),
    lockedApproved: step2ManualApproved,
    promptText: step2Output?.prompt_text || step2Output?.prompt_used,
  }}
  afterLabel="Styled"
  onApprove={() => {
    onAction("approve", { step: 2 });
    onApproveStep(2);
  }}
  onReject={(notes) => {
    onAction("reject", { step: 2 });
    onRejectStep(2, notes);
  }}
  onContinue={step2Done && phase === "style_review" ? () => {
    onAction("continue", { fromStep: 2, toStep: 3 });
    onContinueToStep(2, "style_review");
  } : undefined}
  continueLabel="Continue to Camera Intent"
  isLoading={isRunning}
  bucket="outputs"
/>
```

---

## Data Structures

### StageReviewAsset Interface

```typescript
interface StageReviewAsset {
  id: string;
  uploadId: string;
  status: "needs_review" | "approved" | "pending";
  qaStatus: string | null;
  qaReport: {
    overall_decision?: string;
    overall_score?: number;
    criteria?: Array<{
      name: string;
      passed: boolean;
      confidence?: number;
      details?: string;
    }>;
    feedback?: string;
    qa_reason?: string;
  } | null;
  lockedApproved: boolean;
  promptText?: string | null;
}
```

### Step Output Data

```typescript
interface StepOutput {
  upload_id?: string;
  output_upload_id?: string;
  qa_status?: string;
  qa_decision?: string;
  qa_score?: number;
  qa_feedback?: string;
  qa_report?: Record<string, unknown>;
  qa_reason?: string;
  manual_approved?: boolean;
  prompt_text?: string;
  prompt_used?: string;
}
```

---

## What New Components Are Missing

### Step 1: `Step1_RealisticPlan.tsx`

**Currently Has**:
- ✅ Run button
- ✅ Approval buttons (basic)
- ✅ Reset/rollback buttons

**MISSING**:
- ❌ Image preview pane
- ❌ Before/after comparison view
- ❌ QA status display
- ❌ QA report accordion
- ❌ Manual QA override checkbox
- ❌ Locked approval state
- ❌ Prompt display
- ❌ Retry state indicator
- ❌ Compare multiple attempts

### Step 2: `Step2_StyleApplication.tsx`

**Currently Has**:
- ✅ Run button
- ✅ Approval buttons (basic)
- ✅ Reset/rollback buttons

**MISSING**:
- ❌ Image preview pane
- ❌ Before/after comparison view (unstyled vs styled)
- ❌ QA status display
- ❌ QA report accordion
- ❌ Manual QA override checkbox
- ❌ Locked approval state
- ❌ Prompt display
- ❌ Retry state indicator
- ❌ Compare multiple attempts

### Step 3: `Step3_SpaceScan.tsx`

**Currently Has**:
- ✅ Run button
- ✅ Detected spaces list
- ✅ Continue button
- ✅ Reset/rollback buttons

**MISSING**:
- ⚠️ Space visualization overlay (depends on design)
- ❌ QA results (if applicable)
- ❌ Retry state indicator

---

## StageReviewPanel Component Features

The existing `StageReviewPanel` component provides:

### 1. Before/After Image Comparison
- Side-by-side image display
- Slider to switch between before/after
- Labels for each image
- Zoom/pan controls
- Fullscreen mode

### 2. QA Integration
- Status badge (pending/passed/failed)
- Overall score display
- QA criteria breakdown (accordion)
- Feedback messages
- Confidence levels

### 3. Approval Workflow
- **Approve Button**:
  - Enabled when QA passes OR manual override checked
  - Disabled when QA fails (unless manual override)
  - Confirmation dialog
  - Triggers phase transition
- **Reject Button**:
  - Always enabled
  - Allows rejection notes
  - Triggers retry
  - Confirmation dialog

### 4. Manual QA Override
- Checkbox: "Approve anyway (override QA)"
- Only visible if `manualQAEnabled` prop is true
- Allows approving failed QA outputs
- Shows warning about overriding QA

### 5. Continue Button
- Shown after approval
- Triggers next step
- Custom label per step
- Only enabled when step is approved

### 6. Loading States
- Shows spinner during generation
- Disables buttons during operations
- Progress indicators

### 7. Metadata Display
- Prompt used to generate
- Upload ID
- Attempt number (if retry)
- Timestamp

---

## Comparison: Old vs New

### OLD: GlobalStepsSection with StageReviewPanel ✅

**User Experience**:
1. Click "Generate 2D Plan"
2. **Image appears** with loading state
3. **QA runs** - status badge updates
4. **QA passes** - green badge, approve button enabled
5. User clicks **"Approve"**
6. **Continue button** appears
7. User clicks **"Continue to Step 2"**
8. Step 2 begins

**Visual Feedback**: ✅ Excellent - users see:
- The generated image
- QA results with scores
- Clear approval state
- Smooth progression

### NEW: Modular Step Components ❌

**User Experience**:
1. Click "Generate 2D Plan"
2. ... ??? (No visual feedback)
3. Button changes to "Approve & Continue"
4. User clicks button blindly
5. Step 2 begins

**Visual Feedback**: ❌ Poor - users see:
- No image preview
- No QA results
- No confidence in quality
- Just a button to click

**This is a CRITICAL UX regression!**

---

## Required Actions

### Immediate (Critical)

1. **Add StageReviewPanel to Step 1**
   - Import component
   - Build `step1Asset` object from context
   - Wire up approval/rejection handlers
   - Add before/after image support

2. **Add StageReviewPanel to Step 2**
   - Import component
   - Build `step2Asset` object from context
   - Wire up approval/rejection handlers
   - Add before/after image support

### High Priority

3. **Add Retry State Indicator to Steps 1, 2**
   - Show current attempt (e.g., "Attempt 2/3")
   - Show retry button if available
   - Show manual override if exhausted

4. **Add Compare Functionality**
   - Show "Compare Attempts" button if multiple outputs
   - Open modal with side-by-side comparison
   - Allow selecting best attempt

### Medium Priority

5. **Enhance Step 6 with Per-Space Review**
   - Show StageReviewPanel per space
   - Allow per-space approval
   - Show batch approval option

6. **Add Visual Feedback to Step 3**
   - Space boundary overlay (if designed)
   - Interactive space selection
   - Preview before confirmation

---

## Implementation Strategy

### Option 1: Reuse StageReviewPanel (Recommended)

**Pros**:
- Component already exists and works
- Proven UX
- All features included
- Quick implementation

**Cons**:
- May need prop updates for new context structure
- Couples step components to existing component

**Effort**: Low (2-3 hours per step)

### Option 2: Create New Modular Components

**Pros**:
- More flexible
- Better separation of concerns
- Can customize per step

**Cons**:
- More work
- Risk of missing features
- Need to recreate tested UX

**Effort**: High (20-30 hours total)

### Recommendation: **Option 1**

Reuse `StageReviewPanel` for Steps 1 and 2. It's battle-tested and provides all needed functionality. We can refactor later if needed.

---

## Quick Fix Implementation

### Step 1 - Add StageReviewPanel

**File**: `src/components/whole-apartment/steps/Step1_RealisticPlan.tsx`

```tsx
import { StageReviewPanel, StageReviewAsset } from "@/components/whole-apartment/StageReviewPanel";

export function Step1_RealisticPlan() {
  const {
    pipeline,
    imagePreviews,
    runTopDown3D,
    continueToStep,
    isResetPending,
    isRollbackPending,
    restartStep,
    rollbackToPreviousStep,
    toast
  } = usePipelineContext();

  const currentPhase = pipeline.whole_apartment_phase;
  const stepOutputs = (pipeline.step_outputs || {}) as Record<string, any>;
  const step1Output = stepOutputs["step1"] || stepOutputs["1"];
  const step1UploadId = step1Output?.upload_id || step1Output?.output_upload_id;
  const step1ManualApproved = !!step1Output?.manual_approved;

  // Build asset object for StageReviewPanel
  const step1Asset: StageReviewAsset | null = step1UploadId ? {
    id: `step1-${pipeline.id}`,
    uploadId: step1UploadId,
    status: currentPhase === "top_down_3d_review" ? "needs_review"
          : step1ManualApproved ? "approved"
          : "pending",
    qaStatus: step1Output?.qa_status || step1Output?.qa_decision,
    qaReport: step1Output?.qa_report || null,
    lockedApproved: step1ManualApproved,
    promptText: step1Output?.prompt_text || step1Output?.prompt_used,
  } : null;

  const handleApprove = async () => {
    // Approve logic
    await continueToStep({ from_phase: currentPhase });
    toast({ title: "Step 1 Approved" });
  };

  const handleReject = async (notes?: string) => {
    // Reject logic - triggers retry
    toast({ title: "Step 1 Rejected", description: "Retrying..." });
  };

  return (
    <StepContainer stepNumber="1" stepName="Realistic 2D Plan" ...>
      {/* Run Button (existing) */}
      <Button onClick={() => runTopDown3D()}>Generate 2D Plan</Button>

      {/* ADD: StageReviewPanel for output display */}
      {step1Asset && (
        <StageReviewPanel
          title="Floor Plan → Top-Down 3D"
          stepNumber={1}
          currentStep={pipeline.current_step || 0}
          beforeUploadId={pipeline.floor_plan_upload_id}
          beforeLabel="Floor Plan"
          afterAsset={step1Asset}
          afterLabel="Top-Down 3D"
          onApprove={handleApprove}
          onReject={handleReject}
          onContinue={step1ManualApproved ? () => runStyleTopDown() : undefined}
          continueLabel="Continue to Step 2"
          isLoading={currentPhase === "top_down_3d_running"}
          bucket="floor_plans"
        />
      )}

      {/* Reset/Rollback Buttons (existing) */}
      <StepControlsFooter ... />
    </StepContainer>
  );
}
```

**Result**: Step 1 now shows full output display with QA, approval, and comparison!

---

## Success Criteria

### Step 1 Complete When:
- [ ] StageReviewPanel displays after generation
- [ ] Before/after images show correctly
- [ ] QA status displays with badge
- [ ] QA report accordion works
- [ ] Approve button enabled when QA passes
- [ ] Reject button triggers retry
- [ ] Manual override checkbox works (if enabled)
- [ ] Continue button appears after approval
- [ ] All transitions work correctly

### Step 2 Complete When:
- [ ] Same as Step 1 (identical requirements)

### Step 6 Complete When:
- [ ] Per-space StageReviewPanel displays
- [ ] Batch approval works
- [ ] Compare within space works

---

## Estimated Effort

### Quick Fix (Reuse StageReviewPanel)
- **Step 1**: 2-3 hours
- **Step 2**: 2-3 hours
- **Step 6**: 4-6 hours (more complex)
- **Testing**: 2-3 hours
- **Total**: 10-15 hours

### Full Rebuild (New Components)
- **Component development**: 20-25 hours
- **Integration**: 10-12 hours
- **Testing**: 4-6 hours
- **Total**: 34-43 hours

**Recommendation**: Start with quick fix using StageReviewPanel.

---

## Next Steps

1. ✅ Audit complete - missing features identified
2. ⏭️ Add StageReviewPanel to Step 1
3. ⏭️ Add StageReviewPanel to Step 2
4. ⏭️ Test approval workflows
5. ⏭️ Add to Step 6 (more complex)
6. ⏭️ E2E testing

---

**Status**: AUDIT COMPLETE
**Priority**: CRITICAL
**Recommendation**: Proceed with quick fix (reuse StageReviewPanel)
**Estimated Effort**: 10-15 hours
