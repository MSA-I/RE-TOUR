import { useState, useCallback, memo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { useMultiImagePanoramaJobs, useMultiImagePanoramaEvents, MultiImagePanoramaJob } from "@/hooks/useMultiImagePanoramaJobs";
import { useStorage } from "@/hooks/useStorage";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { LazyImage } from "@/components/LazyImage";
import { format } from "date-fns";
import { 
  Loader2, Play, Trash2, Image, ImagePlus, Check, X, 
  AlertTriangle, Layers, Eye, Maximize2, FlaskConical
} from "lucide-react";

interface MultiImagePanoramaTabProps {
  projectId: string;
  creationsAttachments?: Array<{ uploadId: string; filename: string; previewUrl?: string }>;
  onClearAttachments?: () => void;
}

const statusColors: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  running: "bg-blue-500/20 text-blue-400",
  completed: "bg-green-500/20 text-green-400",
  failed: "bg-destructive/20 text-destructive",
};

// Job card component
const JobCard = memo(function JobCard({
  job,
  onStart,
  onDelete,
  onViewOutput,
  isStarting,
  isDeleting,
  inputPreviews,
  outputPreview,
}: {
  job: MultiImagePanoramaJob;
  onStart: () => void;
  onDelete: () => void;
  onViewOutput: () => void;
  isStarting: boolean;
  isDeleting: boolean;
  inputPreviews: Record<string, string>;
  outputPreview?: string;
}) {
  const events = useMultiImagePanoramaEvents(job.status === "running" ? job.id : null);
  const latestEvent = events[events.length - 1];
  const inputCount = (job.input_upload_ids || []).length;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Multi-Image Panorama</CardTitle>
            <Badge variant="outline" className="text-xs">
              Experimental
            </Badge>
          </div>
          <Badge className={statusColors[job.status] || statusColors.pending}>
            {job.status}
          </Badge>
        </div>
        <CardDescription className="text-xs">
          {format(new Date(job.created_at), "MMM d, yyyy HH:mm")} • {inputCount} source images
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Input images grid */}
        <div>
          <Label className="text-xs text-muted-foreground mb-2 block">Source Images (Evidence)</Label>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {(job.input_upload_ids || []).slice(0, 5).map((uploadId, idx) => (
              <div key={uploadId} className="relative w-16 h-16 rounded border bg-muted flex-shrink-0 overflow-hidden">
                {inputPreviews[uploadId] ? (
                  <img
                    src={inputPreviews[uploadId]}
                    alt={`Input ${idx + 1}`}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Image className="h-4 w-4 text-muted-foreground" />
                  </div>
                )}
              </div>
            ))}
            {inputCount > 5 && (
              <div className="w-16 h-16 rounded border bg-muted flex-shrink-0 flex items-center justify-center">
                <span className="text-xs text-muted-foreground">+{inputCount - 5}</span>
              </div>
            )}
          </div>
        </div>

        {/* Progress / Events */}
        {job.status === "running" && (
          <div className="space-y-2">
            <Progress value={job.progress_int || 0} className="h-2" />
            {latestEvent && (
              <p className="text-xs text-muted-foreground truncate">
                {latestEvent.message}
              </p>
            )}
          </div>
        )}

        {/* Output preview */}
        {job.status === "completed" && outputPreview && (
          <div>
            <Label className="text-xs text-muted-foreground mb-2 block">Output (Evidence-Based)</Label>
            <div 
              className="relative aspect-[2/1] rounded border overflow-hidden cursor-pointer group"
              onClick={onViewOutput}
            >
              <img
                src={outputPreview}
                alt="Generated panorama"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <Maximize2 className="h-6 w-6 text-white" />
              </div>
              <Badge className="absolute bottom-2 left-2 bg-green-600/80 text-white text-xs">
                Evidence-Based
              </Badge>
            </div>
          </div>
        )}

        {/* Error display */}
        {job.status === "failed" && job.last_error && (
          <div className="flex items-start gap-2 p-3 rounded bg-destructive/10 border border-destructive/30">
            <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
            <p className="text-xs text-destructive">{job.last_error}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          {job.status === "pending" && (
            <Button size="sm" onClick={onStart} disabled={isStarting}>
              {isStarting ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Play className="h-4 w-4 mr-1" />
              )}
              Generate
            </Button>
          )}
          {job.status === "completed" && (
            <Button size="sm" variant="outline" onClick={onViewOutput}>
              <Eye className="h-4 w-4 mr-1" />
              View
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive ml-auto"
            onClick={onDelete}
            disabled={isDeleting || job.status === "running"}
          >
            {isDeleting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
});

export const MultiImagePanoramaTab = memo(function MultiImagePanoramaTab({
  projectId,
  creationsAttachments = [],
  onClearAttachments,
}: MultiImagePanoramaTabProps) {
  const { jobs, isLoading, createJob, startJob, deleteJob } = useMultiImagePanoramaJobs(projectId);
  const { getSignedViewUrl } = useStorage();
  const { toast } = useToast();

  // Local state
  const [selectedImages, setSelectedImages] = useState<Set<string>>(new Set());
  const [imagePreviews, setImagePreviews] = useState<Record<string, string>>({});
  const [isCreating, setIsCreating] = useState(false);
  const [startingJobId, setStartingJobId] = useState<string | null>(null);
  const [deletingJobId, setDeletingJobId] = useState<string | null>(null);
  const [cameraPosition, setCameraPosition] = useState("center of the main living space at eye-level");
  const [forwardDirection, setForwardDirection] = useState("toward the primary focal point");

  // View large modal
  const [viewLargeOpen, setViewLargeOpen] = useState(false);
  const [viewLargeUrl, setViewLargeUrl] = useState("");

  // Load previews for attachments
  const loadPreview = useCallback(async (uploadId: string) => {
    if (imagePreviews[uploadId]) return;

    try {
      const { data: upload } = await supabase
        .from("uploads")
        .select("bucket, path")
        .eq("id", uploadId)
        .single();

      if (upload) {
        const { signedUrl } = await getSignedViewUrl(upload.bucket, upload.path);
        if (signedUrl) {
          setImagePreviews((prev) => ({ ...prev, [uploadId]: signedUrl }));
        }
      }
    } catch (e) {
      console.error("Failed to load preview:", e);
    }
  }, [getSignedViewUrl, imagePreviews]);

  // Initialize selected from attachments
  useState(() => {
    if (creationsAttachments.length > 0) {
      const ids = new Set(creationsAttachments.map((a) => a.uploadId));
      setSelectedImages(ids);
      creationsAttachments.forEach((a) => {
        if (a.previewUrl) {
          setImagePreviews((prev) => ({ ...prev, [a.uploadId]: a.previewUrl! }));
        } else {
          loadPreview(a.uploadId);
        }
      });
    }
  });

  // Toggle image selection
  const toggleImage = (uploadId: string) => {
    setSelectedImages((prev) => {
      const next = new Set(prev);
      if (next.has(uploadId)) {
        next.delete(uploadId);
      } else {
        next.add(uploadId);
      }
      return next;
    });
  };

  // Create new job
  const handleCreateJob = async () => {
    if (selectedImages.size < 2) {
      toast({
        title: "Select at least 2 images",
        description: "Multi-image panorama requires multiple source images for spatial evidence.",
        variant: "destructive",
      });
      return;
    }

    setIsCreating(true);
    try {
      const newJob = await createJob.mutateAsync({
        inputUploadIds: Array.from(selectedImages),
        cameraPosition: cameraPosition.trim() || undefined,
        forwardDirection: forwardDirection.trim() || undefined,
      });

      toast({ title: "Job created", description: "Click Generate to start panorama creation." });
      setSelectedImages(new Set());
      onClearAttachments?.();
    } catch (error) {
      toast({
        title: "Failed to create job",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsCreating(false);
    }
  };

  // Start job
  const handleStartJob = async (jobId: string) => {
    setStartingJobId(jobId);
    try {
      await startJob.mutateAsync(jobId);
    } finally {
      setStartingJobId(null);
    }
  };

  // Delete job
  const handleDeleteJob = async (jobId: string) => {
    setDeletingJobId(jobId);
    try {
      await deleteJob.mutateAsync(jobId);
    } finally {
      setDeletingJobId(null);
    }
  };

  // View output
  const handleViewOutput = async (job: MultiImagePanoramaJob) => {
    if (!job.output_upload_id) return;

    try {
      const { data: upload } = await supabase
        .from("uploads")
        .select("bucket, path")
        .eq("id", job.output_upload_id)
        .single();

      if (upload) {
        const { signedUrl } = await getSignedViewUrl(upload.bucket, upload.path);
        if (signedUrl) {
          setViewLargeUrl(signedUrl);
          setViewLargeOpen(true);
        }
      }
    } catch (e) {
      console.error("Failed to load output:", e);
    }
  };

  // Get output preview for a job
  const getOutputPreview = (job: MultiImagePanoramaJob): string | undefined => {
    if (!job.output_upload_id) return undefined;
    return imagePreviews[job.output_upload_id];
  };

  // Load output previews for completed jobs
  jobs.forEach((job) => {
    if (job.status === "completed" && job.output_upload_id && !imagePreviews[job.output_upload_id]) {
      loadPreview(job.output_upload_id);
    }
    // Load input previews
    (job.input_upload_ids || []).forEach((id) => {
      if (!imagePreviews[id]) loadPreview(id);
    });
  });

  return (
    <div className="space-y-6">
      {/* Header with experimental badge */}
      <div className="flex items-center gap-3">
        <FlaskConical className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold">Multi-Image Panorama</h2>
        <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30">
          Experimental
        </Badge>
      </div>

      {/* Description */}
      <Card className="bg-muted/30 border-dashed">
        <CardContent className="py-4">
          <p className="text-sm text-muted-foreground">
            Generate a TRUE 360° panorama from <strong>multiple reference images</strong>. 
            Unlike standard generation, this feature treats your images as <strong>spatial evidence</strong> — 
            the AI will NOT invent rooms, furniture, or spaces not visible in your references.
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            <strong>Principle:</strong> Better incomplete truth than complete fiction.
          </p>
        </CardContent>
      </Card>

      {/* Create new job section */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ImagePlus className="h-4 w-4" />
            Create New Panorama
          </CardTitle>
          <CardDescription>
            Select 2+ images from Creations to use as spatial evidence
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Selected images */}
          {creationsAttachments.length > 0 && (
            <div>
              <Label className="text-xs text-muted-foreground mb-2 block">
                Attached from Creations ({creationsAttachments.length})
              </Label>
              <div className="flex gap-2 flex-wrap">
                {creationsAttachments.map((attachment) => (
                  <div
                    key={attachment.uploadId}
                    className={`relative w-20 h-20 rounded border overflow-hidden cursor-pointer transition-all ${
                      selectedImages.has(attachment.uploadId)
                        ? "ring-2 ring-primary border-primary"
                        : "hover:border-muted-foreground"
                    }`}
                    onClick={() => toggleImage(attachment.uploadId)}
                  >
                    {attachment.previewUrl || imagePreviews[attachment.uploadId] ? (
                      <img
                        src={attachment.previewUrl || imagePreviews[attachment.uploadId]}
                        alt={attachment.filename}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-muted">
                        <Image className="h-4 w-4 text-muted-foreground" />
                      </div>
                    )}
                    {selectedImages.has(attachment.uploadId) && (
                      <div className="absolute top-1 right-1 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                        <Check className="h-3 w-3 text-primary-foreground" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {creationsAttachments.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 text-center border-2 border-dashed rounded-lg">
              <Layers className="h-8 w-8 text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">
                Go to <strong>Creations</strong> tab and select images to attach
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Use "Attach To" → "Multi-Image Panorama"
              </p>
            </div>
          )}

          {/* Camera settings */}
          {selectedImages.size >= 2 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="camera-position" className="text-xs">
                  Camera Position
                </Label>
                <Input
                  id="camera-position"
                  value={cameraPosition}
                  onChange={(e) => setCameraPosition(e.target.value)}
                  placeholder="e.g., center of living room at eye-level"
                  className="text-sm"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="forward-direction" className="text-xs">
                  Forward Direction (0° yaw)
                </Label>
                <Input
                  id="forward-direction"
                  value={forwardDirection}
                  onChange={(e) => setForwardDirection(e.target.value)}
                  placeholder="e.g., toward the main window"
                  className="text-sm"
                />
              </div>
            </div>
          )}

          {/* Create button */}
          <Button
            onClick={handleCreateJob}
            disabled={selectedImages.size < 2 || isCreating}
            className="w-full"
          >
            {isCreating ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <ImagePlus className="h-4 w-4 mr-2" />
            )}
            Create Job ({selectedImages.size} images selected)
          </Button>
        </CardContent>
      </Card>

      {/* Jobs list */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-muted-foreground">Jobs</h3>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : jobs.length === 0 ? (
          <Card className="py-8">
            <CardContent className="flex flex-col items-center justify-center text-center">
              <FlaskConical className="h-8 w-8 text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">No panorama jobs yet</p>
              <p className="text-xs text-muted-foreground">Create one above to get started</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {jobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                onStart={() => handleStartJob(job.id)}
                onDelete={() => handleDeleteJob(job.id)}
                onViewOutput={() => handleViewOutput(job)}
                isStarting={startingJobId === job.id}
                isDeleting={deletingJobId === job.id}
                inputPreviews={imagePreviews}
                outputPreview={getOutputPreview(job)}
              />
            ))}
          </div>
        )}
      </div>

      {/* View large modal */}
      <Dialog open={viewLargeOpen} onOpenChange={setViewLargeOpen}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden p-0">
          <div className="relative w-full h-full">
            <img
              src={viewLargeUrl}
              alt="Multi-image panorama output"
              className="w-full h-auto max-h-[85vh] object-contain"
            />
            <Badge className="absolute bottom-4 left-4 bg-green-600/90 text-white">
              Multi-Image Panorama (Evidence-Based)
            </Badge>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
});
