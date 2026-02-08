import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Loader2, AlertCircle, ThumbsUp, ThumbsDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

// ============================================================================
// SINGLE SOURCE OF TRUTH: QA SCORE INPUT
// This is the canonical numeric score input (0-100) used across all QA flows
// ============================================================================

interface QAScoreInputProps {
  /** Current score value (controlled) */
  score: number | null;
  /** Callback when score changes */
  onScoreChange: (score: number | null) => void;
  /** Whether component is disabled */
  disabled?: boolean;
  /** Compact mode for smaller layouts */
  compact?: boolean;
  /** Show validation error */
  error?: string | null;
}

/**
 * Get score category label and color
 */
function getScoreLabel(score: number) {
  if (score < 40) return { text: "Poor", color: "text-destructive" };
  if (score < 60) return { text: "Fair", color: "text-yellow-600 dark:text-yellow-400" };
  if (score < 80) return { text: "Good", color: "text-primary" };
  return { text: "Excellent", color: "text-accent" };
}

/**
 * QAScoreInput - Standalone numeric score input (0-100)
 * SINGLE SOURCE OF TRUTH for manual quality scoring
 * Used in all QA flows: Multi-Panorama, Pipeline Steps, Batch Jobs, etc.
 */
export function QAScoreInput({
  score,
  onScoreChange,
  disabled = false,
  compact = false,
  error,
}: QAScoreInputProps) {
  const [inputValue, setInputValue] = useState<string>(
    score != null ? String(score) : ""
  );
  const [localError, setLocalError] = useState<string | null>(null);

  // Sync input with external score changes
  useEffect(() => {
    if (score !== null && String(score) !== inputValue) {
      setInputValue(String(score));
    }
  }, [score]);

  const displayError = error || localError;

  // Validate and update score
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/[^0-9]/g, "").slice(0, 3);
    setInputValue(val);
    
    if (!val) {
      setLocalError(null);
      onScoreChange(null);
      return;
    }
    
    const num = parseInt(val, 10);
    if (num < 0 || num > 100) {
      setLocalError("Enter 0–100");
      onScoreChange(null);
    } else {
      setLocalError(null);
      onScoreChange(num);
    }
  };

  return (
    <div className={cn("space-y-1.5", compact && "space-y-1")}>
      <Label className="text-xs text-muted-foreground">
        Quality Score (0–100)
      </Label>
      <div className="flex items-center gap-2">
        <div className="relative">
          <Input
            type="text"
            inputMode="numeric"
            value={inputValue}
            onChange={handleInputChange}
            placeholder="0–100"
            className={cn(
              "w-20 h-9 text-sm font-mono text-center",
              displayError && "border-destructive focus-visible:ring-destructive"
            )}
            disabled={disabled}
          />
          {displayError && (
            <div className="absolute left-0 -bottom-4 flex items-center gap-1 text-[10px] text-destructive whitespace-nowrap">
              <AlertCircle className="w-3 h-3" />
              {displayError}
            </div>
          )}
        </div>
        
        {score != null && !displayError && (
          <Badge 
            variant="outline" 
            className={cn("text-xs", getScoreLabel(score).color)}
          >
            {getScoreLabel(score).text}
          </Badge>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// SINGLE SOURCE OF TRUTH: QA REVIEW PANEL
// This is the canonical QA review component with score + approve/reject
// ============================================================================

export interface QAReviewPanelProps {
  /** Unique identifier for the item being reviewed */
  itemId: string;
  /** Project ID for feedback persistence */
  projectId: string;
  /** Optional pipeline ID (for pipeline-related items) */
  pipelineId?: string;
  /** Output upload ID if available */
  outputUploadId?: string | null;
  /** Called when user approves with score and note */
  onApprove: (score: number | null, note: string) => void;
  /** Called when user rejects with score and note */
  onReject: (score: number | null, note: string) => void;
  /** Whether approve action is in progress */
  isApproving?: boolean;
  /** Whether reject action is in progress */
  isRejecting?: boolean;
  /** Title for the panel */
  title?: string;
  /** Description for the panel */
  description?: string;
  /** Whether to show the feedback note field */
  showNote?: boolean;
  /** Compact mode for smaller layouts */
  compact?: boolean;
  /** Category for feedback tracking */
  category?: string;
  /** Whether to persist feedback automatically */
  autoPersistFeedback?: boolean;
  /** Step ID for pipeline context (defaults to 0 for non-pipeline items) */
  stepId?: number;
  /** Attempt number for pipeline context (defaults to 1) */
  attemptNumber?: number;
  /** Initial score to pre-fill */
  initialScore?: number | null;
  /** Initial note to pre-fill */
  initialNote?: string | null;
}

/**
 * QAReviewPanel - Combined QA score and approval controls
 * SINGLE SOURCE OF TRUTH for manual QA review with scoring
 * Persists feedback to qa_attempt_feedback for QA learning
 * 
 * Used in: Multi-Panorama, Pipeline Steps, Batch Jobs, Render Jobs, etc.
 */
export function QAReviewPanel({
  itemId,
  projectId,
  pipelineId,
  outputUploadId,
  onApprove,
  onReject,
  isApproving = false,
  isRejecting = false,
  title = "Review Required",
  description = "Score the output quality and approve or reject",
  showNote = true,
  compact = false,
  category = "manual_review",
  autoPersistFeedback = true,
  stepId = 0,
  attemptNumber = 1,
  initialScore = null,
  initialNote = null,
}: QAReviewPanelProps) {
  const [score, setScore] = useState<number | null>(initialScore);
  const [note, setNote] = useState<string>(initialNote || "");
  
  const isSubmitting = isApproving || isRejecting;

  // Persist feedback to qa_attempt_feedback
  const persistFeedback = async (decision: "approved" | "rejected") => {
    if (!autoPersistFeedback) return;
    
    try {
      const user = await supabase.auth.getUser();
      const ownerId = user.data.user?.id;
      if (!ownerId) return;

      const userVote = decision === "approved" 
        ? (score !== null && score >= 70 ? "like" : "neutral")
        : "dislike";
      
      // Map score to category
      let userCategory = category;
      if (score !== null) {
        if (score < 40) userCategory = "structural_change";
        else if (score < 60) userCategory = "furniture_scale";
        else if (score < 70) userCategory = "flooring_mismatch";
      }

      const comment = score !== null 
        ? `Score: ${score}${note ? ` — ${note}` : ""}`
        : note || `${decision === "approved" ? "Approved" : "Rejected"} without score`;

      await supabase.from("qa_attempt_feedback").insert({
        project_id: projectId,
        pipeline_id: pipelineId || itemId,
        owner_id: ownerId,
        step_id: stepId,
        attempt_number: attemptNumber,
        image_id: outputUploadId || null,
        qa_decision: decision,
        user_vote: userVote,
        user_category: userCategory,
        user_comment_short: comment,
        qa_reasons: [],
        context_snapshot: {
          item_id: itemId,
          user_score: score,
          user_note: note || null,
          action: decision,
          submitted_at: new Date().toISOString(),
        },
      });
    } catch (err) {
      console.error("[QAReviewPanel] Failed to persist feedback:", err);
    }
  };

  const handleApprove = async () => {
    await persistFeedback("approved");
    onApprove(score, note);
  };

  const handleReject = async () => {
    await persistFeedback("rejected");
    onReject(score, note);
  };

  return (
    <div className={cn(
      "p-4 rounded-lg bg-muted/50 border border-border space-y-4",
      compact && "p-3 space-y-3"
    )}>
      {/* Header */}
      <div>
        <p className={cn("font-medium", compact ? "text-sm" : "text-sm")}>{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>

      {/* QA Score Input */}
      <QAScoreInput
        score={score}
        onScoreChange={setScore}
        disabled={isSubmitting}
        compact={compact}
      />

      {/* Feedback Note */}
      {showNote && !compact && (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">
            Feedback note (optional)
          </Label>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 200))}
            placeholder="What could be improved? Any specific issues?"
            className="h-16 text-sm resize-none"
            disabled={isSubmitting}
          />
          <span className="text-[10px] text-muted-foreground">
            {note.length}/200
          </span>
        </div>
      )}

      {/* Action Buttons */}
      <div className={cn(
        "flex items-center gap-3 pt-2 border-t border-border",
        compact && "pt-2 gap-2"
      )}>
        <Button
          size="sm"
          className="flex-1 bg-primary hover:bg-primary/90"
          onClick={handleApprove}
          disabled={isSubmitting}
        >
          {isApproving ? (
            <>
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              Approving...
            </>
          ) : (
            <>
              <ThumbsUp className="h-4 w-4 mr-1" />
              Approve
            </>
          )}
        </Button>
        <Button
          size="sm"
          variant="destructive"
          className="flex-1"
          onClick={handleReject}
          disabled={isSubmitting}
        >
          {isRejecting ? (
            <>
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              Rejecting...
            </>
          ) : (
            <>
              <ThumbsDown className="h-4 w-4 mr-1" />
              Reject
            </>
          )}
        </Button>
      </div>

      {/* Score recommendation hint */}
      {score !== null && (
        <div className="text-xs text-muted-foreground">
          {score >= 70 ? (
            <span className="text-primary">
              ✓ Score indicates approval is appropriate
            </span>
          ) : (
            <span className="text-warning">
              ⚠ Low score — consider rejecting for regeneration
            </span>
          )}
        </div>
      )}

      {/* Score interpretation hint */}
      <div className="text-[10px] text-muted-foreground">
        Rate overall quality: geometry accuracy, visual fidelity, evidence adherence
      </div>
    </div>
  );
}

// ============================================================================
// SINGLE SOURCE OF TRUTH: QA REVIEW INLINE
// Compact version for table rows, list items, batch job items
// ============================================================================

/**
 * QAReviewInline - Compact inline QA review for table rows or list items
 * Same behavior as QAReviewPanel but minimal footprint
 */
export function QAReviewInline({
  itemId,
  projectId,
  pipelineId,
  outputUploadId,
  onApprove,
  onReject,
  isApproving = false,
  isRejecting = false,
  category = "manual_review",
  stepId = 0,
  attemptNumber = 1,
}: Omit<QAReviewPanelProps, "title" | "description" | "showNote" | "compact">) {
  const [score, setScore] = useState<number | null>(null);
  const isSubmitting = isApproving || isRejecting;

  // Persist feedback to qa_attempt_feedback
  const persistFeedback = async (decision: "approved" | "rejected") => {
    try {
      const user = await supabase.auth.getUser();
      const ownerId = user.data.user?.id;
      if (!ownerId) return;

      await supabase.from("qa_attempt_feedback").insert({
        project_id: projectId,
        pipeline_id: pipelineId || itemId,
        owner_id: ownerId,
        step_id: stepId,
        attempt_number: attemptNumber,
        image_id: outputUploadId || null,
        qa_decision: decision,
        user_vote: decision === "approved" ? "like" : "dislike",
        user_category: category,
        user_comment_short: score !== null ? `Score: ${score}` : decision,
        qa_reasons: [],
        context_snapshot: {
          item_id: itemId,
          user_score: score,
          action: decision,
          submitted_at: new Date().toISOString(),
        },
      });
    } catch (err) {
      console.error("[QAReviewInline] Failed to persist feedback:", err);
    }
  };

  const handleApprove = async () => {
    await persistFeedback("approved");
    onApprove(score, "");
  };

  const handleReject = async () => {
    await persistFeedback("rejected");
    onReject(score, "");
  };

  return (
    <div className="flex items-center gap-2">
      {/* Compact score input */}
      <Input
        type="text"
        inputMode="numeric"
        value={score !== null ? String(score) : ""}
        onChange={(e) => {
          const val = e.target.value.replace(/[^0-9]/g, "").slice(0, 3);
          if (!val) {
            setScore(null);
            return;
          }
          const num = parseInt(val, 10);
          if (num >= 0 && num <= 100) {
            setScore(num);
          }
        }}
        placeholder="0–100"
        className="w-16 h-7 text-xs font-mono text-center"
        disabled={isSubmitting}
      />
      
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-primary hover:text-primary hover:bg-primary/10"
        onClick={handleApprove}
        disabled={isSubmitting}
      >
        {isApproving ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <ThumbsUp className="h-3.5 w-3.5" />
        )}
      </Button>
      
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-destructive hover:text-destructive hover:bg-destructive/10"
        onClick={handleReject}
        disabled={isSubmitting}
      >
        {isRejecting ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <ThumbsDown className="h-3.5 w-3.5" />
        )}
      </Button>
    </div>
  );
}

