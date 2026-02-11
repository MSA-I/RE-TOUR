# PATCH: WholeApartmentPipelineCard.tsx
# Step 0 Isolation + Step 3 Correction
# Date: 2026-02-10

**CRITICAL**: This file is ~2000+ lines. Apply changes carefully and test thoroughly.

---

## CHANGE 1: Add CameraIntentSelector Import

**Location**: Line ~28 (after CameraPlanningEditor import)

**BEFORE**:
```typescript
import { CameraPlanningEditor } from "@/components/whole-apartment/CameraPlanningEditor";
import { StopResetStepButton } from "@/components/whole-apartment/StopResetStepButton";
```

**AFTER**:
```typescript
import { CameraPlanningEditor } from "@/components/whole-apartment/CameraPlanningEditor";
import { CameraIntentSelector } from "@/components/whole-apartment/CameraIntentSelector";
import { StopResetStepButton } from "@/components/whole-apartment/StopResetStepButton";
```

---

## CHANGE 2: Update Imports from useWholeApartmentPipeline

**Location**: Line ~10-14

**BEFORE**:
```typescript
import {
  useWholeApartmentPipeline,
  WHOLE_APARTMENT_STEP_NAMES,
  PHASE_STEP_MAP,
} from "@/hooks/useWholeApartmentPipeline";
```

**AFTER**:
```typescript
import {
  useWholeApartmentPipeline,
  WHOLE_APARTMENT_STEP_NAMES,
  PHASE_STEP_MAP,
  STEP_BADGES,
  STEP_0_SUBSTEPS,
} from "@/hooks/useWholeApartmentPipeline";
```

---

## CHANGE 3: Update Phase Step Map

**Location**: Line ~565-570 (PHASE_STEP_MAP definition)

**BEFORE**:
```typescript
  const PHASE_STEP_MAP: Record<string, number> = {
    upload: 0, space_analysis_pending: 0, space_analysis_running: 0, space_analysis_complete: 0,
    top_down_3d_pending: 1, top_down_3d_running: 1, top_down_3d_review: 1, top_down_3d_approved: 1,
    style_pending: 2, style_running: 2, style_review: 2, style_approved: 2,
    // Updated step numbering: Step 3 = Detect Spaces, Step 4 = Camera Planning
    detect_spaces_pending: 3, detecting_spaces: 3, spaces_detected: 3, // Step 3
    camera_plan_pending: 4, camera_plan_confirmed: 4, // Step 4
    renders_pending: 5, renders_in_progress: 5, renders_review: 5, renders_approved: 5,
    panoramas_pending: 6, panoramas_in_progress: 6, panoramas_review: 6, panoramas_approved: 6,
    merging_pending: 7, merging_in_progress: 7, merging_review: 7,
    completed: 8, failed: -1,
  };
```

**AFTER**:
```typescript
  const PHASE_STEP_MAP: Record<string, number> = {
    upload: 0,
    // Step 0: Split into 0.1 and 0.2
    design_reference_pending: 0, design_reference_running: 0, design_reference_complete: 0, design_reference_failed: 0,
    space_scan_pending: 0, space_scan_running: 0, space_scan_complete: 0, space_scan_review: 0, space_scan_failed: 0,
    // Legacy Step 0 (for migration compatibility)
    space_analysis_pending: 0, space_analysis_running: 0, space_analysis_complete: 0, space_analysis_review: 0, space_analysis_failed: 0,
    top_down_3d_pending: 1, top_down_3d_running: 1, top_down_3d_review: 1, top_down_3d_approved: 1,
    style_pending: 2, style_running: 2, style_review: 2, style_approved: 2,
    // Step 3 (internal legacy): Detect Spaces
    detect_spaces_pending: 3, detecting_spaces: 3, spaces_detected: 3, spaces_detected_waiting_approval: 3,
    // Step 4 (internal, spec Step 3): Camera Intent
    camera_intent_pending: 4, camera_intent_confirmed: 4,
    // Legacy camera_plan phases (for migration compatibility)
    camera_plan_pending: 4, camera_plan_in_progress: 4, camera_plan_confirmed: 4,
    // Step 5: Renders
    renders_pending: 5, renders_in_progress: 5, renders_review: 5, renders_approved: 5,
    // Step 6: Panoramas (Capability Slots - Future/Disabled)
    panoramas_pending: 6, panoramas_in_progress: 6, panoramas_review: 6, panoramas_approved: 6,
    // Step 7: Merge
    merging_pending: 7, merging_in_progress: 7, merging_review: 7,
    completed: 8, failed: -1,
  };
```

