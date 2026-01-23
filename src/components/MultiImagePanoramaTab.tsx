import { useState, useCallback, memo, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { useMultiImagePanoramaJobs, useMultiImagePanoramaEvents, MultiImagePanoramaJob } from "@/hooks/useMultiImagePanoramaJobs";
import { useStorage } from "@/hooks/useStorage";
import { useUploads } from "@/hooks/useUploads";
import { usePromptComposer } from "@/hooks/usePromptComposer";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { LazyImage } from "@/components/LazyImage";
import { AspectRatioPreview, AspectRatioSelectItemContent } from "@/components/AspectRatioPreview";
import { ChangeSuggestionsPanel } from "@/components/ChangeSuggestionsPanel";
import { RenderJobTerminal } from "@/components/RenderJobTerminal";
import { format } from "date-fns";
import { 
  Loader2, Play, Trash2, Image, ImagePlus, Check, X, 
  AlertTriangle, Layers, Eye, Maximize2, FlaskConical, Terminal, Sparkles, Wand2,
  Columns, ThumbsUp, ThumbsDown, Copy, RotateCcw
} from "lucide-react";
import { BeforeAfterSlider } from "@/components/BeforeAfterSlider";

interface MultiImagePanoramaTabProps {
  projectId: string;
  creationsAttachments?: Array<{ uploadId: string; filename: string; previewUrl?: string }>;
  onClearAttachments?: () => void;
}

const statusColors: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  running: "bg-blue-500/20 text-blue-400",
  needs_review: "bg-amber-500/20 text-amber-400",
  approved: "bg-green-500/20 text-green-400",
  rejected: "bg-destructive/20 text-destructive",
  completed: "bg-amber-500/20 text-amber-400", // Backend finished, waiting for review
  failed: "bg-destructive/20 text-destructive",
};

