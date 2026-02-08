import { memo, useState, useCallback, ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  Check,
  AlertTriangle,
  Clock,
  Lock,
  HandMetal,
} from "lucide-react";

export type StepStatus = 
  | "pending"
  | "running"
  | "review"
  | "approved"
  | "rejected"
  | "failed"
  | "blocked"
  | "completed"
  | "stalled";

interface CollapsibleStepPanelProps {
  /** Step number (1, 2, 3, etc.) */
  stepNumber: number;
  /** Title of the step */
  title: string;
  /** Icon to show next to the title */
  icon?: ReactNode;
  /** Current status of the step */
  status: StepStatus;
  /** Whether the step is currently expanded */
  defaultExpanded?: boolean;
  /** Optional: approval progress (X approved / Y total) */
  approvalProgress?: { approved: number; total: number };
  /** Optional: quality tier badge */
  quality?: string;
  /** Optional: whether quality is locked */
  qualityLocked?: boolean;
  /** Optional: last activity timestamp */
  lastActivity?: string;
  /** Optional: action slot for right side (e.g., Continue button) */
  actionSlot?: ReactNode;
  /** Optional: reset slot for step-specific reset button */
  resetSlot?: ReactNode;
  /** Optional: footer slot for step controls (Reset + Back buttons) */
  footerSlot?: ReactNode;
  /** Children to render in expanded state */
  children: ReactNode;
  /** Unique key for storing collapsed state */
  storageKey?: string;
}

// Status to badge mapping
function getStatusBadge(status: StepStatus) {
  switch (status) {
    case "pending":
      return null;
    case "running":
      return (
        <Badge className="bg-blue-500/20 text-blue-400 text-xs">
          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
          Running
        </Badge>
      );
    case "review":
      return (
        <Badge className="bg-yellow-500/20 text-yellow-400 text-xs">
          <Clock className="w-3 h-3 mr-1" />
          Review
        </Badge>
      );
    case "approved":
    case "completed":
      return (
        <Badge className="bg-primary/20 text-primary text-xs">
          <Check className="w-3 h-3 mr-1" />
          Done
        </Badge>
      );
    case "rejected":
    case "failed":
      return (
        <Badge className="bg-destructive/20 text-destructive text-xs">
          <AlertTriangle className="w-3 h-3 mr-1" />
          Failed
        </Badge>
      );
    case "blocked":
      return (
        <Badge className="bg-destructive/20 text-destructive text-xs">
          <HandMetal className="w-3 h-3 mr-1" />
          Blocked
        </Badge>
      );
    case "stalled":
      return (
        <Badge className="bg-warning/20 text-warning text-xs">
          <AlertTriangle className="w-3 h-3 mr-1" />
          Stalled
        </Badge>
      );
    default:
      return null;
  }
}

export const CollapsibleStepPanel = memo(function CollapsibleStepPanel({
  stepNumber,
  title,
  icon,
  status,
  defaultExpanded = true,
  approvalProgress,
  quality,
  qualityLocked,
  lastActivity,
  actionSlot,
  resetSlot,
  footerSlot,
  children,
  storageKey,
}: CollapsibleStepPanelProps) {
  // Use localStorage to persist collapsed state per step
  const [isExpanded, setIsExpanded] = useState(() => {
    if (storageKey) {
      const saved = localStorage.getItem(`step-panel-${storageKey}`);
      return saved !== null ? saved === "true" : defaultExpanded;
    }
    return defaultExpanded;
  });

  const toggleExpanded = useCallback(() => {
    setIsExpanded((prev) => {
      const next = !prev;
      if (storageKey) {
        localStorage.setItem(`step-panel-${storageKey}`, String(next));
      }
      return next;
    });
  }, [storageKey]);

  const statusBadge = getStatusBadge(status);
  const isCompleted = status === "approved" || status === "completed";

  return (
    <div
      className={cn(
        "rounded-lg border overflow-hidden transition-colors",
        isCompleted ? "border-primary/30 bg-primary/5" : "border-border/50 bg-card/50"
      )}
    >
      {/* Clickable Header */}
      <button
        type="button"
        onClick={toggleExpanded}
        className={cn(
          "w-full flex items-center justify-between p-3 text-left transition-colors",
          "hover:bg-muted/30 cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/20 focus:ring-inset"
        )}
        aria-expanded={isExpanded}
      >
        <div className="flex items-center gap-3 min-w-0">
          {/* Chevron indicator */}
          <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center text-muted-foreground">
            {isExpanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </div>

          {/* Icon */}
          {icon && <div className="flex-shrink-0">{icon}</div>}

          {/* Title and step number */}
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{title}</p>
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-xs text-muted-foreground">Step {stepNumber}</p>
              {quality && (
                <Badge variant="outline" className="text-xs px-1.5 py-0">
                  {qualityLocked && <Lock className="w-2.5 h-2.5 mr-0.5" />}
                  {quality}
                </Badge>
              )}
            </div>
          </div>
        </div>

        {/* Right side: reset slot, action slot, status, progress, badges */}
        <div className="flex items-center gap-2 flex-shrink-0 min-w-[100px] justify-end">
          {/* Reset step slot (e.g., Stop & Reset button) */}
          {resetSlot && (
            <div onClick={(e) => e.stopPropagation()}>
              {resetSlot}
            </div>
          )}

          {/* Custom action slot (e.g., Continue button) */}
          {actionSlot && (
            <div onClick={(e) => e.stopPropagation()}>
              {actionSlot}
            </div>
          )}

          {/* Approval progress (collapsed view) */}
          {!isExpanded && approvalProgress && approvalProgress.total > 0 && (
            <span className="text-xs text-muted-foreground">
              {approvalProgress.approved}/{approvalProgress.total}
            </span>
          )}

          {/* Status badge */}
          {statusBadge}
        </div>
      </button>

      {/* Collapsible Content */}
      {isExpanded && (
        <div className="border-t border-border/30">
          <div className="p-3">
            {children}
          </div>
          {/* Footer slot (Reset + Back buttons) */}
          {footerSlot && (
            <div className="px-3 pb-3">
              {footerSlot}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export default CollapsibleStepPanel;