---

## CHANGE 4: Add Step 0 State Variables

**Location**: Line ~790-810 (after existing state variable declarations)

**ADD AFTER** existing Step 0 variables (space_analysis_pending, etc.):

```typescript
  // Step 0: Split into 0.1 (Design Reference) and 0.2 (Space Scan)
  const designReferencePending = phase === "design_reference_pending";
  const designReferenceRunning = phase === "design_reference_running";
  const designReferenceComplete = phase === "design_reference_complete";
  const designReferenceFailed = phase === "design_reference_failed";

  const spaceScanPending = phase === "space_scan_pending" || phase === "design_reference_complete";
  const spaceScanRunning = phase === "space_scan_running";
  const spaceScanComplete = phase === "space_scan_complete";
  const spaceScanFailed = phase === "space_scan_failed";

  // Check if design references exist
  const hasDesignReferences = pipeline.design_reference_ids && Array.isArray(pipeline.design_reference_ids) && pipeline.design_reference_ids.length > 0;

  // Completion flags from database
  const designReferenceScanComplete = pipeline.design_reference_scan_complete === true;
  const spaceScanCompleteFlag = pipeline.space_scan_complete === true;
```

---

## CHANGE 5: Update Step 4 State Variables

**Location**: Line ~920-930 (Camera Plan variables)

**BEFORE**:
```typescript
  // Step 4: Camera Planning
  const cameraPlanPending = phase === "camera_plan_pending";
  const cameraPlanConfirmed = phase === "camera_plan_confirmed";
```

**AFTER**:
```typescript
  // Step 4 (internal, spec Step 3): Camera Intent
  const cameraIntentPending = phase === "camera_intent_pending";
  const cameraIntentConfirmed = phase === "camera_intent_confirmed";

  // Legacy camera plan phases (for migration compatibility)
  const cameraPlanPending = phase === "camera_plan_pending" || phase === "camera_intent_pending";
  const cameraPlanConfirmed = phase === "camera_plan_confirmed" || phase === "camera_intent_confirmed";
```

---

## CHANGE 6: Replace Step 0 UI Section

**Location**: Lines ~1154-1233

