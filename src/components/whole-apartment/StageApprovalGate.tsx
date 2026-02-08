import { memo, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
  ArrowRight, 
  Check, 
  AlertTriangle, 
  Loader2,
  Lock,
  ThumbsUp,
  HandMetal 
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { PipelineSpace, SpaceRender, SpacePanorama, SpaceFinal360 } from "@/hooks/useWholeApartmentPipeline";

// ============= Approval Status Types =============
export type ApprovalStatus = 
  | "pending_review"
  | "approved_ai"
  | "approved_human"
  | "rejected"
  | "blocked_for_manual_approval"
  | "running";

export interface ApprovalSummary {
  total: number;
  approved: number;  // approved_ai OR approved_human
  pending: number;
  rejected: number;
  blocked: number;
  running: number;
  isComplete: boolean;
}

// ============= Helper Functions =============

/**
 * Derive approval status from an asset's fields
 * Priority: locked_approved (human) > qa_status passed (AI) > status checks
 */
function getApprovalStatus(asset: {
  status: string;
  locked_approved?: boolean;
  qa_status?: string;
} | null | undefined): ApprovalStatus {
  if (!asset) return "pending_review";
  
  // Human approval is authoritative (locked_approved = true)
  if (asset.locked_approved === true) {
    return "approved_human";
  }
  
  // Check for blocked state (max retries exhausted)
  if (asset.status === "blocked_for_human" || asset.status === "blocked_for_manual_approval") {
    return "blocked_for_manual_approval";
  }
  
  // Check for running/in-progress states
  if (["generating", "running", "retrying", "processing"].includes(asset.status)) {
    return "running";
  }
  
  // Check for rejection
  if (asset.status === "rejected" || asset.status === "qa_failed" || asset.status === "failed") {
    return "rejected";
  }
  
  // AI approval (passed QA but not manually approved yet)
  if (asset.qa_status === "passed" || asset.qa_status === "approved") {
    return "approved_ai";
  }
  
  // If status is "approved" but not locked, treat as AI-approved pending human gate
  if (asset.status === "approved" || asset.status === "needs_review") {
    return "approved_ai";
  }
  
  return "pending_review";
}

/**
 * Check if an approval status counts as "approved" (AI or human)
 */
function isApproved(status: ApprovalStatus): boolean {
  return status === "approved_ai" || status === "approved_human";
}

// ============= Summary Computation =============

export function computeRenderApprovalSummary(
  spaces: PipelineSpace[]
): ApprovalSummary {
  const activeSpaces = spaces.filter(s => !s.is_excluded && s.include_in_generation !== false);
  const total = activeSpaces.length * 2; // A and B for each space
  
  let approved = 0;
  let pending = 0;
  let rejected = 0;
  let blocked = 0;
  let running = 0;
  
  for (const space of activeSpaces) {
    const renderA = space.renders?.find(r => r.kind === "A");
    const renderB = space.renders?.find(r => r.kind === "B");
    
    for (const render of [renderA, renderB]) {
      const status = getApprovalStatus(render);
      if (isApproved(status)) approved++;
      else if (status === "blocked_for_manual_approval") blocked++;
      else if (status === "rejected") rejected++;
      else if (status === "running") running++;
      else pending++;
    }
  }
  
  return {
    total,
    approved,
    pending,
    rejected,
    blocked,
    running,
    isComplete: total > 0 && approved === total,
  };
}

export function computePanoramaApprovalSummary(
  spaces: PipelineSpace[]
): ApprovalSummary {
  const activeSpaces = spaces.filter(s => !s.is_excluded && s.include_in_generation !== false);
  const total = activeSpaces.length * 2; // A and B for each space
  
  let approved = 0;
  let pending = 0;
  let rejected = 0;
  let blocked = 0;
  let running = 0;
  
  for (const space of activeSpaces) {
    const panoA = space.panoramas?.find(p => p.kind === "A");
    const panoB = space.panoramas?.find(p => p.kind === "B");
    
    for (const pano of [panoA, panoB]) {
      const status = getApprovalStatus(pano);
      if (isApproved(status)) approved++;
      else if (status === "blocked_for_manual_approval") blocked++;
      else if (status === "rejected") rejected++;
      else if (status === "running") running++;
      else pending++;
    }
  }
  
  return {
    total,
    approved,
    pending,
    rejected,
    blocked,
    running,
    isComplete: total > 0 && approved === total,
  };
}

export function computeFinal360ApprovalSummary(
  spaces: PipelineSpace[]
): ApprovalSummary {
  const activeSpaces = spaces.filter(s => !s.is_excluded && s.include_in_generation !== false);
  const total = activeSpaces.length; // 1 per space
  
  let approved = 0;
  let pending = 0;
  let rejected = 0;
  let blocked = 0;
  let running = 0;
  
  for (const space of activeSpaces) {
    const status = getApprovalStatus(space.final360);
    if (isApproved(status)) approved++;
    else if (status === "blocked_for_manual_approval") blocked++;
    else if (status === "rejected") rejected++;
    else if (status === "running") running++;
    else pending++;
  }
  
  return {
    total,
    approved,
    pending,
    rejected,
    blocked,
    running,
    isComplete: total > 0 && approved === total,
  };
}

// ============= Component Props =============

interface StageApprovalGateProps {
  stage: "renders" | "panoramas" | "final360";
  spaces: PipelineSpace[];
  onContinue: () => void;
  isPending?: boolean;
  disabled?: boolean;
  nextStageLabel?: string;
}

// ============= Main Component =============

export const StageApprovalGate = memo(function StageApprovalGate({
  stage,
  spaces,
  onContinue,
  isPending = false,
  disabled = false,
  nextStageLabel,
}: StageApprovalGateProps) {
  const summary = useMemo(() => {
    switch (stage) {
      case "renders":
        return computeRenderApprovalSummary(spaces);
      case "panoramas":
        return computePanoramaApprovalSummary(spaces);
      case "final360":
        return computeFinal360ApprovalSummary(spaces);
    }
  }, [stage, spaces]);
  
  const stageDisplayName = useMemo(() => {
    switch (stage) {
      case "renders": return "Renders";
      case "panoramas": return "Panoramas";
      case "final360": return "Final 360s";
    }
  }, [stage]);
  
  const nextLabel = nextStageLabel || (
    stage === "renders" ? "Continue to Panoramas" :
    stage === "panoramas" ? "Continue to Merge" :
    "Complete Pipeline"
  );
  
  const progressPercent = summary.total > 0 
    ? Math.round((summary.approved / summary.total) * 100) 
    : 0;
  
  const hasBlockedItems = summary.blocked > 0;
  const hasRunningItems = summary.running > 0;
  const hasPendingReview = summary.pending > 0 || summary.rejected > 0;
  
  // Gate logic: ONLY show continue button when ALL are approved
  const canContinue = summary.isComplete && !disabled && !isPending;
  
  return (
    <div className="space-y-3 p-4 rounded-lg bg-muted/30 border border-border/50">
      {/* Header with approval stats */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{stageDisplayName} Approval</span>
          {summary.isComplete && (
            <Badge className="bg-primary/20 text-primary text-xs">
              <Check className="w-3 h-3 mr-1" />
              Complete
            </Badge>
          )}
        </div>
        
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">
            Approved: <span className="font-medium text-primary">{summary.approved}</span> / {summary.total}
          </span>
          
          {hasBlockedItems && (
            <Badge variant="destructive" className="text-xs">
              <AlertTriangle className="w-3 h-3 mr-1" />
              {summary.blocked} need manual approval
            </Badge>
          )}
        </div>
      </div>
      
      {/* Progress bar */}
      <Progress value={progressPercent} className="h-2" />
      
      {/* Status breakdown */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        {summary.approved > 0 && (
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-primary" />
            <span>{summary.approved} approved</span>
          </div>
        )}
        {summary.running > 0 && (
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
            <span>{summary.running} running</span>
          </div>
        )}
        {summary.pending > 0 && (
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-muted-foreground/30" />
            <span>{summary.pending} pending</span>
          </div>
        )}
        {summary.rejected > 0 && (
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-destructive/70" />
            <span>{summary.rejected} rejected</span>
          </div>
        )}
        {summary.blocked > 0 && (
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-destructive" />
            <span>{summary.blocked} blocked</span>
          </div>
        )}
      </div>
      
      {/* Continue button OR status message */}
      <div className="pt-2">
        {canContinue ? (
          <Button 
            onClick={onContinue} 
            disabled={isPending}
            className="w-full"
          >
            {isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <ArrowRight className="w-4 h-4 mr-2" />
            )}
            {nextLabel}
          </Button>
        ) : (
        <div className={cn(
            "flex items-center justify-center gap-2 py-2 px-4 rounded-md text-sm",
            hasBlockedItems 
              ? "bg-destructive/10 text-destructive border border-destructive/30"
              : hasRunningItems
              ? "bg-accent/10 text-accent-foreground border border-accent/30"
              : "bg-muted text-muted-foreground"
          )}>
            {hasBlockedItems ? (
              <>
                <HandMetal className="w-4 h-4" />
                <span>Manual approvals required: {summary.blocked}</span>
              </>
            ) : hasRunningItems ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Processing {summary.running} items...</span>
              </>
            ) : (
              <>
                <Lock className="w-4 h-4" />
                <span>Approve all {stageDisplayName.toLowerCase()} to continue</span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

export default StageApprovalGate;
