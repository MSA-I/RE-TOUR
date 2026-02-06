import { useState, useEffect, useCallback, useRef, memo, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useStorage } from "@/hooks/useStorage";
import { useDeleteUpload } from "@/hooks/useDeleteUpload";
import { useIsMobile } from "@/hooks/use-mobile";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { VirtualizedImageGrid } from "@/components/VirtualizedImageGrid";
import { LazyImage } from "@/components/LazyImage";
import { PipelineRunsFolder, type PipelineCreation } from "@/components/creations/PipelineRunsFolder";
import { CreationsViewToggle, type CreationsViewMode } from "@/components/creations/CreationsViewToggle";
import { 
  Loader2, Image, MoreHorizontal, Layers, Wand2, Eye, X, Paperclip, ImagePlus, ArrowRight, Check, CheckSquare, Trash2, Box, Maximize2, Download, Info
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { format } from "date-fns";
import { useNavigate } from "react-router-dom";

interface CreationsTabProps {
  projectId: string;
  onAttachToStage?: (uploadId: string, stage: number) => void;
  onEditImage?: (uploadId: string) => void;
  onUsePanorama?: (uploadId: string) => void;
  onCreatePipeline?: (floorPlanUploadId: string, startFromStep: number, inputUploadId: string) => void;
  // Multi-attach callbacks
  onAttachMultiToPanorama?: (uploadIds: string[]) => void;
  onAttachMultiToEdit?: (uploadIds: string[]) => void;
  onAttachMultiToVirtualTour?: (uploadIds: string[]) => void;
  onAttachMultiToMultiPanorama?: (uploadIds: string[]) => void;
}

interface Creation {
  id: string;
  bucket: string;
  path: string;
  kind: string;
  original_filename: string | null;
  created_at: string;
  source_type: "render_job" | "batch_item" | "pipeline_step" | "image_edit";
  source_id: string;
  source_step?: number;
  // Pipeline-specific metadata for folder organization
  pipeline_id?: string;
  space_id?: string;
  space_name?: string;
  // Generation parameters
  ratio?: string | null;
  quality?: string | null;
}

// Helper to extract generation metadata safely
function getCreationGenMeta(creation: Creation): { ratio?: string; quality?: string } {
  return {
    ratio: creation.ratio || undefined,
    quality: creation.quality || undefined,
  };
}

interface Attachment {
  uploadId: string;
  filename: string;
  stage: number;
}

// Thumbnail size constants
const THUMBNAIL_SIZES = {
  min: 120,
  max: 280,
  default: 180,
  storageKey: "creations-thumbnail-size"
};

const MAX_SELECTION = 20;

// Memoized creation card to prevent re-renders
const CreationCard = memo(function CreationCard({
  creation,
  previewUrl,
  isAttached,
  isSelectionMode,
  isSelected,
  onToggleSelect,
  onStartPipelineFromStep,
  onEdit,
  onViewLarge,
  onUsePanorama,
  onDelete,
  onDownloadFullQuality,
  isDownloading
}: {
  creation: Creation;
  previewUrl: string | undefined;
  isAttached: boolean;
  isSelectionMode: boolean;
  isSelected: boolean;
  onToggleSelect: () => void;
  onStartPipelineFromStep: (stage: number) => void;
  onEdit: () => void;
  onViewLarge: () => void;
  onUsePanorama: () => void;
  onDelete: () => void;
  onDownloadFullQuality: () => void;
  isDownloading: boolean;
}) {
  const isMobile = useIsMobile();
  const genMeta = getCreationGenMeta(creation);
  const hasGenMeta = genMeta.ratio || genMeta.quality;

  const getSourceLabel = (): string => {
    switch (creation.source_type) {
      case "render_job":
        return "Panorama Job";
      case "batch_item":
        return "Batch Job";
      case "pipeline_step":
        return `Pipeline Step ${creation.source_step}`;
      case "image_edit":
        return "Image Edit";
      default:
        return "Unknown";
    }
  };

  // Metadata content for overlay/popover
  const MetadataContent = () => (
    <div className="space-y-0.5">
      {genMeta.ratio && (
        <p className="text-xs">
          <span className="text-muted-foreground">RATIO:</span>{" "}
          <span className="font-medium">{genMeta.ratio}</span>
        </p>
      )}
      {genMeta.quality && (
        <p className="text-xs">
          <span className="text-muted-foreground">QUALITY:</span>{" "}
          <span className="font-medium">{genMeta.quality}</span>
        </p>
      )}
      {!hasGenMeta && (
        <p className="text-xs text-muted-foreground italic">No generation metadata</p>
      )}
    </div>
  );

  return (
    <div
      className={`group relative rounded-lg border overflow-hidden transition-all ${
        isSelected 
          ? "ring-2 ring-primary border-primary bg-primary/5" 
          : isAttached 
          ? "ring-2 ring-primary border-primary" 
          : "border-border hover:border-muted-foreground"
      }`}
      onClick={isSelectionMode ? onToggleSelect : undefined}
    >
      {/* Selection checkbox overlay */}
      {isSelectionMode && (
        <div className="absolute top-2 left-2 z-10">
          <Checkbox 
            checked={isSelected} 
            onCheckedChange={() => onToggleSelect()}
            className="h-5 w-5 bg-background/80 border-2"
          />
        </div>
      )}

      {/* Image */}
      <div className={`aspect-square bg-muted ${isSelectionMode ? "cursor-pointer" : ""}`}>
        <LazyImage
          src={previewUrl}
          alt={creation.original_filename || "Creation"}
          className="w-full h-full"
        />
      </div>

      {/* Generation metadata overlay - Desktop (hover) */}
      {!isMobile && hasGenMeta && (
        <div className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-[5]">
          <div className="bg-background/90 backdrop-blur-sm rounded-md px-2 py-1.5 shadow-sm border border-border/50">
            <MetadataContent />
          </div>
        </div>
      )}

      {/* Generation metadata - Mobile (info icon with popover) */}
      {isMobile && hasGenMeta && !isSelectionMode && (
        <Popover>
          <PopoverTrigger asChild>
            <Button 
              size="icon" 
              variant="secondary" 
              className="absolute top-2 left-2 h-7 w-7 z-10"
              onClick={(e) => e.stopPropagation()}
            >
              <Info className="h-3.5 w-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-2" side="bottom" align="start">
            <MetadataContent />
          </PopoverContent>
        </Popover>
      )}

      {/* Overlay with info */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        <div className="absolute bottom-0 left-0 right-0 p-3">
          <p className="text-white text-xs font-medium truncate">
            {creation.original_filename || `Output ${creation.id.slice(0, 8)}`}
          </p>
          <p className="text-white/70 text-xs">
            {getSourceLabel()}
          </p>
          <p className="text-white/50 text-xs">
            {format(new Date(creation.created_at), "MMM d, HH:mm")}
          </p>
        </div>
      </div>

      {/* Attached indicator */}
      {isAttached && !isSelectionMode && (
        <div className="absolute top-2 left-2">
          <Badge className="bg-primary text-primary-foreground text-xs">
            <Paperclip className="h-3 w-3 mr-1" />
            Attached
          </Badge>
        </div>
      )}

      {/* Actions dropdown - only show when NOT in selection mode */}
      {!isSelectionMode && (
        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="secondary" className="h-8 w-8">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onUsePanorama}>
                <ImagePlus className="h-4 w-4 mr-2" />
                Use as Panorama Input
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onEdit}>
                <Wand2 className="h-4 w-4 mr-2" />
                Edit / Modify
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onViewLarge}>
                <Maximize2 className="h-4 w-4 mr-2" />
                View Large
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onDownloadFullQuality} disabled={isDownloading}>
                {isDownloading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 mr-2" />
                )}
                Download (Full Quality)
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {/* Source badge */}
      <div className="absolute bottom-2 right-2">
        <Badge variant="outline" className="bg-background/80 text-xs">
          {creation.source_type === "pipeline_step" && `S${creation.source_step}`}
          {creation.source_type === "render_job" && "Pano"}
          {creation.source_type === "batch_item" && "Batch"}
          {creation.source_type === "image_edit" && "Edit"}
        </Badge>
      </div>
    </div>
  );
});

