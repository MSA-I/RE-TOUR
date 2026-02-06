import { useState, useCallback, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DropZone } from "@/components/ui/drop-zone";
import { useVirtualTourJobs } from "@/hooks/useVirtualTourJobs";
import { useUploads } from "@/hooks/useUploads";
import { useStorage } from "@/hooks/useStorage";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { 
  Upload, Image, Play, Check, Loader2, Trash2, 
  Eye, Layers, ImagePlus, Box, RotateCcw, ZoomIn, ZoomOut, Maximize2
} from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

interface VirtualTourTabProps {
  projectId: string;
  creationsAttachments?: Array<{
    uploadId: string;
    filename: string;
    previewUrl?: string;
  }>;
  onClearAttachments?: () => void;
}

const MAX_IMAGES = 100;

const statusColors: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  processing: "bg-blue-500/20 text-blue-400",
  preview_ready: "bg-yellow-500/20 text-yellow-400",
  completed: "bg-green-500/20 text-green-400",
  failed: "bg-destructive/20 text-destructive"
};

export function VirtualTourTab({ projectId, creationsAttachments = [], onClearAttachments }: VirtualTourTabProps) {
  const { jobs, isLoading, createJob, startProcessing, completeJob, deleteJob } = useVirtualTourJobs(projectId);
  const { uploads: panoramas, createUpload } = useUploads(projectId, "panorama");
  const { getSignedViewUrl } = useStorage();
  const { toast } = useToast();
  
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [selectedImageIds, setSelectedImageIds] = useState<string[]>([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [imagePreviews, setImagePreviews] = useState<Record<string, string>>({});
  const [attachDialogOpen, setAttachDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  // Count attached images from Creations (images only, not panoramas)
  const attachedCount = creationsAttachments.length;
  const totalSelected = selectedImageIds.length + attachedCount;

  const handleFileUpload = useCallback(async (files: FileList | null) => {
    if (!files) return;
    
    const remaining = MAX_IMAGES - totalSelected;
    if (remaining <= 0) {
      toast({ title: `Maximum ${MAX_IMAGES} images allowed`, variant: "destructive" });
      return;
    }

    const filesToUpload = Array.from(files).slice(0, remaining);
    setUploading(true);
    
    try {
      for (const file of filesToUpload) {
        await createUpload.mutateAsync({ file, kind: "panorama" });
      }
      toast({ title: `${filesToUpload.length} file(s) uploaded` });
    } catch (error) {
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
    } finally {
      setUploading(false);
    }
  }, [createUpload, toast, totalSelected]);

  const handleToggleSelect = (id: string) => {
    if (!selectionMode) return;
    
    if (selectedImageIds.includes(id)) {
      setSelectedImageIds(prev => prev.filter(i => i !== id));
    } else {
      if (totalSelected >= MAX_IMAGES) {
        toast({ title: `Maximum ${MAX_IMAGES} images allowed`, variant: "destructive" });
        return;
      }
      setSelectedImageIds(prev => [...prev, id]);
    }
  };

  const handleCreateTour = async () => {
    // Combine selected panoramas + attached from Creations
    const allAssetIds = [
      ...selectedImageIds,
      ...creationsAttachments.map(a => a.uploadId)
    ];

    if (allAssetIds.length === 0) {
      toast({ title: "Select at least one image", variant: "destructive" });
      return;
    }

    if (allAssetIds.length > MAX_IMAGES) {
      toast({ title: `Maximum ${MAX_IMAGES} images allowed`, variant: "destructive" });
      return;
    }

    setIsCreating(true);
    try {
      const inputType = selectedImageIds.length > 0 && creationsAttachments.length > 0 
        ? "mixed" 
        : creationsAttachments.length > 0 
          ? "attach" 
          : "upload";

      const newJob = await createJob.mutateAsync({
        inputAssetIds: allAssetIds,
        inputType
      });

      // Auto-start processing for MVP
      await startProcessing.mutateAsync(newJob.id);

      // Clear selection
      setSelectedImageIds([]);
      setSelectionMode(false);
      onClearAttachments?.();
    } catch (error) {
      // Error already handled by hook
    } finally {
      setIsCreating(false);
    }
  };

  const handleComplete = async (jobId: string) => {
    await completeJob.mutateAsync(jobId);
  };

  // Load image previews
  const loadPreview = useCallback(async (uploadId: string, bucket: string, path: string) => {
    if (imagePreviews[uploadId]) return;
    
    try {
      const { signedUrl } = await getSignedViewUrl(bucket, path);
      if (signedUrl) {
        setImagePreviews(prev => ({ ...prev, [uploadId]: signedUrl }));
      }
    } catch (error) {
      console.error("Failed to load preview:", error);
    }
  }, [getSignedViewUrl, imagePreviews]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const isComingSoon = true; // Feature flag for Coming Soon state

  return (
    <div className="space-y-6">
      {/* Header with Coming Soon badge */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Box className="h-5 w-5" />
            Virtual Tour
            <Badge variant="secondary" className="ml-2 bg-primary/20 text-primary">
              Coming Soon
            </Badge>
          </h2>
          <p className="text-sm text-muted-foreground">
            This feature will allow combining up to {MAX_IMAGES} images into a full virtual tour. Infrastructure is being prepared.
          </p>
        </div>
        <Badge variant="outline" className="text-lg px-3 py-1 opacity-50">
          Selected: {totalSelected} / {MAX_IMAGES}
        </Badge>
      </div>

      {/* Input Section */}
      <DropZone
        onFilesDropped={(files) => handleFileUpload(files)}
        accept="image/*"
        multiple
        disabled={isComingSoon || uploading || totalSelected >= MAX_IMAGES}
        isUploading={uploading}
        maxFiles={MAX_IMAGES}
        currentCount={totalSelected}
      >
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add Images</CardTitle>
            <CardDescription>
              Upload panoramas or attach images from Creations (drag & drop supported)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Upload button */}
            <div className="flex items-center gap-3">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <DropZone.Button
                      variant="outline"
                      disabled={isComingSoon || uploading || totalSelected >= MAX_IMAGES}
                      isUploading={uploading}
                      className="opacity-50 cursor-not-allowed"
                    >
                      Upload Images
                    </DropZone.Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>Coming Soon</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button
                      variant="outline"
                      onClick={() => !isComingSoon && setSelectionMode(!selectionMode)}
                      disabled={isComingSoon}
                      className="opacity-50 cursor-not-allowed"
                    >
                      <ImagePlus className="h-4 w-4 mr-2" />
                      {selectionMode ? "Done Selecting" : "Select from Uploads"}
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>Coming Soon</TooltipContent>
              </Tooltip>
            </div>

          {/* Attached from Creations indicator */}
          {attachedCount > 0 && (
            <div className="flex items-center gap-2 p-3 bg-primary/10 rounded-lg">
              <Layers className="h-4 w-4 text-primary" />
              <span className="text-sm">{attachedCount} image(s) attached from Creations</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={onClearAttachments}
              >
                Clear
              </Button>
            </div>
          )}

          {/* Image selection grid */}
          {selectionMode && panoramas.length > 0 && (
            <div className="border rounded-lg p-3">
              <p className="text-xs text-muted-foreground mb-2">
                Click images to select (selected: {selectedImageIds.length})
              </p>
              <ScrollArea className="h-48">
                <div className="grid grid-cols-6 gap-2">
                  {panoramas.map((p) => {
                    const isSelected = selectedImageIds.includes(p.id);
                    if (!imagePreviews[p.id]) {
                      loadPreview(p.id, p.bucket, p.path);
                    }
                    return (
                      <div
                        key={p.id}
                        className={`relative aspect-square rounded-lg overflow-hidden cursor-pointer border-2 transition-all ${
                          isSelected ? "border-primary ring-2 ring-primary/50" : "border-transparent hover:border-muted-foreground/50"
                        }`}
                        onClick={() => handleToggleSelect(p.id)}
                      >
                        {imagePreviews[p.id] ? (
                          <img
                            src={imagePreviews[p.id]}
                            alt={p.original_filename || ""}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full bg-muted flex items-center justify-center">
                            <Image className="h-4 w-4 text-muted-foreground" />
                          </div>
                        )}
                        {isSelected && (
                          <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                            <Check className="h-6 w-6 text-primary" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </div>
          )}

          {/* Create Tour button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="w-full">
                <Button
                  className="w-full opacity-50 cursor-not-allowed"
                  size="lg"
                  onClick={handleCreateTour}
                  disabled={isComingSoon || isCreating || totalSelected === 0}
                >
                  {isCreating ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4 mr-2" />
                  )}
                  Create Virtual Tour Job
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>Coming Soon</TooltipContent>
          </Tooltip>

          {/* 3D Viewer Scaffold placeholder (Coming Soon) */}
          <div className="mt-6">
            <h4 className="text-sm font-medium mb-2 text-muted-foreground">3D Viewer Preview</h4>
            <div className="aspect-video bg-muted/30 rounded-lg border border-dashed border-border flex items-center justify-center">
              <div className="text-center space-y-2">
                <Box className="h-12 w-12 text-muted-foreground/50 mx-auto" />
                <p className="text-sm text-muted-foreground/70">3D Viewer will appear here</p>
                <Badge variant="outline" className="text-xs">Coming Soon</Badge>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
      </DropZone>

      {/* Jobs List */}
      {jobs.length > 0 && (
        <div className="space-y-4">
          <h3 className="font-medium">Your Virtual Tours</h3>
          {jobs.map((job) => (
            <VirtualTourJobCard
              key={job.id}
              job={job}
              onComplete={() => handleComplete(job.id)}
              onDelete={() => deleteJob.mutateAsync(job.id)}
              isCompleting={completeJob.isPending}
              isDeleting={deleteJob.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface VirtualTourJobCardProps {
  job: {
    id: string;
    status: string;
    input_asset_ids: string[];
    input_type: string;
    created_at: string;
    updated_at: string;
    last_error: string | null;
  };
  onComplete: () => void;
  onDelete: () => void;
  isCompleting: boolean;
  isDeleting: boolean;
}

function VirtualTourJobCard({ job, onComplete, onDelete, isCompleting, isDeleting }: VirtualTourJobCardProps) {
  const isPreviewReady = job.status === "preview_ready";
  const isCompleted = job.status === "completed";
  const isFailed = job.status === "failed";

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <Box className="h-4 w-4 text-muted-foreground" />
            Virtual Tour
          </CardTitle>
          <CardDescription>
            {job.input_asset_ids.length} images • {job.input_type} • Created {format(new Date(job.created_at), "MMM d, yyyy HH:mm")}
          </CardDescription>
        </div>
        <Badge className={statusColors[job.status]}>
          {job.status.replace("_", " ")}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 3D Viewer Window (scaffold) */}
        <div className="aspect-video bg-black/50 rounded-lg border border-border flex items-center justify-center relative overflow-hidden">
          {isCompleted || isPreviewReady ? (
            <>
              <div className="text-center space-y-2">
                <Box className="h-16 w-16 text-muted-foreground mx-auto animate-pulse" />
                <p className="text-sm text-muted-foreground">
                  {isCompleted ? "Tour Completed" : "Viewer Ready"}
                </p>
                <p className="text-xs text-muted-foreground/70">
                  3D viewer integration coming soon
                </p>
              </div>
              {/* Viewer controls placeholder */}
              <div className="absolute bottom-3 right-3 flex items-center gap-1">
                <Button size="icon" variant="ghost" className="h-8 w-8 bg-black/50">
                  <ZoomOut className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" className="h-8 w-8 bg-black/50">
                  <ZoomIn className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" className="h-8 w-8 bg-black/50">
                  <RotateCcw className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" className="h-8 w-8 bg-black/50">
                  <Maximize2 className="h-4 w-4" />
                </Button>
              </div>
            </>
          ) : isFailed ? (
            <div className="text-center space-y-2">
              <p className="text-sm text-destructive">Processing failed</p>
              {job.last_error && (
                <p className="text-xs text-muted-foreground">{job.last_error}</p>
              )}
            </div>
          ) : (
            <div className="text-center space-y-2">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mx-auto" />
              <p className="text-sm text-muted-foreground">Processing...</p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {isPreviewReady && !isCompleted && (
            <Button
              className="flex-1 bg-green-600 hover:bg-green-700"
              onClick={onComplete}
              disabled={isCompleting}
            >
              {isCompleting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Check className="h-4 w-4 mr-2" />
              )}
              COMPLETE
            </Button>
          )}
          
          {isCompleted && (
            <div className="flex-1 text-center py-2 px-4 bg-green-500/10 rounded-lg text-green-500 text-sm font-medium">
              ✓ Project Completed
            </div>
          )}

          {!isCompleted && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="icon" className="text-destructive">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Virtual Tour?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will delete the virtual tour job. The source images will not be affected.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={onDelete}
                    disabled={isDeleting}
                  >
                    {isDeleting ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : null}
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
