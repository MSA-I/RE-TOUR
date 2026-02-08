import { useState, useEffect, useCallback, memo, useMemo } from "react";
import { AlertTriangle, RefreshCw, ThumbsUp, XCircle, Clock, Maximize2, X, ChevronDown, ChevronUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useStorage } from "@/hooks/useStorage";
import { useStepAttempts, StepAttempt, QAReasonCode, QAConfidence } from "@/hooks/useStepAttempts";
import { ManualReviewAttemptGrid } from "./ManualReviewAttemptGrid";
import { cn } from "@/lib/utils";

// Step retry state interface matching DB step_retry_state JSONB structure
export interface StepRetryState {
  attempt_count: number;
  max_attempts: number;
  auto_retry_enabled: boolean;
  last_qa_result: {
    decision?: string;
    reason?: string;
    reason_short?: string;
    reasons?: Array<{ code: string; description: string }>;
    evidence?: Array<{ observation: string; location?: string; confidence?: number }>;
    geometry_check?: string;
    scale_check?: string;
    furniture_check?: string;
    bed_size_issues?: string[];
    structural_check?: string;
    furniture_type_check?: string;
    furniture_size_check?: string;
    furniture_issues?: string[];
    confidence_score?: number;
    output_upload_ids?: string[];
  } | null;
  last_retry_delta?: {
    changes_made?: string[];
    prompt_adjustments?: string[];
    new_seed?: number;
    temperature?: number;
  } | null;
  status: "pending" | "running" | "qa_pass" | "qa_fail" | "blocked_for_human";
  created_at?: string;
  updated_at?: string;
  manual_approved_after_exhaustion?: boolean;
  manual_approved_at?: string;
  attempts?: Array<{
    attempt_number: number;
    output_upload_ids: string[];
    qa_result: Record<string, unknown>;
    timestamp: string;
  }>;
}

