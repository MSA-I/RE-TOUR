import { usePipelineContext } from "@/contexts/PipelineContext";
import { StepContainer } from "./StepContainer";
import { getStepStatus } from "./types";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Loader2, Play, Eye, CheckCircle2, ThumbsUp, ThumbsDown } from "lucide-react";
import { StepControlsFooter } from "@/components/whole-apartment/StepControlsFooter";
import { StageReviewPanel, StageReviewAsset } from "@/components/whole-apartment/StageReviewPanel";

/**
 * Step 1: Realistic 2D Plan
 *
 * Generates a realistic 2D floor plan from the input sketch
 * Includes review and approval workflow
 */

export function Step1_RealisticPlan() {
  const {
    pipeline,
    runTopDown3D,
    continueToStep,
    imagePreviews,
    isResetPending,
    isRollbackPending,
    restartStep,
    rollbackToPreviousStep,
    toast
  } = usePipelineContext();

  const currentPhase = pipeline.whole_apartment_phase;
  const status = getStepStatus(currentPhase);

  const isPending = currentPhase === "top_down_3d_pending" || currentPhase === "space_analysis_complete";
  const isRunning = currentPhase === "top_down_3d_running";
  const isReview = currentPhase === "top_down_3d_review";
  const isComplete = pipeline.current_step >= 2;

  // Get step output
  const stepOutputs = (pipeline.step_outputs || {}) as Record<string, any>;
  const step1Output = stepOutputs["step1"] || stepOutputs["1"];
  const outputUploadId = step1Output?.upload_id || step1Output?.output_upload_id;
  const qaStatus = step1Output?.qa_status || step1Output?.qa_decision;

  const canRun = isPending && !isRunning;

  const handleRun = async () => {
    try {
      await runTopDown3D();
      toast({
        title: "2D Plan Generation Started",
        description: "Creating realistic 2D floor plan...",
      });
    } catch (error) {
      console.error("Failed to start 2D plan generation:", error);
      toast({
        title: "Generation Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
    }
  };

  const handleApprove = async () => {
    try {
      await continueToStep({ from_phase: currentPhase });
      toast({
        title: "Plan Approved",
        description: "Proceeding to Style Application...",
      });
    } catch (error) {
      console.error("Failed to approve plan:", error);
      toast({
        title: "Approval Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
    }
  };

  const handleReject = async (notes: string) => {
    try {
      toast({
        title: "Plan Rejected",
        description: "This will trigger a retry...",
        variant: "destructive"
      });
      // Note: Rejection/retry logic handled by backend
    } catch (error) {
      console.error("Failed to reject plan:", error);
    }
  };

  const previewUrl = outputUploadId ? imagePreviews[outputUploadId] : null;
  const step1ManualApproved = !!step1Output?.manual_approved;

  // Build asset object for StageReviewPanel
  const step1Asset: StageReviewAsset | null = outputUploadId ? {
    id: `step1-${pipeline.id}`,
    uploadId: outputUploadId,
    status: isReview ? "needs_review" : isComplete ? "approved" : "pending",
    qaStatus: step1Output?.qa_status || step1Output?.qa_decision,
    qaReport: step1Output?.qa_report || null,
    lockedApproved: step1ManualApproved || isComplete,
    promptText: step1Output?.prompt_text || step1Output?.prompt_used,
  } : null;

  return (
    <StepContainer
      stepNumber="1"
      stepName="Realistic 2D Plan"
      status={status}
      description="Generate a realistic 2D floor plan from your sketch"
    >
      <div className="space-y-4">
        {/* Status Messages */}
        {isPending && !isRunning && (
          <Alert>
            <AlertDescription>
              Ready to generate a realistic 2D floor plan from your input sketch.
            </AlertDescription>
          </Alert>
        )}

        {isReview && (
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertDescription>
              Plan generated! Review the output below and approve to continue.
            </AlertDescription>
          </Alert>
        )}

        {isComplete && (
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertDescription>
              2D Plan approved and locked.
            </AlertDescription>
          </Alert>
        )}

        {/* Action Buttons - Run Step */}
        {isPending && (
          <div className="flex items-center justify-between pt-2 border-t">
            <Button
              onClick={handleRun}
              disabled={!canRun || isRunning}
              className="gap-2"
            >
              {isRunning ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  Generate 2D Plan
                </>
              )}
            </Button>
          </div>
        )}

        {/* Output Display with QA and Approval - StageReviewPanel */}
        {step1Asset && (
          <StageReviewPanel
            title="Floor Plan → Top-Down 3D"
            stepNumber={1}
            currentStep={pipeline.current_step || 0}
            beforeUploadId={pipeline.floor_plan_upload_id || null}
            beforeLabel="Original Floor Plan"
            afterAsset={step1Asset}
            afterLabel="2D Plan Output"
            onApprove={handleApprove}
            onReject={handleReject}
            isLoading={isRunning}
            bucket="floor_plans"
            pipelineId={pipeline.id}
            pipeline={pipeline}
          />
        )}

        {/* Reset/Rollback Buttons */}
        <StepControlsFooter
          stepNumber={1}
          stepName="Realistic 2D Plan"
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
