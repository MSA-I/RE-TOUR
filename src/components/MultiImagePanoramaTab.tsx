import { useState, useCallback, memo, useEffect, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DropZone } from "@/components/ui/drop-zone";
import { useMultiImagePanoramaJobs, useMultiImagePanoramaEvents, MultiImagePanoramaJob } from "@/hooks/useMultiImagePanoramaJobs";
import { useUploads } from "@/hooks/useUploads";
import { useChangeSuggestions } from "@/hooks/useChangeSuggestions";
import { useStorage } from "@/hooks/useStorage";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { MultiImagePanoramaTerminal } from "@/components/MultiImagePanoramaTerminal";
import { BeforeAfterSlider } from "@/components/BeforeAfterSlider";
import { QAReviewPanel } from "@/components/shared/QAReviewPanel";
import { format } from "date-fns";
import { 
  Loader2, Play, Trash2, Image, ImagePlus, Check, 
  AlertTriangle, Layers, Eye, Maximize2, Sparkles,
  ChevronDown, ChevronUp, Terminal, Wand2, Copy,
  SplitSquareHorizontal, CheckCircle, XCircle, ThumbsUp, ThumbsDown, Upload
} from "lucide-react";

interface MultiImagePanoramaTabProps {
  projectId: string;
  creationsAttachments?: Array<{ uploadId: string; filename: string; previewUrl?: string }>;
  onClearAttachments?: () => void;
}

const statusColors: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  running: "bg-primary/20 text-primary",
  completed: "bg-accent text-accent-foreground",
  failed: "bg-destructive/20 text-destructive",
  needs_review: "bg-secondary text-secondary-foreground",
  approved: "bg-accent text-accent-foreground",
  rejected: "bg-destructive/20 text-destructive",
};

