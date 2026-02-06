import React, { memo, useState, useCallback, useMemo, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { useStorage } from "@/hooks/useStorage";
import { SpaceRender } from "@/hooks/useWholeApartmentPipeline";
import {
  Play,
  Loader2,
  Image as ImageIcon,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Eye,
  ThumbsUp,
  ThumbsDown,
  AlertCircle,
  Lock,
  ImagePlus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface SpaceRenderControlsProps {
  spaceId: string;
  spaceName: string;
  pipelineId: string;
  styledImageUploadId: string | null;
  renderA: SpaceRender | null | undefined;
  renderB: SpaceRender | null | undefined;
  availableReferenceImages: Array<{ id: string; path: string; label?: string }>;
  selectedReferenceIds: string[];
  onUpdateReferences: (spaceId: string, referenceIds: string[]) => void;
  onStartSpaceRender: (spaceId: string, referenceIds: string[]) => void;
  onApproveRender: (renderId: string) => void;
  onRejectRender: (renderId: string, notes: string) => void;
  onRetryRender: (renderId: string) => void;
  isRendering: boolean;
  isUpdatingRefs: boolean;
  maxReferences?: number;
  /** Whether this space has at least one camera marker bound to it */
  hasMarker?: boolean;
}

/**
 * Per-Space Render Controls
 * 
 * Features:
 * - Per-space reference image selector (Step 4+ outputs)
 * - "Start Render for this Space" button
 * - Per-image Approve/Reject/Retry controls
 * - Attempt history visibility
 */
export const SpaceRenderControls = memo(function SpaceRenderControls({
  spaceId,
  spaceName,
  pipelineId,
  styledImageUploadId,
  renderA,
  renderB,
  availableReferenceImages,
  selectedReferenceIds,
  onUpdateReferences,
  onStartSpaceRender,
  onApproveRender,
  onRejectRender,
  onRetryRender,
  isRendering,
  isUpdatingRefs,
  maxReferences = 6,
  hasMarker = true, // Default to true to avoid blocking if not provided
}: SpaceRenderControlsProps) {
  const { getSignedViewUrl } = useStorage();
  const [referenceSelectorOpen, setReferenceSelectorOpen] = useState(false);
  const [localSelectedRefs, setLocalSelectedRefs] = useState<string[]>(selectedReferenceIds);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectNotes, setRejectNotes] = useState("");
  const [pendingRejectId, setPendingRejectId] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // ════════════════════════════════════════════════════════════════════════════
  // RENDER BUTTON GATING LOGIC
  // ════════════════════════════════════════════════════════════════════════════
  // Enable "Start Render for this Space" when ALL are true:
  //   1. Step 2 (styledImageUploadId) exists - base input for Camera A
  //   2. Not currently rendering this space
  //   3. Has at least one camera marker OR existing render records
  //   4. At least one render can be started (A/B pending/failed/not-locked)
  //
  // NEVER disable because:
  //   - "reference not loaded" - references are OPTIONAL
  //   - "output_A not available yet" - Camera B waits naturally (backend handles)
  //   - "Camera B cannot run yet" - that's normal, B waits for A
  // ════════════════════════════════════════════════════════════════════════════
  const canStartRender = useMemo(() => {
    // Required: Step 2 styled top-down image must exist
    if (!styledImageUploadId) return false;
    
    // Block: Already rendering this space
    if (isRendering) return false;
    
    // Required: Space must have a camera marker (or existing render records imply one)
    const hasExistingRenders = !!(renderA || renderB);
    if (!hasMarker && !hasExistingRenders) return false;
    
    // Can start if either A or B is in a startable state (not locked)
    // Include "planned" status - this is the initial state after confirm-camera-plan creates records
    const STARTABLE_STATUSES = ["pending", "planned", "rejected", "failed", "blocked", "queued"];
    const aCanRun = renderA && !renderA.locked_approved && 
      STARTABLE_STATUSES.includes(renderA.status);
    const bCanRun = renderB && !renderB.locked_approved && 
      STARTABLE_STATUSES.includes(renderB.status);
    
    // Also allow if no render records exist yet (will be created on start)
    const noRendersYet = !renderA && !renderB;
    
    return aCanRun || bCanRun || noRendersYet;
  }, [styledImageUploadId, isRendering, renderA, renderB, hasMarker]);

  const bothRendersComplete = renderA?.locked_approved && renderB?.locked_approved;

  // Human-readable disabled reason for the button
  const disabledReason = useMemo(() => {
    if (!styledImageUploadId) return "Step 2 (styled top-down) not complete";
    if (isRendering) return "Already rendering";
    if (!hasMarker && !renderA && !renderB) return "No camera marker for this space";
    if (bothRendersComplete) return "All renders approved";
    return null;
  }, [styledImageUploadId, isRendering, hasMarker, renderA, renderB, bothRendersComplete]);

  const handleOpenReferenceSelector = useCallback(() => {
    setLocalSelectedRefs(selectedReferenceIds);
    setReferenceSelectorOpen(true);
  }, [selectedReferenceIds]);

  const handleConfirmReferences = useCallback(() => {
    onUpdateReferences(spaceId, localSelectedRefs);
    setReferenceSelectorOpen(false);
    toast.success(`Updated ${localSelectedRefs.length} reference(s) for ${spaceName}`);
  }, [spaceId, localSelectedRefs, onUpdateReferences, spaceName]);

  const handleToggleReference = useCallback((refId: string) => {
    setLocalSelectedRefs(prev => {
      if (prev.includes(refId)) {
        return prev.filter(id => id !== refId);
      }
      if (prev.length >= maxReferences) {
        toast.error(`Maximum ${maxReferences} references allowed`);
        return prev;
      }
      return [...prev, refId];
    });
  }, [maxReferences]);

  const handleStartRender = useCallback(() => {
    onStartSpaceRender(spaceId, selectedReferenceIds);
  }, [spaceId, selectedReferenceIds, onStartSpaceRender]);

  const handleRejectClick = useCallback((renderId: string) => {
    setPendingRejectId(renderId);
    setRejectNotes("");
    setRejectDialogOpen(true);
  }, []);

  const confirmReject = useCallback(() => {
    if (pendingRejectId && rejectNotes.trim()) {
      onRejectRender(pendingRejectId, rejectNotes);
      setRejectDialogOpen(false);
      setPendingRejectId(null);
    }
  }, [pendingRejectId, rejectNotes, onRejectRender]);

  const handlePreview = useCallback(async (uploadId: string) => {
    const result = await getSignedViewUrl("outputs", uploadId);
    if (result.signedUrl) {
      setPreviewUrl(result.signedUrl);
      setPreviewOpen(true);
    }
  }, [getSignedViewUrl]);

  return (
    <div className="space-y-3 pt-3 border-t border-border/50">
      {/* Header with Reference Selector */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Per-Space Controls</span>
          {selectedReferenceIds.length > 0 && (
            <Badge variant="secondary" className="text-xs">
              {selectedReferenceIds.length} ref(s)
            </Badge>
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={handleOpenReferenceSelector}
          disabled={bothRendersComplete}
          className="h-7 text-xs"
        >
          <ImagePlus className="w-3 h-3 mr-1" />
          {selectedReferenceIds.length > 0 ? "Edit References" : "Add References"}
        </Button>
      </div>

      {/* Start Render Button */}
      <div className="flex flex-col gap-1">
        <Button
          size="sm"
          onClick={handleStartRender}
          disabled={!canStartRender}
          className="flex-1"
          title={disabledReason || undefined}
        >
          {isRendering ? (
            <>
              <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              Rendering...
            </>
          ) : bothRendersComplete ? (
            <>
              <Lock className="w-4 h-4 mr-1" />
              Renders Complete
            </>
          ) : (
            <>
              <Play className="w-4 h-4 mr-1" />
              Start Render for {spaceName}
            </>
          )}
        </Button>
        {disabledReason && !canStartRender && !bothRendersComplete && (
          <span className="text-xs text-muted-foreground text-center">{disabledReason}</span>
        )}
      </div>

      {/* Per-Image Controls */}
      <div className="grid grid-cols-2 gap-2">
        <RenderImageCard
          render={renderA}
          label="Camera A"
          onApprove={onApproveRender}
          onReject={handleRejectClick}
          onRetry={onRetryRender}
          onPreview={handlePreview}
          isRendering={isRendering}
        />
        <RenderImageCard
          render={renderB}
          label="Camera B"
          onApprove={onApproveRender}
          onReject={handleRejectClick}
          onRetry={onRetryRender}
          onPreview={handlePreview}
          isRendering={isRendering}
          dependsOnA={!renderA?.output_upload_id && !renderA?.locked_approved}
        />
      </div>

      {/* Reference Selector Dialog */}
      <Dialog open={referenceSelectorOpen} onOpenChange={setReferenceSelectorOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Select Reference Images for {spaceName}</DialogTitle>
            <DialogDescription>
              Choose up to {maxReferences} reference images from Step 4+ outputs. 
              These will guide the style and materials for this space only.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[400px]">
            {availableReferenceImages.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <ImageIcon className="w-12 h-12 mx-auto mb-2 opacity-30" />
                <p>No Step 4+ outputs available yet</p>
                <p className="text-xs">Complete earlier spaces to use them as references</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2 p-1">
                {availableReferenceImages.map(ref => (
                  <ReferenceImageTile
                    key={ref.id}
                    refImage={ref}
                    isSelected={localSelectedRefs.includes(ref.id)}
                    onToggle={() => handleToggleReference(ref.id)}
                    disabled={isUpdatingRefs}
                  />
                ))}
              </div>
            )}
          </ScrollArea>
          <DialogFooter>
            <Badge variant="outline" className="mr-auto">
              {localSelectedRefs.length}/{maxReferences} selected
            </Badge>
            <Button variant="outline" onClick={() => setReferenceSelectorOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleConfirmReferences} disabled={isUpdatingRefs}>
              {isUpdatingRefs ? (
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              ) : null}
              Confirm Selection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Render</DialogTitle>
            <DialogDescription>
              Provide a reason for rejection. This will be used to improve the next attempt.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Describe what's wrong (e.g., 'Wrong room type', 'Missing furniture', 'Style doesn't match')..."
            value={rejectNotes}
            onChange={(e) => setRejectNotes(e.target.value)}
            className="min-h-[100px]"
          />
          {!rejectNotes.trim() && (
            <p className="text-xs text-destructive">Rejection reason is required</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              variant="destructive" 
              onClick={confirmReject}
              disabled={!rejectNotes.trim()}
            >
              <ThumbsDown className="w-4 h-4 mr-1" />
              Confirm Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview Dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Render Preview</DialogTitle>
          </DialogHeader>
          {previewUrl && (
            <img
              src={previewUrl}
              alt="Render preview"
              className="w-full h-auto rounded-lg"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
});

// ============= Sub-components =============

interface RenderImageCardProps {
  render: SpaceRender | null | undefined;
  label: string;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onRetry: (id: string) => void;
  onPreview: (uploadId: string) => void;
  isRendering: boolean;
  dependsOnA?: boolean;
}

const RenderImageCard = memo(function RenderImageCard({
  render,
  label,
  onApprove,
  onReject,
  onRetry,
  onPreview,
  isRendering,
  dependsOnA = false,
}: RenderImageCardProps) {
  const { getSignedViewUrl } = useStorage();
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);

  // Load thumbnail using useEffect
  React.useEffect(() => {
    if (render?.output_upload_id) {
      getSignedViewUrl("outputs", render.output_upload_id).then(result => {
        if (result.signedUrl) {
          setThumbnailUrl(result.signedUrl);
        }
      });
    }
  }, [render?.output_upload_id, getSignedViewUrl]);

  const status = render?.status || "pending";
  const isLocked = render?.locked_approved;
  const isRunning = ["generating", "running", "queued"].includes(status);
  const needsReview = status === "needs_review" && !isLocked;
  const isFailed = ["failed", "rejected", "qa_failed", "blocked"].includes(status);
  const attemptCount = render?.attempt_count || 1;

  return (
    <div className={cn(
      "relative rounded-lg border overflow-hidden bg-muted/20",
      needsReview && "border-yellow-500/50 ring-1 ring-yellow-500/20",
      isFailed && "border-destructive/50",
      isLocked && "border-green-500/30",
    )}>
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1 bg-muted/30 border-b border-border/50">
        <span className="text-xs font-medium">{render?.camera_label || label}</span>
        <div className="flex items-center gap-1">
          {attemptCount > 1 && (
            <Badge variant="outline" className="text-[10px] px-1">
              #{attemptCount}
            </Badge>
          )}
          {isLocked && <Lock className="w-3 h-3 text-green-500" />}
          {isFailed && <AlertCircle className="w-3 h-3 text-destructive" />}
        </div>
      </div>

      {/* Image Area */}
      <div 
        className="aspect-video cursor-pointer hover:opacity-80 transition-opacity"
        onClick={() => render?.output_upload_id && onPreview(render.output_upload_id)}
      >
        {isRunning ? (
          <div className="w-full h-full flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={label}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : dependsOnA && status === "pending" ? (
          <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground">
            <span className="text-[10px]">Waiting for A</span>
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <ImageIcon className="w-6 h-6 text-muted-foreground/30" />
          </div>
        )}
      </div>

      {/* Action Buttons */}
      {render && !isLocked && (
        <div className="flex items-center gap-1 p-1 border-t border-border/50">
          {needsReview ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                className="flex-1 h-6 text-[10px] text-green-500 hover:bg-green-500/10"
                onClick={() => onApprove(render.id)}
                disabled={isRendering}
              >
                <ThumbsUp className="w-3 h-3 mr-0.5" />
                Approve
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="flex-1 h-6 text-[10px] text-destructive hover:bg-destructive/10"
                onClick={() => onReject(render.id)}
                disabled={isRendering}
              >
                <ThumbsDown className="w-3 h-3 mr-0.5" />
                Reject
              </Button>
            </>
          ) : isFailed ? (
            <Button
              size="sm"
              variant="ghost"
              className="flex-1 h-6 text-[10px] text-orange-500 hover:bg-orange-500/10"
              onClick={() => onRetry(render.id)}
              disabled={isRendering}
            >
              <RefreshCw className="w-3 h-3 mr-0.5" />
              Retry
            </Button>
          ) : render.output_upload_id ? (
            <Button
              size="sm"
              variant="ghost"
              className="flex-1 h-6 text-[10px]"
              onClick={() => onPreview(render.output_upload_id!)}
            >
              <Eye className="w-3 h-3 mr-0.5" />
              View
            </Button>
          ) : null}
        </div>
      )}

      {/* Locked Indicator */}
      {isLocked && (
        <div className="absolute top-6 right-1">
          <CheckCircle2 className="w-4 h-4 text-green-500 drop-shadow" />
        </div>
      )}
    </div>
  );
});

interface ReferenceImageTileProps {
  refImage: { id: string; path: string; label?: string };
  isSelected: boolean;
  onToggle: () => void;
  disabled: boolean;
}

const ReferenceImageTile = memo(function ReferenceImageTile({
  refImage,
  isSelected,
  onToggle,
  disabled,
}: ReferenceImageTileProps) {
  const { getSignedViewUrl } = useStorage();
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);

  // Load thumbnail on mount
  useEffect(() => {
    getSignedViewUrl("outputs", refImage.id).then(result => {
      if (result.signedUrl) {
        setThumbnailUrl(result.signedUrl);
      }
    });
  }, [refImage.id, getSignedViewUrl]);

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      className={cn(
        "relative aspect-video rounded-lg border-2 overflow-hidden transition-all",
        "hover:ring-2 hover:ring-primary/50",
        isSelected ? "border-primary ring-2 ring-primary/30" : "border-border",
        disabled && "opacity-50 cursor-not-allowed"
      )}
    >
      {thumbnailUrl ? (
        <img
          src={thumbnailUrl}
          alt={refImage.label || "Reference"}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-muted">
          <ImageIcon className="w-6 h-6 text-muted-foreground" />
        </div>
      )}
      <div className="absolute top-1 left-1">
        <Checkbox
          checked={isSelected}
          onCheckedChange={() => onToggle()}
          disabled={disabled}
          className="bg-background/80"
        />
      </div>
      {refImage.label && (
        <div className="absolute bottom-0 left-0 right-0 bg-background/80 px-1 py-0.5">
          <span className="text-[10px] truncate">{refImage.label}</span>
        </div>
      )}
    </button>
  );
});

export default SpaceRenderControls;
