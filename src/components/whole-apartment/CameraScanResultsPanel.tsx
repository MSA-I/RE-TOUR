import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { 
  ChevronDown, 
  ChevronRight, 
  CheckCircle2, 
  AlertTriangle, 
  XCircle,
  Eye,
  DoorOpen,
  Lightbulb,
  RefreshCw,
  Circle,
  ArrowUp,
  ArrowDown,
  Image,
  Tag,
  Crop,
  ZoomIn,
  Trash2,
} from "lucide-react";
import type { PanoramaPointScanResult, EmbeddedCameraContext } from "@/hooks/useCameraScan";
import type { CameraScanItem } from "@/hooks/useCameraScanItems";

/** Marker data for crop status - uses anchor_status as single source of truth */
interface MarkerCropData {
  id: string;
  label: string;
  anchor_status?: string;
  anchor_crop_overlay_path?: string | null;
}

interface CameraScanResultsPanelProps {
  results: PanoramaPointScanResult[];
  isScanning: boolean;
  onRescan: () => void;
  /** Lookup map from room ID to canonical room name (from Space Analysis) */
  roomNameLookup?: Map<string, string>;
  /** Scan items with crop URLs and label detection */
  scanItems?: CameraScanItem[];
  /** Whether scan items are still loading */
  isLoadingItems?: boolean;
  /** Get scan item for a specific marker */
  getItemForMarker?: (markerId: string) => CameraScanItem | undefined;
  /** Get crop URL for a specific marker */
  getCropUrlForMarker?: (markerId: string) => string | null;
  /** Pipeline ID for reset operations */
  pipelineId?: string;
  /** Handler to reset a crop for a specific marker */
  onResetCrop?: (markerId: string, markerLabel: string) => void;
  /** Whether a reset is in progress */
  isResettingCrop?: boolean;
  /** Markers with anchor status - SINGLE SOURCE OF TRUTH for crop existence */
  markers?: MarkerCropData[];
}

/** Get canonical room name from lookup, falling back to the provided name */
function resolveRoomName(roomId: string, providedName: string, lookup?: Map<string, string>): string {
  if (lookup && lookup.has(roomId)) {
    return lookup.get(roomId)!;
  }
  return providedName;
}

function CropThumbnail({ 
  item, 
  markerLabel,
  onViewFull,
  isExpired = false,
  /** Fallback crop URL from marker anchor (single source of truth) */
  markerCropUrl,
  /** Whether marker has anchor status = ready */
  hasAnchorReady = false,
}: { 
  item: CameraScanItem | undefined; 
  markerLabel: string;
  onViewFull: () => void;
  isExpired?: boolean;
  markerCropUrl?: string | null;
  hasAnchorReady?: boolean;
}) {
  // Check if crop is expired
  const cropExpired = item?.crop_expires_at 
    ? new Date(item.crop_expires_at) < new Date() 
    : false;
  const effectivelyExpired = isExpired || cropExpired;

  // Use scan item crop first, then fallback to marker crop URL
  const cropUrl = item?.crop_public_url || markerCropUrl;
  const hasCrop = !!cropUrl && !effectivelyExpired;

  // Show "ready" state if marker anchor is ready, even if we don't have a displayable URL
  if (!hasCrop && !hasAnchorReady) {
    return (
      <div 
        className="flex flex-col items-center justify-center w-14 h-14 shrink-0 bg-muted/50 rounded border border-dashed border-muted-foreground/30"
        title={effectivelyExpired ? "Crop expired - regenerate anchors" : "No crop available"}
      >
        <Crop className="h-4 w-4 text-muted-foreground" />
        {effectivelyExpired && (
          <span className="text-[8px] text-destructive mt-0.5">Expired</span>
        )}
      </div>
    );
  }

  // Show green checkmark if anchor is ready but no displayable URL
  if (!hasCrop && hasAnchorReady) {
    return (
      <div 
        className="flex flex-col items-center justify-center w-14 h-14 shrink-0 bg-status-approved/10 rounded border border-status-approved/50"
        title="Anchor ready (screenshot captured)"
      >
        <CheckCircle2 className="h-5 w-5 text-status-approved" />
      </div>
    );
  }

  return (
    <div 
      className="relative group cursor-pointer shrink-0"
      onClick={(e) => {
        e.stopPropagation();
        onViewFull();
      }}
    >
      <img
        src={cropUrl}
        alt={`Crop for ${markerLabel}`}
        className="w-14 h-14 object-cover rounded border border-border group-hover:border-primary transition-colors"
        loading="lazy"
        onError={(e) => {
          // Hide broken images
          e.currentTarget.style.display = 'none';
        }}
      />
      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded flex items-center justify-center">
        <ZoomIn className="h-4 w-4 text-white" />
      </div>
    </div>
  );
}

