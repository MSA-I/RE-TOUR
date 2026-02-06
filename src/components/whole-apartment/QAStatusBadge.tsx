import { memo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  RefreshCw,
  Eye,
  Lock,
  Loader2,
  Cpu,
  Check,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface StructuredQAResult {
  status?: "approved" | "reject" | "pass" | "fail";
  pass?: boolean;
  decision?: "approve" | "reject";
  score?: number;
  confidence_score?: number;
  model_used?: string;
  approval_reasons?: string[];
  failure_categories?: string[];
  rejection_explanation?: string;
  checks_performed?: Array<{
    check: string;
    result: "passed" | "failed";
    observation?: string;
  }>;
  reasons?: Array<{
    code?: string;
    description: string;
    evidence?: string;
    severity?: "critical" | "major" | "minor";
  }>;
  required_changes?: Array<{
    type?: string;
    instruction: string;
    priority?: number;
  }>;
  confidence?: number;
  room_type_check?: {
    passed: boolean;
    expected_type?: string;
    detected_type?: string | null;
    mismatch_evidence?: string;
  };
  adjacency_check?: {
    passed: boolean;
    expected_adjacent_rooms?: string[];
    hallucinated_connections?: string[];
  };
  locks_check?: {
    passed: boolean;
    must_include_violations?: string[];
    must_not_include_violations?: string[];
  };
  attempt_number?: number;
  max_attempts?: number;
  auto_retry?: {
    triggered: boolean;
    blocked_for_human?: boolean;
    message?: string;
  };
}

interface QAStatusBadgeProps {
  status: string;
  qaStatus?: string;
  structuredQaResult?: StructuredQAResult | null;
  /** Fallback model label when structured QA result didn't include model_used */
  modelUsed?: string | null;
  attemptCount?: number;
  maxAttempts?: number;
  isLocked?: boolean;
  onRetry?: () => void;
  isRetrying?: boolean;
  className?: string;
}

// Human-readable labels for failure categories
const FAILURE_CATEGORY_LABELS: Record<string, string> = {
  wrong_room: "Wrong Room",
  wrong_camera_direction: "Wrong Camera Direction",
  hallucinated_opening: "Hallucinated Opening",
  missing_major_furniture: "Missing Furniture",
  extra_major_furniture: "Extra Furniture",
  layout_mismatch: "Layout Mismatch",
  ignored_camera: "Ignored Camera",
  room_type_violation: "Room Type Violation",
  structural_change: "Structural Change",
  seam_artifact: "Seam Artifact",
  perspective_error: "Perspective Error",
  other: "Other Issue",
};

export const QAStatusBadge = memo(function QAStatusBadge({
  status,
  qaStatus,
  structuredQaResult,
  modelUsed: modelUsedProp,
  attemptCount = 1,
  maxAttempts = 5,
  isLocked,
  onRetry,
  isRetrying,
  className,
}: QAStatusBadgeProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);

  // Determine display state
  const isApproved = isLocked || qaStatus === "passed" || qaStatus === "approved" || 
    structuredQaResult?.status === "approved" || structuredQaResult?.pass === true ||
    structuredQaResult?.decision === "approve";
  const isRejected = qaStatus === "failed" || qaStatus === "rejected" || 
    structuredQaResult?.status === "reject" || structuredQaResult?.pass === false ||
    structuredQaResult?.decision === "reject";
  const isBlockedForHuman = status === "blocked_for_human" || 
    (structuredQaResult?.auto_retry?.blocked_for_human === true);
  const isPending = qaStatus === "pending" || !qaStatus;
  const isRunning = status === "running" || status === "generating" || status === "retrying";

  // Get confidence score
  const confidenceScore = structuredQaResult?.confidence_score ?? structuredQaResult?.confidence;
  const modelUsed = structuredQaResult?.model_used ?? modelUsedProp;

  // Get badge styling
  const getBadgeStyle = () => {
    if (isLocked) return "bg-green-500/20 text-green-400 border-green-500/30";
    if (isApproved) return "bg-green-500/20 text-green-400";
    if (isBlockedForHuman) return "bg-orange-500/20 text-orange-400 border-orange-500/30";
    if (isRejected) return "bg-destructive/20 text-destructive";
    if (isRunning) return "bg-blue-500/20 text-blue-400";
    return "bg-muted text-muted-foreground";
  };

  const getBadgeIcon = () => {
    if (isLocked) return <Lock className="w-3 h-3" />;
    if (isApproved) return <CheckCircle2 className="w-3 h-3" />;
    if (isBlockedForHuman) return <AlertCircle className="w-3 h-3" />;
    if (isRejected) return <XCircle className="w-3 h-3" />;
    if (isRunning) return <Loader2 className="w-3 h-3 animate-spin" />;
    return null;
  };

  const getBadgeText = () => {
    if (isLocked) return "Approved";
    if (isApproved) return "QA Passed";
    if (isBlockedForHuman) return `Manual Review (${attemptCount}/${maxAttempts})`;
    if (isRejected) return `QA Failed (${attemptCount}/${maxAttempts})`;
    if (isRunning) return "Running";
    return "Pending";
  };

  const hasDetails = structuredQaResult && (
    structuredQaResult.approval_reasons?.length ||
    structuredQaResult.failure_categories?.length ||
    structuredQaResult.checks_performed?.length ||
    structuredQaResult.reasons?.length || 
    structuredQaResult.required_changes?.length ||
    structuredQaResult.room_type_check ||
    structuredQaResult.adjacency_check ||
    structuredQaResult.locks_check ||
    confidenceScore !== undefined ||
    modelUsed
  );

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogTrigger asChild>
          <Badge 
            className={cn(
              "text-[10px] px-1.5 py-0 cursor-pointer hover:opacity-80 transition-opacity flex items-center gap-1",
              getBadgeStyle()
            )}
          >
            {getBadgeIcon()}
            {getBadgeText()}
            {hasDetails && <Eye className="w-2.5 h-2.5 ml-0.5 opacity-60" />}
          </Badge>
        </DialogTrigger>

        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {getBadgeIcon()}
              QA Validation Details
              <Badge className={getBadgeStyle()}>
                {isApproved ? "Approved" : isRejected ? "Rejected" : "Pending"}
              </Badge>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 text-sm">
            {/* Model Used + Score + Confidence - ALWAYS SHOW */}
            <div className="p-3 rounded-lg bg-muted/30 border border-border/50 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground flex items-center gap-1">
                  <Cpu className="w-3 h-3" />
                  Model
                </span>
                <Badge variant="outline" className="text-[10px] font-mono">
                  {modelUsed || "Unknown"}
                </Badge>
              </div>
              
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Quality Score</span>
                <Badge variant="outline" className={cn(
                  "text-[10px]",
                  (structuredQaResult?.score ?? 0) >= 80 ? "text-green-400" :
                  (structuredQaResult?.score ?? 0) >= 50 ? "text-yellow-400" : "text-destructive"
                )}>
                  {structuredQaResult?.score ?? 0}/100
                </Badge>
              </div>
              
              {confidenceScore !== undefined && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Confidence</span>
                  <Badge variant="outline" className={cn(
                    "text-[10px]",
                    confidenceScore >= 0.8 ? "text-green-400" :
                    confidenceScore >= 0.5 ? "text-yellow-400" : "text-destructive"
                  )}>
                    {(confidenceScore * 100).toFixed(0)}%
                  </Badge>
                </div>
              )}
              
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Attempt</span>
                <Badge variant="outline" className="text-[10px]">
                  {attemptCount}/{maxAttempts}
                </Badge>
              </div>
            </div>

            {/* APPROVAL REASONS (for passed QA) - FULL VISIBILITY */}
            {isApproved && structuredQaResult?.approval_reasons?.length ? (
              <div className="space-y-2">
                <h4 className="font-medium flex items-center gap-2 text-green-400">
                  <CheckCircle2 className="w-4 h-4" />
                  Approval Reasons
                </h4>
                <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/30">
                  <ul className="space-y-2">
                    {structuredQaResult.approval_reasons.map((reason, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-xs">
                        <Check className="w-3 h-3 text-green-400 mt-0.5 flex-shrink-0" />
                        <span className="text-foreground/90">{reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : isApproved ? (
              <div className="space-y-2">
                <h4 className="font-medium flex items-center gap-2 text-muted-foreground">
                  <AlertCircle className="w-4 h-4" />
                  Approval Reasons
                </h4>
                <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
                  <p className="text-xs text-muted-foreground">
                    No approval reasons were returned for this approval. This is treated as an incomplete QA payload.
                  </p>
                </div>
              </div>
            ) : null}

            {/* REJECTION REASONS (for failed QA) - FULL VISIBILITY */}
            {isRejected && (
              <div className="space-y-2">
                <h4 className="font-medium flex items-center gap-2 text-destructive">
                  <XCircle className="w-4 h-4" />
                  Rejection Details
                </h4>
                
                {/* Failure categories */}
                {structuredQaResult?.failure_categories?.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {structuredQaResult.failure_categories.map((cat, idx) => (
                      <Badge 
                        key={idx} 
                        variant="outline" 
                        className="text-[10px] text-destructive border-destructive/50"
                      >
                        {FAILURE_CATEGORY_LABELS[cat] || cat}
                      </Badge>
                    ))}
                  </div>
                ) : null}
                
                {/* Rejection explanation */}
                {structuredQaResult?.rejection_explanation && (
                  <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/30">
                    <p className="text-xs text-foreground/90">
                      {structuredQaResult.rejection_explanation}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* CHECKS PERFORMED - Visual Evidence Grid */}
            {structuredQaResult?.checks_performed?.length ? (
              <div className="space-y-2">
                <h4 className="font-medium">Checks Performed</h4>
                <ScrollArea className="max-h-48">
                  <div className="space-y-1.5">
                    {structuredQaResult.checks_performed.map((check, idx) => (
                      <div 
                        key={idx}
                        className={cn(
                          "p-2 rounded-lg border text-xs",
                          check.result === "passed" 
                            ? "bg-green-500/5 border-green-500/30" 
                            : "bg-destructive/5 border-destructive/30"
                        )}
                      >
                        <div className="flex items-center gap-2">
                          {check.result === "passed" ? (
                            <Check className="w-3 h-3 text-green-400 flex-shrink-0" />
                          ) : (
                            <X className="w-3 h-3 text-destructive flex-shrink-0" />
                          )}
                          <span className="font-medium capitalize">
                            {check.check.replace(/_/g, " ")}
                          </span>
                        </div>
                        {check.observation && (
                          <p className="mt-1 pl-5 text-muted-foreground text-[11px]">
                            {check.observation}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            ) : null}

            {/* Room Type Check */}
            {structuredQaResult?.room_type_check && (
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  {structuredQaResult.room_type_check.passed ? (
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                  ) : (
                    <XCircle className="w-4 h-4 text-destructive" />
                  )}
                  <span className="font-medium">Room Type Check</span>
                </div>
                {!structuredQaResult.room_type_check.passed && (
                  <div className="pl-6 text-muted-foreground text-xs">
                    Expected: {structuredQaResult.room_type_check.expected_type}
                    {structuredQaResult.room_type_check.detected_type && (
                      <>, Detected: {structuredQaResult.room_type_check.detected_type}</>
                    )}
                    {structuredQaResult.room_type_check.mismatch_evidence && (
                      <p className="mt-1">{structuredQaResult.room_type_check.mismatch_evidence}</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Adjacency Check */}
            {structuredQaResult?.adjacency_check && (
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  {structuredQaResult.adjacency_check.passed ? (
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                  ) : (
                    <XCircle className="w-4 h-4 text-destructive" />
                  )}
                  <span className="font-medium">Adjacency Check</span>
                </div>
                {structuredQaResult.adjacency_check.hallucinated_connections?.length ? (
                  <div className="pl-6 text-destructive text-xs">
                    <span className="font-medium">Hallucinated connections:</span>{" "}
                    {structuredQaResult.adjacency_check.hallucinated_connections.join(", ")}
                  </div>
                ) : null}
                {structuredQaResult.adjacency_check.expected_adjacent_rooms?.length ? (
                  <div className="pl-6 text-muted-foreground text-xs">
                    <span className="font-medium">Expected adjacent rooms:</span>{" "}
                    {structuredQaResult.adjacency_check.expected_adjacent_rooms.join(", ")}
                  </div>
                ) : null}
              </div>
            )}

            {/* Locks Check */}
            {structuredQaResult?.locks_check && (
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  {structuredQaResult.locks_check.passed ? (
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                  ) : (
                    <XCircle className="w-4 h-4 text-destructive" />
                  )}
                  <span className="font-medium">Furniture Locks</span>
                </div>
                {structuredQaResult.locks_check.must_include_violations?.length ? (
                  <div className="pl-6 text-destructive text-xs">
                    <span className="font-medium">Missing:</span>{" "}
                    {structuredQaResult.locks_check.must_include_violations.join(", ")}
                  </div>
                ) : null}
                {structuredQaResult.locks_check.must_not_include_violations?.length ? (
                  <div className="pl-6 text-destructive text-xs">
                    <span className="font-medium">Should not include:</span>{" "}
                    {structuredQaResult.locks_check.must_not_include_violations.join(", ")}
                  </div>
                ) : null}
              </div>
            )}

            {/* Legacy Reasons (backward compatibility) */}
            {structuredQaResult?.reasons?.length && !structuredQaResult.failure_categories?.length ? (
              <div className="space-y-2">
                <h4 className="font-medium">Issues Found</h4>
                <div className="space-y-2">
                  {structuredQaResult.reasons.map((reason, idx) => (
                    <div 
                      key={idx} 
                      className={cn(
                        "p-2 rounded-lg border text-xs",
                        reason.severity === "critical" ? "border-destructive/50 bg-destructive/10" :
                        reason.severity === "major" ? "border-orange-500/50 bg-orange-500/10" :
                        "border-border"
                      )}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Badge 
                          variant="outline" 
                          className={cn(
                            "text-[9px]",
                            reason.severity === "critical" ? "text-destructive" :
                            reason.severity === "major" ? "text-orange-400" : ""
                          )}
                        >
                          {reason.code || reason.severity || "issue"}
                        </Badge>
                      </div>
                      <p>{reason.description}</p>
                      {reason.evidence && (
                        <p className="text-muted-foreground mt-1 italic">
                          Evidence: {reason.evidence}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Required Changes */}
            {structuredQaResult?.required_changes?.length ? (
              <div className="space-y-2">
                <h4 className="font-medium">Required Changes for Retry</h4>
                <div className="space-y-1">
                  {structuredQaResult.required_changes.map((change, idx) => (
                    <div 
                      key={idx} 
                      className="flex items-start gap-2 text-xs p-2 bg-muted/30 rounded"
                    >
                      <Badge variant="outline" className="text-[9px] flex-shrink-0">
                        {change.type || `P${change.priority || idx + 1}`}
                      </Badge>
                      <span>{change.instruction}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Auto-retry status */}
            {structuredQaResult?.auto_retry && (
              <div className={cn(
                "p-2 rounded-lg text-xs",
                structuredQaResult.auto_retry.blocked_for_human 
                  ? "bg-orange-500/10 border border-orange-500/30" 
                  : structuredQaResult.auto_retry.triggered 
                    ? "bg-blue-500/10 border border-blue-500/30"
                    : "bg-muted"
              )}>
                <span className="font-medium">Auto-retry: </span>
                {structuredQaResult.auto_retry.message || 
                  (structuredQaResult.auto_retry.triggered ? "Retry triggered" : "Not triggered")}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Retry button for blocked or failed states */}
      {(isBlockedForHuman || isRejected) && onRetry && attemptCount < maxAttempts && (
        <Button
          size="sm"
          variant="ghost"
          className="h-5 px-1.5 text-[10px]"
          onClick={onRetry}
          disabled={isRetrying}
        >
          {isRetrying ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <>
              <RefreshCw className="w-3 h-3 mr-1" />
              Retry
            </>
          )}
        </Button>
      )}
    </div>
  );
});