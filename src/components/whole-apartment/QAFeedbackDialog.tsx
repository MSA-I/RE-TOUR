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

// Category options matching the database enum
export const QA_CATEGORIES = {
  furniture_scale: "Furniture Scale",
  extra_furniture: "Extra Furniture",
  structural_change: "Structural Change",
  flooring_mismatch: "Flooring Mismatch",
  other: "Other",
} as const;

export type QACategoryKey = keyof typeof QA_CATEGORIES;

export interface QAFeedbackData {
  decision: "approved" | "rejected";
  category: QACategoryKey;
  reasonShort: string;
  qaWasWrong: boolean;
  /** Manual QA score (0-100) - REQUIRED */
  score: number | null;
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
  const [category, setCategory] = useState<QACategoryKey>(
    suggestedCategory && suggestedCategory in QA_CATEGORIES
      ? (suggestedCategory as QACategoryKey)
      : "other"
  );
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
      // Pre-fill category from QA suggestion
      if (suggestedCategory && suggestedCategory in QA_CATEGORIES) {
        setCategory(suggestedCategory as QACategoryKey);
      } else {
        setCategory("other");
      }
      setReasonShort("");
      setQaWasWrong(mode === "approve" && qaOriginalStatus === "rejected");
      // Reset score
      setScore(initialScore);
      setScoreInput(initialScore !== null ? String(initialScore) : "");
      setScoreError(null);
    }
    onOpenChange(newOpen);
  }, [suggestedCategory, mode, qaOriginalStatus, onOpenChange, initialScore]);

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

  const handleSubmit = useCallback(() => {
    // Require score for submission
    if (score === null) {
      setScoreError("Score is required");
      return;
    }
    if (!reasonShort.trim()) return;
    
    onSubmit({
      decision: mode === "approve" ? "approved" : "rejected",
      category,
      reasonShort: reasonShort.trim().slice(0, 200),
      qaWasWrong,
      score,
    });
  }, [mode, category, reasonShort, qaWasWrong, score, onSubmit]);

  const isValid = useMemo(() => {
    return (
      reasonShort.trim().length >= 5 && 
      reasonShort.trim().length <= 200 &&
      score !== null &&
      score >= 0 &&
      score <= 100
    );
  }, [reasonShort, score]);

  const charCount = reasonShort.length;
  const isOverLimit = charCount > 200;

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
      <DialogContent className="max-w-md">
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
            Score the quality (0–100) and provide feedback to improve future QA decisions.
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

          {/* Category selector */}
          <div className="space-y-2">
            <Label htmlFor="category">Category</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as QACategoryKey)}>
              <SelectTrigger id="category">
                <SelectValue placeholder="Select category..." />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(QA_CATEGORIES).map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Reason input */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="reason">
                Feedback Note <span className="text-destructive">*</span>
              </Label>
              <span className={`text-xs ${isOverLimit ? "text-destructive" : "text-muted-foreground"}`}>
                {charCount}/200
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
              className="min-h-[80px] resize-none"
              maxLength={210} // Slight buffer for UX
            />
            {reasonShort.length > 0 && reasonShort.length < 5 && (
              <p className="text-xs text-destructive">Minimum 5 characters required</p>
            )}
          </div>

          {/* QA was wrong checkbox - only show for approvals when QA rejected */}
          {mode === "approve" && qaOriginalStatus === "rejected" && (
            <div className="flex items-start space-x-2 pt-2">
              <Checkbox
                id="qaWasWrong"
                checked={qaWasWrong}
                onCheckedChange={(checked) => setQaWasWrong(checked === true)}
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