// ============================================================================
// SINGLE SOURCE OF TRUTH: STANDALONE QA SCORE (SAVE-ONLY)
// For cases where we only need score input with save button (no approve/reject)
// Used in QA reason boxes to allow user scoring after AI decision
// ============================================================================

export interface QAScoreSaveProps {
  /** Pipeline ID for persistence */
  pipelineId: string;
  /** Project ID for persistence */
  projectId: string;
  /** Step ID for context */
  stepId: number;
  /** Attempt number for context */
  attemptNumber: number;
  /** Image/output ID */
  imageId: string | null;
  /** The QA decision that was made (approved/rejected) */
  qaDecision: "approved" | "rejected";
  /** QA reasons from AI */
  qaReasons: unknown[];
  /** Additional context */
  contextSnapshot: Record<string, unknown>;
  /** Initial score (from DB or AI) */
  initialScore?: number | null;
  /** Initial note */
  initialNote?: string | null;
  /** Compact mode */
  compact?: boolean;
}

/**
 * QAScoreSave - Standalone score input with save button
 * For adding user score to existing QA decisions (AI-approved/rejected items)
 */
export function QAScoreSave({
  pipelineId,
  projectId,
  stepId,
  attemptNumber,
  imageId,
  qaDecision,
  qaReasons,
  contextSnapshot,
  initialScore = null,
  initialNote = null,
  compact = false,
}: QAScoreSaveProps) {
  const [score, setScore] = useState<number | null>(initialScore);
  const [note, setNote] = useState<string>(initialNote || "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSaved, setIsSaved] = useState(false);

  const handleSave = useCallback(async () => {
    if (score === null) return;
    
    setIsSubmitting(true);
    try {
      const user = await supabase.auth.getUser();
      const ownerId = user.data.user?.id;
      if (!ownerId) throw new Error("Not authenticated");

      const userVote = score >= 70 ? "like" : "dislike";
      let userCategory = "other";
      if (score < 40) userCategory = "structural_change";
      else if (score < 60) userCategory = "furniture_scale";
      else if (score < 70) userCategory = "flooring_mismatch";

      const comment = note.trim()
        ? `Score: ${score} — ${note.trim().slice(0, 150)}`
        : `Score: ${score}`;

      await supabase.from("qa_attempt_feedback").insert({
        project_id: projectId,
        pipeline_id: pipelineId,
        owner_id: ownerId,
        step_id: stepId,
        attempt_number: attemptNumber,
        image_id: imageId,
        qa_decision: qaDecision,
        user_vote: userVote,
        user_category: userCategory,
        user_comment_short: comment,
        qa_reasons: qaReasons as unknown[],
        context_snapshot: {
          ...contextSnapshot,
          user_score: score,
          user_note: note.trim() || null,
          score_submitted_at: new Date().toISOString(),
        },
      } as any); // Type assertion needed due to Supabase type generation mismatch

      setIsSaved(true);
    } catch (err) {
      console.error("[QAScoreSave] Failed to save:", err);
    } finally {
      setIsSubmitting(false);
    }
  }, [score, note, projectId, pipelineId, stepId, attemptNumber, imageId, qaDecision, qaReasons, contextSnapshot]);

  // Show saved state
  if (isSaved) {
    return (
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-xs border-primary/50 text-primary">
          Score: {score}/100
        </Badge>
        {note && (
          <span className="text-xs text-muted-foreground truncate max-w-[150px]" title={note}>
            "{note}"
          </span>
        )}
        <span className="text-xs text-muted-foreground">
          {score && score >= 70 ? "✓ Good" : "⚠ Needs improvement"}
        </span>
      </div>
    );
  }

  return (
    <div className={cn("space-y-2", compact && "space-y-1.5")}>
      <div className="flex items-center gap-2">
        <QAScoreInput
          score={score}
          onScoreChange={setScore}
          disabled={isSubmitting}
          compact={compact}
        />
        <Button
          size="sm"
          variant={score !== null ? "default" : "outline"}
          className="h-9 text-xs px-3"
          onClick={handleSave}
          disabled={isSubmitting || score === null}
        >
          {isSubmitting ? (
            <>
              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Check className="w-3 h-3 mr-1" />
              Save
            </>
          )}
        </Button>
      </div>

      {/* Optional note for non-compact */}
      {!compact && (
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">
            Feedback note (optional)
          </Label>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 200))}
            placeholder="What could be improved?"
            className="h-16 text-sm resize-none"
            disabled={isSubmitting}
          />
          <span className="text-[10px] text-muted-foreground">
            {note.length}/200
          </span>
        </div>
      )}

      {/* Score hint */}
      <div className="text-[10px] text-muted-foreground">
        {score === null
          ? "Rate output quality 0–100"
          : score < 40
            ? "Poor (major issues)"
            : score < 60
              ? "Fair (needs work)"
              : score < 80
                ? "Good (minor issues)"
                : "Excellent"}
      </div>
    </div>
  );
}
