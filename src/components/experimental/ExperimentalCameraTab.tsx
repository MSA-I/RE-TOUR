import { useState, useCallback, useRef, useMemo, memo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  FlaskConical,
  Plus,
  Trash2,
  RotateCcw,
  Camera,
  AlertTriangle,
  Play,
  ChevronUp,
  ChevronDown,
  GripVertical,
  Info,
} from "lucide-react";

// =============================================================================
// Types - All local, experimental data model
// =============================================================================
interface ExperimentalCamera {
  id: string;
  x_norm: number;
  y_norm: number;
  yaw_deg: number;
  fov_deg: number;
  room: "central_space";
}

interface CentralSpaceInfo {
  name: string;
  approximate_center: { x: number; y: number };
  approximate_bounds: { x: number; y: number; width: number; height: number };
}

// =============================================================================
// Constants
// =============================================================================
const DEFAULT_FOV = 80;
const YAW_STEP = 15;
const FOV_MIN = 60;
const FOV_MAX = 100;

function generateId(): string {
  return `cam_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function snapToStep(value: number, step: number): number {
  return Math.round(value / step) * step;
}

// =============================================================================
// CameraMarkerOverlay - SVG overlay for camera placement
// =============================================================================
interface CameraMarkerOverlayProps {
  camera: ExperimentalCamera;
  isSelected: boolean;
  onSelect: () => void;
  onDragEnd: (x: number, y: number) => void;
  onRotate: (yaw: number) => void;
  containerRef: React.RefObject<HTMLDivElement>;
}

const CameraMarkerOverlay = memo(function CameraMarkerOverlay({
  camera,
  isSelected,
  onSelect,
  onDragEnd,
  onRotate,
  containerRef,
}: CameraMarkerOverlayProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isRotating, setIsRotating] = useState(false);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const [dragYaw, setDragYaw] = useState<number | null>(null);
  const dragOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const displayX = dragPos?.x ?? camera.x_norm;
  const displayY = dragPos?.y ?? camera.y_norm;
  const displayYaw = dragYaw ?? camera.yaw_deg;

  const handlePointerDown = (e: React.PointerEvent<SVGGElement>) => {
    e.stopPropagation();
    e.preventDefault();
    
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    (e.target as SVGGElement).setPointerCapture(e.pointerId);

    if (e.shiftKey) {
      setIsRotating(true);
      setDragYaw(displayYaw);
    } else {
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
      const pointerX = e.clientX - rect.left;
      const pointerY = e.clientY - rect.top;
      const newCenterX = pointerX - dragOffsetRef.current.x;
      const newCenterY = pointerY - dragOffsetRef.current.y;
      
      const x = Math.max(0, Math.min(1, newCenterX / rect.width));
      const y = Math.max(0, Math.min(1, newCenterY / rect.height));
      
      setDragPos({ x, y });
    } else if (isRotating) {
      const centerX = rect.left + displayX * rect.width;
      const centerY = rect.top + displayY * rect.height;
      const angle = Math.atan2(e.clientY - centerY, e.clientX - centerX);
      let yaw = (angle * 180) / Math.PI + 90;
      if (yaw < 0) yaw += 360;
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

  const rect = containerRef.current?.getBoundingClientRect();
  const pixelX = rect ? displayX * rect.width : 0;
  const pixelY = rect ? displayY * rect.height : 0;

  const yawRad = ((displayYaw - 90) * Math.PI) / 180;
  const arrowLength = 28;
  const fovRad = (camera.fov_deg * Math.PI) / 180;
  const coneLength = 45;
  const leftAngle = yawRad - fovRad / 2;
  const rightAngle = yawRad + fovRad / 2;

  return (
    <g
      transform={`translate(${pixelX}, ${pixelY})`}
      className={cn("cursor-grab", isDragging && "cursor-grabbing")}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{ touchAction: "none" }}
    >
      {/* FOV cone */}
      <polygon
        points={`0,0 ${Math.cos(leftAngle) * coneLength},${Math.sin(leftAngle) * coneLength} ${Math.cos(rightAngle) * coneLength},${Math.sin(rightAngle) * coneLength}`}
        className={cn(
          "transition-opacity",
          isSelected ? "fill-primary/25 stroke-primary" : "fill-muted/20 stroke-muted-foreground/40"
        )}
        strokeWidth="1.5"
      />

      {/* Direction arrow */}
      <line
        x1="0"
        y1="0"
        x2={Math.cos(yawRad) * arrowLength}
        y2={Math.sin(yawRad) * arrowLength}
        className={isSelected ? "stroke-primary" : "stroke-foreground"}
        strokeWidth="2.5"
        markerEnd="url(#exp-arrowhead)"
      />

      {/* Center circle */}
      <circle
        r="9"
        className={cn(
          "transition-colors",
          isSelected
            ? "fill-primary stroke-primary-foreground"
            : "fill-foreground/80 stroke-background"
        )}
        strokeWidth="2"
      />

      {/* Camera icon (inner) */}
      <circle
        r="3.5"
        className={isSelected ? "fill-primary-foreground" : "fill-background"}
      />

      {/* Label */}
      <text
        x="14"
        y="-14"
        className={cn(
          "text-[10px] font-semibold pointer-events-none select-none",
          isSelected ? "fill-primary" : "fill-foreground"
        )}
      >
        {camera.id.slice(-4).toUpperCase()}
      </text>
    </g>
  );
});

// =============================================================================
// CameraListItem - Individual camera in the sidebar
// =============================================================================
interface CameraListItemProps {
  camera: ExperimentalCamera;
  index: number;
  isSelected: boolean;
  onSelect: () => void;
  onUpdate: (updates: Partial<ExperimentalCamera>) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  isFirst: boolean;
  isLast: boolean;
}

function CameraListItem({
  camera,
  index,
  isSelected,
  onSelect,
  onUpdate,
  onDelete,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
}: CameraListItemProps) {
  return (
    <div
      className={cn(
        "border rounded-lg p-3 transition-all cursor-pointer",
        isSelected
          ? "border-primary bg-primary/5 ring-1 ring-primary/20"
          : "border-border hover:border-primary/40 hover:bg-muted/30"
      )}
      onClick={onSelect}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <GripVertical className="h-4 w-4 text-muted-foreground" />
          <Badge variant={isSelected ? "default" : "secondary"} className="font-mono text-xs">
            #{index + 1}
          </Badge>
          <span className="text-xs text-muted-foreground font-mono">
            {camera.id.slice(-6)}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={(e) => { e.stopPropagation(); onMoveUp(); }}
            disabled={isFirst}
          >
            <ChevronUp className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={(e) => { e.stopPropagation(); onMoveDown(); }}
            disabled={isLast}
          >
            <ChevronDown className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-destructive hover:text-destructive"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {isSelected && (
        <div className="space-y-3 pt-2 border-t border-border/50">
          {/* Position display */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-muted-foreground">X:</span>{" "}
              <span className="font-mono">{(camera.x_norm * 100).toFixed(1)}%</span>
            </div>
            <div>
              <span className="text-muted-foreground">Y:</span>{" "}
              <span className="font-mono">{(camera.y_norm * 100).toFixed(1)}%</span>
            </div>
          </div>

          {/* Yaw control */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Direction (Yaw)</Label>
              <span className="text-xs font-mono text-muted-foreground">{camera.yaw_deg}°</span>
            </div>
            <Slider
              value={[camera.yaw_deg]}
              onValueChange={([v]) => onUpdate({ yaw_deg: v })}
              min={0}
              max={345}
              step={YAW_STEP}
              className="w-full"
            />
          </div>

          {/* FOV control */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Field of View</Label>
              <span className="text-xs font-mono text-muted-foreground">{camera.fov_deg}°</span>
            </div>
            <Slider
              value={[camera.fov_deg]}
              onValueChange={([v]) => onUpdate({ fov_deg: v })}
              min={FOV_MIN}
              max={FOV_MAX}
              step={5}
              className="w-full"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Main Component: ExperimentalCameraTab
// =============================================================================
interface ExperimentalCameraTabProps {
  projectId: string;
}

export function ExperimentalCameraTab({ projectId }: ExperimentalCameraTabProps) {
  // Local state - completely isolated from production
  const [cameras, setCameras] = useState<ExperimentalCamera[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);
  const [isAddMode, setIsAddMode] = useState(false);
  const [centralSpace, setCentralSpace] = useState<CentralSpaceInfo>({
    name: "Central Living Space",
    approximate_center: { x: 0.5, y: 0.5 },
    approximate_bounds: { x: 0.15, y: 0.15, width: 0.7, height: 0.7 },
  });

  const containerRef = useRef<HTMLDivElement>(null);

  // Camera CRUD operations (all local)
  const addCamera = useCallback((x: number, y: number) => {
    const newCamera: ExperimentalCamera = {
      id: generateId(),
      x_norm: x,
      y_norm: y,
      yaw_deg: 0,
      fov_deg: DEFAULT_FOV,
      room: "central_space",
    };
    setCameras((prev) => [...prev, newCamera]);
    setSelectedCameraId(newCamera.id);
    setIsAddMode(false);
  }, []);

  const updateCamera = useCallback((id: string, updates: Partial<ExperimentalCamera>) => {
    setCameras((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...updates } : c))
    );
  }, []);

  const deleteCamera = useCallback((id: string) => {
    setCameras((prev) => prev.filter((c) => c.id !== id));
    if (selectedCameraId === id) {
      setSelectedCameraId(null);
    }
  }, [selectedCameraId]);

  const moveCamera = useCallback((id: string, direction: "up" | "down") => {
    setCameras((prev) => {
      const idx = prev.findIndex((c) => c.id === id);
      if (idx === -1) return prev;
      const newIdx = direction === "up" ? idx - 1 : idx + 1;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      const arr = [...prev];
      [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
      return arr;
    });
  }, []);

  const clearAllCameras = useCallback(() => {
    setCameras([]);
    setSelectedCameraId(null);
  }, []);

  // Handle canvas click for adding cameras
  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!isAddMode) return;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      addCamera(x, y);
    },
    [isAddMode, addCamera]
  );

  const selectedCamera = useMemo(
    () => cameras.find((c) => c.id === selectedCameraId),
    [cameras, selectedCameraId]
  );

  return (
    <div className="grid grid-cols-[1fr_340px] gap-4 h-full">
      {/* Main Canvas Area */}
      <Card className="flex flex-col">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FlaskConical className="h-5 w-5 text-orange-500" />
              <CardTitle className="text-lg">Camera Planning (Experimental)</CardTitle>
              <Badge variant="outline" className="border-orange-500/50 text-orange-600">
                POC
              </Badge>
            </div>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <Info className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="left" className="max-w-xs">
                  <p className="text-sm">
                    This tab tests camera planning logic on a single central space only.
                    Results are NOT saved to the production pipeline.
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <CardDescription>
            Place cameras on the central space to test directional rendering
          </CardDescription>
        </CardHeader>

        <CardContent className="flex-1 flex flex-col gap-3">
          <Alert className="border-orange-500/30 bg-orange-50/50 dark:bg-orange-950/20">
            <AlertTriangle className="h-4 w-4 text-orange-500" />
            <AlertDescription className="text-sm text-orange-700 dark:text-orange-300">
              <strong>Experimental Mode:</strong> This tab operates on ONE central space only.
              All other rooms are ignored. Data here does not affect the main pipeline.
            </AlertDescription>
          </Alert>

          {/* Canvas */}
          <div
            ref={containerRef}
            className={cn(
              "relative flex-1 min-h-[400px] rounded-lg border-2 overflow-hidden",
              isAddMode
                ? "border-primary border-dashed cursor-crosshair bg-primary/5"
                : "border-border bg-muted/30"
            )}
            onClick={handleCanvasClick}
          >
            {/* Placeholder floor plan representation */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div
                className="border-2 border-dashed border-muted-foreground/30 rounded-lg bg-muted/20 flex items-center justify-center"
                style={{
                  position: "absolute",
                  left: `${centralSpace.approximate_bounds.x * 100}%`,
                  top: `${centralSpace.approximate_bounds.y * 100}%`,
                  width: `${centralSpace.approximate_bounds.width * 100}%`,
                  height: `${centralSpace.approximate_bounds.height * 100}%`,
                }}
              >
                <span className="text-muted-foreground text-sm font-medium">
                  {centralSpace.name}
                </span>
              </div>
            </div>

            {/* SVG overlay for cameras */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none">
              <defs>
                <marker
                  id="exp-arrowhead"
                  markerWidth="6"
                  markerHeight="6"
                  refX="5"
                  refY="3"
                  orient="auto"
                >
                  <polygon
                    points="0 0, 6 3, 0 6"
                    className="fill-current"
                  />
                </marker>
              </defs>
              <g className="pointer-events-auto">
                {cameras.map((camera) => (
                  <CameraMarkerOverlay
                    key={camera.id}
                    camera={camera}
                    isSelected={camera.id === selectedCameraId}
                    onSelect={() => setSelectedCameraId(camera.id)}
                    onDragEnd={(x, y) => updateCamera(camera.id, { x_norm: x, y_norm: y })}
                    onRotate={(yaw) => updateCamera(camera.id, { yaw_deg: yaw })}
                    containerRef={containerRef}
                  />
                ))}
              </g>
            </svg>

            {/* Add mode instruction */}
            {isAddMode && cameras.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="bg-background/90 px-4 py-2 rounded-lg border shadow-sm">
                  <p className="text-sm text-muted-foreground">Click anywhere to place a camera</p>
                </div>
              </div>
            )}
          </div>

          {/* Bottom toolbar */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button
                variant={isAddMode ? "default" : "outline"}
                size="sm"
                onClick={() => setIsAddMode(!isAddMode)}
              >
                <Plus className="h-4 w-4 mr-1" />
                {isAddMode ? "Adding..." : "Add Camera"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={clearAllCameras}
                disabled={cameras.length === 0}
              >
                <RotateCcw className="h-4 w-4 mr-1" />
                Clear All
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">
                {cameras.length} camera{cameras.length !== 1 ? "s" : ""}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Sidebar */}
      <div className="flex flex-col gap-4">
        {/* Camera List */}
        <Card className="flex-1 flex flex-col min-h-0">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Camera className="h-4 w-4" />
              Cameras
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-auto min-h-0 space-y-2">
            {cameras.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Camera className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No cameras placed</p>
                <p className="text-xs">Click "Add Camera" and place on the canvas</p>
              </div>
            ) : (
              cameras.map((camera, idx) => (
                <CameraListItem
                  key={camera.id}
                  camera={camera}
                  index={idx}
                  isSelected={camera.id === selectedCameraId}
                  onSelect={() => setSelectedCameraId(camera.id)}
                  onUpdate={(updates) => updateCamera(camera.id, updates)}
                  onDelete={() => deleteCamera(camera.id)}
                  onMoveUp={() => moveCamera(camera.id, "up")}
                  onMoveDown={() => moveCamera(camera.id, "down")}
                  isFirst={idx === 0}
                  isLast={idx === cameras.length - 1}
                />
              ))
            )}
          </CardContent>
        </Card>

        {/* Render Controls */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Play className="h-4 w-4" />
              Rendering
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              className="w-full"
              disabled={cameras.length === 0}
              onClick={() => {
                // Placeholder for render logic
                console.log("Experimental render request:", { cameras, centralSpace });
                alert(
                  `Render simulation:\n\n${cameras.length} camera(s) defined.\n\nIn production, each camera would generate a view from:\n- Position: (x, y)\n- Direction: yaw°\n- FOV: ${DEFAULT_FOV}°\n\nOnly the central space would be rendered.`
                );
              }}
            >
              <Play className="h-4 w-4 mr-2" />
              Simulate Renders ({cameras.length})
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              Renders are simulated in this experimental tab
            </p>
          </CardContent>
        </Card>

        {/* Debug Data */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground">Debug: Camera Data</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-[10px] bg-muted/50 p-2 rounded overflow-auto max-h-32 font-mono">
              {JSON.stringify(cameras, null, 2) || "[]"}
            </pre>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
