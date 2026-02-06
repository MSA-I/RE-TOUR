import { useState, useCallback, useRef, useEffect } from "react";
import { useParams, Navigate, Link, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useProject } from "@/hooks/useProjects";
import { useUploads } from "@/hooks/useUploads";
import { useRenderJobs } from "@/hooks/useRenderJobs";
import { useJobReviews } from "@/hooks/useJobReviews";
import { useBatchJobs, useBatchJobItems, BatchJob } from "@/hooks/useBatchJobs";
import { useFloorplanPipelines } from "@/hooks/useFloorplanPipelines";
import { useStorage } from "@/hooks/useStorage";
import { useStyleBible } from "@/hooks/useStyleBible";
import { usePromptComposer } from "@/hooks/usePromptComposer";
import { useJobNotifications } from "@/hooks/useJobNotifications";
import { useJobProgress } from "@/hooks/useJobProgress";
import { useDeleteUpload } from "@/hooks/useDeleteUpload";
import { AppLayout } from "@/components/AppLayout";
import { ChangeSuggestionsPanel } from "@/components/ChangeSuggestionsPanel";
import { DesignRefSelectionDialog } from "@/components/DesignRefSelectionDialog";
import { BatchJobCard } from "@/components/BatchJobCard";
import { FloorPlanPipelineCard } from "@/components/FloorPlanPipelineCard";
import { WholeApartmentPipelineCard } from "@/components/WholeApartmentPipelineCard";
import { PipelineSuggestionsPanel } from "@/components/PipelineSuggestionsPanel";
import { CreationsTab } from "@/components/CreationsTab";
import { ImageEditingTab } from "@/components/ImageEditingTab";
import { ImageEditJobsTab } from "@/components/ImageEditJobsTab";
import { VirtualTourTab } from "@/components/VirtualTourTab";
import { useImageEditJobs } from "@/hooks/useImageEditJobs";
import { useVirtualTourJobs } from "@/hooks/useVirtualTourJobs";
import { QAAttemptsPanel } from "@/components/QAAttemptsPanel";
import { AspectRatioPreview, AspectRatioSelectItemContent } from "@/components/AspectRatioPreview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { BeforeAfterSlider } from "@/components/BeforeAfterSlider";
import { ImageSelectionDialog } from "@/components/ImageSelectionDialog";
import { RenderJobTerminal } from "@/components/RenderJobTerminal";
import { Progress } from "@/components/ui/progress";
import { DropZone } from "@/components/ui/drop-zone";
import { 
  Loader2, ArrowLeft, Upload, Image, Play, Check, X, Download, 
  Trash2, RefreshCw, Eye, Sparkles, Palette, Wand2, Edit3, Terminal, AlertTriangle, ImageOff,
  Box, Layers, CheckCircle, Grid3X3, Beaker, Lock
} from "lucide-react";
import { MultiImagePanoramaTab } from "@/components/MultiImagePanoramaTab";
import { TestsTab } from "@/components/tests/TestsTab";
import { format } from "date-fns";

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const { data: project, isLoading: projectLoading } = useProject(id!);
  const { uploads: panoramas, createUpload: createPanorama, deleteUpload: deletePanorama, isLoading: panoramasLoading } = useUploads(id!, "panorama");
  const { uploads: designRefs, createUpload: createDesignRef, deleteUpload: deleteDesignRef, isLoading: designRefsLoading } = useUploads(id!, "design_ref");
  const { uploads: floorPlans, createUpload: createFloorPlan, deleteUpload: deleteFloorPlan, isLoading: floorPlansLoading } = useUploads(id!, "floor_plan");
  const { batchJobs, createBatchJob, startBatchJob, isLoading: batchJobsLoading } = useBatchJobs(id!);
  const { pipelines, createPipeline, startStep, approveStep, rejectStep, skipToStep, goBackToStep, attachToPanoramas, updateSettings, resetPipeline, deletePipeline, isLoading: pipelinesLoading } = useFloorplanPipelines(id!);
  const { jobs, isLoading: jobsLoading, createJob, updateJob, startJob, deleteJob, reRenderJob } = useRenderJobs(id!);
  const { createReview } = useJobReviews(id!);
  const { getSignedViewUrl, getSignedDownloadUrl } = useStorage();
  const { generateStyleBible, isGenerating } = useStyleBible(id!);
  const { composePrompt, isComposing } = usePromptComposer();
  const { toast } = useToast();
  
  // Job completion notifications
  useJobNotifications(jobs);

  const panoramaInputRef = useRef<HTMLInputElement>(null);
  const designRefInputRef = useRef<HTMLInputElement>(null);
  const floorPlanInputRef = useRef<HTMLInputElement>(null);
  
  // Batch job item expansion state
  const [expandedBatchId, setExpandedBatchId] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState("creations");
  const [uploading, setUploading] = useState(false);
  const [selectedJob, setSelectedJob] = useState<string | null>(null);
  const [changeRequest, setChangeRequest] = useState("");
  const [reviewNotes, setReviewNotes] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [outputPreviewUrl, setOutputPreviewUrl] = useState<string | null>(null);
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [imagePreviews, setImagePreviews] = useState<Record<string, string>>({});
  const [missingFiles, setMissingFiles] = useState<Set<string>>(new Set());
  
  // Render options
  const [selectedRatio, setSelectedRatio] = useState<string>("1:1");
  const [selectedQuality, setSelectedQuality] = useState<string>("2k");
  const [compareDialogOpen, setCompareDialogOpen] = useState(false);
  const [compareImages, setCompareImages] = useState<{ before: string; after: string } | null>(null);
  const [useStylePrompt, setUseStylePrompt] = useState(false);
  
  // Composed prompt state
  const [composedPrompt, setComposedPrompt] = useState<string | null>(null);
  const [detectedTemplate, setDetectedTemplate] = useState<string | null>(null);
  const [isEditingPrompt, setIsEditingPrompt] = useState(false);
  
  // Image selection dialog state
  const [imageSelectionOpen, setImageSelectionOpen] = useState(false);
  const [pendingBatchMode, setPendingBatchMode] = useState<"composed" | "direct">("composed");
  const [isBatchCreating, setIsBatchCreating] = useState(false);

  // Re-render dialog state
  const [reRenderDialogOpen, setReRenderDialogOpen] = useState(false);
  const [reRenderJobId, setReRenderJobId] = useState<string | null>(null);
  const [reRenderChangeRequest, setReRenderChangeRequest] = useState("");

  // Terminal state for job debugging
  const [terminalJobId, setTerminalJobId] = useState<string | null>(null);
  
  // Pipeline creation dialog state
  const [pipelineDialogOpen, setPipelineDialogOpen] = useState(false);
  const [pendingFloorPlanId, setPendingFloorPlanId] = useState<string | null>(null);
  const [pipelineQuality, setPipelineQuality] = useState<string>("2K");
  const [pipelineRatio, setPipelineRatio] = useState<string>("16:9");
  const [pipelineMode, setPipelineMode] = useState<"legacy" | "whole_apartment">("whole_apartment");
  
  // Step 2 mutual exclusion state (between Design References and AI Suggestions)
  const [step2HasRefs, setStep2HasRefs] = useState(false);
  const [step2SuggestionsActive, setStep2SuggestionsActive] = useState(false);
  
  // Image editing attachment from Creations (supports multiple)
  const [editAttachments, setEditAttachments] = useState<Array<{
    uploadId: string;
    filename: string;
    previewUrl?: string;
  }>>([]);
  
  // Panorama attachment from Creations (supports multiple for batch)
  const [panoramaAttachments, setPanoramaAttachments] = useState<Array<{
    uploadId: string;
    filename: string;
    previewUrl?: string;
  }>>([]);
  
  // Legacy single attachment helpers for backwards compatibility
  const editAttachment = editAttachments.length === 1 ? editAttachments[0] : editAttachments.length > 0 ? editAttachments[0] : null;
  const panoramaAttachment = panoramaAttachments.length === 1 ? panoramaAttachments[0] : panoramaAttachments.length > 0 ? panoramaAttachments[0] : null;
  const setEditAttachment = (val: typeof editAttachment) => setEditAttachments(val ? [val] : []);
  const setPanoramaAttachment = (val: typeof panoramaAttachment) => setPanoramaAttachments(val ? [val] : []);
  
  // Floor plan thumbnail size state with localStorage persistence
  const [floorPlanThumbnailSize, setFloorPlanThumbnailSize] = useState<number>(() => {
    const saved = localStorage.getItem("floorplan-thumbnail-size");
    return saved ? parseInt(saved, 10) : 160;
  });
  
  // Valid tabs for navigation validation - order: CREATIONS first, TOUR last, TESTS at end
  const VALID_TABS = ["creations", "panorama-uploads", "panorama-jobs", "floor-plan-uploads", "floor-plan-jobs", "image-editing", "image-editing-jobs", "multi-image-panorama", "virtual-tour", "tests"];
  
  // Multi-image panorama attachments from Creations
  const [multiPanoramaAttachments, setMultiPanoramaAttachments] = useState<Array<{
    uploadId: string;
    filename: string;
    previewUrl?: string;
  }>>([]);
  
  // Virtual tour jobs hook
  const { jobs: virtualTourJobs } = useVirtualTourJobs(id!);
  
  // Virtual tour attachments from Creations
  const [virtualTourAttachments, setVirtualTourAttachments] = useState<Array<{
    uploadId: string;
    filename: string;
    previewUrl?: string;
  }>>([]);
  
  // Image edit jobs hook
  const { jobs: imageEditJobs } = useImageEditJobs(id!);
  
  // Delete upload hook
  const deleteUploadMutation = useDeleteUpload(id!);
  
  // Get the currently running job for real-time progress
  const runningJob = jobs.find((j: any) => j.status === "running");
  const { progress: realTimeProgress, latestMessage, isComplete } = useJobProgress(runningJob?.id || null);

  const handleFileUpload = useCallback(async (
    files: FileList | null, 
    kind: "panorama" | "design_ref" | "floor_plan"
  ) => {
    if (!files) return;
    
    // New limits: 20 panoramas, 8 design refs, 20 floor plans
    const maxFiles = kind === "panorama" ? 20 : kind === "design_ref" ? 8 : 20;
    const currentCount = kind === "panorama" ? panoramas.length : kind === "design_ref" ? designRefs.length : floorPlans.length;
    const allowedCount = maxFiles - currentCount;

    if (allowedCount <= 0) {
      const kindLabel = kind === "panorama" ? "panoramas" : kind === "design_ref" ? "design references" : "floor plans";
      toast({
        title: `Maximum ${maxFiles} ${kindLabel} allowed`,
        variant: "destructive"
      });
      return;
    }

    const filesToUpload = Array.from(files).slice(0, allowedCount);
    
    setUploading(true);
    try {
      for (const file of filesToUpload) {
        const createFn = kind === "panorama" ? createPanorama : kind === "design_ref" ? createDesignRef : createFloorPlan;
        await createFn.mutateAsync({ file, kind });
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
  }, [panoramas.length, designRefs.length, floorPlans.length, createPanorama, createDesignRef, createFloorPlan, toast]);

  const handleComposePrompt = async () => {
    if (!changeRequest.trim()) {
      toast({ title: "Please enter a change request first", variant: "destructive" });
      return;
    }

    try {
      const stylePrompt = project?.style_profile && (project.style_profile as any).prompt
        ? (project.style_profile as any).prompt
        : undefined;

      const result = await composePrompt.mutateAsync({
        changeRequest: changeRequest.trim(),
        stylePrompt,
        includeStyle: useStylePrompt
      });

      setComposedPrompt(result.composed_prompt);
      setDetectedTemplate(result.detected_template);
      setIsEditingPrompt(false);
      toast({ title: "Prompt composed successfully" });
    } catch (error) {
      toast({
        title: "Failed to compose prompt",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
    }
  };

  const handleCreateJobWithComposedPrompt = async (panoramaId: string) => {
    if (!composedPrompt) {
      toast({ title: "Please compose and approve a prompt first", variant: "destructive" });
      return;
    }

    try {
      // Include ratio and quality metadata
      const fullChangeRequest = `${composedPrompt} [RATIO:${selectedRatio}] [QUALITY:${selectedQuality}]`;
      
      const newJob = await createJob.mutateAsync({
        panoramaUploadId: panoramaId,
        changeRequest: fullChangeRequest,
        designRefUploadIds: designRefs.map(d => d.id),
        outputResolution: selectedQuality
      });
      toast({ 
        title: "Render job created",
        description: "Click to view the job",
        action: (
          <ToastAction 
            altText="View job"
            onClick={() => {
              setActiveTab("panorama-jobs");
              setSelectedJob(newJob.id);
              setTimeout(() => {
                const el = document.getElementById(`job-row-${newJob.id}`);
                if (el) {
                  el.scrollIntoView({ behavior: "smooth", block: "center" });
                  el.classList.add("ring-2", "ring-primary");
                  setTimeout(() => el.classList.remove("ring-2", "ring-primary"), 2000);
                }
              }, 100);
            }}
          >
            View Job
          </ToastAction>
        )
      });
    } catch (error) {
      toast({
        title: "Failed to create job",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
      throw error; // Re-throw for batch handling
    }
  };

  const handleCreateJob = async (panoramaId: string) => {
    if (!changeRequest.trim()) {
      toast({ title: "Please enter a change request", variant: "destructive" });
      return;
    }

    try {
      // Build the full change request with optional style prompt
      let fullChangeRequest = changeRequest.trim();
      
      // Add style prompt if enabled and available
      if (useStylePrompt && project?.style_profile && (project.style_profile as any).prompt) {
        fullChangeRequest = `${(project.style_profile as any).prompt}\n\nUser changes: ${fullChangeRequest}`;
      }
      
      // Include ratio and quality metadata
      fullChangeRequest = `${fullChangeRequest} [RATIO:${selectedRatio}] [QUALITY:${selectedQuality}]`;
      
      const newJob = await createJob.mutateAsync({
        panoramaUploadId: panoramaId,
        changeRequest: fullChangeRequest,
        designRefUploadIds: designRefs.map(d => d.id),
        outputResolution: selectedQuality
      });
      toast({ 
        title: "Render job created",
        description: "Click to view the job",
        action: (
          <ToastAction 
            altText="View job"
            onClick={() => {
              setActiveTab("panorama-jobs");
              setSelectedJob(newJob.id);
              setTimeout(() => {
                const el = document.getElementById(`job-row-${newJob.id}`);
                if (el) {
                  el.scrollIntoView({ behavior: "smooth", block: "center" });
                  el.classList.add("ring-2", "ring-primary");
                  setTimeout(() => el.classList.remove("ring-2", "ring-primary"), 2000);
                }
              }, 100);
            }}
          >
            View Job
          </ToastAction>
        )
      });
    } catch (error) {
      toast({
        title: "Failed to create job",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
      throw error; // Re-throw for batch handling
    }
  };

  // Handle batch job creation - creates ONE batch job for all selected images
  const handleBatchJobCreate = async (selectedPanoramaIds: string[]) => {
    setIsBatchCreating(true);

    try {
      // Determine the prompt to use
      let finalPrompt = "";
      let basePrompt: string | undefined = undefined;
      
      if (pendingBatchMode === "composed" && composedPrompt) {
        finalPrompt = `${composedPrompt} [RATIO:${selectedRatio}] [QUALITY:${selectedQuality}]`;
        basePrompt = composedPrompt;
      } else {
        let fullChangeRequest = changeRequest.trim();
        if (useStylePrompt && project?.style_profile && (project.style_profile as any).prompt) {
          fullChangeRequest = `${(project.style_profile as any).prompt}\n\nUser changes: ${fullChangeRequest}`;
        }
        finalPrompt = `${fullChangeRequest} [RATIO:${selectedRatio}] [QUALITY:${selectedQuality}]`;
        basePrompt = fullChangeRequest;
      }

      // Create ONE batch job with all selected panoramas
      const newBatchJob = await createBatchJob.mutateAsync({
        panoramaUploadIds: selectedPanoramaIds,
        changeRequest: finalPrompt,
        basePrompt,
        styleProfile: project?.style_profile as Record<string, unknown> | undefined,
        outputResolution: selectedQuality
      });

      // Clear form after batch creation
      setChangeRequest("");
      setComposedPrompt(null);
      setDetectedTemplate(null);
      setImageSelectionOpen(false);

      toast({ 
        title: `Batch job created with ${selectedPanoramaIds.length} image${selectedPanoramaIds.length > 1 ? "s" : ""}`,
        description: "Click to view the batch job",
        action: (
          <ToastAction 
            altText="View batch"
            onClick={() => {
              setActiveTab("panorama-jobs");
              setExpandedBatchId(newBatchJob.id);
              setTimeout(() => {
                const el = document.getElementById(`batch-row-${newBatchJob.id}`);
                if (el) {
                  el.scrollIntoView({ behavior: "smooth", block: "center" });
                  el.classList.add("ring-2", "ring-primary");
                  setTimeout(() => el.classList.remove("ring-2", "ring-primary"), 2000);
                }
              }, 100);
            }}
          >
            View Batch
          </ToastAction>
        )
      });
    } catch (error) {
      toast({
        title: "Failed to create batch job",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
    } finally {
      setIsBatchCreating(false);
    }
  };

  // Open image selection dialog - now checks for panoramaAttachment first
  const openImageSelection = (mode: "composed" | "direct") => {
    // If an image is attached from Creations, use that instead of panorama uploads
    if (panoramaAttachment) {
      console.log("[Panorama] Using attached image for job creation:", panoramaAttachment.uploadId);
      if (mode === "composed") {
        handleCreateJobWithComposedPrompt(panoramaAttachment.uploadId);
      } else {
        handleCreateJob(panoramaAttachment.uploadId);
      }
      // Clear attachment after use
      setPanoramaAttachment(null);
      return;
    }
    
    // No attachment - use uploaded panoramas
    if (panoramas.length === 1) {
      // Only one image, skip dialog and create directly
      if (mode === "composed") {
        handleCreateJobWithComposedPrompt(panoramas[0].id);
      } else {
        handleCreateJob(panoramas[0].id);
      }
    } else {
      setPendingBatchMode(mode);
      setImageSelectionOpen(true);
    }
  };

  const handleStartJob = async (jobId: string) => {
    try {
      await startJob.mutateAsync(jobId);
      toast({ title: "Render started" });
    } catch (error) {
      toast({
        title: "Failed to start render",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
    }
  };

  const handleReview = async (jobId: string, decision: "approved" | "rejected") => {
    try {
      await createReview.mutateAsync({
        jobId,
        decision,
        notes: reviewNotes.trim() || undefined
      });
      toast({ title: decision === "approved" ? "Approved" : "Rejected" });
      setReviewDialogOpen(false);
      setSelectedJob(null);
      setReviewNotes("");
    } catch (error) {
      toast({
        title: "Review failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
    }
  };

  const openReRenderDialog = (job: any) => {
    setReRenderJobId(job.id);
    setReRenderChangeRequest(job.change_request);
    setReRenderDialogOpen(true);
  };

  const handleReRender = async (startImmediately = false) => {
    if (!reRenderJobId) return;
    
    try {
      await reRenderJob.mutateAsync({
        id: reRenderJobId,
        newChangeRequest: reRenderChangeRequest
      });
      
      const jobIdToStart = reRenderJobId;
      setReRenderDialogOpen(false);
      setReRenderJobId(null);
      setReRenderChangeRequest("");
      
      if (startImmediately) {
        await startJob.mutateAsync(jobIdToStart);
        toast({ title: "Re-render started" });
      } else {
        toast({ title: "Job reset to queue" });
      }
    } catch (error) {
      toast({
        title: "Failed to re-render",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
    }
  };

  const handlePreview = async (bucket: string, path: string, isOutput = false) => {
    try {
      const { signedUrl } = await getSignedViewUrl(bucket, path);
      if (isOutput) {
        setOutputPreviewUrl(signedUrl);
      } else {
        setPreviewUrl(signedUrl);
      }
    } catch (error) {
      toast({ title: "Failed to load preview", variant: "destructive" });
    }
  };

  // Track which uploads are currently being loaded (to prevent duplicate requests)
  const loadingRef = useRef<Set<string>>(new Set());

  // Load image previews for thumbnails - uses refs to avoid infinite loop
  const loadImagePreview = useCallback(async (uploadId: string, bucket: string, path: string) => {
    // Skip if already loaded, loading, or marked as missing
    if (loadingRef.current.has(uploadId)) return;
    
    // Check if already in state (read from ref to avoid stale closure)
    setImagePreviews(current => {
      if (current[uploadId]) return current;
      
      // Not loaded yet, start loading
      loadingRef.current.add(uploadId);
      
      getSignedViewUrl(bucket, path).then(result => {
        loadingRef.current.delete(uploadId);
        if (result.notFound || !result.signedUrl) {
          setMissingFiles(prev => new Set(prev).add(uploadId));
        } else {
          setImagePreviews(prev => ({ ...prev, [uploadId]: result.signedUrl }));
        }
      }).catch(() => {
        loadingRef.current.delete(uploadId);
        setMissingFiles(prev => new Set(prev).add(uploadId));
      });
      
      return current;
    });
  }, [getSignedViewUrl]);

  // Load previews when uploads change - only process new items
  useEffect(() => {
    // Use a small batch delay to avoid overwhelming the backend
    const timeoutId = setTimeout(() => {
      const allUploads = [
        ...panoramas.map(p => ({ id: p.id, bucket: p.bucket, path: p.path })),
        ...designRefs.map(r => ({ id: r.id, bucket: r.bucket, path: r.path })),
        ...jobs.filter((j: any) => j.output).map((j: any) => ({ 
          id: j.output.id, 
          bucket: j.output.bucket, 
          path: j.output.path 
        }))
      ];
      
      allUploads.forEach(upload => {
        loadImagePreview(upload.id, upload.bucket, upload.path);
      });
    }, 100); // Small debounce
    
    return () => clearTimeout(timeoutId);
  }, [panoramas, designRefs, jobs, loadImagePreview]);

  // Handle URL params for deep linking from notifications
  useEffect(() => {
    const tabParam = searchParams.get("tab");
    const jobIdParam = searchParams.get("jobId");
    const batchIdParam = searchParams.get("batchId");
    const autoOpenReviewParam = searchParams.get("autoOpenReview");
    
    // Set active tab from URL
    if (tabParam === "jobs" || tabParam === "panorama-jobs") {
      setActiveTab("panorama-jobs");
    } else if (tabParam === "uploads" || tabParam === "panorama-uploads") {
      setActiveTab("panorama-uploads");
    } else if (tabParam === "floor-plan-uploads") {
      setActiveTab("floor-plan-uploads");
    } else if (tabParam === "floor-plan-jobs") {
      setActiveTab("floor-plan-jobs");
    }
    
    // Select job from URL param
    if (jobIdParam) {
      setSelectedJob(jobIdParam);
      
      // Scroll to the job row after a short delay
      setTimeout(() => {
        const element = document.getElementById(`job-row-${jobIdParam}`);
        if (element) {
          element.scrollIntoView({ behavior: "smooth", block: "center" });
          element.classList.add("ring-2", "ring-primary", "ring-offset-2", "ring-offset-background");
          setTimeout(() => {
            element.classList.remove("ring-2", "ring-primary", "ring-offset-2", "ring-offset-background");
          }, 3000);
        }
      }, 300);
      
      // Auto-open review/compare dialog if this is a completed job
      if (autoOpenReviewParam === "true" && !jobsLoading) {
        const job = jobs.find((j: any) => j.id === jobIdParam);
        if (job && (job.status === "needs_review" || job.status === "approved") && job.output && job.panorama) {
          // Load images for compare
          setTimeout(async () => {
            try {
              const beforeResult = await getSignedViewUrl(job.panorama.bucket, job.panorama.path);
              const afterResult = await getSignedViewUrl(job.output.bucket, job.output.path);
              
              if (beforeResult.signedUrl && afterResult.signedUrl) {
                setCompareImages({ 
                  before: beforeResult.signedUrl, 
                  after: afterResult.signedUrl 
                });
                setCompareDialogOpen(true);
              }
            } catch (error) {
              console.error("Failed to load images for compare:", error);
            }
          }, 500);
        }
      }
    }
    
    // Handle batch job selection
    if (batchIdParam) {
      // For now, just scroll to batch row if it exists
      setTimeout(() => {
        const element = document.getElementById(`batch-row-${batchIdParam}`);
        if (element) {
          element.scrollIntoView({ behavior: "smooth", block: "center" });
          element.classList.add("ring-2", "ring-primary", "ring-offset-2", "ring-offset-background");
          setTimeout(() => {
            element.classList.remove("ring-2", "ring-primary", "ring-offset-2", "ring-offset-background");
          }, 3000);
        }
      }, 300);
    }
    
    // Clear URL params after processing to prevent re-triggering
    if (tabParam || jobIdParam || batchIdParam || autoOpenReviewParam) {
      // Only clear after initial load completes
      const timeoutId = setTimeout(() => {
        setSearchParams({}, { replace: true });
      }, 2000);
      return () => clearTimeout(timeoutId);
    }
  }, [searchParams, setSearchParams, jobs, jobsLoading, getSignedViewUrl]);

  const handleDownload = async (bucket: string, path: string, filename?: string) => {
    try {
      const { signedUrl } = await getSignedDownloadUrl(bucket, path, filename);
      window.open(signedUrl, "_blank");
    } catch (error) {
      toast({ title: "Failed to generate download link", variant: "destructive" });
    }
  };

  // Design ref selection for style bible
  const [designRefSelectionOpen, setDesignRefSelectionOpen] = useState(false);
  const [styleReferenceNotes, setStyleReferenceNotes] = useState<Array<{ ref_id: string; contribution: string }>>([]);

  const handleGenerateStyleBible = async (selectedRefIds: string[]) => {
    try {
      // Get the first panorama for panorama-aware style mixing (optional)
      const panoramaUploadId = panoramas.length > 0 ? panoramas[0].id : undefined;
      
      const result = await generateStyleBible.mutateAsync({ 
        selectedRefIds, 
        panoramaUploadId 
      });
      
      setStyleReferenceNotes(result.perReferenceNotes || []);
      setDesignRefSelectionOpen(false);
      toast({ title: "Style prompt generated successfully" });
    } catch (error) {
      toast({
        title: "Failed to generate style prompt",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
    }
  };

  if (authLoading || projectLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!project) {
    return <Navigate to="/projects" replace />;
  }

  const statusColors: Record<string, string> = {
    queued: "bg-muted text-muted-foreground",
    running: "bg-blue-500/20 text-blue-400",
    needs_review: "bg-yellow-500/20 text-yellow-400",
    approved: "bg-green-500/20 text-green-400",
    rejected: "bg-orange-500/20 text-orange-400",
    failed: "bg-destructive/20 text-destructive"
  };

  const isLoading = panoramasLoading || designRefsLoading || jobsLoading;

  return (
    <AppLayout projectId={id!} onNavigate={setActiveTab} pageTitle={project.name}>
      <div className="container mx-auto px-4 py-8">
        {/* Project Header */}
        <div className="flex items-center gap-4 mb-6">
          <Button asChild variant="ghost" size="icon">
            <Link to="/projects">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-xl font-semibold">{project.name}</h1>
            <p className="text-sm text-muted-foreground">Project Dashboard</p>
          </div>
        </div>
            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
              <TabsList className="inline-flex h-auto gap-1 p-1.5 overflow-x-auto bg-muted/50 rounded-lg">
                {/* CREATIONS first */}
                <TabsTrigger value="creations" className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium hover:text-primary [&>svg]:hover:text-primary transition-colors">
                  <Layers className="h-4 w-4 shrink-0 transition-colors" />
                  <span className="whitespace-nowrap">Creations</span>
                </TabsTrigger>
                {/* JOBS / PIPELINE section */}
                <TabsTrigger value="panorama-uploads" className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium hover:text-primary [&>svg]:hover:text-primary transition-colors">
                  <Upload className="h-4 w-4 shrink-0 transition-colors" />
                  <span className="whitespace-nowrap">Panoramas</span>
                </TabsTrigger>
                <TabsTrigger value="panorama-jobs" className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium hover:text-primary [&>svg]:hover:text-primary transition-colors">
                  <Play className="h-4 w-4 shrink-0 transition-colors" />
                  <span className="whitespace-nowrap">P-Jobs ({jobs.length + batchJobs.length})</span>
                </TabsTrigger>
                <TabsTrigger value="floor-plan-uploads" className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium hover:text-primary [&>svg]:hover:text-primary transition-colors">
                  <Grid3X3 className="h-4 w-4 shrink-0 transition-colors" />
                  <span className="whitespace-nowrap">Floor Plans</span>
                </TabsTrigger>
                <TabsTrigger value="floor-plan-jobs" className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium hover:text-primary [&>svg]:hover:text-primary transition-colors">
                  <Play className="h-4 w-4 shrink-0 transition-colors" />
                  <span className="whitespace-nowrap">2D→3D ({pipelines.length})</span>
                </TabsTrigger>
                <TabsTrigger value="image-editing" className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium hover:text-primary [&>svg]:hover:text-primary transition-colors">
                  <Wand2 className="h-4 w-4 shrink-0 transition-colors" />
                  <span className="whitespace-nowrap">Editing</span>
                </TabsTrigger>
                <TabsTrigger value="image-editing-jobs" className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium hover:text-primary [&>svg]:hover:text-primary transition-colors">
                  <CheckCircle className="h-4 w-4 shrink-0 transition-colors" />
                  <span className="whitespace-nowrap">E-Jobs ({imageEditJobs.length})</span>
                </TabsTrigger>
                <TabsTrigger value="multi-image-panorama" className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium hover:text-primary [&>svg]:hover:text-primary transition-colors">
                  <Grid3X3 className="h-4 w-4 shrink-0 transition-colors" />
                  <span className="whitespace-nowrap">Multi-Pano</span>
                </TabsTrigger>
                {/* TOUR */}
                <TabsTrigger value="virtual-tour" className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium hover:text-primary [&>svg]:hover:text-primary transition-colors">
                  <Box className="h-4 w-4 shrink-0 transition-colors" />
                  <span className="whitespace-nowrap">Tour ({virtualTourJobs.length})</span>
                </TabsTrigger>
                {/* TESTS - last */}
                <TabsTrigger value="tests" className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium hover:text-primary [&>svg]:hover:text-primary transition-colors border-l border-border/50 ml-1 pl-3">
                  <Beaker className="h-4 w-4 shrink-0 transition-colors" />
                  <span className="whitespace-nowrap">Tests</span>
                </TabsTrigger>
              </TabsList>

          {/* Panorama Uploads Tab */}
          <TabsContent value="panorama-uploads" className="space-y-6">
            {/* Panoramas Section */}
            <DropZone
              onFilesDropped={(files) => handleFileUpload(files, "panorama")}
              accept="image/*"
              multiple
              disabled={uploading || panoramas.length >= 20}
              isUploading={uploading}
              maxFiles={20}
              currentCount={panoramas.length}
            >
              <Card id="uploads">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span>Panoramas ({panoramas.length}/20)</span>
                    <DropZone.Button disabled={uploading || panoramas.length >= 20} isUploading={uploading}>
                      Upload
                    </DropZone.Button>
                  </CardTitle>
                  <CardDescription>Upload 1–20 panorama images for rendering (or drag & drop)</CardDescription>
                </CardHeader>
                <CardContent>
                  {panoramas.length === 0 ? (
                    <p className="text-muted-foreground text-center py-8">No panoramas uploaded yet. Drag & drop images here or click Upload.</p>
                  ) : (
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {panoramas.map((pano) => {
                      const isMissing = missingFiles.has(pano.id);
                      return (
                        <Card key={pano.id} className={`overflow-hidden ${isMissing ? 'border-destructive/50' : ''}`}>
                          <div 
                            className="aspect-video bg-muted flex items-center justify-center cursor-pointer hover:opacity-90 transition-opacity relative overflow-hidden"
                            onClick={() => !isMissing && handlePreview(pano.bucket, pano.path)}
                          >
                            {isMissing ? (
                              <div className="flex flex-col items-center gap-2 text-destructive">
                                <AlertTriangle className="h-8 w-8" />
                                <span className="text-xs">File missing</span>
                              </div>
                            ) : imagePreviews[pano.id] ? (
                              <img 
                                src={imagePreviews[pano.id]} 
                                alt={pano.original_filename || "Panorama"} 
                                className="w-full h-full object-cover"
                                loading="lazy"
                                decoding="async"
                              />
                            ) : (
                              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                            )}
                            {!isMissing && (
                              <div className="absolute inset-0 bg-black/0 hover:bg-black/20 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                                <Eye className="h-6 w-6 text-white" />
                              </div>
                            )}
                          </div>
                          <CardContent className="p-3">
                            <p className="text-sm truncate font-medium">{pano.original_filename}</p>
                            {isMissing && (
                              <p className="text-xs text-destructive mt-1">Storage file deleted - please remove this entry</p>
                            )}
                            <div className="flex items-center justify-between mt-2">
                              <span className="text-xs text-muted-foreground">
                                {pano.size_bytes ? `${(pano.size_bytes / 1024 / 1024).toFixed(1)} MB` : ""}
                              </span>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  if (confirm(isMissing ? "Remove this orphaned entry?" : "Delete this panorama?")) {
                                    try {
                                      await deleteUploadMutation.mutateAsync({ 
                                        uploadId: pano.id, 
                                        forceDbOnly: isMissing 
                                      });
                                      // Clear from local caches
                                      setImagePreviews(prev => {
                                        const updated = { ...prev };
                                        delete updated[pano.id];
                                        return updated;
                                      });
                                      setMissingFiles(prev => {
                                        const updated = new Set(prev);
                                        updated.delete(pano.id);
                                        return updated;
                                      });
                                    } catch (error) {
                                      // Error handled by hook
                                    }
                                  }
                                }}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
            </DropZone>

            {/* Panorama Attach Panel - shows when images are attached from Creations */}
            {panoramaAttachments.length > 0 && (
              <Card className="border-primary bg-primary/5">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Check className="h-4 w-4 text-primary" />
                      ATTACHED FROM CREATIONS
                      {panoramaAttachments.length > 1 && (
                        <Badge variant="secondary" className="ml-2">
                          {panoramaAttachments.length} images · Batch Job
                        </Badge>
                      )}
                    </CardTitle>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => setPanoramaAttachments([])}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Thumbnails list */}
                  <div className="flex gap-2 flex-wrap">
                    {panoramaAttachments.slice(0, 6).map((att, idx) => (
                      <div key={att.uploadId} className="relative w-16 h-16 rounded-lg overflow-hidden bg-muted border-2 border-primary flex-shrink-0">
                        {att.previewUrl ? (
                          <img src={att.previewUrl} alt={att.filename} className="w-full h-full object-cover" />
                        ) : (
                          <div className="flex items-center justify-center h-full">
                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                          </div>
                        )}
                        {idx === 0 && (
                          <div className="absolute top-0.5 left-0.5 bg-primary text-primary-foreground rounded-full p-0.5">
                            <Check className="h-2 w-2" />
                          </div>
                        )}
                      </div>
                    ))}
                    {panoramaAttachments.length > 6 && (
                      <div className="w-16 h-16 rounded-lg bg-muted border-2 border-dashed flex items-center justify-center text-muted-foreground text-xs">
                        +{panoramaAttachments.length - 6}
                      </div>
                    )}
                  </div>
                  
                  <p className="text-xs text-muted-foreground">
                    Target: Attached images ({panoramaAttachments.length})
                    {panoramaAttachments.length > 1 && " — Will create a Batch Job"}
                  </p>
                  
                  <Button
                    size="sm"
                    onClick={() => {
                      if (panoramaAttachments.length > 1) {
                        // Batch job
                        handleBatchJobCreate(panoramaAttachments.map(a => a.uploadId));
                        setPanoramaAttachments([]);
                      } else if (panoramaAttachments.length === 1) {
                        if (composedPrompt) {
                          handleCreateJobWithComposedPrompt(panoramaAttachments[0].uploadId);
                        } else if (changeRequest.trim()) {
                          handleCreateJob(panoramaAttachments[0].uploadId);
                        } else {
                          toast({ title: "Enter a change request first", variant: "destructive" });
                          return;
                        }
                        setPanoramaAttachments([]);
                      }
                    }}
                    disabled={!changeRequest.trim() && !composedPrompt}
                  >
                    {panoramaAttachments.length > 1 ? "Create Batch Job" : "Create Job with This Image"}
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Change Suggestions Section - appears after panoramas are uploaded */}
            {panoramas.length > 0 && (
              <Card className="border-primary/20 bg-primary/5">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-primary" />
                    Change Suggestions
                  </CardTitle>
                  <CardDescription>
                    Describe how you want to transform your panoramas
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Change Suggestions Panel */}
                  <div className="border border-border/50 rounded-lg p-4 bg-background/50">
                    <Label className="text-sm font-medium mb-3 block">Browse Suggestions</Label>
                    <ChangeSuggestionsPanel 
                      onSelectSuggestion={(prompt) => setChangeRequest(prompt)}
                      hasDesignRefs={designRefs.length > 0}
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="change-request">Change Request</Label>
                    <Textarea
                      id="change-request"
                      placeholder="E.g., 'Replace floor tiles with white marble' or 'Add wooden wall paneling' or 'Change furniture to mid-century modern style'"
                      value={changeRequest}
                      onChange={(e) => setChangeRequest(e.target.value)}
                      className="min-h-[100px]"
                    />
                  </div>
                  
                  {/* Output Options */}
                  <div className="grid grid-cols-2 gap-4 p-4 bg-background/50 rounded-lg border border-border/50">
                    <div className="space-y-2">
                      <Label htmlFor="ratio">Output Ratio</Label>
                      <Select value={selectedRatio} onValueChange={setSelectedRatio}>
                        <SelectTrigger id="ratio" className="bg-background">
                          <div className="flex items-center gap-2">
                            <AspectRatioPreview ratio={selectedRatio} size="sm" selected />
                            <span>{selectedRatio}</span>
                          </div>
                        </SelectTrigger>
                        <SelectContent className="bg-background border-border">
                          <SelectItem value="1:1"><AspectRatioSelectItemContent value="1:1" /></SelectItem>
                          <SelectItem value="16:9"><AspectRatioSelectItemContent value="16:9" /></SelectItem>
                          <SelectItem value="9:16"><AspectRatioSelectItemContent value="9:16" /></SelectItem>
                          <SelectItem value="4:3"><AspectRatioSelectItemContent value="4:3" /></SelectItem>
                          <SelectItem value="3:4"><AspectRatioSelectItemContent value="3:4" /></SelectItem>
                          <SelectItem value="3:2"><AspectRatioSelectItemContent value="3:2" /></SelectItem>
                          <SelectItem value="2:3"><AspectRatioSelectItemContent value="2:3" /></SelectItem>
                          <SelectItem value="4:5"><AspectRatioSelectItemContent value="4:5" /></SelectItem>
                          <SelectItem value="5:4"><AspectRatioSelectItemContent value="5:4" /></SelectItem>
                          <SelectItem value="21:9"><AspectRatioSelectItemContent value="21:9" /></SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="quality">Select Quality</Label>
                      <Select value={selectedQuality} onValueChange={setSelectedQuality}>
                        <SelectTrigger id="quality" className="bg-background">
                          <SelectValue placeholder="Select quality" />
                        </SelectTrigger>
                        <SelectContent className="bg-card border-border">
                          <SelectItem value="1k" className="py-3">
                            <span className="font-medium">1K</span>
                            <span className="text-muted-foreground ml-2">· Fast</span>
                          </SelectItem>
                          <SelectItem value="2k" className="py-3">
                            <span className="font-medium">2K</span>
                            <span className="text-muted-foreground ml-2">· Balanced</span>
                          </SelectItem>
                          <SelectItem value="4k" className="py-3">
                            <span className="font-medium">4K</span>
                            <span className="text-muted-foreground ml-2">· Ultra (4096px)</span>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Compose Prompt Button */}
                  <div className="border-t border-border/50 pt-4">
                    <Button
                      onClick={handleComposePrompt}
                      disabled={!changeRequest.trim() || isComposing}
                      variant="outline"
                      className="w-full border-primary/50 hover:bg-primary/10"
                    >
                      {isComposing ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Wand2 className="h-4 w-4 mr-2" />
                      )}
                      Compose Final Prompt
                    </Button>
                    <p className="text-xs text-muted-foreground text-center mt-2">
                      AI will merge your request with style references and optimize for best results
                    </p>
                  </div>

                  {/* Composed Prompt Display */}
                  {composedPrompt && (
                    <div className="border-t border-border/50 pt-4 space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Check className="h-4 w-4 text-green-500" />
                          <span className="font-medium text-sm">Final Prompt Ready</span>
                        </div>
                        {detectedTemplate && (
                          <Badge variant="secondary" className="text-xs">
                            Template: {detectedTemplate}
                          </Badge>
                        )}
                      </div>
                      
                      <div className="bg-muted/50 rounded-lg p-4 border border-border/50">
                        {isEditingPrompt ? (
                          <Textarea
                            value={composedPrompt}
                            onChange={(e) => setComposedPrompt(e.target.value)}
                            className="min-h-[150px] bg-background"
                          />
                        ) : (
                          <p className="text-sm leading-relaxed whitespace-pre-wrap">
                            {composedPrompt}
                          </p>
                        )}
                      </div>

                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setIsEditingPrompt(!isEditingPrompt)}
                        >
                          <Edit3 className="h-4 w-4 mr-1" />
                          {isEditingPrompt ? "Done Editing" : "Edit"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setComposedPrompt(null);
                            setDetectedTemplate(null);
                          }}
                        >
                          <X className="h-4 w-4 mr-1" />
                          Clear
                        </Button>
                      </div>

                      {/* Approve and Create Render Job */}
                      <Button
                        onClick={() => openImageSelection("composed")}
                        disabled={createJob.isPending || isBatchCreating}
                        className="w-full bg-green-600 hover:bg-green-700"
                      >
                        {(createJob.isPending || isBatchCreating) ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Check className="h-4 w-4 mr-2" />
                        )}
                        Approve & Create Render Job{panoramas.length > 1 ? "s" : ""}
                      </Button>
                    </div>
                  )}

                  {/* Direct Create (without prompt composition) */}
                  {!composedPrompt && (
                    <div className="border-t border-border/50 pt-4">
                      <p className="text-xs text-muted-foreground text-center mb-2">
                        Or skip prompt composition:
                      </p>
                      <Button
                        onClick={() => openImageSelection("direct")}
                        disabled={!changeRequest.trim() || createJob.isPending || isBatchCreating}
                        variant="secondary"
                        className="w-full"
                      >
                        {(createJob.isPending || isBatchCreating) ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Play className="h-4 w-4 mr-2" />
                        )}
                        Create Directly{panoramas.length > 1 ? ` (${panoramas.length} images)` : " (Simple Mode)"}
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Design References Section */}
            <DropZone
              onFilesDropped={(files) => handleFileUpload(files, "design_ref")}
              accept="image/*"
              multiple
              disabled={uploading || designRefs.length >= 8}
              isUploading={uploading}
              maxFiles={8}
              currentCount={designRefs.length}
            >
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span>Design References ({designRefs.length}/8)</span>
                    <DropZone.Button disabled={uploading || designRefs.length >= 8} isUploading={uploading}>
                      Upload
                    </DropZone.Button>
                  </CardTitle>
                  <CardDescription>Optional: Upload up to 8 design reference images (or drag & drop)</CardDescription>
                </CardHeader>
                <CardContent>
                  {designRefs.length === 0 ? (
                    <p className="text-muted-foreground text-center py-8">No design references uploaded. Drag & drop images here or click Upload.</p>
                  ) : (
                  <div className="grid gap-4 md:grid-cols-4 lg:grid-cols-8">
                    {designRefs.map((ref) => {
                      // Auto-load preview
                      if (!imagePreviews[ref.id] && !missingFiles.has(ref.id)) {
                        loadImagePreview(ref.id, ref.bucket, ref.path);
                      }
                      const isMissing = missingFiles.has(ref.id);
                      return (
                        <Card key={ref.id} className={`overflow-hidden ${isMissing ? 'border-destructive/50' : ''}`}>
                          <div 
                            className="aspect-square bg-muted flex items-center justify-center cursor-pointer hover:opacity-90 transition-opacity relative overflow-hidden"
                            onClick={() => !isMissing && handlePreview(ref.bucket, ref.path)}
                          >
                            {isMissing ? (
                              <div className="flex flex-col items-center gap-1 text-destructive">
                                <AlertTriangle className="h-4 w-4" />
                                <span className="text-[10px]">Missing</span>
                              </div>
                            ) : imagePreviews[ref.id] ? (
                              <img 
                                src={imagePreviews[ref.id]} 
                                alt={ref.original_filename || "Reference"} 
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                            )}
                            {!isMissing && (
                              <div className="absolute inset-0 bg-black/0 hover:bg-black/20 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                                <Eye className="h-4 w-4 text-white" />
                              </div>
                            )}
                          </div>
                          <CardContent className="p-2">
                            <p className="text-xs truncate">{ref.original_filename}</p>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 mt-1 text-muted-foreground hover:text-destructive"
                              onClick={async (e) => {
                                e.stopPropagation();
                                if (confirm(isMissing ? "Remove this orphaned entry?" : "Delete this reference?")) {
                                  try {
                                    await deleteUploadMutation.mutateAsync({ 
                                      uploadId: ref.id, 
                                      forceDbOnly: isMissing 
                                    });
                                    // Clear from local caches
                                    setImagePreviews(prev => {
                                      const updated = { ...prev };
                                      delete updated[ref.id];
                                      return updated;
                                    });
                                    setMissingFiles(prev => {
                                      const updated = new Set(prev);
                                      updated.delete(ref.id);
                                      return updated;
                                    });
                                  } catch (error) {
                                    // Error handled by hook
                                  }
                                }
                              }}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
            </DropZone>
          </TabsContent>

          {/* Floor Plan Uploads Tab */}
          <TabsContent value="floor-plan-uploads" className="space-y-6">
            {/* Floor Plans Section */}
            <DropZone
              onFilesDropped={(files) => handleFileUpload(files, "floor_plan")}
              accept="image/*,.pdf"
              multiple
              disabled={uploading || floorPlans.length >= 20}
              isUploading={uploading}
              maxFiles={20}
              currentCount={floorPlans.length}
            >
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span>Floor Plans ({floorPlans.length}/20)</span>
                    <div className="flex items-center gap-4">
                      {/* Thumbnail Size Slider */}
                      {floorPlans.length > 0 && (
                        <div className="flex items-center gap-2 min-w-[140px]">
                          <span className="text-xs text-muted-foreground">Size</span>
                          <input
                            type="range"
                            min={100}
                            max={240}
                            value={floorPlanThumbnailSize}
                            onChange={(e) => {
                              const size = parseInt(e.target.value);
                              console.log(`[FloorPlan] Slider changed: thumbnailSize=${size}`);
                              setFloorPlanThumbnailSize(size);
                              localStorage.setItem("floorplan-thumbnail-size", size.toString());
                            }}
                            className="w-24 h-2 bg-secondary rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
                          />
                        </div>
                      )}
                      <DropZone.Button disabled={uploading || floorPlans.length >= 20} isUploading={uploading}>
                        Upload
                      </DropZone.Button>
                    </div>
                  </CardTitle>
                  <CardDescription>Upload floor plan images for 2D → 3D pipeline (or drag & drop)</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {floorPlans.length === 0 ? (
                    <p className="text-muted-foreground text-center py-8">No floor plans uploaded yet. Drag & drop images here or click Upload.</p>
                  ) : (
                  <div 
                    className="grid gap-4"
                    style={{
                      gridTemplateColumns: `repeat(auto-fill, minmax(${floorPlanThumbnailSize}px, 1fr))`
                    }}
                  >
                    {floorPlans.map((fp) => {
                      // Auto-load preview
                      if (!imagePreviews[fp.id] && !missingFiles.has(fp.id)) {
                        loadImagePreview(fp.id, fp.bucket, fp.path);
                      }
                      const isMissing = missingFiles.has(fp.id);
                      // Check if this floor plan already has a pipeline
                      const hasPipeline = pipelines.some(p => p.floor_plan_upload_id === fp.id);
                      
                      return (
                        <Card key={fp.id} className={`overflow-hidden ${isMissing ? 'border-destructive/50' : ''}`}>
                          <div 
                            className="aspect-square bg-muted flex items-center justify-center cursor-pointer hover:opacity-90 transition-opacity relative overflow-hidden"
                            onClick={() => !isMissing && handlePreview(fp.bucket, fp.path)}
                          >
                            {isMissing ? (
                              <div className="flex flex-col items-center gap-1 text-destructive">
                                <AlertTriangle className="h-4 w-4" />
                                <span className="text-[10px]">Missing</span>
                              </div>
                            ) : imagePreviews[fp.id] ? (
                              <img 
                                src={imagePreviews[fp.id]} 
                                alt={fp.original_filename || "Floor Plan"} 
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                            )}
                            {!isMissing && (
                              <div className="absolute inset-0 bg-black/0 hover:bg-black/20 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                                <Eye className="h-4 w-4 text-white" />
                              </div>
                            )}
                          </div>
                          <CardContent className="p-2 space-y-2">
                            <p className="text-xs truncate">{fp.original_filename}</p>
                            <div className="flex items-center gap-1">
                              {!hasPipeline && !isMissing && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-6 text-xs flex-1"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setPendingFloorPlanId(fp.id);
                                    setPipelineDialogOpen(true);
                                  }}
                                >
                                  <Play className="h-3 w-3 mr-1" />
                                  Start Pipeline
                                </Button>
                              )}
                              {hasPipeline && (
                                <Badge variant="outline" className="text-[10px]">
                                  Pipeline Active
                                </Badge>
                              )}
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-muted-foreground hover:text-destructive"
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  if (confirm(isMissing ? "Remove this orphaned entry?" : "Delete this floor plan?")) {
                                    try {
                                      await deleteUploadMutation.mutateAsync({ 
                                        uploadId: fp.id, 
                                        forceDbOnly: isMissing 
                                      });
                                      setImagePreviews(prev => {
                                        const updated = { ...prev };
                                        delete updated[fp.id];
                                        return updated;
                                      });
                                      setMissingFiles(prev => {
                                        const updated = new Set(prev);
                                        updated.delete(fp.id);
                                        return updated;
                                      });
                                    } catch (error) {
                                      // Error handled by hook
                                    }
                                  }
                                }}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
            </DropZone>
          </TabsContent>

          {/* Panorama Jobs Tab */}
          <TabsContent value="panorama-jobs" className="space-y-4" id="panorama-jobs">
            {(batchJobsLoading || jobsLoading) ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : (batchJobs.length === 0 && jobs.length === 0) ? (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <Play className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No render jobs yet</p>
                  <p className="text-sm text-muted-foreground">Upload panoramas and create jobs from Panorama Uploads</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {/* Batch Jobs Section */}
                {batchJobs.length > 0 && (
                  <>
                    <h3 className="text-sm font-medium text-muted-foreground">Batch Jobs</h3>
                    {batchJobs.map((batchJob) => (
                      <BatchJobCard
                        key={batchJob.id}
                        batchJob={batchJob}
                        projectId={id!}
                        onStartBatch={async (batchId) => {
                          await startBatchJob.mutateAsync(batchId);
                          toast({ title: "Batch job started" });
                        }}
                        isStarting={startBatchJob.isPending}
                        expanded={expandedBatchId === batchJob.id}
                        onToggleExpand={() => setExpandedBatchId(
                          expandedBatchId === batchJob.id ? null : batchJob.id
                        )}
                        imagePreviews={imagePreviews}
                        onOpenTerminal={(jobId) => setTerminalJobId(jobId)}
                      />
                    ))}
                  </>
                )}

                {/* Legacy Individual Render Jobs */}
                {jobs.length > 0 && (
                  <>
                    {batchJobs.length > 0 && (
                      <h3 className="text-sm font-medium text-muted-foreground mt-6">Individual Jobs</h3>
                    )}
                    {jobs.map((job: any) => (
                  <Card key={job.id} id={`job-row-${job.id}`} className="transition-all duration-300">
                    <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <CardTitle className="text-base truncate">
                            {job.panorama?.original_filename || "Unknown panorama"}
                          </CardTitle>
                          {/* Show "Original deleted" badge when panorama is deleted */}
                          {job.panorama_deleted && (
                            <Badge variant="outline" className="text-xs text-orange-400 border-orange-400/50">
                              <ImageOff className="h-3 w-3 mr-1" />
                              Original deleted
                            </Badge>
                          )}
                        </div>
                        <CardDescription>
                          Created {format(new Date(job.created_at), "MMM d, yyyy HH:mm")}
                        </CardDescription>
                      </div>
                      <Badge className={statusColors[job.status]}>{job.status.replace("_", " ")}</Badge>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {/* Output preview thumbnail for completed jobs */}
                      {job.output && (job.status === "needs_review" || job.status === "approved" || job.status === "rejected") && (
                        <div className="flex gap-4">
                          <div className="flex-shrink-0">
                            <div 
                              className={`w-32 h-20 rounded-lg overflow-hidden bg-muted cursor-pointer hover:opacity-90 transition-opacity border border-border/50 ${
                                job.panorama_deleted ? 'cursor-default' : ''
                              }`}
                              onClick={async () => {
                                if (job.panorama_deleted) {
                                  // Can't compare if original is deleted - just show output
                                  try {
                                    const afterUrl = await getSignedViewUrl(job.output.bucket, job.output.path);
                                    setPreviewUrl(afterUrl.signedUrl);
                                  } catch (error) {
                                    toast({ title: "Failed to load image", variant: "destructive" });
                                  }
                                  return;
                                }
                                try {
                                  const beforeUrl = await getSignedViewUrl(job.panorama.bucket, job.panorama.path);
                                  const afterUrl = await getSignedViewUrl(job.output.bucket, job.output.path);
                                  setCompareImages({
                                    before: beforeUrl.signedUrl,
                                    after: afterUrl.signedUrl
                                  });
                                  setCompareDialogOpen(true);
                                } catch (error) {
                                  toast({ title: "Failed to load images", variant: "destructive" });
                                }
                              }}
                            >
                              {imagePreviews[job.output.id] ? (
                                <img 
                                  src={imagePreviews[job.output.id]} 
                                  alt="Output preview" 
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                </div>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-1 text-center">
                              {job.panorama_deleted ? "View output" : "Click to compare"}
                            </p>
                          </div>
                          <div className="flex-1">
                            <Label className="text-xs text-muted-foreground">Change Request</Label>
                            <p className="text-sm mt-1">{job.change_request}</p>
                          </div>
                        </div>
                      )}

                      {/* QA Attempts Panel for jobs with attempts tracking */}
                      {(job.status === "needs_review" || job.status === "approved" || job.status === "rejected") && job.attempts > 0 && (
                        <QAAttemptsPanel 
                          jobId={job.id} 
                          onViewOutput={async (bucket, path) => {
                            try {
                              const url = await getSignedViewUrl(bucket, path);
                              setPreviewUrl(url.signedUrl);
                            } catch {
                              toast({ title: "Failed to load image", variant: "destructive" });
                            }
                          }}
                        />
                      )}

                      {/* Panorama preview + change request (no output yet) */}
                      {!job.output && (
                        <div className="flex gap-4">
                          <div className="flex-shrink-0">
                            <div className="w-32 h-20 rounded-lg overflow-hidden bg-muted border border-border/50">
                              {imagePreviews[job.panorama?.id] ? (
                                <img 
                                  src={imagePreviews[job.panorama.id]} 
                                  alt="Panorama preview" 
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                  <Image className="h-4 w-4 text-muted-foreground" />
                                </div>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-1 text-center">Input image</p>
                          </div>
                          <div className="flex-1">
                            <Label className="text-xs text-muted-foreground">Change Request</Label>
                            <p className="text-sm mt-1">{job.change_request}</p>
                          </div>
                        </div>
                      )}

                      {job.last_error && (
                          <div className="space-y-2">
                            <div className="bg-destructive/10 text-destructive rounded p-3 text-sm">
                              <strong>Error:</strong> {job.last_error}
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setTerminalJobId(terminalJobId === job.id ? null : job.id)}
                            >
                              <Terminal className="h-4 w-4 mr-2" />
                              {terminalJobId === job.id ? "Hide Log" : "View Log"}
                            </Button>
                          </div>
                        )}

                      <div className="flex flex-wrap gap-2">
                        {(job.status === "queued" || job.status === "failed") && (
                          <Button
                            size="sm"
                            onClick={() => handleStartJob(job.id)}
                            disabled={startJob.isPending}
                          >
                            {startJob.isPending ? (
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                              <Play className="h-4 w-4 mr-2" />
                            )}
                            Run Now
                          </Button>
                        )}

                        {job.status === "running" && (
                          <div className="w-full space-y-3">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
                                <span className={`text-sm ${
                                  (runningJob?.id === job.id ? latestMessage : (job as any).progress_message)?.toLowerCase().includes("retry") 
                                    ? "text-yellow-400" 
                                    : "text-muted-foreground"
                                }`}>
                                  {runningJob?.id === job.id ? (latestMessage || "Processing...") : ((job as any).progress_message || "Processing...")}
                                </span>
                              </div>
                              <Button
                                size="sm"
                                variant={terminalJobId === job.id ? "default" : "outline"}
                                onClick={() => setTerminalJobId(terminalJobId === job.id ? null : job.id)}
                              >
                                <Terminal className="h-4 w-4 mr-2" />
                                {terminalJobId === job.id ? "Hide Log" : "Show Log"}
                              </Button>
                            </div>
                            <div className="space-y-1">
                              <Progress 
                                value={runningJob?.id === job.id ? realTimeProgress : ((job as any).progress_int || 0)} 
                                className={`h-2 ${
                                  (runningJob?.id === job.id ? latestMessage : (job as any).progress_message)?.toLowerCase().includes("retry")
                                    ? "bg-yellow-500/20"
                                    : "bg-muted"
                                }`}
                              />
                              <div className="flex justify-between text-xs text-muted-foreground">
                                <span>
                                  {(runningJob?.id === job.id ? latestMessage : (job as any).progress_message)?.toLowerCase().includes("retry") && (
                                    <span className="text-yellow-400 mr-2">⚠ Recovering...</span>
                                  )}
                                </span>
                                <span>{runningJob?.id === job.id ? realTimeProgress : ((job as any).progress_int || 0)}%</span>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Single terminal render - outside of status-specific blocks */}
                        {terminalJobId === job.id && (
                          <RenderJobTerminal jobId={job.id} isOpen={true} />
                        )}

                        {job.status === "needs_review" && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={async () => {
                                await handlePreview(job.panorama.bucket, job.panorama.path);
                                if (job.output) {
                                  await handlePreview(job.output.bucket, job.output.path, true);
                                }
                                setSelectedJob(job.id);
                                setReviewDialogOpen(true);
                              }}
                            >
                              <Eye className="h-4 w-4 mr-2" />
                              Review
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => openReRenderDialog(job)}
                            >
                              <RefreshCw className="h-4 w-4 mr-2" />
                              Re-render
                            </Button>
                          </>
                        )}

                        {job.output && (
                          <>
                            <Button
                              size="sm"
                              className="bg-primary/20 text-primary hover:bg-primary/30 border border-primary/40"
                              onClick={async () => {
                                try {
                                  const beforeUrl = await getSignedViewUrl(job.panorama.bucket, job.panorama.path);
                                  const afterUrl = await getSignedViewUrl(job.output.bucket, job.output.path);
                                  setCompareImages({
                                    before: beforeUrl.signedUrl,
                                    after: afterUrl.signedUrl
                                  });
                                  setCompareDialogOpen(true);
                                } catch (error) {
                                  toast({ title: "Failed to load images", variant: "destructive" });
                                }
                              }}
                            >
                              <Eye className="h-4 w-4 mr-2" />
                              Compare Before/After
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => handleDownload(job.output.bucket, job.output.path, job.output.original_filename || `output-${job.id}.png`)}
                            >
                              <Download className="h-4 w-4 mr-2" />
                              Download
                            </Button>
                          </>
                        )}

                        {(job.status === "rejected" || job.status === "approved") && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openReRenderDialog(job)}
                          >
                            <RefreshCw className="h-4 w-4 mr-2" />
                            {job.status === "rejected" ? "Edit & Re-render" : "Re-render"}
                          </Button>
                        )}

                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => {
                            if (confirm("Delete this job?")) {
                              deleteJob.mutate(job.id);
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
                  </>
                )}
              </div>
            )}
          </TabsContent>

          {/* 2D→3D Floor Plan Jobs Tab */}
          <TabsContent value="floor-plan-jobs" className="space-y-4" id="floor-plan-jobs">
            {pipelinesLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : pipelines.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <Wand2 className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No 2D→3D pipeline jobs yet</p>
                  <p className="text-sm text-muted-foreground">Upload floor plans and click "Start Pipeline" to begin</p>
                </CardContent>
              </Card>
            ) : (
              <>
                {/* Check if any pipeline is Whole Apartment mode */}
                {pipelines.some(p => p.pipeline_mode === "whole_apartment") ? (
                  // Whole Apartment Mode: Show space-centric cards without suggestions sidebar
                  <div className="space-y-4">
                    {pipelines.map((pipeline) => (
                      pipeline.pipeline_mode === "whole_apartment" ? (
                        <WholeApartmentPipelineCard
                          key={pipeline.id}
                          pipeline={pipeline}
                          imagePreviews={imagePreviews}
                          onUpdatePipeline={() => {
                            queryClient.invalidateQueries({ queryKey: ["floorplan-pipelines", id] });
                          }}
                        />
                      ) : (
                        <FloorPlanPipelineCard
                          key={pipeline.id}
                          pipeline={pipeline}
                          onStartStep={async (pipelineId, cameraPos, forwardDir, designRefUploadIds, styleTitle, outputCount, step3PresetId, step3CustomPrompt) => {
                            await startStep.mutateAsync({ 
                              pipelineId, 
                              cameraPosition: cameraPos,
                              forwardDirection: forwardDir,
                              designRefUploadIds,
                              styleTitle,
                              outputCount,
                              step3PresetId,
                              step3CustomPrompt
                            });
                          }}
                          onApproveStep={async (pipelineId, stepNumber, notes) => {
                            await approveStep.mutateAsync({ pipelineId, stepNumber, notes });
                          }}
                          onRejectStep={async (pipelineId, stepNumber, notes) => {
                            await rejectStep.mutateAsync({ pipelineId, stepNumber, notes });
                          }}
                          onSkipToStep={async (pipelineId, targetStep) => {
                            await skipToStep.mutateAsync({ pipelineId, targetStep });
                          }}
                          onGoBackToStep={async (pipelineId, targetStep) => {
                            await goBackToStep.mutateAsync({ pipelineId, targetStep });
                          }}
                          onAttachToPanoramas={async (pipelineId, outputUploadId) => {
                            await attachToPanoramas.mutateAsync({ pipelineId, outputUploadId });
                            setActiveTab("panorama-uploads");
                          }}
                          onUpdateSettings={async (pipelineId, outputResolution, aspectRatio) => {
                            await updateSettings.mutateAsync({ pipelineId, outputResolution, aspectRatio });
                          }}
                          onResetPipeline={async (pipelineId) => {
                            await resetPipeline.mutateAsync({ pipelineId });
                          }}
                          onDeletePipeline={async (pipelineId) => {
                            console.log(`[ProjectDetail] Deleting pipeline: ${pipelineId}`);
                            await deletePipeline.mutateAsync({ pipelineId });
                          }}
                          isStarting={startStep.isPending}
                          isAttaching={attachToPanoramas.isPending}
                          isResetting={resetPipeline.isPending}
                          isDeleting={deletePipeline.isPending}
                          isGoingBack={goBackToStep.isPending}
                          imagePreviews={imagePreviews}
                          onStep2RefsChange={setStep2HasRefs}
                          step2SuggestionsActive={step2SuggestionsActive}
                        />
                      )
                    ))}
                  </div>
                ) : (
                  // Legacy Mode: Show step-centric cards with suggestions sidebar
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    {/* Main pipelines list */}
                    <div className="lg:col-span-2 space-y-4">
                      {pipelines.map((pipeline) => (
                        <FloorPlanPipelineCard
                          key={pipeline.id}
                          pipeline={pipeline}
                          onStartStep={async (pipelineId, cameraPos, forwardDir, designRefUploadIds, styleTitle, outputCount, step3PresetId, step3CustomPrompt) => {
                            await startStep.mutateAsync({ 
                              pipelineId, 
                              cameraPosition: cameraPos,
                              forwardDirection: forwardDir,
                              designRefUploadIds,
                              styleTitle,
                              outputCount,
                              step3PresetId,
                              step3CustomPrompt
                            });
                          }}
                          onApproveStep={async (pipelineId, stepNumber, notes) => {
                            await approveStep.mutateAsync({ pipelineId, stepNumber, notes });
                          }}
                          onRejectStep={async (pipelineId, stepNumber, notes) => {
                            await rejectStep.mutateAsync({ pipelineId, stepNumber, notes });
                          }}
                          onSkipToStep={async (pipelineId, targetStep) => {
                            await skipToStep.mutateAsync({ pipelineId, targetStep });
                          }}
                          onGoBackToStep={async (pipelineId, targetStep) => {
                            await goBackToStep.mutateAsync({ pipelineId, targetStep });
                          }}
                          onAttachToPanoramas={async (pipelineId, outputUploadId) => {
                            await attachToPanoramas.mutateAsync({ pipelineId, outputUploadId });
                            setActiveTab("panorama-uploads");
                          }}
                          onUpdateSettings={async (pipelineId, outputResolution, aspectRatio) => {
                            await updateSettings.mutateAsync({ pipelineId, outputResolution, aspectRatio });
                          }}
                          onResetPipeline={async (pipelineId) => {
                            await resetPipeline.mutateAsync({ pipelineId });
                          }}
                          onDeletePipeline={async (pipelineId) => {
                            console.log(`[ProjectDetail] Deleting pipeline: ${pipelineId}`);
                            await deletePipeline.mutateAsync({ pipelineId });
                          }}
                          isStarting={startStep.isPending}
                          isAttaching={attachToPanoramas.isPending}
                          isResetting={resetPipeline.isPending}
                          isDeleting={deletePipeline.isPending}
                          isGoingBack={goBackToStep.isPending}
                          imagePreviews={imagePreviews}
                          onStep2RefsChange={setStep2HasRefs}
                          step2SuggestionsActive={step2SuggestionsActive}
                        />
                      ))}
                    </div>

                    {/* Suggestions sidebar - only for Legacy mode */}
                    <div className="lg:col-span-1">
                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm">2D→3D Suggestions</CardTitle>
                          <CardDescription className="text-xs">
                            Apply suggestions to pipeline steps
                          </CardDescription>
                        </CardHeader>
                        <CardContent>
                          <PipelineSuggestionsPanel
                            currentStep={pipelines[0]?.current_step || 1}
                            isInReview={pipelines[0]?.status?.includes("waiting_approval") || false}
                            isStepRunning={pipelines[0]?.status?.includes("running") || false}
                            isStepRejected={pipelines[0]?.status?.includes("rejected") || false}
                            step2HasReferences={step2HasRefs}
                            onStep2SuggestionsActive={setStep2SuggestionsActive}
                            onApplyPrompt={(stepNumber, prompt) => {
                              toast({
                                title: "Prompt applied",
                                description: `Step ${stepNumber}: "${prompt.substring(0, 50)}..."`
                              });
                            }}
                          />
                        </CardContent>
                      </Card>
                    </div>
                  </div>
                )}
              </>
            )}
          </TabsContent>

          {/* Image Editing Tab */}
          <TabsContent value="image-editing" className="space-y-6">
            <ImageEditingTab
              projectId={id!}
              attachedFromCreations={editAttachments}
              onClearAttachment={() => setEditAttachments([])}
              onRemoveSingleAttachment={(uploadId) => {
                setEditAttachments(prev => prev.filter(a => a.uploadId !== uploadId));
              }}
              onEditComplete={(outputUploadId) => {
                toast({ title: "Edit complete! Check Creations tab for result." });
                setEditAttachments([]);
              }}
            />
          </TabsContent>

          {/* Image Editing Jobs Tab */}
          <TabsContent value="image-editing-jobs" className="space-y-6">
            <ImageEditJobsTab projectId={id!} />
          </TabsContent>

          {/* Creations Tab */}
          <TabsContent value="creations" className="space-y-6">
            <CreationsTab
              projectId={id!}
              onAttachToStage={(uploadId, stage) => {
                toast({
                  title: `Image attached to Stage ${stage}`,
                  description: "Navigate to 2D→3D Jobs to use this attachment"
                });
              }}
              onEditImage={async (uploadId) => {
                try {
                  const { data: upload } = await supabase
                    .from("uploads")
                    .select("id, original_filename, bucket, path")
                    .eq("id", uploadId)
                    .single();
                  
                  if (upload) {
                    const previewResult = await getSignedViewUrl(upload.bucket, upload.path);
                    setEditAttachments([{
                      uploadId: upload.id,
                      filename: upload.original_filename || `Image ${upload.id.slice(0, 8)}`,
                      previewUrl: previewResult.signedUrl
                    }]);
                    
                    if (VALID_TABS.includes("image-editing")) {
                      setActiveTab("image-editing");
                      toast({ 
                        title: "Image attached for editing",
                        description: "Click to view",
                        action: (
                          <ToastAction 
                            altText="View"
                            onClick={() => setActiveTab("image-editing")}
                          >
                            View
                          </ToastAction>
                        )
                      });
                    }
                  }
                } catch (error) {
                  toast({ title: "Failed to attach image", variant: "destructive" });
                }
              }}
              onUsePanorama={async (uploadId) => {
                console.log(`[Creations] onUsePanorama: uploadId=${uploadId}`);
                try {
                  const { data: upload } = await supabase
                    .from("uploads")
                    .select("id, original_filename, bucket, path")
                    .eq("id", uploadId)
                    .single();
                  
                  if (upload) {
                    const previewResult = await getSignedViewUrl(upload.bucket, upload.path);
                    setPanoramaAttachments([{
                      uploadId: upload.id,
                      filename: upload.original_filename || `Image ${upload.id.slice(0, 8)}`,
                      previewUrl: previewResult.signedUrl
                    }]);
                    
                    if (VALID_TABS.includes("panorama-uploads")) {
                      setActiveTab("panorama-uploads");
                      toast({ 
                        title: "Image attached for Panorama workflow",
                        description: "Click to view",
                        action: (
                          <ToastAction 
                            altText="View"
                            onClick={() => setActiveTab("panorama-uploads")}
                          >
                            View
                          </ToastAction>
                        )
                      });
                    }
                  }
                } catch (error) {
                  console.error("[Creations] Failed to attach panorama:", error);
                  toast({ title: "Failed to prepare for panorama", variant: "destructive" });
                }
              }}
              onAttachMultiToPanorama={async (uploadIds) => {
                console.log(`[Creations] Multi-attach to Panorama: ${uploadIds.length} images`);
                try {
                  const { data: uploads } = await supabase
                    .from("uploads")
                    .select("id, original_filename, bucket, path")
                    .in("id", uploadIds);
                  
                  if (uploads && uploads.length > 0) {
                    const attachments = await Promise.all(
                      uploads.map(async (upload) => {
                        const previewResult = await getSignedViewUrl(upload.bucket, upload.path);
                        return {
                          uploadId: upload.id,
                          filename: upload.original_filename || `Image ${upload.id.slice(0, 8)}`,
                          previewUrl: previewResult.signedUrl
                        };
                      })
                    );
                    
                    setPanoramaAttachments(attachments);
                    
                    if (VALID_TABS.includes("panorama-uploads")) {
                      setActiveTab("panorama-uploads");
                      const isBatch = attachments.length > 1;
                      toast({ 
                        title: isBatch 
                          ? `${attachments.length} images attached (Batch Job)` 
                          : "Image attached for Panorama workflow",
                        description: "Click to view",
                        action: (
                          <ToastAction 
                            altText="View"
                            onClick={() => setActiveTab("panorama-uploads")}
                          >
                            View
                          </ToastAction>
                        )
                      });
                    }
                  }
                } catch (error) {
                  console.error("[Creations] Failed to attach panoramas:", error);
                  toast({ title: "Failed to prepare attachments", variant: "destructive" });
                }
              }}
              onAttachMultiToEdit={async (uploadIds) => {
                console.log(`[Creations] Multi-attach to Edit: ${uploadIds.length} images`);
                try {
                  const { data: uploads } = await supabase
                    .from("uploads")
                    .select("id, original_filename, bucket, path")
                    .in("id", uploadIds);
                  
                  if (uploads && uploads.length > 0) {
                    const attachments = await Promise.all(
                      uploads.map(async (upload) => {
                        const previewResult = await getSignedViewUrl(upload.bucket, upload.path);
                        return {
                          uploadId: upload.id,
                          filename: upload.original_filename || `Image ${upload.id.slice(0, 8)}`,
                          previewUrl: previewResult.signedUrl
                        };
                      })
                    );
                    
                    setEditAttachments(attachments);
                    
                    if (VALID_TABS.includes("image-editing")) {
                      setActiveTab("image-editing");
                      const isBatch = attachments.length > 1;
                      toast({ 
                        title: isBatch 
                          ? `${attachments.length} images attached (Batch Edit)` 
                          : "Image attached for editing",
                        description: "Click to view",
                        action: (
                          <ToastAction 
                            altText="View"
                            onClick={() => setActiveTab("image-editing")}
                          >
                            View
                          </ToastAction>
                        )
                      });
                    }
                  }
                } catch (error) {
                  console.error("[Creations] Failed to attach for editing:", error);
                  toast({ title: "Failed to prepare attachments", variant: "destructive" });
                }
              }}
              onAttachMultiToVirtualTour={async (uploadIds) => {
                console.log(`[Creations] Multi-attach to Virtual Tour: ${uploadIds.length} images`);
                try {
                  const { data: uploads } = await supabase
                    .from("uploads")
                    .select("id, original_filename, bucket, path")
                    .in("id", uploadIds);
                  
                  if (uploads && uploads.length > 0) {
                    const attachments = await Promise.all(
                      uploads.map(async (upload) => {
                        const previewResult = await getSignedViewUrl(upload.bucket, upload.path);
                        return {
                          uploadId: upload.id,
                          filename: upload.original_filename || `Image ${upload.id.slice(0, 8)}`,
                          previewUrl: previewResult.signedUrl
                        };
                      })
                    );
                    
                    setVirtualTourAttachments(attachments);
                    
                    if (VALID_TABS.includes("virtual-tour")) {
                      setActiveTab("virtual-tour");
                      toast({ 
                        title: `${attachments.length} image(s) attached to Virtual Tour`,
                        description: "Click to view",
                        action: (
                          <ToastAction 
                            altText="View"
                            onClick={() => setActiveTab("virtual-tour")}
                          >
                            View
                          </ToastAction>
                        )
                      });
                    }
                  }
                } catch (error) {
                  console.error("[Creations] Failed to attach to Virtual Tour:", error);
                  toast({ title: "Failed to prepare attachments", variant: "destructive" });
                }
              }}
              onAttachMultiToMultiPanorama={async (uploadIds) => {
                console.log(`[Creations] Multi-attach to Multi-Image Panorama: ${uploadIds.length} images`);
                try {
                  const { data: uploads } = await supabase
                    .from("uploads")
                    .select("id, original_filename, bucket, path")
                    .in("id", uploadIds);
                  
                  if (uploads && uploads.length > 0) {
                    const attachments = await Promise.all(
                      uploads.map(async (upload) => {
                        const previewResult = await getSignedViewUrl(upload.bucket, upload.path);
                        return {
                          uploadId: upload.id,
                          filename: upload.original_filename || `Image ${upload.id.slice(0, 8)}`,
                          previewUrl: previewResult.signedUrl
                        };
                      })
                    );
                    
                    setMultiPanoramaAttachments(attachments);
                    
                    if (VALID_TABS.includes("multi-image-panorama")) {
                      setActiveTab("multi-image-panorama");
                      toast({ 
                        title: `${attachments.length} image(s) attached for Multi-Image Panorama`,
                        description: "Click to view",
                        action: (
                          <ToastAction 
                            altText="View"
                            onClick={() => setActiveTab("multi-image-panorama")}
                          >
                            View
                          </ToastAction>
                        )
                      });
                    }
                  }
                } catch (error) {
                  console.error("[Creations] Failed to attach to Multi-Image Panorama:", error);
                  toast({ title: "Failed to prepare attachments", variant: "destructive" });
                }
              }}
              onCreatePipeline={async (floorPlanUploadId, startFromStep, inputUploadId) => {
                console.log(`[Creations] onCreatePipeline: floorPlan=${floorPlanUploadId}, step=${startFromStep}, input=${inputUploadId}`);
                
                // Check for running pipelines - prevent parallel execution
                const runningPipeline = pipelines.find(p => p.status.includes("running"));
                if (runningPipeline) {
                  const confirmed = window.confirm(
                    "Starting a new pipeline will stop the current one. Continue?"
                  );
                  if (!confirmed) return;
                  
                  // Reset the running pipeline before creating new one
                  if (resetPipeline) {
                    await resetPipeline.mutateAsync({ pipelineId: runningPipeline.id });
                  }
                }
                
                try {
                  const newPipeline = await createPipeline.mutateAsync({
                    floorPlanUploadId,
                    startFromStep,
                    inputUploadId,
                    outputResolution: pipelineQuality,
                    aspectRatio: pipelineRatio,
                    attachSource: { type: "creations_attach", sourceImageId: inputUploadId }
                  });
                  
                  if (VALID_TABS.includes("floor-plan-jobs")) {
                    setActiveTab("floor-plan-jobs");
                    toast({ 
                      title: `New pipeline created from Step ${startFromStep}`,
                      description: "Click to view the pipeline",
                      action: (
                        <ToastAction 
                          altText="View pipeline"
                          onClick={() => {
                            setActiveTab("floor-plan-jobs");
                            setTimeout(() => {
                              const el = document.getElementById(`pipeline-row-${newPipeline.id}`);
                              if (el) {
                                el.scrollIntoView({ behavior: "smooth", block: "center" });
                                el.classList.add("ring-2", "ring-primary");
                                setTimeout(() => el.classList.remove("ring-2", "ring-primary"), 2000);
                              }
                            }, 100);
                          }}
                        >
                          View Pipeline
                        </ToastAction>
                      )
                    });
                  }
                } catch (error) {
                  console.error("[Creations] Pipeline creation failed:", error);
                  toast({ 
                    title: "Failed to create pipeline", 
                    description: error instanceof Error ? error.message : "Unknown error",
                    variant: "destructive" 
                  });
                }
              }}
            />
          </TabsContent>

          {/* Virtual Tour Tab */}
          <TabsContent value="virtual-tour" className="space-y-6">
            <VirtualTourTab
              projectId={id!}
              creationsAttachments={virtualTourAttachments}
              onClearAttachments={() => setVirtualTourAttachments([])}
            />
          </TabsContent>

          {/* Multi-Image Panorama Tab */}
          <TabsContent value="multi-image-panorama" className="space-y-6">
            <MultiImagePanoramaTab
              projectId={id!}
              creationsAttachments={multiPanoramaAttachments}
              onClearAttachments={() => setMultiPanoramaAttachments([])}
            />
          </TabsContent>

          {/* Tests Tab */}
          <TabsContent value="tests" className="space-y-6">
            <TestsTab projectId={id!} />
          </TabsContent>
        </Tabs>

      {/* Preview Dialog */}
      <Dialog open={!!previewUrl && !reviewDialogOpen} onOpenChange={(open) => !open && setPreviewUrl(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Image Preview</DialogTitle>
          </DialogHeader>
          {previewUrl && (
            <img src={previewUrl} alt="Preview" className="w-full rounded-lg" />
          )}
        </DialogContent>
      </Dialog>

      {/* Review Dialog */}
      <Dialog open={reviewDialogOpen} onOpenChange={(open) => {
        setReviewDialogOpen(open);
        if (!open) {
          setSelectedJob(null);
          setPreviewUrl(null);
          setOutputPreviewUrl(null);
        }
      }}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Review Render Output</DialogTitle>
          </DialogHeader>
          
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <Label className="text-sm text-muted-foreground mb-2 block">Before (Original)</Label>
              {previewUrl && (
                <img src={previewUrl} alt="Before" className="w-full rounded-lg border" />
              )}
            </div>
            <div>
              <Label className="text-sm text-muted-foreground mb-2 block">After (Rendered)</Label>
              {outputPreviewUrl && (
                <img src={outputPreviewUrl} alt="After" className="w-full rounded-lg border" />
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Review Notes (optional)</Label>
            <Textarea
              value={reviewNotes}
              onChange={(e) => setReviewNotes(e.target.value)}
              placeholder="Add any notes about this render..."
              rows={2}
            />
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="destructive"
              onClick={() => selectedJob && handleReview(selectedJob, "rejected")}
              disabled={createReview.isPending}
            >
              <X className="h-4 w-4 mr-2" />
              Reject
            </Button>
            <Button
              onClick={() => selectedJob && handleReview(selectedJob, "approved")}
              disabled={createReview.isPending}
            >
              <Check className="h-4 w-4 mr-2" />
              Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Before/After Compare Dialog */}
      <Dialog open={compareDialogOpen} onOpenChange={(open) => {
        setCompareDialogOpen(open);
        if (!open) setCompareImages(null);
      }}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Before / After Comparison</DialogTitle>
          </DialogHeader>
          {compareImages && (
            <BeforeAfterSlider
              beforeImage={compareImages.before}
              afterImage={compareImages.after}
              beforeLabel="Original"
              afterLabel="Rendered"
            />
          )}
          <p className="text-sm text-muted-foreground text-center">
            Drag the slider to compare before and after
          </p>
        </DialogContent>
      </Dialog>

      {/* Image Selection Dialog */}
      <ImageSelectionDialog
        open={imageSelectionOpen}
        onOpenChange={setImageSelectionOpen}
        panoramas={panoramas}
        imagePreviews={imagePreviews}
        onConfirm={handleBatchJobCreate}
        isLoading={isBatchCreating}
      />

      {/* Re-render Dialog */}
      <Dialog open={reRenderDialogOpen} onOpenChange={(open) => {
        setReRenderDialogOpen(open);
        if (!open) {
          setReRenderJobId(null);
          setReRenderChangeRequest("");
        }
      }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5" />
              Re-render Image
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Change Request</Label>
              <Textarea
                value={reRenderChangeRequest}
                onChange={(e) => setReRenderChangeRequest(e.target.value)}
                placeholder="Describe the changes you want..."
                className="min-h-[120px]"
              />
              <p className="text-xs text-muted-foreground">
                Edit the prompt to refine the output, or keep it the same to retry with the current settings.
              </p>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setReRenderDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="secondary"
              onClick={() => handleReRender(false)}
              disabled={reRenderJob.isPending || startJob.isPending}
            >
              Save to Queue
            </Button>
            <Button
              onClick={() => handleReRender(true)}
              disabled={reRenderJob.isPending || startJob.isPending || !reRenderChangeRequest.trim()}
            >
              {(reRenderJob.isPending || startJob.isPending) ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              Re-render Now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Design Ref Selection Dialog for Style Bible Generation */}
      <DesignRefSelectionDialog
        open={designRefSelectionOpen}
        onOpenChange={setDesignRefSelectionOpen}
        designRefs={designRefs}
        imagePreviews={imagePreviews}
        onConfirm={handleGenerateStyleBible}
        isLoading={isGenerating}
      />

      {/* Pipeline Creation Dialog with Mode/Quality/Ratio Selection */}
      <Dialog open={pipelineDialogOpen} onOpenChange={(open) => {
        setPipelineDialogOpen(open);
        if (!open) {
          setPendingFloorPlanId(null);
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Play className="h-5 w-5 text-primary" />
              Start Floor Plan Pipeline
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Pipeline Mode Selection */}
            <div className="space-y-2">
              <Label>Pipeline Mode</Label>
              <Select value={pipelineMode} onValueChange={(v) => setPipelineMode(v as "legacy" | "whole_apartment")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="whole_apartment">
                    <div className="flex items-center gap-2">
                      <Box className="h-4 w-4 text-primary" />
                      <span className="font-medium">Whole Apartment Pipeline</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="legacy">
                    <div className="flex items-center gap-2">
                      <Layers className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">Legacy – Single Image Pipeline</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {pipelineMode === "whole_apartment" 
                  ? "Space-centric workflow: detects rooms, generates dual renders per space, and creates merged 360°s."
                  : "Linear step-by-step workflow for single images."
                }
              </p>
            </div>

            {/* Output Quality: Locked at 2K until Step 4 per quality policy */}
            <div className="space-y-2">
              <Label>Output Quality</Label>
              <div className="flex items-center gap-2 h-10 px-3 rounded-md border border-input bg-muted/50">
                <Lock className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">2K (2048px)</span>
                <Badge variant="secondary" className="ml-auto text-xs">Locked until Step 4</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Steps 0–3 always run at 2K. Quality selection available from Step 4 onward.
              </p>
            </div>
            
            <div className="space-y-2">
              <Label>Aspect Ratio</Label>
              <Select value={pipelineRatio} onValueChange={setPipelineRatio}>
                <SelectTrigger>
                  <div className="flex items-center gap-2">
                    <AspectRatioPreview ratio={pipelineRatio} size="sm" selected />
                    <span>{pipelineRatio}</span>
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="16:9"><AspectRatioSelectItemContent value="16:9" /></SelectItem>
                  <SelectItem value="21:9"><AspectRatioSelectItemContent value="21:9" /></SelectItem>
                  <SelectItem value="4:3"><AspectRatioSelectItemContent value="4:3" /></SelectItem>
                  <SelectItem value="1:1"><AspectRatioSelectItemContent value="1:1" /></SelectItem>
                  {pipelineMode === "legacy" && (
                    <SelectItem value="2:1"><AspectRatioSelectItemContent value="2:1" /></SelectItem>
                  )}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {pipelineMode === "whole_apartment" 
                  ? "Panoramas always use 2:1 (equirectangular) regardless of this setting."
                  : "Recommended: 16:9 for most renders, 2:1 for panoramas"
                }
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPipelineDialogOpen(false)}>Cancel</Button>
            <Button 
              onClick={async () => {
                if (pendingFloorPlanId) {
                  // Force 2K for steps 0-4 per quality policy (ignore UI quality state)
                  await createPipeline.mutateAsync({
                    floorPlanUploadId: pendingFloorPlanId,
                    outputResolution: "2K", // Locked until Step 4
                    aspectRatio: pipelineRatio,
                    pipelineMode: pipelineMode
                  });
                  setPipelineDialogOpen(false);
                  setPendingFloorPlanId(null);
                }
              }}
              disabled={createPipeline.isPending}
            >
              {createPipeline.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              Create Pipeline
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
    </AppLayout>
  );
}
