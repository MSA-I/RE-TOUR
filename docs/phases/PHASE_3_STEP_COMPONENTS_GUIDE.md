# Phase 3: Step Components Implementation Guide

## Status: Partially Complete ✅

### What's Done:
1. ✅ **PipelineContext** created at `src/contexts/PipelineContext.tsx`
2. ✅ **Shared Types** created at `src/components/whole-apartment/steps/types.ts`
3. ✅ **StepContainer** wrapper created at `src/components/whole-apartment/steps/StepContainer.tsx`
4. ✅ **Step5_PromptTemplates** (NEW) created at `src/components/whole-apartment/steps/Step5_PromptTemplates.tsx`

### What Needs to Be Done:

The following step components need to be created following the established pattern:

1. **Step0_DesignRefAndSpaceScan.tsx** - Combines Steps 0.1 (Design Ref) and 0.2 (Space Scan)
2. **Step1_RealisticPlan.tsx** - Handles 2D Plan generation
3. **Step2_StyleApplication.tsx** - Handles Style application
4. **Step3_SpaceScan.tsx** - Internal Step 3 (detect spaces)
5. **Step4_CameraIntent.tsx** - Decision-only camera intent selection
6. **Step6_OutputsQA.tsx** - Outputs + QA review

---

## Pattern for Creating Step Components

Each step component should follow this structure:

### 1. Import Dependencies
```typescript
import { usePipelineContext } from "@/contexts/PipelineContext";
import { StepContainer } from "./StepContainer";
import { getStepStatus } from "./types";
// Add any step-specific UI components
```

### 2. Component Structure
```typescript
export function StepX_ComponentName() {
  // Get context
  const {
    pipeline,
    spaces,
    // ... other needed values
    toast
  } = usePipelineContext();

  // Local state (minimize this!)
  const [localState, setLocalState] = useState();

  // Derived state
  const currentPhase = pipeline.whole_apartment_phase;
  const status = getStepStatus(currentPhase);

  // Handlers
  const handleAction = async () => {
    try {
      // Do something
      toast({ title: "Success" });
    } catch (error) {
      toast({ title: "Error", variant: "destructive" });
    }
  };

  return (
    <StepContainer
      stepNumber="X"
      stepName="Step Name"
      status={status}
      description="What this step does"
    >
      {/* Step-specific UI */}
    </StepContainer>
  );
}
```

### 3. Key Principles

**DO:**
- ✅ Use `usePipelineContext()` to access shared state
- ✅ Use `StepContainer` for consistent layout
- ✅ Use `getStepStatus()` for status indicator
- ✅ Show loading states for async operations
- ✅ Handle errors gracefully with toast
- ✅ Keep component focused on ONE step only

**DON'T:**
- ❌ Pass 40+ props manually
- ❌ Handle multiple steps in one component
- ❌ Duplicate logic between steps
- ❌ Forget accessibility (ARIA labels, keyboard nav)

---

## Specific Implementation Notes

### Step0_DesignRefAndSpaceScan.tsx
**Current Code Location:** `WholeApartmentPipelineCard.tsx` lines ~500-800 (approximate)

**What to Extract:**
- Design reference uploader section
- Space analysis trigger button
- Space analysis results display
- Substeps 0.1 and 0.2 combined

**Mutations Needed:**
- `runSpaceAnalysis()`
- `runDesignRefScan()` (if it exists)

**Phases:**
- `upload`
- `space_analysis_pending`
- `space_analysis_running`
- `space_analysis_complete`

---

### Step1_RealisticPlan.tsx
**Current Code Location:** `WholeApartmentPipelineCard.tsx` lines ~800-1000

**What to Extract:**
- "Run 2D Plan" button
- 2D plan review/approval UI
- Preview image display

**Mutations Needed:**
- `runTopDown3D()`
- `continueToStep()` for approval

**Phases:**
- `top_down_3d_pending`
- `top_down_3d_running`
- `top_down_3d_review`

---

### Step2_StyleApplication.tsx
**Current Code Location:** `WholeApartmentPipelineCard.tsx` lines ~1000-1200

**What to Extract:**
- "Apply Style" button
- Style preview
- Approval UI

**Mutations Needed:**
- `runStyleTopDown()`
- `continueToStep()` for approval

**Phases:**
- `style_pending`
- `style_running`
- `style_review`

---

### Step3_SpaceScan.tsx
**Current Code Location:** `WholeApartmentPipelineCard.tsx` lines ~1200-1400

**What to Extract:**
- "Detect Spaces" button
- Detected spaces list
- Space cards display

**Mutations Needed:**
- `runDetectSpaces()`
- `retryDetectSpaces()` (if needed)
- `continueToStep()`

**Phases:**
- `detect_spaces_pending`
- `detecting_spaces`
- `spaces_detected`

---

### Step4_CameraIntent.tsx
**Current Code Location:** `WholeApartmentPipelineCard.tsx` lines ~1400-1800

**What to Extract:**
- Camera intent suggestions list
- `<CameraIntentSelectorPanel />` wrapper
- "Confirm Selection" button

