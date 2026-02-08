import { useState, useEffect, memo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useBatchJobItems, BatchJob, BatchJobItem } from "@/hooks/useBatchJobs";
import { useBatchProgress } from "@/hooks/useBatchProgress";
import { useStorage } from "@/hooks/useStorage";
import { useToast } from "@/hooks/use-toast";
import { BeforeAfterSlider } from "@/components/BeforeAfterSlider";
import { BatchJobTerminal } from "@/components/BatchJobTerminal";
import { QAReviewInline } from "@/components/shared/QAReviewPanel";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { 
  Play, ChevronDown, ChevronUp, Loader2, Check, X, AlertTriangle, 
  Image as ImageIcon, Terminal, Eye, ThumbsUp, ThumbsDown, Info
} from "lucide-react";

interface BatchJobCardProps {
  batchJob: BatchJob;
  projectId: string;
  onStartBatch: (batchJobId: string) => Promise<void>;
  isStarting: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  imagePreviews: Record<string, string>;
  onOpenTerminal: (jobId: string) => void;
}

const statusColors: Record<string, string> = {
  queued: "bg-muted text-muted-foreground",
  running: "bg-blue-500/20 text-blue-400",
  completed: "bg-green-500/20 text-green-400",
  completed_with_errors: "bg-yellow-500/20 text-yellow-400",
  failed: "bg-destructive/20 text-destructive",
  partial: "bg-yellow-500/20 text-yellow-400"
};

const itemStatusColors: Record<string, string> = {
  queued: "text-muted-foreground",
  running: "text-blue-400",
  completed: "text-green-400",
  failed: "text-destructive"
};

const qaColors: Record<string, string> = {
  approved: "bg-green-500/20 text-green-400",
  rejected: "bg-yellow-500/20 text-yellow-400"
};

interface ItemWithUrls extends BatchJobItem {
  beforeUrl?: string;
  afterUrl?: string;
}

