import { useState, useCallback, memo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useStorage } from "@/hooks/useStorage";
import { useImageEditJobs, useImageEditJobEvents, ImageEditJob } from "@/hooks/useImageEditJobs";
import { useToast } from "@/hooks/use-toast";
import { LazyImage } from "@/components/LazyImage";
import { BeforeAfterSlider } from "@/components/BeforeAfterSlider";
import { 
  Loader2, Wand2, Play, Trash2, Eye, Terminal, Check, X, 
  RefreshCw, Download, AlertTriangle, RotateCcw, SplitSquareHorizontal
} from "lucide-react";
import { format } from "date-fns";

interface ImageEditJobsTabProps {
  projectId: string;
}

const statusColors: Record<string, string> = {
  queued: "bg-muted text-muted-foreground",
  running: "bg-blue-500/20 text-blue-400",
  completed: "bg-green-500/20 text-green-400",
  failed: "bg-destructive/20 text-destructive"
};

const JobEventTerminal = memo(function JobEventTerminal({ jobId }: { jobId: string }) {
  const { events, isLoading } = useImageEditJobEvents(jobId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="text-xs text-muted-foreground text-center py-2">
        No events yet
      </div>
    );
  }

  return (
    <div className="bg-black/90 rounded-lg p-3 font-mono text-xs max-h-40 overflow-y-auto">
      {events.map((event) => (
        <div key={event.id} className="flex gap-2 py-0.5">
          <span className="text-muted-foreground whitespace-nowrap">
            {format(new Date(event.ts), "HH:mm:ss")}
          </span>
          <span className={
            event.type === "error" ? "text-red-400" :
            event.type === "success" ? "text-green-400" :
            "text-foreground"
          }>
            {event.message}
          </span>
        </div>
      ))}
    </div>
  );
});

