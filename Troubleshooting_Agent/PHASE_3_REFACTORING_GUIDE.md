# Phase 3.3: Refactor WholeApartmentPipelineCard - Integration Guide

**Status:** ✅ All step components created and ready
**File to Modify:** `src/components/WholeApartmentPipelineCard.tsx`

---

## Overview

All 7 modular step components have been created:
- ✅ Step0_DesignRefAndSpaceScan.tsx
- ✅ Step1_RealisticPlan.tsx
- ✅ Step2_StyleApplication.tsx
- ✅ Step3_SpaceScan.tsx
- ✅ Step4_CameraIntent.tsx
- ✅ Step5_PromptTemplates.tsx
- ✅ Step6_OutputsQA.tsx

Now we need to integrate them into `WholeApartmentPipelineCard.tsx`.

---

## Integration Steps

### Step 1: Import New Components

At the top of `WholeApartmentPipelineCard.tsx` (around line 34), add:

```typescript
// NEW: Import modular step components
import { PipelineProvider } from "@/contexts/PipelineContext";
import {
  Step0_DesignRefAndSpaceScan,
  Step1_RealisticPlan,
  Step2_StyleApplication,
  Step3_SpaceScan,
  Step4_CameraIntent,
  Step5_PromptTemplates,
  Step6_OutputsQA,
} from "@/components/whole-apartment/steps";
```

### Step 2: Prepare Context Value

In the main component function (around line 2115), after all the hooks are called, create the context value:

```typescript
export const WholeApartmentPipelineCard = memo(function WholeApartmentPipelineCard({
  pipeline,
  imagePreviews,
  onUpdatePipeline,
}: WholeApartmentPipelineCardProps) {
  // ... existing state and hooks ...

  const {
    spaces: pipelineSpaces,
    // ... all existing destructured values ...
    saveCameraIntents,
    composeFinalPrompts,
    runBatchOutputs,
    // ... rest ...
  } = useWholeApartmentPipeline(pipeline.id);

  // Query: Fetch camera intents for Step 4
  const { data: cameraIntents = [], refetch: refetchCameraIntents } = useQuery({
    queryKey: ["camera-intents", pipeline.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("camera_intents_with_spaces")
        .select("*")
        .eq("pipeline_id", pipeline.id)
        .order("space_id")
        .order("suggestion_index");

      if (error) {
        console.error("[camera-intents] Query error:", error);
        return [];
      }
      return data || [];
    },
    enabled: !!pipeline.id,
  });

  // Query: Fetch final prompts for Step 5
  const { data: finalPrompts = [], refetch: refetchFinalPrompts } = useQuery({
    queryKey: ["final-prompts", pipeline.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("final_prompts")
        .select("*")
        .eq("pipeline_id", pipeline.id)
        .order("space_id");

      if (error) {
        console.error("[final-prompts] Query error:", error);
        return [];
      }
      return data || [];
    },
    enabled: !!pipeline.id,
  });

  // Create context value
  const pipelineContextValue = {
    // Pipeline state
    pipeline,
    spaces: pipelineSpaces || [],
    imagePreviews,
    currentStep: pipeline.current_step,

    // Camera intents
    cameraIntents,
    refetchCameraIntents,

    // Final prompts
    finalPrompts,
    refetchFinalPrompts,

    // Mutations - Pipeline progression
    runSpaceAnalysis,
    runTopDown3D,
    runStyleTopDown,
    runDetectSpaces,
    continueToStep,

    // Mutations - Step 4-6 specific
    saveCameraIntents,
    composeFinalPrompts,
    runBatchOutputs,

    // Loading states
    isLoadingSpaces,
    isRunningStep: isRunning, // Map to generic name
    isGeneratingPrompts,
    isGeneratingImages,

    // Progress
    progress,
    progressDetails,

    // Toast
    toast,

    // Callbacks
    onUpdatePipeline,
  };

  // ... rest of component ...
```

### Step 3: Replace GlobalStepsSection with New Components

Find the render section where `GlobalStepsSection` is used (around line 2400+). Replace it with:

