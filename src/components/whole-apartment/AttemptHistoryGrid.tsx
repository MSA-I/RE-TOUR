import { memo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Check,
  X,
  Eye,
  ThumbsUp,
  ThumbsDown,
  AlertTriangle,
  Image as ImageIcon,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useStorage } from "@/hooks/useStorage";

export interface AttemptRecord {
  attemptNumber: number;
  outputUploadId: string | null;
  qaStatus: "approved" | "rejected" | "pending";
  qaReasons: string[];
  promptUsed?: string;
  modelUsed?: string;
  createdAt: string;
}

interface AttemptHistoryGridProps {
  attempts: AttemptRecord[];
  assetType: "render" | "panorama" | "final360";
  spaceId: string;
  onSelectAttempt?: (attemptNumber: number) => void;
  selectedAttemptNumber?: number;
  onApproveAttempt?: (attemptNumber: number) => void;
  isApproving?: boolean;
}

/**
 * Attempt History Grid
 * 
 * Shows all failed (and passed) attempts as thumbnails with:
 * - Counter badge (e.g., "3/5 failed")
 * - Full rejection reasons visible without clicking
 * - Ability to select any attempt to approve or continue from
 */
export const AttemptHistoryGrid = memo(function AttemptHistoryGrid({
  attempts,
  assetType,
  spaceId,
  onSelectAttempt,
  selectedAttemptNumber,
  onApproveAttempt,
  isApproving = false,
}: AttemptHistoryGridProps) {
  const { getSignedViewUrl } = useStorage();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);

  const failedCount = attempts.filter(a => a.qaStatus === "rejected").length;
  const totalCount = attempts.length;

  const handlePreview = async (uploadId: string) => {
    setLoadingPreview(true);
    try {
      const result = await getSignedViewUrl("outputs", uploadId);
      if (result.signedUrl) {
        setPreviewUrl(result.signedUrl);
        setPreviewOpen(true);
      }
    } finally {
      setLoadingPreview(false);
    }
  };

  if (attempts.length === 0) {
    return (
      <div className="text-center py-4 text-muted-foreground text-sm">
        No attempts recorded yet
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Summary Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Attempt History</span>
          <Badge 
            variant={failedCount > 0 ? "destructive" : "secondary"} 
            className="text-xs"
          >
            {failedCount}/{totalCount} failed
          </Badge>
        </div>
        {failedCount === totalCount && totalCount >= 5 && (
          <Badge variant="outline" className="text-xs text-warning border-warning/50">
            <AlertTriangle className="w-3 h-3 mr-1" />
            Manual review required
          </Badge>
        )}
      </div>

      {/* Grid of Attempts */}
      <div className="grid grid-cols-5 gap-2">
        {attempts.map((attempt) => (
          <AttemptThumbnail
            key={attempt.attemptNumber}
            attempt={attempt}
            isSelected={selectedAttemptNumber === attempt.attemptNumber}
            onSelect={() => onSelectAttempt?.(attempt.attemptNumber)}
            onPreview={() => attempt.outputUploadId && handlePreview(attempt.outputUploadId)}
            onApprove={() => onApproveAttempt?.(attempt.attemptNumber)}
            isApproving={isApproving}
          />
        ))}
      </div>

      {/* Selected Attempt Details */}
      {selectedAttemptNumber !== undefined && (
        <SelectedAttemptDetails
          attempt={attempts.find(a => a.attemptNumber === selectedAttemptNumber)}
          onPreview={(uploadId) => handlePreview(uploadId)}
          onApprove={() => onApproveAttempt?.(selectedAttemptNumber)}
          isApproving={isApproving}
        />
      )}

      {/* Full Preview Dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Attempt Preview</DialogTitle>
          </DialogHeader>
          {previewUrl && (
            <img
              src={previewUrl}
              alt="Attempt preview"
              className="w-full h-auto rounded-lg"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
});

// ============= Sub-components =============

interface AttemptThumbnailProps {
  attempt: AttemptRecord;
  isSelected: boolean;
  onSelect: () => void;
  onPreview: () => void;
  onApprove?: () => void;
  isApproving?: boolean;
}

const AttemptThumbnail = memo(function AttemptThumbnail({
  attempt,
  isSelected,
  onSelect,
  onPreview,
  onApprove,
  isApproving,
}: AttemptThumbnailProps) {
  const { getSignedViewUrl } = useStorage();
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);

  // Load thumbnail on mount
  useState(() => {
    if (attempt.outputUploadId) {
      getSignedViewUrl("outputs", attempt.outputUploadId).then(result => {
        if (result.signedUrl) {
          setThumbnailUrl(result.signedUrl);
        }
      });
    }
  });

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "relative aspect-square rounded-lg border-2 overflow-hidden transition-all",
        "hover:ring-2 hover:ring-primary/50",
        isSelected 
          ? "border-primary ring-2 ring-primary/30" 
          : attempt.qaStatus === "approved"
          ? "border-primary/50"
          : attempt.qaStatus === "rejected"
          ? "border-destructive/50"
          : "border-border"
      )}
    >
      {/* Thumbnail or placeholder */}
      {thumbnailUrl ? (
        <img
          src={thumbnailUrl}
          alt={`Attempt ${attempt.attemptNumber}`}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-muted">
          <ImageIcon className="w-6 h-6 text-muted-foreground" />
        </div>
      )}

      {/* Status overlay */}
      <div className={cn(
        "absolute inset-0 flex items-center justify-center",
        attempt.qaStatus === "rejected" && "bg-destructive/30"
      )}>
        {attempt.qaStatus === "approved" && (
          <div className="absolute top-1 right-1 bg-primary rounded-full p-0.5">
            <Check className="w-3 h-3 text-primary-foreground" />
          </div>
        )}
        {attempt.qaStatus === "rejected" && (
          <div className="absolute top-1 right-1 bg-destructive rounded-full p-0.5">
            <X className="w-3 h-3 text-destructive-foreground" />
          </div>
        )}
      </div>

      {/* Attempt number badge */}
      <div className="absolute bottom-1 left-1">
        <Badge variant="secondary" className="text-[10px] px-1 py-0">
          #{attempt.attemptNumber}
        </Badge>
      </div>
    </button>
  );
});