**Mutations Needed:**
- `saveCameraIntents(intentIds: string[])`
- `continueToStep()`

**Phases:**
- `camera_intent_pending`
- `camera_intent_confirmed`

**Special Note:** This step is **decision-only** (no renders). User selects suggestions, confirms, and moves to Step 5.

---

### Step6_OutputsQA.tsx (NEW - similar to existing render review)
**Reference Code Location:** Look at existing render review panels in `WholeApartmentPipelineCard.tsx`

**What to Build:**
- Output images grid
- QA status indicators
- Approve/Reject buttons per output
- Batch approval

**Mutations Needed:**
- `approveOutput()` (similar to approveRender)
- `rejectOutput()` (similar to rejectRender)
- `retryOutput()` (similar to retryRender)
- `continueToStep()` to advance to Step 7

**Phases:**
- `outputs_pending`
- `outputs_in_progress`
- `outputs_review`

---

## Migration Strategy

### Approach 1: Incremental (Recommended)
1. Keep `WholeApartmentPipelineCard.tsx` as-is initially
2. Create new step components one by one
3. Test each component in isolation with mock data
4. Once all components are ready, refactor the main card
5. Remove old code gradually

### Approach 2: Big Bang (Risky)
1. Create all step components at once
2. Refactor `WholeApartmentPipelineCard.tsx` completely
3. Test everything together

**Recommendation:** Use Approach 1 to reduce risk of breaking existing functionality.

---

## Testing Checklist

For each step component:
- [ ] Renders correctly in `pending` state
- [ ] Shows loading indicator when `running`
- [ ] Displays results/review UI when complete
- [ ] Handles errors gracefully
- [ ] Accessible (keyboard nav, ARIA labels)
- [ ] Works with toast notifications
- [ ] Context provides all needed data
- [ ] No prop drilling

---

## Example: Extracting Step1_RealisticPlan

### Before (in WholeApartmentPipelineCard.tsx):
```typescript
{currentStep === 1 && (
  <div>
    <Button onClick={runTopDown3D}>Run 2D Plan</Button>
    {/* ... lots of JSX ... */}
  </div>
)}
```

### After (in Step1_RealisticPlan.tsx):
```typescript
export function Step1_RealisticPlan() {
  const { pipeline, runTopDown3D, continueToStep, toast } = usePipelineContext();
  const status = getStepStatus(pipeline.whole_apartment_phase);

  return (
    <StepContainer stepNumber="1" stepName="2D Plan" status={status}>
      <Button onClick={runTopDown3D}>Run 2D Plan</Button>
      {/* ... extracted JSX ... */}
    </StepContainer>
  );
}
```

### In WholeApartmentPipelineCard.tsx:
```typescript
<PipelineProvider value={pipelineContextValue}>
  <Step1_RealisticPlan />
</PipelineProvider>
```

---

## Next Steps

1. **Immediate:** Extract Step0-4, Step6 following the pattern above
2. **Then:** Refactor `WholeApartmentPipelineCard.tsx` to use new components
3. **Finally:** Remove old monolithic code
4. **Test:** Run E2E pipeline test

---

## Files to Modify

### New Files to Create:
- `src/components/whole-apartment/steps/Step0_DesignRefAndSpaceScan.tsx`
- `src/components/whole-apartment/steps/Step1_RealisticPlan.tsx`
- `src/components/whole-apartment/steps/Step2_StyleApplication.tsx`
- `src/components/whole-apartment/steps/Step3_SpaceScan.tsx`
- `src/components/whole-apartment/steps/Step4_CameraIntent.tsx`
- `src/components/whole-apartment/steps/Step6_OutputsQA.tsx`

### Files to Modify:
- `src/components/WholeApartmentPipelineCard.tsx` (major refactor)
- `src/hooks/useWholeApartmentPipeline.ts` (ensure all mutations are exported)

### Files Already Created:
- ✅ `src/contexts/PipelineContext.tsx`
- ✅ `src/components/whole-apartment/steps/types.ts`
- ✅ `src/components/whole-apartment/steps/StepContainer.tsx`
- ✅ `src/components/whole-apartment/steps/Step5_PromptTemplates.tsx`

---

## Estimated Effort

- Each step component: ~30-60 minutes
- Refactoring main card: ~60-90 minutes
- Testing and fixes: ~60 minutes
- **Total: ~4-6 hours**

---

## Questions?

If unsure about anything:
1. Check existing `Step5_PromptTemplates.tsx` for reference
2. Look at `WholeApartmentPipelineCard.tsx` for current implementation
3. Refer to `PipelineContext.tsx` for available mutations
4. Check `backend_plan.md` for phase definitions

---

## Success Criteria

Phase 3 is complete when:
- [ ] All 7 step components created
- [ ] `WholeApartmentPipelineCard` uses `<PipelineProvider>`
- [ ] No more 40+ props being passed
- [ ] Each component is focused and maintainable
- [ ] E2E test passes without errors
- [ ] No regression in existing functionality
