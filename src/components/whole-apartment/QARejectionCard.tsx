import { memo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { 
  AlertTriangle, 
  Check, 
  XCircle, 
  ZoomIn, 
  ThumbsUp,
  Loader2,
  ChevronDown,
  ChevronUp
} from "lucide-react";
import { format } from "date-fns";
import type { StepAttempt, QAReasonCode, QAConfidence } from "@/hooks/useStepAttempts";
import { QAAttemptFeedback, FeedbackCategory } from "./QAAttemptFeedback";

interface QARejectionCardProps {
  attempt: StepAttempt;
  isSelected: boolean;
  onSelect: () => void;
  onApprove: () => void;
  isProcessing?: boolean;
  showExpandedDetails?: boolean;
  // Feedback props
  existingVote?: "like" | "dislike" | null;
  isFeedbackSubmitting?: boolean;
  onFeedbackSubmit?: (vote: "like" | "dislike", category: FeedbackCategory, comment: string) => void;
}

// Human-readable category labels
const CATEGORY_LABELS: Record<QAReasonCode, string> = {
  INVALID_INPUT: "Invalid Input",
  MISSING_SPACE: "Missing Space",
  DUPLICATED_OBJECTS: "Duplicated Objects",
  GEOMETRY_DISTORTION: "Geometry Distortion",
  WRONG_ROOM_TYPE: "Wrong Room Type",
  LOW_CONFIDENCE: "Low Confidence",
  AMBIGUOUS_CLASSIFICATION: "Ambiguous",
  SCALE_MISMATCH: "Scale Mismatch",
  FURNITURE_MISMATCH: "Furniture Mismatch",
  STYLE_INCONSISTENCY: "Style Inconsistency",
  WALL_RECTIFICATION: "Wall Rectification",
  MISSING_FURNISHINGS: "Missing Furnishings",
  RESOLUTION_MISMATCH: "Resolution Issue",
  SEAM_ARTIFACTS: "Seam Artifacts",
  COLOR_INCONSISTENCY: "Color Inconsistency",
  PERSPECTIVE_ERROR: "Perspective Error",
  SCHEMA_INVALID: "Schema Invalid",
  API_ERROR: "API Error",
  TIMEOUT: "Timeout",
  UNKNOWN: "Unknown Issue",
};

// Category badge colors
const CATEGORY_COLORS: Record<string, string> = {
  GEOMETRY_DISTORTION: "bg-red-500/20 text-red-400 border-red-500/30",
  SCALE_MISMATCH: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  FURNITURE_MISMATCH: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  STYLE_INCONSISTENCY: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  WALL_RECTIFICATION: "bg-red-500/20 text-red-400 border-red-500/30",
  LOW_CONFIDENCE: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  API_ERROR: "bg-gray-500/20 text-gray-400 border-gray-500/30",
  TIMEOUT: "bg-gray-500/20 text-gray-400 border-gray-500/30",
  DEFAULT: "bg-muted text-muted-foreground border-border",
};

// Confidence badge styling
const CONFIDENCE_STYLES: Record<QAConfidence, string> = {
  high: "bg-green-500/20 text-green-400",
  medium: "bg-yellow-500/20 text-yellow-400",
  low: "bg-red-500/20 text-red-400",
};

export const QARejectionCard = memo(function QARejectionCard({
  attempt,
  isSelected,
  onSelect,
  onApprove,
  isProcessing = false,
  showExpandedDetails = true,
  existingVote,
  isFeedbackSubmitting = false,
  onFeedbackSubmit,
}: QARejectionCardProps) {
  const [imageError, setImageError] = useState(false);
  const [expanded, setExpanded] = useState(false);
  
  const qa = attempt.qa_result_json || {};
  
  // Helper to check if a reason is the generic summary
  const isGenericReason = (reason: string | undefined): boolean => {
    if (!reason) return true;
    return reason.includes("rejected by QA") || reason === "QA check failed";
  };
  
  // Get short reason - prioritize structured data, SKIP generic summaries
  let shortReason = "QA check failed";
  
  // Try reason_short first
  if (qa.reason_short && !isGenericReason(qa.reason_short)) {
    shortReason = qa.reason_short;
  } else if (attempt.qa_reason_short && !isGenericReason(attempt.qa_reason_short)) {
    shortReason = attempt.qa_reason_short;
  } else if (qa.reasons?.[0]?.description) {
    shortReason = qa.reasons[0].description;
  } else if (qa.reason && !isGenericReason(qa.reason)) {
    shortReason = qa.reason;
  } else {
    // Build from individual checks - these are the REAL reasons
    const issues: string[] = [];
    if (qa.geometry_check === "failed") issues.push("Wall geometry not preserved correctly");
    if (qa.scale_check === "failed") issues.push("Furniture scale mismatch with room dimensions");
    if (qa.furniture_check === "failed") issues.push("Furniture placement or type issues");
    if (qa.furniture_type_check === "failed") issues.push("Furniture types changed unexpectedly");
    if (qa.furniture_size_check === "failed") issues.push("Furniture sizes incorrect for room");
    if (qa.structural_check === "failed") issues.push("Structural elements (doors/windows) changed");
    const bedIssues = qa.bed_size_issues as string[] | undefined;
    const furnitureIssues = qa.furniture_issues as string[] | undefined;
    if (bedIssues?.length) issues.push(String(bedIssues[0]));
    if (furnitureIssues?.length) issues.push(String(furnitureIssues[0]));
    
    if (issues.length > 0) {
      shortReason = issues.join("; ");
    } else {
      // No specific reason found - be honest
      shortReason = "QA rejected - specific reason not recorded";
    }
  }
  
  // Get all reasons for expanded view
  const allReasons = qa.reasons || [];
  const evidence = qa.evidence || [];
  
  // Get category label - prefer "QA Rejected" over "Unknown" when we have a real reason
  const hasSpecificReason = shortReason !== "QA check failed";
  const categoryLabel = attempt.rejection_category 
    ? CATEGORY_LABELS[attempt.rejection_category] 
    : (hasSpecificReason ? "QA Rejected" : "Unknown Issue");
  
  const categoryColor = attempt.rejection_category 
    ? (CATEGORY_COLORS[attempt.rejection_category] || CATEGORY_COLORS.DEFAULT)
    : CATEGORY_COLORS.DEFAULT;

  return (
    <div
      className={cn(
        "relative rounded-lg border-2 transition-all overflow-hidden",
        isSelected
          ? "border-primary ring-2 ring-primary/30"
          : "border-border hover:border-primary/50"
      )}
    >
      {/* Thumbnail with overlay */}
      <div 
        className="aspect-video bg-muted relative cursor-pointer group"
        onClick={onSelect}
      >
        {attempt.image_url && !imageError ? (
          <img
            src={attempt.image_url}
            alt={`Attempt ${attempt.attempt_index}`}
            className="w-full h-full object-cover"
            onError={() => setImageError(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            <AlertTriangle className="w-8 h-8" />
          </div>
        )}

        {/* Attempt number badge */}
        <Badge
          variant="secondary"
          className="absolute top-2 left-2 text-xs px-2 py-1 bg-background/90 font-bold"
        >
          #{attempt.attempt_index}
        </Badge>

        {/* Status badge */}
        <Badge
          className={cn(
            "absolute top-2 right-2 text-xs px-2 py-1",
            attempt.qa_status === "rejected"
              ? "bg-destructive/90 text-destructive-foreground"
              : attempt.qa_status === "approved"
              ? "bg-green-600/90 text-white"
              : "bg-muted text-muted-foreground"
          )}
        >
          {attempt.qa_status === "rejected" ? (
            <XCircle className="w-3 h-3 mr-1" />
          ) : attempt.qa_status === "approved" ? (
            <Check className="w-3 h-3 mr-1" />
          ) : null}
          {attempt.qa_status}
        </Badge>

        {/* Hover overlay */}
        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <ZoomIn className="w-8 h-8 text-white" />
        </div>
      </div>

      {/* Content area */}
      <div className="p-3 space-y-2 bg-card">
        {/* Category + Confidence badges */}
        <div className="flex items-center gap-2 flex-wrap">
          <Badge className={cn("text-[10px] border", categoryColor)}>
            {categoryLabel}
          </Badge>
          <Badge className={cn("text-[10px]", CONFIDENCE_STYLES[attempt.confidence])}>
            {attempt.confidence} confidence
          </Badge>
        </div>

        {/* Short reason - ALWAYS visible, NEVER truncated */}
        <p className="text-sm text-foreground font-medium leading-snug">
          {shortReason}
        </p>

        {/* Expandable details */}
        {showExpandedDetails && (allReasons.length > 1 || evidence.length > 0) && (
          <div className="space-y-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-between text-xs text-muted-foreground p-1 h-auto"
              onClick={() => setExpanded(!expanded)}
            >
              <span>{expanded ? "Hide details" : "Show all details"}</span>
              {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </Button>

            {expanded && (
              <div className="space-y-2 pt-2 border-t border-border/50">
                {/* All reasons */}
                {allReasons.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                      All Issues ({allReasons.length})
                    </p>
                    <ul className="space-y-1">
                      {allReasons.map((reason, idx) => (
                        <li key={idx} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                          <XCircle className="w-3 h-3 text-destructive mt-0.5 flex-shrink-0" />
                          <span>
                            <span className="font-medium text-foreground/80">
                              {CATEGORY_LABELS[reason.code as QAReasonCode] || reason.code}:
                            </span>{" "}
                            {reason.description}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Evidence */}
                {evidence.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                      Evidence
                    </p>
                    <ul className="space-y-1">
                      {evidence.map((e, idx) => (
                        <li key={idx} className="text-xs text-muted-foreground">
                          • {e.observation}
                          {e.location && <span className="italic"> (at {e.location})</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Timestamp */}
        <p className="text-[10px] text-muted-foreground/60">
          {format(new Date(attempt.created_at), "MMM d, HH:mm:ss")}
        </p>

        {/* QA Feedback (Like/Dislike) - always show if callback provided */}
        {onFeedbackSubmit && (
          <div className="pt-2 border-t border-border/30">
            <QAAttemptFeedback
              attemptId={attempt.id}
              attemptNumber={attempt.attempt_index}
              qaStatus={attempt.qa_status as "approved" | "rejected" | "pending"}
              qaCategory={attempt.rejection_category || undefined}
              existingVote={existingVote}
              isSubmitting={isFeedbackSubmitting}
              onSubmit={onFeedbackSubmit}
            />
          </div>
        )}

        {/* Approve button for this specific attempt */}
        {attempt.qa_status === "rejected" && (
          <Button
            size="sm"
            variant={isSelected ? "default" : "outline"}
            className="w-full mt-2"
            onClick={(e) => {
              e.stopPropagation();
              onApprove();
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
        )}
      </div>
    </div>
  );
});

export default QARejectionCard;
