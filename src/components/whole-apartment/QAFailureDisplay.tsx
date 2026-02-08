import { memo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  AlertCircle,
  Info,
  XCircle,
  RefreshCw,
  Square,
  CheckCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useState } from "react";

// ============================================================================
// Types matching the backend schema
// ============================================================================

export type QAReasonCode = 
  | "INVALID_INPUT"
  | "MISSING_SPACE"
  | "DUPLICATED_OBJECTS"
  | "GEOMETRY_DISTORTION"
  | "WRONG_ROOM_TYPE"
  | "LOW_CONFIDENCE"
  | "AMBIGUOUS_CLASSIFICATION"
  | "SCALE_MISMATCH"
  | "FURNITURE_MISMATCH"
  | "STYLE_INCONSISTENCY"
  | "WALL_RECTIFICATION"
  | "MISSING_FURNISHINGS"
  | "RESOLUTION_MISMATCH"
  | "SEAM_ARTIFACTS"
  | "COLOR_INCONSISTENCY"
  | "PERSPECTIVE_ERROR"
  | "SCHEMA_INVALID"
  | "API_ERROR"
  | "TIMEOUT"
  | "UNKNOWN";

export type RetrySuggestionType = 
  | "prompt_delta"
  | "settings_delta"
  | "seed_change"
  | "input_change"
  | "manual_review";

export type Severity = "low" | "medium" | "high" | "critical";

export interface QAReasonDetail {
  code: QAReasonCode;
  description: string;
}

export interface QAEvidence {
  observation: string;
  location?: string;
  confidence?: number;
}

export interface QARetrySuggestion {
  type: RetrySuggestionType;
  instruction: string;
  priority?: number;
}

export interface StructuredQAResult {
  status: "PASS" | "FAIL";
  reason_short: string;
  reasons: QAReasonDetail[];
  evidence: QAEvidence[];
  severity: Severity;
  retry_suggestion: QARetrySuggestion;
  confidence_score: number;
  debug_context?: {
    model_used?: string;
    processing_time_ms?: number;
    input_hash?: string;
    attempt_number?: number;
  };
}

export interface RetryState {
  auto_retry_enabled: boolean;
  attempt_count: number;
  max_attempts: number;
  is_retrying: boolean;
  next_retry_in_seconds?: number;
}

// ============================================================================
// Severity Configuration
// ============================================================================

const SEVERITY_CONFIG: Record<Severity, { 
  label: string; 
  icon: React.ElementType; 
  className: string;
  bgClass: string;
}> = {
  low: {
    label: "Low",
    icon: Info,
    className: "text-blue-400",
    bgClass: "bg-blue-500/10 border-blue-500/30",
  },
  medium: {
    label: "Medium",
    icon: AlertCircle,
    className: "text-yellow-400",
    bgClass: "bg-yellow-500/10 border-yellow-500/30",
  },
  high: {
    label: "High",
    icon: AlertTriangle,
    className: "text-orange-400",
    bgClass: "bg-orange-500/10 border-orange-500/30",
  },
  critical: {
    label: "Critical",
    icon: XCircle,
    className: "text-destructive",
    bgClass: "bg-destructive/10 border-destructive/30",
  },
};

const REASON_CODE_LABELS: Record<QAReasonCode, string> = {
  INVALID_INPUT: "Invalid Input",
  MISSING_SPACE: "Missing Space",
  DUPLICATED_OBJECTS: "Duplicated Objects",
  GEOMETRY_DISTORTION: "Geometry Distortion",
  WRONG_ROOM_TYPE: "Wrong Room Type",
  LOW_CONFIDENCE: "Low Confidence",
  AMBIGUOUS_CLASSIFICATION: "Ambiguous Classification",
  SCALE_MISMATCH: "Scale Mismatch",
  FURNITURE_MISMATCH: "Furniture Mismatch",
  STYLE_INCONSISTENCY: "Style Inconsistency",
  WALL_RECTIFICATION: "Wall Rectification",
  MISSING_FURNISHINGS: "Missing Furnishings",
  RESOLUTION_MISMATCH: "Resolution Mismatch",
  SEAM_ARTIFACTS: "Seam Artifacts",
  COLOR_INCONSISTENCY: "Color Inconsistency",
  PERSPECTIVE_ERROR: "Perspective Error",
  SCHEMA_INVALID: "Schema Invalid",
  API_ERROR: "API Error",
  TIMEOUT: "Timeout",
  UNKNOWN: "Unknown Issue",
};

const SUGGESTION_TYPE_LABELS: Record<RetrySuggestionType, string> = {
  prompt_delta: "Adjust Prompt",
  settings_delta: "Change Settings",
  seed_change: "New Random Seed",
  input_change: "Different Input",
  manual_review: "Manual Review Required",
};

// ============================================================================
// Component Props
// ============================================================================

export interface QAFailureDisplayProps {
  qaResult: StructuredQAResult;
  retryState: RetryState;
  stepNumber: number;
  stepName: string;
  onStopAutoRetry?: () => void;
  onRetryNow?: () => void;
  onApproveManually?: () => void;
  showApproveManually?: boolean;
  className?: string;
  collapsed?: boolean;
}

