import { usePipelineContext } from "@/contexts/PipelineContext";
import { StepContainer } from "./StepContainer";
import { getStepStatus } from "./types";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Loader2, Play, CheckCircle2, ThumbsUp, Palette } from "lucide-react";
import { StepControlsFooter } from "@/components/whole-apartment/StepControlsFooter";
import { StageReviewPanel, StageReviewAsset } from "@/components/whole-apartment/StageReviewPanel";

/**
 * Step 2: Style Application
 *
 * Applies style reference to the 2D plan
 * Includes review and approval workflow
 */

export function Step2_StyleApplication() {
  const {
    pipeline,
    runStyleTopDown,
    continueToStep,
    imagePreviews,
    toast,
    isResetPending,
    isRollbackPending,
    restartStep,
    rollbackToPreviousStep,
  } = usePipelineContext();

  const currentPhase = pipeline.whole_apartment_phase;
  const status = getStepStatus(currentPhase);

  const isPending = currentPhase === "style_pending" || (currentPhase === "top_down_3d_review" && pipeline.current_step === 1);
  const isRunning = currentPhase === "style_running";
  const isReview = currentPhase === "style_review";
  const isComplete = pipeline.current_step >= 3;

  // Get step output
  const stepOutputs = (pipeline.step_outputs || {}) as Record<string, any>;
  const step2Output = stepOutputs["step2"] || stepOutputs["2"];
  const outputUploadId = step2Output?.upload_id || step2Output?.output_upload_id;
  const qaStatus = step2Output?.qa_status || step2Output?.qa_decision;

  const canRun = isPending && !isRunning;

  const handleRun = async () => {
    try {
      await runStyleTopDown();
      toast({
        title: "Style Application Started",
        description: "Applying style to 2D floor plan...",
      });
    } catch (error) {
      console.error("Failed to start style application:", error);
      toast({
        title: "Style Application Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
    }
  };

  const handleApprove = async () => {
    try {
      await continueToStep({ from_phase: currentPhase });
      toast({
        title: "Style Approved",
        description: "Proceeding to Space Scan...",
      });
    } catch (error) {
      console.error("Failed to approve style:", error);
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
        title: "Style Rejected",
        description: "This will trigger a retry...",
        variant: "destructive"
      });
      // Note: Rejection/retry logic handled by backend
    } catch (error) {
      console.error("Failed to reject style:", error);
    }
  };

  const previewUrl = outputUploadId ? imagePreviews[outputUploadId] : null;
  const step2ManualApproved = !!step2Output?.manual_approved;

  // Get Step 1 output for "before" image (unstyled plan)
  const step1Output = stepOutputs["step1"] || stepOutputs["1"];
  const step1UploadId = step1Output?.upload_id || step1Output?.output_upload_id;
  const step1ManualApproved = !!step1Output?.manual_approved;

  // Build asset object for StageReviewPanel
  const step2Asset: StageReviewAsset | null = outputUploadId ? {
    id: `step2-${pipeline.id}`,
    uploadId: outputUploadId,
    status: isReview ? "needs_review" : isComplete ? "approved" : "pending",
    qaStatus: step2Output?.qa_status || step2Output?.qa_decision,
    qaReport: step2Output?.qa_report || null,
    lockedApproved: step2ManualApproved || isComplete,
    promptText: step2Output?.prompt_text || step2Output?.prompt_used,
  } : null;

  return (
    <StepContainer
      stepNumber="2"
      stepName="Style Application"
      status={status}
      description="Apply style reference to the 2D floor plan"
    >
      <div className="space-y-4">
        {/* Status Messages */}
        {isPending && !isRunning && (
          <Alert>
            <AlertDescription>
              Ready to apply your style reference to the 2D floor plan.
            </AlertDescription>
          </Alert>
        )}

        {isReview && (
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertDescription>
              Style applied! Review the output below and approve to continue.
            </AlertDescription>
          </Alert>
        )}

        {isComplete && (
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertDescription>
              Styled plan approved and locked.
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
                  Applying Style...
                </>
              ) : (
                <>
                  <Palette className="w-4 h-4" />
                  Apply Style
                </>
              )}
            </Button>
          </div>
        )}

        {/* Output Display with QA and Approval - StageReviewPanel */}
        {step2Asset && (
          <StageReviewPanel
            title="Style Top-Down"
            stepNumber={2}
            currentStep={pipeline.current_step || 0}
            beforeUploadId={step1ManualApproved ? step1UploadId : null}
            beforeLabel="Unstyled"
            afterAsset={step2Asset}
            afterLabel="Styled"
            onApprove={handleApprove}
            onReject={handleReject}
            isLoading={isRunning}
            bucket="outputs"
            pipelineId={pipeline.id}
            pipeline={pipeline}
          />
        )}

        {/* Reset/Rollback Buttons */}
        <StepControlsFooter
          stepNumber={2}
          stepName="Style Application"
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
