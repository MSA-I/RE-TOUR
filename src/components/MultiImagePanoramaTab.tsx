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
  Columns, ThumbsUp, ThumbsDown, Copy
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
  completed: "bg-green-500/20 text-green-400",
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
              {job.status}
            </Badge>
          </div>
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

        {/* Progress / Events */}
        {job.status === "running" && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin text-blue-400" />
                <span className="text-muted-foreground truncate max-w-[200px]">
                  {latestEvent?.message || "Processing..."}
                </span>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[10px]"
                onClick={() => onOpenTerminal(job.id)}
              >
                <Terminal className="h-3 w-3 mr-1" />
                {terminalIsOpen ? "Hide Log" : "Show Log"}
              </Button>
            </div>
            <Progress value={job.progress_int || 0} className="h-2" />
          </div>
        )}

        {/* Output preview */}
        {job.status === "completed" && outputPreview && (
          <div className="space-y-3">
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

            {/* QA Controls */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/50">
              <div className="space-y-0.5">
                <p className="text-xs font-medium">QA Assessment</p>
                <p className="text-[10px] text-muted-foreground">Verify source image consistency</p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-green-600 border-green-600/20 hover:bg-green-600/10"
                  onClick={() => onUpdateStatus("completed")}
                  disabled={isUpdating}
                >
                  <ThumbsUp className="h-3.5 w-3.5 mr-1.5" />
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-destructive border-destructive/20 hover:bg-destructive/10"
                  onClick={() => onUpdateStatus("failed")}
                  disabled={isUpdating}
                >
                  <ThumbsDown className="h-3.5 w-3.5 mr-1.5" />
                  Reject
                </Button>
              </div>
            </div>
          </div>
        )}

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
  const { jobs, isLoading, createJob, startJob, deleteJob, updateJob } = useMultiImagePanoramaJobs(projectId);
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
  useEffect(() => {
    if (creationsAttachments.length > 0) {
      console.log("[MultiPano] Initializing from attachments:", creationsAttachments.length);
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
  }, [creationsAttachments, loadPreview]);

  // Load output and input previews for jobs
  useEffect(() => {
    jobs.forEach((job) => {
      if (job.status === "completed" && job.output_upload_id && !imagePreviews[job.output_upload_id]) {
        loadPreview(job.output_upload_id);
      }
      // Load input previews
      (job.input_upload_ids || []).forEach((id) => {
        if (!imagePreviews[id]) loadPreview(id);
      });
    });
  }, [jobs, imagePreviews, loadPreview]);

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
      // Use composed prompt if available, otherwise fallback to changeRequest or default
      const finalChangeRequest = composedPrompt || changeRequest.trim() || "Merge reference images into one consistent panorama.";
      
      const newJob = await createJob.mutateAsync({
        inputUploadIds: Array.from(selectedImages),
        cameraPosition: cameraPosition.trim() || undefined,
        forwardDirection: forwardDirection.trim() || undefined,
        outputResolution: selectedResolution,
        aspectRatio: selectedRatio,
      });

      // Update the job with the final prompt if needed
      if (composedPrompt) {
        await supabase
          .from("multi_image_panorama_jobs")
          .update({ prompt_used: composedPrompt })
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
      // Error already handled by toast in hook
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
      toast({ title: status === "completed" ? "QA Approved" : "QA Rejected" });
    } finally {
      setUpdatingJobId(null);
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
          {/* Change Suggestions Panel */}
          <div className="border border-border/50 rounded-lg p-4 bg-background/50">
            <Label className="text-sm font-medium mb-3 block flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              Change Suggestions
            </Label>
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
            <Label htmlFor="multi-change-request">Change Request / Prompt</Label>
            <Input
              id="multi-change-request"
              placeholder="Describe how to merge or what to emphasize (optional)"
              value={changeRequest}
              onChange={(e) => setChangeRequest(e.target.value)}
              className="bg-background"
            />
          </div>

          {/* Composed Prompt Result */}
          {composedPrompt && (
            <div className="space-y-2 animate-fade-in">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold text-primary flex items-center gap-1.5">
                  <Wand2 className="h-3 w-3" />
                  Final Composed Prompt
                </Label>
                <div className="flex gap-2">
                  <Button 
                    size="sm" 
                    variant="ghost" 
                    className="h-6 px-2 text-[10px]"
                    onClick={handleCopyPrompt}
                  >
                    <Copy className="h-3 w-3 mr-1" />
                    Copy
                  </Button>
                  <Button 
                    size="sm" 
                    variant="ghost" 
                    className="h-6 px-2 text-[10px] text-muted-foreground hover:text-foreground"
                    onClick={() => setComposedPrompt(null)}
                  >
                    <X className="h-3 w-3 mr-1" />
                    Clear
                  </Button>
                </div>
              </div>
              <div className="relative">
                <Textarea
                  value={composedPrompt}
                  onChange={(e) => setComposedPrompt(e.target.value)}
                  className="text-xs font-mono bg-primary/5 border-primary/20 min-h-[80px]"
                />
              </div>
              <p className="text-[10px] text-muted-foreground italic">
                This prompt will be sent to the AI engine. You can tweak it above before creating the job.
              </p>
            </div>
          )}

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

          {/* Sizing and Resolution */}
          {selectedImages.size >= 2 && (
            <div className="grid gap-4 sm:grid-cols-2 p-4 bg-background/50 rounded-lg border border-border/50">
              <div className="space-y-2">
                <Label htmlFor="multi-ratio" className="text-xs">Output Ratio</Label>
                <Select value={selectedRatio} onValueChange={setSelectedRatio}>
                  <SelectTrigger id="multi-ratio" className="bg-background">
                    <div className="flex items-center gap-2">
                      <AspectRatioPreview ratio={selectedRatio} size="sm" selected />
                      <span>{selectedRatio}</span>
                    </div>
                  </SelectTrigger>
                  <SelectContent className="bg-background border-border">
                    <SelectItem value="2:1"><AspectRatioSelectItemContent value="2:1" /></SelectItem>
                    <SelectItem value="1:1"><AspectRatioSelectItemContent value="1:1" /></SelectItem>
                    <SelectItem value="16:9"><AspectRatioSelectItemContent value="16:9" /></SelectItem>
                    <SelectItem value="21:9"><AspectRatioSelectItemContent value="21:9" /></SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="multi-resolution" className="text-xs">Select Quality</Label>
                <Select value={selectedResolution} onValueChange={setSelectedResolution}>
                  <SelectTrigger id="multi-resolution" className="bg-background">
                    <SelectValue placeholder="Select quality" />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    <SelectItem value="1K" className="py-3">
                      <span className="font-medium">1K</span>
                      <span className="text-muted-foreground ml-2">· Fast</span>
                    </SelectItem>
                    <SelectItem value="2K" className="py-3">
                      <span className="font-medium">2K</span>
                      <span className="text-muted-foreground ml-2">· Balanced</span>
                    </SelectItem>
                    <SelectItem value="4K" className="py-3">
                      <span className="font-medium">4K</span>
                      <span className="text-muted-foreground ml-2">· Ultra</span>
                    </SelectItem>
                  </SelectContent>
                </Select>
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
