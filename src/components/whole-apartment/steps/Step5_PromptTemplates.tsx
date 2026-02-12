import { useState, useEffect } from "react";
import { usePipelineContext, FinalPrompt } from "@/contexts/PipelineContext";
import { StepContainer } from "./StepContainer";
import { getStepStatus } from "./types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Eye, Wand2, Image as ImageIcon, CheckCircle2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { StepControlsFooter } from "@/components/whole-apartment/StepControlsFooter";

/**
 * Step 5: Prompt Templates + Generation (NEW)
 *
 * Purpose:
 * - Display composed final prompts for each space
 * - Show image count per space
 * - Allow editing prompts (optional)
 * - Trigger NanoBanana generation
 * - Transition to Step 6 (Outputs + QA)
 *
 * Flow:
 * 1. User confirms camera intents in Step 4
 * 2. System generates final prompts (prompt_templates_pending)
 * 3. User reviews/edits prompts here
 * 4. Click "Generate Images" → triggers NanoBanana jobs
 * 5. Transitions to prompt_templates_confirmed → outputs_pending
 */

export function Step5_PromptTemplates() {
  const {
    pipeline,
    spaces,
    finalPrompts,
    refetchFinalPrompts,
    composeFinalPrompts,
    continueToStep,
    isGeneratingPrompts,
    isGeneratingImages,
    toast,
    isResetPending,
    isRollbackPending,
    restartStep,
    rollbackToPreviousStep,
  } = usePipelineContext();

  const [editingPromptId, setEditingPromptId] = useState<string | null>(null);
  const [editedPromptText, setEditedPromptText] = useState("");
  const [previewPromptId, setPreviewPromptId] = useState<string | null>(null);

  const currentPhase = pipeline.whole_apartment_phase;
  const status = getStepStatus(currentPhase);

  // Refetch prompts when phase changes
  useEffect(() => {
    if (currentPhase === "prompt_templates_pending" || currentPhase === "prompt_templates_confirmed") {
      refetchFinalPrompts();
    }
  }, [currentPhase, refetchFinalPrompts]);

  const handleEditPrompt = (prompt: FinalPrompt) => {
    setEditingPromptId(prompt.id);
    setEditedPromptText(prompt.final_composed_prompt);
  };

  const handleSavePromptEdit = async (promptId: string) => {
    // TODO: Implement prompt update mutation
    toast({
      title: "Prompt Updated",
      description: "Changes will be applied when generating images.",
    });
    setEditingPromptId(null);
  };

  const handleGenerateImages = async () => {
    try {
      // Get all selected camera intent IDs from final prompts
      const intentIds = finalPrompts.flatMap(p => p.source_camera_intent_ids);

      await composeFinalPrompts(intentIds);

      toast({
        title: "Image Generation Started",
        description: "NanoBanana jobs have been queued for all spaces.",
      });

      // Transition to outputs_pending
      await continueToStep({ from_phase: currentPhase });
    } catch (error) {
      console.error("Failed to start image generation:", error);
      toast({
        title: "Generation Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
    }
  };

  const isReady = currentPhase === "prompt_templates_pending";
  const isConfirmed = currentPhase === "prompt_templates_confirmed";

  // Get space name for a prompt
  const getSpaceName = (spaceId: string) => {
    const space = spaces.find(s => s.id === spaceId);
    return space?.name || "Unknown Space";
  };

  return (
    <StepContainer
      stepNumber="4"
      stepName="Prompt Templates + Generation"
      status={status}
      description="Review and edit final prompts before generating images"
    >
      <div className="space-y-4">
        {/* Status Alert */}
        {isReady && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Review the composed prompts below. You can edit them if needed, then click "Generate Images" to start production.
            </AlertDescription>
          </Alert>
        )}

        {isConfirmed && (
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertDescription>
              Prompts confirmed. Images are being generated in Step 6 (Outputs + QA).
            </AlertDescription>
          </Alert>
        )}

        {/* Loading State */}
        {(isGeneratingPrompts || isGeneratingImages) && (
          <div className="flex items-center justify-center py-12 gap-3">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              {isGeneratingPrompts ? "Composing prompts..." : "Starting image generation..."}
            </p>
          </div>
        )}

        {/* Prompts List */}
        {!isGeneratingPrompts && !isGeneratingImages && finalPrompts.length === 0 && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              No prompts found. Please complete Step 4 (Camera Intent) first.
            </AlertDescription>
          </Alert>
        )}

        {!isGeneratingPrompts && !isGeneratingImages && finalPrompts.length > 0 && (
          <div className="grid gap-3">
            {finalPrompts.map((prompt) => {
              const isEditing = editingPromptId === prompt.id;
              const isPreviewing = previewPromptId === prompt.id;

              return (
                <Card key={prompt.id} className="p-4">
                  <div className="space-y-3">
                    {/* Header */}
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <h4 className="font-medium">{getSpaceName(prompt.space_id)}</h4>
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="gap-1">
                            <ImageIcon className="w-3 h-3" />
                            {prompt.image_count} {prompt.image_count === 1 ? "image" : "images"}
                          </Badge>
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-xs",
                              prompt.status === "queued" && "bg-blue-500/10 text-blue-500",
                              prompt.status === "generating" && "bg-yellow-500/10 text-yellow-500",
                              prompt.status === "complete" && "bg-green-500/10 text-green-500",
                              prompt.status === "failed" && "bg-red-500/10 text-red-500"
                            )}
                          >
                            {prompt.status}
                          </Badge>
                        </div>
                      </div>

                      <div className="flex gap-2">
                        {!isEditing && (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setPreviewPromptId(isPreviewing ? null : prompt.id)}
                            >
                              <Eye className="w-4 h-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleEditPrompt(prompt)}
                              disabled={isConfirmed}
                            >
                              <Wand2 className="w-4 h-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Prompt Display/Edit */}
                    {isEditing ? (
                      <div className="space-y-2">
                        <Textarea
                          value={editedPromptText}
                          onChange={(e) => setEditedPromptText(e.target.value)}
                          rows={4}
                          className="font-mono text-sm"
                          placeholder="Edit prompt..."
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => handleSavePromptEdit(prompt.id)}
                          >
                            Save Changes
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditingPromptId(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : isPreviewing ? (
                      <div className="space-y-2">
                        <div className="text-xs text-muted-foreground">Template:</div>
                        <p className="text-sm font-mono bg-muted p-2 rounded">
                          {prompt.prompt_template}
                        </p>
                        <div className="text-xs text-muted-foreground">Final Prompt:</div>
                        <p className="text-sm font-mono bg-muted p-2 rounded">
                          {prompt.final_composed_prompt}
                        </p>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {prompt.final_composed_prompt}
                      </p>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        {/* Generate Button */}
        {isReady && finalPrompts.length > 0 && (
          <div className="flex items-center justify-between pt-4 border-t">
            <p className="text-sm text-muted-foreground">
              {finalPrompts.length} {finalPrompts.length === 1 ? "prompt" : "prompts"} ready •{" "}
              {finalPrompts.reduce((sum, p) => sum + p.image_count, 0)} total images
            </p>
            <Button
              onClick={handleGenerateImages}
              disabled={isGeneratingImages}
              className="gap-2"
            >
              {isGeneratingImages ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Starting...
                </>
              ) : (
                <>
                  <ImageIcon className="w-4 h-4" />
                  Generate Images
                </>
              )}
            </Button>
          </div>
        )}

        {/* Reset/Rollback Buttons */}
        <StepControlsFooter
          stepNumber={5}
          stepName="Prompt Templates"
          isRunning={isGeneratingPrompts || isGeneratingImages}
          isResetPending={isResetPending}
          isRollbackPending={isRollbackPending}
          onReset={(stepNum) => restartStep(stepNum)}
          onRollback={(stepNum) => rollbackToPreviousStep(stepNum)}
        />
      </div>
    </StepContainer>
  );
}
