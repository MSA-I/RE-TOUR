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
  Loader2, Upload, Image, Wand2, X, Play, Check, AlertTriangle, Terminal, Trash2
} from "lucide-react";
import { format } from "date-fns";

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
  id: string;
  filename: string;
  previewUrl?: string;
  file?: File;
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
}: {
  job: TestJob & { source: any; output: any };
  isSelected: boolean;
  onSelect: () => void;
  onViewOutput: (url: string) => void;
}) {
  const { getSignedViewUrl } = useStorage();
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);

  // Load source thumbnail
  useEffect(() => {
    if (job.source) {
      getSignedViewUrl(job.source.bucket, job.source.path).then(r => {
        if (r.signedUrl) setSourceUrl(r.signedUrl);
      });
    }
  }, [job.source?.id]);

  // Load output thumbnail when available
  useEffect(() => {
    if (job.output) {
      getSignedViewUrl(job.output.bucket, job.output.path).then(r => {
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
      className={`p-3 rounded-lg border cursor-pointer transition-all ${
        isSelected ? "border-primary ring-1 ring-primary/20" : "border-border hover:border-primary/50"
      }`}
      onClick={onSelect}
    >
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
              <span className="text-xs text-muted-foreground">{job.aspect_ratio}</span>
            )}
            {job.output_quality && (
              <span className="text-xs text-muted-foreground">{job.output_quality.toUpperCase()}</span>
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
// Main Component: TestsTab
// =============================================================================
interface TestsTabProps {
  projectId: string;
}

export function TestsTab({ projectId }: TestsTabProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { getSignedUploadUrl, getSignedViewUrl } = useStorage();
  const queryClient = useQueryClient();
  
  const { jobs, isLoading, refetch } = useTestJobs(projectId);
  
  // Upload state
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([]);
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

  // Remove uploaded image
  const handleRemoveImage = useCallback((id: string) => {
    setUploadedImages(prev => prev.filter(img => img.id !== id));
  }, []);

  // Submit test jobs
  const handleSubmit = useCallback(async () => {
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
      for (const image of uploadedImages) {
        if (!image.file) continue;
        
        // 1) Upload image to storage
        setIsUploading(true);
        
        const { data: upload, error: uploadError } = await supabase
          .from("uploads")
          .insert({
            project_id: projectId,
            owner_id: user.id,
            kind: "test_input",
            bucket: "inputs",
            path: `tests/${user.id}/${Date.now()}-${image.filename}`,
            original_filename: image.filename,
            mime_type: image.file.type,
            size_bytes: image.file.size,
          })
          .select()
          .single();

        if (uploadError) throw uploadError;

        // Upload file to storage
        const { error: storageError } = await supabase.storage
          .from("inputs")
          .upload(upload.path, image.file, {
            contentType: image.file.type,
          });

        if (storageError) throw storageError;
        
        setIsUploading(false);

        // 2) Create test job
        const { data: job, error: jobError } = await supabase
          .from("image_edit_jobs")
          .insert({
            project_id: projectId,
            owner_id: user.id,
            source_upload_id: upload.id,
            change_description: changeRequest.trim(),
            aspect_ratio: selectedRatio,
            output_quality: selectedQuality,
            status: "queued",
          })
          .select()
          .single();

        if (jobError) throw jobError;

        // 3) Start the job via edge function
        const { error: startError } = await supabase.functions.invoke("start-image-edit-job", {
          body: { job_id: job.id },
        });

        if (startError) {
          console.error("[Tests] Failed to start job:", startError);
          // Job created but not started - it will show as queued
        }
      }

      toast({ 
        title: `${uploadedImages.length} test job(s) created`,
        description: `Ratio: ${selectedRatio}, Quality: ${selectedQuality.toUpperCase()}`
      });
      
      // Clear form
      setUploadedImages([]);
      setChangeRequest("");
      
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
  }, [user, uploadedImages, changeRequest, selectedRatio, selectedQuality, projectId, toast, refetch]);

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
              {/* File input */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleFileSelect}
              />
              
              <Button
                variant="outline"
                className="w-full h-24 border-dashed"
                onClick={() => fileInputRef.current?.click()}
                disabled={isSubmitting}
              >
                <div className="flex flex-col items-center gap-2">
                  <Upload className="h-6 w-6 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    Click to select images
                  </span>
                </div>
              </Button>

              {/* Uploaded images grid */}
              {uploadedImages.length > 0 && (
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
                className="w-full"
                onClick={handleSubmit}
                disabled={isSubmitting || uploadedImages.length === 0 || !changeRequest.trim()}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {isUploading ? "Uploading..." : "Creating jobs..."}
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-2" />
                    Run Test{uploadedImages.length > 1 ? `s (${uploadedImages.length})` : ""}
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Terminal */}
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

        {/* Right: Jobs List */}
        <div>
          <Card className="h-full">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Image className="h-5 w-5" />
                  Test Jobs
                </span>
                <Badge variant="secondary">{jobs.length}</Badge>
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