```tsx
return (
  <Card className="w-full">
    <CardHeader>
      {/* ... existing header content ... */}
    </CardHeader>

    <CardContent className="space-y-6">
      {/* Wrap everything in PipelineProvider */}
      <PipelineProvider value={pipelineContextValue}>
        {/* Progress Bar */}
        <PipelineProgressBar
          currentStep={pipeline.current_step}
          totalSteps={9}
          locked={true}
        />

        {/* Global Step Indicator */}
        <GlobalStepIndicator currentStep={pipeline.current_step} />

        {/* Steps 0-3: Core Pipeline */}
        <Collapsible
          open={globalStepsExpanded}
          onOpenChange={setGlobalStepsExpanded}
        >
          <CollapsibleTrigger className="flex items-center justify-between w-full p-3 hover:bg-muted/50 rounded-lg">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium">Steps 0-3: Core Pipeline</h3>
              <Badge variant="outline">
                {pipeline.current_step <= 3 ? "Active" : "Complete"}
              </Badge>
            </div>
            <ChevronDown className={`w-4 h-4 transition-transform ${globalStepsExpanded ? "rotate-180" : ""}`} />
          </CollapsibleTrigger>

          <CollapsibleContent className="space-y-4 pt-4">
            <Step0_DesignRefAndSpaceScan />
            <Step1_RealisticPlan />
            <Step2_StyleApplication />
            <Step3_SpaceScan />
          </CollapsibleContent>
        </Collapsible>

        {/* Step 4: Camera Intent (Decision-Only) */}
        <Collapsible
          open={step4PanelOpen}
          onOpenChange={setStep4PanelOpen}
        >
          <CollapsibleTrigger className="flex items-center justify-between w-full p-3 hover:bg-muted/50 rounded-lg">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium">Step 4: Camera Intent</h3>
              <Badge variant="outline">Decision-Only</Badge>
            </div>
            <ChevronDown className={`w-4 h-4 transition-transform ${step4PanelOpen ? "rotate-180" : ""}`} />
          </CollapsibleTrigger>

          <CollapsibleContent className="pt-4">
            <Step4_CameraIntent />
          </CollapsibleContent>
        </Collapsible>

        {/* Step 5: Prompt Templates + Generation (NEW) */}
        <Collapsible
          open={step5PanelOpen}
          onOpenChange={setStep5PanelOpen}
        >
          <CollapsibleTrigger className="flex items-center justify-between w-full p-3 hover:bg-muted/50 rounded-lg">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium">Step 5: Prompt Templates + Generation</h3>
              <Badge variant="outline">NEW</Badge>
            </div>
            <ChevronDown className={`w-4 h-4 transition-transform ${step5PanelOpen ? "rotate-180" : ""}`} />
          </CollapsibleTrigger>

          <CollapsibleContent className="pt-4">
            <Step5_PromptTemplates />
          </CollapsibleContent>
        </Collapsible>

        {/* Step 6: Outputs + QA */}
        <Collapsible
          open={step6PanelOpen}
          onOpenChange={setStep6PanelOpen}
        >
          <CollapsibleTrigger className="flex items-center justify-between w-full p-3 hover:bg-muted/50 rounded-lg">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium">Step 6: Outputs + QA</h3>
            </div>
            <ChevronDown className={`w-4 h-4 transition-transform ${step6PanelOpen ? "rotate-180" : ""}`} />
          </CollapsibleTrigger>

          <CollapsibleContent className="pt-4">
            <Step6_OutputsQA />
          </CollapsibleContent>
        </Collapsible>

        {/* Existing SpaceCards section - keep as is */}
        {spaces.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-medium">Detected Spaces</h3>
            {spaces.map((space) => (
              <SpaceCard
                key={space.id}
                space={space}
                pipeline={pipeline}
                // ... existing props ...
              />
            ))}
          </div>
        )}
      </PipelineProvider>
    </CardContent>
  </Card>
);
```

### Step 4: Add Missing State Variables

Add these state variables if they don't exist (around line 2120):

```typescript
const [step5PanelOpen, setStep5PanelOpen] = useState(false);
const [step6PanelOpen, setStep6PanelOpen] = useState(false);
```

### Step 5: Add Missing Query for Final Prompts

If not already present, add the query (around line 2200):

```typescript
// Query: Fetch final prompts for Step 5
const { data: finalPrompts = [], refetch: refetchFinalPrompts } = useQuery({
  queryKey: ["final-prompts", pipeline.id],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("final_prompts")
      .select("*")
      .eq("pipeline_id", pipeline.id)
      .order("space_id");

    if (error) {
      console.error("[final-prompts] Query error:", error);
      return [];
    }
    return data || [];
  },
  enabled: !!pipeline.id,
});
```

---

## What Gets Removed

Once the new components are integrated, you can remove or simplify:

1. **GlobalStepsSection function** - Can be removed entirely
2. **40+ prop drilling** - No longer needed
3. **Massive conditional rendering** - Handled in step components
4. **Step-specific state management** - Moved to components

---

## Migration Strategy

### Option A: Gradual Migration (Recommended for Production)

1. Keep `GlobalStepsSection` initially
2. Add new components side-by-side
3. Test each step component individually
4. Once verified, remove GlobalStepsSection

### Option B: Complete Replacement

1. Comment out GlobalStepsSection
2. Add all new components at once
3. Test entire pipeline
4. Remove commented code

---

## Testing Checklist

After integration, test:

- [ ] Step 0: Space Analysis runs and completes
- [ ] Step 1: 2D Plan generates and can be approved
- [ ] Step 2: Style applies and can be approved
- [ ] Step 3: Spaces detected and listed correctly
- [ ] Step 4: Camera intents load, can be selected, and confirmed
- [ ] Step 5: Prompts display, can be edited, and generation triggers
- [ ] Step 6: Outputs generate and can be approved
- [ ] Context provides all needed values
- [ ] No console errors
- [ ] Loading states work correctly
- [ ] Toast notifications appear

---

## Troubleshooting

### Error: "usePipelineContext must be used within a PipelineProvider"
**Solution:** Ensure `<PipelineProvider>` wraps all step components

### Error: Missing mutations in context
**Solution:** Check that `pipelineContextValue` includes all required properties from the interface

### Error: Camera intents not loading
**Solution:** Verify the `camera_intents_with_spaces` view exists in Supabase

### Step components not rendering
**Solution:** Check that the phase values in your pipeline match the expected phases in `getStepStatus()`

---

## Benefits After Refactoring

✅ **Maintainability**: Each step is self-contained
✅ **Testability**: Components can be tested in isolation
✅ **Extensibility**: Easy to add new steps
✅ **Performance**: Smaller components re-render less
✅ **Developer Experience**: Clear, focused code
✅ **No Prop Drilling**: Context eliminates 40+ props

---

## Estimated Time

- Context value setup: 15 minutes
- Component integration: 30 minutes
- Testing: 30 minutes
- Cleanup: 15 minutes

**Total: ~90 minutes**

---

## Next Steps

1. Complete this refactoring
2. Test each step thoroughly
3. Remove old GlobalStepsSection code
4. Move to Phase 5 (Accessibility)