**FIND THIS ENTIRE SECTION**:
```typescript
        {/* Step 0: Space Analysis */}
        {(spaceAnalysisPending || spaceAnalysisRunning || spaceAnalysisComplete) && (
          <div className="space-y-2">
            <div className={`flex items-center justify-between p-3 rounded-lg border ${spaceAnalysisComplete ? "border-primary/30 bg-primary/5" : "border-border/50 bg-card/50"}`}>
              <div className="flex items-center gap-3">
                <Eye className="w-5 h-5 text-primary" />
                <div>
                  <p className="text-sm font-medium">Space Analysis</p>
                  <p className="text-xs text-muted-foreground">AI pre-analysis • Step 0</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* Stop & Reset button for running analysis */}
                {spaceAnalysisRunning && onRestartStep && (
                  <StopResetStepButton
                    stepNumber={0}
                    stepName="Space Analysis"
                    isRunning={true}
                    isPending={false}
                    onReset={() => onRestartStep(0)}
                    disabled={false}
                    compact
                  />
                )}
                {spaceAnalysisComplete && (
                  <Badge className="bg-primary/20 text-primary">
                    <Check className="w-3 h-3 mr-1" />
                    Done
                  </Badge>
                )}
                {spaceAnalysisRunning && (
                  <Badge className="bg-purple-500/20 text-purple-400">
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                    Analyzing
                  </Badge>
                )}
                {spaceAnalysisPending && !spaceAnalysisRunning && !spaceAnalysisComplete && (
                  <Button size="sm" onClick={onRunSpaceAnalysis} disabled={isRunning}>
                    <Play className="w-4 h-4 mr-1" />
                    Analyze
                  </Button>
                )}
              </div>
            </div>

            {/* Step 0 Controls Footer (Reset only - no rollback for Step 0) */}
            <StepControlsFooter
              stepNumber={0}
              stepName="Space Analysis"
              isRunning={spaceAnalysisRunning}
              isResetPending={isResetPending}
              isRollbackPending={isRollbackPending}
              onReset={(stepNum) => onRestartStep?.(stepNum)}
              disabled={isRunning || approvalLocked}
              hideRollback={true}
            />
          </div>
        )}

        {/* Space Analysis Results Panel */}
        {spaceAnalysis && (
          <SpaceAnalysisPanel
            analysisData={spaceAnalysis}
            isLoading={spaceAnalysisRunning}
          />
        )}

        {/* Space Graph Summary - Shows structured architectural graph */}
        {spaceAnalysisComplete && (
          <SpaceGraphSummary
            spatialMap={spatialMap}
            isLoading={spatialMapLoading}
            error={spatialMapError}
            onRetry={() => runSpatialDecomposition.mutate({
              pipelineId: pipeline.id,
              floorPlanUploadId: pipeline.floor_plan_upload_id
            })}
          />
        )}
```