export const ImageEditJobsTab = memo(function ImageEditJobsTab({ projectId }: ImageEditJobsTabProps) {
  const { toast } = useToast();
  const { jobs, isLoading, startJob, deleteJob, startOverJob, retryJob } = useImageEditJobs(projectId);
  const { getSignedViewUrl, getSignedDownloadUrl } = useStorage();
  const [imagePreviews, setImagePreviews] = useState<Record<string, string>>({});
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [compareJobId, setCompareJobId] = useState<string | null>(null);

  const loadPreview = useCallback(async (uploadId: string, bucket: string, path: string) => {
    if (imagePreviews[uploadId]) return;
    
    try {
      const result = await getSignedViewUrl(bucket, path);
      if (result.signedUrl) {
        setImagePreviews(prev => ({ ...prev, [uploadId]: result.signedUrl }));
      }
    } catch (error) {
      // Silently fail
    }
  }, [getSignedViewUrl, imagePreviews]);

  const handleStartJob = async (jobId: string) => {
    try {
      await startJob.mutateAsync(jobId);
      toast({ title: "Edit job started" });
    } catch (error) {
      toast({
        title: "Failed to start job",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
    }
  };

  const handleDeleteJob = async (jobId: string) => {
    if (!confirm("Delete this job?")) return;
    try {
      await deleteJob.mutateAsync(jobId);
      toast({ title: "Job deleted" });
    } catch (error) {
      toast({
        title: "Failed to delete job",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
    }
  };

  const handleStartOver = async (jobId: string) => {
    if (!confirm("Start over? This will clear the current output and allow you to re-run the job.")) return;
    try {
      await startOverJob.mutateAsync(jobId);
      toast({ title: "Job reset - ready to start again" });
    } catch (error) {
      toast({
        title: "Failed to reset job",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
    }
  };

  const handleRetry = async (jobId: string) => {
    try {
      await retryJob.mutateAsync(jobId);
      toast({ title: "Retrying job..." });
    } catch (error) {
      toast({
        title: "Failed to retry job",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
    }
  };

  const handleDownload = async (bucket: string, path: string, filename?: string) => {
    try {
      const { signedUrl } = await getSignedDownloadUrl(bucket, path, filename);
      window.open(signedUrl, "_blank");
    } catch (error) {
      toast({ title: "Failed to generate download link", variant: "destructive" });
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Wand2 className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground">No image editing jobs yet</p>
          <p className="text-sm text-muted-foreground mt-1">
            Go to "Image Editing" tab to start an edit, then jobs will appear here
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {jobs.map((job) => {
        // Load previews
        if (job.source_upload && !imagePreviews[job.source_upload.id]) {
          loadPreview(job.source_upload.id, job.source_upload.bucket, job.source_upload.path);
        }
        if (job.output_upload && !imagePreviews[job.output_upload.id]) {
          loadPreview(job.output_upload.id, job.output_upload.bucket, job.output_upload.path);
        }

        const isExpanded = expandedJobId === job.id;

        return (
          <Card key={job.id} id={`edit-job-row-${job.id}`}>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <CardTitle className="text-sm font-medium truncate">
                    {job.source_upload?.original_filename || `Edit Job`}
                  </CardTitle>
                  <CardDescription className="text-xs mt-1">
                    {format(new Date(job.created_at), "MMM d, yyyy HH:mm")}
                  </CardDescription>
                </div>
                <Badge className={statusColors[job.status]}>
                  {job.status === "running" && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                  {job.status.charAt(0).toUpperCase() + job.status.slice(1)}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Progress bar for running jobs */}
              {job.status === "running" && (
                <div className="space-y-1">
                  <Progress value={job.progress_int} className="h-2" />
                  <p className="text-xs text-muted-foreground">
                    {job.progress_message || `Processing... ${job.progress_int}%`}
                  </p>
                </div>
              )}

              {/* Error display */}
              {job.status === "failed" && job.last_error && (
                <div className="flex items-start gap-2 p-2 bg-destructive/10 rounded-lg">
                  <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-destructive">{job.last_error}</p>
                </div>
              )}

              {/* Change description + settings */}
              <div className="p-2 bg-muted/50 rounded-lg space-y-2">
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">Ratio:</span>
                  <span className="font-medium">{(job as any).aspect_ratio || "1:1"}</span>
                  <span className="text-muted-foreground ml-2">Quality:</span>
                  <span className="font-medium">{((job as any).output_quality || "2k").toUpperCase()}</span>
                </div>
                <p className="text-xs text-muted-foreground">Change Description:</p>
                <p className="text-sm">{job.change_description}</p>
              </div>

              {/* Output Preview - Single card with Compare button */}
              {job.status === "completed" && job.output_upload && imagePreviews[job.output_upload.id] && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">Output</p>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setCompareJobId(job.id)}
                      disabled={!job.source_upload || !imagePreviews[job.source_upload.id]}
                    >
                      <SplitSquareHorizontal className="h-4 w-4 mr-2" />
                      Compare Before/After
                    </Button>
                  </div>
                  <div className="aspect-video rounded-lg overflow-hidden bg-muted max-w-md">
                    <LazyImage
                      src={imagePreviews[job.output_upload.id]}
                      alt="Output"
                      className="w-full h-full"
                    />
                  </div>
                </div>
              )}

              {/* Compare Before/After Slider - shown when compareJobId matches */}
              {compareJobId === job.id && job.source_upload && job.output_upload && 
               imagePreviews[job.source_upload.id] && imagePreviews[job.output_upload.id] && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">Compare Before/After</p>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setCompareJobId(null)}
                    >
                      <X className="h-4 w-4 mr-1" />
                      Close Compare
                    </Button>
                  </div>
                  <BeforeAfterSlider
                    beforeImage={imagePreviews[job.source_upload.id]}
                    afterImage={imagePreviews[job.output_upload.id]}
                    beforeLabel="Source"
                    afterLabel="Output"
                    allowFullscreen={true}
                  />
                </div>
              )}

              {/* Pending/Running state - show placeholder */}
              {job.status !== "completed" && (
                <div className="aspect-video rounded-lg overflow-hidden bg-muted max-w-md flex items-center justify-center">
                  {job.status === "running" ? (
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <Loader2 className="h-6 w-6 animate-spin" />
                      <span className="text-xs">Processing...</span>
                    </div>
                  ) : job.status === "queued" ? (
                    <span className="text-xs text-muted-foreground">Pending</span>
                  ) : job.status === "failed" ? (
                    <div className="flex flex-col items-center gap-2 text-destructive">
                      <AlertTriangle className="h-6 w-6" />
                      <span className="text-xs">Failed</span>
                    </div>
                  ) : null}
                </div>
              )}

              {/* Terminal toggle */}
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start text-muted-foreground"
                onClick={() => setExpandedJobId(isExpanded ? null : job.id)}
              >
                <Terminal className="h-4 w-4 mr-2" />
                {isExpanded ? "Hide Logs" : "Show Logs"}
              </Button>

              {isExpanded && <JobEventTerminal jobId={job.id} />}

              {/* Actions */}
              <div className="flex gap-2 flex-wrap">
                {job.status === "queued" && (
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
                    Start Edit
                  </Button>
                )}

                {job.status === "completed" && job.output_upload && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => handleDownload(
                      job.output_upload!.bucket,
                      job.output_upload!.path,
                      job.output_upload!.original_filename || `output-${job.id}.png`
                    )}
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Download
                  </Button>
                )}

                {/* Start Over - for completed or failed jobs */}
                {(job.status === "completed" || job.status === "failed") && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleStartOver(job.id)}
                    disabled={startOverJob.isPending}
                  >
                    {startOverJob.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <RotateCcw className="h-4 w-4 mr-2" />
                    )}
                    Start Over
                  </Button>
                )}

                {/* Retry - only for failed jobs */}
                {job.status === "failed" && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => handleRetry(job.id)}
                    disabled={retryJob.isPending}
                  >
                    {retryJob.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4 mr-2" />
                    )}
                    Retry
                  </Button>
                )}

                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-destructive ml-auto"
                  onClick={() => handleDeleteJob(job.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
});
