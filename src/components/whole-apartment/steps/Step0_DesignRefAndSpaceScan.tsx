import { usePipelineContext } from "@/contexts/PipelineContext";
import { StepContainer } from "./StepContainer";
import { getStepStatus } from "./types";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Play, CheckCircle2 } from "lucide-react";
import { StepControlsFooter } from "@/components/whole-apartment/StepControlsFooter";

/**
 * Step 0: Input Analysis
 *
 * Initial floor plan analysis and preparation
 * Note: Actual space detection happens in Step 3 (Space Scan)
 */

export function Step0_DesignRefAndSpaceScan() {
  const {
    pipeline,
    spaces,
    runSpaceAnalysis,
    isLoadingSpaces,
    isResetPending,
    isRollbackPending,
    restartStep,
    toast
  } = usePipelineContext();

  const currentPhase = pipeline.whole_apartment_phase;
  const status = getStepStatus(currentPhase);

  const isUpload = currentPhase === "upload";
  const isAnalysisPending = currentPhase === "space_analysis_pending";
  const isAnalysisRunning = currentPhase === "space_analysis_running";
  const isAnalysisComplete = currentPhase === "space_analysis_complete" || pipeline.current_step >= 1;

  const canRun = isUpload || isAnalysisPending;

  const handleRunAnalysis = async () => {
    try {
      await runSpaceAnalysis();
      toast({
        title: "Floor Plan Analysis Started",
        description: "Analyzing floor plan layout and structure...",
      });
    } catch (error) {
      console.error("Failed to start floor plan analysis:", error);
      toast({
        title: "Analysis Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
    }
  };

  return (
    <StepContainer
      stepNumber="0"
      stepName="Input Analysis"
      status={status}
      description="Upload floor plan and analyze spaces"
    >
      <div className="space-y-4">
        {/* Status Message */}
        {isUpload && (
          <Alert>
            <AlertDescription>
              Upload a floor plan image to begin. Once uploaded, run the initial analysis to prepare for 2D plan generation.
            </AlertDescription>
          </Alert>
        )}

        {isAnalysisComplete && (
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertDescription>
              Floor plan analysis complete. Ready for 2D plan generation.
            </AlertDescription>
          </Alert>
        )}

        {/* Action Button */}
        <div className="flex items-center justify-between pt-2">
          {isAnalysisComplete ? (
            <p className="text-sm text-muted-foreground">
              Analysis complete - ready for Step 1
            </p>
          ) : (
            <div className="flex items-center gap-3 w-full">
              <Button
                onClick={handleRunAnalysis}
                disabled={!canRun || isAnalysisRunning || isLoadingSpaces}
                className="gap-2"
              >
                {isAnalysisRunning ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4" />
                    Run Floor Plan Analysis
                  </>
                )}
              </Button>

              {isAnalysisRunning && (
                <p className="text-sm text-muted-foreground">
                  This may take 1-2 minutes...
                </p>
              )}
            </div>
          )}
        </div>

        {/* Reset Button */}
        <StepControlsFooter
          stepNumber={0}
          stepName="Input Analysis"
          isRunning={isAnalysisRunning}
          isResetPending={isResetPending}
          isRollbackPending={isRollbackPending}
          onReset={(stepNum) => restartStep(stepNum)}
          hideRollback={true}
        />
      </div>
    </StepContainer>
  );
}