**REPLACE WITH**:
```typescript
        {/* Step 0: Input Analysis (Split into 0.1 and 0.2) */}

        {/* Step 0.1: Design Reference Scan (OPTIONAL - only if design refs exist) */}
        {hasDesignReferences && (designReferencePending || designReferenceRunning || designReferenceComplete || designReferenceFailed) && (
          <div className="space-y-2">
            <div className={cn(
              "flex items-center justify-between p-3 rounded-lg border",
              designReferenceComplete ? "border-primary/30 bg-primary/5" : "border-border/50 bg-card/50"
            )}>
              <div className="flex items-center gap-3">
                <Eye className="w-5 h-5 text-primary" />
                <div>
                  <p className="text-sm font-medium">Design Reference Scan</p>
                  <p className="text-xs text-muted-foreground">Step 0.1: Analyze style from references</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {designReferenceRunning && onRestartStep && (
                  <StopResetStepButton
                    stepNumber={0}
                    stepName="Design Reference Scan"
                    isRunning={true}
                    isPending={false}
                    onReset={() => onRestartStep(0)}
                    disabled={false}
                    compact
                  />
                )}
                {designReferenceComplete && (
                  <Badge className="bg-primary/20 text-primary">
                    <Check className="w-3 h-3 mr-1" />
                    Done
                  </Badge>
                )}
                {designReferenceRunning && (
                  <Badge className="bg-purple-500/20 text-purple-400">
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                    Analyzing
                  </Badge>
                )}
                {designReferenceFailed && (
                  <Badge variant="destructive">
                    <AlertTriangle className="w-3 h-3 mr-1" />
                    Failed
                  </Badge>
                )}
                {designReferencePending && !designReferenceRunning && (
                  <Button size="sm" onClick={() => {
                    // TODO: Implement run-design-reference-scan trigger
                    toast.toast({
                      title: "Not Yet Implemented",
                      description: "Design Reference Scan handler needs to be connected",
                      variant: "destructive",
                    });
                  }} disabled={isRunning}>
                    <Play className="w-4 h-4 mr-1" />
                    Analyze References
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Step 0.2: Space Scan (REQUIRED - always shown) */}
        {(spaceScanPending || spaceScanRunning || spaceScanComplete || spaceScanFailed || spaceAnalysisPending || spaceAnalysisRunning || spaceAnalysisComplete) && (
          <div className="space-y-2">
            <div className={cn(
              "flex items-center justify-between p-3 rounded-lg border",
              (spaceScanComplete || spaceAnalysisComplete) ? "border-primary/30 bg-primary/5" : "border-border/50 bg-card/50"
            )}>
              <div className="flex items-center gap-3">
                <MapPin className="w-5 h-5 text-primary" />
                <div>
                  <p className="text-sm font-medium">Space Scan</p>
                  <p className="text-xs text-muted-foreground">Step 0.2: Detect rooms and zones</p>
                  {designReferenceComplete && (
                    <p className="text-xs text-green-600 mt-0.5">
                      ✓ Design references analyzed
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {(spaceScanRunning || spaceAnalysisRunning) && onRestartStep && (
                  <StopResetStepButton
                    stepNumber={0}
                    stepName="Space Scan"
                    isRunning={true}
                    isPending={false}
                    onReset={() => onRestartStep(0)}
                    disabled={false}
                    compact
                  />
                )}
                {(spaceScanComplete || spaceAnalysisComplete) && (
                  <Badge className="bg-primary/20 text-primary">
                    <Check className="w-3 h-3 mr-1" />
                    Done
                  </Badge>
                )}
                {(spaceScanRunning || spaceAnalysisRunning) && (
                  <Badge className="bg-purple-500/20 text-purple-400">
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                    Scanning
                  </Badge>
                )}
                {spaceScanFailed && (
                  <Badge variant="destructive">
                    <AlertTriangle className="w-3 h-3 mr-1" />
                    Failed
                  </Badge>
                )}
                {(spaceScanPending || spaceAnalysisPending) && !(spaceScanRunning || spaceAnalysisRunning) && !(spaceScanComplete || spaceAnalysisComplete) && (
                  <Button size="sm" onClick={onRunSpaceAnalysis} disabled={isRunning}>
                    <Play className="w-4 h-4 mr-1" />
                    Scan Spaces
                  </Button>
                )}
              </div>
            </div>

            {/* Step 0 Controls Footer (Reset only - no rollback for Step 0) */}
            <StepControlsFooter
              stepNumber={0}
              stepName="Space Scan"
              isRunning={spaceScanRunning || spaceAnalysisRunning}
              isResetPending={isResetPending}
              isRollbackPending={isRollbackPending}
              onReset={(stepNum) => onRestartStep?.(stepNum)}
              disabled={isRunning || approvalLocked}
              hideRollback={true}
            />
          </div>
        )}

        {/* Space Analysis Results Panel */}
        {spaceAnalysis && (
          <SpaceAnalysisPanel
            analysisData={spaceAnalysis}
            isLoading={spaceScanRunning || spaceAnalysisRunning}
          />
        )}

        {/* Space Graph Summary - Shows structured architectural graph */}
        {(spaceScanComplete || spaceAnalysisComplete) && (
          <SpaceGraphSummary
            spatialMap={spatialMap}
            isLoading={spatialMapLoading}
            error={spatialMapError}
            onRetry={() => runSpatialDecomposition.mutate({
              pipelineId: pipeline.id,
              floorPlanUploadId: pipeline.floor_plan_upload_id
            })}
          />
        )}
```

---

## CHANGE 7: Replace Camera Intent Section (Step 4)

**Location**: Lines ~1739-1751

**FIND**:
```typescript
              {/* Camera Planning Editor Modal - renders as fullscreen overlay */}
              {/* Only allow editing when not committed (renders not started) */}
              {cameraPlanningOpen && step2UploadId && !isCameraCommitted && (
                <CameraPlanningEditor
                  pipelineId={pipeline.id}
                  step2UploadId={step2UploadId}
                  onConfirm={() => {
                    onConfirmCameraPlan();
                    setCameraPlanningOpen(false);
                  }}
                  onClose={() => setCameraPlanningOpen(false)}
                  isConfirming={isConfirmingCameraPlan}
                  disabled={isRunning || approvalLocked}
                  isApproved={isCameraApproved}
                />
              )}
```