interface SelectedAttemptDetailsProps {
  attempt?: AttemptRecord;
  onPreview: (uploadId: string) => void;
  onApprove?: () => void;
  isApproving?: boolean;
}

const SelectedAttemptDetails = memo(function SelectedAttemptDetails({
  attempt,
  onPreview,
  onApprove,
  isApproving,
}: SelectedAttemptDetailsProps) {
  if (!attempt) return null;

  return (
    <div className="p-3 rounded-lg border border-border/50 bg-muted/30 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">
            Attempt #{attempt.attemptNumber}
          </span>
          <Badge
            variant={attempt.qaStatus === "approved" ? "default" : "destructive"}
            className="text-xs"
          >
            {attempt.qaStatus === "approved" ? "Passed" : "Failed"}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {attempt.outputUploadId && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onPreview(attempt.outputUploadId!)}
            >
              <Eye className="w-4 h-4 mr-1" />
              View Full
            </Button>
          )}
          {onApprove && attempt.qaStatus !== "approved" && (
            <Button
              size="sm"
              onClick={onApprove}
              disabled={isApproving}
            >
              {isApproving ? (
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              ) : (
                <ThumbsUp className="w-4 h-4 mr-1" />
              )}
              Approve This
            </Button>
          )}
        </div>
      </div>

      {/* Rejection Reasons - Full visibility, not truncated */}
      {attempt.qaStatus === "rejected" && attempt.qaReasons.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-destructive">Rejection Reasons:</p>
          <ScrollArea className="max-h-32">
            <ul className="text-xs text-muted-foreground space-y-1 list-disc ml-4">
              {attempt.qaReasons.map((reason, idx) => (
                <li key={idx} className="break-words">
                  {reason}
                </li>
              ))}
            </ul>
          </ScrollArea>
        </div>
      )}

      {/* Model/Prompt metadata */}
      {(attempt.modelUsed || attempt.promptUsed) && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {attempt.modelUsed && (
            <Badge variant="outline" className="text-[10px]">
              {attempt.modelUsed}
            </Badge>
          )}
          <span className="text-[10px]">
            {new Date(attempt.createdAt).toLocaleString()}
          </span>
        </div>
      )}
    </div>
  );
});

export default AttemptHistoryGrid;
