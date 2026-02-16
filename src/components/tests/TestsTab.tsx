import { useState, useCallback, useRef, memo, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useStorage } from "@/hooks/useStorage";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LazyImage } from "@/components/LazyImage";
import { AspectRatioPreview, AspectRatioSelectItemContent } from "@/components/AspectRatioPreview";
import {
  Loader2, Upload, Image, Wand2, X, Play, Check, AlertTriangle, Terminal, Trash2, Paperclip
} from "lucide-react";
import { format } from "date-fns";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { BeforeAfterSlider } from "@/components/BeforeAfterSlider";

// =============================================================================
// Types
// =============================================================================
interface TestJob {
  id: string;
  source_upload_id: string;
  output_upload_id: string | null;
  change_description: string;
  status: string;
  aspect_ratio: string | null;
  output_quality: string | null;
  progress_int: number | null;
  progress_message: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

interface TestJobEvent {
  id: string;
  job_id: string;
  type: string;
  message: string;
  progress_int: number | null;
  ts: string;
}

interface UploadedImage {
  id: string; // This will be the upload_id if reusing, or a local ID if new
  filename: string;
  previewUrl?: string;
  file?: File;
  isReused?: boolean;
}

// =============================================================================
// Hook: useTestJobs
// =============================================================================
function useTestJobs(projectId: string) {
  const queryClient = useQueryClient();

  const jobsQuery = useQuery({
    queryKey: ["test-jobs", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("image_edit_jobs")
        .select(`
          *,
          source:uploads!image_edit_jobs_source_upload_id_fkey(*),
          output:uploads!image_edit_jobs_output_upload_id_fkey(*)
        `)
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as (TestJob & { source: any; output: any })[];
    },
    refetchInterval: 3000, // Poll for updates
  });

  return {
    jobs: jobsQuery.data ?? [],
    isLoading: jobsQuery.isLoading,
    refetch: () => queryClient.invalidateQueries({ queryKey: ["test-jobs", projectId] }),
  };
}

// =============================================================================
// Hook: useTestJobEvents
// =============================================================================
function useTestJobEvents(jobId: string | null) {
  const eventsQuery = useQuery({
    queryKey: ["test-job-events", jobId],
    queryFn: async () => {
      if (!jobId) return [];
      const { data, error } = await supabase
        .from("image_edit_job_events")
        .select("*")
        .eq("job_id", jobId)
        .order("ts", { ascending: true });
      if (error) throw error;
      return data as TestJobEvent[];
    },
    enabled: !!jobId,
    refetchInterval: 2000,
  });

  return {
    events: eventsQuery.data ?? [],
    isLoading: eventsQuery.isLoading,
  };
}

// =============================================================================
// Terminal Component
// =============================================================================
const TestJobTerminal = memo(function TestJobTerminal({ jobId }: { jobId: string | null }) {
  const { events, isLoading } = useTestJobEvents(jobId);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new events arrive
  if (scrollRef.current) {
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }

  if (!jobId) {
    return (
      <div className="h-48 flex items-center justify-center bg-muted/30 rounded-lg border border-dashed">
        <p className="text-sm text-muted-foreground">Select a job to view logs</p>
      </div>
    );
  }

  return (
    <div className="h-48 bg-black/90 rounded-lg border border-border overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/20 border-b border-border/50">
        <Terminal className="h-3 w-3 text-green-500" />
        <span className="text-xs text-muted-foreground font-mono">Job Events</span>
        {isLoading && <Loader2 className="h-3 w-3 animate-spin ml-auto text-muted-foreground" />}
      </div>
      <ScrollArea ref={scrollRef} className="h-[calc(100%-32px)]">
        <div className="p-2 space-y-0.5 font-mono text-xs">
          {events.length === 0 ? (
            <p className="text-muted-foreground">Waiting for events...</p>
          ) : (
            events.map((event) => (
              <div key={event.id} className="flex gap-2">
                <span className="text-muted-foreground shrink-0">
                  {format(new Date(event.ts), "HH:mm:ss")}
                </span>
                <span className={
                  event.type === "error" ? "text-red-400" :
                    event.type === "success" ? "text-green-400" :
                      event.type === "progress" ? "text-blue-400" :
                        "text-foreground"
                }>
                  [{event.type.toUpperCase()}]
                </span>
                <span className="text-foreground">{event.message}</span>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
});

// =============================================================================
// Job Card Component
// =============================================================================
const TestJobCard = memo(function TestJobCard({
  job,
  isSelected,
  onSelect,
  onViewOutput,
  onCancel,
}: {
  job: TestJob & { source: any; output: any };
  isSelected: boolean;
  onSelect: () => void;
  onViewOutput: (url: string) => void;
  onCancel?: () => void;
}) {
  const { getSignedViewUrl } = useStorage();
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);

  // Load source thumbnail
  useEffect(() => {
    if (job.source) {
      getSignedViewUrl(job.source.bucket, job.source.path, 3600, {
        width: 200,
        height: 200,
        resize: 'cover'
      }).then(r => {
        if (r.signedUrl) setSourceUrl(r.signedUrl);
      });
    }
  }, [job.source?.id]);

  // Load output thumbnail when available
  useEffect(() => {
    if (job.output) {
      getSignedViewUrl(job.output.bucket, job.output.path, 3600, {
        width: 200,
        height: 200,
        resize: 'cover'
      }).then(r => {
        if (r.signedUrl) setOutputUrl(r.signedUrl);
      });
    }
  }, [job.output?.id]);

  const statusColor =
    job.status === "completed" ? "bg-green-500/20 text-green-400" :
      job.status === "failed" ? "bg-destructive/20 text-destructive" :
        job.status === "running" ? "bg-blue-500/20 text-blue-400" :
          "bg-muted text-muted-foreground";

  return (
    <div
      className={`p-3 rounded-lg border cursor-pointer transition-all relative ${isSelected ? "border-primary ring-1 ring-primary/20" : "border-border hover:border-primary/50"
        }`}
      onClick={onSelect}
    >
      {(job.status === "queued" || job.status === "running") && onCancel && (
        <Button
          variant="destructive"
          size="sm"
          className="absolute -top-2 -right-2 h-6 px-2 text-[10px] font-bold shadow-lg z-10"
          onClick={(e) => {
            e.stopPropagation();
            onCancel();
          }}
        >
          CANCEL
        </Button>
      )}
      <div className="flex items-start gap-3">
        {/* Source thumbnail */}
        <div className="w-16 h-16 rounded bg-muted shrink-0 overflow-hidden">
          {sourceUrl ? (
            <img src={sourceUrl} alt="Source" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Image className="h-4 w-4 text-muted-foreground" />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Badge className={statusColor}>{job.status}</Badge>
            {job.aspect_ratio && (
              <span className="text-xs text-muted-foreground whitespace-nowrap">{job.aspect_ratio}</span>
            )}
            {job.output_quality && (
              <span className="text-xs text-muted-foreground whitespace-nowrap">{job.output_quality.toUpperCase()}</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground truncate">{job.change_description}</p>
          {job.status === "running" && job.progress_int != null && (
            <Progress value={job.progress_int} className="h-1 mt-2" />
          )}
          {job.last_error && (
            <p className="text-xs text-destructive mt-1 truncate">{job.last_error}</p>
          )}
        </div>

        {/* Output thumbnail */}
        {job.output && outputUrl && (
          <div
            className="w-16 h-16 rounded bg-muted shrink-0 overflow-hidden border-2 border-green-500/30 cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              onViewOutput(outputUrl);
            }}
          >
            <img src={outputUrl} alt="Output" className="w-full h-full object-cover" />
          </div>
        )}
      </div>
    </div>
  );
});

// =============================================================================
// Component: ComparisonCard
// =============================================================================
const ComparisonCard = memo(function ComparisonCard({ job }: { job: any }) {
  const { getSignedViewUrl } = useStorage();
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;

    if (!job) {
      setSourceUrl(null);
      setOutputUrl(null);
      return;
    }

    const loadUrls = async () => {
      setLoading(true);
      try {
        // Fetch signed URLs for both source (Before) and output (After)
        const [sourceResult, outputResult] = await Promise.all([
          job.source ? getSignedViewUrl(job.source.bucket, job.source.path) : Promise.resolve({ signedUrl: null }),
          job.output ? getSignedViewUrl(job.output.bucket, job.output.path) : Promise.resolve({ signedUrl: null })
        ]);

        if (active) {
          setSourceUrl(sourceResult.signedUrl);
          setOutputUrl(outputResult.signedUrl);
        }
      } catch (err) {
        console.error("[ComparisonCard] Failed to load URLs:", err);
      } finally {
        if (active) setLoading(false);
      }
    };

    loadUrls();
    return () => { active = false; };
  }, [job?.id, job?.output?.id, getSignedViewUrl]);

  if (!job) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Image className="h-4 w-4" />
            Comparison
          </CardTitle>
        </CardHeader>
        <CardContent className="h-48 flex items-center justify-center bg-muted/30 rounded-lg border border-dashed m-4">
          <p className="text-sm text-muted-foreground">Select a job to view comparison</p>
        </CardContent>
      </Card>
    );
  }

  const hasOutput = !!job.output;
  const showSlider = sourceUrl && outputUrl;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Image className="h-4 w-4" />
            Comparison
          </CardTitle>
          <div className="flex items-center gap-2">
            {job.status === "completed" ? (
              <Badge variant="outline" className="text-[10px] bg-green-500/10 text-green-600 border-green-200">
                COMPLETED
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] bg-blue-500/10 text-blue-600 border-blue-200 uppercase">
                {job.status}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-2">
        {showSlider ? (
          <div className="rounded-lg overflow-hidden border bg-black/5">
            <BeforeAfterSlider
              beforeImage={sourceUrl}
              afterImage={outputUrl}
              beforeLabel="Before"
              afterLabel="After"
              allowFullscreen
            />
          </div>
        ) : (
          <div className="aspect-video bg-muted/30 rounded-lg flex flex-col items-center justify-center border border-dashed">
            {loading ? (
              <>
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mb-2" />
                <p className="text-xs text-muted-foreground">Loading comparison images...</p>
              </>
            ) : !hasOutput ? (
              <>
                <div className="w-1/2 space-y-2 flex flex-col items-center">
                  <Progress value={job.progress_int ?? 0} className="h-1" />
                  <p className="text-xs text-muted-foreground">
                    {job.progress_message || "Waiting for output..."}
                  </p>
                </div>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Preparing visual comparison...</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
});

// =============================================================================
// Main Component: TestsTab
// =============================================================================
interface TestsTabProps {
  projectId: string;
}

// =============================================================================
// Hook: useRecentUploads
// =============================================================================
function useRecentUploads(projectId: string) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["recent-uploads", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("uploads")
        .select("*")
        .eq("project_id", projectId)
        .is("deleted_at", null)
        .in("kind", ["floor_plan", "design_ref", "panorama", "output"])
        .order("created_at", { ascending: false })
        .limit(30);

      if (error) throw error;
      return data;
    },
    enabled: !!user && !!projectId,
  });
}

export function TestsTab({ projectId }: TestsTabProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { uploadFile, getSignedViewUrl } = useStorage();
  const queryClient = useQueryClient();

  const { jobs, isLoading, refetch } = useTestJobs(projectId);
  const { data: recentUploads = [], isLoading: isLoadingRecent } = useRecentUploads(projectId);

  // Upload state
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([]);
  const [referenceImages, setReferenceImages] = useState<UploadedImage[]>([]); // External reference images
  const [changeRequest, setChangeRequest] = useState("");
  const [selectedRatio, setSelectedRatio] = useState("1:1");
  const [selectedQuality, setSelectedQuality] = useState("2k");
  const [isUploading, setIsUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Terminal state
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  // Output preview
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const refFileInputRef = useRef<HTMLInputElement>(null); // For reference images

  // Handle file selection
  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newImages: UploadedImage[] = [];

    for (const file of Array.from(files)) {
      // Create local preview
      const previewUrl = URL.createObjectURL(file);
      newImages.push({
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        filename: file.name,
        previewUrl,
        file,
      });
    }

    setUploadedImages(prev => [...prev, ...newImages]);

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  // Handle reference file selection
  const handleRefFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newImages: UploadedImage[] = [];

    for (const file of Array.from(files)) {
      // Create local preview
      const previewUrl = URL.createObjectURL(file);
      newImages.push({
        id: `ref-local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        filename: file.name,
        previewUrl,
        file,
      });
    }

    setReferenceImages(prev => [...prev, ...newImages]);

    // Reset input
    if (refFileInputRef.current) {
      refFileInputRef.current.value = "";
    }
  }, []);

  // Handle selecting a recent upload
  const handleSelectRecent = useCallback(async (upload: any) => {
    // Generate signed URL for preview
    const { signedUrl } = await getSignedViewUrl(upload.bucket, upload.path);

    setUploadedImages(prev => [
      ...prev,
      {
        id: upload.id,
        filename: upload.original_filename || "Untitled",
        previewUrl: signedUrl || undefined,
        isReused: true,
      }
    ]);
  }, [getSignedViewUrl]);

  // Remove uploaded image
  const handleRemoveImage = useCallback((id: string) => {
    setUploadedImages(prev => prev.filter(img => img.id !== id));
  }, []);

  // Remove reference image
  const handleRemoveReferenceImage = useCallback((id: string) => {
    setReferenceImages(prev => prev.filter(img => img.id !== id));
  }, []);

  // Batch processing helper to limit concurrency
  const processBatch = async <T, R>(
    items: T[],
    processFn: (item: T) => Promise<R>,
    concurrency: number = 3
  ): Promise<R[]> => {
    const results: R[] = [];
    for (let i = 0; i < items.length; i += concurrency) {
      const batch = items.slice(i, i + concurrency);
      const batchResults = await Promise.all(batch.map(processFn));
      results.push(...batchResults);
    }
    return results;
  };

  // Submit test jobs
  // Submit test jobs
  const handleSubmit = useCallback(async () => {
    if (isSubmitting) return; // Guard against duplicate submissions

    if (!user) {
      toast({ title: "Not authenticated", variant: "destructive" });
      return;
    }

    if (uploadedImages.length === 0) {
      toast({ title: "Please upload at least one image", variant: "destructive" });
      return;
    }

    if (!changeRequest.trim()) {
      toast({ title: "Please enter a change request", variant: "destructive" });
      return;
    }

    setIsSubmitting(true);

    try {
      const uploadIds: string[] = [];
      const referenceUploadIds: string[] = [];

      const finalImages: UploadedImage[] = [];
      const finalRefs: UploadedImage[] = [];

      // 1) Handle primary test uploads
      for (const image of uploadedImages) {
        if (image.isReused) {
          uploadIds.push(image.id);
          finalImages.push(image);
        } else {
          if (!image.file) continue;

          setIsUploading(true);
          const path = `${user.id}/tests/${Date.now()}-${image.filename.replace(/[^\w\.-]/g, "_")}`;

          const { data: upload, error: uploadError } = await supabase
            .from("uploads")
            .insert({
              project_id: projectId,
              owner_id: user.id,
              kind: "output",
              bucket: "outputs",
              path: path,
              original_filename: image.filename,
              mime_type: image.file.type,
              size_bytes: image.file.size,
            })
            .select()
            .single();

          if (uploadError) throw uploadError;

          // Use uploadFile helper which handles signed URLs properly
          await uploadFile("outputs", path, image.file);

          uploadIds.push(upload.id);
          finalImages.push({
            ...image,
            id: upload.id,
            isReused: true,
            file: undefined
          });
          setIsUploading(false);
        }
      }

      // 2) Handle external reference uploads
      for (const image of referenceImages) {
        if (image.isReused) {
          referenceUploadIds.push(image.id);
          finalRefs.push(image);
        } else {
          if (!image.file) continue;

          setIsUploading(true);
          const path = `${user.id}/design_refs/${Date.now()}-${image.filename.replace(/[^\w\.-]/g, "_")}`;

          const { data: upload, error: uploadError } = await supabase
            .from("uploads")
            .insert({
              project_id: projectId,
              owner_id: user.id,
              kind: "design_ref",
              bucket: "design_refs",
              path: path,
              original_filename: image.filename,
              mime_type: image.file.type,
              size_bytes: image.file.size,
            })
            .select()
            .single();

          if (uploadError) throw uploadError;

          // Use uploadFile helper
          await uploadFile("design_refs", path, image.file);

          referenceUploadIds.push(upload.id);
          finalRefs.push({
            ...image,
            id: upload.id,
            isReused: true,
            file: undefined
          });
          setIsUploading(false);
        }
      }

      if (uploadIds.length === 0) {
        throw new Error("No valid test images were uploaded");
      }

      // 3) Create ONE job with ALL uploaded images as references
      // This sends all images together to Nano Banana in a single request
      const { data: job, error: jobError } = await supabase
        .from("image_edit_jobs")
        .insert({
          project_id: projectId,
          owner_id: user.id,
          source_upload_id: uploadIds[0], // First uploaded image as primary source
          reference_upload_ids: [...uploadIds, ...referenceUploadIds], // ALL images
          change_description: changeRequest.trim(),
          aspect_ratio: selectedRatio,
          output_quality: selectedQuality,
          status: "queued",
        })
        .select()
        .single();

      if (jobError) {
        console.error(`[Tests] Failed to create job:`, jobError);
        throw jobError;
      }

      setSelectedJobId(job.id);

      // Start the job via edge function
      const { data: { session } } = await supabase.auth.getSession();
      const { error: startError } = await supabase.functions.invoke("start-image-edit-job", {
        body: { job_id: job.id },
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });

      if (startError) {
        console.error(`[Tests] Failed to start job:`, startError);
        await supabase.from("image_edit_jobs").update({
          status: "failed",
          last_error: "Failed to trigger backend processing"
        }).eq("id", job.id);
        throw startError;
      }

      toast({
        title: "Test job started",
        description: `Processing ${uploadIds.length} image${uploadIds.length > 1 ? 's' : ''} together${referenceUploadIds.length > 0 ? ` with ${referenceUploadIds.length} reference${referenceUploadIds.length > 1 ? 's' : ''}` : ''}`
      });

      // Update state with finalized images (converted to reused mode)
      // and keep them in the state as requested by the user
      setUploadedImages(finalImages);
      setReferenceImages(finalRefs);
      // We also keep the changeRequest text for easier iterative editing

      // Refresh jobs list
      refetch();

    } catch (error) {
      console.error("[Tests] Submit error:", error);
      toast({
        title: "Failed to create test job",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
      setIsUploading(false);
    }
  }, [projectId, user, uploadedImages, referenceImages, changeRequest, selectedRatio, selectedQuality, isSubmitting, toast, uploadFile, refetch]);

  // Handle job cancellation
  const handleCancelJob = useCallback(async (jobId: string) => {
    try {
      const { error } = await supabase
        .from("image_edit_jobs")
        .update({
          status: "failed",
          last_error: "Cancelled by user",
          progress_message: "Job cancelled"
        })
        .eq("id", jobId);

      if (error) throw error;

      toast({ title: "Job cancelled" });
      queryClient.invalidateQueries({ queryKey: ["test-jobs", projectId] });
      queryClient.invalidateQueries({ queryKey: ["image_edit_jobs"] });
    } catch (e) {
      console.error("Failed to cancel job:", e);
      toast({ title: "Failed to cancel job", variant: "destructive" });
    }
  }, [projectId, queryClient, toast]);

  const handleCancelAll = useCallback(async () => {
    try {
      const runningJobs = jobs.filter(j => j.status === "running" || j.status === "queued");
      if (runningJobs.length === 0) return;

      const { error } = await supabase
        .from("image_edit_jobs")
        .update({
          status: "failed",
          last_error: "Cancelled by user",
          progress_message: "Job cancelled"
        })
        .in("id", runningJobs.map(j => j.id));

      if (error) throw error;

      toast({ title: `Cancelled ${runningJobs.length} jobs` });
      queryClient.invalidateQueries({ queryKey: ["test-jobs", projectId] });
    } catch (e) {
      console.error("Failed to cancel all jobs:", e);
      toast({ title: "Failed to cancel jobs", variant: "destructive" });
    }
  }, [jobs, projectId, queryClient, toast]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <Wand2 className="h-5 w-5 text-primary mt-0.5" />
            <div>
              <p className="font-medium text-sm">Image Tests</p>
              <p className="text-sm text-muted-foreground mt-1">
                Quick image-to-image tests using Nano Banana (Gemini). Upload images,
                describe changes, and see results. No QA gates, no pipeline steps—just run and output.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Upload & Create */}
        <div className="space-y-4">
          {/* Upload Section */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="h-5 w-5" />
                Upload Images
              </CardTitle>
              <CardDescription>
                Select multiple images to test
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* File input for test images */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleFileSelect}
              />
              {/* File input for reference images */}
              <input
                ref={refFileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleRefFileSelect}
              />

              <div className="grid grid-cols-3 gap-2">
                <Button
                  variant="outline"
                  className="h-24 border-dashed"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isSubmitting}
                >
                  <div className="flex flex-col items-center gap-2">
                    <Upload className="h-5 w-5 text-muted-foreground" />
                    <span className="text-[10px] text-muted-foreground whitespace-normal">
                      Select images to test
                    </span>
                  </div>
                </Button>

                <Button
                  variant="outline"
                  className="h-24 border-dashed border-primary/30 bg-primary/5 hover:bg-primary/10"
                  onClick={() => refFileInputRef.current?.click()}
                  disabled={isSubmitting}
                >
                  <div className="flex flex-col items-center gap-2">
                    <Paperclip className="h-5 w-5 text-primary/60" />
                    <span className="text-[10px] text-muted-foreground whitespace-normal">
                      Add external reference
                    </span>
                  </div>
                </Button>

                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className="h-24 border-dashed"
                      disabled={isSubmitting || isLoadingRecent}
                    >
                      <div className="flex flex-col items-center gap-2">
                        <Image className="h-5 w-5 text-muted-foreground" />
                        <span className="text-[10px] text-muted-foreground whitespace-normal">
                          Reuse previous
                        </span>
                      </div>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-80 p-0" align="start">
                    <div className="p-2 border-b bg-muted/30">
                      <p className="text-xs font-medium">Recent Uploads</p>
                    </div>
                    <ScrollArea className="h-[300px]">
                      <div className="p-1">
                        {recentUploads.length === 0 ? (
                          <div className="p-4 text-center text-xs text-muted-foreground">
                            No previous uploads found
                          </div>
                        ) : (
                          recentUploads.map((upload: any) => (
                            <button
                              key={upload.id}
                              className="w-full flex items-center gap-3 p-2 rounded-md hover:bg-accent text-left transition-colors"
                              onClick={() => handleSelectRecent(upload)}
                            >
                              <div className="w-10 h-10 rounded bg-muted flex-shrink-0 overflow-hidden">
                                <RecentUploadThumbnail upload={upload} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium truncate">
                                  {upload.original_filename || "Untitled"}
                                </p>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <Badge variant="outline" className="text-[10px] px-1 h-4">
                                    {upload.kind}
                                  </Badge>
                                  <span className="text-[10px] text-muted-foreground">
                                    {format(new Date(upload.created_at), "MMM d")}
                                  </span>
                                </div>
                              </div>
                            </button>
                          ))
                        )}
                      </div>
                    </ScrollArea>
                  </PopoverContent>
                </Popover>
              </div>

              {/* Uploaded images grid */}
              {(uploadedImages.length > 0 || referenceImages.length > 0) && (
                <div className="space-y-4">
                  {uploadedImages.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Images to Test ({uploadedImages.length})</p>
                      <div className="flex flex-wrap gap-2">
                        {uploadedImages.map((img) => (
                          <div key={img.id} className="relative group">
                            <div className="w-20 h-20 rounded-lg overflow-hidden bg-muted border">
                              {img.previewUrl ? (
                                <img src={img.previewUrl} alt={img.filename} className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                  <Image className="h-4 w-4 text-muted-foreground" />
                                </div>
                              )}
                            </div>
                            <Button
                              variant="destructive"
                              size="icon"
                              className="absolute -top-1 -right-1 h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={() => handleRemoveImage(img.id)}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {referenceImages.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[10px] font-medium text-primary uppercase tracking-wider flex items-center gap-1">
                        <Paperclip className="h-3 w-3" />
                        External References ({referenceImages.length})
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {referenceImages.map((img) => (
                          <div key={img.id} className="relative group">
                            <div className="w-20 h-20 rounded-lg overflow-hidden bg-primary/5 border border-primary/20">
                              {img.previewUrl ? (
                                <img src={img.previewUrl} alt={img.filename} className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                  <Paperclip className="h-4 w-4 text-primary/40" />
                                </div>
                              )}
                            </div>
                            <Button
                              variant="destructive"
                              size="icon"
                              className="absolute -top-1 -right-1 h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={() => handleRemoveReferenceImage(img.id)}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Change Request */}
              <div className="space-y-2">
                <Label>Change Request</Label>
                <Textarea
                  placeholder="Describe the changes you want... e.g., 'Make the lighting warmer' or 'Remove the background'"
                  value={changeRequest}
                  onChange={(e) => setChangeRequest(e.target.value)}
                  rows={3}
                  disabled={isSubmitting}
                />
              </div>

              {/* Options */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Output Ratio</Label>
                  <Select value={selectedRatio} onValueChange={setSelectedRatio} disabled={isSubmitting}>
                    <SelectTrigger className="bg-background">
                      <div className="flex items-center gap-2">
                        <AspectRatioPreview ratio={selectedRatio} size="sm" selected />
                        <span>{selectedRatio}</span>
                      </div>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1:1"><AspectRatioSelectItemContent value="1:1" /></SelectItem>
                      <SelectItem value="16:9"><AspectRatioSelectItemContent value="16:9" /></SelectItem>
                      <SelectItem value="21:9"><AspectRatioSelectItemContent value="21:9" /></SelectItem>
                      <SelectItem value="9:16"><AspectRatioSelectItemContent value="9:16" /></SelectItem>
                      <SelectItem value="4:3"><AspectRatioSelectItemContent value="4:3" /></SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Quality</Label>
                  <Select value={selectedQuality} onValueChange={setSelectedQuality} disabled={isSubmitting}>
                    <SelectTrigger className="bg-background">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1k">1K (1024px)</SelectItem>
                      <SelectItem value="2k">2K (2048px)</SelectItem>
                      <SelectItem value="4k">4K (4096px)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Submit */}
              <Button
                className="w-full h-11"
                onClick={handleSubmit}
                disabled={isSubmitting || uploadedImages.length === 0 || !changeRequest.trim()}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {isUploading ? "Uploading..." : "Running Test..."}
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-2 fill-current" />
                    Run Test {uploadedImages.length > 0 ? `(${uploadedImages.length} images)` : ""}
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Result Comparison & Terminal Area */}
          <div className="space-y-6">
            <ComparisonCard job={jobs.find((j: any) => j.id === selectedJobId)} />

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Terminal className="h-4 w-4" />
                  Job Logs
                </CardTitle>
              </CardHeader>
              <CardContent>
                <TestJobTerminal jobId={selectedJobId} />
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Right: Jobs List */}
        <div>
          <Card className="h-full">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Image className="h-5 w-5" />
                  Test Jobs
                  <Badge variant="secondary" className="ml-1">{jobs.length}</Badge>
                </div>
                {jobs.some(j => j.status === "running" || j.status === "queued") && (
                  <Button
                    variant="destructive"
                    size="sm"
                    className="h-7 text-[10px] font-bold"
                    onClick={handleCancelAll}
                  >
                    CANCEL ALL
                  </Button>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : jobs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Image className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No test jobs yet</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Upload images and run your first test
                  </p>
                </div>
              ) : (
                <ScrollArea className="h-[500px]">
                  <div className="space-y-2 pr-3">
                    {jobs.map((job) => (
                      <TestJobCard
                        key={job.id}
                        job={job}
                        isSelected={selectedJobId === job.id}
                        onSelect={() => setSelectedJobId(job.id)}
                        onViewOutput={(url) => setPreviewUrl(url)}
                        onCancel={() => handleCancelJob(job.id)}
                      />
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Preview Dialog */}
      {previewUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-8"
          onClick={() => setPreviewUrl(null)}
        >
          <div className="relative max-w-4xl max-h-full">
            <img src={previewUrl} alt="Output preview" className="max-w-full max-h-[80vh] rounded-lg" />
            <Button
              variant="secondary"
              size="icon"
              className="absolute top-2 right-2"
              onClick={() => setPreviewUrl(null)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Component: RecentUploadThumbnail
// =============================================================================
function RecentUploadThumbnail({ upload }: { upload: any }) {
  const { getSignedViewUrl } = useStorage();
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    getSignedViewUrl(upload.bucket, upload.path, 3600, {
      width: 200,
      height: 200,
      resize: 'cover'
    }).then(r => {
      if (r.signedUrl) setUrl(r.signedUrl);
    });
  }, [upload.id]);

  if (!url) return <div className="w-full h-full flex items-center justify-center"><Image className="h-3 w-3 text-muted-foreground" /></div>;
  return <img src={url} alt="Thumbnail" className="w-full h-full object-cover" />;
}