function LabelBadge({ item }: { item: CameraScanItem }) {
  if (!item.detected_room_label) {
    return null;
  }

  const confidenceColor = item.detected_label_confidence >= 0.8 
    ? "text-status-approved" 
    : item.detected_label_confidence >= 0.5 
      ? "text-status-running"
      : "text-status-rejected";

  return (
    <Badge variant="outline" className="text-xs gap-1 max-w-full">
      <Tag className="h-3 w-3 shrink-0" />
      <span className="truncate">{item.detected_room_label}</span>
      <span className={`shrink-0 ${confidenceColor}`}>
        ({Math.round(item.detected_label_confidence * 100)}%)
      </span>
    </Badge>
  );
}

function EmbeddedCameraCard({ 
  camera, 
  slot, 
  roomNameLookup 
}: { 
  camera: EmbeddedCameraContext; 
  slot: "A" | "B"; 
  roomNameLookup?: Map<string, string>;
}) {
  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.8) return "text-status-approved";
    if (confidence >= 0.5) return "text-status-running";
    return "text-status-rejected";
  };

  const slotLabel = slot === "A" ? "Camera A (Primary)" : "Camera B (Mirror)";
  const SlotIcon = slot === "A" ? ArrowUp : ArrowDown;

  return (
    <div className="p-3 bg-muted/30 rounded-lg space-y-2">
      <div className="flex items-center gap-2">
        <SlotIcon className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">{slotLabel}</span>
        <Badge variant="outline" className="text-xs ml-auto">
          {camera.yaw_deg}°
        </Badge>
      </div>

      {/* View Target */}
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">
          <span className="font-medium">Looking at:</span>{" "}
          {camera.direction_context.primary_view_target}
        </p>
      </div>

      {/* Visible Adjacent Rooms */}
      {camera.direction_context.likely_visible_adjacent_rooms.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
            <DoorOpen className="h-3 w-3" />
            Visible Rooms
          </p>
          <div className="flex flex-wrap gap-1">
            {camera.direction_context.likely_visible_adjacent_rooms.map((room, i) => {
              const displayName = resolveRoomName(room.room_id, room.room_name, roomNameLookup);
              return (
                <Badge key={i} variant="secondary" className="text-xs">
                  {displayName}
                  <span className={`ml-1 ${getConfidenceColor(room.confidence)}`}>
                    ({Math.round(room.confidence * 100)}%)
                  </span>
                </Badge>
              );
            })}
          </div>
        </div>
      )}

      {/* Visible Openings */}
      {camera.direction_context.likely_visible_openings.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {camera.direction_context.likely_visible_openings.map((opening, i) => (
            <Badge key={i} variant="outline" className="text-xs">
              {opening.type} ({opening.side})
            </Badge>
          ))}
        </div>
      )}

      {/* Prompt Hints */}
      {camera.prompt_hints.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
            <Lightbulb className="h-3 w-3" />
            Hints
          </p>
          <ul className="text-xs text-muted-foreground space-y-0.5">
            {camera.prompt_hints.slice(0, 3).map((hint, i) => (
              <li key={i} className="flex items-start gap-1">
                <span className="text-primary mt-0.5">•</span>
                {hint}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Warnings */}
      {camera.warnings.length > 0 && (
        <div className="space-y-1">
          <ul className="text-xs text-status-running space-y-0.5">
            {camera.warnings.map((warning, i) => (
              <li key={i} className="flex items-start gap-1">
                <AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" />
                {warning}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function CameraScanResultsPanel({ 
  results, 
  isScanning, 
  onRescan,
  roomNameLookup,
  scanItems = [],
  isLoadingItems = false,
  getItemForMarker,
  getCropUrlForMarker,
  pipelineId,
  onResetCrop,
  isResettingCrop = false,
  markers = [],
}: CameraScanResultsPanelProps) {
  const [expandedPoints, setExpandedPoints] = useState<Set<string>>(new Set());
  const [fullImageUrl, setFullImageUrl] = useState<string | null>(null);
  const [fullImageLabel, setFullImageLabel] = useState<string>("");

  // Build lookup map for scan items by marker ID
  const itemsByMarkerId = new Map<string, CameraScanItem>();
  for (const item of scanItems) {
    itemsByMarkerId.set(item.marker_id, item);
  }

  // Build lookup map for markers by ID - SINGLE SOURCE OF TRUTH
  const markersByIdMap = new Map<string, MarkerCropData>();
  for (const marker of markers) {
    markersByIdMap.set(marker.id, marker);
  }

  // Helper: Check if marker has crop (using anchor_status as source of truth)
  const markerHasCrop = (markerId: string): boolean => {
    const marker = markersByIdMap.get(markerId);
    // Anchor is "ready" = crop exists, regardless of scan_items table
    if (marker?.anchor_status === "ready") return true;
    // Fallback to scan items if no marker data
    const scanItem = itemsByMarkerId.get(markerId);
    return !!scanItem?.crop_public_url;
  };

  const togglePoint = (pointId: string) => {
    const newSet = new Set(expandedPoints);
    if (newSet.has(pointId)) {
      newSet.delete(pointId);
    } else {
      newSet.add(pointId);
    }
    setExpandedPoints(newSet);
  };

  const getConfidenceBadge = (confidence: number) => {
    if (confidence >= 0.8) return "default";
    if (confidence >= 0.5) return "secondary";
    return "destructive";
  };

  const totalCameras = results.length * 2;
  const totalWarnings = results.reduce((sum, r) => {
    const camAWarnings = r.embedded_cameras[0]?.warnings.length || 0;
    const camBWarnings = r.embedded_cameras[1]?.warnings.length || 0;
    return sum + camAWarnings + camBWarnings;
  }, 0);
  
  // CRITICAL: Use marker anchor_status as source of truth for crop count
  // This ensures consistency with the Panorama Points panel
  const totalCrops = results.filter(r => markerHasCrop(r.panorama_point_id)).length;
  const totalLabels = scanItems.filter(i => !!i.detected_room_label).length;

  if (results.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-8 text-center">
          <Circle className="h-10 w-10 text-muted-foreground mb-3" />
          <p className="text-muted-foreground">No scan results yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            Click "Scan Panorama Points (AI)" to analyze positions
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="w-full overflow-hidden">
        <div className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Eye className="h-4 w-4 shrink-0" />
              <span className="text-sm font-medium truncate">AI Scan Results</span>
              <Badge variant="secondary" className="text-xs shrink-0">
                {results.length} points • {totalCameras} cameras
              </Badge>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={onRescan}
              disabled={isScanning}
              className="shrink-0"
            >
              <RefreshCw className={`h-3 w-3 mr-1 ${isScanning ? "animate-spin" : ""}`} />
              Re-scan
            </Button>
          </div>
          
          {/* Summary badges - wrap properly */}
          <div className="flex flex-wrap gap-1 mt-2">
            {/* Crop status - show ready vs missing */}
            <Badge 
              variant={totalCrops === results.length ? "default" : "outline"} 
              className={`text-xs gap-1 ${totalCrops === results.length ? "bg-status-approved/20 text-status-approved border-status-approved/50" : totalCrops === 0 ? "text-destructive border-destructive/50" : "text-status-running border-status-running/50"}`}
            >
              <Image className="h-3 w-3" />
              {totalCrops}/{results.length} crops
            </Badge>
            {totalLabels > 0 && (
              <Badge variant="outline" className="text-xs gap-1">
                <Tag className="h-3 w-3" />
                {totalLabels} labels
              </Badge>
            )}
            {totalWarnings > 0 && (
              <Badge variant="outline" className="text-xs gap-1 text-status-running border-status-running/50">
                <AlertTriangle className="h-3 w-3" />
                {totalWarnings} warnings
              </Badge>
            )}
          </div>
          
          {/* Warning if crops are missing */}
          {totalCrops < results.length && (
            <p className="text-xs text-destructive mt-1">
              ⚠ {results.length - totalCrops} marker(s) missing crops. Create anchors to generate.
            </p>
          )}
        </div>
        <div className="space-y-2">
              {results.map((result) => {
                const cameraA = result.embedded_cameras.find(c => c.camera_slot === "A");
                const cameraB = result.embedded_cameras.find(c => c.camera_slot === "B");
                const hasWarnings = 
                  (cameraA?.warnings.length || 0) > 0 || 
                  (cameraB?.warnings.length || 0) > 0;
                const scanItem = itemsByMarkerId.get(result.panorama_point_id);
                
                // Get marker data for this point (source of truth for anchor status)
                const markerData = markersByIdMap.get(result.panorama_point_id);
                const hasAnchorReady = markerData?.anchor_status === "ready";
                const markerCropUrl = getCropUrlForMarker?.(result.panorama_point_id);

                return (
                  <Collapsible
                    key={result.panorama_point_id}
                    open={expandedPoints.has(result.panorama_point_id)}
                    onOpenChange={() => togglePoint(result.panorama_point_id)}
                  >
                    <CollapsibleTrigger asChild>
                      <div className="flex items-start gap-2 p-2 bg-muted/50 rounded-lg cursor-pointer hover:bg-muted transition-colors min-w-0 overflow-hidden">
                        <div className="flex items-center gap-2 shrink-0">
                          {expandedPoints.has(result.panorama_point_id) ? (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          )}
                          
                          {/* Crop thumbnail - uses anchor_status as source of truth */}
                          <CropThumbnail
                            item={scanItem}
                            markerLabel={result.panorama_point_label}
                            onViewFull={() => {
                              const cropUrl = scanItem?.crop_public_url || markerCropUrl;
                              if (cropUrl) {
                                setFullImageUrl(cropUrl);
                                setFullImageLabel(result.panorama_point_label);
                              }
                            }}
                            markerCropUrl={markerCropUrl}
                            hasAnchorReady={hasAnchorReady}
                          />
                        </div>
                        
                        {/* Text content - must truncate */}
                        <div className="flex-1 min-w-0 overflow-hidden">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="relative shrink-0">
                              <Circle className="h-4 w-4 text-primary fill-primary/20" />
                              <div className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-primary rounded-full" />
                              <div className="absolute -bottom-0.5 -left-0.5 w-1.5 h-1.5 bg-status-running rounded-full" />
                            </div>
                            <span className="font-medium text-sm truncate">{result.panorama_point_label}</span>
                          </div>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                            <span>A: {cameraA?.yaw_deg}°</span>
                            <span>•</span>
                            <span>B: {cameraB?.yaw_deg}°</span>
                          </div>
                          {/* Show detected label - wraps properly */}
                          {scanItem && (
                            <div className="mt-1 max-w-full overflow-hidden">
                              <LabelBadge item={scanItem} />
                            </div>
                          )}
                        </div>
                        
                        {/* Status icons - shrink-0 */}
                        <div className="flex items-center gap-1 shrink-0">
                          {hasWarnings && (
                            <AlertTriangle className="h-4 w-4 text-status-running" />
                          )}
                          {result.room_validation.match ? (
                            <CheckCircle2 className="h-4 w-4 text-status-approved" />
                          ) : (
                            <XCircle className="h-4 w-4 text-status-rejected" />
                          )}
                          <Badge variant={getConfidenceBadge(result.room_validation.confidence)} className="text-xs">
                            {Math.round(result.room_validation.confidence * 100)}%
                          </Badge>
                        </div>
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="p-3 pt-2 space-y-3 border-l-2 border-primary/30 ml-4">
                        {/* Crop preview (larger) with Reset button */}
                        {scanItem?.crop_public_url ? (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                                <Crop className="h-3 w-3" />
                                Target Area Crop
                              </p>
                              {onResetCrop && (
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 px-2 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                                      disabled={isResettingCrop}
                                    >
                                      <Trash2 className="h-3 w-3 mr-1" />
                                      Reset
                                    </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Reset Screenshot?</AlertDialogTitle>
                                      <AlertDialogDescription>
                                        This will delete the crop screenshot for "{result.panorama_point_label}".
                                        The previous crop will be permanently removed and cannot be used in renders.
                                        You'll need to take a new screenshot before generating renders.
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                                      <AlertDialogAction
                                        onClick={() => onResetCrop(result.panorama_point_id, result.panorama_point_label)}
                                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                      >
                                        Reset Screenshot
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              )}
                            </div>
                            <img
                              src={scanItem.crop_public_url}
                              alt={`Crop for ${result.panorama_point_label}`}
                              className="w-full max-w-xs rounded-lg border border-border cursor-pointer hover:border-primary transition-colors"
                              onClick={() => {
                                setFullImageUrl(scanItem.crop_public_url);
                                setFullImageLabel(result.panorama_point_label);
                              }}
                            />
                            {scanItem.prompt_hint_text && (
                              <p className="text-xs text-muted-foreground italic">
                                "{scanItem.prompt_hint_text}"
                              </p>
                            )}
                          </div>
                        ) : (
                          <div className="p-3 bg-muted/30 rounded-lg border border-dashed border-muted-foreground/30">
                            <p className="text-xs text-muted-foreground flex items-center gap-2">
                              <AlertTriangle className="h-4 w-4 text-status-running" />
                              Screenshot missing — create anchor to generate crop
                            </p>
                          </div>
                        )}

                        {/* Room Validation */}
                        <div className="flex items-center gap-2 flex-wrap">
                          {result.room_validation.match ? (
                            <Badge variant="outline" className="text-status-approved border-status-approved">
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              Room confirmed
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-status-rejected border-status-rejected">
                              <XCircle className="h-3 w-3 mr-1" />
                              Room mismatch
                            </Badge>
                          )}
                          <span className="text-xs text-muted-foreground">
                            FOV: {result.fov_deg}°
                          </span>
                        </div>

                        {/* Embedded Cameras Grid */}
                        <div className="grid grid-cols-1 gap-2">
                          {cameraA && <EmbeddedCameraCard camera={cameraA} slot="A" roomNameLookup={roomNameLookup} />}
                          {cameraB && <EmbeddedCameraCard camera={cameraB} slot="B" roomNameLookup={roomNameLookup} />}
                        </div>

                        {/* Global Rules */}
                        <div className="text-xs text-muted-foreground border-t border-border pt-2">
                          <p className="font-medium mb-1">Safety Rules</p>
                          <ul className="space-y-0.5">
                            <li className="flex items-center gap-1">
                              <CheckCircle2 className="h-3 w-3 text-status-approved" />
                              No new rooms allowed
                            </li>
                            <li className="flex items-center gap-1">
                              <CheckCircle2 className="h-3 w-3 text-status-approved" />
                              No new openings allowed
                            </li>
                            {result.global_rules.allowed_adjacent_rooms.length > 0 && (
                              <li>
                                Adjacent: {result.global_rules.allowed_adjacent_rooms.slice(0, 3).join(", ")}
                                {result.global_rules.allowed_adjacent_rooms.length > 3 && "..."}
                              </li>
                            )}
                          </ul>
                        </div>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                );
              })}
          </div>
        </div>

      {/* Full image dialog */}
      <Dialog open={!!fullImageUrl} onOpenChange={() => setFullImageUrl(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Crop: {fullImageLabel}</DialogTitle>
          </DialogHeader>
          {fullImageUrl && (
            <img
              src={fullImageUrl}
              alt={`Full crop for ${fullImageLabel}`}
              className="w-full rounded-lg"
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
