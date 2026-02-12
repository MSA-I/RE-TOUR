import { usePipelineContext } from "@/contexts/PipelineContext";
import { StepContainer } from "./StepContainer";
import { getStepStatus } from "./types";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Loader2, CheckCircle2, Image as ImageIcon, ThumbsUp } from "lucide-react";
import { StepControlsFooter } from "@/components/whole-apartment/StepControlsFooter";
import { StageReviewPanel, StageReviewAsset } from "@/components/whole-apartment/StageReviewPanel";
import { supabase } from "@/integrations/supabase/client";

/**
 * Step 6: Outputs + QA
 *
 * Displays generated images from Step 5
 * Includes QA review and approval workflow
 * Once approved, can proceed to Step 7 (Future capabilities)
 */

export function Step6_OutputsQA() {
  const {
    pipeline,
    spaces,
    finalPrompts,
    runBatchOutputs,
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

  const isPending = currentPhase === "outputs_pending";
  const isInProgress = currentPhase === "outputs_in_progress";
  const isReview = currentPhase === "outputs_review";
  const isComplete = pipeline.current_step >= 7;

  const canRun = isPending && !isInProgress;

  const handleRunOutputs = async () => {
    try {
      await runBatchOutputs();
      toast({
        title: "Output Generation Started",
        description: "Generating images for all spaces...",
      });
    } catch (error) {
      console.error("Failed to start output generation:", error);
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
        title: "Outputs Approved",
        description: "All outputs have been approved.",
      });
    } catch (error) {
      console.error("Failed to approve outputs:", error);
      toast({
        title: "Approval Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
    }
  };

  const handleApproveSpace = async (spaceId: string) => {
    try {
      const prompt = finalPrompts.find(p => p.space_id === spaceId);
      if (!prompt) return;

      const { data: { user } } = await supabase.auth.getUser();

      await supabase
        .from('final_prompts')
        .update({
          locked_approved: true,
          approved_at: new Date().toISOString(),
          approved_by: user?.id
        })
        .eq('id', prompt.id);

      toast({
        title: "Space Output Approved",
        description: `${getSpaceName(spaceId)} has been approved.`,
      });
    } catch (error) {
      console.error("Failed to approve space:", error);
      toast({
        title: "Approval Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
    }
  };

  const handleRejectSpace = async (spaceId: string, notes: string) => {
    try {
      const prompt = finalPrompts.find(p => p.space_id === spaceId);
      if (!prompt) return;

      // TODO: Implement retry logic
      toast({
        title: "Space Output Rejected",
        description: `${getSpaceName(spaceId)} will be regenerated.`,
        variant: "destructive"
      });
    } catch (error) {
      console.error("Failed to reject space:", error);
    }
  };

  // Get space name
  const getSpaceName = (spaceId: string) => {
    const space = spaces.find(s => s.id === spaceId);
    return space?.name || "Unknown Space";
  };

  // Get prompts with status
  const completedPrompts = finalPrompts.filter(p => p.status === "complete");
  const generatingPrompts = finalPrompts.filter(p => p.status === "generating");
  const failedPrompts = finalPrompts.filter(p => p.status === "failed");

  // Build asset objects for StageReviewPanel (only for completed prompts with outputs)
  const spaceAssets: Array<{ spaceId: string; spaceName: string; asset: StageReviewAsset }> =
    completedPrompts
      .filter(p => p.output_upload_ids && p.output_upload_ids.length > 0)
      .map(prompt => {
        const space = spaces.find(s => s.id === prompt.space_id);
        return {
          spaceId: prompt.space_id,
          spaceName: space?.name || "Unknown Space",
          asset: {
            id: `step6-${prompt.id}`,
            uploadId: prompt.output_upload_ids![0], // First output as main
            status: prompt.locked_approved ? "approved"
                  : isReview ? "needs_review"
                  : "pending",
            qaStatus: prompt.qa_status,
            qaReport: prompt.qa_report,
            lockedApproved: prompt.locked_approved || false,
            promptText: prompt.final_composed_prompt,
          }
        };
      });

  // Get Step 2 output for "before" image (styled plan)
  const stepOutputs = (pipeline.step_outputs || {}) as Record<string, any>;
  const step2Output = stepOutputs["step2"] || stepOutputs["2"];
  const step2UploadId = step2Output?.upload_id || step2Output?.output_upload_id;

  return (
    <StepContainer
      stepNumber="5"
      stepName="Outputs + QA"
      status={status}
      description="Generate and review final images for all spaces"
    >
      <div className="space-y-4">
        {/* Status Messages */}
        {isPending && (
          <Alert>
            <AlertDescription>
              Ready to generate final images based on your confirmed prompts.
            </AlertDescription>
          </Alert>
        )}

        {isInProgress && (
          <Alert>
            <Loader2 className="h-4 w-4 animate-spin" />
            <AlertDescription>
              Generating images... This may take several minutes depending on the number of spaces.
              <div className="mt-2 text-xs">
                Progress: {completedPrompts.length} / {finalPrompts.length} completed
              </div>
            </AlertDescription>
          </Alert>
        )}

        {isReview && (
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertDescription>
              All images generated! Review the outputs below and approve to continue.
            </AlertDescription>
          </Alert>
        )}

        {isComplete && (
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertDescription>
              All outputs approved and locked.
            </AlertDescription>
          </Alert>
        )}

        {/* Progress Summary */}
        {(isInProgress || isReview) && finalPrompts.length > 0 && (
          <div className="grid grid-cols-3 gap-3">
            <Card className="p-3">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Completed</p>
                <p className="text-2xl font-semibold text-green-600">{completedPrompts.length}</p>
              </div>
            </Card>
            <Card className="p-3">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Generating</p>
                <p className="text-2xl font-semibold text-blue-600">{generatingPrompts.length}</p>
              </div>
            </Card>
            <Card className="p-3">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Failed</p>
                <p className="text-2xl font-semibold text-red-600">{failedPrompts.length}</p>
              </div>
            </Card>
          </div>
        )}

        {/* Per-Space Output Display with StageReviewPanel */}
        {spaceAssets.length > 0 && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Generated Outputs by Space:</p>
              <Badge variant="outline">
                {spaceAssets.filter(s => s.asset.lockedApproved).length} / {spaceAssets.length} Approved
              </Badge>
            </div>

            {spaceAssets.map(({ spaceId, spaceName, asset }) => {
              const space = spaces.find(s => s.id === spaceId);
              return (
                <StageReviewPanel
                  key={asset.id}
                  title={`${spaceName}${space?.class ? ` (${space.class})` : ''}`}
                  stepNumber={6}
                  currentStep={pipeline.current_step || 0}
                  beforeUploadId={step2UploadId || null}
                  beforeLabel="Base Plan (Styled)"
                  afterAsset={asset}
                  afterLabel="Generated Output"
                  onApprove={() => handleApproveSpace(spaceId)}
                  onReject={(notes) => handleRejectSpace(spaceId, notes)}
                  isLoading={isInProgress}
                  bucket="outputs"
                  pipelineId={pipeline.id}
                  pipeline={pipeline}
                />
              );
            })}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center justify-between pt-2 border-t">
          {isPending && (
            <Button
              onClick={handleRunOutputs}
              disabled={!canRun || isInProgress}
              className="gap-2"
            >
              {isInProgress ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <ImageIcon className="w-4 h-4" />
                  Generate All Images
                </>
              )}
            </Button>
          )}

          {isReview && spaceAssets.length > 0 && (
            <div className="flex flex-col gap-2 ml-auto">
              <Button
                onClick={handleApprove}
                disabled={spaceAssets.some(s => !s.asset.lockedApproved)}
                className="gap-2"
              >
                <ThumbsUp className="w-4 h-4" />
                Approve All Spaces ({spaceAssets.length})
              </Button>
              {spaceAssets.some(s => !s.asset.lockedApproved) && (
                <p className="text-xs text-muted-foreground text-center">
                  All spaces must be approved individually first
                </p>
              )}
            </div>
          )}

          {isInProgress && (
            <p className="text-sm text-muted-foreground">
              Generating {finalPrompts.length} outputs...
            </p>
          )}
        </div>

        {/* Reset/Rollback Buttons */}
        <StepControlsFooter
          stepNumber={6}
          stepName="Outputs + QA"
          isRunning={isInProgress}
          isResetPending={isResetPending}
          isRollbackPending={isRollbackPending}
          onReset={(stepNum) => restartStep(stepNum)}
          onRollback={(stepNum) => rollbackToPreviousStep(stepNum)}
        />
      </div>
    </StepContainer>
  );
}
