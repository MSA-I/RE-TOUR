import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { QAReviewPanel } from "@/components/shared/QAReviewPanel";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { StepAttempt } from "@/hooks/useStepAttempts";
import {
  Loader2,
  Eye,
  Maximize2,
  CheckCircle,
  XCircle,
  AlertTriangle
} from "lucide-react";
import { format } from "date-fns";

interface Step2OutputsPanelProps {
  pipelineId: string;
  projectId: string;
  attempts: StepAttempt[];
  isLoading?: boolean;
  /** Called after approval to advance to next step */
  onAdvanceToNextStep?: () => void;
  /** Called after rejection to trigger retry with feedback */
  onRetryWithFeedback?: (rejectionReason: string) => void;
}

export function Step2OutputsPanel({
  pipelineId,
  projectId,
  attempts,
  isLoading,
  onAdvanceToNextStep,
  onRetryWithFeedback,
}: Step2OutputsPanelProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [processingAttempts, setProcessingAttempts] = useState<Set<string>>(new Set());
  const [viewingImage, setViewingImage] = useState<string | null>(null);

  // Handle approve
  const handleApprove = useCallback(async (attempt: StepAttempt, score: number | null, note: string) => {
    setProcessingAttempts(prev => new Set(prev).add(attempt.id));

    try {
      // The QAReviewPanel with autoPersistFeedback=true will handle:
      // 1. Saving to qa_attempt_feedback table
      // 2. Updating the attempt record
      // We just need to refresh the queries after

      toast({
        title: "Attempt approved",
        description: "Advancing to next step...",
      });

      // Refresh data
      queryClient.invalidateQueries({ queryKey: ["floorplan-pipelines", projectId] });
      queryClient.invalidateQueries({ queryKey: ["pipeline-step-attempts", pipelineId] });

      // Advance to next step
      if (onAdvanceToNextStep) {
        // Small delay to ensure feedback is saved
        setTimeout(() => {
          onAdvanceToNextStep();
        }, 500);
      }
    } catch (error) {
      console.error("Failed to approve:", error);
      toast({
        title: "Failed to approve",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setProcessingAttempts(prev => {
        const next = new Set(prev);
        next.delete(attempt.id);
        return next;
      });
    }
  }, [pipelineId, projectId, queryClient, toast, onAdvanceToNextStep]);

  // Handle reject
  const handleReject = useCallback(async (attempt: StepAttempt, score: number | null, note: string) => {
    setProcessingAttempts(prev => new Set(prev).add(attempt.id));

    try {
      // The QAReviewPanel with autoPersistFeedback=true will handle the persistence

      toast({
        title: "Attempt rejected",
        description: "Analyzing feedback and generating new prompt...",
      });

      // Refresh data
      queryClient.invalidateQueries({ queryKey: ["floorplan-pipelines", projectId] });
      queryClient.invalidateQueries({ queryKey: ["pipeline-step-attempts", pipelineId] });

      // Trigger auto-retry with feedback analysis
      if (onRetryWithFeedback && note) {
        // Small delay to ensure feedback is saved to QA learning system
        setTimeout(() => {
          onRetryWithFeedback(note);
        }, 500);
      }
    } catch (error) {
      console.error("Failed to reject:", error);
      toast({
        title: "Failed to reject",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setProcessingAttempts(prev => {
        const next = new Set(prev);
        next.delete(attempt.id);
        return next;
      });
    }
  }, [pipelineId, projectId, queryClient, toast, onRetryWithFeedback]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (attempts.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          No outputs generated yet. Run Step 2 to create styled outputs.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="text-sm text-muted-foreground mb-2">
        {attempts.length} attempt{attempts.length !== 1 ? "s" : ""} • All attempts shown (approved and rejected)
      </div>

      {attempts.map((attempt) => {
        const imageUrl = attempt.image_url;
        const isProcessing = processingAttempts.has(attempt.id);
        const needsReview = !attempt.qa_status || attempt.qa_status === "pending";
        const isApproved = attempt.qa_status === "approved";
        const isRejected = attempt.qa_status === "rejected";
        const qaReason = attempt.qa_reason_short || attempt.qa_reason_full || null;
        const qaScore = null; // Not currently stored in attempts table

        return (
          <Card key={attempt.id} className="overflow-hidden">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium">
                  Attempt #{attempt.attempt_index}
                </CardTitle>
                <div className="flex items-center gap-2">
                  {isApproved && (
                    <Badge className="bg-primary/20 text-primary">
                      <CheckCircle className="w-3 h-3 mr-1" />
                      Approved
                    </Badge>
                  )}
                  {isRejected && (
                    <Badge className="bg-destructive/20 text-destructive">
                      <XCircle className="w-3 h-3 mr-1" />
                      Rejected
                    </Badge>
                  )}
                  {needsReview && (
                    <Badge variant="secondary">
                      <AlertTriangle className="w-3 h-3 mr-1" />
                      Needs Review
                    </Badge>
                  )}
                  {qaScore != null && (
                    <Badge variant="outline">
                      Score: {qaScore}/100
                    </Badge>
                  )}
                </div>
              </div>
              <div className="text-xs text-muted-foreground">
                {format(new Date(attempt.created_at), "MMM d, yyyy HH:mm")}
              </div>
            </CardHeader>

            <CardContent className="space-y-4">
              {/* Image preview */}
              {imageUrl ? (
                <div
                  className="relative aspect-[16/9] rounded border overflow-hidden cursor-pointer group"
                  onClick={() => setViewingImage(imageUrl)}
                >
                  <img
                    src={imageUrl}
                    alt={`Attempt ${attempt.attempt_index}`}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-background/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <Maximize2 className="h-6 w-6 text-foreground" />
                  </div>
                </div>
              ) : (
                <div className="aspect-[16/9] rounded border bg-muted/50 border-dashed flex flex-col items-center justify-center p-4">
                  <AlertTriangle className="h-6 w-6 text-muted-foreground mb-2" />
                  <p className="text-xs text-muted-foreground text-center">
                    Image not available
                  </p>
                </div>
              )}

              {/* Show existing QA reason if rejected by auto-QA */}
              {qaReason && (isRejected || isApproved) && (
                <div className={cn(
                  "p-3 rounded border text-sm",
                  isRejected && "bg-destructive/5 border-destructive/30",
                  isApproved && "bg-primary/5 border-primary/30"
                )}>
                  <div className="font-medium mb-1">
                    {isRejected ? "Auto-QA Rejection Reason:" : "Auto-QA Approval:"}
                  </div>
                  <div className="text-muted-foreground">{qaReason}</div>
                </div>
              )}

              {/* Manual review panel - ALWAYS SHOWN (like Multi Panoramas) */}
              {attempt.output_upload_id && (
                <QAReviewPanel
                  itemId={attempt.id}
                  projectId={projectId}
                  pipelineId={pipelineId}
                  outputUploadId={attempt.output_upload_id}
                  onApprove={(score, note) => handleApprove(attempt, score, note)}
                  onReject={(score, note) => handleReject(attempt, score, note)}
                  isApproving={isProcessing}
                  isRejecting={isProcessing}
                  title={needsReview ? "Manual Review Required" : "Override QA Decision"}
                  description="Score the output quality (0-100) and provide explanation. This feeds into the QA learning system."
                  initialScore={qaScore}
                  initialNote={qaReason || ""}
                  stepId={2}
                  attemptNumber={attempt.attempt_index}
                  category="step2_style_reference"
                  autoPersistFeedback={true}
                  showNote={true}
                />
              )}
            </CardContent>
          </Card>
        );
      })}

      {/* Full image view dialog */}
      {viewingImage && (
        <Dialog open={!!viewingImage} onOpenChange={() => setViewingImage(null)}>
          <DialogContent className="max-w-[90vw] max-h-[90vh] p-0">
            <img
              src={viewingImage}
              alt="Full size"
              className="w-full h-full object-contain"
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
