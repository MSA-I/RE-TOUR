import { memo, useState, useCallback, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  SpaceStatusIndicator,
  SpaceStageStatus,
} from "./SpaceStatusIndicator";
import { SpaceDetailsDrawer } from "./SpaceDetailsDrawer";
import { SpaceScanDetailsDrawer } from "./SpaceScanDetailsDrawer";
import { SpaceOutputGrid } from "./SpaceOutputGrid";
import { SpaceRenderControls } from "./SpaceRenderControls";
import {
  PipelineSpace,
  SpaceRender,
  SpacePanorama,
} from "@/hooks/useWholeApartmentPipeline";
import { AvailableReferenceImage } from "@/hooks/useAvailableReferenceImages";
import { useStorage } from "@/hooks/useStorage";
import {
  Box,
  ChevronRight,
  ChevronDown,
  ThumbsUp,
  ThumbsDown,
  Loader2,
  Play,
  Lock,
  Eye,
  MoreHorizontal,
  RefreshCw,
  Trash2,
  Undo2,
  EyeOff,
  Scan,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface SpaceCardProps {
  space: PipelineSpace;
  pipelineId: string;
  styledImageUploadId: string | null;
  pipelineRatio: string;
  pipelineQuality: string;
  onRunRender: (renderId: string) => void;
  onRunPanorama: (panoramaId: string, sourceRenderId: string) => void;
  onRunMerge: (final360Id: string, panoAId: string, panoBId: string) => void;
  onApproveRender: (renderId: string) => void;
  onRejectRender: (renderId: string, notes: string) => void;
  onApprovePanorama: (panoramaId: string) => void;
  onRejectPanorama: (panoramaId: string, notes: string) => void;
  onApproveFinal360: (final360Id: string) => void;
  onRejectFinal360: (final360Id: string, notes: string) => void;
  onRetryRender: (renderId: string) => void;
  onRetryPanorama: (panoramaId: string) => void;
  onRetryFinal360: (final360Id: string) => void;
  onExcludeSpace?: (spaceId: string) => void;
  onRestoreSpace?: (spaceId: string) => void;
  isRunning: boolean;
  /** Optional explicit excluded flag (otherwise derived from space properties) */
  isExcluded?: boolean;
  // NEW: Per-space render control props
  availableReferenceImages?: AvailableReferenceImage[];
  onStartSpaceRender?: (spaceId: string, referenceIds: string[]) => void;
  onUpdateSpaceReferences?: (spaceId: string, referenceIds: string[]) => void;
  isRenderingSpace?: boolean;
  isUpdatingRefs?: boolean;
  /** Whether this space has at least one camera marker bound to it */
  hasMarker?: boolean;
}

export { type SpaceCardProps };

// Helper to derive status from asset
function deriveStatus(asset: { status: string; locked_approved?: boolean } | null | undefined): SpaceStageStatus {
  if (!asset) return "pending";
  if (asset.locked_approved) return "approved";
  switch (asset.status) {
    case "generating":
    case "running":
    case "retrying":
    case "editing": // NEW: Handle inpaint editing state
      return "running";
    case "needs_review":
      return "review";
    case "approved":
      return "approved";
    case "failed":
    case "rejected":
    case "qa_failed":
    case "blocked_for_human":
      return "failed";
    default:
      return "pending";
  }
}

// Combine two statuses into one
function combineStatus(a: SpaceStageStatus, b: SpaceStageStatus): SpaceStageStatus {
  if (a === "failed" || b === "failed") return "failed";
  if (a === "running" || b === "running") return "running";
  if (a === "review" || b === "review") return "review";
  if (a === "approved" && b === "approved") return "approved";
  return "pending";
}

// Mini status dot for per-asset progress visualization
function MiniStatusDot({ status, title }: { status: SpaceStageStatus; title?: string }) {
  const colorClass = {
    pending: "bg-muted-foreground/30",
    running: "bg-blue-500 animate-pulse",
    review: "bg-yellow-500",
    approved: "bg-primary",
    failed: "bg-destructive",
  }[status];
  
  return (
    <div 
      className={`w-2.5 h-2.5 rounded-full ${colorClass}`} 
      title={title}
    />
  );
}

export const SpaceCard = memo(function SpaceCard({
  space,
  pipelineId,
  styledImageUploadId,
  pipelineRatio,
  pipelineQuality,
  onRunRender,
  onRunPanorama,
  onRunMerge,
  onApproveRender,
  onRejectRender,
  onApprovePanorama,
  onRejectPanorama,
  onApproveFinal360,
  onRejectFinal360,
  onRetryRender,
  onRetryPanorama,
  onRetryFinal360,
  onExcludeSpace,
  onRestoreSpace,
  isRunning,
  isExcluded: isExcludedProp,
  // NEW: Per-space render control props
  availableReferenceImages = [],
  onStartSpaceRender,
  onUpdateSpaceReferences,
  isRenderingSpace = false,
  isUpdatingRefs = false,
  hasMarker = true,
}: SpaceCardProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [scanDetailsOpen, setScanDetailsOpen] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [excludeDialogOpen, setExcludeDialogOpen] = useState(false);
  const [rejectNotes, setRejectNotes] = useState("");
  const [pendingAction, setPendingAction] = useState<{ type: string; id: string; asset?: SpaceRender | SpacePanorama | null } | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [outputsExpanded, setOutputsExpanded] = useState(false);
  const [perSpaceControlsExpanded, setPerSpaceControlsExpanded] = useState(false);
  const [isPostApprovalReject, setIsPostApprovalReject] = useState(false);
  const { getSignedViewUrl } = useStorage();

  // Check if this space is excluded - use prop if provided, otherwise derive from space properties
  const isExcluded = isExcludedProp ?? (space.is_excluded || space.include_in_generation === false);

  const renderA = space.renders?.find((r) => r.kind === "A");
  const renderB = space.renders?.find((r) => r.kind === "B");
  const panoA = space.panoramas?.find((p) => p.kind === "A");
  const panoB = space.panoramas?.find((p) => p.kind === "B");
  const final360 = space.final360;

  // Parse reference_image_ids from space (handles both array and JSON array)
  const selectedReferenceIds = useMemo(() => {
    const refs = space.reference_image_ids;
    if (!refs) return [];
    if (Array.isArray(refs)) return refs as string[];
    return [];
  }, [space.reference_image_ids]);

  // Derive stage statuses
  const renderStatus = combineStatus(deriveStatus(renderA), deriveStatus(renderB));
  const panoStatus = combineStatus(deriveStatus(panoA), deriveStatus(panoB));
  const final360Status = deriveStatus(final360);

  const bothRendersApproved = renderA?.locked_approved && renderB?.locked_approved;
  const bothPanoramasApproved = panoA?.locked_approved && panoB?.locked_approved;

  // Determine the PRIMARY action for this space
  const primaryAction = useMemo(() => {
    // Step 1: Check if renders need attention
    if (renderA?.status === "needs_review" && !renderA.locked_approved) {
      return { type: "approve_render", asset: renderA, label: "Review Render A" };
    }
    if (renderB?.status === "needs_review" && !renderB.locked_approved) {
      return { type: "approve_render", asset: renderB, label: "Review Render B" };
    }

    // Can we generate renders?
    if (!renderA?.locked_approved && renderA?.status === "pending" && styledImageUploadId) {
      return { type: "run_render", asset: renderA, label: "Generate Render A" };
    }
    if (!renderB?.locked_approved && renderB?.status === "pending" && styledImageUploadId) {
      return { type: "run_render", asset: renderB, label: "Generate Render B" };
    }

    // Retry failed renders
    if (renderA && !renderA.locked_approved && ["rejected", "failed", "qa_failed"].includes(renderA.status)) {
      return { type: "retry_render", asset: renderA, label: "Retry Render A" };
    }
    if (renderB && !renderB.locked_approved && ["rejected", "failed", "qa_failed"].includes(renderB.status)) {
      return { type: "retry_render", asset: renderB, label: "Retry Render B" };
    }

    // Step 2: Check panoramas (only if both renders approved)
    if (bothRendersApproved) {
      if (panoA?.status === "needs_review" && !panoA.locked_approved) {
        return { type: "approve_panorama", asset: panoA, label: "Review Panorama A" };
      }
      if (panoB?.status === "needs_review" && !panoB.locked_approved) {
        return { type: "approve_panorama", asset: panoB, label: "Review Panorama B" };
      }

      if (!panoA?.locked_approved && panoA?.status === "pending" && renderA) {
        return { type: "run_panorama", asset: panoA, sourceRender: renderA, label: "Generate Panorama A" };
      }
      if (!panoB?.locked_approved && panoB?.status === "pending" && renderB) {
        return { type: "run_panorama", asset: panoB, sourceRender: renderB, label: "Generate Panorama B" };
      }

      // Retry failed panoramas
      if (panoA && !panoA.locked_approved && ["rejected", "failed", "qa_failed"].includes(panoA.status)) {
        return { type: "retry_panorama", asset: panoA, label: "Retry Panorama A" };
      }
      if (panoB && !panoB.locked_approved && ["rejected", "failed", "qa_failed"].includes(panoB.status)) {
        return { type: "retry_panorama", asset: panoB, label: "Retry Panorama B" };
      }
    }

    // Step 3: Check final 360 (only if both panoramas approved)
    if (bothPanoramasApproved && panoA && panoB) {
      if (final360?.status === "needs_review" && !final360.locked_approved) {
        return { type: "approve_final360", asset: final360, label: "Review Final 360" };
      }

      if (!final360?.locked_approved && final360?.status === "pending") {
        return { type: "run_merge", asset: final360, panoA, panoB, label: "Merge to 360°" };
      }

      // Retry failed merge
      if (final360 && !final360.locked_approved && ["rejected", "failed", "qa_failed"].includes(final360.status)) {
        return { type: "retry_final360", asset: final360, label: "Retry Merge" };
      }
    }

    // All done or waiting
    if (final360?.locked_approved) {
      return { type: "completed", label: "Completed" };
    }

    return { type: "waiting", label: "Waiting..." };
  }, [renderA, renderB, panoA, panoB, final360, styledImageUploadId, bothRendersApproved, bothPanoramasApproved]);

  const handlePrimaryAction = useCallback(() => {
    if (isRunning) return;

    switch (primaryAction.type) {
      case "run_render":
        if (primaryAction.asset) onRunRender(primaryAction.asset.id);
        break;
      case "run_panorama":
        if (primaryAction.asset && "sourceRender" in primaryAction && primaryAction.sourceRender) {
          onRunPanorama(primaryAction.asset.id, (primaryAction.sourceRender as SpaceRender).id);
        }
        break;
      case "run_merge":
        if (primaryAction.asset && "panoA" in primaryAction && "panoB" in primaryAction) {
          onRunMerge(
            primaryAction.asset.id,
            (primaryAction.panoA as SpacePanorama).id,
            (primaryAction.panoB as SpacePanorama).id
          );
        }
        break;
      case "retry_render":
        if (primaryAction.asset) onRetryRender(primaryAction.asset.id);
        break;
      case "retry_panorama":
        if (primaryAction.asset) onRetryPanorama(primaryAction.asset.id);
        break;
      case "retry_final360":
        if (primaryAction.asset) onRetryFinal360(primaryAction.asset.id);
        break;
    }
  }, [primaryAction, isRunning, onRunRender, onRunPanorama, onRunMerge, onRetryRender, onRetryPanorama, onRetryFinal360]);

  const handleRejectClick = useCallback((type: string, id: string, asset?: SpaceRender | SpacePanorama | null) => {
    // Detect if this is a post-approval rejection (AI already approved but user rejects)
    const wasApproved = asset && (
      asset.qa_status === "passed" ||
      asset.qa_status === "approved" ||
      (asset as any).structured_qa_result?.status?.toLowerCase() === "pass"
    );
    const hasOutput = asset?.output_upload_id;
    
    setIsPostApprovalReject(!!wasApproved && !!hasOutput);
    setPendingAction({ type, id, asset });
    setRejectNotes("");
    setRejectDialogOpen(true);
  }, []);

  const confirmReject = useCallback(() => {
    if (!pendingAction) return;
    if (pendingAction.type === "render") onRejectRender(pendingAction.id, rejectNotes);
    else if (pendingAction.type === "panorama") onRejectPanorama(pendingAction.id, rejectNotes);
    else if (pendingAction.type === "final360") onRejectFinal360(pendingAction.id, rejectNotes);
    setRejectDialogOpen(false);
    setPendingAction(null);
  }, [pendingAction, rejectNotes, onRejectRender, onRejectPanorama, onRejectFinal360]);

  const handlePreview = useCallback(async (uploadId: string) => {
    const result = await getSignedViewUrl("outputs", uploadId);
    if (result.signedUrl) {
      setPreviewUrl(result.signedUrl);
      setPreviewOpen(true);
    }
  }, [getSignedViewUrl]);

  // Render the primary action button
  const renderPrimaryButton = () => {
    if (primaryAction.type === "completed") {
      return (
        <Badge className="bg-green-500/20 text-green-400">
          <Lock className="w-3 h-3 mr-1" />
          Complete
        </Badge>
      );
    }

    if (primaryAction.type === "waiting") {
      return (
        <Badge variant="outline" className="text-muted-foreground">
          {primaryAction.label}
        </Badge>
      );
    }

    if (primaryAction.type.startsWith("approve_")) {
      const asset = primaryAction.asset;
      return (
        <div className="flex items-center gap-2">
          {asset?.output_upload_id && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => handlePreview(asset.output_upload_id!)}
            >
              <Eye className="w-4 h-4" />
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="text-primary border-primary hover:bg-primary/10"
            onClick={() => {
              if (primaryAction.type === "approve_render") onApproveRender(asset!.id);
              else if (primaryAction.type === "approve_panorama") onApprovePanorama(asset!.id);
              else if (primaryAction.type === "approve_final360") onApproveFinal360(asset!.id);
            }}
          >
            <ThumbsUp className="w-4 h-4 mr-1" />
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-destructive border-destructive hover:bg-destructive/10"
            onClick={() => {
              const type = primaryAction.type.replace("approve_", "");
              handleRejectClick(type, asset!.id);
            }}
          >
            <ThumbsDown className="w-4 h-4" />
          </Button>
        </div>
      );
    }

    if (primaryAction.type.startsWith("run_") || primaryAction.type.startsWith("retry_")) {
      const isRetry = primaryAction.type.startsWith("retry_");
      return (
        <Button
          size="sm"
          onClick={handlePrimaryAction}
          disabled={isRunning}
          variant={isRetry ? "outline" : "default"}
          className={isRetry ? "text-orange-500 border-orange-500 hover:bg-orange-500/10" : ""}
        >
          {isRunning ? (
            <Loader2 className="w-4 h-4 animate-spin mr-1" />
          ) : isRetry ? (
            <RefreshCw className="w-4 h-4 mr-1" />
          ) : (
            <Play className="w-4 h-4 mr-1" />
          )}
          {primaryAction.label}
        </Button>
      );
    }

    return null;
  };

  // Check if we have any outputs to show
  const hasAnyOutput = renderA?.output_upload_id || renderB?.output_upload_id || 
    panoA?.output_upload_id || panoB?.output_upload_id || final360?.output_upload_id;

  return (
    <>
      <Card className={`border-border/50 hover:border-border transition-colors ${isExcluded ? "opacity-60" : ""}`}>
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-4">
            {/* Left: Space info */}
            <div className="flex items-center gap-3 min-w-0">
              {isExcluded ? (
                <EyeOff className="w-5 h-5 text-muted-foreground flex-shrink-0" />
              ) : (
                <Box className="w-5 h-5 text-primary flex-shrink-0" />
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-medium truncate">{space.name}</h3>
                  {isExcluded && (
                    <Badge variant="secondary" className="text-xs">
                      Excluded
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground capitalize">
                  {space.space_type.replace("_", " ")}
                  {space.excluded_reason && (
                    <span className="ml-1 italic">• {space.excluded_reason}</span>
                  )}
                </p>
              </div>
            </div>

            {/* Center: Detailed per-asset progress indicators (hide if excluded) */}
            {!isExcluded && (
              <div className="hidden md:flex items-center gap-3">
                {/* Renders A/B */}
                <div className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground mr-0.5">R:</span>
                  <MiniStatusDot status={deriveStatus(renderA)} title={`Render A: ${renderA?.status || "pending"}`} />
                  <MiniStatusDot status={deriveStatus(renderB)} title={`Render B: ${renderB?.status || "pending"}`} />
                </div>
                {/* Panoramas A/B */}
                <div className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground mr-0.5">P:</span>
                  <MiniStatusDot status={deriveStatus(panoA)} title={`Pano A: ${panoA?.status || "pending"}`} />
                  <MiniStatusDot status={deriveStatus(panoB)} title={`Pano B: ${panoB?.status || "pending"}`} />
                </div>
                {/* Final 360 */}
                <div className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground mr-0.5">360:</span>
                  <MiniStatusDot status={deriveStatus(final360)} title={`Final 360: ${final360?.status || "pending"}`} />
                </div>
              </div>
            )}
            
            {/* Compact status for smaller screens */}
            {!isExcluded && (
              <div className="flex md:hidden items-center gap-2">
                <SpaceStatusIndicator label="R" status={renderStatus} compact />
                <SpaceStatusIndicator label="P" status={panoStatus} compact />
                <SpaceStatusIndicator label="360" status={final360Status} compact />
              </div>
            )}

            {/* Right: Primary action + menu */}
            <div className="flex items-center gap-2">
              {isExcluded ? (
                onRestoreSpace && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onRestoreSpace(space.id)}
                  >
                    <Undo2 className="w-4 h-4 mr-1" />
                    Restore
                  </Button>
                )
              ) : (
                renderPrimaryButton()
              )}

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                    <MoreHorizontal className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setScanDetailsOpen(true)}>
                    <Scan className="w-4 h-4 mr-2" />
                    View Scan & Prompts
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setDrawerOpen(true)}>
                    <ChevronRight className="w-4 h-4 mr-2" />
                    View Assets
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {renderA?.output_upload_id && (
                    <DropdownMenuItem onClick={() => handlePreview(renderA.output_upload_id!)}>
                      <Eye className="w-4 h-4 mr-2" />
                      Preview Render A
                    </DropdownMenuItem>
                  )}
                  {renderB?.output_upload_id && (
                    <DropdownMenuItem onClick={() => handlePreview(renderB.output_upload_id!)}>
                      <Eye className="w-4 h-4 mr-2" />
                      Preview Render B
                    </DropdownMenuItem>
                  )}
                  {final360?.output_upload_id && (
                    <DropdownMenuItem onClick={() => handlePreview(final360.output_upload_id!)}>
                      <Eye className="w-4 h-4 mr-2" />
                      Preview Final 360
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  {isExcluded ? (
                    onRestoreSpace && (
                      <DropdownMenuItem onClick={() => onRestoreSpace(space.id)}>
                        <Undo2 className="w-4 h-4 mr-2" />
                        Restore Space
                      </DropdownMenuItem>
                    )
                  ) : (
                    onExcludeSpace && (
                      <DropdownMenuItem 
                        onClick={() => setExcludeDialogOpen(true)}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Exclude from Generation
                      </DropdownMenuItem>
                    )
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Mobile: Status indicators (hide if excluded) */}
          {!isExcluded && (
            <div className="flex sm:hidden items-center gap-2 mt-3 pt-3 border-t border-border/50">
              <SpaceStatusIndicator label="Renders" status={renderStatus} compact />
              <SpaceStatusIndicator label="Panos" status={panoStatus} compact />
              <SpaceStatusIndicator label="360°" status={final360Status} compact />
            </div>
          )}

          {/* Always-visible outputs grid (collapsible) */}
          {hasAnyOutput && (
            <Collapsible open={outputsExpanded} onOpenChange={setOutputsExpanded} className="mt-3">
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="w-full justify-between h-8">
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Eye className="w-3 h-3" />
                    View All Outputs
                  </span>
                  <ChevronDown className={`w-3 h-3 transition-transform ${outputsExpanded ? "rotate-180" : ""}`} />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-3 border-t border-border/50 mt-2">
                <SpaceOutputGrid
                  renderA={renderA}
                  renderB={renderB}
                  panoramaA={panoA}
                  panoramaB={panoB}
                  final360={final360}
                  onApproveRender={onApproveRender}
                  onRejectRender={(id) => handleRejectClick("render", id, id === renderA?.id ? renderA : renderB)}
                  onApprovePanorama={onApprovePanorama}
                  onRejectPanorama={(id) => handleRejectClick("panorama", id, id === panoA?.id ? panoA : panoB)}
                  onApproveFinal360={onApproveFinal360}
                  onRejectFinal360={(id) => handleRejectClick("final360", id)}
                  isRunning={isRunning}
                  showOnlyWithOutputs
                />
              </CollapsibleContent>
            </Collapsible>
          )}

          {/* Per-Space Render Controls (collapsible) - Only show when handlers are provided */}
          {!isExcluded && onStartSpaceRender && onUpdateSpaceReferences && styledImageUploadId && (
            <Collapsible open={perSpaceControlsExpanded} onOpenChange={setPerSpaceControlsExpanded} className="mt-3">
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="w-full justify-between h-8">
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Play className="w-3 h-3" />
                    Per-Space Controls
                    {selectedReferenceIds.length > 0 && (
                      <Badge variant="secondary" className="text-[10px] px-1 py-0 ml-1">
                        {selectedReferenceIds.length} ref
                      </Badge>
                    )}
                  </span>
                  <ChevronDown className={`w-3 h-3 transition-transform ${perSpaceControlsExpanded ? "rotate-180" : ""}`} />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <SpaceRenderControls
                  spaceId={space.id}
                  spaceName={space.name}
                  pipelineId={pipelineId}
                  styledImageUploadId={styledImageUploadId}
                  renderA={renderA || null}
                  renderB={renderB || null}
                  availableReferenceImages={availableReferenceImages}
                  selectedReferenceIds={selectedReferenceIds}
                  onUpdateReferences={onUpdateSpaceReferences}
                  onStartSpaceRender={onStartSpaceRender}
                  onApproveRender={onApproveRender}
                  onRejectRender={(id, notes) => onRejectRender(id, notes)}
                  onRetryRender={onRetryRender}
                  isRendering={isRenderingSpace}
                  isUpdatingRefs={isUpdatingRefs}
                  hasMarker={hasMarker}
                />
              </CollapsibleContent>
            </Collapsible>
          )}
        </CardContent>
      </Card>

      {/* Scan Details Drawer - Camera scan results + Prompt preview */}
      <SpaceScanDetailsDrawer
        open={scanDetailsOpen}
        onOpenChange={setScanDetailsOpen}
        pipelineId={pipelineId}
        spaceId={space.id}
      />

      {/* Details Drawer - Asset outputs */}
      <SpaceDetailsDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        space={space}
        pipelineRatio={pipelineRatio}
        pipelineQuality={pipelineQuality}
      />

      {/* Reject/Edit Confirmation Dialog */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {isPostApprovalReject ? (
                <>
                  <span className="text-orange-500">✏</span>
                  Edit This Image
                </>
              ) : (
                "Reject Asset"
              )}
            </DialogTitle>
            <DialogDescription>
              {isPostApprovalReject ? (
                <span className="text-orange-400">
                  This image passed AI quality checks. Describe what to change — the system will edit the current image rather than generating a new one from scratch.
                </span>
              ) : (
                "Provide notes for why this asset is being rejected. This helps improve future generations."
              )}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder={
              isPostApprovalReject 
                ? "Describe what to change (e.g., 'Make the sofa darker', 'Add a plant in the corner')..." 
                : "Enter rejection reason..."
            }
            value={rejectNotes}
            onChange={(e) => setRejectNotes(e.target.value)}
            className="min-h-[100px]"
          />
          {isPostApprovalReject && !rejectNotes.trim() && (
            <p className="text-xs text-destructive">
              Please describe what changes you want — this is required for editing.
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              variant={isPostApprovalReject ? "default" : "destructive"} 
              onClick={confirmReject}
              disabled={isPostApprovalReject && !rejectNotes.trim()}
              className={isPostApprovalReject ? "bg-orange-500 hover:bg-orange-600" : ""}
            >
              {isPostApprovalReject ? "✏ Edit Image" : "Confirm Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview Dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Preview</DialogTitle>
          </DialogHeader>
          {previewUrl && (
            <img
              src={previewUrl}
              alt="Asset preview"
              className="w-full h-auto rounded-lg"
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Exclude Space Confirmation Dialog */}
      <AlertDialog open={excludeDialogOpen} onOpenChange={setExcludeDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Exclude "{space.name}" from generation?</AlertDialogTitle>
            <AlertDialogDescription>
              This will prevent panorama generation for this space. Any pending jobs for this space will be skipped.
              You can restore this space later if needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                onExcludeSpace?.(space.id);
                setExcludeDialogOpen(false);
              }}
            >
              Exclude Space
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
});
