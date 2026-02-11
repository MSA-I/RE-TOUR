import { useState, useCallback, useMemo, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertTriangle, ThumbsUp, ThumbsDown, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

// Category options matching the database enum (kept for backward compatibility)
export const QA_CATEGORIES = {
  furniture_scale: "Furniture Scale",
  extra_furniture: "Extra Furniture",
  structural_change: "Structural Change",
  flooring_mismatch: "Flooring Mismatch",
  other: "Other",
} as const;

export type QACategoryKey = keyof typeof QA_CATEGORIES;

// NEW: Structured QA Tags for learning system - SEPARATE FOR APPROVE VS REJECT

// Tags for APPROVAL: What is GOOD and should be preserved
export const APPROVE_TAGS = [
  "Accurate Layout",
  "Correct Scale",
  "Correct Openings",
  "Good Camera Intent Match",
  "Style Match",
  "Clear / Readable",
  "Good Lighting",
  "Other",
] as const;

// Tags for REJECTION: What is WRONG and should be avoided/fixed
export const REJECT_TAGS = [
  "Geometry/Layout Wrong",
  "Scale/Proportions Wrong",
  "Doors/Openings Wrong",
  "Windows Wrong",
  "Camera Not Eye-Level / Wrong FOV",
  "Style Drift",
  "Artifacts / Broken Image",
  "Missing Details / Hallucination",
  "Other",
] as const;

export type ApproveTag = typeof APPROVE_TAGS[number];
export type RejectTag = typeof REJECT_TAGS[number];
export type QATag = ApproveTag | RejectTag;

export interface QAFeedbackData {
  decision: "approved" | "rejected";
  category: QACategoryKey; // Kept for backward compatibility
  reasonShort: string;
  qaWasWrong: boolean;
  /** Manual QA score (0-100) - REQUIRED */
  score: number | null;
  /** NEW: Structured tags for learning system */
  tags: string[];
  /** NEW: Tag type indicator - which tag set was used */
  tags_type: "approve" | "reject";
}

interface QAFeedbackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "approve" | "reject";
  onSubmit: (feedback: QAFeedbackData) => void;
  isSubmitting?: boolean;
  // Pre-fill from QA result
  suggestedCategory?: string | null;
  qaOriginalStatus?: "approved" | "rejected" | "pending" | null;
  attemptNumber?: number;
  stepNumber?: number;
  /** Initial score to pre-fill (e.g., from AI-QA) */
  initialScore?: number | null;
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

export function QAFeedbackDialog({
  open,
  onOpenChange,
  mode,
  onSubmit,
  isSubmitting = false,
  suggestedCategory,
  qaOriginalStatus,
  attemptNumber = 1,
  stepNumber = 1,
  initialScore = null,
}: QAFeedbackDialogProps) {
  // NEW: Tags state (multi-select)
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());

  const [reasonShort, setReasonShort] = useState("");
  const [qaWasWrong, setQaWasWrong] = useState(mode === "approve" && qaOriginalStatus === "rejected");

  // Score state - REQUIRED field for QA feedback
  const [score, setScore] = useState<number | null>(initialScore);
  const [scoreInput, setScoreInput] = useState<string>(initialScore !== null ? String(initialScore) : "");
  const [scoreError, setScoreError] = useState<string | null>(null);

  // Sync score input with external initialScore changes
  useEffect(() => {
    if (initialScore !== null && String(initialScore) !== scoreInput) {
      setScoreInput(String(initialScore));
      setScore(initialScore);
    }
  }, [initialScore]);

  // Reset form when dialog opens
  const handleOpenChange = useCallback((newOpen: boolean) => {
    if (newOpen) {
      setSelectedTags(new Set());
      setReasonShort("");
      setQaWasWrong(mode === "approve" && qaOriginalStatus === "rejected");
      // Reset score
      setScore(initialScore);
      setScoreInput(initialScore !== null ? String(initialScore) : "");
      setScoreError(null);
    }
    onOpenChange(newOpen);
  }, [mode, qaOriginalStatus, onOpenChange, initialScore]);

  // Handle score input change
  const handleScoreChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/[^0-9]/g, "").slice(0, 3);
    setScoreInput(val);

    if (!val) {
      setScoreError(null);
      setScore(null);
      return;
    }

    const num = parseInt(val, 10);
    if (num < 0 || num > 100) {
      setScoreError("Enter 0–100");
      setScore(null);
    } else {
      setScoreError(null);
      setScore(num);
    }
  }, []);

  // NEW: Toggle tag selection
  const toggleTag = useCallback((tag: string) => {
    setSelectedTags(prev => {
      const newSet = new Set(prev);
      if (newSet.has(tag)) {
        newSet.delete(tag);
      } else {
        newSet.add(tag);
      }
      return newSet;
    });
  }, []);

  const handleSubmit = useCallback(() => {
    // Require score for submission
    if (score === null) {
      setScoreError("Score is required");
      return;
    }

    // Require at least one tag
    if (selectedTags.size === 0) {
      return;
    }

    const tags = Array.from(selectedTags);
    const tags_type = mode === "approve" ? "approve" : "reject";

    // Map first tag to category for backward compatibility
    const tagToCategoryMap: Record<string, QACategoryKey> = {
      "Scale/Proportions Wrong": "furniture_scale",
      "Correct Scale": "furniture_scale",
      "Doors/Openings Wrong": "structural_change",
      "Correct Openings": "structural_change",
      "Geometry/Layout Wrong": "structural_change",
      "Accurate Layout": "structural_change",
      "Style Drift": "flooring_mismatch",
      "Style Match": "flooring_mismatch",
    };
    const category = tagToCategoryMap[tags[0]] || "other";

    onSubmit({
      decision: mode === "approve" ? "approved" : "rejected",
      category, // Backward compatibility
      reasonShort: reasonShort.trim().slice(0, 500) || "(No additional note)",
      qaWasWrong,
      score,
      tags, // NEW: Include structured tags
      tags_type, // NEW: Tag type indicator
    });
  }, [mode, reasonShort, qaWasWrong, score, selectedTags, onSubmit]);

  const isValid = useMemo(() => {
    return (
      score !== null &&
      score >= 0 &&
      score <= 100 &&
      selectedTags.size > 0 // At least one tag required
    );
  }, [score, selectedTags]);

  const charCount = reasonShort.length;
  const isOverLimit = charCount > 500;

  // Determine if this is a disagreement with AI-QA
  const isDisagreement =
    (mode === "approve" && qaOriginalStatus === "rejected") ||
    (mode === "reject" && qaOriginalStatus === "approved");

  // Score recommendation hint
  const scoreRecommendation = useMemo(() => {
    if (score === null) return null;
    if (mode === "approve" && score < 70) {
      return { type: "warning" as const, text: "Low score — consider rejecting instead" };
    }
    if (mode === "reject" && score >= 70) {
      return { type: "warning" as const, text: "High score — consider approving instead" };
    }
    return { type: "success" as const, text: mode === "approve" ? "Score supports approval" : "Score supports rejection" };
  }, [score, mode]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {mode === "approve" ? (
              <>
                <ThumbsUp className="w-5 h-5 text-primary" />
                Approve Step {stepNumber} Output
              </>
            ) : (
              <>
                <ThumbsDown className="w-5 h-5 text-destructive" />
                Reject Step {stepNumber} Output
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            Score the quality (0–100) and select tags to improve future QA decisions.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Attempt indicator */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>Attempt #{attemptNumber}</span>
            {qaOriginalStatus && (
              <Badge
                variant="outline"
                className={qaOriginalStatus === "approved" ? "border-primary/50" : "border-destructive/50"}
              >
                AI-QA: {qaOriginalStatus}
              </Badge>
            )}
          </div>

          {/* Disagreement warning */}
          {isDisagreement && (
            <div className="p-3 rounded-lg border border-accent/30 bg-accent/5">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-accent-foreground flex-shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-accent-foreground">
                    You're overriding the AI decision
                  </p>
                  <p className="text-muted-foreground text-xs mt-1">
                    This feedback will be used to improve future QA accuracy.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* QA SCORE INPUT - REQUIRED */}
          <div className="space-y-2">
            <Label htmlFor="qa-score" className="flex items-center gap-1">
              Quality Score <span className="text-destructive">*</span>
              <span className="text-xs text-muted-foreground ml-1">(0–100)</span>
            </Label>
            <div className="flex items-center gap-3">
              <div className="relative">
                <Input
                  id="qa-score"
                  type="text"
                  inputMode="numeric"
                  value={scoreInput}
                  onChange={handleScoreChange}
                  placeholder="0–100"
                  className={cn(
                    "w-24 h-10 text-base font-mono text-center",
                    scoreError && "border-destructive focus-visible:ring-destructive"
                  )}
                  disabled={isSubmitting}
                />
                {scoreError && (
                  <div className="absolute left-0 -bottom-5 flex items-center gap-1 text-[10px] text-destructive whitespace-nowrap">
                    <AlertCircle className="w-3 h-3" />
                    {scoreError}
                  </div>
                )}
              </div>

              {score !== null && !scoreError && (
                <Badge
                  variant="outline"
                  className={cn("text-sm", getScoreLabel(score).color)}
                >
                  {getScoreLabel(score).text}
                </Badge>
              )}
            </div>

            {/* Score recommendation */}
            {scoreRecommendation && (
              <p className={cn(
                "text-xs mt-2",
                scoreRecommendation.type === "warning" ? "text-yellow-600 dark:text-yellow-400" : "text-primary"
              )}>
                {scoreRecommendation.type === "warning" ? "⚠ " : "✓ "}
                {scoreRecommendation.text}
              </p>
            )}
          </div>

          {/* NEW: QA Tags (multi-select) - REQUIRED - Different tags for approve vs reject */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1">
              {mode === "approve" ? "Approve Tags" : "Reject Tags"} <span className="text-destructive">*</span>
            </Label>
            <p className="text-xs text-muted-foreground mb-2">
              {mode === "approve"
                ? "Select what is GOOD and should be preserved in future outputs."
                : "Select what is WRONG and should be avoided/fixed in future outputs."}
            </p>
            <div className="grid grid-cols-1 gap-2 max-h-[180px] overflow-y-auto border rounded-md p-3">
              {(mode === "approve" ? APPROVE_TAGS : REJECT_TAGS).map((tag) => (
                <div key={tag} className="flex items-center space-x-2">
                  <Checkbox
                    id={`tag-${tag}`}
                    checked={selectedTags.has(tag)}
                    onCheckedChange={() => toggleTag(tag)}
                    disabled={isSubmitting}
                  />
                  <Label
                    htmlFor={`tag-${tag}`}
                    className="text-sm font-normal cursor-pointer leading-tight"
                  >
                    {tag}
                  </Label>
                </div>
              ))}
            </div>
            {selectedTags.size === 0 && (
              <p className="text-xs text-destructive">At least one tag is required</p>
            )}
            {selectedTags.size > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {Array.from(selectedTags).map((tag) => (
                  <Badge
                    key={tag}
                    variant="secondary"
                    className={cn(
                      "text-xs",
                      mode === "approve" ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"
                    )}
                  >
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Reason input - NOW OPTIONAL */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="reason">
                Feedback Note <span className="text-xs text-muted-foreground">(optional)</span>
              </Label>
              <span className={`text-xs ${isOverLimit ? "text-destructive" : "text-muted-foreground"}`}>
                {charCount}/500
              </span>
            </div>
            <Textarea
              id="reason"
              placeholder={
                mode === "approve"
                  ? "e.g., 'Bedroom bed size is appropriate for room dimensions...'"
                  : "e.g., 'Missing wall between kitchen and living room...'"
              }
              value={reasonShort}
              onChange={(e) => setReasonShort(e.target.value)}
              className="min-h-[60px] resize-none"
              maxLength={510}
              disabled={isSubmitting}
            />
            <p className="text-xs text-muted-foreground">
              Add context for humans. Tags are the machine-readable reason.
            </p>
          </div>

          {/* QA was wrong checkbox - only show for approvals when QA rejected */}
          {mode === "approve" && qaOriginalStatus === "rejected" && (
            <div className="flex items-start space-x-2 pt-2">
              <Checkbox
                id="qaWasWrong"
                checked={qaWasWrong}
                onCheckedChange={(checked) => setQaWasWrong(checked === true)}
                disabled={isSubmitting}
              />
              <div className="grid gap-1.5 leading-none">
                <Label
                  htmlFor="qaWasWrong"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  QA was wrong about this
                </Label>
                <p className="text-xs text-muted-foreground">
                  Check this to help the system learn from this override
                </p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            variant={mode === "approve" ? "default" : "destructive"}
            onClick={handleSubmit}
            disabled={!isValid || isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                Submitting...
              </>
            ) : mode === "approve" ? (
              <>
                <ThumbsUp className="w-4 h-4 mr-1" />
                Approve
              </>
            ) : (
              <>
                <ThumbsDown className="w-4 h-4 mr-1" />
                Reject
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
