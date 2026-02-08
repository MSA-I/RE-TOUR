import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ThumbsUp, XCircle, AlertTriangle, Loader2, StopCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { StepAttempt } from "@/hooks/useStepAttempts";
import { QARejectionCard } from "./QARejectionCard";
import { format } from "date-fns";
import { useQAAttemptFeedback, FeedbackCategory } from "@/hooks/useQAAttemptFeedback";

// Category labels for display
const CATEGORY_LABELS: Record<string, string> = {
  GEOMETRY_DISTORTION: "Geometry Distortion",
  SCALE_MISMATCH: "Scale Mismatch",
  FURNITURE_MISMATCH: "Furniture Mismatch",
  STYLE_INCONSISTENCY: "Style Inconsistency",
  WALL_RECTIFICATION: "Wall Rectification",
  LOW_CONFIDENCE: "Low Confidence",
  MISSING_SPACE: "Missing Space",
  DUPLICATED_OBJECTS: "Duplicated Objects",
  WRONG_ROOM_TYPE: "Wrong Room Type",
  AMBIGUOUS_CLASSIFICATION: "Ambiguous",
  MISSING_FURNISHINGS: "Missing Furnishings",
  RESOLUTION_MISMATCH: "Resolution Issue",
  SEAM_ARTIFACTS: "Seam Artifacts",
  COLOR_INCONSISTENCY: "Color Inconsistency",
  PERSPECTIVE_ERROR: "Perspective Error",
  SCHEMA_INVALID: "Schema Invalid",
  API_ERROR: "API Error",
  TIMEOUT: "Timeout",
  INVALID_INPUT: "Invalid Input",
  UNKNOWN: "Unknown Issue",
};

interface ManualReviewAttemptGridProps {
  attempts: StepAttempt[];
  isLoading?: boolean;
  selectedAttemptId: string | null;
  onSelectAttempt: (attempt: StepAttempt) => void;
  onApprove: (attempt: StepAttempt) => void;
  onReject?: () => void;
  onStopRetries?: () => void;
  isProcessing?: boolean;
  showFullReasons?: boolean;
  isRetrying?: boolean;
  maxAttempts?: number;
  // Context for feedback
  projectId?: string;
  pipelineId?: string;
  stepNumber?: number;
}

