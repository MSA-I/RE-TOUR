import { memo, useState, useCallback, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useStorage } from "@/hooks/useStorage";
import { SpaceRender, SpacePanorama, SpaceFinal360 } from "@/hooks/useWholeApartmentPipeline";
import {
  Eye,
  Loader2,
  Lock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Camera,
  Image,
  Circle,
  ThumbsUp,
  ThumbsDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { QAStatusBadge } from "./QAStatusBadge";

type AssetType = SpaceRender | SpacePanorama | SpaceFinal360;

interface AssetPreviewProps {
  asset: AssetType | null | undefined;
  label: string;
  variant: "render" | "panorama" | "final360";
  modelUsed?: string | null;
  onApprove?: (id: string, score: number | null, reason: string) => void;
  onReject?: (id: string, score: number | null, reason: string) => void;
  isRunning?: boolean;
  stepId?: number;
  projectId?: string;
  pipelineId?: string;
}

const STATUS_BADGE_STYLES: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  running: "bg-blue-500/20 text-blue-400",
  generating: "bg-blue-500/20 text-blue-400",
  editing: "bg-orange-500/20 text-orange-400", // NEW: Inpaint editing
  needs_review: "bg-yellow-500/20 text-yellow-400",
  approved: "bg-green-500/20 text-green-400",
  rejected: "bg-destructive/20 text-destructive",
  failed: "bg-destructive/20 text-destructive",
  qa_failed: "bg-destructive/20 text-destructive",
};