// ============================================================================
// Main Component
// ============================================================================

export const QAFailureDisplay = memo(function QAFailureDisplay({
  qaResult,
  retryState,
  stepNumber,
  stepName,
  onStopAutoRetry,
  onRetryNow,
  onApproveManually,
  showApproveManually = false,
  className,
  collapsed: defaultCollapsed = false,
}: QAFailureDisplayProps) {
  const [isExpanded, setIsExpanded] = useState(!defaultCollapsed);
  const severity = SEVERITY_CONFIG[qaResult.severity];
  const SeverityIcon = severity.icon;

  // If PASS, show simple success
  if (qaResult.status === "PASS") {
    return (
      <div className={cn("p-3 rounded-lg border bg-primary/10 border-primary/30", className)}>
        <div className="flex items-center gap-2">
          <CheckCircle className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium text-primary">AI-QA Passed</span>
          <span className="text-xs text-muted-foreground">
            Confidence: {Math.round(qaResult.confidence_score * 100)}%
          </span>
        </div>
        {qaResult.reason_short && (
          <p className="text-xs text-muted-foreground mt-1">{qaResult.reason_short}</p>
        )}
      </div>
    );
  }

  return (
    <Card className={cn("border", severity.bgClass, className)}>
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CardHeader className="p-3 pb-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <SeverityIcon className={cn("w-4 h-4 flex-shrink-0", severity.className)} />
              <CardTitle className="text-sm font-semibold">
                AI-QA Rejection Reason
              </CardTitle>
              <Badge variant="outline" className={cn("text-xs", severity.className)}>
                {severity.label} Severity
              </Badge>
            </div>
            
            <div className="flex items-center gap-2 flex-shrink-0">
              {/* Attempt Counter */}
              <Badge variant="secondary" className="text-xs">
                Attempt {retryState.attempt_count} / {retryState.max_attempts}
              </Badge>
              
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6">
                  {isExpanded ? (
                    <ChevronUp className="h-3 w-3" />
                  ) : (
                    <ChevronDown className="h-3 w-3" />
                  )}
                </Button>
              </CollapsibleTrigger>
            </div>
          </div>
          
          {/* Primary Reason - Always Visible */}
          <p className="text-sm text-foreground mt-2">
            {qaResult.reason_short}
          </p>
          
          {/* Auto-Retry Status - Always Visible */}
          {retryState.auto_retry_enabled && retryState.attempt_count < retryState.max_attempts && (
            <div className="flex items-center gap-2 mt-2">
              {retryState.is_retrying ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin text-blue-400" />
                  <span className="text-xs text-blue-400">Auto re-render in progress…</span>
                </>
              ) : retryState.next_retry_in_seconds !== undefined ? (
                <>
                  <RefreshCw className="w-3 h-3 text-yellow-400" />
                  <span className="text-xs text-yellow-400">
                    Auto re-render in {retryState.next_retry_in_seconds}s…
                  </span>
                </>
              ) : null}
            </div>
          )}
        </CardHeader>
        
        <CollapsibleContent>
          <CardContent className="p-3 pt-0 space-y-3">
            <Separator />
            
            {/* Detailed Reasons */}
            {qaResult.reasons.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
                  Failure Details
                </h4>
                <ul className="space-y-1.5">
                  {qaResult.reasons.map((reason, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm">
                      <Badge variant="outline" className="text-xs flex-shrink-0 mt-0.5">
                        {REASON_CODE_LABELS[reason.code] || reason.code}
                      </Badge>
                      <span className="text-muted-foreground">{reason.description}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            
            {/* Evidence */}
            {qaResult.evidence.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
                  Evidence
                </h4>
                <ul className="space-y-1">
                  {qaResult.evidence.map((ev, idx) => (
                    <li key={idx} className="text-xs text-muted-foreground flex items-start gap-1">
                      <span className="text-muted-foreground/50">•</span>
                      <span>
                        {ev.observation}
                        {ev.location && (
                          <span className="text-muted-foreground/70"> ({ev.location})</span>
                        )}
                        {ev.confidence !== undefined && (
                          <span className="text-muted-foreground/70">
                            {" "}— {Math.round(ev.confidence * 100)}% confidence
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            
            {/* Retry Suggestion */}
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
                Suggested Fix
              </h4>
              <div className="flex items-start gap-2">
                <Badge variant="secondary" className="text-xs flex-shrink-0">
                  {SUGGESTION_TYPE_LABELS[qaResult.retry_suggestion.type]}
                </Badge>
                <p className="text-sm text-muted-foreground">
                  {qaResult.retry_suggestion.instruction}
                </p>
              </div>
            </div>
            
            {/* Confidence Score */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>QA Confidence:</span>
              <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden max-w-24">
                <div 
                  className={cn(
                    "h-full rounded-full",
                    qaResult.confidence_score >= 0.8 ? "bg-primary" :
                    qaResult.confidence_score >= 0.5 ? "bg-yellow-500" : "bg-orange-500"
                  )}
                  style={{ width: `${qaResult.confidence_score * 100}%` }}
                />
              </div>
              <span>{Math.round(qaResult.confidence_score * 100)}%</span>
            </div>
            
            {/* Debug Context (if available) */}
            {qaResult.debug_context && (
              <div className="text-xs text-muted-foreground/70 space-x-3">
                {qaResult.debug_context.model_used && (
                  <span>Model: {qaResult.debug_context.model_used}</span>
                )}
                {qaResult.debug_context.processing_time_ms && (
                  <span>Time: {qaResult.debug_context.processing_time_ms}ms</span>
                )}
              </div>
            )}
            
            <Separator />
            
            {/* Action Buttons */}
            <div className="flex items-center gap-2 flex-wrap">
              {retryState.auto_retry_enabled && onStopAutoRetry && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onStopAutoRetry}
                  className="text-xs"
                >
                  <Square className="w-3 h-3 mr-1" />
                  Stop Auto Retry
                </Button>
              )}
              
              {onRetryNow && retryState.attempt_count < retryState.max_attempts && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onRetryNow}
                  disabled={retryState.is_retrying}
                  className="text-xs"
                >
                  <RefreshCw className={cn("w-3 h-3 mr-1", retryState.is_retrying && "animate-spin")} />
                  Retry Now
                </Button>
              )}
              
              {showApproveManually && onApproveManually && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onApproveManually}
                  className="text-xs text-yellow-400 border-yellow-500/50 hover:bg-yellow-500/10"
                >
                  <CheckCircle className="w-3 h-3 mr-1" />
                  Approve Manually
                </Button>
              )}
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
});

// ============================================================================
// Compact Badge for Collapsed Views
// ============================================================================

export interface QAFailureBadgeProps {
  qaResult: StructuredQAResult;
  attemptCount: number;
  maxAttempts: number;
  onClick?: () => void;
  className?: string;
}

export const QAFailureBadge = memo(function QAFailureBadge({
  qaResult,
  attemptCount,
  maxAttempts,
  onClick,
  className,
}: QAFailureBadgeProps) {
  const severity = SEVERITY_CONFIG[qaResult.severity];
  const SeverityIcon = severity.icon;

  if (qaResult.status === "PASS") {
    return (
      <Badge 
        variant="outline" 
        className={cn("text-xs bg-primary/10 text-primary border-primary/30 cursor-pointer", className)}
        onClick={onClick}
      >
        <CheckCircle className="w-3 h-3 mr-1" />
        QA Passed
      </Badge>
    );
  }

  return (
    <Badge 
      variant="outline" 
      className={cn(
        "text-xs cursor-pointer gap-1",
        severity.className,
        severity.bgClass,
        className
      )}
      onClick={onClick}
    >
      <SeverityIcon className="w-3 h-3" />
      AI-QA Fail ({attemptCount}/{maxAttempts})
    </Badge>
  );
});

// ============================================================================
// Helper to parse legacy QA reports into StructuredQAResult
// ============================================================================

export function parseQAReport(
  report: Record<string, unknown> | null | undefined,
  qaStatus?: string | null
): StructuredQAResult | null {
  if (!report) return null;

  // Check if it's already a structured result
  if (report.status === "PASS" || report.status === "FAIL") {
    return report as unknown as StructuredQAResult;
  }

  // Legacy format conversion
  const decision = (report.decision as string) || qaStatus || "unknown";
  const reason = (report.reason as string) || (report.qa_reason as string) || "";
  const pass = decision === "approved" || decision === "passed" || report.pass === true;

  if (pass) {
    return {
      status: "PASS",
      reason_short: reason || "All checks passed",
      reasons: [],
      evidence: [],
      severity: "low",
      retry_suggestion: { type: "prompt_delta", instruction: "No changes needed" },
      confidence_score: 0.95,
    };
  }

  // Extract reasons from legacy format
  const reasons: QAReasonDetail[] = [];
  
  if (report.bed_size_issues && Array.isArray(report.bed_size_issues)) {
    reasons.push({
      code: "FURNITURE_MISMATCH",
      description: (report.bed_size_issues as string[]).join("; "),
    });
  }
  
  if (report.scale_check === "failed") {
    reasons.push({
      code: "SCALE_MISMATCH",
      description: "Scale validation failed",
    });
  }
  
  if (report.geometry_check === "failed") {
    reasons.push({
      code: "GEOMETRY_DISTORTION",
      description: "Geometry validation failed",
    });
  }
  
  if (report.furniture_check === "failed") {
    reasons.push({
      code: "FURNITURE_MISMATCH",
      description: "Furniture validation failed",
    });
  }

  // If no specific reasons found, create a generic one
  if (reasons.length === 0 && reason) {
    reasons.push({
      code: "UNKNOWN",
      description: reason,
    });
  }

  return {
    status: "FAIL",
    reason_short: reason || "QA validation failed",
    reasons,
    evidence: [],
    severity: "medium",
    retry_suggestion: {
      type: "prompt_delta",
      instruction: "Review and adjust generation parameters",
    },
    confidence_score: 0.75,
  };
}