// Job card component
const JobCard = memo(function JobCard({
  job,
  onStart,
  onDelete,
  onViewOutput,
  onUpdateStatus,
  isStarting,
  isDeleting,
  isUpdating,
  inputPreviews,
  outputPreview,
  onOpenTerminal,
  terminalIsOpen,
}: {
  job: MultiImagePanoramaJob;
  onStart: () => void;
  onDelete: () => void;
  onViewOutput: () => void;
  onUpdateStatus: (status: string) => void;
  isStarting: boolean;
  isDeleting: boolean;
  isUpdating: boolean;
  inputPreviews: Record<string, string>;
  outputPreview?: string;
  onOpenTerminal: (id: string) => void;
  terminalIsOpen: boolean;
}) {
  const events = useMultiImagePanoramaEvents(job.status === "running" ? job.id : null);
  const latestEvent = events[events.length - 1];
  const inputCount = (job.input_upload_ids || []).length;
  
  const [compareOpen, setCompareOpen] = useState(false);
  const [primaryInputId] = useState(() => job.input_upload_ids?.[0]);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Multi-Image Panorama</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            {job.status === "completed" && (
              <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30">
                Needs Review
              </Badge>
            )}
            <Badge className={statusColors[job.status] || statusColors.pending}>
              {job.status === "completed" ? "needs_review" : job.status}
            </Badge>
          </div>
        </div>
        <CardDescription className="text-xs">
          {format(new Date(job.created_at), "MMM d, yyyy HH:mm")} • {inputCount} source images
          {job.prompt_used && (
            <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground italic truncate">
              <Sparkles className="h-2.5 w-2.5 flex-shrink-0" />
              {job.prompt_used}
            </div>
          )}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Progress / Events */}
        {(job.status === "running" || terminalIsOpen) && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                {job.status === "running" ? (
                  <Loader2 className="h-3 w-3 animate-spin text-blue-400" />
                ) : (
                  <Terminal className="h-3 w-3 text-muted-foreground" />
                )}
                <span className="text-muted-foreground truncate max-w-[200px]">
                  {job.status === "running" ? (latestEvent?.message || "Processing...") : "Process Log"}
                </span>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[10px]"
                onClick={() => onOpenTerminal(job.id)}
              >
                <Terminal className="h-3 w-3 mr-1" />
                {terminalIsOpen ? "Hide Log" : "View Log"}
              </Button>
            </div>
            {job.status === "running" && <Progress value={job.progress_int || 0} className="h-2" />}
          </div>
        )}

        {/* Output preview & QA - visible if has output or failed */}
        {(outputPreview || job.status === "failed") && (
          <div className="space-y-3">
            {outputPreview && (
              <>
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground block">Output (Evidence-Based)</Label>
                  <div className="flex gap-2">
                    <Button 
                      size="sm" 
                      variant="outline" 
                      className="h-7 text-[10px]"
                      onClick={() => setCompareOpen(true)}
                    >
                      <Columns className="h-3 w-3 mr-1" />
                      Compare
                    </Button>
                    <Button 
                      size="sm" 
                      variant="ghost" 
                      className="h-7 text-[10px]"
                      onClick={() => onOpenTerminal(job.id)}
                    >
                      <Terminal className="h-3 w-3 mr-1" />
                      {terminalIsOpen ? "Hide Log" : "View Log"}
                    </Button>
                  </div>
                </div>
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
              </>
            )}

            {/* QA Controls - Visible for 'completed' (needs review) status */}
            {job.status === "completed" && (
              <div className="flex flex-col gap-3 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
                <div className="space-y-0.5">
                  <p className="text-xs font-medium text-amber-600 dark:text-amber-400 flex items-center gap-2">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    QA Review Required
                  </p>
                  <p className="text-[10px] text-muted-foreground">Verify consistency before adding to Jobs</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 text-green-600 border-green-600/20 hover:bg-green-600/10"
                    onClick={() => onUpdateStatus("approved")}
                    disabled={isUpdating}
                  >
                    <ThumbsUp className="h-3.5 w-3.5 mr-1.5" />
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 text-destructive border-destructive/20 hover:bg-destructive/10"
                    onClick={() => onUpdateStatus("rejected")}
                    disabled={isUpdating}
                  >
                    <ThumbsDown className="h-3.5 w-3.5 mr-1.5" />
                    Reject
                  </Button>
                </div>
              </div>
            )}

            {/* Re-review or Status info for approved/rejected */}
            {(job.status === "approved" || job.status === "rejected") && (
              <div className={`flex items-center justify-between p-2.5 rounded border ${
                job.status === "approved" ? "bg-green-500/5 border-green-500/20" : "bg-destructive/5 border-destructive/20"
              }`}>
                <div className="flex items-center gap-2">
                  {job.status === "approved" ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <X className="h-4 w-4 text-destructive" />
                  )}
                  <span className={`text-xs font-medium ${job.status === "approved" ? "text-green-600" : "text-destructive"}`}>
                    {job.status === "approved" ? "QA Approved" : "QA Rejected"}
                  </span>
                </div>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="h-7 text-[10px] text-muted-foreground"
                  onClick={() => onUpdateStatus("completed")} // Reset to review state
                  disabled={isUpdating}
                >
                  <RotateCcw className="h-3 w-3 mr-1" />
                  Change
                </Button>
              </div>
            )}

            {/* Error display */}
            {job.status === "failed" && job.last_error && (
              <div className="space-y-2">
                <div className="flex items-start gap-2 p-3 rounded bg-destructive/10 border border-destructive/30">
                  <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-destructive">{job.last_error}</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full text-xs"
                  onClick={() => onOpenTerminal(job.id)}
                >
                  <Terminal className="h-3.5 w-3.5 mr-2" />
                  View Process Log
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Source images grid */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Source Evidence</Label>
            {job.status === "pending" && (
              <Button 
                size="sm" 
                variant="ghost" 
                className="h-5 px-1.5 text-[10px]"
                onClick={() => onOpenTerminal(job.id)}
              >
                <Terminal className="h-3 w-3 mr-1" />
                Logs
              </Button>
            )}
          </div>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {(job.input_upload_ids || []).slice(0, 5).map((uploadId, idx) => (
              <div 
                key={uploadId} 
                className={`relative w-16 h-16 rounded border flex-shrink-0 overflow-hidden ${primaryInputId === uploadId ? 'ring-2 ring-primary' : 'bg-muted'}`}
              >
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
                {primaryInputId === uploadId && (
                  <div className="absolute bottom-0 left-0 right-0 bg-primary/80 text-[8px] text-white text-center py-0.5 font-bold">
                    PRIMARY
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

        {/* Comparison Dialog */}
        <Dialog open={compareOpen} onOpenChange={setCompareOpen}>
          <DialogContent className="max-w-5xl max-h-[90vh]">
            <DialogHeader>
              <DialogTitle>Compare Before/After</DialogTitle>
              <DialogDescription>
                Compare primary source image against the generated panorama.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              {primaryInputId && inputPreviews[primaryInputId] && outputPreview ? (
                <BeforeAfterSlider 
                  beforeImage={inputPreviews[primaryInputId]} 
                  afterImage={outputPreview}
                  beforeLabel="Primary Source"
                  afterLabel="Generated Panorama"
                />
              ) : (
                <div className="flex items-center justify-center h-64 bg-muted rounded">
                  <p className="text-sm text-muted-foreground">Comparison not available</p>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* Terminal render */}
        {terminalIsOpen && (
          <RenderJobTerminal jobId={job.id} isOpen={true} type="multi_image_panorama" />
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
          {outputPreview && (
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
  const { jobs, isLoading, createJob, startJob, deleteJob, updateJob } = useMultiImagePanoramaJobs(projectId);
  const { uploads, createUpload, deleteUpload } = useUploads(projectId, "panorama");
  const { getSignedViewUrl } = useStorage();
  const { composePrompt, isComposing: isPromptComposing } = usePromptComposer();
  const { toast } = useToast();

  // Local state
  const [selectedImages, setSelectedImages] = useState<Set<string>>(new Set());
  const [imagePreviews, setImagePreviews] = useState<Record<string, string>>({});
  const [isCreating, setIsCreating] = useState(false);
  const [startingJobId, setStartingJobId] = useState<string | null>(null);
  const [deletingJobId, setDeletingJobId] = useState<string | null>(null);
  const [updatingJobId, setUpdatingJobId] = useState<string | null>(null);
  const [terminalJobId, setTerminalJobId] = useState<string | null>(null);
  const [cameraPosition, setCameraPosition] = useState("center of the main living space at eye-level");
  const [forwardDirection, setForwardDirection] = useState("toward the primary focal point");
  const [selectedResolution, setSelectedResolution] = useState("2K");
  const [selectedRatio, setSelectedRatio] = useState("2:1");
  const [changeRequest, setChangeRequest] = useState("");
  const [composedPrompt, setComposedPrompt] = useState<string | null>(null);

  // View large modal
  const [viewLargeOpen, setViewLargeOpen] = useState(false);
  const [viewLargeUrl, setViewLargeUrl] = useState("");

  // Filter jobs
  const reviewJobs = jobs.filter(j => j.status !== "approved");
  const approvedJobs = jobs.filter(j => j.status === "approved");

  // Filter relevant uploads (only those that are in this project's panorama kind)
  // Creations already provides some, but we might have fresh uploads here
  const projectUploads = uploads;

  // Load previews for attachments and uploads
  const loadPreview = useCallback(async (uploadId: string, bucket: string, path: string) => {
    if (imagePreviews[uploadId]) return;
    try {
      const { signedUrl } = await getSignedViewUrl(bucket, path);
      if (signedUrl) {
        setImagePreviews((prev) => ({ ...prev, [uploadId]: signedUrl }));
      }
    } catch (e) {
      console.error("Failed to load preview:", e);
    }
  }, [getSignedViewUrl, imagePreviews]);

  // Load previews for jobs
  useEffect(() => {
    jobs.forEach(async (job) => {
      // Load output preview
      if (job.output_upload_id && !imagePreviews[job.output_upload_id]) {
        const { data: upload } = await supabase.from("uploads").select("bucket, path").eq("id", job.output_upload_id).single();
        if (upload) loadPreview(job.output_upload_id, upload.bucket, upload.path);
      }
      // Load input previews
      (job.input_upload_ids || []).forEach(async (id) => {
        if (!imagePreviews[id]) {
          const { data: upload } = await supabase.from("uploads").select("bucket, path").eq("id", id).single();
          if (upload) loadPreview(id, upload.bucket, upload.path);
        }
      });
    });
  }, [jobs, imagePreviews, loadPreview]);

  // Initialize selected from attachments
  useEffect(() => {
    if (creationsAttachments.length > 0) {
      const ids = new Set(selectedImages);
      creationsAttachments.forEach((a) => {
        ids.add(a.uploadId);
        if (a.previewUrl) {
          setImagePreviews((prev) => ({ ...prev, [a.uploadId]: a.previewUrl! }));
        }
      });
      setSelectedImages(ids);
    }
  }, [creationsAttachments]);

  // Handle file upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const uploadPromises = Array.from(files).map(file => 
      createUpload.mutateAsync({ file, kind: "panorama" })
    );

    try {
      const newUploads = await Promise.all(uploadPromises);
      const newIds = new Set(selectedImages);
      newUploads.forEach(u => newIds.add(u.id));
      setSelectedImages(newIds);
      toast({ title: `Uploaded ${files.length} images` });
    } catch (error) {
      toast({ title: "Upload failed", variant: "destructive" });
    }
  };

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

  const handleComposePrompt = async () => {
    if (!changeRequest.trim() && selectedImages.size < 2) {
      toast({ title: "Please enter a request or select images", variant: "destructive" });
      return;
    }

    try {
      const result = await composePrompt.mutateAsync({
        changeRequest: changeRequest.trim() || "Merge reference images into one consistent panorama.",
        includeStyle: false,
        context: "multi_image_panorama"
      });

      setComposedPrompt(result.composed_prompt);
      toast({ title: "Prompt composed successfully" });
    } catch (error) {
      toast({
        title: "Failed to compose prompt",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
    }
  };

  const handleCopyPrompt = () => {
    if (composedPrompt) {
      navigator.clipboard.writeText(composedPrompt);
      toast({ title: "Prompt copied to clipboard" });
    }
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
      const finalChangeRequest = composedPrompt || changeRequest.trim() || "Merge reference images into one consistent panorama.";
      
      const newJob = await createJob.mutateAsync({
        inputUploadIds: Array.from(selectedImages),
        cameraPosition: cameraPosition.trim() || undefined,
        forwardDirection: forwardDirection.trim() || undefined,
        outputResolution: selectedResolution,
        aspectRatio: selectedRatio,
      });

      if (composedPrompt || changeRequest.trim()) {
        await supabase
          .from("multi_image_panorama_jobs")
          .update({ prompt_used: finalChangeRequest })
          .eq("id", newJob.id);
      }
      
      toast({ title: "Job created", description: "Click Generate to start panorama creation." });
      setSelectedImages(new Set());
      setChangeRequest("");
      setComposedPrompt(null);
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
      toast({ title: "Panorama generation started" });
    } catch (error) {
    } finally {
      setStartingJobId(null);
    }
  };

  // Delete job
  const handleDeleteJob = async (jobId: string) => {
    if (!confirm("Are you sure you want to delete this job?")) return;
    setDeletingJobId(jobId);
    try {
      await deleteJob.mutateAsync(jobId);
    } finally {
      setDeletingJobId(null);
    }
  };

  // Update status (QA)
  const handleUpdateStatus = async (jobId: string, status: string) => {
    setUpdatingJobId(jobId);
    try {
      await updateJob.mutateAsync({ jobId, status });
      const statusLabel = status === "approved" ? "QA Approved" : status === "rejected" ? "QA Rejected" : "Review Reset";
      toast({ title: statusLabel });
    } finally {
      setUpdatingJobId(null);
    }
  };

  // View output
  const handleViewOutput = async (job: MultiImagePanoramaJob) => {
    if (!job.output_upload_id) return;
    try {
      const { data: upload } = await supabase.from("uploads").select("bucket, path").eq("id", job.output_upload_id).single();
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

  const getOutputPreview = (job: MultiImagePanoramaJob): string | undefined => {
    if (!job.output_upload_id) return undefined;
    return imagePreviews[job.output_upload_id];
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <FlaskConical className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold">Multi-Image Panorama</h2>
      </div>

      {/* Description */}
      <Card className="bg-muted/30 border-dashed">
        <CardContent className="py-4">
          <p className="text-sm text-muted-foreground">
            Generate a TRUE 360° panorama from <strong>multiple reference images</strong>. 
            This feature treats your images as <strong>spatial evidence</strong> — 
            the AI will NOT invent rooms or furniture not visible in your references.
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
            Select 2+ images to use as spatial evidence. You can upload new images or attach from Creations.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Upload Area */}
          <div className="space-y-3">
            <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">1. Source Evidence</Label>
            
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-3">
              {/* Upload Trigger */}
              <label className="relative aspect-square rounded-lg border-2 border-dashed border-border hover:border-primary/50 hover:bg-primary/5 transition-all cursor-pointer flex flex-col items-center justify-center gap-2 group">
                <input type="file" multiple accept="image/*" className="hidden" onChange={handleFileUpload} />
                <div className="w-8 h-8 rounded-full bg-muted group-hover:bg-primary/10 flex items-center justify-center transition-colors">
                  <ImagePlus className="h-4 w-4 text-muted-foreground group-hover:text-primary" />
                </div>
                <span className="text-[10px] font-medium text-muted-foreground group-hover:text-primary">Upload Images</span>
              </label>

              {/* Combined selectable images: Attachments + Project Uploads */}
              {[...creationsAttachments.map(a => ({ id: a.uploadId, name: a.filename })), ...projectUploads.map(u => ({ id: u.id, name: u.original_filename }))]
                .filter((v, i, a) => a.findIndex(t => t.id === v.id) === i) // Unique by ID
                .map((img) => (
                  <div
                    key={img.id}
                    className={`relative aspect-square rounded-lg border overflow-hidden cursor-pointer transition-all ${
                      selectedImages.has(img.id) ? "ring-2 ring-primary border-primary shadow-lg scale-[1.02]" : "hover:border-muted-foreground"
                    }`}
                    onClick={() => toggleImage(img.id)}
                  >
                    {imagePreviews[img.id] ? (
                      <img src={imagePreviews[img.id]} alt={img.name || "Source"} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-muted animate-pulse">
                        <Image className="h-5 w-5 text-muted-foreground/50" />
                      </div>
                    )}
                    {selectedImages.has(img.id) && (
                      <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-primary flex items-center justify-center shadow-md">
                        <Check className="h-3 w-3 text-primary-foreground" />
                      </div>
                    )}
                  </div>
                ))}
            </div>
            
            {selectedImages.size < 2 && (
              <p className="text-[10px] text-amber-600 flex items-center gap-1.5 px-1">
                <AlertTriangle className="h-3 w-3" />
                Select at least 2 images to begin
              </p>
            )}
          </div>

          <div className="space-y-3 pt-2 border-t border-border/50">
            <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">2. Refinement (Optional)</Label>
            
            <div className="border border-border/50 rounded-lg p-3 bg-muted/20">
              <ChangeSuggestionsPanel 
                onSelectSuggestion={(prompt) => setChangeRequest(prompt)}
                context="multi_image_panorama"
                enableCompose={true}
                onApplyComposedPrompt={(prompt) => setComposedPrompt(prompt)}
                changeRequestText={changeRequest}
                isComposing={isPromptComposing}
                onComposePrompt={handleComposePrompt}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="multi-change-request" className="text-xs">Custom Prompt / Request</Label>
                {composedPrompt && (
                   <Button variant="ghost" size="sm" className="h-6 text-[10px] text-primary" onClick={() => setComposedPrompt(null)}>
                     Reset to Simple
                   </Button>
                )}
              </div>
              {composedPrompt ? (
                <Textarea
                  value={composedPrompt}
                  onChange={(e) => setComposedPrompt(e.target.value)}
                  className="text-xs font-mono bg-primary/5 border-primary/20 min-h-[80px]"
                />
              ) : (
                <Input
                  id="multi-change-request"
                  placeholder="Describe how to merge or what to emphasize..."
                  value={changeRequest}
                  onChange={(e) => setChangeRequest(e.target.value)}
                  className="bg-background text-sm h-9"
                />
              )}
            </div>
          </div>

          {/* Camera & Settings */}
          <div className="grid gap-4 sm:grid-cols-2 pt-2 border-t border-border/50">
            <div className="space-y-2">
              <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">3. Camera Placement</Label>
              <div className="grid gap-2">
                <Input
                  placeholder="Camera Position (e.g. center of room)"
                  value={cameraPosition}
                  onChange={(e) => setCameraPosition(e.target.value)}
                  className="text-xs h-8"
                />
                <Input
                  placeholder="Forward Direction (e.g. toward window)"
                  value={forwardDirection}
                  onChange={(e) => setForwardDirection(e.target.value)}
                  className="text-xs h-8"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">4. Output Settings</Label>
              <div className="flex gap-2">
                <Select value={selectedRatio} onValueChange={setSelectedRatio}>
                  <SelectTrigger className="h-8 text-xs flex-1">
                    <SelectValue placeholder="Ratio" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="2:1">2:1 Panorama</SelectItem>
                    <SelectItem value="16:9">16:9 Wide</SelectItem>
                    <SelectItem value="1:1">1:1 Square</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={selectedResolution} onValueChange={setSelectedResolution}>
                  <SelectTrigger className="h-8 text-xs flex-1">
                    <SelectValue placeholder="Quality" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1K">1K Fast</SelectItem>
                    <SelectItem value="2K">2K Balanced</SelectItem>
                    <SelectItem value="4K">4K Ultra</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <Button
            onClick={handleCreateJob}
            disabled={selectedImages.size < 2 || isCreating}
            className="w-full shadow-md"
          >
            {isCreating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
            Create Job ({selectedImages.size} images)
          </Button>
        </CardContent>
      </Card>

      {/* Results Layout */}
      <div className="grid gap-8 lg:grid-cols-2">
        {/* Queue & Review */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" />
              Queue & Review
              {reviewJobs.length > 0 && <Badge variant="secondary" className="ml-1 h-5 px-1.5">{reviewJobs.length}</Badge>}
            </h3>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground/30" /></div>
          ) : reviewJobs.length === 0 ? (
            <div className="py-12 border-2 border-dashed rounded-xl flex flex-col items-center justify-center text-muted-foreground/50">
               <FlaskConical className="h-8 w-8 mb-2 opacity-20" />
               <p className="text-xs">No jobs in queue</p>
            </div>
          ) : (
            <div className="space-y-4">
              {reviewJobs.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  onStart={() => handleStartJob(job.id)}
                  onDelete={() => handleDeleteJob(job.id)}
                  onViewOutput={() => handleViewOutput(job)}
                  onUpdateStatus={(status) => handleUpdateStatus(job.id, status)}
                  isStarting={startingJobId === job.id}
                  isDeleting={deletingJobId === job.id}
                  isUpdating={updatingJobId === job.id}
                  inputPreviews={imagePreviews}
                  outputPreview={getOutputPreview(job)}
                  onOpenTerminal={(id) => setTerminalJobId(terminalJobId === id ? null : id)}
                  terminalIsOpen={terminalJobId === job.id}
                />
              ))}
            </div>
          )}
        </div>

        {/* Approved Jobs */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Check className="h-4 w-4 text-green-500" />
              Approved Results
              {approvedJobs.length > 0 && <Badge variant="outline" className="ml-1 h-5 px-1.5 border-green-500/30 text-green-600">{approvedJobs.length}</Badge>}
            </h3>
          </div>

          {approvedJobs.length === 0 ? (
            <div className="py-12 border rounded-xl flex flex-col items-center justify-center text-muted-foreground/30 bg-muted/5">
               <Image className="h-8 w-8 mb-2 opacity-10" />
               <p className="text-xs text-center px-8">Approved panoramas will appear here.<br/>Review items in the queue to approve them.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {approvedJobs.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  onStart={() => handleStartJob(job.id)}
                  onDelete={() => handleDeleteJob(job.id)}
                  onViewOutput={() => handleViewOutput(job)}
                  onUpdateStatus={(status) => handleUpdateStatus(job.id, status)}
                  isStarting={startingJobId === job.id}
                  isDeleting={deletingJobId === job.id}
                  isUpdating={updatingJobId === job.id}
                  inputPreviews={imagePreviews}
                  outputPreview={getOutputPreview(job)}
                  onOpenTerminal={(id) => setTerminalJobId(terminalJobId === id ? null : id)}
                  terminalIsOpen={terminalJobId === job.id}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* View large modal */}
      <Dialog open={viewLargeOpen} onOpenChange={setViewLargeOpen}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden p-0">
          <div className="relative w-full h-full">
            <img src={viewLargeUrl} alt="Output" className="w-full h-auto max-h-[85vh] object-contain" />
            <Badge className="absolute bottom-4 left-4 bg-green-600/90 text-white">
              Multi-Image Panorama (Approved)
            </Badge>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
});
