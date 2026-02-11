import { memo, useState, useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { BeforeAfterSlider } from "@/components/BeforeAfterSlider";
import { useStorage } from "@/hooks/useStorage";
import { useManualQA } from "@/contexts/ManualQAContext";
import { useToast } from "@/hooks/use-toast";
import { useStoreQAFeedback, useBuildContextSnapshot } from "@/hooks/useQAFeedback";
import { QAFeedbackDialog, QAFeedbackData, QACategoryKey } from "./QAFeedbackDialog";
// NOTE: QAScoreSave import removed - no longer used after QAApprovalReasonBox removal
import { useQAAttemptFeedback, FeedbackCategory } from "@/hooks/useQAAttemptFeedback";
import { ThumbsUp, ThumbsDown, Eye, Loader2, AlertTriangle, CheckCircle2, XCircle, FileText, Download } from "lucide-react";
import { QADetailsDialog } from "./QADetailsDialog";
import { formatResolution, formatBytes } from "@/lib/imageResize";
import { useFloorplanStepAttemptTrace } from "@/hooks/useFloorplanStepAttempt";

// NOTE: QA UI unified across the app. All QA flows use components from:
// src/components/shared/QAReviewPanel.tsx (SINGLE SOURCE OF TRUTH)

// ============================================================================
// NOTE: QAApprovalReasonBox REMOVED - Automatic AI-QA scores should not be 
// displayed. The QA workflow now relies entirely on manual user scoring 
// (0-100) via the QAFeedbackDialog, matching the Multi Panoramas tab behavior.
// The AI-QA Pass/Fail badge in the header is sufficient for informational purposes.
// ============================================================================

// ============================================================================
// QA Rejection Reason Box - Prominently displays why AI-QA failed
// ============================================================================
function QARejectionReasonBox({
  qaReport
}: {
  qaReport: Record<string, unknown>;
}) {
  // Extract reason from various possible formats
  const reason = qaReport.reason as string | undefined;
  const reasonShort = qaReport.reason_short as string | undefined;
  const decision = qaReport.decision as string | undefined;
  const bedSizeIssues = qaReport.bed_size_issues as string[] | undefined;
  const scaleCheck = qaReport.scale_check as string | undefined;
  const geometryCheck = qaReport.geometry_check as string | undefined;
  const furnitureCheck = qaReport.furniture_check as string | undefined;

  // Get structured reasons if available
  const reasons = qaReport.reasons as Array<{
    code: string;
    description: string;
  }> | undefined;
  const evidence = qaReport.evidence as Array<{
    observation: string;
    location?: string;
  }> | undefined;
  const severity = qaReport.severity as string | undefined;
  const retrySuggestion = qaReport.retry_suggestion as {
    type: string;
    instruction: string;
  } | undefined;

  // Determine primary reason to display
  const primaryReason = reasonShort || reason || decision || "Quality check failed";
  return <div className="mx-3 mb-0 p-3 rounded-lg border border-destructive/30 bg-destructive/5">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0 space-y-2">
          <div>
            <p className="text-sm font-medium text-destructive">AI-QA Rejection Reason</p>
            <p className="text-sm text-foreground mt-1">{primaryReason}</p>
          </div>
          
          {/* Structured reasons */}
          {reasons && reasons.length > 0 && <div className="space-y-1">
              {reasons.map((r, i) => <div key={i} className="flex items-start gap-1.5 text-xs">
                  <Badge variant="outline" className="text-xs px-1.5 py-0 flex-shrink-0">
                    {r.code.replace(/_/g, " ")}
                  </Badge>
                  <span className="text-muted-foreground">{r.description}</span>
                </div>)}
            </div>}
          
          {/* Bed size issues (legacy format) */}
          {bedSizeIssues && bedSizeIssues.length > 0 && <ul className="text-xs space-y-1 text-muted-foreground">
              {bedSizeIssues.map((issue, i) => <li key={i} className="flex items-start gap-1">
                  <span className="text-destructive">•</span>
                  <span>{issue}</span>
                </li>)}
            </ul>}
          
          {/* Evidence */}
          {evidence && evidence.length > 0 && <div className="text-xs text-muted-foreground">
              <span className="font-medium">Evidence: </span>
              {evidence.map((e, i) => <span key={i}>
                  {e.observation}
                  {e.location && ` (${e.location})`}
                  {i < evidence.length - 1 && "; "}
                </span>)}
            </div>}
          
          {/* Check results summary */}
          {(scaleCheck || geometryCheck || furnitureCheck) && <div className="flex flex-wrap gap-1.5 text-xs">
              {scaleCheck && <Badge variant={scaleCheck === "passed" ? "outline" : "destructive"} className="text-xs px-1.5 py-0">
                  Scale: {scaleCheck}
                </Badge>}
              {geometryCheck && <Badge variant={geometryCheck === "passed" ? "outline" : "destructive"} className="text-xs px-1.5 py-0">
                  Geometry: {geometryCheck}
                </Badge>}
              {furnitureCheck && <Badge variant={furnitureCheck === "passed" ? "outline" : "destructive"} className="text-xs px-1.5 py-0">
                  Furniture: {furnitureCheck}
                </Badge>}
            </div>}
          
          {/* Retry suggestion */}
          {retrySuggestion && <p className="text-xs text-muted-foreground italic">
              <span className="font-medium">Suggestion: </span>
              {retrySuggestion.instruction}
            </p>}
          
          {/* Severity badge */}
          {severity && <Badge variant="outline" className={`text-xs ${severity === "critical" ? "text-destructive border-destructive" : severity === "high" ? "text-orange-500 border-orange-500" : severity === "medium" ? "text-yellow-500 border-yellow-500" : "text-muted-foreground"}`}>
              {severity} severity
            </Badge>}
        </div>
      </div>
    </div>;
}
export interface StageReviewAsset {
  id: string;
  uploadId: string | null;
  status: string;
  qaStatus?: string | null;
  qaReport?: Record<string, unknown> | null;
  lockedApproved?: boolean;
  promptText?: string | null;
  resolution?: {
    width: number;
    height: number;
  } | null;
  fileSize?: number | null;
  model?: string | null;
  attemptIndex?: number;
}
interface StageReviewPanelProps {
  title: string;
  stepNumber: number;
  beforeUploadId: string | null;
  beforeLabel: string;
  afterAsset: StageReviewAsset;
  afterLabel: string;
  onApprove: () => void;
  onReject: (notes: string) => void;
  /** Optional CTA shown after approval when the backend confirms next step is ready */
  onContinue?: () => void;
  continueLabel?: string;
  isLoading?: boolean;
  bucket?: string;
  /** Optional: Source floor plan upload ID for reference */
  sourcePlanUploadId?: string | null;
  sourcePlanBucket?: string;
  /** Current pipeline step - used to hide outdated Continue buttons */
  currentStep?: number;
  /** Pipeline context for feedback storage */
  projectId?: string;
  pipelineId?: string;
  pipeline?: {
    id: string;
    step_outputs?: Record<string, unknown>;
    global_style_bible?: Record<string, unknown>;
    aspect_ratio?: string;
  } | null;
}
export const StageReviewPanel = memo(function StageReviewPanel({
  title,
  stepNumber,
  beforeUploadId,
  beforeLabel,
  afterAsset,
  afterLabel,
  onApprove,
  onReject,
  onContinue,
  continueLabel = "Continue to Next Step",
  isLoading = false,
  bucket = "outputs",
  sourcePlanUploadId,
  sourcePlanBucket = "panoramas",
  currentStep,
  projectId,
  pipelineId,
  pipeline
}: StageReviewPanelProps) {
  const {
    getSignedViewUrl,
    getSignedDownloadUrl
  } = useStorage();
  const {
    manualQAEnabled,
    needsManualQA
  } = useManualQA();
  const {
    toast
  } = useToast();
  const storeQAFeedback = useStoreQAFeedback();
  const {
    buildSnapshot
  } = useBuildContextSnapshot(pipeline || null);
  const [beforeUrl, setBeforeUrl] = useState<string | null>(null);
  const [afterUrl, setAfterUrl] = useState<string | null>(null);
  const [loadingUrls, setLoadingUrls] = useState(false);
  const [approveDialogOpen, setApproveDialogOpen] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [sourcePlanDialogOpen, setSourcePlanDialogOpen] = useState(false);
  const [sourcePlanUrl, setSourcePlanUrl] = useState<string | null>(null);
  const [loadingSourcePlan, setLoadingSourcePlan] = useState(false);

  // Local processing state to prevent double-clicks and show loading
  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const isProcessing = isApproving || isRejecting || isLoading;
  const loadComparison = useCallback(async () => {
    if (loadingUrls || beforeUrl && afterUrl) return;
    setLoadingUrls(true);
    try {
      // Use uploadId-based lookup (UUID) for both before and after
      // The getSignedViewUrl hook auto-detects if the path is a UUID and resolves it via uploads table
      const [beforeResult, afterResult] = await Promise.all([beforeUploadId ? getSignedViewUrl("lookup", beforeUploadId) : Promise.resolve({
        signedUrl: null
      }), afterAsset.uploadId ? getSignedViewUrl("lookup", afterAsset.uploadId) : Promise.resolve({
        signedUrl: null
      })]);
      if (beforeResult.signedUrl) setBeforeUrl(beforeResult.signedUrl);
      if (afterResult.signedUrl) setAfterUrl(afterResult.signedUrl);
    } finally {
      setLoadingUrls(false);
    }
  }, [beforeUploadId, afterAsset.uploadId, getSignedViewUrl, loadingUrls, beforeUrl, afterUrl]);

  // Auto-load images when panel mounts and has uploadId
  useEffect(() => {
    if (afterAsset.uploadId && !afterUrl && !loadingUrls) {
      loadComparison();
    }
  }, [afterAsset.uploadId, afterUrl, loadingUrls, loadComparison]);
  const handleDownloadFullQuality = useCallback(async () => {
    if (!afterAsset.uploadId || downloading) return;
    setDownloading(true);
    try {
      const filename = `RETOUR_step${stepNumber}_${afterAsset.id.slice(0, 8)}_full.jpg`;
      // Use uploadId-based lookup
      const result = await getSignedDownloadUrl("lookup", afterAsset.uploadId, filename);
      if (result?.signedUrl) {
        const link = document.createElement("a");
        link.href = result.signedUrl;
        link.download = filename;
        link.target = "_blank";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    } catch (error) {
      console.error("Download failed:", error);
    } finally {
      setDownloading(false);
    }
  }, [afterAsset.id, afterAsset.uploadId, stepNumber, getSignedDownloadUrl, downloading]);

  // QA status checks - must be before callbacks that use them
  const isNeedsReview = afterAsset.status === "needs_review";
  const isApproved = afterAsset.lockedApproved;
  const isFailed = ["failed", "rejected", "qa_failed"].includes(afterAsset.status);
  const aiQAPassed = afterAsset.qaStatus === "passed" || afterAsset.qaStatus === "approved";
  const aiQAFailed = afterAsset.qaStatus === "failed" || afterAsset.qaStatus === "rejected";
  const isBlocked = afterAsset.status === "blocked_for_human" || afterAsset.status === "blocked";

  // Load authoritative per-image trace (full prompt + authoritative qa_status) for the Details dialog.
  // IMPORTANT: This avoids using truncated step_outputs.prompt_used and prevents QA state desync.
  const traceQuery = useFloorplanStepAttemptTrace({
    pipelineId,
    stepNumber,
    outputUploadId: afterAsset.uploadId || null,
    enabled: detailsOpen,
  });

  const qaVerdict = traceQuery.data?.verdict
    ?? ((afterAsset.qaStatus || "").toLowerCase() === "approved" || (afterAsset.qaStatus || "").toLowerCase() === "passed"
      ? "APPROVED"
      : (afterAsset.qaStatus || "").toLowerCase() === "rejected" || (afterAsset.qaStatus || "").toLowerCase() === "failed"
        ? "REJECTED"
        : "PENDING");

  const promptFinalSentToModel = traceQuery.data?.trace?.prompt_final_sent_to_model ?? "";
  const qaReasonText = traceQuery.data?.trace?.qa_reason_full ?? traceQuery.data?.trace?.qa_reason_short ?? null;

  // Extract suggested category from QA report
  const getSuggestedCategory = useCallback((): string | null => {
    if (!afterAsset.qaReport) return null;
    const qa = afterAsset.qaReport as Record<string, unknown>;
    const reasons = qa.reasons as Array<{
      code: string;
    }> | undefined;
    if (reasons?.[0]?.code) {
      // Map QA codes to feedback categories
      const code = reasons[0].code.toLowerCase();
      if (code.includes("scale") || code.includes("furniture_scale")) return "furniture_scale";
      if (code.includes("extra") || code.includes("duplicated")) return "extra_furniture";
      if (code.includes("structural") || code.includes("wall") || code.includes("geometry")) return "structural_change";
      if (code.includes("flooring") || code.includes("floor")) return "flooring_mismatch";
    }
    return null;
  }, [afterAsset.qaReport]);

  // Handle approve with feedback dialog
  const handleApproveClick = useCallback(() => {
    if (isProcessing) return;
    setApproveDialogOpen(true);
  }, [isProcessing]);

  // Handle feedback submission for approval
  const handleApproveWithFeedback = useCallback(async (feedback: QAFeedbackData) => {
    if (isProcessing) return;
    setIsApproving(true);
    setApproveDialogOpen(false);
    try {
      // Store feedback if we have pipeline context
      if (projectId && pipelineId) {
        const qaReport = afterAsset.qaReport as Record<string, unknown> | undefined;
        const qaReasons = qaReport?.reasons || [];
        storeQAFeedback.mutate({
          projectId,
          pipelineId,
          stepId: stepNumber,
          attemptNumber: afterAsset.attemptIndex || 1,
          imageId: afterAsset.uploadId,
          userDecision: "approved",
          userCategory: feedback.category,
          userReasonShort: `Score: ${feedback.score ?? "N/A"} — ${feedback.reasonShort}`,
          qaOriginalStatus: aiQAFailed ? "rejected" : aiQAPassed ? "approved" : "pending",
          qaOriginalReasons: qaReasons as unknown[],
          contextSnapshot: {
            ...buildSnapshot(stepNumber),
            user_score: feedback.score,
          },
          qaWasWrong: feedback.qaWasWrong,
          tags: feedback.tags,
          tags_type: feedback.tags_type,
        });
      }

      // Call the original approve handler
      await onApprove();
    } catch (error) {
      toast({
        title: "Approval failed",
        description: error instanceof Error ? error.message : "An unexpected error occurred",
        variant: "destructive"
      });
    } finally {
      setIsApproving(false);
    }
  }, [onApprove, isProcessing, toast, projectId, pipelineId, stepNumber, afterAsset, storeQAFeedback, buildSnapshot, aiQAFailed, aiQAPassed]);

  // Handle reject with feedback dialog
  const handleRejectClick = useCallback(() => {
    if (isProcessing) return;
    setRejectDialogOpen(true);
  }, [isProcessing]);

  // Handle feedback submission for rejection
  const handleRejectWithFeedback = useCallback(async (feedback: QAFeedbackData) => {
    if (isProcessing) return;
    setIsRejecting(true);
    setRejectDialogOpen(false);
    try {
      // Store feedback if we have pipeline context
      if (projectId && pipelineId) {
        const qaReport = afterAsset.qaReport as Record<string, unknown> | undefined;
        const qaReasons = qaReport?.reasons || [];
        storeQAFeedback.mutate({
          projectId,
          pipelineId,
          stepId: stepNumber,
          attemptNumber: afterAsset.attemptIndex || 1,
          imageId: afterAsset.uploadId,
          userDecision: "rejected",
          userCategory: feedback.category,
          userReasonShort: `Score: ${feedback.score ?? "N/A"} — ${feedback.reasonShort}`,
          qaOriginalStatus: aiQAFailed ? "rejected" : aiQAPassed ? "approved" : "pending",
          qaOriginalReasons: qaReasons as unknown[],
          contextSnapshot: { ...buildSnapshot(stepNumber), user_score: feedback.score },
          qaWasWrong: feedback.qaWasWrong,
          tags: feedback.tags,
          tags_type: feedback.tags_type,
        });
      }

      // Call the original reject handler with the reason
      await onReject(feedback.reasonShort);
    } catch (error) {
      toast({
        title: "Rejection failed",
        description: error instanceof Error ? error.message : "An unexpected error occurred",
        variant: "destructive"
      });
    } finally {
      setIsRejecting(false);
    }
  }, [onReject, isProcessing, toast, projectId, pipelineId, stepNumber, afterAsset, storeQAFeedback, buildSnapshot, aiQAFailed, aiQAPassed]);
  const handleViewSourcePlan = useCallback(async () => {
    if (!sourcePlanUploadId) return;
    if (sourcePlanUrl) {
      setSourcePlanDialogOpen(true);
      return;
    }
    setLoadingSourcePlan(true);
    try {
      const result = await getSignedViewUrl("lookup", sourcePlanUploadId);
      if (result.signedUrl) {
        setSourcePlanUrl(result.signedUrl);
        setSourcePlanDialogOpen(true);
      }
    } finally {
      setLoadingSourcePlan(false);
    }
  }, [sourcePlanUploadId, sourcePlanUrl, getSignedViewUrl]);
  const requiresManualApproval = manualQAEnabled && aiQAPassed && !isApproved;

  // Show review controls when:
  // 1) Asset is in needs_review status, OR
  // 2) Manual QA is enabled and AI-QA passed but not manually approved
  const showReviewControls = !isApproved && (isNeedsReview || requiresManualApproval);

  // Show QA rejection details when:
  // 1) AI-QA explicitly failed, OR
  // 2) Status indicates a blocked/failed state
  const showQARejectionDetails = (aiQAFailed || isBlocked || isFailed) && afterAsset.qaReport;

  // Show QA approval details when AI-QA passed and we have a report
  const showQAApprovalDetails = aiQAPassed && afterAsset.qaReport && !showQARejectionDetails;

  // CRITICAL FIX: Continue button visibility logic
  // The button MUST appear when:
  // 1. onContinue is provided (handler exists)
  // 2. AND step is approved (lockedApproved = true)
  // 3. AND pipeline hasn't advanced significantly past this step
  //
  // HARD FALLBACK: If onContinue is provided and isApproved is true,
  // ALWAYS show the button regardless of currentStep - this prevents dead-end states
  const isStepOutdated = currentStep !== undefined && currentStep > stepNumber + 2;

  // Primary: Show if not outdated
  // Fallback: ALWAYS show if approved (prevents dead-end)
  const showContinueButton = onContinue && (isApproved || !isStepOutdated);

  // Always show an action bar - either review controls, approved state, or fallback
  const showApprovedActionBar = isApproved && !showReviewControls;
  if (!afterAsset.uploadId) return null;
  return <>
      <Card className="border-border/50 overflow-hidden">
        <CardContent className="p-0">
          {/* Header with status badges */}
          <div className="flex items-center justify-between p-3 border-b border-border/50 bg-muted/20">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{title}</span>
              <Badge variant="outline" className="text-xs">
                Step {stepNumber}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              {/* AI QA Status */}
              {aiQAPassed && <Badge className="bg-green-500/20 text-green-400 text-xs">
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  AI-QA Pass
                </Badge>}
              {aiQAFailed && <Badge className="bg-destructive/20 text-destructive text-xs">
                  <XCircle className="w-3 h-3 mr-1" />
                  AI-QA Fail
                </Badge>}
              
              {/* Manual Approval Status */}
              {isApproved && <Badge className="bg-primary/20 text-primary text-xs">
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  Approved
                </Badge>}
              {isFailed && <Badge className="bg-destructive/20 text-destructive text-xs">
                  <AlertTriangle className="w-3 h-3 mr-1" />
                  Rejected
                </Badge>}
            </div>
          </div>

          {/* AI-QA Approval Reason Box - REMOVED: Automatic scores should not be shown.
              Users should only see manual score input when approving/rejecting.
              The AI-QA Pass badge in header is sufficient for informational purposes. */}

          {/* AI-QA Rejection Reason Box - Show prominently when QA failed or blocked */}
          {showQARejectionDetails && <QARejectionReasonBox qaReport={afterAsset.qaReport!} />}
          
          {/* Fallback error when QA failed but no report available */}
          {(aiQAFailed || isBlocked) && !afterAsset.qaReport && <div className="mx-3 mb-0 p-3 rounded-lg border border-destructive/30 bg-destructive/5">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-destructive">QA Failed</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Reason payload is missing. Check logs for details.
                  </p>
                </div>
              </div>
            </div>}

          {/* Before/After Comparison */}
          <div className="p-3">
            {beforeUrl && afterUrl ? <BeforeAfterSlider beforeImage={beforeUrl} afterImage={afterUrl} beforeLabel={beforeLabel} afterLabel={afterLabel} allowFullscreen /> : <div className="w-full aspect-video bg-muted/30 rounded-lg flex flex-col items-center justify-center cursor-pointer hover:bg-muted/50 transition-colors" onClick={loadComparison}>
                {loadingUrls ? <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /> : <>
                    <Eye className="w-8 h-8 text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">Click to load comparison</p>
                  </>}
              </div>}
          </div>

          {/* Action bar with approval controls */}
          {showReviewControls && <div className="flex items-center justify-between p-3 border-t border-border/50 bg-muted/10">
              <div className="flex items-center gap-2">
                {sourcePlanUploadId && <Button size="sm" variant="ghost" onClick={handleViewSourcePlan} disabled={loadingSourcePlan}>
                    {loadingSourcePlan ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Eye className="w-4 h-4 mr-1" />}
                    Source Plan
                  </Button>}
                <Button size="sm" variant="ghost" onClick={() => setDetailsOpen(true)}>
                  <FileText className="w-4 h-4 mr-1" />
                  Details
                </Button>
                <Button size="sm" variant="ghost" onClick={handleDownloadFullQuality} disabled={downloading}>
                  {downloading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Download className="w-4 h-4 mr-1" />}
                  Full Quality
                </Button>
              </div>
              
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" className="text-primary border-primary hover:bg-primary/10" onClick={handleApproveClick} disabled={isProcessing}>
                  {isApproving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <ThumbsUp className="w-4 h-4 mr-1" />}
                  {isApproving ? "Approving..." : "Approve & Continue"}
                </Button>
                <Button size="sm" variant="outline" className="text-destructive border-destructive hover:bg-destructive/10" onClick={handleRejectClick} disabled={isProcessing}>
                  {isRejecting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <ThumbsDown className="w-4 h-4 mr-1" />}
                  {isRejecting ? "Rejecting..." : "Reject"}
                </Button>
              </div>
            </div>}

          {/* Approved state - show Continue button and download options */}
          {showApprovedActionBar && <div className="flex items-center justify-between p-3 border-t border-border/50 bg-primary/5">
              <div className="flex items-center gap-2">
                {showContinueButton && <Button size="sm" onClick={onContinue} disabled={isLoading}>
                    {continueLabel}
                  </Button>}
                <Button size="sm" variant="ghost" onClick={() => setDetailsOpen(true)}>
                  <FileText className="w-4 h-4 mr-1" />
                  Details
                </Button>
                <Button size="sm" variant="ghost" onClick={handleDownloadFullQuality} disabled={downloading}>
                  {downloading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Download className="w-4 h-4 mr-1" />}
                  Full Quality
                </Button>
              </div>
              <Badge className="bg-primary/20 text-primary">
                <CheckCircle2 className="w-3 h-3 mr-1" />
                Manually Approved
              </Badge>
            </div>}
          
          {/* Fallback action bar - ensure something always shows when asset has output */}
          {!showReviewControls && !showApprovedActionBar && <div className="flex items-center justify-between p-3 border-t border-border/50 bg-muted/10">
              <div className="flex items-center gap-2">
                {showContinueButton && <Button size="sm" onClick={onContinue} disabled={isLoading}>
                    {continueLabel}
                  </Button>}
                <Button size="sm" variant="ghost" onClick={() => setDetailsOpen(true)}>
                  <FileText className="w-4 h-4 mr-1" />
                  Details
                </Button>
                <Button size="sm" variant="ghost" onClick={handleDownloadFullQuality} disabled={downloading}>
                  {downloading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Download className="w-4 h-4 mr-1" />}
                  Full Quality
                </Button>
              </div>
              {/* Show pending/processing state badge */}
              <Badge variant="outline" className="text-xs">
                {isBlocked ? "Manual Review Required" : isFailed ? "Failed" : "Processing"}
              </Badge>
            </div>}
        </CardContent>
      </Card>

      {/* QA Feedback Dialogs - with manual score input (0-100) */}
      <QAFeedbackDialog 
        open={approveDialogOpen} 
        onOpenChange={setApproveDialogOpen} 
        mode="approve" 
        onSubmit={handleApproveWithFeedback} 
        isSubmitting={isApproving} 
        suggestedCategory={getSuggestedCategory()} 
        qaOriginalStatus={aiQAFailed ? "rejected" : aiQAPassed ? "approved" : "pending"} 
        attemptNumber={afterAsset.attemptIndex || 1} 
        stepNumber={stepNumber}
        initialScore={(afterAsset.qaReport as Record<string, unknown> | undefined)?.score as number | undefined ?? null}
      />
      
      <QAFeedbackDialog 
        open={rejectDialogOpen} 
        onOpenChange={setRejectDialogOpen} 
        mode="reject" 
        onSubmit={handleRejectWithFeedback} 
        isSubmitting={isRejecting} 
        suggestedCategory={getSuggestedCategory()} 
        qaOriginalStatus={aiQAFailed ? "rejected" : aiQAPassed ? "approved" : "pending"} 
        attemptNumber={afterAsset.attemptIndex || 1} 
        stepNumber={stepNumber}
        initialScore={(afterAsset.qaReport as Record<string, unknown> | undefined)?.score as number | undefined ?? null}
      />

      {/* Details Dialog - Full Prompt Visibility */}
      <QADetailsDialog
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        title={title}
        asset={{
          id: afterAsset.id,
          uploadId: afterAsset.uploadId,
          resolution: afterAsset.resolution,
          fileSize: afterAsset.fileSize,
          model: afterAsset.model,
          attemptIndex: afterAsset.attemptIndex,
          promptFinalSentToModel,
          qaReport: afterAsset.qaReport,
          qaStatus: afterAsset.qaStatus,
          qaVerdict,
          qaReasonText,
        }}
        beforeUploadId={beforeUploadId}
        stepNumber={stepNumber}
      />

      {/* Source Plan Dialog */}
      <Dialog open={sourcePlanDialogOpen} onOpenChange={setSourcePlanDialogOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Source Floor Plan</DialogTitle>
            <DialogDescription>
              Reference the original floor plan for geometry and layout validation
            </DialogDescription>
          </DialogHeader>
          {sourcePlanUrl && <img src={sourcePlanUrl} alt="Source floor plan" className="w-full h-auto rounded-lg" />}
        </DialogContent>
      </Dialog>
    </>;
});