// Job card component with terminal, compare, and QA
const JobCard = memo(function JobCard({
  job,
  projectId,
  onStart,
  onDelete,
  onViewOutput,
  onCompare,
  onApprove,
  onReject,
  isStarting,
  isDeleting,
  isApproving,
  isRejecting,
  inputPreviews,
  outputPreview,
  isLoadingOutputPreview,
}: {
  job: MultiImagePanoramaJob;
  projectId: string;
  onStart: () => void;
  onDelete: () => void;
  onViewOutput: () => void;
  onCompare: () => void;
  onApprove: (score: number | null, note: string) => void;
  onReject: (score: number | null, note: string) => void;
  isStarting: boolean;
  isDeleting: boolean;
  isApproving: boolean;
  isRejecting: boolean;
  inputPreviews: Record<string, string>;
  outputPreview?: string;
  isLoadingOutputPreview?: boolean;
}) {
  const [terminalOpen, setTerminalOpen] = useState(job.status === "running");
  const events = useMultiImagePanoramaEvents(job.status === "running" ? job.id : null);
  const latestEvent = events[events.length - 1];
  const inputCount = (job.input_upload_ids || []).length;
  
  // Job has output stored but might not have preview loaded yet
  const hasOutputRecord = !!job.output_upload_id;
  // Job is in a state that needs user review (completed with output)
  const needsReview = job.status === "completed" && hasOutputRecord;

  // Auto-open terminal when job starts running
  useEffect(() => {
    if (job.status === "running") {
      setTerminalOpen(true);
    }
  }, [job.status]);

  const canCompare = job.status === "completed" && outputPreview && inputCount > 0;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Multi-Image Panorama</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            {needsReview && (
              <Badge variant="secondary" className="gap-1">
                <AlertTriangle className="h-3 w-3" />
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

        {/* Prompt used */}
        {job.prompt_used && (
          <div className="text-xs">
            <Label className="text-muted-foreground mb-1 block">Prompt Used</Label>
            <p className="text-muted-foreground bg-muted/50 rounded p-2 line-clamp-2">{job.prompt_used}</p>
          </div>
        )}

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

        {/* Output preview - ALWAYS show for completed jobs with output_upload_id */}
        {job.status === "completed" && hasOutputRecord && (
          <div className="space-y-3">
            <Label className="text-xs text-muted-foreground block">Output (Evidence-Based)</Label>
            
            {/* Image preview or loading/error state */}
            {outputPreview ? (
              <div 
                className="relative aspect-[2/1] rounded border overflow-hidden cursor-pointer group"
                onClick={onViewOutput}
              >
                <img
                  src={outputPreview}
                  alt="Generated panorama"
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-background/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <Maximize2 className="h-6 w-6 text-foreground" />
                </div>
                <Badge variant="default" className="absolute bottom-2 left-2 text-xs">
                  Evidence-Based
                </Badge>
              </div>
            ) : isLoadingOutputPreview ? (
              <div className="aspect-[2/1] rounded border bg-muted flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                <span className="ml-2 text-xs text-muted-foreground">Loading preview...</span>
              </div>
            ) : (
              <div className="aspect-[2/1] rounded border bg-muted/50 border-dashed flex flex-col items-center justify-center p-4">
                <AlertTriangle className="h-6 w-6 text-muted-foreground mb-2" />
                <p className="text-xs text-muted-foreground text-center">
                  Output exists but preview failed to load
                </p>
                <Button size="sm" variant="outline" onClick={onViewOutput} className="mt-2">
                  <Eye className="h-4 w-4 mr-1" />
                  Try to View Full Image
                </Button>
              </div>
            )}

            {/* QA Score and Approve/Reject panel for needs_review state */}
            {needsReview && (
              <QAReviewPanel
                itemId={job.id}
                projectId={projectId}
                pipelineId={job.id}
                outputUploadId={job.output_upload_id}
                onApprove={onApprove}
                onReject={onReject}
                isApproving={isApproving}
                isRejecting={isRejecting}
                title="Review Required"
                description="Score the output quality and approve or reject"
                category="multi_panorama"
              />
            )}
          </div>
        )}

        {/* Completed but NO output record - should not happen, but show error */}
        {job.status === "completed" && !hasOutputRecord && (
          <div className="flex items-start gap-2 p-3 rounded bg-destructive/10 border border-destructive/30">
            <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
            <p className="text-xs text-destructive">
              Job completed but no output was saved. This may be a backend error.
            </p>
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
        <div className="flex flex-wrap gap-2">
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
          
          {/* Compare button for completed jobs */}
          {canCompare && (
            <Button size="sm" variant="outline" onClick={onCompare}>
              <SplitSquareHorizontal className="h-4 w-4 mr-1" />
              Compare
            </Button>
          )}
          
          {/* View button only when output exists */}
          {job.status === "completed" && hasOutputRecord && outputPreview && (
            <Button size="sm" variant="outline" onClick={onViewOutput}>
              <Eye className="h-4 w-4 mr-1" />
              View
            </Button>
          )}
          
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setTerminalOpen(!terminalOpen)}
          >
            <Terminal className="h-4 w-4 mr-1" />
            {terminalOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </Button>
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

        {/* Terminal */}
        <MultiImagePanoramaTerminal jobId={job.id} isOpen={terminalOpen} />
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
  const { uploads, createUpload } = useUploads(projectId, "panorama");
  const { getSignedViewUrl } = useStorage();
  const { toast } = useToast();
  
  // Use context-specific suggestions for multi-image panorama
  const { suggestions, isLoading: suggestionsLoading, fetchSuggestions } = useChangeSuggestions("multi_image_panorama");

  // File input ref
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  // Session storage key for state persistence
  const STORAGE_KEY = `multi_panorama_state_${projectId}`;

  // Load persisted state on mount
  const loadPersistedState = useCallback(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          selectedImages: new Set<string>(parsed.selectedImages || []),
          cameraPosition: parsed.cameraPosition || "center of the main living space at eye-level",
          forwardDirection: parsed.forwardDirection || "toward the primary focal point",
          changeRequest: parsed.changeRequest || "",
          composedPrompt: parsed.composedPrompt || "",
        };
      }
    } catch (e) {
      console.error("Failed to load persisted state:", e);
    }
    return null;
  }, [STORAGE_KEY]);

  const persistedState = loadPersistedState();

  // Local state - initialize from persisted state if available
  const [selectedImages, setSelectedImages] = useState<Set<string>>(persistedState?.selectedImages || new Set());
  const [imagePreviews, setImagePreviews] = useState<Record<string, string>>({});
  const [loadingPreviews, setLoadingPreviews] = useState<Set<string>>(new Set()); // Track loading previews
  const [isCreating, setIsCreating] = useState(false);
  const [startingJobId, setStartingJobId] = useState<string | null>(null);
  const [deletingJobId, setDeletingJobId] = useState<string | null>(null);
  const [approvingJobId, setApprovingJobId] = useState<string | null>(null);
  const [rejectingJobId, setRejectingJobId] = useState<string | null>(null);
  const [cameraPosition, setCameraPosition] = useState(persistedState?.cameraPosition || "center of the main living space at eye-level");
  const [forwardDirection, setForwardDirection] = useState(persistedState?.forwardDirection || "toward the primary focal point");
  const [changeRequest, setChangeRequest] = useState(persistedState?.changeRequest || "");
  const [isComposing, setIsComposing] = useState(false);
  const [composedPrompt, setComposedPrompt] = useState(persistedState?.composedPrompt || "");
  const [suggestionsOpen, setSuggestionsOpen] = useState(true);

  // Persist state on changes
  useEffect(() => {
    try {
      const stateToSave = {
        selectedImages: Array.from(selectedImages),
        cameraPosition,
        forwardDirection,
        changeRequest,
        composedPrompt,
      };
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stateToSave));
    } catch (e) {
      console.error("Failed to persist state:", e);
    }
  }, [selectedImages, cameraPosition, forwardDirection, changeRequest, composedPrompt, STORAGE_KEY]);

  // View large modal
  const [viewLargeOpen, setViewLargeOpen] = useState(false);
  const [viewLargeUrl, setViewLargeUrl] = useState("");

  // Compare modal state
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareBeforeUrl, setCompareBeforeUrl] = useState<string | null>(null);
  const [compareAfterUrl, setCompareAfterUrl] = useState<string | null>(null);

  // Handle file upload
  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (file.size > 20 * 1024 * 1024) {
          toast({
            title: "File too large",
            description: `${file.name} exceeds 20MB limit`,
            variant: "destructive",
          });
          continue;
        }

        const upload = await createUpload.mutateAsync({ file, kind: "panorama" });
        // Auto-select newly uploaded images
        setSelectedImages((prev) => new Set([...prev, upload.id]));
        toast({ title: "Uploaded", description: file.name });
      }
    } catch (error) {
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }, [createUpload, toast]);

  // Load suggestions on mount
  useEffect(() => {
    fetchSuggestions();
  }, [fetchSuggestions]);

  // Load previews for attachments - track loading state
  const loadPreview = useCallback(async (uploadId: string) => {
    if (imagePreviews[uploadId] || loadingPreviews.has(uploadId)) return;

    // Mark as loading
    setLoadingPreviews((prev) => new Set([...prev, uploadId]));

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
    } finally {
      // Remove from loading
      setLoadingPreviews((prev) => {
        const next = new Set(prev);
        next.delete(uploadId);
        return next;
      });
    }
  }, [getSignedViewUrl, imagePreviews, loadingPreviews]);

  // Load previews for uploaded images
  useEffect(() => {
    uploads.forEach((upload) => {
      if (!imagePreviews[upload.id]) {
        loadPreview(upload.id);
      }
    });
  }, [uploads, imagePreviews, loadPreview]);

  // Initialize selected from attachments
  useEffect(() => {
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
  }, [creationsAttachments, loadPreview]);

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

  // Handle suggestion selection
  const handleSelectSuggestion = (prompt: string) => {
    setChangeRequest((prev) => {
      if (prev.trim()) {
        return prev + " " + prompt;
      }
      return prompt;
    });
    // Clear composed prompt when new suggestion added
    setComposedPrompt("");
  };

  // Copy to clipboard
  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Copied to clipboard" });
    } catch {
      toast({ title: "Failed to copy", variant: "destructive" });
    }
  };

  // Compose prompt
  const handleComposePrompt = async () => {
    if (!changeRequest.trim()) {
      toast({
        title: "Enter a change request",
        description: "Please type or select a suggestion first.",
        variant: "destructive",
      });
      return;
    }

    setIsComposing(true);
    try {
      const { data, error } = await supabase.functions.invoke("compose-final-prompt", {
        body: {
          change_request: changeRequest,
          style_prompt: null,
          include_style: false,
        },
      });

      if (error) throw error;
      if (data.error) throw new Error(data.error);

      // Enhance composed prompt with multi-image panorama specific instructions
      const enhancedPrompt = `${data.composed_prompt}\n\nIMPORTANT: Use ONLY visible evidence from the attached reference images. Do not invent rooms, openings, or furniture not visible in the sources. Resolve overlapping areas consistently. Keep geometry coherent across the entire 360 view.`;
      
      setComposedPrompt(enhancedPrompt);
      toast({ title: "Prompt composed successfully" });
    } catch (error) {
      console.error("Compose error:", error);
      toast({
        title: "Failed to compose prompt",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsComposing(false);
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
      await createJob.mutateAsync({
        inputUploadIds: Array.from(selectedImages),
        cameraPosition: cameraPosition.trim() || undefined,
        forwardDirection: forwardDirection.trim() || undefined,
      });

      toast({ title: "Job created", description: "Click Generate to start panorama creation." });
      setSelectedImages(new Set());
      setChangeRequest("");
      setComposedPrompt("");
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

  // Compare before/after
  const handleCompare = async (job: MultiImagePanoramaJob) => {
    if (!job.output_upload_id || !job.input_upload_ids?.length) return;

    try {
      // Get first input image as "before"
      const firstInputId = job.input_upload_ids[0];
      let beforeUrl = imagePreviews[firstInputId];
      
      if (!beforeUrl) {
        const { data: beforeUpload } = await supabase
          .from("uploads")
          .select("bucket, path")
          .eq("id", firstInputId)
          .single();

        if (beforeUpload) {
          const { signedUrl } = await getSignedViewUrl(beforeUpload.bucket, beforeUpload.path);
          beforeUrl = signedUrl || "";
        }
      }

      // Get output as "after"
      let afterUrl = imagePreviews[job.output_upload_id];
      
      if (!afterUrl) {
        const { data: afterUpload } = await supabase
          .from("uploads")
          .select("bucket, path")
          .eq("id", job.output_upload_id)
          .single();

        if (afterUpload) {
          const { signedUrl } = await getSignedViewUrl(afterUpload.bucket, afterUpload.path);
          afterUrl = signedUrl || "";
        }
      }

      if (beforeUrl && afterUrl) {
        setCompareBeforeUrl(beforeUrl);
        setCompareAfterUrl(afterUrl);
        setCompareOpen(true);
      }
    } catch (e) {
      console.error("Failed to load images for compare:", e);
      toast({
        title: "Failed to load images",
        description: "Could not load images for comparison",
        variant: "destructive",
      });
    }
  };

  // Approve job - persist score to QA learning system
  const handleApprove = async (job: MultiImagePanoramaJob, score: number | null, note: string) => {
    setApprovingJobId(job.id);
    try {
      // Persist feedback to qa_attempt_feedback for learning loop
      const { error: feedbackError } = await supabase
        .from("qa_attempt_feedback")
        .insert({
          project_id: projectId,
          pipeline_id: job.id, // Using job.id as pipeline reference
          owner_id: (await supabase.auth.getUser()).data.user?.id,
          step_id: 0, // Multi-panorama doesn't have pipeline steps
          attempt_number: 1,
          image_id: job.output_upload_id,
          qa_decision: "approved",
          user_vote: score !== null && score >= 70 ? "like" : "neutral",
          user_category: "multi_panorama",
          user_comment_short: score !== null 
            ? `Score: ${score}${note ? ` — ${note}` : ""}`
            : note || "Approved without score",
          qa_reasons: [],
          context_snapshot: {
            job_id: job.id,
            user_score: score,
            user_note: note || null,
            action: "approve",
            submitted_at: new Date().toISOString(),
          },
        });

      if (feedbackError) {
        console.error("Failed to save QA feedback:", feedbackError);
      }

      toast({ 
        title: "Job Approved", 
        description: score !== null 
          ? `Saved with score ${score}/100. Feedback added to QA learning.`
          : "The panorama has been approved and saved to Creations." 
      });
    } finally {
      setApprovingJobId(null);
    }
  };

  // Reject job - persist score to QA learning system
  const handleReject = async (job: MultiImagePanoramaJob, score: number | null, note: string) => {
    setRejectingJobId(job.id);
    try {
      // Persist feedback to qa_attempt_feedback for learning loop
      const { error: feedbackError } = await supabase
        .from("qa_attempt_feedback")
        .insert({
          project_id: projectId,
          pipeline_id: job.id, // Using job.id as pipeline reference
          owner_id: (await supabase.auth.getUser()).data.user?.id,
          step_id: 0, // Multi-panorama doesn't have pipeline steps
          attempt_number: 1,
          image_id: job.output_upload_id,
          qa_decision: "rejected",
          user_vote: "dislike",
          user_category: score !== null && score < 40 ? "structural_change" : "other",
          user_comment_short: score !== null 
            ? `Score: ${score}${note ? ` — ${note}` : ""}`
            : note || "Rejected without score",
          qa_reasons: [],
          context_snapshot: {
            job_id: job.id,
            user_score: score,
            user_note: note || null,
            action: "reject",
            submitted_at: new Date().toISOString(),
          },
        });

      if (feedbackError) {
        console.error("Failed to save QA feedback:", feedbackError);
      }

      toast({ 
        title: "Job Rejected", 
        description: score !== null 
          ? `Saved with score ${score}/100. Feedback added to QA learning.`
          : "The panorama has been marked as rejected. You can regenerate." 
      });
    } finally {
      setRejectingJobId(null);
    }
  };

  // Get output preview for a job
  const getOutputPreview = (job: MultiImagePanoramaJob): string | undefined => {
    if (!job.output_upload_id) return undefined;
    return imagePreviews[job.output_upload_id];
  };

  // Check if output preview is currently loading
  const isOutputPreviewLoading = (job: MultiImagePanoramaJob): boolean => {
    if (!job.output_upload_id) return false;
    return loadingPreviews.has(job.output_upload_id);
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
      {/* Header */}
      <div className="flex items-center gap-3">
        <Layers className="h-5 w-5 text-primary" />
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

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: Create job + suggestions */}
        <div className="lg:col-span-2 space-y-4">
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

              {/* Upload button and uploaded images */}
              <DropZone
                onFilesDropped={(files) => handleFileUpload({ target: { files } } as React.ChangeEvent<HTMLInputElement>)}
                accept="image/*"
                multiple
                disabled={isUploading}
                isUploading={isUploading}
              >
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-xs text-muted-foreground">
                    Uploaded Images ({uploads.length})
                  </Label>
                  <DropZone.Button
                    size="sm"
                    variant="outline"
                    disabled={isUploading}
                    isUploading={isUploading}
                  >
                    Upload Images
                  </DropZone.Button>
                </div>
                
                {uploads.length > 0 ? (
                  <div className="flex gap-2 flex-wrap">
                    {uploads.map((upload) => (
                      <div
                        key={upload.id}
                        className={`relative w-20 h-20 rounded border overflow-hidden cursor-pointer transition-all ${
                          selectedImages.has(upload.id)
                            ? "ring-2 ring-primary border-primary"
                            : "hover:border-muted-foreground"
                        }`}
                        onClick={() => toggleImage(upload.id)}
                      >
                        {imagePreviews[upload.id] ? (
                          <img
                            src={imagePreviews[upload.id]}
                            alt={upload.original_filename || "Upload"}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-muted">
                            <Image className="h-4 w-4 text-muted-foreground" />
                          </div>
                        )}
                        {selectedImages.has(upload.id) && (
                          <div className="absolute top-1 right-1 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                            <Check className="h-3 w-3 text-primary-foreground" />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : creationsAttachments.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-6 text-center border-2 border-dashed rounded-lg">
                    <Upload className="h-6 w-6 text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">
                      Upload images or attach from <strong>Creations</strong>
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Need 2+ images for multi-image panorama
                    </p>
                  </div>
                ) : null}
              </DropZone>

              {/* Change request textarea */}
              {selectedImages.size >= 2 && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="change-request" className="text-xs flex items-center gap-1">
                      <Wand2 className="h-3 w-3" />
                      Instructions (optional)
                    </Label>
                    <Textarea
                      id="change-request"
                      value={changeRequest}
                      onChange={(e) => {
                        setChangeRequest(e.target.value);
                        setComposedPrompt(""); // Clear composed when editing
                      }}
                      placeholder="Describe how to merge the images or select a suggestion..."
                      className="text-sm min-h-[80px] resize-none"
                    />
                  </div>

                  {/* Compose prompt button */}
                  {changeRequest.trim() && !composedPrompt && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleComposePrompt}
                      disabled={isComposing}
                      className="w-full"
                    >
                      {isComposing ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Sparkles className="h-4 w-4 mr-2" />
                      )}
                      Compose Prompt
                    </Button>
                  )}

                  {/* FINAL COMPOSED PROMPT DISPLAY */}
                  {composedPrompt && (
                    <Card className="border-primary/30 bg-primary/5">
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-sm flex items-center gap-2">
                            <CheckCircle className="h-4 w-4 text-primary" />
                            Final Composed Prompt
                          </CardTitle>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => copyToClipboard(composedPrompt)}
                            className="h-7 px-2"
                          >
                            <Copy className="h-3 w-3 mr-1" />
                            Copy
                          </Button>
                        </div>
                      </CardHeader>
                      <CardContent className="pt-0 space-y-3">
                        <ScrollArea className="max-h-[200px] rounded border bg-background/50 p-3">
                          <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono">
                            {composedPrompt}
                          </pre>
                        </ScrollArea>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setComposedPrompt("");
                            setChangeRequest("");
                          }}
                          className="text-xs text-muted-foreground"
                        >
                          Clear & Start Over
                        </Button>
                      </CardContent>
                    </Card>
                  )}

                  {/* Camera settings */}
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
                </>
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
                  <Layers className="h-8 w-8 text-muted-foreground mb-2" />
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
                    projectId={projectId}
                    onStart={() => handleStartJob(job.id)}
                    onDelete={() => handleDeleteJob(job.id)}
                    onViewOutput={() => handleViewOutput(job)}
                    onCompare={() => handleCompare(job)}
                    onApprove={(score, note) => handleApprove(job, score, note)}
                    onReject={(score, note) => handleReject(job, score, note)}
                    isStarting={startingJobId === job.id}
                    isDeleting={deletingJobId === job.id}
                    isApproving={approvingJobId === job.id}
                    isRejecting={rejectingJobId === job.id}
                    inputPreviews={imagePreviews}
                    outputPreview={getOutputPreview(job)}
                    isLoadingOutputPreview={isOutputPreviewLoading(job)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Suggestions panel */}
        <div className="space-y-4">
          <Collapsible open={suggestionsOpen} onOpenChange={setSuggestionsOpen}>
            <Card>
              <CollapsibleTrigger asChild>
                <CardHeader className="pb-3 cursor-pointer hover:bg-muted/30 transition-colors">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Sparkles className="h-4 w-4" />
                      Merge Suggestions
                    </CardTitle>
                    {suggestionsOpen ? (
                      <ChevronUp className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                  <CardDescription className="text-xs">
                    Multi-image panorama specific suggestions only
                  </CardDescription>
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="pt-0">
                  {suggestionsLoading ? (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    </div>
                  ) : suggestions.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-4">
                      No suggestions available
                    </p>
                  ) : (
                    <ScrollArea className="h-[400px] pr-2">
                      <div className="space-y-2">
                        {suggestions.map((suggestion) => (
                          <button
                            key={suggestion.id}
                            onClick={() => handleSelectSuggestion(suggestion.prompt)}
                            className="w-full text-left p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
                          >
                            <p className="text-sm font-medium">{suggestion.title}</p>
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                              {suggestion.prompt}
                            </p>
                          </button>
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        </div>
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
            <Badge variant="default" className="absolute bottom-4 left-4">
              Multi-Image Panorama (Evidence-Based)
            </Badge>
          </div>
        </DialogContent>
      </Dialog>

      {/* Compare Before/After modal */}
      <Dialog open={compareOpen} onOpenChange={setCompareOpen}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Before / After Comparison</DialogTitle>
          </DialogHeader>
          {compareBeforeUrl && compareAfterUrl && (
            <BeforeAfterSlider
              beforeImage={compareBeforeUrl}
              afterImage={compareAfterUrl}
              beforeLabel="Reference (First Input)"
              afterLabel="Generated Panorama"
            />
          )}
          <p className="text-sm text-muted-foreground text-center">
            Drag the slider to compare the first source image with the generated panorama
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
});
