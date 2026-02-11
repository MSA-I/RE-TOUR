import { memo, useState, useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useStorage } from "@/hooks/useStorage";
import { supabase } from "@/integrations/supabase/client";
import {
  Map,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Loader2,
  ChevronUp,
  ChevronDown,
  Ruler,
  AlertTriangle,
  RotateCcw,
  Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface SourcePlanViewerProps {
  floorPlanUploadId: string;
  /** Step 3 styled output upload ID - if provided, shows comparison */
  styledOutputUploadId?: string | null;
  bucket?: string;
  /** Analysis data from step_outputs */
  analysisData?: {
    dimension_analysis?: {
      dimensions_found: boolean;
      units?: string;
      key_dimensions?: string[];
    };
    geometry_analysis?: {
      has_non_orthogonal_walls: boolean;
      has_curved_walls: boolean;
      geometry_notes?: string;
    };
  };
  className?: string;
}

export const SourcePlanViewer = memo(function SourcePlanViewer({
  floorPlanUploadId,
  styledOutputUploadId,
  bucket = "panoramas",
  analysisData,
  className,
}: SourcePlanViewerProps) {
  const { getSignedViewUrl } = useStorage();
  const [originalImageUrl, setOriginalImageUrl] = useState<string | null>(null);
  const [styledImageUrl, setStyledImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<"original" | "styled">("styled");

  // Zoom and pan state for inline viewer
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Fullscreen state
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const [fullscreenZoom, setFullscreenZoom] = useState(1);
  const [fullscreenPan, setFullscreenPan] = useState({ x: 0, y: 0 });
  const [fullscreenDragging, setFullscreenDragging] = useState(false);
  const [fullscreenDragStart, setFullscreenDragStart] = useState({ x: 0, y: 0 });
  const fullscreenContainerRef = useRef<HTMLDivElement>(null);

  // Native wheel handler with passive: false - MANDATORY for preventDefault to work
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const nativeWheelHandler = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      setZoom(z => Math.max(0.5, Math.min(3, z + delta)));
    };

    container.addEventListener('wheel', nativeWheelHandler, { passive: false });

    return () => {
      container.removeEventListener('wheel', nativeWheelHandler);
    };
  }, []);

  // Native wheel handler for fullscreen viewer
  useEffect(() => {
    const container = fullscreenContainerRef.current;
    if (!container || !fullscreenOpen) return;

    const nativeFullscreenWheelHandler = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY > 0 ? -0.15 : 0.15;
      setFullscreenZoom(z => Math.max(0.5, Math.min(5, z + delta)));
    };

    container.addEventListener('wheel', nativeFullscreenWheelHandler, { passive: false });

    return () => {
      container.removeEventListener('wheel', nativeFullscreenWheelHandler);
    };
  }, [fullscreenOpen]);

  // Load original floor plan image
  useEffect(() => {
    if (!floorPlanUploadId) return;

    const loadImage = async () => {
      setLoading(true);
      try {
        const { data: upload, error: uploadError } = await supabase
          .from('uploads')
          .select('bucket, path')
          .eq('id', floorPlanUploadId)
          .single();

        if (uploadError || !upload) {
          console.error("Failed to fetch upload record:", uploadError);
          return;
        }

        const result = await getSignedViewUrl(upload.bucket, upload.path);
        if (result.signedUrl) {
          setOriginalImageUrl(result.signedUrl);
        }
      } finally {
        setLoading(false);
      }
    };

    loadImage();
  }, [floorPlanUploadId, getSignedViewUrl]);

  // Load Step 3 styled output image when available
  useEffect(() => {
    if (!styledOutputUploadId) {
      setStyledImageUrl(null);
      return;
    }

    const loadStyledImage = async () => {
      try {
        const { data: upload, error: uploadError } = await supabase
          .from('uploads')
          .select('bucket, path')
          .eq('id', styledOutputUploadId)
          .single();

        if (uploadError || !upload) {
          console.error("Failed to fetch styled upload record:", uploadError);
          return;
        }

        const result = await getSignedViewUrl(upload.bucket, upload.path);
        if (result.signedUrl) {
          setStyledImageUrl(result.signedUrl);
        }
      } catch (err) {
        console.error("Error loading styled image:", err);
      }
    };

    loadStyledImage();
  }, [styledOutputUploadId, getSignedViewUrl]);

  // Switch to styled tab when styled image becomes available
  useEffect(() => {
    if (styledImageUrl) {
      setActiveTab("styled");
    }
  }, [styledImageUrl]);

  // Current display image based on tab
  const currentImageUrl = activeTab === "styled" && styledImageUrl ? styledImageUrl : originalImageUrl;

  // Inline viewer handlers
  const handleZoomIn = useCallback(() => {
    setZoom(z => Math.min(z + 0.25, 3));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom(z => Math.max(z - 0.25, 0.5));
  }, []);

  const handleResetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    const newX = e.clientX - dragStart.x;
    const newY = e.clientY - dragStart.y;
    const maxPan = 200 * zoom;
    setPan({
      x: Math.max(-maxPan, Math.min(maxPan, newX)),
      y: Math.max(-maxPan, Math.min(maxPan, newY)),
    });
  }, [isDragging, dragStart, zoom]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // handleWheel removed - using native event listener with { passive: false }

  // Fullscreen handlers
  const handleFullscreenZoomIn = useCallback(() => {
    setFullscreenZoom(z => Math.min(z + 0.25, 5));
  }, []);

  const handleFullscreenZoomOut = useCallback(() => {
    setFullscreenZoom(z => Math.max(z - 0.25, 0.5));
  }, []);

  const handleFullscreenResetView = useCallback(() => {
    setFullscreenZoom(1);
    setFullscreenPan({ x: 0, y: 0 });
  }, []);

  const handleFullscreenMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setFullscreenDragging(true);
    setFullscreenDragStart({ x: e.clientX - fullscreenPan.x, y: e.clientY - fullscreenPan.y });
  }, [fullscreenPan]);

  const handleFullscreenMouseMove = useCallback((e: React.MouseEvent) => {
    if (!fullscreenDragging) return;
    const newX = e.clientX - fullscreenDragStart.x;
    const newY = e.clientY - fullscreenDragStart.y;
    const maxPan = 500 * fullscreenZoom;
    setFullscreenPan({
      x: Math.max(-maxPan, Math.min(maxPan, newX)),
      y: Math.max(-maxPan, Math.min(maxPan, newY)),
    });
  }, [fullscreenDragging, fullscreenDragStart, fullscreenZoom]);

  const handleFullscreenMouseUp = useCallback(() => {
    setFullscreenDragging(false);
  }, []);

  // handleFullscreenWheel removed - using native event listener with { passive: false }

  const dimensionAnalysis = analysisData?.dimension_analysis;
  const geometryAnalysis = analysisData?.geometry_analysis;

  const hasScaleLock = dimensionAnalysis?.dimensions_found;
  const hasGeometryLock = geometryAnalysis?.has_non_orthogonal_walls || geometryAnalysis?.has_curved_walls;
  const hasStyledOutput = !!styledImageUrl;

  return (
    <>
      {/* Sticky Source Plan Panel */}
      <div className={cn(
        "sticky top-0 z-20 border border-border/50 rounded-lg bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 overflow-hidden transition-all",
        collapsed ? "h-12" : "h-auto",
        className
      )}>
        {/* Sticky Header - always visible with controls */}
        <div
          className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-muted/50 transition-colors border-b border-border/30"
          onClick={() => setCollapsed(!collapsed)}
        >
          <div className="flex items-center gap-2">
            <Map className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">
              {hasStyledOutput ? "Floor Plan (Step 2 Styled)" : "Source Floor Plan"}
            </span>

            {/* Badges for scale/geometry locks */}
            {hasScaleLock && (
              <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/30">
                <Ruler className="w-3 h-3 mr-1" />
                Scale
              </Badge>
            )}
            {hasGeometryLock && (
              <Badge variant="outline" className="text-xs bg-warning/10 text-warning border-warning/30">
                <AlertTriangle className="w-3 h-3 mr-1" />
                Geometry
              </Badge>
            )}
            {hasStyledOutput && (
              <Badge variant="outline" className="text-xs bg-accent/50 text-accent-foreground border-accent">
                <Layers className="w-3 h-3 mr-1" />
                Synced
              </Badge>
            )}
          </div>

          {/* Sticky Controls - always visible */}
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            {!collapsed && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  onClick={handleZoomOut}
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </Button>
                <span className="text-xs text-muted-foreground min-w-[3rem] text-center">
                  {Math.round(zoom * 100)}%
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  onClick={handleZoomIn}
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  onClick={handleResetView}
                  title="Reset view"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </Button>
              </>
            )}
            {/* Fullscreen button - ALWAYS visible even when collapsed */}
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              onClick={(e) => {
                e.stopPropagation();
                setFullscreenOpen(true);
              }}
              title="Expand to fullscreen"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </Button>
            <div className="w-px h-4 bg-border mx-1" />
            {collapsed ? (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronUp className="w-4 h-4 text-muted-foreground" />
            )}
          </div>
        </div>

        {/* Plan Preview with drag-to-pan */}
        {!collapsed && (
          <div className="px-3 pb-3 pt-2">
            {/* Tab switcher when styled output is available */}
            {hasStyledOutput && (
              <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "original" | "styled")} className="mb-2">
                <TabsList className="h-8 w-full">
                  <TabsTrigger value="styled" className="flex-1 text-xs">
                    Step 2 Styled
                  </TabsTrigger>
                  <TabsTrigger value="original" className="flex-1 text-xs">
                    Original Plan
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            )}

            <div
              ref={containerRef}
              className={cn(
                "relative rounded-md bg-muted/30 overflow-hidden select-none",
                isDragging ? "cursor-grabbing" : "cursor-grab"
              )}
              style={{
                height: "200px",
                touchAction: "none",
                overscrollBehavior: "contain"
              }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            >
              {loading ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : currentImageUrl ? (
                <img
                  src={currentImageUrl}
                  alt={activeTab === "styled" ? "Step 2 styled floor plan" : "Source floor plan"}
                  className="transition-transform duration-75 pointer-events-none absolute inset-0 m-auto"
                  draggable={false}
                  style={{
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                    transformOrigin: "center center",
                    maxWidth: "100%",
                    maxHeight: "100%",
                    objectFit: "contain",
                  }}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                  Unable to load floor plan
                </div>
              )}
            </div>

            {/* Label for current view */}
            <p className="text-xs text-muted-foreground mt-2 text-center">
              {activeTab === "styled" && hasStyledOutput
                ? "Used for current room generation"
                : "Original uploaded floor plan"}
            </p>

            {/* Analysis info hints */}
            {(dimensionAnalysis || geometryAnalysis) && (
              <div className="mt-2 flex flex-wrap gap-2 text-xs justify-center">
                {dimensionAnalysis?.dimensions_found && dimensionAnalysis.units && (
                  <span className="text-muted-foreground">
                    Units: {dimensionAnalysis.units}
                  </span>
                )}
                {geometryAnalysis?.has_non_orthogonal_walls && (
                  <span className="text-warning">Angled walls</span>
                )}
                {geometryAnalysis?.has_curved_walls && (
                  <span className="text-warning">Curved walls</span>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Fullscreen Dialog with tabs and zoom/pan */}
      <Dialog open={fullscreenOpen} onOpenChange={setFullscreenOpen}>
        <DialogContent className="max-w-[95vw] max-h-[95vh] p-0 overflow-hidden">
          <DialogHeader className="p-4 pb-2">
            <div className="flex items-center justify-between">
              <DialogTitle className="flex items-center gap-2">
                <Map className="w-5 h-5 text-primary" />
                {hasStyledOutput ? "Styled Floor Plan (Step 2)" : "Source Floor Plan"}
              </DialogTitle>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" onClick={handleFullscreenZoomOut}>
                  <ZoomOut className="w-4 h-4" />
                </Button>
                <Button size="sm" variant="ghost" onClick={handleFullscreenResetView} title="Reset view">
                  <RotateCcw className="w-4 h-4" />
                </Button>
                <span className="text-xs text-muted-foreground min-w-[3rem] text-center">
                  {Math.round(fullscreenZoom * 100)}%
                </span>
                <Button size="sm" variant="ghost" onClick={handleFullscreenZoomIn}>
                  <ZoomIn className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </DialogHeader>

          {/* Tab switcher in fullscreen */}
          {hasStyledOutput && (
            <div className="px-4">
              <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "original" | "styled")}>
                <TabsList className="w-full">
                  <TabsTrigger value="styled" className="flex-1">
                    Step 2 Styled Output
                  </TabsTrigger>
                  <TabsTrigger value="original" className="flex-1">
                    Original Floor Plan
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          )}

          <div
            ref={fullscreenContainerRef}
            className={cn(
              "flex-1 p-4 pt-2 select-none overflow-hidden flex items-center justify-center",
              fullscreenDragging ? "cursor-grabbing" : "cursor-grab"
            )}
            style={{
              height: "calc(95vh - 180px)",
              touchAction: "none",
              overscrollBehavior: "contain"
            }}
            onMouseDown={handleFullscreenMouseDown}
            onMouseMove={handleFullscreenMouseMove}
            onMouseUp={handleFullscreenMouseUp}
            onMouseLeave={handleFullscreenMouseUp}
          >
            {currentImageUrl && (
              <img
                src={currentImageUrl}
                alt={activeTab === "styled" ? "Step 2 styled floor plan" : "Source floor plan"}
                className="transition-transform duration-75 pointer-events-none"
                draggable={false}
                style={{
                  transform: `translate(${fullscreenPan.x}px, ${fullscreenPan.y}px) scale(${fullscreenZoom})`,
                  transformOrigin: "center center",
                  maxWidth: "100%",
                  maxHeight: "100%",
                  objectFit: "contain",
                }}
              />
            )}
          </div>

          {/* Analysis details in fullscreen */}
          {(dimensionAnalysis || geometryAnalysis) && (
            <div className="px-4 pb-4 space-y-2">
              <div className="flex flex-wrap gap-2 justify-center">
                {hasScaleLock && (
                  <Badge className="bg-primary/20 text-primary">
                    <Ruler className="w-3 h-3 mr-1" />
                    Scale Locked ({dimensionAnalysis?.units || "detected"})
                  </Badge>
                )}
                {hasGeometryLock && (
                  <Badge className="bg-warning/20 text-warning">
                    <AlertTriangle className="w-3 h-3 mr-1" />
                    Geometry Locked
                    {geometryAnalysis?.has_non_orthogonal_walls && " (angled)"}
                    {geometryAnalysis?.has_curved_walls && " (curved)"}
                  </Badge>
                )}
              </div>
              {geometryAnalysis?.geometry_notes && (
                <p className="text-xs text-muted-foreground text-center">{geometryAnalysis.geometry_notes}</p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
});