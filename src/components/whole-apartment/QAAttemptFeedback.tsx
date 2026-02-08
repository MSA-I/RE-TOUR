import { memo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ThumbsUp, ThumbsDown, Loader2, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type FeedbackCategory =
  | "furniture_scale"
  | "extra_furniture"
  | "structural_change"
  | "flooring_mismatch"
  | "other";

const CATEGORY_OPTIONS: { value: FeedbackCategory; label: string }[] = [
  { value: "furniture_scale", label: "Furniture Scale" },
  { value: "extra_furniture", label: "Extra Furniture" },
  { value: "structural_change", label: "Structural Change" },
  { value: "flooring_mismatch", label: "Flooring Mismatch" },
  { value: "other", label: "Other" },
];

interface QAAttemptFeedbackProps {
  attemptId: string;
  attemptNumber: number;
  qaStatus: "approved" | "rejected" | "pending";
  qaCategory?: string; // Pre-fill suggestion from QA
  existingVote?: "like" | "dislike" | null;
  isSubmitting?: boolean;
  onSubmit: (vote: "like" | "dislike", category: FeedbackCategory, comment: string) => void;
}

export const QAAttemptFeedback = memo(function QAAttemptFeedback({
  attemptId,
  attemptNumber,
  qaStatus,
  qaCategory,
  existingVote,
  isSubmitting = false,
  onSubmit,
}: QAAttemptFeedbackProps) {
  const [selectedVote, setSelectedVote] = useState<"like" | "dislike" | null>(existingVote || null);
  const [showForm, setShowForm] = useState(false);
  const [category, setCategory] = useState<FeedbackCategory>(() => {
    // Pre-fill from QA category if available
    const normalized = qaCategory?.toLowerCase().replace(/_/g, "_");
    if (CATEGORY_OPTIONS.some((c) => c.value === normalized)) {
      return normalized as FeedbackCategory;
    }
    return "other";
  });
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(!!existingVote);

  const handleVoteClick = (vote: "like" | "dislike") => {
    if (submitted) return;
    setSelectedVote(vote);
    setShowForm(true);
  };

  const handleSubmit = () => {
    if (!selectedVote) return;
    onSubmit(selectedVote, category, comment.slice(0, 200));
    setSubmitted(true);
    setShowForm(false);
  };

  // Already submitted - show confirmation
  if (submitted) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
        <Check className="w-3 h-3 text-green-500" />
        <span>Feedback saved</span>
        {existingVote && (
          <Badge
            variant="outline"
            className={cn(
              "text-[10px]",
              existingVote === "like"
                ? "border-green-500/50 text-green-400"
                : "border-red-500/50 text-red-400"
            )}
          >
            {existingVote === "like" ? "👍 QA correct" : "👎 QA wrong"}
          </Badge>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Like/Dislike buttons */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-muted-foreground">QA Feedback:</span>
        <Button
          variant={selectedVote === "like" ? "default" : "ghost"}
          size="sm"
          className={cn(
            "h-7 px-2 gap-1",
            selectedVote === "like" && "bg-green-600 hover:bg-green-700"
          )}
          onClick={() => handleVoteClick("like")}
          disabled={isSubmitting}
        >
          <ThumbsUp className="w-3 h-3" />
          <span className="text-xs">Correct</span>
        </Button>
        <Button
          variant={selectedVote === "dislike" ? "default" : "ghost"}
          size="sm"
          className={cn(
            "h-7 px-2 gap-1",
            selectedVote === "dislike" && "bg-red-600 hover:bg-red-700"
          )}
          onClick={() => handleVoteClick("dislike")}
          disabled={isSubmitting}
        >
          <ThumbsDown className="w-3 h-3" />
          <span className="text-xs">Wrong</span>
        </Button>
      </div>

      {/* Inline feedback form */}
      {showForm && selectedVote && (
        <div className="p-2 rounded-md bg-muted/50 border border-border/50 space-y-2">
          <div className="flex items-center gap-2">
            <Select value={category} onValueChange={(v) => setCategory(v as FeedbackCategory)}>
              <SelectTrigger className="h-7 text-xs w-[140px]">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                {CATEGORY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value} className="text-xs">
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Textarea
            placeholder="Optional: why is the QA decision correct/wrong? (max 200 chars)"
            value={comment}
            onChange={(e) => setComment(e.target.value.slice(0, 200))}
            className="h-14 text-xs resize-none"
            maxLength={200}
          />

          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">
              {comment.length}/200
            </span>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs"
                onClick={() => {
                  setShowForm(false);
                  setSelectedVote(null);
                }}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="h-6 text-xs"
                onClick={handleSubmit}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <Loader2 className="w-3 h-3 animate-spin mr-1" />
                ) : null}
                Submit
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

export default QAAttemptFeedback;