// Category labels for display - includes new Step 1 categories
const CATEGORY_LABELS: Record<string, string> = {
  // New Step 1 deterministic categories (architectural-logic-based)
  FLOORING_MISMATCH: "Flooring Mismatch",
  FURNITURE_SCALE: "Furniture Scale Issue",
  EXTRA_FURNITURE: "Extra Furniture",
  STRUCTURAL_CHANGE: "Structural Change",
  // Legacy categories
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

// Category badge colors - includes new Step 1 categories
const CATEGORY_COLORS: Record<string, string> = {
  // New Step 1 deterministic categories
  FLOORING_MISMATCH: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  FURNITURE_SCALE: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  EXTRA_FURNITURE: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  STRUCTURAL_CHANGE: "bg-red-500/20 text-red-400 border-red-500/30",
  // Legacy categories
  GEOMETRY_DISTORTION: "bg-red-500/20 text-red-400 border-red-500/30",
  SCALE_MISMATCH: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  FURNITURE_MISMATCH: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  STYLE_INCONSISTENCY: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  WALL_RECTIFICATION: "bg-red-500/20 text-red-400 border-red-500/30",
  LOW_CONFIDENCE: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  API_ERROR: "bg-muted text-muted-foreground border-border",
  TIMEOUT: "bg-muted text-muted-foreground border-border",
  DEFAULT: "bg-muted text-muted-foreground border-border",
};

// Confidence badge styling
const CONFIDENCE_STYLES: Record<QAConfidence, string> = {
  high: "bg-green-500/20 text-green-400",
  medium: "bg-yellow-500/20 text-yellow-400",
  low: "bg-red-500/20 text-red-400",
};

interface StepRetryStatusIndicatorProps {
  stepNumber: number;
  stepRetryState: StepRetryState | null;
  pipelineId: string;
  onManualApprove?: (outputUploadId?: string) => void;
  onManualReject?: () => void;
  onRestartStep?: () => void;
  isProcessing?: boolean;
}

// Extract rejection category from QA result
function extractCategory(qaResult: StepRetryState["last_qa_result"]): QAReasonCode | null {
  if (!qaResult) return null;
  
  // Check structured reasons array first
  if (qaResult.reasons && qaResult.reasons.length > 0) {
    return qaResult.reasons[0].code as QAReasonCode;
  }
  
  // Derive from individual check fields
  if (qaResult.geometry_check === "failed") return "GEOMETRY_DISTORTION";
  if (qaResult.scale_check === "failed") return "SCALE_MISMATCH";
  if (qaResult.furniture_check === "failed") return "FURNITURE_MISMATCH";
  if (qaResult.structural_check === "failed") return "WALL_RECTIFICATION";
  if (qaResult.furniture_type_check === "failed") return "FURNITURE_MISMATCH";
  if (qaResult.furniture_size_check === "failed") return "SCALE_MISMATCH";
  
  // Detect from reason text if available
  const reasonText = (qaResult.reason || qaResult.reason_short || "").toLowerCase();
  if (reasonText.includes("geometry") || reasonText.includes("wall") || reasonText.includes("angle")) {
    return "GEOMETRY_DISTORTION";
  }
  if (reasonText.includes("scale") || reasonText.includes("proportion") || reasonText.includes("size")) {
    return "SCALE_MISMATCH";
  }
  if (reasonText.includes("furniture") || reasonText.includes("bed") || reasonText.includes("sofa")) {
    return "FURNITURE_MISMATCH";
  }
  if (reasonText.includes("structural") || reasonText.includes("door") || reasonText.includes("window")) {
    return "WALL_RECTIFICATION";
  }
  if (reasonText.includes("style") || reasonText.includes("color") || reasonText.includes("material")) {
    return "STYLE_INCONSISTENCY";
  }
  
  // Only return UNKNOWN if we have no reason at all OR it's the generic message
  if (!qaResult.reason && !qaResult.reason_short) return "UNKNOWN";
  if (reasonText.includes("all") && reasonText.includes("rejected by qa")) return "UNKNOWN";
  
  return null; // Return null instead of UNKNOWN if there's a specific reason
}

// Extract confidence level from QA result
function extractConfidence(qaResult: StepRetryState["last_qa_result"]): QAConfidence {
  if (!qaResult || typeof qaResult.confidence_score !== "number") return "medium";
  if (qaResult.confidence_score >= 0.8) return "high";
  if (qaResult.confidence_score < 0.5) return "low";
  return "medium";
}

// Build readable rejection reason from QA result
function buildRejectionReason(qaResult: StepRetryState["last_qa_result"]): string {
  if (!qaResult) return "QA rejected - reviewing output quality";
  
  // Helper to check if reason is generic
  const isGeneric = (s: string | undefined): boolean => {
    if (!s) return true;
    const lower = s.toLowerCase();
    return lower.includes("rejected by qa") || 
           s === "QA check failed" ||
           lower.includes("all") && lower.includes("output") && lower.includes("rejected");
  };
  
  // Prefer structured reason_short or reasons (skip generic)
  if (qaResult.reason_short && !isGeneric(qaResult.reason_short)) {
    return qaResult.reason_short;
  }
  if (qaResult.reasons && qaResult.reasons.length > 0) {
    return qaResult.reasons[0].description;
  }
  
  // Check raw reason (skip generic)
  if (qaResult.reason && !isGeneric(qaResult.reason)) {
    return qaResult.reason;
  }
  
  // Build from individual checks - these are the REAL rejection reasons
  const issues: string[] = [];
  if (qaResult.geometry_check === "failed") {
    issues.push("Wall geometry not preserved correctly");
  }
  if (qaResult.scale_check === "failed") {
    issues.push("Furniture scale is inconsistent with room dimensions");
  }
  if (qaResult.furniture_check === "failed") {
    issues.push("Furniture placement or type issues detected");
  }
  if (qaResult.structural_check === "failed") {
    issues.push("Structural elements (doors/windows) not preserved");
  }
  if (qaResult.furniture_type_check === "failed") {
    issues.push("Furniture types changed unexpectedly");
  }
  if (qaResult.furniture_size_check === "failed") {
    issues.push("Furniture sizes don't match room proportions");
  }
  if (qaResult.bed_size_issues?.length) {
    issues.push(qaResult.bed_size_issues[0]);
  }
  if (qaResult.furniture_issues?.length) {
    issues.push(qaResult.furniture_issues[0]);
  }
  
  if (issues.length > 0) return issues.join("; ");
  
  // If we have ANY reason field, use it even if generic (better than nothing)
  if (qaResult.reason) return qaResult.reason;
  if (qaResult.reason_short) return qaResult.reason_short;
  
  // Default - be honest that we don't have specifics
  return "QA rejected - specific reason not recorded for this attempt";
}

// Rejection card for a single attempt (inline version for legacy data)
const LegacyAttemptCard = memo(function LegacyAttemptCard({
  uploadId,
  attemptNumber,
  qaResult,
  isSelected,
  onSelect,
  onOpenPreview,
  onApprove,
  isProcessing,
}: {
  uploadId: string;
  attemptNumber: number;
  qaResult: StepRetryState["last_qa_result"];
  isSelected: boolean;
  onSelect: () => void;
  onOpenPreview: (uploadId: string, attemptNumber: number) => void;
  onApprove: () => void;
  isProcessing?: boolean;
}) {
  const { getSignedViewUrl } = useStorage();
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const category = extractCategory(qaResult);
  const confidence = extractConfidence(qaResult);
  const shortReason = buildRejectionReason(qaResult);
  
  // Show "QA Rejected" instead of "Unknown Issue" when we have a real reason but no category
  const hasSpecificReason = shortReason && !shortReason.includes("rejected by QA") && shortReason !== "QA check failed";
  const categoryLabel = category 
    ? (CATEGORY_LABELS[category] || category)
    : (hasSpecificReason ? "QA Rejected" : "Unknown Issue");
  const categoryColor = category 
    ? (CATEGORY_COLORS[category] || CATEGORY_COLORS.DEFAULT) 
    : CATEGORY_COLORS.DEFAULT;

  useEffect(() => {
    if (!uploadId) {
      setLoading(false);
      return;
    }

    const loadThumb = async () => {
      setLoading(true);
      setError(false);
      try {
        const result = await getSignedViewUrl(uploadId);
        if (result.signedUrl) {
          setThumbnailUrl(result.signedUrl);
        } else {
          setError(true);
        }
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    };

    loadThumb();
  }, [uploadId, getSignedViewUrl]);

  // Get all reasons for expanded view
  const allReasons = qaResult?.reasons || [];
  const evidence = qaResult?.evidence || [];

  return (
    <div
      className={cn(
        "relative rounded-lg border-2 transition-all overflow-hidden bg-card",
        isSelected
          ? "border-primary ring-2 ring-primary/30"
          : "border-border hover:border-primary/50"
      )}
    >
      {/* Thumbnail */}
      <div
        className="aspect-video bg-muted relative cursor-pointer group"
        onClick={() => {
          onSelect();
          if (uploadId) onOpenPreview(uploadId, attemptNumber);
        }}
      >
        {loading ? (
          <div className="w-full h-full flex items-center justify-center">
            <RefreshCw className="w-6 h-6 text-muted-foreground animate-spin" />
          </div>
        ) : error || !thumbnailUrl ? (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            <AlertTriangle className="w-8 h-8" />
          </div>
        ) : (
          <img
            src={thumbnailUrl}
            alt={`Attempt ${attemptNumber}`}
            className="w-full h-full object-cover"
          />
        )}

        {/* Attempt number badge */}
        <Badge
          variant="secondary"
          className="absolute top-2 left-2 text-xs px-2 py-1 bg-background/90 font-bold"
        >
          #{attemptNumber}
        </Badge>

        {/* Status badge */}
        <Badge
          className="absolute top-2 right-2 text-xs px-2 py-1 bg-destructive/90 text-destructive-foreground"
        >
          <XCircle className="w-3 h-3 mr-1" />
          rejected
        </Badge>

        {/* Hover overlay */}
        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <Maximize2 className="w-8 h-8 text-white" />
        </div>
      </div>

      {/* Content area */}
      <div className="p-3 space-y-2">
        {/* Category + Confidence badges */}
        <div className="flex items-center gap-2 flex-wrap">
          <Badge className={cn("text-[10px] border", categoryColor)}>
            {categoryLabel}
          </Badge>
          <Badge className={cn("text-[10px]", CONFIDENCE_STYLES[confidence])}>
            {confidence} confidence
          </Badge>
        </div>

        {/* Short reason - ALWAYS visible, NEVER truncated */}
        <p className="text-sm text-foreground font-medium leading-snug">
          {shortReason}
        </p>

        {/* Expandable details */}
        {(allReasons.length > 1 || evidence.length > 0) && (
          <div className="space-y-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-between text-xs text-muted-foreground p-1 h-auto"
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(!expanded);
              }}
            >
              <span>{expanded ? "Hide details" : "Show all details"}</span>
              {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </Button>

            {expanded && (
              <div className="space-y-2 pt-2 border-t border-border/50">
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
                              {CATEGORY_LABELS[reason.code] || reason.code}:
                            </span>{" "}
                            {reason.description}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

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

        {/* Approve button */}
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
          <ThumbsUp className="w-4 h-4 mr-1" />
          Approve This Attempt
        </Button>
      </div>
    </div>
  );
});

// Full image preview dialog
function ImagePreviewDialog({
  open,
  onOpenChange,
  imageUrl,
  title,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imageUrl: string | null;
  title: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] p-0 overflow-hidden">
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <div className="relative w-full h-full">
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-2 right-2 z-10 bg-background/80 hover:bg-background"
            onClick={() => onOpenChange(false)}
          >
            <X className="w-4 h-4" />
          </Button>
          {imageUrl && (
            <img
              src={imageUrl}
              alt={title}
              className="w-full h-auto max-h-[85vh] object-contain"
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function StepRetryStatusIndicator({
  stepNumber,
  stepRetryState,
  pipelineId,
  onManualApprove,
  onManualReject,
  onRestartStep,
  isProcessing = false,
}: StepRetryStatusIndicatorProps) {
  const { getSignedViewUrl } = useStorage();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState("");
  const [selectedUploadId, setSelectedUploadId] = useState<string | null>(null);
  const [processingApproval, setProcessingApproval] = useState(false);

  // Derived state
  const attemptCount = stepRetryState?.attempt_count || 0;
  const maxAttempts = stepRetryState?.max_attempts || 5;
  const isBlocked = stepRetryState?.status === "blocked_for_human";
  const isRetrying = stepRetryState?.status === "qa_fail" || stepRetryState?.status === "running";
  const lastQAResult = stepRetryState?.last_qa_result;
  const outputUploadIds = lastQAResult?.output_upload_ids || [];
  const legacyAttempts = stepRetryState?.attempts || [];

  // Try to fetch from new attempts table first
  const hasAnyActivity = isBlocked || isRetrying || attemptCount > 0;
  const { data: dbAttempts = [], isLoading: attemptsLoading, refetch: refetchAttempts } = useStepAttempts({
    pipelineId,
    stepNumber,
    enabled: hasAnyActivity,
  });

  // Build unified attempts list from DB or legacy data
  const allAttempts = useMemo(() => {
    // If we have DB attempts, use those
    if (dbAttempts.length > 0) {
      return dbAttempts;
    }
    
    // Otherwise, build from legacy step_retry_state.attempts
    if (legacyAttempts.length > 0) {
      return legacyAttempts.map((attempt, idx) => ({
        id: `legacy-${attempt.attempt_number}`,
        pipeline_id: pipelineId,
        step_number: stepNumber,
        attempt_index: attempt.attempt_number,
        output_upload_id: attempt.output_upload_ids?.[0] || null,
        qa_status: "rejected" as const,
        qa_reason_short: buildRejectionReason(attempt.qa_result as StepRetryState["last_qa_result"]),
        qa_reason_full: null,
        qa_result_json: attempt.qa_result || {},
        prompt_used: null,
        model_used: null,
        created_at: attempt.timestamp || new Date().toISOString(),
        image_url: null,
        rejection_category: extractCategory(attempt.qa_result as StepRetryState["last_qa_result"]),
        confidence: extractConfidence(attempt.qa_result as StepRetryState["last_qa_result"]),
      }));
    }
    
    // Last resort: create a single attempt from current state
    if (outputUploadIds.length > 0 && attemptCount > 0) {
      return [{
        id: `current-${attemptCount}`,
        pipeline_id: pipelineId,
        step_number: stepNumber,
        attempt_index: attemptCount,
        output_upload_id: outputUploadIds[0],
        qa_status: "rejected" as const,
        qa_reason_short: buildRejectionReason(lastQAResult),
        qa_reason_full: null,
        qa_result_json: lastQAResult || {},
        prompt_used: null,
        model_used: null,
        created_at: stepRetryState?.updated_at || new Date().toISOString(),
        image_url: null,
        rejection_category: extractCategory(lastQAResult),
        confidence: extractConfidence(lastQAResult),
      }];
    }
    
    return [];
  }, [dbAttempts, legacyAttempts, outputUploadIds, attemptCount, lastQAResult, pipelineId, stepNumber, stepRetryState?.updated_at]);

  // Select the first attempt by default
  useEffect(() => {
    if (allAttempts.length > 0 && !selectedUploadId) {
      setSelectedUploadId(allAttempts[allAttempts.length - 1].output_upload_id);
    }
  }, [allAttempts, selectedUploadId]);

  // Handle approval of a specific attempt
  const handleApproveAttempt = useCallback(async (uploadId: string | null) => {
    setProcessingApproval(true);
    try {
      await onManualApprove?.(uploadId || undefined);
      await refetchAttempts();
    } finally {
      setProcessingApproval(false);
    }
  }, [onManualApprove, refetchAttempts]);

  // Handle thumbnail click to open preview
  const handleThumbnailClick = useCallback(async (uploadId: string, index: number) => {
    try {
      const result = await getSignedViewUrl(uploadId);
      if (result.signedUrl) {
        setPreviewUrl(result.signedUrl);
        setPreviewTitle(`Failed Output (Attempt ${index})`);
        setPreviewOpen(true);
      }
    } catch (err) {
      console.error("Failed to load preview:", err);
    }
  }, [getSignedViewUrl]);

  // Don't render if no retry state or status is pending/pass
  if (!stepRetryState) return null;
  if (stepRetryState.status === "pending" || stepRetryState.status === "qa_pass") return null;

  // Build rejection reasons for header display
  const primaryCategory = extractCategory(lastQAResult);
  const primaryReason = buildRejectionReason(lastQAResult);
  const confidence = extractConfidence(lastQAResult);
  
  // Show "QA Rejected" instead of "Unknown Issue" when we have a real reason but no category
  const hasSpecificReason = primaryReason && !primaryReason.includes("rejected by QA") && primaryReason !== "QA check failed";
  const categoryLabel = primaryCategory 
    ? (CATEGORY_LABELS[primaryCategory] || primaryCategory)
    : (hasSpecificReason ? "QA Rejected" : "Unknown Issue");
  const categoryColor = primaryCategory 
    ? (CATEGORY_COLORS[primaryCategory] || CATEGORY_COLORS.DEFAULT) 
    : CATEGORY_COLORS.DEFAULT;

  // Show retry delta adjustments for transparency
  const retryDelta = stepRetryState.last_retry_delta;
  const adjustmentsApplied = retryDelta?.changes_made || [];

  // BLOCKED STATE: Full manual review UI
  if (isBlocked) {
    return (
      <div className="mx-3 p-4 rounded-lg border border-orange-500/30 bg-orange-500/5 space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-orange-500 flex-shrink-0" />
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge className="bg-orange-500/20 text-orange-400 border border-orange-500/30">
                Manual Approval Required
              </Badge>
              <span className="text-xs text-muted-foreground">
                Step {stepNumber}
              </span>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              AI-QA failed after {maxAttempts} attempts. Review all outputs below and approve the best one.
            </p>
          </div>
        </div>


        {/* Attempts grid */}
        {allAttempts.length > 0 ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-muted-foreground">
                {allAttempts.length} attempt{allAttempts.length !== 1 ? "s" : ""} - Select one to approve:
              </p>
              <Badge variant="destructive" className="text-xs">
                {allAttempts.length}/{maxAttempts} rejected
              </Badge>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {allAttempts.map((attempt) => (
                <LegacyAttemptCard
                  key={attempt.id}
                  uploadId={attempt.output_upload_id || ""}
                  attemptNumber={attempt.attempt_index}
                  qaResult={attempt.qa_result_json as StepRetryState["last_qa_result"]}
                  isSelected={selectedUploadId === attempt.output_upload_id}
                  onSelect={() => setSelectedUploadId(attempt.output_upload_id)}
                  onOpenPreview={(uploadId, attemptNumber) => handleThumbnailClick(uploadId, attemptNumber)}
                  onApprove={() => handleApproveAttempt(attempt.output_upload_id)}
                  isProcessing={isProcessing || processingApproval}
                />
              ))}
            </div>

            {/* Action buttons */}
            <div className="flex justify-end gap-2 pt-2">
              {onRestartStep && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={onRestartStep}
                  disabled={isProcessing || processingApproval}
                >
                  <RefreshCw className="w-4 h-4 mr-1" />
                  Restart Step {stepNumber}
                </Button>
              )}
              <Button
                size="sm"
                variant="destructive"
                onClick={onManualReject}
                disabled={isProcessing || processingApproval}
              >
                <XCircle className="w-4 h-4 mr-1" />
                Reject All & Stop Pipeline
              </Button>
            </div>
          </div>
        ) : attemptsLoading ? (
          <div className="flex items-center justify-center p-4 text-muted-foreground">
            <RefreshCw className="w-4 h-4 animate-spin mr-2" />
            Loading attempts...
          </div>
        ) : (
          /* No attempts available - show simple approve/reject */
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              onClick={() => onManualApprove?.(outputUploadIds[0])}
              disabled={isProcessing}
            >
              <ThumbsUp className="w-4 h-4 mr-1" />
              Approve Manually
            </Button>
            {onRestartStep && (
              <Button
                size="sm"
                variant="secondary"
                onClick={onRestartStep}
                disabled={isProcessing}
              >
                <RefreshCw className="w-4 h-4 mr-1" />
                Restart Step {stepNumber}
              </Button>
            )}
            <Button
              size="sm"
              variant="destructive"
              onClick={onManualReject}
              disabled={isProcessing}
            >
              <XCircle className="w-4 h-4 mr-1" />
              Reject & Stop
            </Button>
          </div>
        )}
      </div>
    );
  }

  // RETRYING STATE: Show progress with attempt cards
  return (
    <>
      <div className="mx-3 p-3 rounded-lg border border-blue-500/30 bg-blue-500/5">
        <div className="flex items-start gap-3">
          <RefreshCw className="w-5 h-5 text-blue-400 animate-spin flex-shrink-0 mt-0.5" />

          <div className="flex-1 space-y-3 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge className="bg-blue-500/20 text-blue-400 border border-blue-500/30">
                AI-QA Fail (Attempt {attemptCount}/{maxAttempts})
              </Badge>
              <span className="text-xs text-muted-foreground">
                Step {stepNumber}
              </span>
            </div>


            {/* Show attempts if available */}
            {allAttempts.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">
                  Failed Attempts ({allAttempts.length}/{maxAttempts}):
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {allAttempts.slice(-3).map((attempt) => (
                    <LegacyAttemptCard
                      key={attempt.id}
                      uploadId={attempt.output_upload_id || ""}
                      attemptNumber={attempt.attempt_index}
                      qaResult={attempt.qa_result_json as StepRetryState["last_qa_result"]}
                      isSelected={selectedUploadId === attempt.output_upload_id}
                      onSelect={() => setSelectedUploadId(attempt.output_upload_id)}
                      onOpenPreview={(uploadId, attemptNumber) => handleThumbnailClick(uploadId, attemptNumber)}
                      onApprove={() => handleApproveAttempt(attempt.output_upload_id)}
                      isProcessing={isProcessing || processingApproval}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Retry adjustments applied */}
            {adjustmentsApplied.length > 0 && (
              <div className="text-xs text-blue-400/80">
                <span className="font-medium">Adjustments applied: </span>
                {adjustmentsApplied.join(", ")}
              </div>
            )}

            {/* Progress indicator for auto-retry */}
            {isRetrying && (
              <div className="flex items-center gap-2 text-xs text-blue-400">
                <Clock className="w-3 h-3" />
                <span>Auto-retry in progress with adjusted constraints...</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Image preview dialog */}
      <ImagePreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        imageUrl={previewUrl}
        title={previewTitle}
      />
    </>
  );
}
