import { memo, useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
// ScrollArea removed - using native scroll with min-h-0 flex pattern
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
import { cn } from "@/lib/utils";
import {
  Circle,
  Plus,
  Trash2,
  Copy,
  RotateCcw,
  GripVertical,
  Check,
  ChevronUp,
  ChevronDown,
  Loader2,
  MousePointer2,
  FlipHorizontal,
  AlertCircle,
  Home,
  X,
  Scan,
  CheckCircle2,
  AlertTriangle,
  PanelLeftClose,
  PanelLeft,
  Clock,
} from "lucide-react";

// Panel size constants
const PANEL_MIN_WIDTH = 320;
const PANEL_DEFAULT_WIDTH = 420;
const PANEL_MAX_WIDTH = 620;
const PANEL_COLLAPSED_WIDTH = 48;
const PANEL_STORAGE_KEY = "cameraPlanningPanelWidth";
import { PanoramaPoint, useCameraMarkers } from "@/hooks/useCameraMarkers";
import { useCameraScan, CameraScanStatus } from "@/hooks/useCameraScan";
import { useCameraScanItems, CameraScanItem } from "@/hooks/useCameraScanItems";
import { useStorage } from "@/hooks/useStorage";
import { useCameraPlanningSpaces, CameraPlanningSpace } from "@/hooks/useCameraPlanningSpaces";
import { useCameraAnchor, CameraAnchorStatus } from "@/hooks/useCameraAnchor";
import { useResetCameraPointCrop } from "@/hooks/useResetCameraPointCrop";
import { CameraScanResultsPanel } from "./CameraScanResultsPanel";
import { CameraAnchorButton } from "./CameraAnchorButton";
import { CameraAnchorGate } from "./CameraAnchorGate";

// Legacy alias for compatibility
type CameraMarker = PanoramaPoint;

// =============================================================================
// CONSTANTS - Yaw and FOV snapping
// =============================================================================
const YAW_STEP = 5; // degrees
const FOV_STEP = 5; // degrees
const FOV_MIN = 60;
const FOV_MAX = 100;

/** Snap a value to the nearest step */
function snapToStep(value: number, step: number): number {
  return Math.round(value / step) * step;
}

// Re-export type for internal use (from the hook)
type PipelineSpace = CameraPlanningSpace;

interface CameraPlanningEditorProps {
  pipelineId: string;
  step2UploadId: string | null;
  onConfirm: () => void;
  onClose?: () => void;
  isConfirming: boolean;
  disabled?: boolean;
  scanStatus?: CameraScanStatus;
  /** Whether camera plan has been approved (still editable until committed) */
  isApproved?: boolean;
}

// Local state for optimistic updates during drag/edit
interface LocalMarkerState {
  x_norm?: number;
  y_norm?: number;
  yaw_deg?: number;
  fov_deg?: number;
}

// =============================================================================
// PanoramaPointOverlay - Shows circle with dual arrows (A and B cameras)
// MEMOIZED to prevent re-renders when other markers change
// =============================================================================
interface MarkerOverlayProps {
  marker: PanoramaPoint;
  localState?: LocalMarkerState;
  isSelected: boolean;
  onSelect: () => void;
  onDragEnd: (x: number, y: number) => void;
  onRotate: (yaw: number) => void;
  /**
   * IMPORTANT: This must reference the element that exactly matches the rendered plan image bounds.
   * Using a larger container (with padding/centering) will skew x_norm/y_norm.
   */
  containerRef: React.RefObject<HTMLDivElement>;
  /** Container dimensions from ResizeObserver - guaranteed valid before rendering */
  containerSize: { width: number; height: number };
}

const MarkerOverlay = memo(function MarkerOverlay({
  marker,
  localState,
  isSelected,
  onSelect,
  onDragEnd,
  onRotate,
  containerRef,
  containerSize,
}: MarkerOverlayProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isRotating, setIsRotating] = useState(false);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const [dragYaw, setDragYaw] = useState<number | null>(null);
  
  // Store offset from marker center to pointer at drag start
  const dragOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Use local state for rendering if available, otherwise use marker data
  const displayX = dragPos?.x ?? localState?.x_norm ?? marker.x_norm;
  const displayY = dragPos?.y ?? localState?.y_norm ?? marker.y_norm;
  const displayYaw = dragYaw ?? localState?.yaw_deg ?? marker.yaw_deg;
  const displayFov = localState?.fov_deg ?? marker.fov_deg;

  const handlePointerDown = (e: React.PointerEvent<SVGGElement>) => {
    e.stopPropagation();
    e.preventDefault();
    
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    // Capture pointer for reliable tracking
    (e.target as SVGGElement).setPointerCapture(e.pointerId);

    if (e.shiftKey) {
      // Rotation mode
      setIsRotating(true);
      setDragYaw(displayYaw);
    } else {
      // Drag mode - calculate offset from marker center to pointer
      const markerPixelX = displayX * rect.width;
      const markerPixelY = displayY * rect.height;
      const pointerX = e.clientX - rect.left;
      const pointerY = e.clientY - rect.top;
      
      dragOffsetRef.current = {
        x: pointerX - markerPixelX,
        y: pointerY - markerPixelY,
      };
      
      onSelect();
      setIsDragging(true);
      setDragPos({ x: displayX, y: displayY });
    }
  };

  const handlePointerMove = (e: React.PointerEvent<SVGGElement>) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    if (isDragging) {
      // Apply offset so marker center stays under cursor
      const pointerX = e.clientX - rect.left;
      const pointerY = e.clientY - rect.top;
      const newCenterX = pointerX - dragOffsetRef.current.x;
      const newCenterY = pointerY - dragOffsetRef.current.y;
      
      // Convert to normalized and clamp
      const x = Math.max(0, Math.min(1, newCenterX / rect.width));
      const y = Math.max(0, Math.min(1, newCenterY / rect.height));
      
      setDragPos({ x, y });
    } else if (isRotating) {
      const centerX = rect.left + displayX * rect.width;
      const centerY = rect.top + displayY * rect.height;
      const angle = Math.atan2(e.clientY - centerY, e.clientX - centerX);
      let yaw = (angle * 180) / Math.PI + 90; // Offset so 0° is up
      if (yaw < 0) yaw += 360;
      // Snap to step during rotation
      yaw = snapToStep(yaw % 360, YAW_STEP);
      setDragYaw(yaw);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<SVGGElement>) => {
    (e.target as SVGGElement).releasePointerCapture(e.pointerId);
    
    if (isDragging && dragPos) {
      onDragEnd(dragPos.x, dragPos.y);
    }
    if (isRotating && dragYaw !== null) {
      onRotate(dragYaw);
    }
    
    setIsDragging(false);
    setIsRotating(false);
    setDragPos(null);
    setDragYaw(null);
  };

    // Use containerSize from ResizeObserver - guaranteed valid when this component renders
    const pixelX = displayX * containerSize.width;
    const pixelY = displayY * containerSize.height;

  // Convert yaw to radians for arrow direction
  const yawRad = ((displayYaw - 90) * Math.PI) / 180;
  const arrowLength = 30;
  const fovRad = (displayFov * Math.PI) / 180;

  // FOV cone points
  const coneLength = 50;
  const leftAngle = yawRad - fovRad / 2;
  const rightAngle = yawRad + fovRad / 2;

  // Camera B (mirror) direction - exactly opposite
  const mirrorYawRad = yawRad + Math.PI; // +180 degrees

  return (
    <g
      transform={`translate(${pixelX}, ${pixelY})`}
      className={cn("cursor-grab", isDragging && "cursor-grabbing")}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{ touchAction: "none" }}
    >
      {/* FOV cone for Camera A */}
      <polygon
        points={`0,0 ${Math.cos(leftAngle) * coneLength},${Math.sin(leftAngle) * coneLength} ${Math.cos(rightAngle) * coneLength},${Math.sin(rightAngle) * coneLength}`}
        className={cn(
          "transition-opacity",
          isSelected ? "fill-primary/20 stroke-primary" : "fill-muted/15 stroke-muted-foreground/30"
        )}
        strokeWidth="1"
      />

      {/* FOV cone for Camera B (mirror) - lighter/dashed */}
      <polygon
        points={`0,0 ${Math.cos(mirrorYawRad - fovRad / 2) * (coneLength * 0.7)},${Math.sin(mirrorYawRad - fovRad / 2) * (coneLength * 0.7)} ${Math.cos(mirrorYawRad + fovRad / 2) * (coneLength * 0.7)},${Math.sin(mirrorYawRad + fovRad / 2) * (coneLength * 0.7)}`}
        className={cn(
          "transition-opacity",
          isSelected ? "fill-[hsl(var(--warning))]/10 stroke-[hsl(var(--warning))]/50" : "fill-muted/10 stroke-muted-foreground/20"
        )}
        strokeWidth="1"
        strokeDasharray="3,2"
      />

      {/* Camera A arrow (primary - solid) */}
      <line
        x1="0"
        y1="0"
        x2={Math.cos(yawRad) * arrowLength}
        y2={Math.sin(yawRad) * arrowLength}
        className={isSelected ? "stroke-primary" : "stroke-foreground"}
        strokeWidth="2.5"
        markerEnd="url(#arrowhead)"
      />

      {/* Camera B arrow (mirror - shorter, dashed) */}
      <line
        x1="0"
        y1="0"
        x2={Math.cos(mirrorYawRad) * (arrowLength * 0.6)}
        y2={Math.sin(mirrorYawRad) * (arrowLength * 0.6)}
        className={isSelected ? "stroke-[hsl(var(--warning))]" : "stroke-muted-foreground"}
        strokeWidth="1.5"
        strokeDasharray="4,2"
        markerEnd="url(#arrowhead-mirror)"
      />

      {/* A label at arrow tip */}
      <text
        x={Math.cos(yawRad) * (arrowLength + 8)}
        y={Math.sin(yawRad) * (arrowLength + 8)}
        className="text-[9px] font-bold pointer-events-none select-none fill-primary"
        textAnchor="middle"
        dominantBaseline="middle"
      >
        A
      </text>

      {/* B label at mirror arrow tip */}
      <text
        x={Math.cos(mirrorYawRad) * (arrowLength * 0.6 + 8)}
        y={Math.sin(mirrorYawRad) * (arrowLength * 0.6 + 8)}
        className="text-[9px] font-bold pointer-events-none select-none fill-[hsl(var(--warning))]"
        textAnchor="middle"
        dominantBaseline="middle"
      >
        B
      </text>

      {/* Center circle (panorama point indicator) */}
      <circle
        r="10"
        className={cn(
          "transition-colors",
          isSelected
            ? "fill-primary/80 stroke-primary-foreground"
            : "fill-foreground/80 stroke-background"
        )}
        strokeWidth="2"
      />

      {/* Inner dot for panorama feel */}
      <circle
        r="4"
        className={isSelected ? "fill-primary-foreground" : "fill-background"}
      />

      {/* Label */}
      <text
        x="14"
        y="-14"
        className={cn(
          "text-xs font-medium pointer-events-none select-none",
          isSelected ? "fill-primary" : "fill-foreground"
        )}
      >
        {marker.label}
      </text>
    </g>
  );
});

