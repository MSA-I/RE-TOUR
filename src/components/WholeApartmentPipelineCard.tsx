import { useState, memo, useMemo, useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PipelineProgressBar } from "@/components/whole-apartment/PipelineProgressBar";
import { Separator } from "@/components/ui/separator";
import { FloorplanPipeline } from "@/hooks/useFloorplanPipelines";
import {
  useWholeApartmentPipeline,
  WHOLE_APARTMENT_STEP_NAMES,
  PHASE_STEP_MAP,
} from "@/hooks/useWholeApartmentPipeline";
import { SpaceCard } from "@/components/whole-apartment/SpaceCard";
import {
  PipelineRatioSelector,
  PipelineQualitySelector,
} from "@/components/whole-apartment/PipelineRatioSelector";
import { ManualQAToggle } from "@/components/whole-apartment/ManualQAToggle";
import { PipelineToggle } from "@/components/whole-apartment/PipelineToggle";
import { StageReviewPanel, StageReviewAsset } from "@/components/whole-apartment/StageReviewPanel";
import { SourcePlanViewer } from "@/components/whole-apartment/SourcePlanViewer";
import { PipelineDesignReferenceUploader } from "@/components/whole-apartment/PipelineDesignReferenceUploader";
import { ReferenceStyleDebugPanel } from "@/components/whole-apartment/ReferenceStyleDebugPanel";
import { StageApprovalGate } from "@/components/whole-apartment/StageApprovalGate";
import { StepRetryStatusIndicator, StepRetryState } from "@/components/whole-apartment/StepRetryStatusIndicator";
import { CameraPlanningEditor } from "@/components/whole-apartment/CameraPlanningEditor";
import { StopResetStepButton } from "@/components/whole-apartment/StopResetStepButton";
import { StepControlsFooter } from "@/components/whole-apartment/StepControlsFooter";