**REPLACE WITH**:
```typescript
              {/* Camera Intent Selector Modal - NEW Step 3 UI with Templates A-H */}
              {/* Only allow editing when not committed (renders not started) */}
              {cameraPlanningOpen && step2UploadId && !isCameraCommitted && (
                <Dialog open={cameraPlanningOpen} onOpenChange={setCameraPlanningOpen}>
                  <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>Camera Intent (Step 3)</DialogTitle>
                      <DialogDescription>
                        Select camera templates (A–H) for each space. This is a decision-only layer.
                      </DialogDescription>
                    </DialogHeader>
                    <CameraIntentSelector
                      pipelineId={pipeline.id}
                      spaces={spaces.map(space => ({
                        id: space.id,
                        name: space.name,
                        space_type: space.space_type,
                        adjacentSpaces: [], // TODO: Load from spatial map
                      }))}
                      onConfirm={() => {
                        onConfirmCameraPlan();
                        setCameraPlanningOpen(false);
                      }}
                      isConfirming={isConfirmingCameraPlan}
                      disabled={isRunning || approvalLocked}
                    />
                  </DialogContent>
                </Dialog>
              )}
```

---

## CHANGE 8: Add Step 6 (Capability Slots) Section

**Location**: After Step 5 (Renders) section, before any terminal/completion sections

**ADD THIS NEW SECTION**:

```typescript
        {/* Step 6 (Internal): Capability Slots (Future/Disabled) */}
        {/* This is the OLD manual camera planning feature, now disabled pending MARBLE engine */}
        {step5Done && (
          <div className="space-y-2">
            <div className="p-3 rounded-lg border border-border/30 bg-muted/30 opacity-50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Box className="w-5 h-5 text-muted-foreground" />
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-muted-foreground">Capability Slots</p>
                      <Badge variant="outline" className="text-xs border-muted-foreground/50">
                        Future / Disabled
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Advanced panoramic camera planning (requires engine-class models)
                    </p>
                  </div>
                </div>
                <Button disabled size="sm" variant="ghost">
                  <Settings2 className="w-4 h-4 mr-2" />
                  Coming Soon
                </Button>
              </div>
            </div>
            <Alert className="border-muted-foreground/20">
              <Info className="h-4 w-4" />
              <AlertDescription className="text-xs">
                <strong>What Capability Slots Will Do:</strong> Manual panorama point placement
                for future 360° stitching capabilities. Currently disabled pending MARBLE engine
                integration (Step 6 in spec). The current pipeline uses deterministic Camera Intent
                (Templates A–H) instead.
              </AlertDescription>
            </Alert>
          </div>
        )}
```

---

## TESTING CHECKLIST

After applying this patch:

- [ ] File compiles without TypeScript errors
- [ ] Import statements resolve correctly
- [ ] Step 0 shows as "Input Analysis (0.1 + 0.2)" in progress bar
- [ ] Step 0.1 (Design Reference) only shows if design refs exist
- [ ] Step 0.2 (Space Scan) always shows
- [ ] Step 4 shows "Camera Intent" with "Decision-Only" badge
- [ ] Step 6 shows "Capability Slots" with "Future / Disabled" badge (grayed out)
- [ ] CameraIntentSelector opens when "Define Camera Intent" clicked
- [ ] Legacy pipelines still work (backward compatibility)

---

## ROLLBACK INSTRUCTIONS

If issues occur, revert by:
1. `git checkout HEAD -- src/components/WholeApartmentPipelineCard.tsx`
2. Keep all other files (migrations, edge functions, etc.)
3. UI will show legacy behavior but backend is ready

---

## NOTES

- This patch maintains backward compatibility with legacy phases
- The `TODO` comments indicate where additional handlers need wiring
- The adjacent spaces loading needs implementation in CameraIntentSelector call
- Design Reference Scan button needs proper handler connection
- Space Scan currently uses legacy `onRunSpaceAnalysis` (works during transition)

---

**END OF PATCH**