// =============================================================================
// PanoramaPointListPanel - Side panel for panorama point list and editing
// =============================================================================
// Extended marker type with anchor fields
interface MarkerWithAnchor extends PanoramaPoint {
  anchor_status?: CameraAnchorStatus;
  anchor_error_message?: string | null;
}


function getRoomName(spaces: PipelineSpace[], roomId: string | null): string | null {
  if (!roomId) return null;
  const space = spaces.find((s) => s.id === roomId);
  return space?.name || null;
}

interface MarkerListPanelProps extends React.PropsWithChildren {
  markers: MarkerWithAnchor[];
  spaces: PipelineSpace[];
  selectedId: string | null;
  localDraft: LocalMarkerState | null;
  onSelect: (id: string) => void;
  onUpdate: (id: string, updates: Partial<PanoramaPoint>) => void;
  /** Update local state: commit=false for live preview, commit=true for DB persist */
  onLocalUpdate: (updates: Partial<LocalMarkerState>, commit: boolean) => void;
  onDelete: (id: string) => void;
  onDeleteAll: () => void;
  isDeletingAll?: boolean;
  onDuplicate: (id: string) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  isAddMode: boolean;
  setAddMode: (v: boolean) => void;
  onCreateCustomSpace: (name: string) => void;
  isCreatingSpace?: boolean;
  // Anchor props
  onCreateAnchor: (markerId: string) => void;
  isCreatingAnchor: boolean;
  creatingAnchorId?: string | null;
  // Crop helpers from useCameraScanItems
  getCropUrlForMarker: (markerId: string) => string | null;
  getItemForMarker: (markerId: string) => CameraScanItem | undefined;
  // Reset crop props
  onResetCrop?: (markerId: string, markerLabel: string) => void;
  isResettingCrop?: boolean;
  resettingCropMarkerId?: string | null;
  // Panel resize props
  panelWidth: number;
  onPanelWidthChange: (width: number) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

function MarkerListPanel({
  markers,
  spaces,
  selectedId,
  localDraft,
  onSelect,
  onUpdate,
  onLocalUpdate,
  onDelete,
  onDeleteAll,
  isDeletingAll,
  onDuplicate,
  onMoveUp,
  onMoveDown,
  isAddMode,
  setAddMode,
  onCreateCustomSpace,
  isCreatingSpace,
  onCreateAnchor,
  isCreatingAnchor,
  creatingAnchorId,
  getCropUrlForMarker,
  getItemForMarker,
  onResetCrop,
  isResettingCrop,
  resettingCropMarkerId,
  panelWidth,
  onPanelWidthChange,
  isCollapsed,
  onToggleCollapse,
  children,
}: MarkerListPanelProps) {
  const selectedMarker = markers.find((m) => m.id === selectedId);
  const [newSpaceName, setNewSpaceName] = useState("");
  const scanSectionRef = useRef<HTMLDivElement>(null);
  const [isResizing, setIsResizing] = useState(false);

  // Display values: use local draft if available, otherwise marker values
  const displayYaw = localDraft?.yaw_deg ?? selectedMarker?.yaw_deg ?? 0;
  const displayFov = localDraft?.fov_deg ?? selectedMarker?.fov_deg ?? 80;

  // Filter to active spaces (rooms that will be generated)
  const activeSpaces = useMemo(() => 
    spaces.filter((s) => s.include_in_generation && !s.is_excluded),
    [spaces]
  );

  // Count unbound markers
  const unboundCount = useMemo(() => 
    markers.filter((m) => !m.room_id).length,
    [markers]
  );

  // Derive Camera B yaw for display
  const getCamBYaw = (yaw: number) => (yaw + 180) % 360;

  // Scroll to AI Scan section
  const scrollToScanSection = useCallback(() => {
    scanSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // Handle resize drag
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    
    const startX = e.clientX;
    const startWidth = panelWidth;
    
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = startX - moveEvent.clientX;
      const newWidth = Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, startWidth + deltaX));
      onPanelWidthChange(newWidth);
    };
    