import { SpaceGraphSummary } from "@/components/whole-apartment/SpaceGraphSummary";
import { PipelineDebugPanel } from "@/components/whole-apartment/PipelineDebugPanel";
import { Step7PreRunSettings } from "@/components/whole-apartment/Step7PreRunSettings";
import { useCameraMarkers } from "@/hooks/useCameraMarkers";
import { useSpatialMap } from "@/hooks/useSpatialMap";
import { useAvailableReferenceImages } from "@/hooks/useAvailableReferenceImages";
import { FloorPlanPipelineTerminal } from "@/components/FloorPlanPipelineTerminal";
import { useStorage } from "@/hooks/useStorage";
import { useToast } from "@/hooks/use-toast";
import { useManualQA } from "@/contexts/ManualQAContext";
import { supabase } from "@/integrations/supabase/client";
import {
  Play,
  Loader2,
  Check,
  Lock,
  Eye,
  MapPin,
  Box,
  Layers,
  ThumbsUp,
  ThumbsDown,
  Settings2,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Terminal,
  MoreVertical,
  Trash2,
  RotateCcw,
  Clock,
  RefreshCw,
  Camera,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

interface WholeApartmentPipelineCardProps {
  pipeline: FloorplanPipeline;
  imagePreviews: Record<string, string>;
  onUpdatePipeline?: () => void;
}

const PHASE_COLORS: Record<string, string> = {
  upload: "bg-muted text-muted-foreground",
  space_analysis_pending: "bg-muted text-muted-foreground",
  space_analysis_running: "bg-purple-500/20 text-purple-400",
  space_analysis_complete: "bg-green-500/20 text-green-400",
  top_down_3d_pending: "bg-muted text-muted-foreground",
  top_down_3d_running: "bg-blue-500/20 text-blue-400",
  top_down_3d_review: "bg-yellow-500/20 text-yellow-400",
  style_pending: "bg-muted text-muted-foreground",
  style_running: "bg-blue-500/20 text-blue-400",
  style_review: "bg-yellow-500/20 text-yellow-400",
  detecting_spaces: "bg-purple-500/20 text-purple-400",
  spaces_detected: "bg-primary/20 text-primary",
  renders_in_progress: "bg-blue-500/20 text-blue-400",
  renders_review: "bg-yellow-500/20 text-yellow-400",
  panoramas_in_progress: "bg-blue-500/20 text-blue-400",
  panoramas_review: "bg-yellow-500/20 text-yellow-400",
  merging_in_progress: "bg-blue-500/20 text-blue-400",
  merging_review: "bg-yellow-500/20 text-yellow-400",
  completed: "bg-primary/20 text-primary",
  failed: "bg-destructive/20 text-destructive",
};

// ============= Global Step Indicator =============
function GlobalStepIndicator({ currentStep }: { currentStep: number }) {
  return (
    <div className="flex items-center gap-1 w-full overflow-x-auto py-2">
      {WHOLE_APARTMENT_STEP_NAMES.map((name, idx) => {
        const stepNum = idx; // 0-indexed to match PHASE_STEP_MAP
        const isActive = stepNum === currentStep;
        const isComplete = stepNum < currentStep;

        return (
          <div key={stepNum} className="flex items-center flex-shrink-0">
            <div
              className={`
                flex items-center justify-center w-6 h-6 rounded-full text-xs font-medium
                ${isComplete ? "bg-primary text-primary-foreground" : ""}
                ${isActive ? "bg-primary/20 text-primary ring-2 ring-primary" : ""}
                ${!isComplete && !isActive ? "bg-muted text-muted-foreground" : ""}
              `}
            >
              {isComplete ? <Check className="w-3 h-3" /> : stepNum}
            </div>
            {idx < WHOLE_APARTMENT_STEP_NAMES.length - 1 && (
              <div
                className={`w-4 sm:w-8 h-0.5 mx-1 ${
                  isComplete ? "bg-primary" : "bg-muted"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============= Space Analysis Display Panel =============
interface DetectedItem {
  item_type: string;
  count: number;
  confidence: number;
  note?: string | null;
}

interface SpaceEntry {
  space_id: string;
  space_class?: "room" | "zone";
  inferred_usage: string;
  confidence: number;
  reasoning?: string;
  classification_reason?: string;
  dimensions_summary?: string | null;
  geometry_flags?: {
    has_angled_walls?: boolean;
    has_curved_walls?: boolean;
  };
  detected_items?: DetectedItem[];
}

interface SpaceAnalysisData {
  // New format with rooms/zones separation
  rooms_count?: number;
  zones_count?: number;
  rooms?: SpaceEntry[];
  zones?: SpaceEntry[];
  // Legacy format (backward compatibility)
  total_spaces?: number;
  spaces?: SpaceEntry[];
  overall_notes: string;
  analyzed_at: string;
}

// Format item type for display (snake_case to Title Case)
function formatItemType(itemType: string | undefined | null): string {
  if (!itemType) return 'Unknown';
  return itemType
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// Render a single space entry (room or zone)
function SpaceEntryRow({ 
  space, 
  index,
  isZone = false,
}: { 
  space: SpaceEntry; 
  index: number;
  isZone?: boolean;
}) {
  return (
    <div className="border-b border-border/30 pb-2 last:border-b-0 last:pb-0">
      <div className="flex items-start gap-2 text-sm">
        <Badge 
          variant={isZone ? "outline" : "secondary"} 
          className={cn("text-xs shrink-0", isZone && "bg-muted/50")}
        >
          {index + 1}
        </Badge>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">{space.inferred_usage}</span>
            <span className="text-muted-foreground text-xs">
              ({Math.round(space.confidence * 100)}%)
            </span>
            {space.dimensions_summary && (
              <span className="text-xs text-primary/80">
                {space.dimensions_summary}
              </span>
            )}
            {space.geometry_flags?.has_angled_walls && (
              <Badge variant="outline" className="text-xs bg-warning/10 text-warning border-warning/30">
                Angled
              </Badge>
            )}
            {space.geometry_flags?.has_curved_walls && (
              <Badge variant="outline" className="text-xs bg-warning/10 text-warning border-warning/30">
                Curved
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {space.classification_reason || space.reasoning}
          </p>
          
          {/* Detected furniture/fixtures */}
          {space.detected_items && space.detected_items.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {space.detected_items.map((item, itemIdx) => (
                <span 
                  key={itemIdx}
                  className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-secondary/50 text-secondary-foreground"
                  title={item.note || undefined}
                >
                  {formatItemType(item.item_type)}
                  {item.count > 1 && <span className="font-medium">×{item.count}</span>}
                  {item.confidence < 0.7 && (
                    <span className="text-muted-foreground">?</span>
                  )}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SpaceAnalysisPanel({ 
  analysisData,
  isLoading,
}: { 
  analysisData: SpaceAnalysisData | null;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="p-4 rounded-lg border border-primary/30 bg-primary/5">
        <div className="flex items-center gap-2 text-primary">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm font-medium">Analyzing floor plan spaces & furniture...</span>
        </div>
      </div>
    );
  }

  if (!analysisData) {
    return null;
  }

  // Handle both new and legacy formats
  const rooms = analysisData.rooms || [];
  const zones = analysisData.zones || [];
  const roomsCount = analysisData.rooms_count ?? rooms.length;
  const zonesCount = analysisData.zones_count ?? zones.length;
  
  // Legacy format: use spaces array if rooms/zones not present
  const legacySpaces = (!analysisData.rooms && analysisData.spaces) ? analysisData.spaces : [];
  const isLegacyFormat = legacySpaces.length > 0;

  // Count total detected items across all spaces
  const allSpaces = [...rooms, ...zones, ...legacySpaces];
  const totalItems = allSpaces.reduce((sum, space) => {
    return sum + (space.detected_items?.length || 0);
  }, 0);

  return (
    <div className="p-4 rounded-lg border border-border/50 bg-card/50 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h4 className="text-sm font-medium flex items-center gap-2">
          <Eye className="w-4 h-4 text-primary" />
          AI Space Analysis (Pre-Generation)
        </h4>
        <div className="flex items-center gap-2">
          {isLegacyFormat ? (
            <Badge variant="outline" className="text-xs">
              {analysisData.total_spaces} spaces
            </Badge>
          ) : (
            <>
              <Badge variant="default" className="text-xs">
                {roomsCount} rooms
              </Badge>
              {zonesCount > 0 && (
                <Badge variant="outline" className="text-xs text-muted-foreground">
                  {zonesCount} zones (not rooms)
                </Badge>
              )}
            </>
          )}
          {totalItems > 0 && (
            <Badge variant="secondary" className="text-xs">
              {totalItems} furniture/fixtures
            </Badge>
          )}
        </div>
      </div>

      {/* Read-only analysis display */}
      <div className="bg-muted/50 rounded-md p-3 space-y-3 max-h-72 overflow-y-auto">
        {isLegacyFormat ? (
          // Legacy format: single list
          legacySpaces.map((space, idx) => (
            <SpaceEntryRow key={space.space_id} space={space} index={idx} />
          ))
        ) : (
          <>
            {/* Rooms section */}
            {rooms.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-medium text-primary flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-primary" />
                  Rooms ({roomsCount})
                </div>
                {rooms.map((space, idx) => (
                  <SpaceEntryRow key={space.space_id} space={space} index={idx} isZone={false} />
                ))}
              </div>
            )}

            {/* Zones section */}
            {zones.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-border/30">
                <div className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-muted-foreground/50" />
                  Zones (not counted as rooms) ({zonesCount})
                </div>
                {zones.map((space, idx) => (
                  <SpaceEntryRow key={space.space_id} space={space} index={idx} isZone={true} />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {analysisData.overall_notes && (
        <p className="text-xs text-muted-foreground italic">
          {analysisData.overall_notes}
        </p>
      )}

      <p className="text-xs text-muted-foreground">
        Analyzed at: {new Date(analysisData.analyzed_at).toLocaleString()}
      </p>
    </div>
  );
}

// ============= Backend Activity Indicator =============
// Shows last backend event and provides recovery for stale states
function BackendActivityIndicator({ 
  pipelineId, 
  currentPhase,
  onRecover,
}: { 
  pipelineId: string; 
  currentPhase: string;
  onRecover: () => void;
}) {
  const [lastEvent, setLastEvent] = useState<{ ts: string; message: string; type: string } | null>(null);
  const [isStale, setIsStale] = useState(false);
  const [isRecovering, setIsRecovering] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  // Only show for running phases
  const isRunningPhase = currentPhase.includes("running") || 
    currentPhase === "detecting_spaces" || 
    currentPhase === "space_analysis_running";

  useEffect(() => {
    if (!isRunningPhase) {
      setLastEvent(null);
      setIsStale(false);
      return;
    }

    const fetchLastEvent = async () => {
      const { data } = await supabase
        .from("floorplan_pipeline_events")
        .select("ts, message, type")
        .eq("pipeline_id", pipelineId)
        .order("ts", { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (data) {
        setLastEvent(data);
        // Check if stale (>2 minutes)
        const eventTime = new Date(data.ts).getTime();
        const now = Date.now();
        setIsStale(now - eventTime > 2 * 60 * 1000);
      }
    };
    
    fetchLastEvent();
    const interval = setInterval(fetchLastEvent, 10000);
    return () => clearInterval(interval);
  }, [pipelineId, isRunningPhase]);
  
  const handleRecover = async () => {
    if (isRecovering) return;
    setIsRecovering(true);
    
    try {
      // Determine the appropriate pending phase based on current phase
      let resetPhase = "space_analysis_pending";
      if (currentPhase === "top_down_3d_running") resetPhase = "top_down_3d_pending";
      else if (currentPhase === "style_running") resetPhase = "style_pending";
      else if (currentPhase === "detecting_spaces") resetPhase = "detect_spaces_pending";
      else if (currentPhase === "renders_in_progress") resetPhase = "spaces_detected";
      else if (currentPhase === "panoramas_in_progress") resetPhase = "renders_review";
      else if (currentPhase === "merging_in_progress") resetPhase = "panoramas_review";

      await supabase
        .from("floorplan_pipelines")
        .update({ 
          whole_apartment_phase: resetPhase, 
          last_error: "Step recovered from stale state by user" 
        })
        .eq("id", pipelineId);
      
      queryClient.invalidateQueries({ queryKey: ["floorplan-pipelines"] });
      toast({ 
        title: "Step recovered", 
        description: "You can now retry the step." 
      });
      onRecover();
    } catch (error) {
      toast({ 
        title: "Recovery failed", 
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsRecovering(false);
    }
  };
  
  if (!isRunningPhase) return null;

  return (
    <div className="flex items-center gap-2 text-xs px-3 py-2 bg-muted/30 rounded-lg border border-border/30">
      {isStale ? (
        <>
          <AlertTriangle className="w-3.5 h-3.5 text-warning flex-shrink-0" />
          <span className="text-warning">No backend activity for 2+ minutes</span>
          <Button 
            size="sm" 
            variant="outline" 
            onClick={handleRecover}
            disabled={isRecovering}
            className="ml-auto h-6 text-xs"
          >
            {isRecovering ? (
              <Loader2 className="w-3 h-3 animate-spin mr-1" />
            ) : (
              <RefreshCw className="w-3 h-3 mr-1" />
            )}
            Recover Step
          </Button>
        </>
      ) : lastEvent ? (
        <>
          <Clock className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
          <span className="text-muted-foreground truncate flex-1">
            {lastEvent.message}
          </span>
          <span className="text-muted-foreground/60 flex-shrink-0">
            {formatDistanceToNow(new Date(lastEvent.ts), { addSuffix: true })}
          </span>
        </>
      ) : (
        <>
          <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground flex-shrink-0" />
          <span className="text-muted-foreground">Waiting for backend...</span>
        </>
      )}
    </div>
  );
}

// ============= Settings Drawer =============
function PipelineSettingsDrawer({
  open,
  onOpenChange,
  pipeline,
  onUpdateSettings,
  onUpdateQualityPostStep4,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipeline: FloorplanPipeline;
  onUpdateSettings: (ratio: string, quality: string, designRefUploadId?: string) => void;
  onUpdateQualityPostStep4: (quality: string) => void;
}) {
  const [ratio, setRatio] = useState(pipeline.aspect_ratio || "16:9");
  const [quality, setQuality] = useState(pipeline.output_resolution || "2K");
  
  // Quality policy: determine if ratio is locked
  const phase = pipeline.whole_apartment_phase || "upload";
  const ratioLocked = (pipeline as any).ratio_locked === true || 
    !["upload", "space_analysis_pending"].includes(phase);
  
  // Quality post step 4 (for renders, panoramas, merge)
  const qualityPostStep4 = (pipeline as any).quality_post_step4 || "2K";
  const [postStep4Quality, setPostStep4Quality] = useState(qualityPostStep4);
  
  // Can only edit ratio before pipeline starts
  const canEditRatio = !ratioLocked;
  
  // Can edit quality_post_step4 until renders start
  // Updated step numbering: Step 3 = Detect Spaces, Step 4 = Camera Planning
  const PHASE_STEP_MAP_LOCAL: Record<string, number> = {
    upload: 0, space_analysis_pending: 0, space_analysis_running: 0, space_analysis_complete: 0,
    top_down_3d_pending: 1, top_down_3d_running: 1, top_down_3d_review: 1,
    style_pending: 2, style_running: 2, style_review: 2, style_approved: 2,
    detect_spaces_pending: 3, detecting_spaces: 3, spaces_detected: 3, // Step 3
    camera_plan_pending: 4, camera_plan_confirmed: 4, // Step 4
    renders_in_progress: 5, renders_review: 5,
    panoramas_in_progress: 6, panoramas_review: 6,
    merging_in_progress: 7, merging_review: 7,
    completed: 8,
  };
  const currentStep = PHASE_STEP_MAP_LOCAL[phase] ?? 0;
  const canEditQualityPostStep4 = currentStep < 5; // Now before Step 5 (Renders)

  // Get existing design reference from step_outputs
  const stepOutputs = (pipeline.step_outputs || {}) as Record<string, unknown>;
  const existingDesignRef = (stepOutputs.design_reference_id as string) || null;

  const handleSave = () => {
    if (canEditRatio) {
      onUpdateSettings(ratio, quality);
    }
    onOpenChange(false);
  };

  const handleQualityPostStep4Change = (newQuality: string) => {
    setPostStep4Quality(newQuality);
    onUpdateQualityPostStep4(newQuality);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Settings2 className="w-5 h-5" />
            Pipeline Settings
          </SheetTitle>
          <SheetDescription>
            Configure output ratio and quality settings.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Ratio Selector - locked after start */}
          <PipelineRatioSelector
            value={ratio}
            onChange={setRatio}
            type="render"
            disabled={!canEditRatio}
            locked={ratioLocked}
          />

          <Separator />

          {/* Quality Policy Info */}
          <div className="space-y-3">
            <div className="space-y-1">
              <p className="text-sm font-medium">Quality Settings</p>
              <p className="text-xs text-muted-foreground">
                Steps 0-4 (Analysis, Top-Down, Style, Detect Spaces, Camera Planning) always run in 2K for stability and memory efficiency.
              </p>
            </div>

            {/* Current quality display for early steps */}
            {currentStep < 3 && (
              <div className="flex items-center gap-2 text-sm bg-muted/50 p-3 rounded-lg">
                <Lock className="w-4 h-4 text-muted-foreground" />
                <div>
                  <p className="font-medium">Steps 0-3: 2K (Fixed)</p>
                  <p className="text-xs text-muted-foreground">Quality selection becomes available at Step 4</p>
                </div>
              </div>
            )}
            
            {/* Quality selector shown from Step 3 onwards */}
            {currentStep >= 3 && (
              <>
                <PipelineQualitySelector
                  value={postStep4Quality}
                  onChange={handleQualityPostStep4Change}
                  disabled={!canEditQualityPostStep4}
                  showStep4Hint
                />
                
                {!canEditQualityPostStep4 && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 p-3 rounded-lg">
                    <Lock className="w-4 h-4" />
                    Quality locked after renders start
                  </div>
                )}
              </>
            )}
          </div>

          <Separator />

          {/* Design Reference Info */}
          {existingDesignRef && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Design Reference</p>
              <Badge variant="outline" className="text-xs">
                Reference uploaded (used in Step 2 only)
              </Badge>
            </div>
          )}

          <div className="space-y-2">
            <p className="text-sm font-medium">Panorama Ratio</p>
            <Badge variant="outline">2:1 (Equirectangular)</Badge>
            <p className="text-xs text-muted-foreground">
              Panoramas always use 2:1 ratio for proper 360° display
            </p>
          </div>

          {canEditRatio && (
            <Button onClick={handleSave} className="w-full">
              Save Settings
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}


// ============= Global Steps Section (Steps 0-4) with Before/After Review =============
function GlobalStepsSection({
  pipeline,
  imagePreviews,
  onRunSpaceAnalysis,
  onRunTopDown,
  onRunStyle,
  onConfirmCameraPlan,
  onRunDetectSpaces,
  onRetryDetectSpaces,
  onApproveStep,
  onRejectStep,
  isRunning,
  isRetryingStep4,
  isConfirmingCameraPlan,
  manualQAEnabled,
  approvalLocked,
  onAction,
  currentStep,
  stepRetryState,
  onManualApproveStep,
  onManualRejectStep,
  onRestartStep,
  onRollbackStep,
  onContinueToStep,
  isResetPending,
  isRollbackPending,
}: {
  pipeline: FloorplanPipeline;
  imagePreviews: Record<string, string>;
  onRunSpaceAnalysis: () => void;
  onRunTopDown: () => void;
  onRunStyle: () => void;
  onConfirmCameraPlan: () => void;
  onRunDetectSpaces: () => void;
  onRetryDetectSpaces: () => void;
  onApproveStep: (step: number) => void;
  onRejectStep: (step: number, notes: string) => void;
  isRunning: boolean;
  isRetryingStep4: boolean;
  isConfirmingCameraPlan: boolean;
  manualQAEnabled: boolean;
  approvalLocked: boolean;
  onAction: (type: "generate" | "approve" | "reject" | "continue", meta?: Record<string, unknown>) => void;
  currentStep: number;
  stepRetryState?: Record<string, StepRetryState>;
  onManualApproveStep?: (stepNumber: number, outputUploadId?: string) => void;
  onManualRejectStep?: (stepNumber: number) => void;
  onRestartStep?: (stepNumber: number) => void;
  onRollbackStep?: (stepNumber: number) => void;
  onContinueToStep: (fromStep: number, fromPhase: string) => void;
  isResetPending?: boolean;
  isRollbackPending?: boolean;
}) {
  const { getSignedViewUrl } = useStorage();
  const { spatialMap, isLoading: spatialMapLoading, error: spatialMapError, runSpatialDecomposition } = useSpatialMap(pipeline.id);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [cameraPlanningOpen, setCameraPlanningOpen] = useState(false);
  const [rejectNotes, setRejectNotes] = useState("");
  const [pendingRejectStep, setPendingRejectStep] = useState<number | null>(null);

  const phase = pipeline.whole_apartment_phase || "upload";
  const status = pipeline.status || "";
  const stepOutputs = (pipeline.step_outputs || {}) as Record<string, { upload_id?: string; qa_status?: string; qa_report?: Record<string, unknown>; prompt_text?: string } | SpaceAnalysisData>;
  
  // Extract step 1-3 retry states
  const step1RetryState = stepRetryState?.["step_1"] || null;
  const step2RetryState = stepRetryState?.["step_2"] || null;
  const step3RetryState = stepRetryState?.["step_3"] || null;
  
  // Detect blocked states for Steps 1-3
  const step1Blocked = step1RetryState?.status === "blocked_for_human" || status === "step1_blocked_for_human";
  const step2Blocked = step2RetryState?.status === "blocked_for_human" || status === "step2_blocked_for_human";
  const step3Blocked = step3RetryState?.status === "blocked_for_human" || status === "step3_blocked_for_human";
  
  // Note: QA fail auto-retry states computed after step outputs are declared (see below)

  const handlePreview = async (uploadId: string) => {
    const result = await getSignedViewUrl("outputs", uploadId);
    if (result.signedUrl) {
      setPreviewUrl(result.signedUrl);
      setPreviewOpen(true);
    }
  };

  const handleRejectClick = (step: number) => {
    setPendingRejectStep(step);
    setRejectNotes("");
    setRejectDialogOpen(true);
  };

  const confirmReject = () => {
    if (pendingRejectStep) {
      onRejectStep(pendingRejectStep, rejectNotes);
    }
    setRejectDialogOpen(false);
    setPendingRejectStep(null);
  };

  // Space Analysis (Step 0)
  const spaceAnalysis = stepOutputs["space_analysis"] as SpaceAnalysisData | undefined;
  const spaceAnalysisRunning = phase === "space_analysis_running";
  const spaceAnalysisPending = phase === "upload" || phase === "space_analysis_pending";
  const spaceAnalysisComplete = phase === "space_analysis_complete" || PHASE_STEP_MAP[phase] >= 1;

  // Step outputs - support both upload_id and output_upload_id for backwards compatibility
  type StepOutput = { 
    upload_id?: string; 
    output_upload_id?: string; 
    qa_status?: string; 
    qa_decision?: string;
    manual_approved?: boolean;
    manual_approved_at?: string;
    manual_rejected?: boolean;
    manual_rejected_at?: string;
    qa_report?: Record<string, unknown>; 
    qa_reason?: string;
    prompt_text?: string;
    prompt_used?: string;
  };
  const step1Output = (stepOutputs["step1"] || stepOutputs["1"]) as StepOutput | undefined;
  const step2Output = (stepOutputs["step2"] || stepOutputs["2"]) as StepOutput | undefined;

  const step1ManualApproved = !!step1Output?.manual_approved;
  const step2ManualApproved = !!step2Output?.manual_approved;

  // Detect QA fail auto-retry states
  // CRITICAL FIX: Don't show qa_fail if the step output shows QA passed
  // This handles the case where backend updated step_outputs but not step_retry_state
  const step1QAFail = (step1RetryState?.status === "qa_fail" || status === "step1_qa_fail") && 
                      step1Output?.qa_decision !== "approved" && 
                      step1Output?.qa_decision !== "partial_success";
  const step2QAFail = (step2RetryState?.status === "qa_fail" || status === "step2_qa_fail") && 
                      step2Output?.qa_decision !== "approved" && 
                      step2Output?.qa_decision !== "partial_success";
  const step3QAFail = (step3RetryState?.status === "qa_fail" || status === "step3_qa_fail");

  const step1AwaitingApproval =
    manualQAEnabled &&
    !!(step1Output?.upload_id || step1Output?.output_upload_id) &&
    !step1ManualApproved &&
    (phase === "top_down_3d_review" || step1Output?.qa_status === "approved" || step1Output?.qa_decision === "approved");

  const step2AwaitingApproval =
    manualQAEnabled &&
    !!(step2Output?.upload_id || step2Output?.output_upload_id) &&
    !step2ManualApproved &&
    (phase === "style_review" || step2Output?.qa_status === "approved" || step2Output?.qa_decision === "approved");

  // Step 1: Top-Down 3D - check both upload_id and output_upload_id
  const step1UploadId = step1Output?.upload_id || step1Output?.output_upload_id;
  const step1Running = phase === "top_down_3d_running";
  
  // RESILIENT Step1 review detection:
  // Show review panel if ANY of these conditions are true:
  // 1. Phase explicitly says review
  // 2. Output exists + manual QA enabled + not manually approved yet
  // 3. Output has passed AI-QA but not manually approved
  const step1HasOutput = !!step1UploadId;
  const step1AIQAPassed = step1Output?.qa_status === "approved" || step1Output?.qa_decision === "approved";
  const step1Review = 
    (phase === "top_down_3d_review") || 
    (manualQAEnabled && step1HasOutput && !step1ManualApproved) ||
    (manualQAEnabled && step1AIQAPassed && !step1ManualApproved);
  // RESILIENT Step1 pending detection:
  // Step 1 is pending if:
  // 1. Phase explicitly says space_analysis_complete or top_down_3d_pending
  // 2. OR space analysis is complete AND no Step 1 output exists yet AND not running
  const step1Pending = 
    phase === "space_analysis_complete" || 
    phase === "top_down_3d_pending" ||
    (spaceAnalysisComplete && !step1HasOutput && !step1Running);
  
  // Step1 is done ONLY when manually approved (if manual QA) or phase is past step 2
  const step1Done = manualQAEnabled ? step1ManualApproved : PHASE_STEP_MAP[phase] >= 2;

  // Step 2: Style Top-Down - check both upload_id and output_upload_id
  const step2UploadId = step2Output?.upload_id || step2Output?.output_upload_id;
  const step2Running = phase === "style_running";
  
  // RESILIENT Step2 review detection:
  // Show review panel if ANY of these conditions are true:
  // 1. Phase explicitly says review
  // 2. Output exists + manual QA enabled + not manually approved yet + step1 is done
  // 3. Output has passed AI-QA but not manually approved
  const step2HasOutput = !!step2UploadId;
  const step2AIQAPassed = step2Output?.qa_status === "approved" || step2Output?.qa_decision === "approved";
  const step2Review = 
    (phase === "style_review") || 
    (manualQAEnabled && step2HasOutput && !step2ManualApproved && step1Done) ||
    (manualQAEnabled && step2AIQAPassed && !step2ManualApproved && step1Done);
  const step2Pending = phase === "style_pending";
  // Step2 is done ONLY when manually approved (if manual QA) or phase is past step 3
  const step2Done = manualQAEnabled ? step2ManualApproved : PHASE_STEP_MAP[phase] >= 3;

  // Step 3: Detect Spaces
  const step3Running = phase === "detecting_spaces";
  const step3Pending = phase === "detect_spaces_pending";
  const step3Done = phase === "spaces_detected" || PHASE_STEP_MAP[phase] >= 4;
  const step3Failed = !!pipeline.last_error && (phase === "detect_spaces_pending" || phase === "style_approved");

  // Step 3 stall detection - check if last backend event is > 2 minutes old
  const STALL_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes
  const [step3LastEvent, setStep3LastEvent] = useState<{ ts: string; message: string } | null>(null);
  const [step3IsStale, setStep3IsStale] = useState(false);
  
  // Cast pipeline to access new step3 tracking fields
  const pipelineExt = pipeline as FloorplanPipeline & { 
    step3_job_id?: string | null; 
    step3_last_backend_event_at?: string | null;
    step3_attempt_count?: number;
  };
  
  // Stall detection effect
  useEffect(() => {
    if (!step3Running) {
      setStep3IsStale(false);
      return;
    }
    
    const checkStale = async () => {
      // First check if we have step3_last_backend_event_at from the pipeline
      if (pipelineExt.step3_last_backend_event_at) {
        const lastEventTime = new Date(pipelineExt.step3_last_backend_event_at).getTime();
        const isStale = Date.now() - lastEventTime > STALL_TIMEOUT_MS;
        setStep3IsStale(isStale);
        if (!isStale) return;
      }
      
      // Also check recent events from the events table
      const { data: events } = await supabase
        .from("floorplan_pipeline_events")
        .select("ts, message, type")
        .eq("pipeline_id", pipeline.id)
        .eq("step_number", 3)
        .order("ts", { ascending: false })
        .limit(1);
      
      if (events && events.length > 0) {
        setStep3LastEvent(events[0]);
        const eventTime = new Date(events[0].ts).getTime();
        setStep3IsStale(Date.now() - eventTime > STALL_TIMEOUT_MS);
      } else if (pipelineExt.step3_last_backend_event_at) {
        const lastEventTime = new Date(pipelineExt.step3_last_backend_event_at).getTime();
        setStep3IsStale(Date.now() - lastEventTime > STALL_TIMEOUT_MS);
      }
    };
    
    checkStale();
    const interval = setInterval(checkStale, 15000); // Check every 15 seconds
    return () => clearInterval(interval);
  }, [step3Running, pipeline.id, pipelineExt.step3_last_backend_event_at]);

  // Create StageReviewAsset objects for steps that have outputs
  // Support both field naming conventions: qa_status/qa_decision, prompt_text/prompt_used
  // Build qaReport from available fields if qa_report is not directly available
  const buildQaReport = (output: Record<string, unknown> | null | undefined) => {
    if (!output) return null;
    // If qa_report exists, use it directly
    if (output.qa_report) return output.qa_report as Record<string, unknown>;
    
    // Build from individual fields - include ALL available QA fields for detailed display
    const qaDecision = (output.qa_decision || output.overall_qa_decision) as string | undefined;
    const qaReason = (output.qa_reason || output.overall_qa_reason) as string | undefined;
    const approvalReasons = output.approval_reasons as string[] | undefined;
    const checksPerformed = output.checks_performed as Array<{check: string; result: string; observation: string}> | undefined;
    const score = output.score as number | undefined;
    const detectedRoomType = output.detected_room_type as string | undefined;
    const spaceTypeDeclared = output.space_type_declared as string | undefined;
    const requestAnalysis = output.request_analysis as string | undefined;
    const issues = output.issues as unknown[] | undefined;
    const structuralIssues = output.structural_issues as unknown[] | undefined;
    
    if (qaDecision || qaReason || approvalReasons || checksPerformed) {
      return {
        decision: qaDecision || null,
        reason: qaReason || null,
        reason_short: qaReason || null,
        request_analysis: requestAnalysis || null,
        approval_reasons: approvalReasons || [],
        checks_performed: checksPerformed || [],
        score: score ?? null,
        detected_room_type: detectedRoomType || null,
        space_type_declared: spaceTypeDeclared || null,
        issues: issues || [],
        structural_issues: structuralIssues || [],
      };
    }
    return null;
  };

  const step1Asset: StageReviewAsset | null = step1UploadId ? {
    id: `step1-${pipeline.id}`,
    uploadId: step1UploadId,
    status: step1Review ? "needs_review" : step1Done ? "approved" : "pending",
    qaStatus: step1Output?.qa_status || step1Output?.qa_decision || (step1Output as Record<string, unknown>)?.overall_qa_decision as string || null,
    qaReport: buildQaReport(step1Output as Record<string, unknown>),
    lockedApproved: step1Done,
    promptText: step1Output?.prompt_text || step1Output?.prompt_used || null,
  } : null;

  const step2Asset: StageReviewAsset | null = step2UploadId ? {
    id: `step2-${pipeline.id}`,
    uploadId: step2UploadId,
    status: step2Review ? "needs_review" : step2Done ? "approved" : "pending",
    qaStatus: step2Output?.qa_status || step2Output?.qa_decision || (step2Output as Record<string, unknown>)?.overall_qa_decision as string || null,
    qaReport: buildQaReport(step2Output as Record<string, unknown>),
    lockedApproved: step2Done,
    promptText: step2Output?.prompt_text || step2Output?.prompt_used || null,
  } : null;

  const renderStepCard = (
    stepNum: number,
    title: string,
    icon: React.ReactNode,
    isPending: boolean,
    isStepRunning: boolean,
    isReview: boolean,
    isDone: boolean,
    outputUploadId: string | undefined,
    onRun: () => void,
    canRun: boolean,
    /** Optional continue action when step is done and ready to advance */
    onContinueAction?: () => void,
    continueLabel?: string
  ) => {
    // Quality policy: Steps 1-3 always use 2K
    const effectiveQuality = stepNum < 4 ? "2K" : ((pipeline as any).quality_post_step4 || "2K");
    const isQualityLocked = stepNum < 4;

    // Determine if we should show Continue button
    // Only show if step is done and onContinueAction is provided
    const showContinue = isDone && onContinueAction && !isStepRunning;
    
    // Show reset button when step has some state (running, has output, or done)
    const showResetButton = isStepRunning || isDone || !!outputUploadId;

    return (
      <div className="space-y-2">
        <div
          className={`
            flex items-center justify-between p-3 rounded-lg border
            ${isDone ? "border-primary/30 bg-primary/5" : "border-border/50 bg-card/50"}
          `}
        >
          <div className="flex items-center gap-3">
            {icon}
            <div>
              <p className="text-sm font-medium">{title}</p>
              <div className="flex items-center gap-2">
                <p className="text-xs text-muted-foreground">Step {stepNum}</p>
                {/* Quality indicator badge */}
                <Badge variant="outline" className="text-xs px-1.5 py-0">
                  {isQualityLocked && <Lock className="w-2.5 h-2.5 mr-0.5" />}
                  {effectiveQuality}
                </Badge>
              </div>
            </div>
          </div>

          {/* Right side actions container - always render, never empty */}
          <div className="flex items-center gap-2 min-w-[100px] justify-end">
            {/* Stop & Reset button for running or completed steps */}
            {showResetButton && onRestartStep && (
              <StopResetStepButton
                stepNumber={stepNum}
                stepName={title}
                isRunning={isStepRunning}
                isPending={false}
                onReset={() => onRestartStep(stepNum)}
                disabled={approvalLocked}
                compact
              />
            )}

            {outputUploadId && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handlePreview(outputUploadId)}
              >
                <Eye className="w-4 h-4" />
              </Button>
            )}

            {/* Continue button when step is done and ready to advance */}
            {showContinue && (
              <Button
                size="sm"
                onClick={() => {
                  onAction("continue", { fromStep: stepNum, toStep: stepNum + 1 });
                  onContinueAction();
                }}
                disabled={isRunning || approvalLocked}
              >
                <ChevronRight className="w-4 h-4 mr-1" />
                {continueLabel || `Continue to Step ${stepNum + 1}`}
              </Button>
            )}

            {/* Done badge when step is complete but not showing Continue */}
            {isDone && !showContinue && (
              <Badge className="bg-primary/20 text-primary">
                <Check className="w-3 h-3 mr-1" />
                Done
              </Badge>
            )}

            {isStepRunning && (
              <Badge className="bg-blue-500/20 text-blue-400">
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                Running
              </Badge>
            )}

            {isPending && canRun && (
              <Button
                size="sm"
                onClick={() => {
                  onAction("generate", { step: stepNum });
                  onRun();
                }}
                disabled={isRunning || approvalLocked}
              >
                <Play className="w-4 h-4 mr-1" />
                Generate
              </Button>
            )}

            {/* Fallback: show Pending state if nothing else applies */}
            {isPending && !canRun && !isStepRunning && !isDone && (
              <Badge variant="outline" className="text-xs text-muted-foreground">
                Waiting
              </Badge>
            )}
          </div>
        </div>
        
        {/* Step Controls Footer (Reset + Back) */}
        <StepControlsFooter
          stepNumber={stepNum}
          stepName={title}
          isRunning={isStepRunning}
          isResetPending={isResetPending}
          isRollbackPending={isRollbackPending}
          onReset={(step) => onRestartStep?.(step)}
          onRollback={stepNum > 0 ? (step) => onRollbackStep?.(step) : undefined}
          disabled={isRunning || approvalLocked}
          hideRollback={stepNum === 0}
        />
      </div>
    );
  };

  return (
    <>
      <div className="space-y-3">
        {/* Step 0: Space Analysis */}
        {(spaceAnalysisPending || spaceAnalysisRunning || spaceAnalysisComplete) && (
          <div className="space-y-2">
            <div className={`flex items-center justify-between p-3 rounded-lg border ${spaceAnalysisComplete ? "border-primary/30 bg-primary/5" : "border-border/50 bg-card/50"}`}>
              <div className="flex items-center gap-3">
                <Eye className="w-5 h-5 text-primary" />
                <div>
                  <p className="text-sm font-medium">Space Analysis</p>
                  <p className="text-xs text-muted-foreground">AI pre-analysis • Step 0</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* Stop & Reset button for running analysis */}
                {spaceAnalysisRunning && onRestartStep && (
                  <StopResetStepButton
                    stepNumber={0}
                    stepName="Space Analysis"
                    isRunning={true}
                    isPending={false}
                    onReset={() => onRestartStep(0)}
                    disabled={false}
                    compact
                  />
                )}
                {spaceAnalysisComplete && (
                  <Badge className="bg-primary/20 text-primary">
                    <Check className="w-3 h-3 mr-1" />
                    Done
                  </Badge>
                )}
                {spaceAnalysisRunning && (
                  <Badge className="bg-purple-500/20 text-purple-400">
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                    Analyzing
                  </Badge>
                )}
                {spaceAnalysisPending && !spaceAnalysisRunning && !spaceAnalysisComplete && (
                  <Button size="sm" onClick={onRunSpaceAnalysis} disabled={isRunning}>
                    <Play className="w-4 h-4 mr-1" />
                    Analyze
                  </Button>
                )}
              </div>
            </div>
            
            {/* Step 0 Controls Footer (Reset only - no rollback for Step 0) */}
            <StepControlsFooter
              stepNumber={0}
              stepName="Space Analysis"
              isRunning={spaceAnalysisRunning}
              isResetPending={isResetPending}
              isRollbackPending={isRollbackPending}
              onReset={(stepNum) => onRestartStep?.(stepNum)}
              disabled={isRunning || approvalLocked}
              hideRollback={true}
            />
          </div>
        )}

        {/* Space Analysis Results Panel */}
        {spaceAnalysis && (
          <SpaceAnalysisPanel 
            analysisData={spaceAnalysis} 
            isLoading={spaceAnalysisRunning} 
          />
        )}

        {/* Space Graph Summary - Shows structured architectural graph */}
        {spaceAnalysisComplete && (
          <SpaceGraphSummary
            spatialMap={spatialMap}
            isLoading={spatialMapLoading}
            error={spatialMapError}
            onRetry={() => runSpatialDecomposition.mutate({ 
              pipelineId: pipeline.id, 
              floorPlanUploadId: pipeline.floor_plan_upload_id 
            })}
          />
        )}

        {/* Step 1: Floor Plan → Top-Down 3D */}
        {spaceAnalysisComplete && !step1Review && !step1Done && renderStepCard(
          1,
          "Floor Plan → Top-Down 3D",
          <MapPin className="w-5 h-5 text-primary" />,
          step1Pending,
          step1Running,
          step1Review,
          step1Done,
          step1UploadId,
          onRunTopDown,
          spaceAnalysisComplete
        )}

        {/* Step 1 QA Retry Status Indicator - show when in qa_fail or blocked state */}
        {(step1QAFail || step1Blocked) && (
          <StepRetryStatusIndicator
            stepNumber={1}
            stepRetryState={step1RetryState}
            pipelineId={pipeline.id}
            onManualApprove={(outputUploadId) => onManualApproveStep?.(1, outputUploadId)}
            onManualReject={() => onManualRejectStep?.(1)}
            onRestartStep={() => onRestartStep?.(1)}
            isProcessing={isRunning}
          />
        )}

        {/* Step 1 Review Panel with Before/After - ALWAYS show when output exists and needs review */}
        {step1Asset && !step1Blocked && (step1Review || step1Done || (manualQAEnabled && step1HasOutput && !step1ManualApproved)) && (
          <div className="space-y-2">
            <StageReviewPanel
              title="Floor Plan → Top-Down 3D"
              stepNumber={1}
              currentStep={currentStep}
              beforeUploadId={pipeline.floor_plan_upload_id}
              beforeLabel="Floor Plan"
              afterAsset={{
                ...step1Asset,
                // Force review status if not manually approved yet and manualQA is on
                status: (manualQAEnabled && !step1ManualApproved && step1UploadId) ? "needs_review" : step1Asset.status,
                lockedApproved: step1ManualApproved,
              }}
              afterLabel="Top-Down 3D"
              onApprove={() => {
                onAction("approve", { step: 1 });
                onApproveStep(1);
              }}
              onReject={(notes) => {
                onAction("reject", { step: 1 });
                onRejectStep(1, notes);
              }}
              onContinue={step1Done ? () => {
                onAction("continue", { fromStep: 1, toStep: 2 });
                onRunStyle();
              } : undefined}
              continueLabel="Continue to Step 2"
              isLoading={isRunning}
              bucket="floor_plans"
            />
            
            {/* Step 1 Controls Footer (Reset + Back to Step 0) */}
            <StepControlsFooter
              stepNumber={1}
              stepName="Floor Plan → Top-Down 3D"
              isRunning={step1Running}
              isResetPending={isResetPending}
              isRollbackPending={isRollbackPending}
              onReset={(stepNum) => onRestartStep?.(stepNum)}
              onRollback={(stepNum) => onRollbackStep?.(stepNum)}
              disabled={isRunning || approvalLocked}
            />
          </div>
        )}

        {/* FALLBACK: Step 1 Continue button when done but no StageReviewPanel visible */}
        {step1Done && !step1Asset && !step1Blocked && !step2Running && !step2Done && currentStep <= 2 && (
          <div className="flex items-center justify-between p-3 rounded-lg border border-primary/30 bg-primary/5">
            <div className="flex items-center gap-3">
              <MapPin className="w-5 h-5 text-primary" />
              <div>
                <p className="text-sm font-medium">Floor Plan → Top-Down 3D</p>
                <p className="text-xs text-muted-foreground">Step 1 • Approved</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge className="bg-primary/20 text-primary">
                <Check className="w-3 h-3 mr-1" />
                Done
              </Badge>
              <Button
                size="sm"
                onClick={() => {
                  onAction("continue", { fromStep: 1, toStep: 2 });
                  onRunStyle();
                }}
                disabled={isRunning}
              >
                <ChevronRight className="w-4 h-4 mr-1" />
                Continue to Step 2
              </Button>
            </div>
          </div>
        )}

        {/* Step 2: Style Top-Down */}
        {/* Show step card when pending/running (not done, not in review) */}
        {!step2Review && !step2Done && step1Done && renderStepCard(
          2,
          "Style Top-Down",
          <Layers className="w-5 h-5 text-primary" />,
          step2Pending,
          step2Running,
          step2Review,
          step2Done,
          step2UploadId,
          onRunStyle,
          step1Done
        )}

        {(step2QAFail || step2Blocked) && (
          <StepRetryStatusIndicator
            stepNumber={2}
            stepRetryState={step2RetryState}
            pipelineId={pipeline.id}
            onManualApprove={(outputUploadId) => onManualApproveStep?.(2, outputUploadId)}
            onManualReject={() => onManualRejectStep?.(2)}
            onRestartStep={() => onRestartStep?.(2)}
            isProcessing={isRunning}
          />
        )}

        {/* Step 2 Review Panel with Before/After - ALWAYS show when output exists and needs review */}
        {step2Asset && !step2Blocked && (step2Review || step2Done || (manualQAEnabled && step2HasOutput && !step2ManualApproved && step1Done)) && (
          <div className="space-y-2">
            <StageReviewPanel
              title="Style Top-Down"
              stepNumber={2}
              currentStep={currentStep}
              beforeUploadId={step1UploadId || null}
              beforeLabel="Unstyled"
              afterAsset={{
                ...step2Asset,
                // Force review status if not manually approved yet and manualQA is on
                status: (manualQAEnabled && !step2ManualApproved && step2UploadId) ? "needs_review" : step2Asset.status,
                lockedApproved: step2ManualApproved,
              }}
              afterLabel="Styled"
              onApprove={() => {
                onAction("approve", { step: 2 });
                onApproveStep(2);
              }}
              onReject={(notes) => {
                onAction("reject", { step: 2 });
                onRejectStep(2, notes);
              }}
              onContinue={step2Done && phase === "style_review" ? () => {
                onAction("continue", { fromStep: 2, toStep: 3 });
                // Trigger phase transition from style_review → detect_spaces_pending (SWAPPED)
                onContinueToStep(2, "style_review");
              } : undefined}
              continueLabel="Continue to Detect Spaces"
              isLoading={isRunning}
              bucket="outputs"
            />
            
            {/* Step 2 Controls Footer (Reset + Back to Step 1) */}
            <StepControlsFooter
              stepNumber={2}
              stepName="Style Top-Down"
              isRunning={step2Running}
              isResetPending={isResetPending}
              isRollbackPending={isRollbackPending}
              onReset={(stepNum) => onRestartStep?.(stepNum)}
              onRollback={(stepNum) => onRollbackStep?.(stepNum)}
              disabled={isRunning || approvalLocked}
            />
          </div>
        )}

        {/* Fallback Step 2 header when done but no StageReviewPanel (e.g., asset data loading) */}
        {step2Done && !step2Asset && !step2Blocked && step1Done && (
          <div className="flex items-center justify-between p-3 rounded-lg border border-primary/30 bg-primary/5">
            <div className="flex items-center gap-3">
              <Layers className="w-5 h-5 text-primary" />
              <div>
                <p className="text-sm font-medium">Style Top-Down</p>
                <div className="flex items-center gap-2">
                  <p className="text-xs text-muted-foreground">Step 2</p>
                  <Badge variant="outline" className="text-xs px-1.5 py-0">
                    <Lock className="w-2.5 h-2.5 mr-0.5" />
                    2K
                  </Badge>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 min-w-[100px] justify-end">
              {/* Show Continue button ONLY if phase is exactly style_review */}
              {phase === "style_review" ? (
                <Button
                  size="sm"
                  onClick={() => {
                    onAction("continue", { fromStep: 2, toStep: 3 });
                    // Trigger phase transition from style_review → detect_spaces_pending (SWAPPED)
                    onContinueToStep(2, "style_review");
                  }}
                  disabled={isRunning || approvalLocked}
                >
                  <ChevronRight className="w-4 h-4 mr-1" />
                  Continue to Detect Spaces
                </Button>
              ) : (
                <Badge className="bg-primary/20 text-primary">
                  <Check className="w-3 h-3 mr-1" />
                  Done
                </Badge>
              )}
            </div>
          </div>
        )}

        {/* Step 3: Detect Spaces (SWAPPED - was Step 4) */}
        {step2Done && (
          <div
            className={cn(
              "p-3 rounded-lg border space-y-2",
              step3Done ? "border-primary/30 bg-primary/5" : "border-border/50 bg-card/50"
            )}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Box className="w-5 h-5 text-primary" />
                <div>
                  <p className="text-sm font-medium">Detect Spaces</p>
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-muted-foreground">Step 3</p>
                    {/* Quality indicator badge */}
                    <Badge variant="outline" className="text-xs px-1.5 py-0">
                      <Lock className="w-2.5 h-2.5 mr-0.5" />
                      2K
                    </Badge>
                    {/* Attempt count badge */}
                    {pipelineExt.step3_attempt_count && pipelineExt.step3_attempt_count > 0 && (
                      <Badge variant="secondary" className="text-xs px-1.5 py-0">
                        Attempt {pipelineExt.step3_attempt_count}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* Stop & Reset button - visible when running or done */}
                {(step3Running || step3Done) && onRestartStep && (
                  <StopResetStepButton
                    stepNumber={3}
                    stepName="Detect Spaces"
                    isRunning={step3Running}
                    isPending={false}
                    onReset={() => onRestartStep(3)}
                    disabled={approvalLocked}
                    compact
                  />
                )}

                {/* DONE STATE */}
                {step3Done && (
                  <Badge className="bg-primary/20 text-primary">
                    <Check className="w-3 h-3 mr-1" />
                    Done
                  </Badge>
                )}

                {/* RUNNING (NOT STALE) */}
                {step3Running && !step3IsStale && (
                  <Badge className="bg-blue-500/20 text-blue-400">
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                    Running
                  </Badge>
                )}

                {/* STALLED STATE: Show warning + Try Again */}
                {step3Running && step3IsStale && (
                  <>
                    <Badge className="bg-warning/20 text-warning">
                      <AlertTriangle className="w-3 h-3 mr-1" />
                      Stalled
                    </Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={onRetryDetectSpaces}
                      disabled={isRetryingStep4}
                      className="border-warning text-warning hover:bg-warning/10"
                    >
                      {isRetryingStep4 ? (
                        <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                      ) : (
                        <RefreshCw className="w-4 h-4 mr-1" />
                      )}
                      Try Again
                    </Button>
                  </>
                )}

                {/* FAILED STATE: Show Retry */}
                {step3Failed && !step3Running && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={onRetryDetectSpaces}
                    disabled={isRetryingStep4}
                    className="border-destructive text-destructive hover:bg-destructive/10"
                  >
                    {isRetryingStep4 ? (
                      <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                    ) : (
                      <RefreshCw className="w-4 h-4 mr-1" />
                    )}
                    Retry
                  </Button>
                )}

                {/* PENDING STATE: Normal Generate button */}
                {step3Pending && !step3Running && !step3Failed && (
                  <Button 
                    size="sm" 
                    onClick={() => {
                      onAction("generate", { step: 3 });
                      onRunDetectSpaces();
                    }} 
                    disabled={isRunning || approvalLocked}
                  >
                    <Play className="w-4 h-4 mr-1" />
                    Detect Spaces
                  </Button>
                )}
              </div>
            </div>

            {/* Backend Activity Indicator for Step 3 */}
            {step3Running && (
              <div className="flex items-center gap-2 text-xs px-2 py-1.5 bg-muted/30 rounded-md">
                {step3IsStale ? (
                  <>
                    <AlertTriangle className="w-3 h-3 text-warning" />
                    <span className="text-warning">No backend activity for 2+ minutes</span>
                  </>
                ) : step3LastEvent ? (
                  <>
                    <Clock className="w-3 h-3 text-muted-foreground" />
                    <span className="text-muted-foreground truncate">{step3LastEvent.message}</span>
                    <span className="text-muted-foreground/60 ml-auto">
                      {formatDistanceToNow(new Date(step3LastEvent.ts), { addSuffix: true })}
                    </span>
                  </>
                ) : (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
                    <span className="text-muted-foreground">Waiting for backend...</span>
                  </>
                )}
              </div>
            )}

            {/* Error Display */}
            {step3Failed && pipeline.last_error && (
              <div className="flex items-center gap-2 text-xs px-2 py-1.5 bg-destructive/10 text-destructive rounded-md">
                <AlertTriangle className="w-3 h-3 shrink-0" />
                <span className="truncate">{pipeline.last_error}</span>
              </div>
            )}
            
            {/* Step Controls Footer (Reset + Back) */}
            <StepControlsFooter
              stepNumber={3}
              stepName="Detect Spaces"
              isRunning={step3Running}
              isResetPending={isResetPending}
              isRollbackPending={isRollbackPending}
              onReset={(stepNum) => onRestartStep?.(stepNum)}
              onRollback={(stepNum) => onRollbackStep?.(stepNum)}
              disabled={isRunning || approvalLocked}
            />
          </div>
        )}

        {/* Step 4: Camera Planning (SWAPPED - was Step 3) */}
        {/* Camera Planning is EDITABLE until renders actually START (phase >= renders_pending/renders_in_progress)
            "camera_plan_confirmed" = approved, but still editable.
            Locked only when PHASE_STEP_MAP[phase] >= 5 (renders or later) */}
        {step3Done && (() => {
          // COMMIT LOGIC: Camera Planning locks only after renders have started
          // camera_plan_confirmed = approved but still editable
          // renders_pending/renders_in_progress/renders_review = locked (committed)
          const isCameraCommitted = PHASE_STEP_MAP[phase] >= 5;
          const isCameraApproved = phase === "camera_plan_confirmed";
          
          return (
            <div className="space-y-3">
              <div className={cn(
                "p-3 rounded-lg border",
                isCameraCommitted
                  ? "border-primary/30 bg-primary/5"
                  : isCameraApproved
                    ? "border-green-500/30 bg-green-500/5"
                    : "border-border/50 bg-card/50"
              )}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Camera className="w-5 h-5 text-primary" />
                    <div>
                      <p className="text-sm font-medium">Camera Planning</p>
                      <div className="flex items-center gap-2">
                        <p className="text-xs text-muted-foreground">Step 4</p>
                        {isCameraApproved && !isCameraCommitted && (
                          <span className="text-xs text-green-600">(Approved — still editable)</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Stop & Reset button for Camera Planning - visible when approved or committed */}
                    {(isCameraApproved || isCameraCommitted) && onRestartStep && (
                      <StopResetStepButton
                        stepNumber={4}
                        stepName="Camera Planning"
                        isRunning={false}
                        isPending={false}
                        onReset={() => onRestartStep(4)}
                        disabled={approvalLocked}
                        compact
                      />
                    )}
                    {/* Show Open button when NOT committed (including approved state) */}
                    {!isCameraCommitted && step2UploadId && (
                      <Button
                        variant={isCameraApproved ? "outline" : "default"}
                        size="sm"
                        onClick={() => setCameraPlanningOpen(true)}
                        disabled={isRunning || approvalLocked}
                      >
                        <Camera className="w-4 h-4 mr-2" />
                        {isCameraApproved ? "Edit Camera Plan" : "Open Camera Planning"}
                      </Button>
                    )}
                    {/* Draft badge - shown when not yet approved */}
                    {!isCameraApproved && !isCameraCommitted && (
                      <Badge variant="outline" className="border-amber-500/50 text-amber-600">
                        <Clock className="w-3 h-3 mr-1" />
                        Draft
                      </Badge>
                    )}
                    {isCameraApproved && !isCameraCommitted && (
                      <Badge className="bg-green-500/20 text-green-600">
                        <Check className="w-3 h-3 mr-1" />
                        Approved
                      </Badge>
                    )}
                    {isCameraCommitted && (
                      <Badge className="bg-primary/20 text-primary">
                        <Lock className="w-3 h-3 mr-1" />
                        Locked
                      </Badge>
                    )}
                  </div>
                </div>
              </div>

              {/* Camera Planning Editor Modal - renders as fullscreen overlay */}
              {/* Only allow editing when not committed (renders not started) */}
              {cameraPlanningOpen && step2UploadId && !isCameraCommitted && (
                <CameraPlanningEditor
                  pipelineId={pipeline.id}
                  step2UploadId={step2UploadId}
                  onConfirm={() => {
                    onConfirmCameraPlan();
                    setCameraPlanningOpen(false);
                  }}
                  onClose={() => setCameraPlanningOpen(false)}
                  isConfirming={isConfirmingCameraPlan}
                  disabled={isRunning || approvalLocked}
                  isApproved={isCameraApproved}
                />
              )}
              
              {/* Step Controls Footer (Reset + Back) */}
              <StepControlsFooter
                stepNumber={4}
                stepName="Camera Planning"
                isRunning={false}
                isResetPending={isResetPending}
                isRollbackPending={isRollbackPending}
                onReset={(stepNum) => onRestartStep?.(stepNum)}
                onRollback={(stepNum) => onRollbackStep?.(stepNum)}
                disabled={isRunning || approvalLocked}
              />
            </div>
          );
        })()}
      </div>

      {/* Preview Dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Preview</DialogTitle>
          </DialogHeader>
          {previewUrl && (
            <img
              src={previewUrl}
              alt="Step output preview"
              className="w-full h-auto rounded-lg"
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Step Output</DialogTitle>
            <DialogDescription>
              Provide feedback for why this output is being rejected.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Enter rejection reason..."
            value={rejectNotes}
            onChange={(e) => setRejectNotes(e.target.value)}
            className="min-h-[100px]"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmReject}>
              Confirm Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ============= Main Component =============
export const WholeApartmentPipelineCard = memo(function WholeApartmentPipelineCard({
  pipeline,
  imagePreviews,
  onUpdatePipeline,
}: WholeApartmentPipelineCardProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { manualQAEnabled } = useManualQA();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [globalStepsExpanded, setGlobalStepsExpanded] = useState(true);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [restartDialogOpen, setRestartDialogOpen] = useState(false);
  const [lastAction, setLastAction] = useState<{ type: string; ts: number; meta?: Record<string, unknown> } | null>(null);
  // Step 7 Quality UI Gate - 4K toggle only appears for merge step
  const [step7SettingsOpen, setStep7SettingsOpen] = useState(false);
  // Per-space render control: track which space is currently being rendered
  const [renderingSpaceId, setRenderingSpaceId] = useState<string | null>(null);

  const {
    spaces: pipelineSpaces,
    isLoadingSpaces,
    progress,
    progressDetails,
    runSpaceAnalysis,
    runTopDown3D,
    runStyleTopDown,
    runDetectSpaces,
    retryDetectSpaces,
    runSpaceRender,
    runSpacePanorama,
    runMerge360,
    // Batch mutations
    advancePipeline,
    runBatchRenders,
    runBatchPanoramas,
    runBatchMerges,
    // Approval mutations
    approveRender,
    rejectRender,
    retryRender,
    approvePanorama,
    rejectPanorama,
    retryPanorama,
    approveFinal360,
    rejectFinal360,
    retryFinal360,
    deletePipeline,
    restartPipeline,
    togglePipelineEnabled,
    excludeSpace,
    restoreSpace,
    // Step 1-3 retry management
    manualApproveAfterRetryExhaustion,
    rejectAfterRetryExhaustion,
    restartStep,
    rollbackToPreviousStep,
    // Phase transition mutation
    continueToStep,
    // Per-space render control
    runSingleSpaceRenders,
    updateSpaceReferences,
  } = useWholeApartmentPipeline(pipeline.id);

  // Camera markers hook for Step 3: Camera Planning
  const { 
    confirmCameraPlan, 
    markers: cameraMarkers, 
    isLoading: markersLoading,
    isConfirming: isConfirmingCameraPlanHook 
  } = useCameraMarkers(pipeline.id);

  // Available reference images for per-space selection (Step 4+ approved outputs)
  const { data: availableReferenceImages = [] } = useAvailableReferenceImages(pipeline.id);

  const spaces = pipelineSpaces || [];

  // Realtime subscription for pipeline changes (phase, step, step_outputs)
  // to immediately reflect approval/rejection without manual refresh
  const pipelineSubRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  
  useEffect(() => {
    if (!pipeline.id) return;

    // Cleanup existing subscription
    if (pipelineSubRef.current) {
      pipelineSubRef.current.unsubscribe();
    }

    const channel = supabase
      .channel(`wa-pipeline-${pipeline.id}`)
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "floorplan_pipelines",
        filter: `id=eq.${pipeline.id}`,
      }, () => {
        // Immediately invalidate pipeline cache to pick up latest phase/step
        // Reduced delay for faster UI updates after approval
        queryClient.invalidateQueries({ queryKey: ["floorplan-pipelines", pipeline.project_id] });
        queryClient.invalidateQueries({ queryKey: ["floorplan-pipelines"] });
        // Also refetch after short delay to ensure consistency
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ["floorplan-pipelines", pipeline.project_id] });
        }, 100);
      })
      .subscribe();

    pipelineSubRef.current = channel;

    return () => {
      channel.unsubscribe();
    };
  }, [pipeline.id, pipeline.project_id, queryClient]);
  
  const phase = pipeline.whole_apartment_phase || "upload";
  const currentStep = PHASE_STEP_MAP[phase] || 0;

  // Get styled image upload ID for renders - support both upload_id and output_upload_id
  const stepOutputs = (pipeline.step_outputs || {}) as Record<string, { upload_id?: string; output_upload_id?: string }>;
  const step2Out = stepOutputs["step2"] || stepOutputs["2"];
  const styledImageUploadId = step2Out?.upload_id || step2Out?.output_upload_id || null;

  const onAction = useCallback(
    (type: "generate" | "approve" | "reject" | "continue", meta?: Record<string, unknown>) => {
      setLastAction({ type, ts: Date.now(), meta });
    },
    []
  );

  const isAnyMutationPending =
    runSpaceAnalysis.isPending ||
    runTopDown3D.isPending ||
    runStyleTopDown.isPending ||
    runDetectSpaces.isPending ||
    runSpaceRender.isPending ||
    runSpacePanorama.isPending ||
    runMerge360.isPending ||
    advancePipeline.isPending ||
    runBatchRenders.isPending ||
    runBatchPanoramas.isPending ||
    runBatchMerges.isPending ||
    restartStep.isPending ||
    rollbackToPreviousStep.isPending ||
    runSingleSpaceRenders.isPending;

  // Handler for space analysis
  const handleRunSpaceAnalysis = useCallback(() => {
    runSpaceAnalysis.mutate({ pipelineId: pipeline.id });
  }, [runSpaceAnalysis, pipeline.id]);

  // Handlers for global steps
  const handleRunTopDown = useCallback(() => {
    runTopDown3D.mutate({ pipelineId: pipeline.id });
  }, [runTopDown3D, pipeline.id]);

  const handleRunStyle = useCallback(() => {
    runStyleTopDown.mutate({ pipelineId: pipeline.id });
  }, [runStyleTopDown, pipeline.id]);

  const handleRunDetectSpaces = useCallback(() => {
    if (!styledImageUploadId) {
      toast({
        title: "Cannot detect spaces",
        description: "Styled top-down image is required first.",
        variant: "destructive",
      });
      return;
    }
    runDetectSpaces.mutate(
      { pipelineId: pipeline.id, styledImageUploadId },
      {
        onSuccess: (data) => {
          // Handle idempotent case: spaces already exist
          if (data?._feedbackType === "already_existed") {
            const activeCount = data?.active_count ?? data?.spaces_count ?? spaces.length;
            const excludedCount = data?.excluded_count ?? 0;
            toast({
              title: "Step 3 complete",
              description: excludedCount > 0 
                ? `${activeCount} active spaces ready (${excludedCount} excluded)`
                : `${activeCount} spaces detected - ready for renders`,
            });
          } else if (data?._feedbackType === "already_running") {
            toast({
              title: "Step 3 already running",
              description: "Please wait for the current operation to complete.",
            });
          }
          // Success case shows in UI via phase change - no toast needed
        },
        onError: (error) => {
          toast({
            title: "Space detection failed",
            description: error instanceof Error ? error.message : "Unknown error",
            variant: "destructive",
          });
        },
      }
    );
  }, [runDetectSpaces, pipeline.id, styledImageUploadId, toast, spaces.length]);

  // Retry Step 3 handler (safe, idempotent)
  const handleRetryDetectSpaces = useCallback(() => {
    retryDetectSpaces.mutate(
      { pipelineId: pipeline.id },
      {
        onSuccess: (data) => {
          if (data?.already_running) {
            toast({
              title: "Step 3 already running",
              description: "Please wait for the current operation to complete.",
            });
          } else {
            toast({
              title: "Step 3 restarted",
              description: "Space detection is running again.",
            });
          }
        },
        onError: (error) => {
          toast({
            title: "Retry failed",
            description: error instanceof Error ? error.message : "Unknown error",
            variant: "destructive",
          });
        },
      }
    );
  }, [retryDetectSpaces, pipeline.id, toast]);

  const handleApproveGlobalStep = useCallback(async (step: number) => {
    // Persist manual approval + unlock next step.
    const nextPhaseMap: Record<number, string> = {
      1: "style_pending",
      2: "detect_spaces_pending",
    };
    const nextPhase = nextPhaseMap[step];

    // Keep numeric current_step in sync for deterministic UI and refresh behavior.
    // Whole-apartment global steps are 1-indexed here (Step 1 -> current_step 2 after approval, etc.)
    const nextCurrentStep = step + 1;

    const currentStepKey = step === 1 ? "step1" : "step2";
    const stepOutputs = (pipeline.step_outputs || {}) as Record<string, any>;
    const existing = (stepOutputs[currentStepKey] || stepOutputs[String(step)] || {}) as Record<string, any>;

    const updatedStepOutputs = {
      ...stepOutputs,
      [currentStepKey]: {
        ...existing,
        manual_approved: true,
        manual_approved_at: new Date().toISOString(),
        manual_rejected: false,
        manual_rejected_at: null,
      },
    };

    const { error } = await supabase
      .from("floorplan_pipelines")
      .update({
        step_outputs: updatedStepOutputs,
        ...(nextPhase
          ? {
              whole_apartment_phase: nextPhase,
              current_step: nextCurrentStep,
              updated_at: new Date().toISOString(),
            }
          : {
              current_step: nextCurrentStep,
              updated_at: new Date().toISOString(),
            }),
      })
      .eq("id", pipeline.id);

    if (error) {
      toast({ title: "Approval failed", description: error.message, variant: "destructive" });
      return;
    }

    // Optimistically update the pipelines list cache so the stepper + CTA flip immediately.
    // Source of truth remains the backend (we refetch right after), but this prevents UI from
    // appearing stuck while the query refreshes.
    queryClient.setQueryData(
      ["floorplan-pipelines", pipeline.project_id],
      (old: any) => {
        if (!Array.isArray(old)) return old;
        return old.map((p: any) =>
          p.id === pipeline.id
            ? {
                ...p,
                step_outputs: updatedStepOutputs,
                whole_apartment_phase: nextPhase ?? p.whole_apartment_phase,
                current_step: nextCurrentStep,
                updated_at: new Date().toISOString(),
              }
            : p
        );
      }
    );

    onUpdatePipeline?.();
  }, [pipeline.id, pipeline.project_id, pipeline.step_outputs, onUpdatePipeline, toast, queryClient]);

  const handleRejectGlobalStep = useCallback(async (step: number, notes: string) => {
    // Persist manual rejection + reset phase to rerun.
    const resetPhaseMap: Record<number, string> = {
      1: "top_down_3d_pending",
      2: "style_pending",
    };
    const resetPhase = resetPhaseMap[step];
    const runningPhaseMap: Record<number, string> = {
      1: "top_down_3d_running",
      2: "style_running",
    };

    const currentStepKey = step === 1 ? "step1" : "step2";
    const stepOutputs = (pipeline.step_outputs || {}) as Record<string, any>;
    const existing = (stepOutputs[currentStepKey] || stepOutputs[String(step)] || {}) as Record<string, any>;
    
    // Get the old output upload ID so we can delete it
    const oldOutputUploadId = existing?.output_upload_id || existing?.upload_id;
    
    // Get QA info for learning feedback
    const qaDecision = existing?.qa_decision || existing?.qa_status || "approved";
    const qaReasons = existing?.qa_report?.reasons || existing?.qa_reasons || [];
    const attemptNumber = existing?.attempt_index || existing?.attempt_number || 1;

    // CRITICAL: Store rejection as QA feedback for learning
    // This teaches the QA system that it was wrong to approve this output
    try {
      console.log(`[handleRejectGlobalStep] Saving QA learning feedback for step ${step}`);
      await supabase.functions.invoke("store-qa-attempt-feedback", {
        body: {
          projectId: pipeline.project_id,
          pipelineId: pipeline.id,
          stepId: step,
          attemptNumber: attemptNumber,
          imageId: oldOutputUploadId || null,
          qaDecision: qaDecision === "rejected" ? "rejected" : "approved",
          qaReasons: qaReasons,
          userVote: "dislike", // User disagrees with QA approval
          userCategory: "other", // Default category for rejections
          userCommentShort: notes.slice(0, 200),
          contextSnapshot: {
            step_outputs: existing,
            rejection_source: "manual_reject_button",
            rejected_at: new Date().toISOString(),
          },
        },
      });
      console.log(`[handleRejectGlobalStep] QA learning feedback saved`);
    } catch (feedbackErr) {
      // Don't block rejection if feedback fails
      console.warn(`[handleRejectGlobalStep] Failed to save QA feedback:`, feedbackErr);
    }

    // CRITICAL: Clear the old output from step_outputs so a new generation can start fresh
    // Archive the rejected output info for history but remove the live output reference
    const rejectionHistory = existing?.rejection_history || [];
    rejectionHistory.push({
      output_upload_id: oldOutputUploadId,
      reason: notes,
      rejected_at: new Date().toISOString(),
    });

    const updatedStepOutputs = {
      ...stepOutputs,
      [currentStepKey]: {
        // Clear the output references - this is critical for re-generation
        output_upload_id: null,
        upload_id: null,
        qa_status: null,
        qa_decision: null,
        qa_report: null,
        prompt_used: null,
        // Track rejection metadata
        manual_approved: false,
        manual_approved_at: null,
        manual_rejected: true,
        manual_rejected_at: new Date().toISOString(),
        manual_reject_notes: notes,
        rejection_history: rejectionHistory,
      },
    };

    // Step 1: Delete the old output image from uploads table (cascades to storage)
    if (oldOutputUploadId) {
      console.log(`[handleRejectGlobalStep] Deleting old output: ${oldOutputUploadId}`);
      const { error: deleteError } = await supabase
        .from("uploads")
        .delete()
        .eq("id", oldOutputUploadId);
      
      if (deleteError) {
        console.warn(`[handleRejectGlobalStep] Failed to delete old output: ${deleteError.message}`);
        // Continue anyway - the output will be orphaned but generation can proceed
      }
    }

    // Step 2: Update pipeline to reset phase and clear outputs
    const { error } = await supabase
      .from("floorplan_pipelines")
      .update({
        whole_apartment_phase: resetPhase,
        last_error: null, // Clear error - we're starting fresh
        step_outputs: updatedStepOutputs,
        updated_at: new Date().toISOString(),
      })
      .eq("id", pipeline.id);

    if (error) {
      toast({ title: "Rejection failed", description: error.message, variant: "destructive" });
      return;
    }

    // Keep UI in sync immediately - show as pending
    queryClient.setQueryData(
      ["floorplan-pipelines", pipeline.project_id],
      (old: any) => {
        if (!Array.isArray(old)) return old;
        return old.map((p: any) =>
          p.id === pipeline.id
            ? {
                ...p,
                step_outputs: updatedStepOutputs,
                whole_apartment_phase: resetPhase ?? p.whole_apartment_phase,
                last_error: null,
                updated_at: new Date().toISOString(),
              }
            : p
        );
      }
    );

    toast({ 
      title: "Step rejected", 
      description: `Starting new generation for Step ${step}...` 
    });

    // Step 3: Auto-trigger the re-generation
    try {
      console.log(`[handleRejectGlobalStep] Triggering re-run for step ${step}`);
      const { data, error: runError } = await supabase.functions.invoke("run-pipeline-step", {
        body: {
          pipeline_id: pipeline.id,
          step_number: step,
          is_retry: true,
          rejection_notes: notes,
        },
      });

      if (runError) {
        console.error(`[handleRejectGlobalStep] Re-run failed:`, runError);
        toast({ 
          title: "Re-generation failed", 
          description: runError.message, 
          variant: "destructive" 
        });
      } else {
        console.log(`[handleRejectGlobalStep] Re-run triggered successfully:`, data);
        // Update UI to show running state
        queryClient.setQueryData(
          ["floorplan-pipelines", pipeline.project_id],
          (old: any) => {
            if (!Array.isArray(old)) return old;
            return old.map((p: any) =>
              p.id === pipeline.id
                ? {
                    ...p,
                    whole_apartment_phase: runningPhaseMap[step] ?? p.whole_apartment_phase,
                    updated_at: new Date().toISOString(),
                  }
                : p
            );
          }
        );
      }
    } catch (err) {
      console.error(`[handleRejectGlobalStep] Re-run exception:`, err);
      toast({ 
        title: "Re-generation failed", 
        description: err instanceof Error ? err.message : "Unknown error", 
        variant: "destructive" 
      });
    }

    onUpdatePipeline?.();
  }, [pipeline.id, pipeline.project_id, pipeline.step_outputs, onUpdatePipeline, toast, queryClient]);

  const handleUpdateSettings = useCallback(async (ratio: string, quality: string) => {
    await supabase
      .from("floorplan_pipelines")
      .update({ aspect_ratio: ratio, output_resolution: quality })
      .eq("id", pipeline.id);
    onUpdatePipeline?.();
    toast({ title: "Settings saved", description: `Ratio: ${ratio}, Quality: ${quality}` });
  }, [pipeline.id, onUpdatePipeline, toast]);

  // Handle design reference updates - persist to step_outputs.design_reference_ids
  const handleDesignReferencesChange = useCallback(async (refIds: string[]) => {
    const currentStepOutputs = (pipeline.step_outputs || {}) as Record<string, unknown>;
    const updatedStepOutputs = {
      ...currentStepOutputs,
      design_reference_ids: refIds,
    };

    const { error } = await supabase
      .from("floorplan_pipelines")
      .update({
        step_outputs: updatedStepOutputs,
        updated_at: new Date().toISOString(),
      })
      .eq("id", pipeline.id);

    if (error) {
      toast({ title: "Failed to save references", description: error.message, variant: "destructive" });
      return;
    }

    // Optimistically update cache
    queryClient.setQueryData(
      ["floorplan-pipelines", pipeline.project_id],
      (old: any) => {
        if (!Array.isArray(old)) return old;
        return old.map((p: any) =>
          p.id === pipeline.id
            ? { ...p, step_outputs: updatedStepOutputs, updated_at: new Date().toISOString() }
            : p
        );
      }
    );

    onUpdatePipeline?.();
  }, [pipeline.id, pipeline.project_id, pipeline.step_outputs, onUpdatePipeline, toast, queryClient]);

  // Space action handlers
  const handleRunRender = useCallback(
    (renderId: string) => {
      if (!styledImageUploadId) return;
      runSpaceRender.mutate({ renderId, styledImageUploadId });
    },
    [runSpaceRender, styledImageUploadId]
  );

  const handleRunPanorama = useCallback(
    (panoramaId: string, sourceRenderId: string) => {
      runSpacePanorama.mutate({ panoramaId, sourceRenderId });
    },
    [runSpacePanorama]
  );

  const handleRunMerge = useCallback(
    (final360Id: string, panoAId: string, panoBId: string) => {
      runMerge360.mutate({ final360Id, panoramaAId: panoAId, panoramaBId: panoBId });
    },
    [runMerge360]
  );

  const handleRetryRender = useCallback(
    (renderId: string) => {
      if (!styledImageUploadId) return;
      retryRender.mutate({ renderId, styledImageUploadId });
    },
    [retryRender, styledImageUploadId]
  );

  const handleRetryPanorama = useCallback(
    (panoramaId: string) => {
      // retryPanorama mutation handles fetching the source render internally
      retryPanorama.mutate({ panoramaId });
    },
    [retryPanorama, spaces]
  );

  const handleRetryFinal360 = useCallback(
    (final360Id: string) => {
      // retryFinal360 mutation handles fetching the panorama IDs internally
      retryFinal360.mutate({ final360Id });
    },
    [retryFinal360]
  );

  // Delete pipeline handler
  const handleDeletePipeline = useCallback(() => {
    deletePipeline.mutate(
      { pipelineId: pipeline.id },
      {
        onSuccess: () => {
          toast({ title: "Pipeline deleted", description: "All associated data has been removed." });
          setDeleteDialogOpen(false);
          onUpdatePipeline?.();
        },
        onError: (error) => {
          toast({
            title: "Delete failed",
            description: error instanceof Error ? error.message : "Could not delete pipeline",
            variant: "destructive",
          });
        },
      }
    );
  }, [deletePipeline, pipeline.id, toast, onUpdatePipeline]);

  // Restart pipeline handler
  const handleRestartPipeline = useCallback(() => {
    restartPipeline.mutate(
      { pipelineId: pipeline.id },
      {
        onSuccess: () => {
          toast({ title: "Pipeline restarted", description: "All outputs cleared. Ready to start fresh." });
          setRestartDialogOpen(false);
          onUpdatePipeline?.();
        },
        onError: (error) => {
          toast({
            title: "Restart failed",
            description: error instanceof Error ? error.message : "Could not restart pipeline",
            variant: "destructive",
          });
        },
      }
    );
  }, [restartPipeline, pipeline.id, toast, onUpdatePipeline]);

  const showSpacesSection = currentStep >= 3 || spaces.length > 0;

  // Determine if running
  const isRunning = phase.includes("running") || phase === "detecting_spaces" || phase.includes("in_progress");

  // Outputs pending approval (global + per-space)
  const stepOutputsAll = (pipeline.step_outputs || {}) as Record<string, any>;
  const s1 = stepOutputsAll["step1"] || stepOutputsAll["1"];
  const s2 = stepOutputsAll["step2"] || stepOutputsAll["2"];
  const step1PendingApproval = !!manualQAEnabled && !!(s1?.upload_id || s1?.output_upload_id) && !s1?.manual_approved && (phase === "top_down_3d_review");
  const step2PendingApproval = !!manualQAEnabled && !!(s2?.upload_id || s2?.output_upload_id) && !s2?.manual_approved && (phase === "style_review");
  const spacePendingApprovalCount = manualQAEnabled
    ? (spaces || []).reduce((sum, sp) => {
        const rA = sp.renders?.find(r => r.kind === "A");
        const rB = sp.renders?.find(r => r.kind === "B");
        const pA = sp.panoramas?.find(p => p.kind === "A");
        const pB = sp.panoramas?.find(p => p.kind === "B");
        const f = sp.final360;
        const isNeeds = (a: any) => a && a.status === "needs_review" && !a.locked_approved;
        return sum + (isNeeds(rA) ? 1 : 0) + (isNeeds(rB) ? 1 : 0) + (isNeeds(pA) ? 1 : 0) + (isNeeds(pB) ? 1 : 0) + (isNeeds(f) ? 1 : 0);
      }, 0)
    : 0;
  const outputsPendingApproval = (step1PendingApproval ? 1 : 0) + (step2PendingApproval ? 1 : 0) + spacePendingApprovalCount;
  const approvalLocked = outputsPendingApproval > 0;

  return (
    <>
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Box className="w-5 h-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  Whole Apartment Pipeline
                  <Badge className={PHASE_COLORS[phase] || PHASE_COLORS.upload}>
                    {phase.replace(/_/g, " ")}
                  </Badge>
                  {isRunning && (
                    <Loader2 className="w-4 h-4 animate-spin text-primary" />
                  )}
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {progressDetails?.totalSpaces 
                    ? `${progressDetails.completedSpaces}/${progressDetails.totalSpaces} spaces completed`
                    : `${spaces.length} spaces detected`
                  } • {progress}% complete
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Pipeline ON/OFF Toggle */}
              <PipelineToggle
                isEnabled={pipeline.is_enabled ?? true}
                runState={pipeline.run_state ?? "active"}
                isPending={togglePipelineEnabled?.isPending}
                onToggle={(enabled, reason) => {
                  togglePipelineEnabled?.mutate({
                    pipelineId: pipeline.id,
                    enabled,
                    pauseReason: reason,
                  });
                }}
                compact
              />

              <ManualQAToggle />
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSettingsOpen(true)}
              >
                <Settings2 className="w-4 h-4 mr-1" />
                Settings
              </Button>

              {/* Kebab menu for pipeline actions */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                    <MoreVertical className="h-4 w-4" />
                    <span className="sr-only">Open menu</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem 
                    onClick={() => setTerminalOpen(!terminalOpen)}
                  >
                    <Terminal className="w-4 h-4 mr-2" />
                    {terminalOpen ? "Hide Logs" : "Show Logs"}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem 
                    onClick={() => setRestartDialogOpen(true)}
                    disabled={isRunning || restartPipeline.isPending}
                  >
                    <RotateCcw className="w-4 h-4 mr-2" />
                    Start Over
                  </DropdownMenuItem>
                  <DropdownMenuItem 
                    onClick={() => setDeleteDialogOpen(true)}
                    className="text-destructive focus:text-destructive"
                    disabled={deletePipeline.isPending}
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Delete Pipeline
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Enhanced 6-Stage Progress Section */}
          <div className="mt-3">
            <PipelineProgressBar
              phase={phase}
              currentStep={currentStep}
              step1Approved={!!(s1?.manual_approved)}
              step2Approved={!!(s2?.manual_approved)}
              step3Complete={(progressDetails?.totalSpaces ?? 0) > 0}
              spacesCount={progressDetails?.totalSpaces ?? 0}
              rendersApproved={progressDetails?.rendersCompleted || 0}
              panoramasApproved={progressDetails?.panoramasCompleted || 0}
              final360sApproved={progressDetails?.final360sCompleted || 0}
            />
          </div>

          {/* Step indicator */}
          <GlobalStepIndicator currentStep={currentStep} />
        </CardHeader>

      <CardContent className="space-y-4">
        {/* Persistent Source Floor Plan Viewer - syncs to Step 3 output when available */}
        <SourcePlanViewer
          floorPlanUploadId={pipeline.floor_plan_upload_id}
          styledOutputUploadId={styledImageUploadId}
          bucket="panoramas"
          analysisData={{
            dimension_analysis: (stepOutputs as Record<string, unknown>)?.dimension_analysis as {
              dimensions_found: boolean;
              units?: string;
              key_dimensions?: string[];
            } | undefined,
            geometry_analysis: (stepOutputs as Record<string, unknown>)?.geometry_analysis as {
              has_non_orthogonal_walls: boolean;
              has_curved_walls: boolean;
              geometry_notes?: string;
            } | undefined,
          }}
        />

        {/* Design Reference Upload - visible before Step 2 completes, collapsed after start */}
        <PipelineDesignReferenceUploader
          pipelineId={pipeline.id}
          projectId={pipeline.project_id}
          existingRefIds={((stepOutputs as Record<string, unknown>)?.design_reference_ids as string[]) || []}
          onReferencesChange={handleDesignReferencesChange}
          isLocked={currentStep >= 3} // Lock after Step 2 (style) completes
          hasStarted={currentStep >= 1 || phase !== "upload"} // Collapse after pipeline has started
          currentStep={currentStep}
          currentPhase={phase}
        />

        {/* Design Reference Debug Panel - shows style analysis status */}
        <ReferenceStyleDebugPanel
          pipelineId={pipeline.id}
          projectId={pipeline.project_id}
          designRefIds={((stepOutputs as Record<string, unknown>)?.design_reference_ids as string[]) || []}
          referenceStyleAnalysis={(stepOutputs as Record<string, unknown>)?.reference_style_analysis as any}
          currentPhase={phase}
          currentStep={currentStep}
        />

        {/* Global Steps Section (1-3) */}
        <Collapsible open={globalStepsExpanded} onOpenChange={setGlobalStepsExpanded}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between h-auto py-2">
              <span className="text-sm font-medium">Global Steps (1-3)</span>
              <ChevronDown
                className={`w-4 h-4 transition-transform ${
                  globalStepsExpanded ? "rotate-180" : ""
                }`}
              />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2 space-y-2">
            <GlobalStepsSection
              pipeline={pipeline}
              imagePreviews={imagePreviews}
              onRunSpaceAnalysis={handleRunSpaceAnalysis}
              onRunTopDown={handleRunTopDown}
              onRunStyle={handleRunStyle}
              onConfirmCameraPlan={() => confirmCameraPlan.mutate()}
              onRunDetectSpaces={handleRunDetectSpaces}
              onRetryDetectSpaces={handleRetryDetectSpaces}
              onApproveStep={handleApproveGlobalStep}
              onRejectStep={handleRejectGlobalStep}
              isRunning={isAnyMutationPending}
              isRetryingStep4={retryDetectSpaces.isPending}
              isConfirmingCameraPlan={isConfirmingCameraPlanHook}
              manualQAEnabled={manualQAEnabled}
              approvalLocked={approvalLocked}
              onAction={onAction}
              currentStep={currentStep}
              stepRetryState={(pipeline as any).step_retry_state as Record<string, StepRetryState> | undefined}
              onManualApproveStep={async (stepNumber, outputUploadId) => {
                try {
                  await manualApproveAfterRetryExhaustion.mutateAsync({
                    pipelineId: pipeline.id,
                    stepNumber,
                    outputUploadId,
                  });
                  toast({
                    title: "Approved manually",
                    description: `Step ${stepNumber} approved. Step ${stepNumber + 1} is now unlocked.`,
                  });
                } catch (err) {
                  const message = err instanceof Error ? err.message : "Manual approval failed";
                  toast({
                    title: "Manual approval failed",
                    description: message,
                    variant: "destructive",
                  });
                }
              }}
              onManualRejectStep={async (stepNumber) => {
                try {
                  await rejectAfterRetryExhaustion.mutateAsync({ pipelineId: pipeline.id, stepNumber });
                  toast({
                    title: "Pipeline stopped",
                    description: `Step ${stepNumber} rejected. All attempts failed QA - pipeline has been stopped.`,
                    variant: "destructive",
                  });
                } catch (err) {
                  const message = err instanceof Error ? err.message : "Failed to stop pipeline";
                  toast({
                    title: "Failed to stop pipeline",
                    description: message,
                    variant: "destructive",
                  });
                }
              }}
              onRestartStep={async (stepNumber) => {
                try {
                  await restartStep.mutateAsync({ pipelineId: pipeline.id, stepNumber });
                  toast({
                    title: "Step restarted",
                    description: `Step ${stepNumber} has been reset. Click "Generate" to create new outputs with QA.`,
                  });
                } catch (err) {
                  const message = err instanceof Error ? err.message : "Failed to restart step";
                  toast({
                    title: "Restart failed",
                    description: message,
                    variant: "destructive",
                  });
                }
              }}
              onRollbackStep={async (stepNumber) => {
                try {
                  await rollbackToPreviousStep.mutateAsync({ pipelineId: pipeline.id, currentStepNumber: stepNumber });
                  toast({
                    title: "Rolled back",
                    description: `Returned to Step ${stepNumber - 1}. Step ${stepNumber}+ outputs have been cleared.`,
                  });
                } catch (err) {
                  const message = err instanceof Error ? err.message : "Failed to rollback";
                  toast({
                    title: "Rollback failed",
                    description: message,
                    variant: "destructive",
                  });
                }
              }}
              isResetPending={restartStep.isPending}
              isRollbackPending={rollbackToPreviousStep.isPending}
              onContinueToStep={async (fromStep, fromPhase) => {
                try {
                  // Defensive: avoid firing a transition from stale UI state.
                  // The backend enforces optimistic concurrency (409 on phase mismatch),
                  // so we preflight-read the latest phase before calling continue.
                  const { data: latest, error: latestErr } = await supabase
                    .from("floorplan_pipelines")
                    .select("whole_apartment_phase, current_step")
                    .eq("id", pipeline.id)
                    .maybeSingle();

                  if (latestErr) throw latestErr;

                  const latestPhase = latest?.whole_apartment_phase ?? "";

                  if (latestPhase !== fromPhase) {
                    // Bring UI back in sync and avoid triggering an invalid transition.
                    queryClient.invalidateQueries({ queryKey: ["floorplan-pipelines", pipeline.project_id] });
                    queryClient.invalidateQueries({ queryKey: ["floorplan-pipelines"] });

                    toast({
                      title: "Pipeline already advanced",
                      description: `Current phase is '${latestPhase || "unknown"}'. Refreshing pipeline state…`,
                    });
                    return;
                  }

                  continueToStep.mutate({
                    pipelineId: pipeline.id,
                    fromStep,
                    fromPhase,
                  });
                } catch (err) {
                  const message = err instanceof Error ? err.message : "Failed to continue";
                  toast({
                    title: "Continue failed",
                    description: message,
                    variant: "destructive",
                  });
                }
              }}
            />
            
            {/* Backend Activity Indicator - shows last event and stale recovery */}
            <BackendActivityIndicator
              pipelineId={pipeline.id}
              currentPhase={phase}
              onRecover={onUpdatePipeline || (() => {})}
            />
            
            {/* Pipeline Debug Panel - shows current state for troubleshooting (dev only) */}
            <PipelineDebugPanel
              pipelineId={pipeline.id}
              currentStep={currentStep}
              phase={phase}
              status={pipeline.status}
              step1ManualApproved={!!s1?.manual_approved}
              step2ManualApproved={!!s2?.manual_approved}
              stepRetryState={(pipeline as any).step_retry_state}
              stepOutputs={stepOutputsAll}
              lastAction={lastAction ? `${lastAction.type}` : undefined}
            />
          </CollapsibleContent>
        </Collapsible>

        {/* Spaces Section (Steps 4-6) with Dynamic Batch Actions */}
        {showSpacesSection && (() => {
          // Split spaces into active and excluded groups
          const activeSpaces = spaces.filter(s => !s.is_excluded && s.include_in_generation !== false);
          const excludedSpaces = spaces.filter(s => s.is_excluded || s.include_in_generation === false);
          
          // Calculate batch action state
          const allRendersApproved = activeSpaces.length > 0 && activeSpaces.every(s => {
            const renderA = s.renders?.find(r => r.kind === "A");
            const renderB = s.renders?.find(r => r.kind === "B");
            return renderA?.locked_approved && renderB?.locked_approved;
          });
          
          const allPanoramasApproved = activeSpaces.length > 0 && activeSpaces.every(s => {
            const panoA = s.panoramas?.find(p => p.kind === "A");
            const panoB = s.panoramas?.find(p => p.kind === "B");
            return panoA?.locked_approved && panoB?.locked_approved;
          });
          
          const allFinal360sApproved = activeSpaces.length > 0 && activeSpaces.every(s => 
            s.final360?.locked_approved
          );
          
          const hasAnyPendingRenders = activeSpaces.some(s => {
            const renderA = s.renders?.find(r => r.kind === "A");
            const renderB = s.renders?.find(r => r.kind === "B");
            return !renderA?.locked_approved || !renderB?.locked_approved;
          });
          
          const hasAnyPendingPanoramas = allRendersApproved && activeSpaces.some(s => {
            const panoA = s.panoramas?.find(p => p.kind === "A");
            const panoB = s.panoramas?.find(p => p.kind === "B");
            return !panoA?.locked_approved || !panoB?.locked_approved;
          });
          
          const hasAnyPendingMerges = allPanoramasApproved && activeSpaces.some(s => 
            !s.final360?.locked_approved
          );
          
          // Determine the primary batch action based on current state
          const getBatchAction = () => {
            // LEGACY: "Continue to Renders" is disabled for now
            // The transition from camera_plan_confirmed → renders_pending
            // should happen via per-space render starts or a future unified action
            // TODO: Re-enable when batch render flow is redesigned
            const HIDE_LEGACY_CONTINUE_TO_RENDERS = true;
            
            // Phase: camera_plan_confirmed - need to transition to renders_pending first
            if (phase === "camera_plan_confirmed") {
              if (HIDE_LEGACY_CONTINUE_TO_RENDERS) {
                return null; // Hide the button entirely
              }
              return {
                label: "Continue to Renders",
                action: "continue_to_renders",
                icon: Play,
                disabled: isAnyMutationPending || continueToStep.isPending,
              };
            }
            
            // Phase: renders_pending, renders_in_progress, or renders_review - ready to start/continue renders
            const isRendersPhase = phase === "renders_pending" ||
              phase === "renders_in_progress" ||
              phase === "renders_review";
            
            if (isRendersPhase && activeSpaces.length > 0 && hasAnyPendingRenders) {
              return {
                label: "Start All Renders",
                action: "start_renders",
                icon: Play,
                disabled: isAnyMutationPending || !styledImageUploadId,
              };
            }
            
            // Phase: all renders approved - ready for panoramas
            if (allRendersApproved && hasAnyPendingPanoramas) {
              return {
                label: "Start All Panoramas",
                action: "start_panoramas",
                icon: Play,
                disabled: isAnyMutationPending,
              };
            }
            
            // Phase: all panoramas approved - ready for merges
            if (allPanoramasApproved && hasAnyPendingMerges) {
              return {
                label: "Start All Merges",
                action: "start_merges",
                icon: Play,
                disabled: isAnyMutationPending,
              };
            }
            
            // All complete
            if (allFinal360sApproved) {
              return {
                label: "Pipeline Complete",
                action: "complete",
                icon: Check,
                disabled: true,
              };
            }
            
            return null;
          };
          
          const batchAction = getBatchAction();
          
          const handleBatchAction = () => {
            if (!batchAction || batchAction.disabled) return;
            
            switch (batchAction.action) {
              case "continue_to_renders":
                // Transition from camera_plan_confirmed → renders_pending
                continueToStep.mutate({
                  pipelineId: pipeline.id,
                  fromStep: 4, // camera_plan_confirmed is step 4
                  fromPhase: "camera_plan_confirmed",
                });
                setTerminalOpen(true); // Open terminal to show progress
                toast({ 
                  title: "Continuing to renders", 
                  description: "Transitioning to render phase..." 
                });
                break;
              case "start_renders":
                if (styledImageUploadId) {
                  runBatchRenders.mutate({ pipelineId: pipeline.id, styledImageUploadId });
                  setTerminalOpen(true); // Open terminal to show progress
                  toast({ title: "Starting renders", description: `Processing ${activeSpaces.length * 2} renders...` });
                }
                break;
              case "start_panoramas":
                runBatchPanoramas.mutate({ pipelineId: pipeline.id });
                setTerminalOpen(true); // Open terminal to show progress
                toast({ title: "Starting panoramas", description: `Processing ${activeSpaces.length * 2} panoramas...` });
                break;
              case "start_merges":
                // Step 7 Quality UI Gate: Open pre-run settings instead of starting immediately
                setStep7SettingsOpen(true);
                break;
            }
          };
          
          return (
            <>
              <Separator />


              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium flex items-center gap-2">
                    <Box className="w-4 h-4 text-primary" />
                    Spaces ({activeSpaces.length} active{excludedSpaces.length > 0 && `, ${excludedSpaces.length} excluded`})
                  </h3>
                  
                  {/* Dynamic Batch Action Button */}
                  {currentStep < 3 ? (
                    <Badge variant="outline" className="text-xs text-muted-foreground">
                      <Lock className="w-3 h-3 mr-1" />
                      Complete Step 3 first
                    </Badge>
                  ) : batchAction ? (
                    <Button
                      size="sm"
                      onClick={handleBatchAction}
                      disabled={batchAction.disabled}
                      variant={batchAction.action === "complete" ? "outline" : "default"}
                      className={batchAction.action === "complete" ? "text-primary" : ""}
                    >
                      {isAnyMutationPending && batchAction.action !== "complete" ? (
                        <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                      ) : (
                        <batchAction.icon className="w-4 h-4 mr-1" />
                      )}
                      {batchAction.label}
                    </Button>
                  ) : null}
                </div>

                {spaces.length === 0 && currentStep >= 3 && (
                  <div className="text-center py-8 text-muted-foreground">
                    <Box className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No spaces detected yet</p>
                    <p className="text-xs">Run "Detect Spaces" to begin</p>
                  </div>
                )}

                {/* Active Spaces - Full functionality */}
                {activeSpaces.map((space) => (
                  <SpaceCard
                    key={space.id}
                    space={space}
                    pipelineId={pipeline.id}
                    styledImageUploadId={styledImageUploadId}
                    pipelineRatio={pipeline.aspect_ratio || "16:9"}
                    pipelineQuality={pipeline.output_resolution || "2K"}
                    onRunRender={handleRunRender}
                    onRunPanorama={handleRunPanorama}
                    onRunMerge={handleRunMerge}
                    onApproveRender={(id) => approveRender.mutate({ renderId: id })}
                    onRejectRender={(id, notes) => rejectRender.mutate({ renderId: id, notes })}
                    onApprovePanorama={(id) => approvePanorama.mutate({ panoramaId: id })}
                    onRejectPanorama={(id, notes) => rejectPanorama.mutate({ panoramaId: id, notes })}
                    onApproveFinal360={(id) => approveFinal360.mutate({ final360Id: id })}
                    onRejectFinal360={(id, notes) => rejectFinal360.mutate({ final360Id: id, notes })}
                    onRetryRender={handleRetryRender}
                    onRetryPanorama={handleRetryPanorama}
                    onRetryFinal360={handleRetryFinal360}
                    onExcludeSpace={(id) => excludeSpace.mutate({ spaceId: id })}
                    onRestoreSpace={(id) => restoreSpace.mutate({ spaceId: id })}
                    isRunning={isAnyMutationPending}
                    // Per-space render control props
                    availableReferenceImages={availableReferenceImages}
                    onStartSpaceRender={(spaceId, referenceIds) => {
                      setRenderingSpaceId(spaceId);
                      runSingleSpaceRenders.mutate(
                        {
                          pipelineId: pipeline.id,
                          spaceId,
                          styledImageUploadId: styledImageUploadId || "",
                          referenceImageIds: referenceIds,
                        },
                        {
                          onSettled: () => setRenderingSpaceId(null),
                          onSuccess: () => {
                            toast({
                              title: "Renders started",
                              description: `Started rendering for ${space.name}`,
                            });
                          },
                          onError: (error) => {
                            toast({
                              title: "Render failed",
                              description: error instanceof Error ? error.message : "Unknown error",
                              variant: "destructive",
                            });
                          },
                        }
                      );
                    }}
                    onUpdateSpaceReferences={(spaceId, referenceIds) => {
                      updateSpaceReferences.mutate({ spaceId, referenceImageIds: referenceIds });
                    }}
                    isRenderingSpace={renderingSpaceId === space.id}
                    isUpdatingRefs={updateSpaceReferences.isPending}
                    hasMarker={
                      markersLoading 
                        ? true // Don't block during loading
                        : (cameraMarkers?.some(m => m.room_id === space.id) ?? 
                           // Fallback: if render records exist, assume marker existed
                           !!(space.renders?.find(r => r.kind === "A" || r.kind === "B")))
                    }
                  />
                ))}

                {/* Stage Approval Gates - Show progress and gate Continue buttons */}
                {activeSpaces.length > 0 && currentStep >= 5 && (
                  <div className="space-y-3 mt-4">
                    {/* Renders Approval Gate - shows only AFTER renders have actually been started */}
                    {/* Must be in a renders phase (not camera_plan_confirmed) and have actual render activity */}
                    {(phase === "renders_in_progress" || phase === "renders_review" || allRendersApproved) && (
                      <StageApprovalGate
                        stage="renders"
                        spaces={spaces}
                        onContinue={() => {
                          advancePipeline.mutate({
                            pipelineId: pipeline.id,
                            fromStep: 5,
                          });
                        }}
                        isPending={advancePipeline.isPending}
                        disabled={!allRendersApproved}
                        nextStageLabel="Continue to Panoramas"
                      />
                    )}
                    
                    {/* Panoramas Approval Gate - shows after panoramas start */}
                    {allRendersApproved && (phase === "panoramas_in_progress" || phase === "panoramas_review" || allPanoramasApproved) && (
                      <StageApprovalGate
                        stage="panoramas"
                        spaces={spaces}
                        onContinue={() => {
                          advancePipeline.mutate({
                            pipelineId: pipeline.id,
                            fromStep: 6,
                          });
                        }}
                        isPending={advancePipeline.isPending}
                        disabled={!allPanoramasApproved}
                        nextStageLabel="Continue to Merge"
                      />
                    )}
                    
                    {/* Final 360 Approval Gate - shows after merges start */}
                    {allPanoramasApproved && (phase === "merging_in_progress" || phase === "merging_review" || allFinal360sApproved) && (
                      <StageApprovalGate
                        stage="final360"
                        spaces={spaces}
                        onContinue={() => {
                          // Mark pipeline as complete
                          toast({
                            title: "Pipeline Complete!",
                            description: "All 360° panoramas have been generated and approved.",
                          });
                        }}
                        isPending={false}
                        disabled={!allFinal360sApproved}
                        nextStageLabel="Complete Pipeline"
                      />
                    )}
                  </div>
                )}

                {/* Excluded Spaces - Collapsed section with restore option */}
                {excludedSpaces.length > 0 && (
                  <Collapsible>
                    <CollapsibleTrigger asChild>
                      <Button 
                        variant="ghost" 
                        className="w-full justify-between h-auto py-2 text-muted-foreground hover:text-foreground"
                      >
                        <span className="text-sm flex items-center gap-2">
                          <Box className="w-4 h-4 opacity-50" />
                          Excluded Spaces ({excludedSpaces.length})
                        </span>
                        <ChevronDown className="w-4 h-4" />
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="space-y-2 pt-2">
                      {excludedSpaces.map((space) => (
                        <SpaceCard
                          key={space.id}
                          space={space}
                          pipelineId={pipeline.id}
                          styledImageUploadId={styledImageUploadId}
                          pipelineRatio={pipeline.aspect_ratio || "16:9"}
                          pipelineQuality={pipeline.output_resolution || "2K"}
                          onRunRender={handleRunRender}
                          onRunPanorama={handleRunPanorama}
                          onRunMerge={handleRunMerge}
                          onApproveRender={(id) => approveRender.mutate({ renderId: id })}
                          onRejectRender={(id, notes) => rejectRender.mutate({ renderId: id, notes })}
                          onApprovePanorama={(id) => approvePanorama.mutate({ panoramaId: id })}
                          onRejectPanorama={(id, notes) => rejectPanorama.mutate({ panoramaId: id, notes })}
                          onApproveFinal360={(id) => approveFinal360.mutate({ final360Id: id })}
                          onRejectFinal360={(id, notes) => rejectFinal360.mutate({ final360Id: id, notes })}
                          onRetryRender={handleRetryRender}
                          onRetryPanorama={handleRetryPanorama}
                          onRetryFinal360={handleRetryFinal360}
                          onExcludeSpace={(id) => excludeSpace.mutate({ spaceId: id })}
                          onRestoreSpace={(id) => restoreSpace.mutate({ spaceId: id })}
                          isRunning={isAnyMutationPending}
                          isExcluded={true}
                        />
                      ))}
                    </CollapsibleContent>
                  </Collapsible>
                )}
              </div>
            </>
          );
        })()}

        {/* Execution Terminal */}
        {(() => {
          // Determine current step name based on phase
          // isLive should ONLY be true when pipeline is actively processing (API calls happening)
          // NOT when waiting for user action (pending, review, etc.)
          const isLive = phase.includes("running") || 
            phase.includes("in_progress") ||
            phase === "detecting_spaces" || 
            pipeline.status === "running";
          
          const getCurrentStepName = () => {
            if (phase.startsWith("space_analysis")) return "Space Analysis";
            if (phase.startsWith("top_down_3d")) return "Top-Down 3D";
            if (phase.startsWith("style")) return "Style Transfer";
            if (phase.startsWith("camera_plan")) return "Camera Planning";
            if (phase.startsWith("detect") || phase === "detecting_spaces") return "Detect Spaces";
            if (phase.startsWith("spaces_detected")) return "Spaces Detected";
            if (phase.startsWith("renders")) return "Renders";
            if (phase.startsWith("panoramas")) return "Panoramas";
            if (phase.startsWith("merging")) return "360° Merge";
            return WHOLE_APARTMENT_STEP_NAMES[currentStep] || null;
          };
          
          const currentStepName = getCurrentStepName();
          
          return (
            <Collapsible open={terminalOpen} onOpenChange={setTerminalOpen}>
              <CollapsibleTrigger asChild>
                <Button 
                  variant="ghost" 
                  className="w-full justify-between h-auto py-2"
                >
                  <span className="text-sm font-medium flex items-center gap-2">
                    <Terminal className="w-4 h-4" />
                    Execution Log
                    {isLive && (
                      <Badge variant="outline" className="ml-2 text-xs bg-blue-500/10 text-blue-400 border-blue-500/30">
                        <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                        Live
                      </Badge>
                    )}
                  </span>
                  <div className="flex items-center gap-2">
                    {currentStepName && isLive && (
                      <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/30">
                        {currentStepName}
                      </Badge>
                    )}
                    <ChevronDown
                      className={`w-4 h-4 transition-transform ${
                        terminalOpen ? "rotate-180" : ""
                      }`}
                    />
                  </div>
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <FloorPlanPipelineTerminal
                  pipelineId={pipeline.id}
                  isOpen={terminalOpen}
                  currentStepName={currentStepName}
                  isLive={isLive}
                />
              </CollapsibleContent>
            </Collapsible>
          );
        })()}

        {/* Debug Info Panel */}
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="w-full justify-start text-xs text-muted-foreground h-7">
              <Eye className="w-3 h-3 mr-1" />
              Debug Info
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="text-xs font-mono bg-muted/50 p-2 rounded mt-1 space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">current_step:</span>
                <span className="font-medium">{currentStep}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">status:</span>
                <span className="font-medium">{pipeline.status}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">phase:</span>
                <span className="font-medium">{phase}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">spaces:</span>
                <span className="font-medium">
                  {progressDetails?.totalSpaces ?? 0} active
                  {(progressDetails?.excludedCount ?? 0) > 0 && (
                    <span className="text-muted-foreground ml-1">
                      ({progressDetails?.excludedCount} excluded)
                    </span>
                  )}
                </span>
                {(() => {
                  const duplicates = spaces.filter((s, i, arr) => 
                    arr.findIndex(x => x.name === s.name) !== i
                  );
                  return duplicates.length > 0 ? (
                    <Badge variant="destructive" className="text-[10px] px-1 py-0">
                      {duplicates.length} duplicates!
                    </Badge>
                  ) : null;
                })()}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">isRunning:</span>
                <span className="font-medium">{isRunning ? "true" : "false"}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">isAnyMutationPending:</span>
                <span className="font-medium">{isAnyMutationPending ? "true" : "false"}</span>
              </div>
              {lastAction && (
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">last_action:</span>
                  <span className="font-medium">{lastAction.type} @ {new Date(lastAction.ts).toLocaleTimeString()}</span>
                </div>
              )}
              {pipeline.last_error && (
                <div className="flex items-start gap-2 text-destructive">
                  <span className="text-muted-foreground">last_error:</span>
                  <span className="font-medium break-all">{pipeline.last_error}</span>
                </div>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Error display */}
        {pipeline.last_error && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
            <AlertTriangle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-destructive">Error</p>
              <p className="text-xs text-muted-foreground">{pipeline.last_error}</p>
            </div>
          </div>
        )}
      </CardContent>

        {/* Settings Drawer */}
        <PipelineSettingsDrawer
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          pipeline={pipeline}
          onUpdateSettings={handleUpdateSettings}
          onUpdateQualityPostStep4={async (quality) => {
            await supabase
              .from("floorplan_pipelines")
              .update({ quality_post_step4: quality })
              .eq("id", pipeline.id);
            onUpdatePipeline?.();
            toast({ title: "Quality updated", description: `Steps 4+ will use ${quality}` });
          }}
        />
      </Card>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-destructive" />
              Delete Pipeline?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>This will permanently delete:</p>
              <ul className="list-disc list-inside text-sm space-y-1">
                <li>All detected spaces ({spaces.length})</li>
                <li>All renders, panoramas, and final 360 outputs</li>
                <li>All QA reports and approval history</li>
                <li>Pipeline configuration and logs</li>
              </ul>
              <p className="font-medium text-destructive">This action cannot be undone.</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletePipeline.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeletePipeline}
              disabled={deletePipeline.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletePipeline.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete Pipeline
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Restart Confirmation Dialog */}
      <AlertDialog open={restartDialogOpen} onOpenChange={setRestartDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <RotateCcw className="w-5 h-5 text-primary" />
              Start Over?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>This will reset the pipeline to Step 1 and delete:</p>
              <ul className="list-disc list-inside text-sm space-y-1">
                <li>All detected spaces ({spaces.length})</li>
                <li>All renders, panoramas, and final 360 outputs</li>
                <li>All QA reports and approval history</li>
                <li>Current progress ({progress}%)</li>
              </ul>
              <p className="mt-2 text-sm">
                <strong>Preserved:</strong> Original floor plan, style settings, and configuration.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restartPipeline.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRestartPipeline}
              disabled={restartPipeline.isPending}
            >
              {restartPipeline.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Restarting...
                </>
              ) : (
                <>
                  <RotateCcw className="w-4 h-4 mr-2" />
                  Start Over
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Step 7 Quality UI Gate: Pre-run settings with 4K toggle */}
      <Step7PreRunSettings
        open={step7SettingsOpen}
        onOpenChange={setStep7SettingsOpen}
        currentQuality={(pipeline as any).quality_post_step4 || "2K"}
        spaceCount={spaces.filter(s => !s.is_excluded && s.include_in_generation !== false).length}
        isPending={runBatchMerges.isPending}
        onConfirm={(quality) => {
          runBatchMerges.mutate({ 
            pipelineId: pipeline.id, 
            mergeQuality: quality 
          });
          setStep7SettingsOpen(false);
          setTerminalOpen(true);
          toast({ 
            title: `Starting merges (${quality})`, 
            description: `Processing ${spaces.filter(s => !s.is_excluded && s.include_in_generation !== false).length} final 360s...` 
          });
        }}
      />
    </>
  );
});
