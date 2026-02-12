import { usePipelineContext } from "@/contexts/PipelineContext";
import { StepContainer } from "./StepContainer";
import { getStepStatus } from "./types";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Loader2, Play, CheckCircle2, MapPin, Box } from "lucide-react";
import { StepControlsFooter } from "@/components/whole-apartment/StepControlsFooter";

/**
 * Step 3: Space Scan
 *
 * Detects individual spaces (rooms/zones) from the styled floor plan
 * This is an internal step that prepares for camera intent selection
 */

export function Step3_SpaceScan() {
  const {
    pipeline,
    spaces,
    runDetectSpaces,
    continueToStep,
    toast,
    isResetPending,
    isRollbackPending,
    restartStep,
    rollbackToPreviousStep,
  } = usePipelineContext();

  const currentPhase = pipeline.whole_apartment_phase;
  const status = getStepStatus(currentPhase);

  const isPending = currentPhase === "detect_spaces_pending" || currentPhase === "style_review";
  const isRunning = currentPhase === "detecting_spaces";
  const isComplete = currentPhase === "spaces_detected" || pipeline.current_step >= 4;

  const canRun = isPending && !isRunning;

  const handleRun = async () => {
    try {
      await runDetectSpaces();
      toast({
        title: "Space Detection Started",
        description: "Analyzing floor plan to detect individual spaces...",
      });
    } catch (error) {
      console.error("Failed to start space detection:", error);
      toast({
        title: "Detection Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
    }
  };

  const handleContinue = async () => {
    try {
      await continueToStep({ from_phase: currentPhase });
      toast({
        title: "Spaces Confirmed",
        description: "Proceeding to Camera Intent selection...",
      });
    } catch (error) {
      console.error("Failed to continue:", error);
      toast({
        title: "Continue Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
    }
  };

  // Group spaces by class
  const rooms = spaces.filter(s => s.space_class === "room");
  const zones = spaces.filter(s => s.space_class === "zone");

  return (
    <StepContainer
      stepNumber="3"
      stepName="Space Scan"
      status={status}
      description="Detect individual rooms and zones from floor plan"
    >
      <div className="space-y-4">
        {/* Status Messages */}
        {isPending && !isRunning && (
          <Alert>
            <AlertDescription>
              Ready to scan the floor plan and detect individual spaces.
            </AlertDescription>
          </Alert>
        )}

        {isComplete && spaces.length > 0 && (
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertDescription>
              Detected {rooms.length} rooms and {zones.length} zones.
            </AlertDescription>
          </Alert>
        )}

        {/* Detected Spaces List */}
        {isComplete && spaces.length > 0 && (
          <div className="space-y-3">
            <p className="text-sm font-medium">Detected Spaces:</p>
            <div className="grid gap-2">
              {rooms.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">Rooms:</p>
                  {rooms.map((space) => (
                    <Card key={space.id} className="p-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Box className="w-4 h-4 text-primary" />
                          <span className="text-sm font-medium">{space.name}</span>
                        </div>
                        <Badge variant="secondary" className="text-xs">
                          {space.inferred_usage || "Room"}
                        </Badge>
                      </div>
                    </Card>
                  ))}
                </div>
              )}

              {zones.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">Zones:</p>
                  {zones.map((space) => (
                    <Card key={space.id} className="p-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <MapPin className="w-4 h-4 text-muted-foreground" />
                          <span className="text-sm">{space.name}</span>
                        </div>
                        <Badge variant="outline" className="text-xs">
                          Zone
                        </Badge>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center justify-between pt-2 border-t">
          {isPending && (
            <Button
              onClick={handleRun}
              disabled={!canRun || isRunning}
              className="gap-2"
            >
              {isRunning ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Detecting Spaces...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  Detect Spaces
                </>
              )}
            </Button>
          )}

          {isComplete && spaces.length > 0 && (
            <Button
              onClick={handleContinue}
              className="gap-2 ml-auto"
            >
              Continue to Camera Intent
            </Button>
          )}

          {isRunning && (
            <p className="text-sm text-muted-foreground">
              This may take 30-60 seconds...
            </p>
          )}
        </div>

        {/* Reset/Rollback Buttons */}
        <StepControlsFooter
          stepNumber={3}
          stepName="Space Scan"
          isRunning={isRunning}
          isResetPending={isResetPending}
          isRollbackPending={isRollbackPending}
          onReset={(stepNum) => restartStep(stepNum)}
          onRollback={(stepNum) => rollbackToPreviousStep(stepNum)}
        />
      </div>
    </StepContainer>
  );
}