const AssetPreviewCard = memo(function AssetPreviewCard({
  asset,
  label,
  variant,
  modelUsed,
  onApprove,
  onReject,
  isRunning,
  stepId = 5,
  projectId,
  pipelineId,
}: AssetPreviewProps) {
  const { getSignedViewUrl } = useStorage();
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [loadingThumb, setLoadingThumb] = useState(false);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const [fullImageUrl, setFullImageUrl] = useState<string | null>(null);
  
  // QA Review state
  const [reviewScore, setReviewScore] = useState<string>("");
  const [reviewReason, setReviewReason] = useState<string>("");
  const [showReviewForm, setShowReviewForm] = useState(false);

  // Auto-load thumbnail when asset has output
  useEffect(() => {
    if (!asset?.output_upload_id) {
      setThumbnailUrl(null);
      return;
    }

    const loadThumb = async () => {
      setLoadingThumb(true);
      try {
        const result = await getSignedViewUrl("outputs", asset.output_upload_id!);
        if (result.signedUrl) {
          setThumbnailUrl(result.signedUrl);
        }
      } finally {
        setLoadingThumb(false);
      }
    };

    loadThumb();
  }, [asset?.output_upload_id, getSignedViewUrl]);

  const handleOpenFullscreen = useCallback(async () => {
    if (!asset?.output_upload_id) return;
    
    // Use cached URL if available
    if (thumbnailUrl) {
      setFullImageUrl(thumbnailUrl);
      setFullscreenOpen(true);
      return;
    }

    const result = await getSignedViewUrl("outputs", asset.output_upload_id);
    if (result.signedUrl) {
      setFullImageUrl(result.signedUrl);
      setFullscreenOpen(true);
    }
  }, [asset?.output_upload_id, thumbnailUrl, getSignedViewUrl]);
  
  // Get numeric score from input
  const getScoreValue = useCallback((): number | null => {
    if (!reviewScore.trim()) return null;
    const num = parseInt(reviewScore, 10);
    return (num >= 0 && num <= 100) ? num : null;
  }, [reviewScore]);
  
  const handleApprove = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!asset || !onApprove) return;
    onApprove(asset.id, getScoreValue(), reviewReason);
    setReviewScore("");
    setReviewReason("");
    setShowReviewForm(false);
  }, [asset, onApprove, getScoreValue, reviewReason]);
  
  const handleReject = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!asset || !onReject) return;
    onReject(asset.id, getScoreValue(), reviewReason);
    setReviewScore("");
    setReviewReason("");
    setShowReviewForm(false);
  }, [asset, onReject, getScoreValue, reviewReason]);

  const isLocked = asset?.locked_approved;
  const status = asset?.status || "pending";
  const needsReview = status === "needs_review" && !isLocked;
  const isFailed = ["failed", "rejected", "qa_failed"].includes(status);
  const isApproved = isLocked || status === "approved";
  const isGenerating = ["running", "generating"].includes(status);

  const variantIcon = variant === "render" ? Camera : variant === "panorama" ? Image : Circle;
  const VariantIcon = variantIcon;

  return (
    <>
      <div className={cn(
        "relative rounded-lg border overflow-hidden transition-all",
        needsReview ? "border-yellow-500/50 ring-1 ring-yellow-500/30" : 
        isFailed ? "border-destructive/50" :
        isApproved ? "border-green-500/30" :
        "border-border/50"
      )}>
        {/* Header */}
        <div className="flex items-center justify-between px-2 py-1.5 bg-muted/30 border-b border-border/50">
          <div className="flex items-center gap-1.5 min-w-0">
            <VariantIcon className="w-3 h-3 text-muted-foreground flex-shrink-0" />
            <span className="text-xs font-medium truncate">
              {/* Show camera label if available, otherwise default label */}
              {(asset as SpaceRender)?.camera_label || label}
            </span>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {asset && (
              <QAStatusBadge
                status={asset.status}
                qaStatus={(asset as SpaceRender).qa_status}
                structuredQaResult={(asset as SpaceRender).structured_qa_result as never}
                modelUsed={modelUsed ?? (asset as any).model ?? null}
                attemptCount={(asset as SpaceRender).attempt_count || 1}
                maxAttempts={5}
                isLocked={asset.locked_approved}
              />
            )}
          </div>
        </div>

        {/* Image Preview Area */}
        <div 
          className="aspect-video bg-muted/20 cursor-pointer hover:bg-muted/40 transition-colors"
          onClick={handleOpenFullscreen}
        >
          {loadingThumb || isGenerating ? (
            <div className="w-full h-full flex items-center justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : thumbnailUrl ? (
            <img
              src={thumbnailUrl}
              alt={label}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : !asset || status === "pending" ? (
            <div className="w-full h-full flex items-center justify-center">
              <span className="text-xs text-muted-foreground">Not generated</span>
            </div>
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Eye className="w-4 h-4 text-muted-foreground" />
            </div>
          )}
        </div>

        {/* Quick Actions for Review with Score Input */}
        {needsReview && asset && onApprove && onReject && (
          <div className="p-2 bg-yellow-500/10 border-t border-yellow-500/30 space-y-2">
            {/* Score + Reason Row */}
            <div className="flex items-center gap-1.5">
              <Input
                type="text"
                inputMode="numeric"
                value={reviewScore}
                onChange={(e) => setReviewScore(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
                placeholder="0–100"
                className="w-14 h-6 text-[10px] font-mono text-center px-1"
                onClick={(e) => e.stopPropagation()}
                disabled={isRunning}
              />
              <Input
                type="text"
                value={reviewReason}
                onChange={(e) => setReviewReason(e.target.value.slice(0, 100))}
                placeholder="Reason (optional)"
                className="flex-1 h-6 text-[10px] px-1.5"
                onClick={(e) => e.stopPropagation()}
                disabled={isRunning}
              />
            </div>
            
            {/* Action Buttons */}
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                className="flex-1 h-6 text-[10px] text-primary hover:text-primary hover:bg-primary/10"
                onClick={handleApprove}
                disabled={isRunning}
              >
                <ThumbsUp className="w-3 h-3 mr-0.5" />
                Approve
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="flex-1 h-6 text-[10px] text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={handleReject}
                disabled={isRunning}
              >
                <ThumbsDown className="w-3 h-3 mr-0.5" />
                Reject
              </Button>
            </div>
          </div>
        )}

        {/* Approved indicator */}
        {isApproved && (
          <div className="absolute top-8 right-1">
            <CheckCircle2 className="w-4 h-4 text-primary drop-shadow" />
          </div>
        )}

        {/* Failed indicator */}
        {isFailed && (
          <div className="absolute top-8 right-1">
            <AlertCircle className="w-4 h-4 text-destructive drop-shadow" />
          </div>
        )}
      </div>

      {/* Fullscreen Preview Dialog */}
      <Dialog open={fullscreenOpen} onOpenChange={setFullscreenOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <VariantIcon className="w-5 h-5" />
              {label}
              {isLocked && (
                <Badge className="bg-green-500/20 text-green-400">
                  <Lock className="w-3 h-3 mr-1" />
                  Approved
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>
          {fullImageUrl && (
            <img
              src={fullImageUrl}
              alt={label}
              className="w-full h-auto rounded-lg"
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
});

interface SpaceOutputGridProps {
  renderA?: SpaceRender | null;
  renderB?: SpaceRender | null;
  panoramaA?: SpacePanorama | null;
  panoramaB?: SpacePanorama | null;
  final360?: SpaceFinal360 | null;
  onApproveRender?: (id: string, score: number | null, reason: string) => void;
  onRejectRender?: (id: string, score: number | null, reason: string) => void;
  onApprovePanorama?: (id: string, score: number | null, reason: string) => void;
  onRejectPanorama?: (id: string, score: number | null, reason: string) => void;
  onApproveFinal360?: (id: string, score: number | null, reason: string) => void;
  onRejectFinal360?: (id: string, score: number | null, reason: string) => void;
  isRunning?: boolean;
  showOnlyWithOutputs?: boolean;
}

export const SpaceOutputGrid = memo(function SpaceOutputGrid({
  renderA,
  renderB,
  panoramaA,
  panoramaB,
  final360,
  onApproveRender,
  onRejectRender,
  onApprovePanorama,
  onRejectPanorama,
  onApproveFinal360,
  onRejectFinal360,
  isRunning,
  showOnlyWithOutputs = false,
}: SpaceOutputGridProps) {
  // Filter to only show assets with outputs if requested
  const hasRenderA = renderA?.output_upload_id || !showOnlyWithOutputs;
  const hasRenderB = renderB?.output_upload_id || !showOnlyWithOutputs;
  const hasPanoA = panoramaA?.output_upload_id || !showOnlyWithOutputs;
  const hasPanoB = panoramaB?.output_upload_id || !showOnlyWithOutputs;
  const hasFinal = final360?.output_upload_id || !showOnlyWithOutputs;

  const hasAnyOutput = renderA?.output_upload_id || renderB?.output_upload_id || 
    panoramaA?.output_upload_id || panoramaB?.output_upload_id || final360?.output_upload_id;

  if (showOnlyWithOutputs && !hasAnyOutput) {
    return null;
  }

  return (
    <div className="space-y-3">
      {/* Renders Row */}
      {(hasRenderA || hasRenderB) && (
        <div>
          <p className="text-xs text-muted-foreground mb-1.5">Eye-Level Renders</p>
          <div className="grid grid-cols-2 gap-2">
            {hasRenderA && (
              <AssetPreviewCard
                asset={renderA}
                label="Render A"
                variant="render"
                modelUsed={renderA?.model ?? null}
                onApprove={onApproveRender}
                onReject={onRejectRender}
                isRunning={isRunning}
              />
            )}
            {hasRenderB && (
              <AssetPreviewCard
                asset={renderB}
                label="Render B"
                variant="render"
                modelUsed={renderB?.model ?? null}
                onApprove={onApproveRender}
                onReject={onRejectRender}
                isRunning={isRunning}
              />
            )}
          </div>
        </div>
      )}

      {/* Panoramas Row */}
      {(hasPanoA || hasPanoB) && (
        <div>
          <p className="text-xs text-muted-foreground mb-1.5">Panoramas</p>
          <div className="grid grid-cols-2 gap-2">
            {hasPanoA && (
              <AssetPreviewCard
                asset={panoramaA}
                label="Panorama A"
                variant="panorama"
                modelUsed={panoramaA?.model ?? null}
                onApprove={onApprovePanorama}
                onReject={onRejectPanorama}
                isRunning={isRunning}
              />
            )}
            {hasPanoB && (
              <AssetPreviewCard
                asset={panoramaB}
                label="Panorama B"
                variant="panorama"
                modelUsed={panoramaB?.model ?? null}
                onApprove={onApprovePanorama}
                onReject={onRejectPanorama}
                isRunning={isRunning}
              />
            )}
          </div>
        </div>
      )}

      {/* Final 360 */}
      {hasFinal && (
        <div>
          <p className="text-xs text-muted-foreground mb-1.5">Final 360°</p>
          <div className="w-full max-w-sm">
            <AssetPreviewCard
              asset={final360}
              label="Merged 360°"
              variant="final360"
              modelUsed={final360?.model ?? null}
              onApprove={onApproveFinal360}
              onReject={onRejectFinal360}
              isRunning={isRunning}
            />
          </div>
        </div>
      )}
    </div>
  );
});
