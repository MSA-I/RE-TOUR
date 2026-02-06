import { memo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ThumbsUp,
  ThumbsDown,
  ChevronDown,
  Brain,
  Check,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type QAFeedbackCategory =
  | "furniture_scale"
  | "extra_furniture"
  | "structural_change"
  | "flooring_mismatch"
  | "seam_artifact"
  | "perspective_error"
  | "room_type_violation"
  | "placement_logic"
  | "other";

const CATEGORY_OPTIONS: { value: QAFeedbackCategory; label: string; description: string }[] = [
  { value: "furniture_scale", label: "Furniture Scale", description: "Furniture size doesn't match room proportions" },
  { value: "extra_furniture", label: "Extra Furniture", description: "Furniture added that wasn't in floor plan" },
  { value: "structural_change", label: "Structural Change", description: "Walls, doors, or windows modified" },
  { value: "flooring_mismatch", label: "Flooring Mismatch", description: "Floor type inconsistent with room" },
  { value: "seam_artifact", label: "Seam/Artifact", description: "Visible seams, ghosting, or distortion" },
  { value: "perspective_error", label: "Perspective Error", description: "Wrong viewpoint or fisheye effect" },
  { value: "room_type_violation", label: "Room Type Violation", description: "Wrong fixtures for room type (e.g., toilet in bedroom)" },
  { value: "placement_logic", label: "Placement Logic", description: "Items blocking paths or placed illogically" },
  { value: "other", label: "Other", description: "Other quality issue" },
];

interface QALearningFeedbackPanelProps {
  /** Asset ID (render, panorama, or final360) */
  assetId: string;
  /** Type of asset */
  assetType: "render" | "panorama" | "final360";
  /** Step number (5, 6, or 7) */
  stepNumber: number;
  /** Current QA status from AI */
  aiQaStatus: "approved" | "rejected" | "pending";
  /** AI's rejection reasons if any */
  aiRejectionReasons?: string[];
  /** Current attempt number */
  attemptNumber: number;
  /** Max attempts allowed */
  maxAttempts?: number;
  /** Is already approved by human? */
  isHumanApproved?: boolean;
  /** Callback when user approves */
  onApprove: (feedback?: { category?: QAFeedbackCategory; comment?: string }) => void;
  /** Callback when user rejects */
  onReject: (feedback: { category: QAFeedbackCategory; reason: string }) => void;
  /** Is submission in progress? */
  isSubmitting?: boolean;
  /** Is asset locked (no more actions allowed)? */
  isLocked?: boolean;
}

/**
 * QA Learning Feedback Panel
 * 
 * For Steps 5-7, provides:
 * - AI-QA status display with reasons
 * - Manual Approve/Reject buttons with required reason on reject
 * - Feedback that "learns" from both outcomes (stored for prompt improvement)
 * - Attempt counter showing retry progress
 */
export const QALearningFeedbackPanel = memo(function QALearningFeedbackPanel({
  assetId,
  assetType,
  stepNumber,
  aiQaStatus,
  aiRejectionReasons = [],
  attemptNumber,
  maxAttempts = 5,
  isHumanApproved = false,
  onApprove,
  onReject,
  isSubmitting = false,
  isLocked = false,
}: QALearningFeedbackPanelProps) {
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<QAFeedbackCategory>("other");
  const [rejectReason, setRejectReason] = useState("");
  const [showApprovalFeedback, setShowApprovalFeedback] = useState(false);
  const [approvalCategory, setApprovalCategory] = useState<QAFeedbackCategory | "">("");
  const [approvalComment, setApprovalComment] = useState("");

  const handleApprove = () => {
    // If AI rejected but user approves, we want to capture this feedback
    if (aiQaStatus === "rejected") {
      setShowApprovalFeedback(true);
    } else {
      onApprove();
    }
  };

  const confirmApprove = () => {
    onApprove({
      category: approvalCategory || undefined,
      comment: approvalComment || undefined,
    });
    setShowApprovalFeedback(false);
  };

  const handleReject = () => {
    if (!rejectReason.trim()) return;
    onReject({
      category: selectedCategory,
      reason: rejectReason,
    });
    setShowRejectForm(false);
    setRejectReason("");
  };

  const isExhausted = attemptNumber >= maxAttempts;

  if (isLocked || isHumanApproved) {
    return (
      <div className="flex items-center gap-2 p-2 rounded-md bg-primary/10 border border-primary/30 text-sm">
        <Check className="w-4 h-4 text-primary" />
        <span className="text-primary font-medium">Approved</span>
        <Badge variant="outline" className="text-xs">
          Locked
        </Badge>
      </div>
    );
  }

  return (
    <div className="space-y-3 p-3 rounded-lg border border-border/50 bg-card/50">
      {/* Header with attempt counter */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium">QA Review</span>
          <Badge variant="outline" className="text-xs">
            Step {stepNumber}
          </Badge>
        </div>
        <Badge 
          variant={isExhausted ? "destructive" : "secondary"} 
          className="text-xs"
        >
          Attempt {attemptNumber}/{maxAttempts}
        </Badge>
      </div>

      {/* AI QA Status */}
      <div className={cn(
        "p-2 rounded-md text-sm",
        aiQaStatus === "approved" 
          ? "bg-primary/10 border border-primary/30" 
          : aiQaStatus === "rejected"
          ? "bg-destructive/10 border border-destructive/30"
          : "bg-muted/50 border border-border/30"
      )}>
        <div className="flex items-center gap-2 mb-1">
          {aiQaStatus === "approved" ? (
            <ThumbsUp className="w-3.5 h-3.5 text-primary" />
          ) : aiQaStatus === "rejected" ? (
            <ThumbsDown className="w-3.5 h-3.5 text-destructive" />
          ) : (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
          )}
          <span className={cn(
            "font-medium text-xs",
            aiQaStatus === "approved" ? "text-primary" : 
            aiQaStatus === "rejected" ? "text-destructive" : 
            "text-muted-foreground"
          )}>
            AI-QA: {aiQaStatus === "approved" ? "Passed" : aiQaStatus === "rejected" ? "Failed" : "Pending"}
          </span>
        </div>
        
        {/* AI Rejection Reasons */}
        {aiQaStatus === "rejected" && aiRejectionReasons.length > 0 && (
          <ul className="text-xs text-muted-foreground space-y-0.5 ml-5 list-disc">
            {aiRejectionReasons.map((reason, idx) => (
              <li key={idx}>{reason}</li>
            ))}
          </ul>
        )}
      </div>

      {/* Exhausted Warning */}
      {isExhausted && (
        <div className="flex items-center gap-2 p-2 rounded-md bg-warning/10 border border-warning/30 text-warning text-xs">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          <span>
            Auto-retry limit reached. Manual decision required.
          </span>
        </div>
      )}

      {/* Action Buttons */}
      {!showRejectForm && !showApprovalFeedback && (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={handleApprove}
            disabled={isSubmitting}
            className="flex-1"
          >
            {isSubmitting ? (
              <Loader2 className="w-4 h-4 mr-1 animate-spin" />
            ) : (
              <ThumbsUp className="w-4 h-4 mr-1" />
            )}
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowRejectForm(true)}
            disabled={isSubmitting}
            className="flex-1 border-destructive/50 text-destructive hover:bg-destructive/10"
          >
            <ThumbsDown className="w-4 h-4 mr-1" />
            Reject
          </Button>
        </div>
      )}

      {/* Approval Feedback Form (when AI rejected but user approves) */}
      {showApprovalFeedback && (
        <div className="space-y-3 p-3 rounded-md border border-primary/30 bg-primary/5">
          <p className="text-xs text-muted-foreground">
            AI rejected this but you're approving. Help improve future QA:
          </p>
          <Select
            value={approvalCategory}
            onValueChange={(v) => setApprovalCategory(v as QAFeedbackCategory)}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="What was AI wrong about? (optional)" />
            </SelectTrigger>
            <SelectContent>
              {CATEGORY_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} className="text-xs">
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Textarea
            placeholder="Optional: Why is this acceptable? (max 200 chars)"
            value={approvalComment}
            onChange={(e) => setApprovalComment(e.target.value.slice(0, 200))}
            className="h-16 text-xs resize-none"
            maxLength={200}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowApprovalFeedback(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={confirmApprove}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              ) : (
                <Check className="w-4 h-4 mr-1" />
              )}
              Confirm Approve
            </Button>
          </div>
        </div>
      )}

      {/* Reject Form with Required Reason */}
      {showRejectForm && (
        <div className="space-y-3 p-3 rounded-md border border-destructive/30 bg-destructive/5">
          <p className="text-xs font-medium text-destructive">
            Rejection reason required (used to improve next attempt):
          </p>
          <Select
            value={selectedCategory}
            onValueChange={(v) => setSelectedCategory(v as QAFeedbackCategory)}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Select issue category" />
            </SelectTrigger>
            <SelectContent>
              {CATEGORY_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} className="text-xs">
                  <div className="flex flex-col">
                    <span>{opt.label}</span>
                    <span className="text-muted-foreground text-[10px]">{opt.description}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Textarea
            placeholder="Describe the issue in detail (required)..."
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            className="h-20 text-xs resize-none"
            required
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setShowRejectForm(false);
                setRejectReason("");
              }}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={handleReject}
              disabled={isSubmitting || !rejectReason.trim()}
            >
              {isSubmitting ? (
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              ) : (
                <ThumbsDown className="w-4 h-4 mr-1" />
              )}
              Submit & Retry
            </Button>
          </div>
        </div>
      )}

      {/* Learning indicator */}
      <Collapsible>
        <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <Brain className="w-3 h-3" />
          <span>QA Learning Active</span>
          <ChevronDown className="w-3 h-3" />
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">
          <p className="text-xs text-muted-foreground">
            Your feedback improves future QA decisions. Approvals and rejections are
            stored and used to calibrate the AI's quality checks.
          </p>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
});

export default QALearningFeedbackPanel;