export const BatchJobCard = memo(function BatchJobCard({
  batchJob,
  projectId,
  onStartBatch,
  isStarting,
  expanded,
  onToggleExpand,
  imagePreviews,
  onOpenTerminal
}: BatchJobCardProps) {
  const { items, isLoading: itemsLoading } = useBatchJobItems(expanded ? batchJob.id : null);
  const { progress: realtimeProgress, latestMessage, isComplete } = useBatchProgress(
    batchJob.status === "running" ? batchJob.id : null
  );
  const { getSignedViewUrl } = useStorage();
  const { toast } = useToast();
  
  const [showTerminal, setShowTerminal] = useState(false);
  const [compareItem, setCompareItem] = useState<ItemWithUrls | null>(null);
  const [loadingUrls, setLoadingUrls] = useState<Record<string, boolean>>({});
  const [reviewingItemId, setReviewingItemId] = useState<string | null>(null);
  const [reviewAction, setReviewAction] = useState<"approve" | "reject" | null>(null);

  // Use realtime progress when running, otherwise use stored progress
  const displayProgress = batchJob.status === "running" ? realtimeProgress : batchJob.progress_int;
  const displayMessage = batchJob.status === "running" ? latestMessage : "";

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed": return <Check className="h-3 w-3" />;
      case "failed": return <X className="h-3 w-3" />;
      case "running": return <Loader2 className="h-3 w-3 animate-spin" />;
      default: return null;
    }
  };

  // Load signed URLs for Before/After comparison
  const loadCompareUrls = async (item: BatchJobItem) => {
    if (loadingUrls[item.id]) return;
    setLoadingUrls(prev => ({ ...prev, [item.id]: true }));
    
    try {
      // Get panorama details
      const { data: panorama } = await supabase
        .from("uploads")
        .select("bucket, path")
        .eq("id", item.panorama_upload_id)
        .single();
      
      let beforeUrl = "";
      let afterUrl = "";
      
      if (panorama) {
        const beforeResult = await getSignedViewUrl(panorama.bucket, panorama.path);
        beforeUrl = beforeResult.signedUrl || "";
      }
      
      if (item.output_upload_id) {
        const { data: output } = await supabase
          .from("uploads")
          .select("bucket, path")
          .eq("id", item.output_upload_id)
          .single();
        
        if (output) {
          const afterResult = await getSignedViewUrl(output.bucket, output.path);
          afterUrl = afterResult.signedUrl || "";
        }
      }
      
      setCompareItem({ ...item, beforeUrl, afterUrl });
    } catch (error) {
      console.error("Failed to load compare URLs:", error);
    } finally {
      setLoadingUrls(prev => ({ ...prev, [item.id]: false }));
    }
  };

  // Count QA results
  const qaStats = items.reduce((acc, item) => {
    if (item.qa_decision === "approved") acc.approved++;
    else if (item.qa_decision === "rejected") acc.rejected++;
    return acc;
  }, { approved: 0, rejected: 0 });

  return (
    <>
      <Card id={`batch-row-${batchJob.id}`} className="transition-all duration-300">
        <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base flex items-center gap-2">
                <ImageIcon className="h-4 w-4 text-muted-foreground" />
                Batch: {batchJob.total_items} image{batchJob.total_items !== 1 ? "s" : ""}
              </CardTitle>
            </div>
            <CardDescription>
              Created {format(new Date(batchJob.created_at), "MMM d, yyyy HH:mm")}
            </CardDescription>
          </div>
          <Badge className={statusColors[batchJob.status]}>
            {batchJob.status.replace("_", " ")}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Prompt preview */}
          <div className="bg-muted/30 rounded p-2">
            <p className="text-xs text-muted-foreground line-clamp-2">
              {batchJob.base_prompt || batchJob.change_request}
            </p>
          </div>

          {/* Real-time progress bar for running batches */}
          {batchJob.status === "running" && (
            <div className="space-y-2">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span className="truncate flex-1 mr-2">{displayMessage || "Processing..."}</span>
                <span className="shrink-0">{displayProgress}%</span>
              </div>
              <Progress value={displayProgress} className="h-2" />
            </div>
          )}

          {/* Completion summary with QA stats */}
          {(batchJob.status === "completed" || batchJob.status === "completed_with_errors") && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <Check className="h-4 w-4 text-green-400" />
                <span className="text-green-400">
                  {batchJob.completed_items} completed
                  {batchJob.failed_items > 0 && (
                    <span className="text-destructive ml-2">
                      ({batchJob.failed_items} failed)
                    </span>
                  )}
                </span>
              </div>
              
              {/* QA Summary */}
              {(qaStats.approved > 0 || qaStats.rejected > 0) && (
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-muted-foreground">QA Results:</span>
                  {qaStats.approved > 0 && (
                    <span className="flex items-center gap-1 text-green-400">
                      <ThumbsUp className="h-3 w-3" />
                      {qaStats.approved} approved
                    </span>
                  )}
                  {qaStats.rejected > 0 && (
                    <span className="flex items-center gap-1 text-yellow-400">
                      <ThumbsDown className="h-3 w-3" />
                      {qaStats.rejected} rejected
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Error message */}
          {batchJob.last_error && (
            <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 rounded p-2">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span className="line-clamp-2">{batchJob.last_error}</span>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            {batchJob.status === "queued" && (
              <Button
                size="sm"
                onClick={() => onStartBatch(batchJob.id)}
                disabled={isStarting}
              >
                {isStarting ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Play className="h-4 w-4 mr-1" />
                )}
                Run Now
              </Button>
            )}

            {batchJob.status === "running" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowTerminal(!showTerminal)}
              >
                <Terminal className="h-4 w-4 mr-1" />
                {showTerminal ? "Hide" : "View"} Progress
              </Button>
            )}

            {/* Expand/collapse items */}
            <Collapsible open={expanded} onOpenChange={onToggleExpand}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm">
                  {expanded ? (
                    <>
                      <ChevronUp className="h-4 w-4 mr-1" />
                      Hide Items
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-4 w-4 mr-1" />
                      View Items ({batchJob.total_items})
                    </>
                  )}
                </Button>
              </CollapsibleTrigger>
            </Collapsible>
          </div>

          {/* Terminal for running batches */}
          {showTerminal && batchJob.status === "running" && (
            <BatchJobTerminal batchJobId={batchJob.id} isOpen={showTerminal} />
          )}

          {/* Expanded items list with QA and Compare */}
          {expanded && (
            <div className="border-t border-border pt-3 mt-3 space-y-2">
              {itemsLoading ? (
                <div className="flex justify-center py-4">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : items.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-2">No items found</p>
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {items.map((item, index) => (
                    <div 
                      key={item.id} 
                      className="flex items-center gap-3 p-2 rounded bg-muted/30"
                    >
                      {/* Item thumbnail */}
                      <div className="w-12 h-8 rounded bg-muted flex-shrink-0 overflow-hidden">
                        {imagePreviews[item.panorama_upload_id] ? (
                          <img 
                            src={imagePreviews[item.panorama_upload_id]}
                            alt={item.panorama?.original_filename || `Item ${index + 1}`}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <ImageIcon className="h-3 w-3 text-muted-foreground" />
                          </div>
                        )}
                      </div>
                      
                      {/* Item info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs truncate">
                          {item.panorama?.original_filename || `Image ${index + 1}`}
                        </p>
                        {/* QA reason tooltip */}
                        {item.qa_reason && (
                          <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                            {item.qa_reason}
                          </p>
                        )}
                      </div>

                      {/* QA Review or Badge */}
                      {item.status === "completed" && !item.qa_decision && item.output_upload_id ? (
                        /* Show inline QA review for completed items without decision */
                        <QAReviewInline
                          itemId={item.id}
                          projectId={projectId}
                          pipelineId={batchJob.id}
                          outputUploadId={item.output_upload_id}
                          onApprove={async (score) => {
                            setReviewingItemId(item.id);
                            setReviewAction("approve");
                            try {
                              await supabase
                                .from("batch_jobs_items")
                                .update({ qa_decision: "approved" })
                                .eq("id", item.id);
                              toast({ title: "Item approved", description: score ? `Score: ${score}/100` : undefined });
                            } finally {
                              setReviewingItemId(null);
                              setReviewAction(null);
                            }
                          }}
                          onReject={async (score) => {
                            setReviewingItemId(item.id);
                            setReviewAction("reject");
                            try {
                              await supabase
                                .from("batch_jobs_items")
                                .update({ qa_decision: "rejected" })
                                .eq("id", item.id);
                              toast({ title: "Item rejected", description: score ? `Score: ${score}/100` : undefined });
                            } finally {
                              setReviewingItemId(null);
                              setReviewAction(null);
                            }
                          }}
                          isApproving={reviewingItemId === item.id && reviewAction === "approve"}
                          isRejecting={reviewingItemId === item.id && reviewAction === "reject"}
                          category="batch_item"
                        />
                      ) : item.qa_decision ? (
                        /* Show QA Badge for items with decision */
                        <Badge className={`${qaColors[item.qa_decision]} text-[10px]`}>
                          {item.qa_decision === "approved" ? (
                            <ThumbsUp className="h-2.5 w-2.5 mr-1" />
                          ) : (
                            <ThumbsDown className="h-2.5 w-2.5 mr-1" />
                          )}
                          {item.qa_decision}
                        </Badge>
                      ) : null}
                      
                      {/* Item status */}
                      <div className={`flex items-center gap-1 text-xs ${itemStatusColors[item.status]}`}>
                        {getStatusIcon(item.status)}
                        <span className="capitalize">{item.status}</span>
                      </div>

                      {/* Compare button - visible and prominent */}
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 gap-1"
                        onClick={() => loadCompareUrls(item)}
                        disabled={loadingUrls[item.id] || !item.output_upload_id}
                        title={item.output_upload_id ? "Compare Before/After" : "Output not ready"}
                      >
                        {loadingUrls[item.id] ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <>
                            <Eye className="h-3 w-3" />
                            <span className="text-[10px]">Compare</span>
                          </>
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Before/After Compare Dialog */}
      <Dialog open={!!compareItem} onOpenChange={() => setCompareItem(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Compare Before/After
              {compareItem?.qa_decision && (
                <Badge className={qaColors[compareItem.qa_decision]}>
                  QA: {compareItem.qa_decision}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>
          
          {compareItem?.beforeUrl && compareItem?.afterUrl ? (
            <div className="space-y-4">
              <BeforeAfterSlider
                beforeImage={compareItem.beforeUrl}
                afterImage={compareItem.afterUrl}
                beforeLabel="Original"
                afterLabel="Result"
              />
              
              {compareItem.qa_reason && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/50">
                  <Info className="h-4 w-4 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">QA Assessment</p>
                    <p className="text-sm">{compareItem.qa_reason}</p>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
});
