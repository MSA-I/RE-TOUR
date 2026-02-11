import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { StepAttempt } from "@/hooks/useStepAttempts";
import {
  Loader2,
  Eye,
  Maximize2,
  CheckCircle,
  XCircle,
  AlertTriangle
} from "lucide-react";
import { format } from "date-fns";

interface Step2OutputsPanelProps {
  pipelineId: string;
  projectId: string;
  attempts: StepAttempt[];
  isLoading?: boolean;
  /** REMOVED: QA controls moved to StageReviewPanel - this is now read-only history */
}

export function Step2OutputsPanel({
  pipelineId,
  projectId,
  attempts,
  isLoading,
}: Step2OutputsPanelProps) {
  const [viewingImage, setViewingImage] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (attempts.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          No outputs generated yet. Run Step 2 to create styled outputs.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/20 border border-border/30 rounded-md">
        <span className="text-xs font-medium text-muted-foreground">
          📜 Attempt History
        </span>
        <span className="text-xs text-muted-foreground">
          ({attempts.length} attempt{attempts.length !== 1 ? "s" : ""})
        </span>
        <span className="text-xs text-muted-foreground ml-auto">
          Read-only • Use panel above to approve/reject
        </span>
      </div>

      {attempts.map((attempt) => {
        const imageUrl = attempt.image_url;
        const isApproved = attempt.qa_status === "approved";
        const isRejected = attempt.qa_status === "rejected";
        const qaReason = attempt.qa_reason_short || attempt.qa_reason_full || null;
        const qaScore = null; // Not currently stored in attempts table

        return (
          <Card key={attempt.id} className="overflow-hidden border-border/30">
            <CardHeader className="pb-3 bg-muted/10">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Attempt #{attempt.attempt_index}
                </CardTitle>
                <div className="flex items-center gap-2">
                  {isApproved && (
                    <Badge variant="outline" className="text-xs bg-transparent">
                      <CheckCircle className="w-3 h-3 mr-1" />
                      Approved
                    </Badge>
                  )}
                  {isRejected && (
                    <Badge variant="outline" className="text-xs bg-transparent">
                      <XCircle className="w-3 h-3 mr-1" />
                      Rejected
                    </Badge>
                  )}
                  {!isApproved && !isRejected && (
                    <Badge variant="outline" className="text-xs bg-transparent text-muted-foreground">
                      Pending
                    </Badge>
                  )}
                  {qaScore != null && (
                    <Badge variant="outline" className="text-xs">
                      Score: {qaScore}/100
                    </Badge>
                  )}
                </div>
              </div>
              <div className="text-xs text-muted-foreground">
                {format(new Date(attempt.created_at), "MMM d, yyyy HH:mm")}
              </div>
            </CardHeader>

            <CardContent className="space-y-4">
              {/* Image preview */}
              {imageUrl ? (
                <div
                  className="relative aspect-[16/9] rounded border overflow-hidden cursor-pointer group"
                  onClick={() => setViewingImage(imageUrl)}
                >
                  <img
                    src={imageUrl}
                    alt={`Attempt ${attempt.attempt_index}`}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-background/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <Maximize2 className="h-6 w-6 text-foreground" />
                  </div>
                </div>
              ) : (
                <div className="aspect-[16/9] rounded border bg-muted/50 border-dashed flex flex-col items-center justify-center p-4">
                  <AlertTriangle className="h-6 w-6 text-muted-foreground mb-2" />
                  <p className="text-xs text-muted-foreground text-center">
                    Image not available
                  </p>
                </div>
              )}

              {/* Attempt history - READ-ONLY (QA controls in StageReviewPanel above) */}
              {qaReason && (
                <div className="p-3 rounded border border-border/30 bg-muted/5 text-sm">
                  <div className="font-medium text-muted-foreground text-xs">
                    Historical QA Decision
                  </div>
                  <div className="text-foreground mt-1">{qaReason}</div>
                  {qaScore != null && <div className="text-xs mt-1 text-muted-foreground">Score: {qaScore}/100</div>}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      {/* Full image view dialog */}
      {viewingImage && (
        <Dialog open={!!viewingImage} onOpenChange={() => setViewingImage(null)}>
          <DialogContent className="max-w-[90vw] max-h-[90vh] p-0">
            <img
              src={viewingImage}
              alt="Full size"
              className="w-full h-full object-contain"
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