export const CreationsTab = memo(function CreationsTab({ 
  projectId, 
  onAttachToStage, 
  onEditImage, 
  onUsePanorama,
  onCreatePipeline,
  onAttachMultiToPanorama,
  onAttachMultiToEdit,
  onAttachMultiToVirtualTour
}: CreationsTabProps) {
  const { user } = useAuth();
  const { getSignedViewUrl, getSignedDownloadUrl } = useStorage();
  const { toast } = useToast();
  const navigate = useNavigate();
  const deleteUploadMutation = useDeleteUpload(projectId);
  
  // Download state - track which creation is currently downloading
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  
  const [creations, setCreations] = useState<Creation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [imagePreviews, setImagePreviews] = useState<Record<string, string>>({});
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  
  // Selection mode state
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  
  // Delete confirmation state (single and bulk)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [creationToDelete, setCreationToDelete] = useState<Creation | null>(null);
  const [bulkDeleteMode, setBulkDeleteMode] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  
  // Thumbnail size state with localStorage persistence
  const [thumbnailSize, setThumbnailSize] = useState<number>(() => {
    const saved = localStorage.getItem(THUMBNAIL_SIZES.storageKey);
    return saved ? parseInt(saved, 10) : THUMBNAIL_SIZES.default;
  });

  // View mode state: "all" shows flat grid, "folders" shows pipeline-organized view
  const [viewMode, setViewMode] = useState<CreationsViewMode>(() => {
    const saved = localStorage.getItem("creations-view-mode");
    return (saved === "folders" ? "folders" : "all") as CreationsViewMode;
  });

  // Attach modal state - supports Panorama and Edit destinations
  const [attachModalOpen, setAttachModalOpen] = useState(false);
  const [attachModalCreation, setAttachModalCreation] = useState<Creation | null>(null);
  const [attachModalPreviewUrl, setAttachModalPreviewUrl] = useState<string>("");
  const [attachModalDestination, setAttachModalDestination] = useState<"panorama" | "edit">("panorama");

  // Large image viewer state
  const [viewLargeOpen, setViewLargeOpen] = useState(false);
  const [viewLargeUrl, setViewLargeUrl] = useState<string>("");
  const [viewLargeFilename, setViewLargeFilename] = useState<string>("");

  // Track which previews are being loaded
  const loadingPreviewsRef = useRef<Set<string>>(new Set());
  const loadedPreviewsRef = useRef<Set<string>>(new Set());

  // Persist thumbnail size to localStorage
  const handleThumbnailSizeChange = useCallback((value: number[]) => {
    const size = value[0];
    setThumbnailSize(size);
    localStorage.setItem(THUMBNAIL_SIZES.storageKey, size.toString());
  }, []);

  // Persist view mode to localStorage
  const handleViewModeChange = useCallback((mode: CreationsViewMode) => {
    setViewMode(mode);
    localStorage.setItem("creations-view-mode", mode);
  }, []);

  const fetchCreations = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);

    try {
      const allCreations: Creation[] = [];

      // 1. Fetch render job outputs - EXCLUDE rejected jobs
      const { data: renderJobs } = await supabase
        .from("render_jobs")
        .select(`
          id,
          output_upload_id,
          status,
          output_resolution,
          output:uploads!render_jobs_output_upload_id_fkey(id, bucket, path, original_filename, created_at, kind)
        `)
        .eq("project_id", projectId)
        .not("output_upload_id", "is", null)
        .neq("status", "rejected"); // Exclude rejected outputs from Creations

      if (renderJobs) {
        renderJobs.forEach((job: any) => {
          if (job.output) {
            allCreations.push({
              id: job.output.id,
              bucket: job.output.bucket,
              path: job.output.path,
              kind: job.output.kind,
              original_filename: job.output.original_filename,
              created_at: job.output.created_at,
              source_type: "render_job",
              source_id: job.id,
              // render_jobs don't have ratio, only quality (output_resolution)
              quality: job.output_resolution || null
            });
          }
        });
      }

      // 2. Fetch batch job item outputs - EXCLUDE rejected items
      const { data: batchItems } = await supabase
        .from("batch_jobs_items")
        .select(`
          id,
          output_upload_id,
          status,
          qa_decision,
          batch_job:batch_jobs!inner(project_id, output_resolution),
          output:uploads!batch_jobs_items_output_upload_id_fkey(id, bucket, path, original_filename, created_at, kind)
        `)
        .eq("batch_job.project_id", projectId)
        .not("output_upload_id", "is", null)
        .neq("status", "rejected"); // Exclude rejected outputs from Creations

      if (batchItems) {
        batchItems.forEach((item: any) => {
          // Additional filter: exclude items with qa_decision = 'rejected'
          if (item.output && item.qa_decision !== "rejected") {
            allCreations.push({
              id: item.output.id,
              bucket: item.output.bucket,
              path: item.output.path,
              kind: item.output.kind,
              original_filename: item.output.original_filename,
              created_at: item.output.created_at,
              source_type: "batch_item",
              source_id: item.id,
              // Batch jobs have output_resolution in parent
              quality: item.batch_job?.output_resolution || null
            });
          }
        });
      }

      // 3. Fetch pipeline outputs - EXCLUDE rejected outputs
      // We need to check the floorplan_pipelines table for approved/rejected status
      const { data: pipelines } = await supabase
        .from("floorplan_pipelines")
        .select("id, step_outputs, aspect_ratio, output_resolution")
        .eq("project_id", projectId);

      // Collect approved pipeline output upload IDs + their metadata (including pipeline_id for folder org)
      const approvedPipelineOutputIds = new Set<string>();
      const rejectedPipelineOutputIds = new Set<string>();
      const pipelineMetadata: Record<string, { 
        ratio?: string; 
        quality?: string; 
        pipeline_id?: string;
        space_id?: string;
        space_name?: string;
      }> = {};
      
      if (pipelines) {
        pipelines.forEach((pipeline: any) => {
          const pipelineId = pipeline.id;
          const pipelineRatio = pipeline.aspect_ratio;
          const pipelineQuality = pipeline.output_resolution;
          const stepOutputs = pipeline.step_outputs as Record<string, any> | null;
          if (stepOutputs) {
            Object.entries(stepOutputs).forEach(([stepKey, output]: [string, any]) => {
              // Handle multi-output format
              if (output?.outputs && Array.isArray(output.outputs)) {
                output.outputs.forEach((o: any) => {
                  if (o?.output_upload_id) {
                    const qaDecision = o.qa_decision || o.approval_status;
                    if (qaDecision === "rejected") {
                      rejectedPipelineOutputIds.add(o.output_upload_id);
                    } else if (qaDecision === "approved") {
                      approvedPipelineOutputIds.add(o.output_upload_id);
                    }
                    // Store metadata for this output including pipeline_id
                    pipelineMetadata[o.output_upload_id] = {
                      ratio: o.ratio || pipelineRatio || undefined,
                      quality: o.quality || pipelineQuality || undefined,
                      pipeline_id: pipelineId,
                      space_id: o.space_id || undefined,
                      space_name: o.space_name || undefined,
                    };
                  }
                });
              }
              // Handle single-output format
              if (output?.output_upload_id) {
                const qaDecision = output.qa_decision;
                if (qaDecision === "rejected") {
                  rejectedPipelineOutputIds.add(output.output_upload_id);
                } else if (qaDecision === "approved") {
                  approvedPipelineOutputIds.add(output.output_upload_id);
                }
                // Store metadata for this output including pipeline_id
                pipelineMetadata[output.output_upload_id] = {
                  ratio: output.ratio || pipelineRatio || undefined,
                  quality: output.quality || pipelineQuality || undefined,
                  pipeline_id: pipelineId,
                  space_id: output.space_id || undefined,
                  space_name: output.space_name || undefined,
                };
              }
            });
          }
        });
      }

      // Fetch pipeline output uploads (independent of pipeline existence for orphaned assets)
      const { data: pipelineOutputs } = await supabase
        .from("uploads")
        .select("id, bucket, path, original_filename, created_at, kind")
        .eq("project_id", projectId)
        .eq("kind", "output")
        .like("path", `%/pipeline_%`);

      if (pipelineOutputs) {
        pipelineOutputs.forEach(upload => {
          // Skip explicitly rejected outputs
          if (rejectedPipelineOutputIds.has(upload.id)) {
            return;
          }
          
          // Extract pipeline_id and step from path: /user_id/pipeline_{pipeline_id}_step{N}_...
          const pipelineIdMatch = upload.path.match(/pipeline_([a-f0-9-]+)_step/);
          const stepMatch = upload.path.match(/pipeline_[^_]+_step(\d+)_/);
          const stepNumber = stepMatch ? parseInt(stepMatch[1]) : 1;
          const extractedPipelineId = pipelineIdMatch ? pipelineIdMatch[1] : undefined;
          const metadata = pipelineMetadata[upload.id] || {};
          
          allCreations.push({
            id: upload.id,
            bucket: upload.bucket,
            path: upload.path,
            kind: upload.kind,
            original_filename: upload.original_filename,
            created_at: upload.created_at,
            source_type: "pipeline_step",
            source_id: metadata.pipeline_id || extractedPipelineId || "orphaned",
            source_step: stepNumber,
            pipeline_id: metadata.pipeline_id || extractedPipelineId,
            space_id: metadata.space_id,
            space_name: metadata.space_name,
            ratio: metadata.ratio || null,
            quality: metadata.quality || null
          });
        });
      }

      // 4. Fetch image edit job outputs - EXCLUDE failed jobs
      const { data: imageEditJobs } = await supabase
        .from("image_edit_jobs")
        .select(`
          id,
          output_upload_id,
          status,
          aspect_ratio,
          output_quality,
          output:uploads!image_edit_jobs_output_upload_id_fkey(id, bucket, path, original_filename, created_at, kind)
        `)
        .eq("project_id", projectId)
        .not("output_upload_id", "is", null)
        .neq("status", "failed"); // Exclude failed edit jobs

      if (imageEditJobs) {
        imageEditJobs.forEach((job: any) => {
          if (job.output) {
            allCreations.push({
              id: job.output.id,
              bucket: job.output.bucket,
              path: job.output.path,
              kind: job.output.kind,
              original_filename: job.output.original_filename,
              created_at: job.output.created_at,
              source_type: "image_edit",
              source_id: job.id,
              ratio: job.aspect_ratio || null,
              quality: job.output_quality || null
            });
          }
        });
      }

      // Deduplicate by upload ID (same upload can appear in multiple sources)
      const uniqueCreations = Array.from(
        new Map(allCreations.map(c => [c.id, c])).values()
      );

      // Sort by creation date, newest first
      uniqueCreations.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setCreations(uniqueCreations);
    } catch (error) {
      console.error("Failed to fetch creations:", error);
      toast({
        title: "Failed to load creations",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  }, [user, projectId, toast]);

  useEffect(() => {
    fetchCreations();
  }, [fetchCreations]);

  // Load preview for a single creation - with deduplication
  const loadPreview = useCallback(async (creation: Creation) => {
    const id = creation.id;
    
    if (loadedPreviewsRef.current.has(id) || loadingPreviewsRef.current.has(id)) {
      return;
    }

    loadingPreviewsRef.current.add(id);

    try {
      const result = await getSignedViewUrl(creation.bucket, creation.path);
      if (result.signedUrl) {
        loadedPreviewsRef.current.add(id);
        setImagePreviews(prev => ({ ...prev, [id]: result.signedUrl }));
      }
    } catch (error) {
      // Silently fail for individual previews
    } finally {
      loadingPreviewsRef.current.delete(id);
    }
  }, [getSignedViewUrl]);

  // Load previews in batches with delay
  useEffect(() => {
    if (creations.length === 0) return;

    const firstBatch = creations.slice(0, 12);
    firstBatch.forEach(c => loadPreview(c));

    const remaining = creations.slice(12);
    const timeouts: ReturnType<typeof setTimeout>[] = [];

    remaining.forEach((creation, index) => {
      const timeout = setTimeout(() => {
        loadPreview(creation);
      }, 100 * Math.floor(index / 4));

      timeouts.push(timeout);
    });

    return () => {
      timeouts.forEach(t => clearTimeout(t));
    };
  }, [creations, loadPreview]);

  // Toggle selection mode
  const handleToggleSelectionMode = useCallback(() => {
    setIsSelectionMode(prev => !prev);
    if (isSelectionMode) {
      setSelectedIds(new Set()); // Clear selection when exiting
    }
  }, [isSelectionMode]);

  // Toggle individual selection
  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (next.size >= MAX_SELECTION) {
          toast({
            title: `Maximum ${MAX_SELECTION} images can be selected`,
            variant: "destructive"
          });
          return prev;
        }
        next.add(id);
      }
      return next;
    });
  }, [toast]);

  // Clear selection
  const handleClearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  // Handle batch attach to panorama
  const handleAttachToPanorama = useCallback(() => {
    if (selectedIds.size === 0) return;
    
    const ids = Array.from(selectedIds);
    console.log(`[Creations] Attaching ${ids.length} images to Panorama`);
    
    if (onAttachMultiToPanorama) {
      onAttachMultiToPanorama(ids);
    } else if (ids.length === 1 && onUsePanorama) {
      onUsePanorama(ids[0]);
    }
    
    setIsSelectionMode(false);
    setSelectedIds(new Set());
  }, [selectedIds, onAttachMultiToPanorama, onUsePanorama]);

  // Handle batch attach to edit
  const handleAttachToEdit = useCallback(() => {
    if (selectedIds.size === 0) return;
    
    const ids = Array.from(selectedIds);
    console.log(`[Creations] Attaching ${ids.length} images to Image Editing`);
    
    if (onAttachMultiToEdit) {
      onAttachMultiToEdit(ids);
    } else if (ids.length === 1 && onEditImage) {
      onEditImage(ids[0]);
    }
    
    setIsSelectionMode(false);
    setSelectedIds(new Set());
  }, [selectedIds, onAttachMultiToEdit, onEditImage]);

  // Handle batch attach to Virtual Tour
  const handleAttachToVirtualTour = useCallback(() => {
    if (selectedIds.size === 0) return;
    
    const ids = Array.from(selectedIds);
    console.log(`[Creations] Attaching ${ids.length} images to Virtual Tour`);
    
    if (onAttachMultiToVirtualTour) {
      onAttachMultiToVirtualTour(ids);
    }
    
    setIsSelectionMode(false);
    setSelectedIds(new Set());
  }, [selectedIds, onAttachMultiToVirtualTour]);

  // Handle delete request (single)
  const handleDeleteRequest = useCallback((creation: Creation) => {
    setCreationToDelete(creation);
    setBulkDeleteMode(false);
    setDeleteConfirmOpen(true);
  }, []);

  // Handle bulk delete request
  const handleBulkDeleteRequest = useCallback(() => {
    if (selectedIds.size === 0) return;
    setBulkDeleteMode(true);
    setCreationToDelete(null);
    setDeleteConfirmOpen(true);
  }, [selectedIds.size]);

  // Confirm delete (single or bulk)
  const handleConfirmDelete = useCallback(async () => {
    setIsDeleting(true);
    try {
      if (bulkDeleteMode) {
        // Bulk delete
        const idsToDelete = Array.from(selectedIds);
        console.log(`[Creations] Bulk deleting ${idsToDelete.length} images`);
        
        for (const uploadId of idsToDelete) {
          await deleteUploadMutation.mutateAsync({ uploadId });
        }
        
        // Remove from local state
        setCreations(prev => prev.filter(c => !selectedIds.has(c.id)));
        setSelectedIds(new Set());
        setIsSelectionMode(false);
        
        toast({ title: `${idsToDelete.length} images deleted successfully` });
      } else if (creationToDelete) {
        // Single delete
        await deleteUploadMutation.mutateAsync({ uploadId: creationToDelete.id });
        
        // Remove from local state
        setCreations(prev => prev.filter(c => c.id !== creationToDelete.id));
        setSelectedIds(prev => {
          const next = new Set(prev);
          next.delete(creationToDelete.id);
          return next;
        });
        
        toast({ title: "Image deleted successfully" });
      }
    } catch (error) {
      toast({
        title: "Failed to delete image(s)",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
    } finally {
      setIsDeleting(false);
      setDeleteConfirmOpen(false);
      setCreationToDelete(null);
      setBulkDeleteMode(false);
    }
  }, [bulkDeleteMode, selectedIds, creationToDelete, deleteUploadMutation, toast]);

  // Handle starting a new pipeline from a specific step
  const handleStartPipelineFromStep = useCallback((creation: Creation, stage: number) => {
    if (onCreatePipeline) {
      onCreatePipeline(creation.id, stage, creation.id);
      toast({
        title: `Creating new pipeline from Step ${stage}`,
        description: "A new job instance will be created."
      });
    }
  }, [onCreatePipeline, toast]);

  const handleRemoveAttachment = useCallback((stage: number) => {
    setAttachments(prev => prev.filter(a => a.stage !== stage));
    toast({ title: `Removed attachment from Stage ${stage}` });
  }, [toast]);

  const getAttachmentForStage = useCallback((stage: number): Attachment | undefined => {
    return attachments.find(a => a.stage === stage);
  }, [attachments]);

  // Handle "Use as Panorama Input" - opens modal
  const handleUsePanoramaClick = useCallback((creation: Creation) => {
    setAttachModalCreation(creation);
    setAttachModalPreviewUrl(imagePreviews[creation.id] || "");
    setAttachModalDestination("panorama");
    setAttachModalOpen(true);
  }, [imagePreviews]);

  // Handle "Edit / Modify" - opens modal
  const handleEditClick = useCallback((creation: Creation) => {
    setAttachModalCreation(creation);
    setAttachModalPreviewUrl(imagePreviews[creation.id] || "");
    setAttachModalDestination("edit");
    setAttachModalOpen(true);
  }, [imagePreviews]);

  // Confirm attach action
  const handleConfirmAttach = useCallback(() => {
    if (!attachModalCreation) return;
    
    if (attachModalDestination === "panorama") {
      if (onUsePanorama) {
        onUsePanorama(attachModalCreation.id);
      }
    } else if (attachModalDestination === "edit") {
      if (onEditImage) {
        onEditImage(attachModalCreation.id);
      }
    }
    
    setAttachModalOpen(false);
    setAttachModalCreation(null);
  }, [attachModalCreation, attachModalDestination, onUsePanorama, onEditImage]);

  // Handle download full quality
  const handleDownloadFullQuality = useCallback(async (creation: Creation) => {
    if (downloadingId) return; // Prevent concurrent downloads
    
    setDownloadingId(creation.id);
    
    try {
      // Generate a clean filename
      const ext = creation.path.split('.').pop() || 'png';
      const cleanFilename = `RETOUR_creation_${creation.id.slice(0, 8)}_full.${ext}`;
      
      // Get signed download URL
      const result = await getSignedDownloadUrl(creation.bucket, creation.path, cleanFilename);
      
      if (!result?.signedUrl) {
        throw new Error("Failed to generate download URL");
      }
      
      // Trigger browser download
      const link = document.createElement('a');
      link.href = result.signedUrl;
      link.download = cleanFilename;
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      toast({
        title: "Downloading full-quality file…",
        description: cleanFilename
      });
    } catch (error) {
      console.error("Download failed:", error);
      toast({
        title: "Download failed",
        description: error instanceof Error ? error.message : "Full-quality file not available",
        variant: "destructive"
      });
    } finally {
      setDownloadingId(null);
    }
  }, [downloadingId, getSignedDownloadUrl, toast]);

  const renderCreation = useCallback((creation: Creation) => {
    const isAttached = attachments.some(a => a.uploadId === creation.id);
    const previewUrl = imagePreviews[creation.id];
    const isSelected = selectedIds.has(creation.id);
    const isDownloading = downloadingId === creation.id;

    return (
      <CreationCard
        creation={creation}
        previewUrl={previewUrl}
        isAttached={isAttached}
        isSelectionMode={isSelectionMode}
        isSelected={isSelected}
        onToggleSelect={() => handleToggleSelect(creation.id)}
        onStartPipelineFromStep={(stage) => handleStartPipelineFromStep(creation, stage)}
        onEdit={() => handleEditClick(creation)}
        onViewLarge={() => {
          if (previewUrl) {
            setViewLargeUrl(previewUrl);
            setViewLargeFilename(creation.original_filename || `Output ${creation.id.slice(0, 8)}`);
            setViewLargeOpen(true);
          }
        }}
        onUsePanorama={() => handleUsePanoramaClick(creation)}
        onDelete={() => handleDeleteRequest(creation)}
        onDownloadFullQuality={() => handleDownloadFullQuality(creation)}
        isDownloading={isDownloading}
      />
    );
  }, [attachments, imagePreviews, selectedIds, isSelectionMode, downloadingId, handleToggleSelect, handleStartPipelineFromStep, handleEditClick, handleUsePanoramaClick, handleDeleteRequest, handleDownloadFullQuality]);

  // Separate pipeline creations from other creations for folder view
  const pipelineCreations = useMemo(() => 
    creations.filter(c => c.source_type === "pipeline_step"),
    [creations]
  );

  const otherCreations = useMemo(() => 
    creations.filter(c => c.source_type !== "pipeline_step"),
    [creations]
  );

  return (
    <div className="space-y-6">
      {/* Selection Mode Toolbar - Sticky when at least 1 selected */}
      {isSelectionMode && selectedIds.size > 0 && (
        <div className="sticky top-0 z-20 bg-background/95 backdrop-blur border rounded-lg p-3 shadow-lg flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Badge variant="secondary" className="text-sm">
              Selected: {selectedIds.size}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button 
              size="sm" 
              onClick={handleAttachToPanorama}
              disabled={selectedIds.size === 0}
            >
              <ImagePlus className="h-4 w-4 mr-2" />
              Attach to Panorama {selectedIds.size > 1 && "(Batch)"}
            </Button>
            <Button 
              size="sm" 
              variant="outline"
              onClick={handleAttachToEdit}
              disabled={selectedIds.size === 0}
            >
              <Wand2 className="h-4 w-4 mr-2" />
              Attach to Image Editing
            </Button>
            <Button 
              size="sm" 
              variant="outline"
              onClick={handleAttachToVirtualTour}
              disabled={selectedIds.size === 0 || !onAttachMultiToVirtualTour}
            >
              <Box className="h-4 w-4 mr-2" />
              Attach to Virtual Tour
            </Button>
            <Button 
              size="sm" 
              variant="ghost"
              onClick={handleClearSelection}
            >
              <X className="h-4 w-4 mr-2" />
              Clear
            </Button>
            <Button 
              size="sm" 
              variant="destructive"
              onClick={handleBulkDeleteRequest}
              disabled={selectedIds.size === 0}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete Selected ({selectedIds.size})
            </Button>
          </div>
        </div>
      )}

      {/* Attachments Summary */}
      {attachments.length > 0 && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Paperclip className="h-4 w-4 text-primary" />
              Active Attachments
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              {[1, 2, 3, 4].map(stage => {
                const attachment = getAttachmentForStage(stage);
                const stageLabel = stage === 1 ? "Step 1 (Top-Down)" : stage === 2 ? "Step 2 (Design)" : stage === 3 ? "Step 3 (Camera)" : "Step 4 (Panorama)";
                return (
                  <div key={stage} className="flex items-center gap-2">
                    <Badge variant={attachment ? "default" : "outline"} className="px-3 py-1">
                      {stageLabel}
                      {attachment && (
                        <>
                          <span className="mx-2 text-xs opacity-75">→</span>
                          <span className="text-xs max-w-[100px] truncate">{attachment.filename}</span>
                          <button
                            onClick={() => handleRemoveAttachment(stage)}
                            className="ml-2 hover:text-destructive"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </>
                      )}
                    </Badge>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Creations Grid */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Image className="h-5 w-5" />
                {viewMode === "all" ? `All Creations (${creations.length})` : "Pipeline Runs"}
              </CardTitle>
              <CardDescription>
                {viewMode === "all" 
                  ? "All images generated across pipelines and jobs. Use these as inputs for other stages."
                  : "Pipeline outputs organized by run and generation step."
                }
              </CardDescription>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {/* View mode toggle */}
              <CreationsViewToggle
                viewMode={viewMode}
                onViewModeChange={handleViewModeChange}
                pipelineCount={pipelineCreations.length}
                otherCount={otherCreations.length}
              />
              {/* Selection mode toggle */}
              <Button 
                variant={isSelectionMode ? "default" : "outline"} 
                size="sm"
                onClick={handleToggleSelectionMode}
              >
                <CheckSquare className="h-4 w-4 mr-2" />
                {isSelectionMode ? "Exit Select" : "Select"}
              </Button>
              {/* Thumbnail size slider */}
              <div className="flex items-center gap-3 min-w-[180px]">
                <Label className="text-xs text-muted-foreground whitespace-nowrap">Size</Label>
                <Slider
                  value={[thumbnailSize]}
                  onValueChange={handleThumbnailSizeChange}
                  min={THUMBNAIL_SIZES.min}
                  max={THUMBNAIL_SIZES.max}
                  step={20}
                  className="w-24"
                />
                <span className="text-xs text-muted-foreground w-8">{thumbnailSize}px</span>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : viewMode === "folders" ? (
            /* Folder view - Pipeline Runs organized by run and step */
            <PipelineRunsFolder
              creations={pipelineCreations as PipelineCreation[]}
              imagePreviews={imagePreviews}
              thumbnailSize={thumbnailSize}
              isSelectionMode={isSelectionMode}
              selectedIds={selectedIds}
              onToggleSelect={handleToggleSelect}
              renderCreation={renderCreation}
              projectId={projectId}
            />
          ) : (
            /* Flat grid view - All creations */
            <VirtualizedImageGrid
              items={creations}
              renderItem={renderCreation}
              getKey={(c) => c.id}
              pageSize={24}
              thumbnailSize={thumbnailSize}
              emptyMessage={
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <Layers className="h-12 w-12 mb-4" />
                  <p>No creations yet</p>
                  <p className="text-sm">Run some pipeline steps or render jobs to generate images</p>
                </div>
              }
            />
          )}
        </CardContent>
      </Card>

      {/* Attach From Creations Modal */}
      <Dialog open={attachModalOpen} onOpenChange={setAttachModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Paperclip className="h-5 w-5" />
              ATTACH FROM CREATIONS
            </DialogTitle>
            <DialogDescription>
              {attachModalDestination === "panorama" 
                ? "Use this image as input for the Panorama workflow."
                : "Use this image for editing and modifications."}
            </DialogDescription>
          </DialogHeader>
          
          {attachModalCreation && (
            <div className="space-y-4">
              {/* Image preview with checkmark */}
              <div className="relative aspect-video rounded-lg overflow-hidden bg-muted border-2 border-primary">
                {attachModalPreviewUrl ? (
                  <img 
                    src={attachModalPreviewUrl} 
                    alt="Selected creation"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="flex items-center justify-center h-full">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                )}
                {/* Checkmark indicator */}
                <div className="absolute top-2 left-2 bg-primary text-primary-foreground rounded-full p-1">
                  <Check className="h-4 w-4" />
                </div>
              </div>
              
              {/* Image info */}
              <div className="text-sm text-muted-foreground">
                <p className="font-medium text-foreground">
                  {attachModalCreation.original_filename || `Output ${attachModalCreation.id.slice(0, 8)}`}
                </p>
                <p className="text-xs">
                  Created {format(new Date(attachModalCreation.created_at), "MMM d, yyyy HH:mm")}
                </p>
              </div>
            </div>
          )}

          <DialogFooter className="flex gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setAttachModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleConfirmAttach}>
              <ArrowRight className="h-4 w-4 mr-2" />
              {attachModalDestination === "panorama" 
                ? "Use as Panorama Input" 
                : "Start Editing"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {bulkDeleteMode 
                ? `Delete ${selectedIds.size} images?` 
                : "Delete this creation?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {bulkDeleteMode ? (
                <>
                  This will permanently remove {selectedIds.size} images from your creations. This action cannot be undone.
                </>
              ) : (
                <>
                  This will permanently remove the image from your creations. This action cannot be undone.
                  {creationToDelete && attachments.some(a => a.uploadId === creationToDelete.id) && (
                    <span className="block mt-2 text-destructive/80">
                      ⚠️ This image is currently attached elsewhere. Deleting will remove that attachment.
                    </span>
                  )}
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleConfirmDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* View Large Image Dialog */}
      <Dialog open={viewLargeOpen} onOpenChange={setViewLargeOpen}>
        <DialogContent className="max-w-5xl max-h-[90vh] p-0 overflow-hidden">
          <DialogHeader className="absolute top-0 left-0 right-0 z-10 bg-gradient-to-b from-black/60 to-transparent p-4">
            <DialogTitle className="text-white">
              {viewLargeFilename}
            </DialogTitle>
          </DialogHeader>
          <button
            onClick={() => setViewLargeOpen(false)}
            className="absolute top-4 right-4 z-10 p-2 rounded-full bg-black/40 hover:bg-black/60 text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
          {viewLargeUrl && (
            <img
              src={viewLargeUrl}
              alt={viewLargeFilename}
              className="w-full h-full object-contain max-h-[85vh]"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
});