// Full detail view dialog for selected attempt
function AttemptDetailDialog({
  attempt,
  open,
  onOpenChange,
  onApprove,
  onReject,
  isProcessing,
}: {
  attempt: StepAttempt | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApprove: () => void;
  onReject?: () => void;
  isProcessing?: boolean;
}) {
  if (!attempt) return null;

  const qa = attempt.qa_result_json || {};
  const reasons = qa.reasons || [];
  const evidence = qa.evidence || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <span>Attempt #{attempt.attempt_index}</span>
            <Badge
              className={cn(
                attempt.qa_status === "rejected"
                  ? "bg-destructive text-destructive-foreground"
                  : attempt.qa_status === "approved"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted"
              )}
            >
              {attempt.qa_status}
            </Badge>
            {attempt.rejection_category && (
              <Badge variant="outline" className="text-xs">
                {CATEGORY_LABELS[attempt.rejection_category] || attempt.rejection_category}
              </Badge>
            )}
            <Badge 
              variant="secondary" 
              className={cn(
                "text-xs",
                attempt.confidence === "high" && "bg-primary/20 text-primary",
                attempt.confidence === "low" && "bg-destructive/20 text-destructive"
              )}
            >
              {attempt.confidence} confidence
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-auto grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Image preview */}
          <div className="space-y-2">
            {attempt.image_url ? (
              <img
                src={attempt.image_url}
                alt={`Attempt ${attempt.attempt_index}`}
                className="w-full rounded-lg border"
              />
            ) : (
              <div className="aspect-video bg-muted rounded-lg flex items-center justify-center">
                <AlertTriangle className="w-8 h-8 text-muted-foreground" />
              </div>
            )}
          </div>

          {/* Details panel */}
          <ScrollArea className="max-h-[60vh]">
            <div className="space-y-4 pr-4">
              {/* Primary reason - ALWAYS VISIBLE */}
              <div className="p-3 rounded-lg border border-destructive/30 bg-destructive/5">
                <h4 className="text-sm font-semibold text-foreground mb-1">
                  Primary Rejection Reason
                </h4>
                <p className="text-sm text-foreground">
                  {qa.reason_short || attempt.qa_reason_short || "QA check failed"}
                </p>
              </div>

              {/* All reasons with codes */}
              {reasons.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-foreground mb-2">
                    All Issues ({reasons.length})
                  </h4>
                  <ul className="space-y-2">
                    {reasons.map((reason: { code: string; description: string }, idx: number) => (
                      <li key={idx} className="flex items-start gap-2 text-sm">
                        <Badge variant="outline" className="text-[10px] flex-shrink-0 mt-0.5">
                          {reason.code}
                        </Badge>
                        <span className="text-muted-foreground">{reason.description}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Evidence */}
              {evidence.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-foreground mb-2">
                    Evidence ({evidence.length})
                  </h4>
                  <ul className="space-y-1 text-sm text-muted-foreground">
                    {evidence.map((e: { observation: string; location?: string; confidence?: number }, idx: number) => (
                      <li key={idx} className="flex items-start gap-1">
                        <span className="text-muted-foreground/60">•</span>
                        <span>
                          {e.observation}
                          {e.location && <span className="italic text-xs"> (at {e.location})</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Full reason if available */}
              {attempt.qa_reason_full && (
                <div>
                  <h4 className="text-sm font-semibold text-foreground mb-1">
                    Full QA Analysis
                  </h4>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {attempt.qa_reason_full}
                  </p>
                </div>
              )}

              {/* Timestamp */}
              <div className="text-xs text-muted-foreground pt-2 border-t">
                Created: {format(new Date(attempt.created_at), "PPpp")}
              </div>
            </div>
          </ScrollArea>
        </div>

        {/* Action buttons */}
        <div className="flex items-center justify-end gap-2 pt-4 border-t">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isProcessing}
          >
            Cancel
          </Button>
          {onReject && (
            <Button
              variant="destructive"
              onClick={() => {
                onReject();
                onOpenChange(false);
              }}
              disabled={isProcessing}
            >
              <XCircle className="w-4 h-4 mr-1" />
              Reject & Stop
            </Button>
          )}
          <Button
            onClick={() => {
              onApprove();
              onOpenChange(false);
            }}
            disabled={isProcessing}
          >
            {isProcessing ? (
              <Loader2 className="w-4 h-4 mr-1 animate-spin" />
            ) : (
              <ThumbsUp className="w-4 h-4 mr-1" />
            )}
            Approve This Attempt
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ManualReviewAttemptGrid({
  attempts,
  isLoading,
  selectedAttemptId,
  onSelectAttempt,
  onApprove,
  onReject,
  onStopRetries,
  isProcessing,
  showFullReasons = true,
  isRetrying = false,
  maxAttempts = 5,
  projectId,
  pipelineId,
  stepNumber,
}: ManualReviewAttemptGridProps) {
  const [detailOpen, setDetailOpen] = useState(false);
  const selectedAttempt = attempts.find((a) => a.id === selectedAttemptId) || null;

  // Feedback hook - only active if we have the required context
  const hasFeedbackContext = !!projectId && !!pipelineId && typeof stepNumber === "number";
  const feedbackHook = useQAAttemptFeedback(
    pipelineId || "",
    stepNumber ?? 0
  );

  // Count failed attempts
  const failedCount = attempts.filter(a => a.qa_status === "rejected").length;
  const hasApproved = attempts.some(a => a.qa_status === "approved");

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8 text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin mr-2" />
        Loading attempts...
      </div>
    );
  }

  if (attempts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-muted-foreground">
        <AlertTriangle className="w-8 h-8 mb-2" />
        <p>No attempts found for this step.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with status and controls */}
      <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-border/50">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium text-foreground">
            {attempts.length} attempt{attempts.length !== 1 ? "s" : ""}
          </p>
          
          {/* Failed count badge */}
          <Badge 
            variant={failedCount === maxAttempts ? "destructive" : "secondary"}
            className="text-xs"
          >
            {failedCount}/{maxAttempts} rejected
          </Badge>
          
          {/* Retrying indicator */}
          {isRetrying && failedCount < maxAttempts && (
            <Badge className="bg-blue-500/20 text-blue-400 border border-blue-500/30 text-xs animate-pulse">
              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              Auto-retry in progress...
            </Badge>
          )}
          
          {/* All failed indicator */}
          {failedCount >= maxAttempts && !hasApproved && (
            <Badge variant="destructive" className="text-xs">
              <AlertTriangle className="w-3 h-3 mr-1" />
              Auto-retry exhausted
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Stop retries button */}
          {isRetrying && onStopRetries && (
            <Button
              size="sm"
              variant="outline"
              onClick={onStopRetries}
              disabled={isProcessing}
            >
              <StopCircle className="w-4 h-4 mr-1" />
              Stop Retries
            </Button>
          )}
          
          {/* Selected attempt approval */}
          {selectedAttempt && (
            <Button
              size="sm"
              onClick={() => onApprove(selectedAttempt)}
              disabled={isProcessing}
            >
              {isProcessing ? (
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              ) : (
                <ThumbsUp className="w-4 h-4 mr-1" />
              )}
              Approve #{selectedAttempt.attempt_index}
            </Button>
          )}
        </div>
      </div>

      {/* Instructions */}
      <p className="text-xs text-muted-foreground">
        Click any attempt to view full details and approve. You can approve ANY attempt, not just the latest one.
      </p>

      {/* Attempt grid using QARejectionCard */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {attempts.map((attempt) => {
          // Get existing feedback for this attempt
          const existingFeedback = hasFeedbackContext
            ? feedbackHook.getExistingFeedback(attempt.attempt_index, attempt.output_upload_id)
            : null;

          return (
            <QARejectionCard
              key={attempt.id}
              attempt={attempt}
              isSelected={selectedAttemptId === attempt.id}
              onSelect={() => {
                onSelectAttempt(attempt);
                setDetailOpen(true);
              }}
              onApprove={() => onApprove(attempt)}
              isProcessing={isProcessing}
              showExpandedDetails={showFullReasons}
              existingVote={existingFeedback?.user_vote || null}
              isFeedbackSubmitting={feedbackHook.isSubmitting}
              onFeedbackSubmit={
                hasFeedbackContext
                  ? (vote, category, comment) => {
                      feedbackHook.submitFeedback({
                        projectId: projectId!,
                        pipelineId: pipelineId!,
                        stepId: stepNumber!,
                        attemptNumber: attempt.attempt_index,
                        imageId: attempt.output_upload_id,
                        qaDecision: attempt.qa_status as "approved" | "rejected",
                        qaReasons: attempt.qa_result_json?.reasons || [],
                        userVote: vote,
                        userCategory: category,
                        userCommentShort: comment,
                        contextSnapshot: {
                          step_id: stepNumber,
                          qa_result: attempt.qa_result_json,
                        },
                      });
                    }
                  : undefined
              }
            />
          );
        })}
      </div>

      {/* Detail dialog */}
      <AttemptDetailDialog
        attempt={selectedAttempt}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onApprove={() => selectedAttempt && onApprove(selectedAttempt)}
        onReject={onReject}
        isProcessing={isProcessing}
      />
    </div>
  );
}
