import { useState, useEffect } from "react";
import { usePipelineContext } from "@/contexts/PipelineContext";
import { StepContainer } from "./StepContainer";
import { getStepStatus } from "./types";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, Camera, AlertCircle } from "lucide-react";
import { StepControlsFooter } from "@/components/whole-apartment/StepControlsFooter";

/**
 * Step 4: Camera Intent (Decision-Only)
 *
 * User selects camera intent suggestions for each space
 * This is a decision-only step - no rendering happens here
 * After confirmation, moves to Step 5 (Prompt Templates)
 */

export function Step4_CameraIntent() {
  const {
    pipeline,
    spaces,
    cameraIntents,
    refetchCameraIntents,
    saveCameraIntents,
    toast,
    isResetPending,
    isRollbackPending,
    restartStep,
    rollbackToPreviousStep,
  } = usePipelineContext();

  const [selectedIntentIds, setSelectedIntentIds] = useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState(false);

  const currentPhase = pipeline.whole_apartment_phase;
  const status = getStepStatus(currentPhase);

  const isPending = currentPhase === "camera_intent_pending";
  const isConfirmed = currentPhase === "camera_intent_confirmed" || pipeline.current_step >= 5;

  // Load existing selections
  useEffect(() => {
    if (isPending || isConfirmed) {
      refetchCameraIntents();
    }
  }, [isPending, isConfirmed, refetchCameraIntents]);

  // Initialize selected intents from existing data
  useEffect(() => {
    const selected = cameraIntents.filter(i => i.is_selected).map(i => i.id);
    setSelectedIntentIds(new Set(selected));
  }, [cameraIntents]);

  const handleToggleIntent = (intentId: string) => {
    setSelectedIntentIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(intentId)) {
        newSet.delete(intentId);
      } else {
        newSet.add(intentId);
      }
      return newSet;
    });
  };

  const handleSelectAll = () => {
    setSelectedIntentIds(new Set(cameraIntents.map(i => i.id)));
  };

  const handleDeselectAll = () => {
    setSelectedIntentIds(new Set());
  };

  const handleConfirm = async () => {
    if (selectedIntentIds.size === 0) {
      toast({
        title: "No Intents Selected",
        description: "Please select at least one camera intent before confirming.",
        variant: "destructive"
      });
      return;
    }

    setIsSaving(true);
    try {
      await saveCameraIntents(Array.from(selectedIntentIds));
      toast({
        title: "Camera Intents Confirmed",
        description: `Selected ${selectedIntentIds.size} camera intents. Proceeding to prompt generation...`,
      });
    } catch (error) {
      console.error("Failed to save camera intents:", error);
      toast({
        title: "Save Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Group intents by space
  const intentsBySpace = cameraIntents.reduce((acc, intent) => {
    const spaceId = intent.space_id;
    if (!acc[spaceId]) acc[spaceId] = [];
    acc[spaceId].push(intent);
    return acc;
  }, {} as Record<string, typeof cameraIntents>);

  return (
    <StepContainer
      stepNumber="3"
      stepName="Camera Intent (Decision-Only)"
      status={status}
      description="Select camera angles for each space"
    >
      <div className="space-y-4">
        {/* Status Messages */}
        {isPending && cameraIntents.length === 0 && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              No camera intent suggestions found. Please complete Space Scan (Step 3) first.
            </AlertDescription>
          </Alert>
        )}

        {isPending && cameraIntents.length > 0 && (
          <Alert>
            <AlertDescription>
              Select the camera angles you want to use for each space. You can select multiple angles per space.
            </AlertDescription>
          </Alert>
        )}

        {isConfirmed && (
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertDescription>
              Camera intents confirmed. Selected {selectedIntentIds.size} angles across {Object.keys(intentsBySpace).length} spaces.
            </AlertDescription>
          </Alert>
        )}

        {/* Selection Controls */}
        {isPending && cameraIntents.length > 0 && (
          <div className="flex items-center gap-2" role="toolbar" aria-label="Selection controls">
            <Button
              size="sm"
              variant="outline"
              onClick={handleSelectAll}
              aria-label={`Select all ${cameraIntents.length} camera intents`}
              className="min-h-[44px] min-w-[44px]"
            >
              Select All
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleDeselectAll}
              aria-label="Deselect all camera intents"
              className="min-h-[44px] min-w-[44px]"
            >
              Deselect All
            </Button>
            <div
              className="ml-auto text-sm text-muted-foreground"
              aria-live="polite"
              aria-atomic="true"
            >
              {selectedIntentIds.size} selected
            </div>
          </div>
        )}

        {/* Camera Intents by Space */}
        {cameraIntents.length > 0 && (
          <div className="space-y-4">
            {Object.entries(intentsBySpace).map(([spaceId, intents]) => {
              const space = spaces.find(s => s.id === spaceId);
              const spaceName = space?.name || intents[0]?.space_name || "Unknown Space";

              return (
                <Card key={spaceId} className="p-4">
                  <div className="space-y-3">
                    {/* Space Header */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Camera className="w-4 h-4 text-primary" />
                        <p className="font-medium">{spaceName}</p>
                      </div>
                      <Badge variant="secondary" className="text-xs">
                        {intents[0]?.space_size_category || "normal"}
                      </Badge>
                    </div>

                    {/* Intent Options */}
                    <div className="space-y-2" role="group" aria-label={`Camera intents for ${spaceName}`}>
                      {intents.map((intent, index) => (
                        <label
                          key={intent.id}
                          htmlFor={`intent-${intent.id}`}
                          className="flex items-start gap-3 p-2 rounded hover:bg-muted/50 cursor-pointer min-h-[44px]"
                        >
                          <Checkbox
                            id={`intent-${intent.id}`}
                            checked={selectedIntentIds.has(intent.id)}
                            onCheckedChange={() => handleToggleIntent(intent.id)}
                            disabled={isConfirmed}
                            className="mt-0.5 min-h-[24px] min-w-[24px]"
                            aria-label={`${intent.suggestion_text}${intent.is_selected ? " (previously selected)" : ""}`}
                            aria-describedby={`intent-${intent.id}-desc`}
                          />
                          <div className="flex-1">
                            <p
                              id={`intent-${intent.id}-desc`}
                              className="text-sm"
                            >
                              {intent.suggestion_text}
                            </p>
                            {intent.is_selected && (
                              <Badge variant="outline" className="text-xs mt-1">
                                Previously selected
                              </Badge>
                            )}
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        {/* Confirm Button */}
        {isPending && cameraIntents.length > 0 && (
          <div className="flex items-center justify-between pt-4 border-t">
            <p
              className="text-sm text-muted-foreground"
              aria-live="polite"
              aria-atomic="true"
            >
              {selectedIntentIds.size} camera {selectedIntentIds.size === 1 ? "angle" : "angles"} selected
            </p>
            <Button
              onClick={handleConfirm}
              disabled={isSaving || selectedIntentIds.size === 0}
              className="gap-2 min-h-[44px]"
              aria-busy={isSaving}
              aria-disabled={isSaving || selectedIntentIds.size === 0}
              aria-label={`Confirm ${selectedIntentIds.size} selected camera intents`}
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  Confirming...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                  Confirm Selection
                </>
              )}
            </Button>
          </div>
        )}

        {/* Reset/Rollback Buttons */}
        <StepControlsFooter
          stepNumber={4}
          stepName="Camera Intent"
          isRunning={isSaving}
          isResetPending={isResetPending}
          isRollbackPending={isRollbackPending}
          onReset={(stepNum) => restartStep(stepNum)}
          onRollback={(stepNum) => rollbackToPreviousStep(stepNum)}
        />
      </div>
    </StepContainer>
  );
}