    const handleMouseUp = () => {
      setIsResizing(false);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
    
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, [panelWidth, onPanelWidthChange]);

  // Collapsed state - show minimal rail
  if (isCollapsed) {
    return (
      <div className="flex flex-col h-full border-l border-border bg-card" style={{ width: PANEL_COLLAPSED_WIDTH }}>
        <div className="flex flex-col items-center py-3 gap-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={onToggleCollapse}
                >
                  <PanelLeft className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">Expand panel</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <Badge variant="secondary" className="text-xs rotate-90 whitespace-nowrap mt-4">
            {markers.length} pts
          </Badge>
        </div>
      </div>
    );
  }

  return (
    <div 
      className="flex flex-col h-full border-l border-border bg-card relative overflow-hidden"
      style={{ width: panelWidth }}
    >
      {/* Resize handle */}
      <div
        className={cn(
          "absolute left-0 top-0 bottom-0 w-1 cursor-col-resize z-10 hover:bg-primary/50 transition-colors",
          isResizing && "bg-primary"
        )}
        onMouseDown={handleResizeStart}
      />
      
      {/* Fixed Header */}
      <div className="shrink-0 p-3 border-b border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="text-sm font-medium truncate">Panorama Points</h3>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Badge variant="secondary" className="text-xs whitespace-nowrap">
              {markers.length} pts • {markers.length * 2} cams
            </Badge>
            {unboundCount > 0 && (
              <Badge variant="destructive" className="text-xs whitespace-nowrap">
                {unboundCount} unbound
              </Badge>
            )}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 ml-1"
                    onClick={onToggleCollapse}
                  >
                    <PanelLeftClose className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Collapse panel</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Each point = 2 cameras (A + B mirror)
        </p>
        
        {/* Compact status summary */}
        {markers.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {(() => {
              const readyAnchors = markers.filter(m => m.anchor_status === "ready").length;
              const cropsAvailable = markers.filter(m => getCropUrlForMarker(m.id)).length;
              const allAnchorsReady = readyAnchors === markers.length;
              const allCropsReady = cropsAvailable === markers.length;
              
              return (
                <>
                  <Badge 
                    variant={allAnchorsReady ? "default" : "outline"}
                    className={cn(
                      "text-xs gap-1",
                      allAnchorsReady ? "bg-status-approved text-status-approved-foreground" : "text-status-running border-status-running"
                    )}
                  >
                    {allAnchorsReady ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                    {readyAnchors}/{markers.length} anchors
                  </Badge>
                  <Badge 
                    variant="outline"
                    className={cn(
                      "text-xs gap-1",
                      allCropsReady ? "text-status-approved border-status-approved" : "text-muted-foreground"
                    )}
                  >
                    {cropsAvailable}/{markers.length} crops
                  </Badge>
                </>
              );
            })()}
          </div>
        )}
      </div>

      {/* Fixed Add Mode Toggle + Delete All */}
      <div className="shrink-0 p-2 border-b border-border flex gap-2">
        <Button
          size="sm"
          variant={isAddMode ? "default" : "outline"}
          className="flex-1"
          onClick={() => setAddMode(!isAddMode)}
        >
          {isAddMode ? (
            <>
              <MousePointer2 className="w-4 h-4 mr-2" />
              Click to Place
            </>
          ) : (
            <>
              <Plus className="w-4 h-4 mr-2" />
              Add Point
            </>
          )}
        </Button>
        
        {markers.length > 0 && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                disabled={isDeletingAll}
              >
                {isDeletingAll ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete All Panorama Points?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete all {markers.length} panorama points ({markers.length * 2} cameras). This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={onDeleteAll}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete All
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}

        {/* Quick jump to AI Scan */}
        {children && (
          <Button
            size="sm"
            variant="ghost"
            className="px-2"
            onClick={scrollToScanSection}
            title="Jump to AI Scan section"
          >
            <Scan className="w-4 h-4" />
          </Button>
        )}
      </div>

      {/* SINGLE SCROLL CONTAINER - contains marker list, editor, AND scan results */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
        {/* Panorama Point List */}
        <div className="p-2 space-y-1">
          {markers.map((marker, index) => (
            <div
              key={marker.id}
              className={cn(
                "p-2 rounded-md cursor-pointer transition-colors",
                selectedId === marker.id
                  ? "bg-primary/10 border border-primary/30"
                  : "hover:bg-muted/50 border border-transparent"
              )}
              onClick={() => onSelect(marker.id)}
            >
              <div className="flex items-center gap-2">
                <GripVertical className="w-3 h-3 text-muted-foreground" />
                {marker.room_id ? (
                  <div className="relative">
                    <Circle className="w-4 h-4 text-primary fill-primary/20" />
                  </div>
                ) : (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <AlertCircle className="w-4 h-4 text-destructive" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>No room assigned</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
                <span className="text-sm font-medium flex-1 truncate">
                  {marker.label}
                </span>
                <div className="flex items-center gap-0.5">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={(e) => {
                      e.stopPropagation();
                      onMoveUp(marker.id);
                    }}
                    disabled={index === 0}
                  >
                    <ChevronUp className="w-3 h-3" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={(e) => {
                      e.stopPropagation();
                      onMoveDown(marker.id);
                    }}
                    disabled={index === markers.length - 1}
                  >
                    <ChevronDown className="w-3 h-3" />
                  </Button>
                </div>
              </div>
              {/* Dual camera info */}
              <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="truncate flex-1">
                  {getRoomName(spaces, marker.room_id) || "No room"}
                </span>
              </div>
              <div className="mt-0.5 flex items-center justify-between text-[10px]">
                <div className="flex items-center gap-3">
                  <span className="text-primary font-medium">A: {Math.round(marker.yaw_deg)}°</span>
                  <span className="text-[hsl(var(--warning))] font-medium">B: {getCamBYaw(marker.yaw_deg)}°</span>
                </div>
                {/* Per-camera anchor button with crop thumbnail and reset */}
                <CameraAnchorButton
                  markerId={marker.id}
                  markerLabel={marker.label}
                  anchorStatus={marker.anchor_status}
                  anchorErrorMessage={marker.anchor_error_message}
                  onCreateAnchor={onCreateAnchor}
                  onResetCrop={onResetCrop ? (id) => onResetCrop(id, marker.label) : undefined}
                  isCreating={isCreatingAnchor && creatingAnchorId === marker.id}
                  isResetting={isResettingCrop && resettingCropMarkerId === marker.id}
                  variant="compact"
                  disabled={!marker.room_id}
                  cropThumbnailUrl={getCropUrlForMarker(marker.id)}
                  hasScanCrop={!!getItemForMarker(marker.id)?.crop_public_url}
                />
              </div>
            </div>
          ))}

          {markers.length === 0 && (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No panorama points yet.
              <br />
              Click "Add Panorama Point" then click on the image.
            </div>
          )}
        </div>

        {/* Selected Marker Editor - inside scroll container */}
        {selectedMarker && (
          <div className="border-t border-border p-3 space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Label</Label>
              <Input
                value={selectedMarker.label}
                onChange={(e) => onUpdate(selectedMarker.id, { label: e.target.value })}
                className="h-8 text-sm"
              />
            </div>

            {/* Room Binding Dropdown */}
            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1">
                Room
                {!selectedMarker.room_id && (
                  <span className="text-destructive">*</span>
                )}
              </Label>
              <Select
                value={selectedMarker.room_id || ""}
                onValueChange={(value) => {
                  if (value) {
                    const room = activeSpaces.find((s) => s.id === value);
                    if (room) {
                      // Use exact room name as label; add suffix only if duplicate
                      const existingWithSameName = markers.filter((m) => 
                        m.room_id === value && m.id !== selectedMarker.id
                      ).length;
                      const newLabel = existingWithSameName > 0
                        ? `${room.name}_${String(existingWithSameName + 1).padStart(2, "0")}`
                        : room.name;
                      onUpdate(selectedMarker.id, { room_id: value, label: newLabel });
                    }
                  } else {
                    onUpdate(selectedMarker.id, { room_id: null });
                  }
                }}
              >
                <SelectTrigger className={cn(
                  "h-8 text-sm",
                  !selectedMarker.room_id && "border-destructive"
                )}>
                  <SelectValue placeholder="Select room..." />
                </SelectTrigger>
                <SelectContent className="z-[100] bg-popover">
                  {activeSpaces.map((space) => (
                    <SelectItem key={space.id} value={space.id}>
                      <div className="flex items-center gap-2">
                        <Home className="w-3 h-3" />
                        <span>{space.name}</span>
                        {space.is_custom && (
                          <Badge variant="secondary" className="text-xs ml-1">custom</Badge>
                        )}
                        <Badge variant="outline" className="text-xs ml-auto">
                          {space.space_type}
                        </Badge>
                      </div>
                    </SelectItem>
                  ))}
                  {activeSpaces.length === 0 && (
                    <div className="p-2 text-sm text-muted-foreground text-center">
                      No rooms detected yet
                    </div>
                  )}
                </SelectContent>
              </Select>
              
              {/* Add Custom Space inline */}
              <div className="flex gap-1 mt-2">
                <Input
                  value={newSpaceName}
                  onChange={(e) => setNewSpaceName(e.target.value)}
                  placeholder="Add custom space..."
                  className="h-7 text-xs flex-1"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newSpaceName.trim()) {
                      onCreateCustomSpace(newSpaceName.trim());
                      setNewSpaceName("");
                    }
                  }}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2"
                  disabled={!newSpaceName.trim() || isCreatingSpace}
                  onClick={() => {
                    if (newSpaceName.trim()) {
                      onCreateCustomSpace(newSpaceName.trim());
                      setNewSpaceName("");
                    }
                  }}
                >
                  {isCreatingSpace ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Plus className="w-3 h-3" />
                  )}
                </Button>
              </div>
            </div>

            {/* Yaw slider with 5° steps - Camera A direction */}
            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-2">
                <span className="text-primary font-medium">A</span> Yaw: {snapToStep(displayYaw, YAW_STEP)}°
                <span className="text-muted-foreground">→</span>
                <span className="text-[hsl(var(--warning))] font-medium">B</span>: {(snapToStep(displayYaw, YAW_STEP) + 180) % 360}°
              </Label>
              <Slider
                value={[snapToStep(displayYaw, YAW_STEP)]}
                min={0}
                max={355}
                step={YAW_STEP}
                onValueChange={([v]) => onLocalUpdate({ yaw_deg: v }, false)}
                onValueCommit={([v]) => onLocalUpdate({ yaw_deg: v }, true)}
              />
            </div>

            {/* FOV slider with 5° steps - applies to both cameras */}
            <div className="space-y-1.5">
              <Label className="text-xs">FOV (both cameras): {snapToStep(displayFov, FOV_STEP)}°</Label>
              <Slider
                value={[snapToStep(displayFov, FOV_STEP)]}
                min={FOV_MIN}
                max={FOV_MAX}
                step={FOV_STEP}
                onValueChange={([v]) => onLocalUpdate({ fov_deg: v }, false)}
                onValueCommit={([v]) => onLocalUpdate({ fov_deg: v }, true)}
              />
            </div>

            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="flex-1"
                onClick={() => onDuplicate(selectedMarker.id)}
              >
                <Copy className="w-3 h-3 mr-1" />
                Duplicate
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const newYaw = snapToStep((displayYaw + 180) % 360, YAW_STEP);
                  onLocalUpdate({ yaw_deg: newYaw }, true);
                }}
                title="Flip camera direction 180°"
              >
                <FlipHorizontal className="w-3 h-3" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onLocalUpdate({ yaw_deg: 0 }, true)}
                title="Reset yaw to 0°"
              >
                <RotateCcw className="w-3 h-3" />
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => onDelete(selectedMarker.id)}
              >
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
          </div>
        )}

        {/* AI Scan Results - inside scroll container via children */}
        {children && (
          <div ref={scanSectionRef} className="border-t border-border p-2">
            {children}
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Main CameraPlanningEditor - Now renders as a focused modal overlay
// =============================================================================
export const CameraPlanningEditor = memo(function CameraPlanningEditor({
  pipelineId,
  step2UploadId,
  onConfirm,
  onClose,
  isConfirming,
  disabled,
  isApproved = false,
}: CameraPlanningEditorProps) {
  const { getSignedViewUrl } = useStorage();
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);
  const [isAddMode, setAddMode] = useState(false);
  const [showScanResults, setShowScanResults] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const [debugOverlay, setDebugOverlay] = useState(false);
  // Layout readiness state - prevents markers from rendering at (0,0)
  const [isImageLoaded, setIsImageLoaded] = useState(false);
  const [containerSize, setContainerSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  // Layout is ready only when both image is loaded AND container has valid dimensions
  const isLayoutReady = isImageLoaded && containerSize.width > 0 && containerSize.height > 0;
  
  // Outer container (full editor area)
  const containerRef = useRef<HTMLDivElement>(null);
  // The element that matches the *actual* rendered image bounds (single source of truth for x_norm/y_norm)
  const imageBoundsRef = useRef<HTMLDivElement>(null);

  // Panel resize state - load from localStorage
  const [panelWidth, setPanelWidth] = useState(() => {
    const saved = localStorage.getItem(PANEL_STORAGE_KEY);
    return saved ? parseInt(saved, 10) : PANEL_DEFAULT_WIDTH;
  });
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Persist panel width
  const handlePanelWidthChange = useCallback((width: number) => {
    setPanelWidth(width);
    localStorage.setItem(PANEL_STORAGE_KEY, String(width));
  }, []);

  const handleToggleCollapse = useCallback(() => {
    setIsCollapsed(prev => !prev);
  }, []);

  // Local state for optimistic updates during drag and slider changes
  const [localStates, setLocalStates] = useState<Record<string, LocalMarkerState>>({});
  const [localDraft, setLocalDraft] = useState<LocalMarkerState | null>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  const {
    markers,
    isLoading,
    createMarker,
    updateMarker,
    deleteMarker,
    duplicateMarker,
    reorderMarkers,
    generateLabel,
  } = useCameraMarkers(pipelineId);

  // Camera scan hook
  const {
    scanStatus,
    scanResults,
    runScan,
    invalidateScan,
    isScanning,
    canContinueToStep3,
  } = useCameraScan(pipelineId);

  // Fetch scan items (crops + labels) for the latest scan
  const {
    items: scanItems,
    isLoading: scanItemsLoading,
    getItemForMarker,
    getCropUrlForMarker,
    hasCrops,
    totalCrops,
    totalLabels,
  } = useCameraScanItems(pipelineId);

  // Fetch spaces from floorplan_pipeline_spaces (Step 3) - SINGLE SOURCE OF TRUTH
  // This ensures Camera Planning shows the EXACT same spaces as the "Spaces" panel
  const {
    activeSpaces: spaces,
    roomNameLookup,
    isLoading: spacesLoading,
    createCustomSpace,
  } = useCameraPlanningSpaces(pipelineId);

  // Camera anchor hook for per-camera anchor generation
  const {
    createAnchor,
    createAllAnchors,
    allAnchorsReady,
    getMarkersNeedingAnchors,
    getAnchorStatusSummary,
    isCreatingAnchor,
    isCreatingAllAnchors,
  } = useCameraAnchor(pipelineId);

  // Reset crop hook
  const { resetCrop, isResetting: isResettingCrop } = useResetCameraPointCrop(pipelineId);

  // Track which marker is currently having its anchor created
  const [creatingAnchorMarkerId, setCreatingAnchorMarkerId] = useState<string | null>(null);
  // Track which marker is currently having its crop reset
  const [resettingCropMarkerId, setResettingCropMarkerId] = useState<string | null>(null);

  // Handle anchor creation for a single marker
  const handleCreateAnchor = useCallback((markerId: string) => {
    setCreatingAnchorMarkerId(markerId);
    createAnchor.mutate({ markerId, debugOverlay }, {
      onSettled: () => setCreatingAnchorMarkerId(null),
    });
  }, [createAnchor, debugOverlay]);

  // Handle batch anchor creation for all markers needing anchors
  const handleCreateAllAnchors = useCallback(() => {
    const needingAnchors = getMarkersNeedingAnchors(markers as any);
    if (needingAnchors.length > 0) {
      createAllAnchors.mutate({
        markerIds: needingAnchors.map(m => m.id),
        debugOverlay,
      });
    }
  }, [markers, getMarkersNeedingAnchors, createAllAnchors, debugOverlay]);

  // Handle resetting a crop for a specific marker
  const handleResetCrop = useCallback((markerId: string, markerLabel: string) => {
    setResettingCropMarkerId(markerId);
    resetCrop.mutate({ markerId }, {
      onSettled: () => setResettingCropMarkerId(null),
    });
  }, [resetCrop]);

  // Validation: all markers must have room_id
  const unboundMarkerCount = useMemo(
    () => markers.filter((m) => !m.room_id).length,
    [markers]
  );
  const allMarkersBound = markers.length > 0 && unboundMarkerCount === 0;

  // Invalidate scan when markers are modified
  const markersHash = useMemo(() => {
    return markers.map(m => `${m.id}:${m.x_norm}:${m.y_norm}:${m.yaw_deg}:${m.fov_deg}:${m.room_id}`).join("|");
  }, [markers]);

  // Initialization guard: prevents scan invalidation during initial hydration
  const isInitializingRef = useRef(true);
  const initTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Transition out of initializing state after markers stabilize (500ms)
  useEffect(() => {
    if (initTimeoutRef.current) {
      clearTimeout(initTimeoutRef.current);
    }
    
    // Wait for markers to stabilize before allowing invalidation
    initTimeoutRef.current = setTimeout(() => {
      isInitializingRef.current = false;
    }, 500);
    
    return () => {
      if (initTimeoutRef.current) {
        clearTimeout(initTimeoutRef.current);
      }
    };
  }, [markersHash]);

  const prevMarkersHashRef = useRef<string | null>(null);
  useEffect(() => {
    // Skip during initialization (prevents false-positive changes on re-edit)
    if (isInitializingRef.current) {
      prevMarkersHashRef.current = markersHash;
      return;
    }
    
    // Skip first render after initialization
    if (prevMarkersHashRef.current === null) {
      prevMarkersHashRef.current = markersHash;
      return;
    }
    
    // Only invalidate if markers ACTUALLY changed (after user edit)
    if (prevMarkersHashRef.current !== markersHash && scanStatus === "completed") {
      invalidateScan.mutate();
    }
    prevMarkersHashRef.current = markersHash;
  }, [markersHash, scanStatus, invalidateScan]);

  // Load the Step 2 image
  useEffect(() => {
    if (!step2UploadId) return;

    getSignedViewUrl("outputs", step2UploadId).then((result) => {
      if (result.signedUrl) {
        setImageUrl(result.signedUrl);
      }
    });
  }, [step2UploadId, getSignedViewUrl]);

  // Lock body scroll when this modal is open (before any early returns)
  useEffect(() => {
    if (!step2UploadId) return; // Only lock scroll when editor is actually shown
    
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [step2UploadId]);

  // ResizeObserver to track actual image container dimensions
  // This is the ONLY source of truth for container size - never assume on mount
  useEffect(() => {
    const el = imageBoundsRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        // Only update if we have valid dimensions
        if (width > 0 && height > 0) {
          setContainerSize({ width, height });
        }
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, [imageUrl]); // Re-attach when image URL changes

  // Reset layout state when image URL changes (new image being loaded)
  useEffect(() => {
    if (imageUrl) {
      setIsImageLoaded(false);
      setContainerSize({ width: 0, height: 0 });
    }
  }, [imageUrl]);

  // Sync local draft when selection changes
  useEffect(() => {
    if (selectedMarkerId) {
      const marker = markers.find((m) => m.id === selectedMarkerId);
      if (marker) {
        setLocalDraft({
          yaw_deg: snapToStep(marker.yaw_deg, YAW_STEP),
          fov_deg: snapToStep(marker.fov_deg, FOV_STEP),
        });
      }
    } else {
      setLocalDraft(null);
    }
  }, [selectedMarkerId, markers]);

  // Immediate DB commit (no debounce)
  const commitToDb = useCallback(
    (id: string, updates: Partial<CameraMarker>) => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      updateMarker.mutate({ id, ...updates });
    },
    [updateMarker]
  );

  /**
   * Handle local draft changes (for sliders) - with snapping
   * @param updates - The updates to apply
   * @param commit - If true, persist to DB immediately. If false, only update local state.
   */
  const handleLocalDraftUpdate = useCallback(
    (updates: Partial<LocalMarkerState>, commit: boolean) => {
      if (!selectedMarkerId) return;

      // Snap values to steps
      const snappedUpdates: Partial<LocalMarkerState> = {};
      if (updates.yaw_deg !== undefined) {
        snappedUpdates.yaw_deg = snapToStep(updates.yaw_deg, YAW_STEP);
      }
      if (updates.fov_deg !== undefined) {
        snappedUpdates.fov_deg = snapToStep(updates.fov_deg, FOV_STEP);
      }

      // Update local draft immediately for instant visual feedback
      setLocalDraft((prev) => ({ ...prev, ...snappedUpdates }));

      // Also update local states for the overlay (ensures marker updates live)
      setLocalStates((prev) => ({
        ...prev,
        [selectedMarkerId]: { ...prev[selectedMarkerId], ...snappedUpdates },
      }));

      // Only commit to database when requested (on slider release / button click)
      if (commit) {
        commitToDb(selectedMarkerId, snappedUpdates);
      }
    },
    [selectedMarkerId, commitToDb]
  );

  // Handle click to add marker - FIXED: get fresh rect on click
  const handleImageClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!isAddMode) return;

      // IMPORTANT: use the image bounds, not the full container (which includes padding/centering)
      const rect = imageBoundsRef.current?.getBoundingClientRect();
      if (!rect) return;

      // Use clientX/clientY relative to rect - NO offsetX/offsetY
      const x_norm = (e.clientX - rect.left) / rect.width;
      const y_norm = (e.clientY - rect.top) / rect.height;

      // Clamp strictly to 0-1
      const clampedX = Math.max(0, Math.min(1, x_norm));
      const clampedY = Math.max(0, Math.min(1, y_norm));

      createMarker.mutate({
        x_norm: clampedX,
        y_norm: clampedY,
        yaw_deg: 0, // Start at 0° (snapped)
        fov_deg: 80, // Default FOV (snapped to 5°)
        label: generateLabel(),
      });

      setAddMode(false);
    },
    [isAddMode, createMarker, generateLabel]
  );

  // Handle marker drag end (commit to database)
  const handleDragEnd = useCallback(
    (id: string, x: number, y: number) => {
      updateMarker.mutate({ id, x_norm: x, y_norm: y });
      setLocalStates((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    },
    [updateMarker]
  );

  // Handle marker rotation (commit with snapping)
  const handleMarkerRotate = useCallback(
    (id: string, yaw: number) => {
      const snappedYaw = snapToStep(yaw, YAW_STEP);
      updateMarker.mutate({ id, yaw_deg: snappedYaw });
      
      if (id === selectedMarkerId) {
        setLocalDraft((prev) => ({ ...prev, yaw_deg: snappedYaw }));
      }
      setLocalStates((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    },
    [updateMarker, selectedMarkerId]
  );

  // Handle reorder
  const handleMoveUp = useCallback(
    (id: string) => {
      const index = markers.findIndex((m) => m.id === id);
      if (index <= 0) return;

      const newOrder = [...markers];
      [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];
      reorderMarkers.mutate(newOrder.map((m) => m.id));
    },
    [markers, reorderMarkers]
  );

  const handleMoveDown = useCallback(
    (id: string) => {
      const index = markers.findIndex((m) => m.id === id);
      if (index < 0 || index >= markers.length - 1) return;

      const newOrder = [...markers];
      [newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]];
      reorderMarkers.mutate(newOrder.map((m) => m.id));
    },
    [markers, reorderMarkers]
  );

  // Handle marker selection
  const handleSelectMarker = useCallback((id: string) => {
    setSelectedMarkerId(id);
  }, []);

  // Handle marker update (direct, for label changes)
  const handleMarkerUpdate = useCallback(
    (id: string, updates: Partial<CameraMarker>) => {
      updateMarker.mutate({ id, ...updates });
    },
    [updateMarker]
  );

  if (!step2UploadId) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <p>Complete Step 2 first to access Camera Planning</p>
      </div>
    );
  }


  return (
    <div 
      className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm flex flex-col overflow-hidden"
      style={{ pointerEvents: "auto" }}
    >
      {/* Modal Header */}
      <div className="flex items-center justify-between p-4 border-b border-border bg-card">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Circle className="w-5 h-5 text-primary fill-primary/20" />
            Panorama Point Planning
          </h2>
          <p className="text-sm text-muted-foreground">
            Each point = 2 cameras (A + B mirror). Place, scan, then confirm.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Debug toggle (temporary): draws a crosshair at the exact computed point in generated crops */}
          <div className="flex items-center gap-2 mr-2">
            <span className="text-xs text-muted-foreground">Debug crosshair</span>
            <Switch checked={debugOverlay} onCheckedChange={setDebugOverlay} />
          </div>
          {/* Draft / Approved status badge */}
          {isApproved ? (
            <Badge variant="outline" className="text-xs border-green-500 text-green-600">
              <Check className="w-3 h-3 mr-1" />
              Approved — Editable
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs border-amber-500 text-amber-600">
              <Clock className="w-3 h-3 mr-1" />
              Draft — Persisted
            </Badge>
          )}
          
          {/* Point count badge */}
          <Badge 
            variant={markers.length > 0 && allMarkersBound ? "default" : "secondary"} 
            className="text-xs"
          >
            {isLoading ? "..." : `${markers.length} pts • ${markers.length * 2} cams`}
          </Badge>
          
          {/* Unbound warning */}
          {unboundMarkerCount > 0 && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="destructive" className="text-xs">
                    <AlertCircle className="w-3 h-3 mr-1" />
                    {unboundMarkerCount} unbound
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Assign a room to each marker before scanning</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {/* Scan status badge */}
          {scanStatus === "completed" && (
            <Badge variant="outline" className="text-xs border-primary text-primary">
              <CheckCircle2 className="w-3 h-3 mr-1" />
              Scanned
            </Badge>
          )}
          {scanStatus === "needs_scan" && markers.length > 0 && allMarkersBound && (
            <Badge variant="outline" className="text-xs border-muted-foreground">
              <AlertTriangle className="w-3 h-3 mr-1" />
              Needs Scan
            </Badge>
          )}
          {scanStatus === "running" && (
            <Badge variant="secondary" className="text-xs">
              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              Scanning...
            </Badge>
          )}
          
          {/* Cancel button */}
          {onClose && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              disabled={isScanning}
            >
              <X className="w-4 h-4 mr-1" />
              Cancel
            </Button>
          )}

          {/* AI Scan Button */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={scanStatus === "completed" ? "outline" : "secondary"}
                  size="sm"
                  onClick={() => runScan.mutate()}
                  disabled={
                    isScanning || 
                    isLoading || 
                    markers.length === 0 || 
                    !allMarkersBound
                  }
                >
                  {isScanning ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Scan className="w-4 h-4 mr-2" />
                  )}
                  {isScanning ? "Scanning..." : scanStatus === "completed" ? "Re-scan" : "Scan Panorama Points (AI)"}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {markers.length === 0 
                  ? "Add at least one panorama point first"
                  : !allMarkersBound
                  ? "Assign a room to all points before scanning"
                  : isScanning
                  ? "AI is analyzing camera positions..."
                  : scanStatus === "completed"
                  ? "Run AI analysis again"
                  : "Analyze camera positions with AI"
                }
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {/* Confirm button */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={onConfirm}
                  disabled={
                    disabled || 
                    isConfirming || 
                    isLoading || 
                    isScanning ||
                    markers.length === 0 || 
                    !allMarkersBound ||
                    !canContinueToStep3
                  }
                >
                  {isConfirming ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4 mr-2" />
                  )}
                  {isConfirming ? "Confirming..." : "Confirm Camera Plan"}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {isLoading
                  ? "Loading..."
                  : markers.length === 0
                  ? "Add at least one panorama point"
                  : !allMarkersBound
                  ? `Assign a room to ${unboundMarkerCount} unbound point(s)`
                  : !canContinueToStep3
                  ? "Run AI scan before confirming"
                  : isScanning
                  ? "Wait for scan to complete"
                  : "Confirm and proceed to renders"
                }
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {/* Main Content - prevent scroll chaining */}
      <div className="flex flex-1 overflow-hidden overscroll-contain">
        {/* Image Editor Area */}
        <div className="flex-1 relative overflow-hidden bg-muted/30">
          <div
            ref={containerRef}
            className={cn(
              "w-full h-full flex items-center justify-center p-4",
              isAddMode && "cursor-crosshair"
            )}
          >
            {!imageUrl ? (
              <div className="flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div
                ref={imageBoundsRef}
                className={cn("relative max-w-full max-h-full", isAddMode && "cursor-crosshair")}
                onClick={handleImageClick}
              >
                <img
                  src={imageUrl}
                  alt="Floor plan for camera planning"
                  className="max-w-full max-h-[calc(100vh-140px)] object-contain rounded-lg shadow-lg"
                  draggable={false}
                  onLoad={() => setIsImageLoaded(true)}
                />

                {/* SVG overlay for panorama points - ONLY render when layout is ready */}
                {isLayoutReady && (
                  <svg
                    className="absolute inset-0 w-full h-full pointer-events-none"
                    style={{ overflow: "visible" }}
                  >
                    <defs>
                      <marker
                        id="arrowhead"
                        markerWidth="10"
                        markerHeight="7"
                        refX="9"
                        refY="3.5"
                        orient="auto"
                      >
                        <polygon
                          points="0 0, 10 3.5, 0 7"
                          className="fill-current"
                        />
                      </marker>
                      <marker
                        id="arrowhead-mirror"
                        markerWidth="8"
                        markerHeight="5"
                        refX="7"
                        refY="2.5"
                        orient="auto"
                      >
                        <polygon
                          points="0 0, 8 2.5, 0 5"
                          className="fill-[hsl(var(--warning))]"
                        />
                      </marker>
                    </defs>

                    <g className="pointer-events-auto">
                      {markers.map((marker) => (
                        <MarkerOverlay
                          key={marker.id}
                          marker={marker}
                          localState={localStates[marker.id]}
                          isSelected={selectedMarkerId === marker.id}
                          onSelect={() => handleSelectMarker(marker.id)}
                          onDragEnd={(x, y) => handleDragEnd(marker.id, x, y)}
                          onRotate={(yaw) => handleMarkerRotate(marker.id, yaw)}
                          containerRef={imageBoundsRef}
                          containerSize={containerSize}
                        />
                      ))}
                    </g>
                  </svg>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Side Panel - MarkerListPanel with resize support */}
        <div className="flex flex-col min-h-0 shrink-0">
          <MarkerListPanel
            markers={markers}
            spaces={spaces}
            selectedId={selectedMarkerId}
            localDraft={localDraft}
            onSelect={handleSelectMarker}
            onUpdate={handleMarkerUpdate}
            onLocalUpdate={handleLocalDraftUpdate}
            onDelete={(id) => {
              deleteMarker.mutate(id);
              if (selectedMarkerId === id) setSelectedMarkerId(null);
            }}
            onDeleteAll={async () => {
              setIsDeletingAll(true);
              try {
                // Delete all markers sequentially
                for (const marker of markers) {
                  await deleteMarker.mutateAsync(marker.id);
                }
                setSelectedMarkerId(null);
              } finally {
                setIsDeletingAll(false);
              }
            }}
            isDeletingAll={isDeletingAll}
            onDuplicate={(id) => duplicateMarker.mutate(id)}
            onMoveUp={handleMoveUp}
            onMoveDown={handleMoveDown}
            isAddMode={isAddMode}
            setAddMode={setAddMode}
            onCreateCustomSpace={(name) => createCustomSpace.mutate({ name })}
            isCreatingSpace={createCustomSpace.isPending}
            onCreateAnchor={handleCreateAnchor}
            isCreatingAnchor={isCreatingAnchor}
            creatingAnchorId={creatingAnchorMarkerId}
            getCropUrlForMarker={getCropUrlForMarker}
            getItemForMarker={getItemForMarker}
            onResetCrop={handleResetCrop}
            isResettingCrop={isResettingCrop}
            resettingCropMarkerId={resettingCropMarkerId}
            panelWidth={panelWidth}
            onPanelWidthChange={handlePanelWidthChange}
            isCollapsed={isCollapsed}
            onToggleCollapse={handleToggleCollapse}
          >
            {/* AI Scan Results Panel - rendered as children inside scroll */}
            {(scanResults.length > 0 || scanItems.length > 0) && (
              <CameraScanResultsPanel
                results={scanResults}
                scanItems={scanItems}
                isScanning={isScanning}
                isLoadingItems={scanItemsLoading}
                onRescan={() => runScan.mutate()}
                roomNameLookup={roomNameLookup}
                getItemForMarker={getItemForMarker}
                getCropUrlForMarker={getCropUrlForMarker}
                pipelineId={pipelineId}
                onResetCrop={handleResetCrop}
                isResettingCrop={isResettingCrop}
                markers={markers}
              />
            )}
          </MarkerListPanel>
        </div>
      </div>
    </div>
  );
});

export default CameraPlanningEditor;
