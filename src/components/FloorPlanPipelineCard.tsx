import { useState, useEffect, memo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FloorplanPipeline, usePipelineEvents, usePipelineReviews } from "@/hooks/useFloorplanPipelines";
import { useStorage } from "@/hooks/useStorage";
import { BeforeAfterSlider } from "@/components/BeforeAfterSlider";
import { FloorPlanPipelineTerminal } from "@/components/FloorPlanPipelineTerminal";
import { PipelineStepOutputs } from "@/components/PipelineStepOutputs";
import { usePipelinePromptOptimizer } from "@/hooks/usePipelinePromptOptimizer";
import { AspectRatioPreview, AspectRatioSelectItemContent } from "@/components/AspectRatioPreview";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { 
  Play, ChevronDown, ChevronUp, Loader2, Check, X, 
  ThumbsUp, ThumbsDown, Eye, FileImage, ArrowRight, ArrowLeft, MapPin, ImagePlus, Terminal, Wand2,
  RotateCcw, AlertTriangle, Trash2, RefreshCw, SkipForward
} from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Step2DesignReferences, Step2ReferenceSelectionModal } from "@/components/Step2DesignReferences";

interface DesignReference {
  uploadId: string;
  url: string;
  filename: string;
}

interface FloorPlanPipelineCardProps {
  pipeline: FloorplanPipeline;
  onStartStep: (pipelineId: string, cameraPosition?: string, forwardDirection?: string, designRefUploadIds?: string[], styleTitle?: string, outputCount?: number, step3PresetId?: string, step3CustomPrompt?: string) => Promise<void>;
  onApproveStep: (pipelineId: string, stepNumber: number, notes?: string, outputIndex?: number) => Promise<void>;
  onRejectStep: (pipelineId: string, stepNumber: number, notes?: string, outputIndex?: number) => Promise<void>;
  onSkipToStep?: (pipelineId: string, targetStep: number) => Promise<void>;
  onGoBackToStep?: (pipelineId: string, targetStep: number) => Promise<void>;
  onAttachToPanoramas?: (pipelineId: string, outputUploadId: string) => Promise<void>;
  onUpdateSettings?: (pipelineId: string, outputResolution: string, aspectRatio: string) => Promise<void>;
  onResetPipeline?: (pipelineId: string) => Promise<void>;
  onDeletePipeline?: (pipelineId: string) => Promise<void>;
  isGoingBack?: boolean;
  isStarting: boolean;
  isAttaching?: boolean;
  isResetting?: boolean;
  isDeleting?: boolean;
  imagePreviews: Record<string, string>;
  // Step 2 mutual exclusion callback
  onStep2RefsChange?: (hasRefs: boolean) => void;
  // Lock Step 2 references when AI suggestions are active
  step2SuggestionsActive?: boolean;
}

// 4-step pipeline (removed Approval Gate)
const STEP_NAMES = [
  "2D → Top-Down 3D",
  "Style Interior",
  "Camera-Angle Render",
  "360° Panorama"
];

const STEP_TEMPLATES = [
  "floor_plan_top_down",
  "floor_plan_eye_level",
  "camera_angle_render",
  "panorama_360_interior"
];

const TOTAL_STEPS = 4;

const statusColors: Record<string, string> = {
  step1_pending: "bg-muted text-muted-foreground",
  step1_running: "bg-blue-500/20 text-blue-400",
  step1_waiting_approval: "bg-yellow-500/20 text-yellow-400",
  step1_rejected: "bg-destructive/20 text-destructive",
  step2_pending: "bg-muted text-muted-foreground",
  step2_running: "bg-blue-500/20 text-blue-400",
  step2_waiting_approval: "bg-yellow-500/20 text-yellow-400",
  step2_rejected: "bg-destructive/20 text-destructive",
  step3_pending: "bg-muted text-muted-foreground",
  step3_running: "bg-blue-500/20 text-blue-400",
  step3_waiting_approval: "bg-yellow-500/20 text-yellow-400",
  step3_rejected: "bg-destructive/20 text-destructive",
  step4_pending: "bg-muted text-muted-foreground",
  step4_running: "bg-blue-500/20 text-blue-400",
  step4_waiting_approval: "bg-yellow-500/20 text-yellow-400",
  step4_rejected: "bg-destructive/20 text-destructive",
  completed: "bg-green-500/20 text-green-400",
  failed: "bg-destructive/20 text-destructive"
};

const FloorPlanPipelineCardInner = memo(function FloorPlanPipelineCardInner({
  pipeline,
  onStartStep,
  onApproveStep,
  onRejectStep,
  onSkipToStep,
  onGoBackToStep,
  onAttachToPanoramas,
  onUpdateSettings,
  onResetPipeline,
  onDeletePipeline,
  isStarting,
  isAttaching,
  isResetting,
  isDeleting,
  isGoingBack,
  imagePreviews,
  onStep2RefsChange,
  step2SuggestionsActive = false
}: FloorPlanPipelineCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareStep, setCompareStep] = useState<number | null>(null);
  const [beforeUrl, setBeforeUrl] = useState<string>("");
  const [afterUrl, setAfterUrl] = useState<string>("");
  const [loadingCompare, setLoadingCompare] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalStepFilter, setTerminalStepFilter] = useState<number | null>(null);
  
  // Try Again state
  const [isRetrying, setIsRetrying] = useState(false);
  const [tryAgainConfirmOpen, setTryAgainConfirmOpen] = useState(false);
  
  // Settings state for Step 1
  const [localQuality, setLocalQuality] = useState(pipeline.output_resolution || "2K");
  const [localRatio, setLocalRatio] = useState(pipeline.aspect_ratio || "16:9");
  
  // Camera position dialog for step 4
  const [cameraDialogOpen, setCameraDialogOpen] = useState(false);
  const [cameraPosition, setCameraPosition] = useState("");
  const [forwardDirection, setForwardDirection] = useState("");
  
  // Review dialog
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [reviewNotes, setReviewNotes] = useState("");
  const [pendingDecision, setPendingDecision] = useState<"approved" | "rejected" | null>(null);
  
  // AI-driven rejection retry state
  const [improvedPromptDialogOpen, setImprovedPromptDialogOpen] = useState(false);
  const [improvedPrompt, setImprovedPrompt] = useState<string | null>(null);
  const [pendingRejectionStep, setPendingRejectionStep] = useState<number | null>(null);
  
  // Reject confirmation dialog state
  const [rejectConfirmDialogOpen, setRejectConfirmDialogOpen] = useState(false);
  const [isRerendering, setIsRerendering] = useState(false); // Prevent duplicate submits
  
  // Reset dialog state (controlled to prevent double-submit)
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [isLocalResetting, setIsLocalResetting] = useState(false);
  
  // Skip to next step state
  const [isSkipping, setIsSkipping] = useState(false);
  
  // Go back to previous step state
  const [goBackDialogOpen, setGoBackDialogOpen] = useState(false);
  const [isLocalGoingBack, setIsLocalGoingBack] = useState(false);
  
  // Step 2 Design References state
  const [step2Refs, setStep2Refs] = useState<DesignReference[]>([]);
  const [isUploadingRefs, setIsUploadingRefs] = useState(false);
  const [refSelectionModalOpen, setRefSelectionModalOpen] = useState(false);
  
  // Multi-output count selector (Steps 2, 3, 4)
  const [outputCount, setOutputCount] = useState(1);
  
  const { getSignedViewUrl } = useStorage();
  const { data: events } = usePipelineEvents(expanded ? pipeline.id : null);
  const { data: reviews } = usePipelineReviews(expanded ? pipeline.id : null);
  const { isOptimizing, improveAfterRejection } = usePipelinePromptOptimizer();
  const { toast } = useToast();

  // Notify parent when Step 2 references change (for mutual exclusion)
  useEffect(() => {
    onStep2RefsChange?.(step2Refs.length > 0);
  }, [step2Refs.length, onStep2RefsChange]);

  const currentStep = pipeline.current_step;
  const isWaitingApproval = pipeline.status.includes("waiting_approval");
  const isRunning = pipeline.status.includes("running");
  const isPending = pipeline.status.includes("pending");
  const isFailed = pipeline.status === "failed";
  const isStepRejected = pipeline.status.includes("_rejected");
  
  // Check if this pipeline was created from Creations attach
  const attachOrigin = (pipeline.step_outputs as Record<string, any>)?._attach_origin;
  const isFromCreationsAttach = attachOrigin?.source === "creations_attach";

  // Get step output upload IDs
  const getStepOutputId = (step: number): string | null => {
    const outputs = pipeline.step_outputs as Record<string, any>;
    return outputs?.[`step${step}`]?.output_upload_id || null;
  };

  const getStepQA = (step: number) => {
    const outputs = pipeline.step_outputs as Record<string, any>;
    const stepData = outputs?.[`step${step}`];
    return {
      decision: stepData?.overall_qa_decision || stepData?.qa_decision,
      reason: stepData?.overall_qa_reason || stepData?.qa_reason,
      approvedCount: stepData?.approved_count,
      rejectedCount: stepData?.rejected_count,
      isPartialSuccess: stepData?.overall_qa_decision === "partial_success"
    };
  };
  
  // Check if current step has any output - allows retry for ANY completed step
  const currentStepQA = getStepQA(currentStep);
  const hasAnyOutput = getStepOutputId(currentStep) !== null;
  const previousStepHasOutput = currentStep > 1 ? getStepOutputId(currentStep - 1) !== null : true;
  
  // RETRY is allowed for ALL step states: failed, rejected, approved, partial, skipped, or pending with output
  // Retry re-runs ONLY the current step, preserving previous outputs
  const canRetry = isFailed || isStepRejected || 
    (isWaitingApproval) || // Can retry approved/partial outputs
    (isPending && (hasAnyOutput || previousStepHasOutput)); // Can retry if has output or can start fresh

  const loadCompareImages = async (step: number) => {
    setLoadingCompare(true);
    setCompareStep(step);
    
    try {
      // Before is previous step output or floor plan for step 1
      let beforeUploadId: string;
      if (step === 1) {
        beforeUploadId = pipeline.floor_plan_upload_id;
      } else {
        const prevStepOutputId = getStepOutputId(step - 1);
        if (!prevStepOutputId) {
          throw new Error("Previous step output not found");
        }
        beforeUploadId = prevStepOutputId;
      }

      const afterUploadId = getStepOutputId(step);
      if (!afterUploadId) {
        throw new Error("Current step output not found");
      }

      // Get before upload details
      const { data: beforeUpload } = await supabase
        .from("uploads")
        .select("bucket, path")
        .eq("id", beforeUploadId)
        .single();

      const { data: afterUpload } = await supabase
        .from("uploads")
        .select("bucket, path")
        .eq("id", afterUploadId)
        .single();

      if (beforeUpload && afterUpload) {
        const [beforeResult, afterResult] = await Promise.all([
          getSignedViewUrl(beforeUpload.bucket, beforeUpload.path),
          getSignedViewUrl(afterUpload.bucket, afterUpload.path)
        ]);

        setBeforeUrl(beforeResult.signedUrl || "");
        setAfterUrl(afterResult.signedUrl || "");
        setCompareOpen(true);
      }
    } catch (error) {
      console.error("Failed to load compare images:", error);
    } finally {
      setLoadingCompare(false);
    }
  };

  const handleStartStep = () => {
    console.log(`[Pipeline] handleStartStep called for step ${currentStep}, outputCount=${outputCount}`);
    if (currentStep === 2 && step2Refs.length > 0) {
      // Step 2 with references - show selection modal
      setRefSelectionModalOpen(true);
    } else {
      // Step 1, 2 (no refs), 3, or 4 - start immediately
      // Step 4 derives camera from previous suggestions/outputs automatically
      const count = currentStep >= 2 ? outputCount : 1;
      onStartStep(pipeline.id, undefined, undefined, undefined, undefined, count);
    }
  };

  // Handle Step 2 with selected design references
  const handleStep2WithRefs = (selectedRefIds: string[]) => {
    setRefSelectionModalOpen(false);
    console.log(`[Pipeline] Starting Step 2 with ${selectedRefIds.length} design references, outputCount=${outputCount}`);
    onStartStep(pipeline.id, undefined, undefined, selectedRefIds, undefined, outputCount);
  };

  // Handle Step 2 without references (user chose to skip)
  const handleStep2WithoutRefs = () => {
    setRefSelectionModalOpen(false);
    console.log(`[Pipeline] Starting Step 2 without design references, outputCount=${outputCount}`);
    onStartStep(pipeline.id, undefined, undefined, undefined, undefined, outputCount);
  };

  const handleCameraSubmit = () => {
    if (!cameraPosition.trim() || !forwardDirection.trim()) return;
    onStartStep(pipeline.id, cameraPosition, forwardDirection, undefined, undefined, outputCount);
    setCameraDialogOpen(false);
    setCameraPosition("");
    setForwardDirection("");
  };

  // Handle Skip to Next Step (available for any step when it has a valid output)
  const handleSkipToNextStep = async () => {
    if (!onSkipToStep || currentStep >= 4) return;
    
    // For Step 2 skip: we need Step 1's output (not Step 2's output)
    // For other steps: we need the current step's output
    const requiredStepOutput = currentStep === 2 
      ? getStepOutputId(1) // Step 2 skip uses Step 1 output
      : getStepOutputId(currentStep);
    
    if (!requiredStepOutput) {
      toast({
        title: "Cannot skip",
        description: currentStep === 2 
          ? "Step 1 must be completed before skipping to Step 3"
          : "Current step must have a valid output to skip",
        variant: "destructive"
      });
      return;
    }
    
    setIsSkipping(true);
    try {
      await onSkipToStep(pipeline.id, currentStep + 1);
      toast({ title: `Skipped to Step ${currentStep + 1}`, description: `Step ${currentStep} marked as skipped` });
    } catch (error) {
      console.error("Skip to next step failed:", error);
      toast({
        title: "Skip failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
    } finally {
      setIsSkipping(false);
    }
  };
  
  // Can skip to next step if: 
  // - Not at the final step (step 4)
  // - AND (waiting approval OR pending with an output from current step)
  const canSkipToNextStep = currentStep < 4 && 
    (isWaitingApproval || isPending) && 
    (getStepOutputId(currentStep) !== null || currentStep === 1);
  
  // Can go back if current step > 1 and not running
  const canGoBack = currentStep > 1 && !isRunning;
  
  // Handle Go Back to Previous Step
  const handleGoBack = async () => {
    if (!onGoBackToStep || currentStep <= 1 || isLocalGoingBack) return;
    
    setIsLocalGoingBack(true);
    try {
      await onGoBackToStep(pipeline.id, currentStep - 1);
      setGoBackDialogOpen(false);
    } catch (error) {
      console.error("Go back failed:", error);
      toast({
        title: "Failed to go back",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
    } finally {
      setIsLocalGoingBack(false);
    }
  };

  // Handle Try Again action
  const handleTryAgain = async () => {
    console.log(`[Pipeline] Try Again clicked for step ${currentStep}`);
    setIsRetrying(true);
    
    try {
      // Update settings if needed to ensure same Ratio/Quality
      if (onUpdateSettings && (localQuality !== pipeline.output_resolution || localRatio !== pipeline.aspect_ratio)) {
        await onUpdateSettings(pipeline.id, localQuality, localRatio);
      }
      
      // Run the step again with same settings (no camera modal for step 4)
      await onStartStep(pipeline.id);
      toast({ title: "Retrying step", description: `Re-running Step ${currentStep} with same settings` });
    } catch (error) {
      console.error("Try Again failed:", error);
      toast({
        title: "Retry failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
    } finally {
      setIsRetrying(false);
      setTryAgainConfirmOpen(false);
    }
  };

  const handleReviewAction = (decision: "approved" | "rejected") => {
    setPendingDecision(decision);
    setReviewDialogOpen(true);
  };

  const handleSubmitReview = async () => {
    if (!pendingDecision) return;
    
    const stepMatch = pipeline.status.match(/step(\d)_waiting_approval/);
    const stepNumber = stepMatch ? parseInt(stepMatch[1]) : currentStep;
    
    if (pendingDecision === "approved") {
      await onApproveStep(pipeline.id, stepNumber, reviewNotes || undefined);
      setReviewDialogOpen(false);
      setReviewNotes("");
      setPendingDecision(null);
    } else {
      // For rejection, require a reason
      if (!reviewNotes.trim()) {
        toast({ title: "Please provide a rejection reason", variant: "destructive" });
        return;
      }
      
      // Close the notes dialog and open the confirmation dialog
      setPendingRejectionStep(stepNumber);
      setReviewDialogOpen(false);
      setRejectConfirmDialogOpen(true);
    }
  };

  // Handle re-render action from rejection confirmation
  const handleRejectRerender = async () => {
    if (!pendingRejectionStep || isRerendering) return;
    
    setIsRerendering(true);
    
    // CLOSE MODAL IMMEDIATELY on START (per requirement #4)
    setRejectConfirmDialogOpen(false);
    
    try {
      // Generate improved prompt based on rejection reason
      const previousPrompt = "Previous step prompt";
      
      const improved = await improveAfterRejection({
        stepNumber: pendingRejectionStep,
        previousPrompt,
        rejectionReason: reviewNotes.trim()
      });
      
      if (improved) {
        setImprovedPrompt(improved);
        setImprovedPromptDialogOpen(true);
        toast({ title: "Re-render started", description: "Generating improved output..." });
      } else {
        // Fall back to regular rejection if AI fails
        await onRejectStep(pipeline.id, pendingRejectionStep, reviewNotes || undefined);
        resetRejectionState();
        toast({ title: "Re-render started" });
      }
    } catch (error) {
      console.error("Re-render failed:", error);
      toast({ 
        title: "Re-render failed", 
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive" 
      });
    } finally {
      setIsRerendering(false);
    }
  };

  // Handle skip & approve action
  const handleSkipAndApprove = async () => {
    if (!pendingRejectionStep || isRerendering) return;
    
    setIsRerendering(true);
    try {
      await onApproveStep(pipeline.id, pendingRejectionStep, `Skipped rejection: ${reviewNotes}`);
      resetRejectionState();
      toast({ title: "Step approved (skip rejection)", description: "Proceeding to next step" });
    } catch (error) {
      toast({ 
        title: "Approval failed", 
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive" 
      });
    } finally {
      setIsRerendering(false);
    }
  };

  // Reset rejection state helper
  const resetRejectionState = () => {
    setRejectConfirmDialogOpen(false);
    setImprovedPromptDialogOpen(false);
    setImprovedPrompt(null);
    setPendingRejectionStep(null);
    setReviewNotes("");
    setPendingDecision(null);
    setIsRerendering(false);
  };

  // Apply improved prompt and trigger retry
  const handleApplyImprovedPrompt = async () => {
    if (!pendingRejectionStep || !improvedPrompt) return;
    
    // Store the rejection with the improved prompt
    await onRejectStep(pipeline.id, pendingRejectionStep, `Rejected with improved prompt: ${improvedPrompt}`);
    
    resetRejectionState();
    toast({ title: "Improved prompt ready for retry" });
  };

  // Calculate overall progress (4 steps = 25% each)
  const getOverallProgress = () => {
    if (pipeline.status === "completed") return 100;
    if (pipeline.status === "failed") return 0;
    
    const stepMatch = pipeline.status.match(/step(\d)/);
    if (!stepMatch) return 0;
    
    const step = parseInt(stepMatch[1]);
    const baseProgress = (step - 1) * 25; // 4 steps = 25% each
    console.log(`[Pipeline] Progress calculation: step=${step}, base=${baseProgress}, status=${pipeline.status}`);
    
    if (pipeline.status.includes("waiting_approval")) {
      return baseProgress + 20;
    } else if (pipeline.status.includes("running")) {
      return baseProgress + 10;
    } else if (pipeline.status.includes("_rejected")) {
      // All rejected - show progress at the step with error indicator
      return baseProgress + 5;
    }
    return baseProgress;
  };

  return (
    <>
      <Card id={`pipeline-row-${pipeline.id}`} className="transition-all duration-300">
        <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base flex items-center gap-2">
                <FileImage className="h-4 w-4 text-muted-foreground" />
                Floor Plan Pipeline
              </CardTitle>
              {/* ATTACH badge when created from Creations */}
              {isFromCreationsAttach && (
                <Badge variant="secondary" className="text-xs bg-primary/20 text-primary">
                  <ImagePlus className="h-3 w-3 mr-1" />
                  ATTACH
                </Badge>
              )}
            </div>
            <CardDescription>
              {pipeline.floor_plan?.original_filename || "Floor plan"} • Created {format(new Date(pipeline.created_at), "MMM d, yyyy HH:mm")}
            </CardDescription>
          </div>
          <Badge className={statusColors[pipeline.status] || statusColors.failed}>
            {pipeline.status === "completed" 
              ? "Completed" 
              : pipeline.status === "failed"
              ? "Failed"
              : isStepRejected
              ? `Step ${currentStep} - All Rejected`
              : currentStepQA?.isPartialSuccess
              ? `Step ${currentStep} - Partial Success`
              : `Step ${currentStep}/${TOTAL_STEPS}`}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Progress stepper */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              {STEP_NAMES.map((name, i) => {
                const step = i + 1;
                const isComplete = currentStep > step || (currentStep === step && isWaitingApproval);
                const isCurrent = currentStep === step;
                const stepQA = getStepQA(step);
                
                return (
                  <div key={step} className="flex items-center">
                    <div className={`
                      w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium
                      ${isComplete ? "bg-green-500 text-white" : isCurrent && isRunning ? "bg-blue-500 text-white" : isCurrent ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}
                    `}>
                      {isComplete ? <Check className="h-4 w-4" /> : step}
                    </div>
                    {step < TOTAL_STEPS && (
                      <ArrowRight className={`h-3 w-3 mx-0.5 ${currentStep > step ? "text-green-500" : "text-muted-foreground"}`} />
                    )}
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between text-[9px] text-muted-foreground">
              {STEP_NAMES.map((name, i) => (
                <span key={i} className="text-center w-16 leading-tight">{name}</span>
              ))}
            </div>
          </div>

          {/* Overall progress bar */}
          <div className="space-y-1">
            <Progress value={getOverallProgress()} className="h-2" />
            <p className="text-xs text-muted-foreground text-center">
              {getOverallProgress()}% complete
            </p>
          </div>

          {/* Error message */}
          {pipeline.last_error && (
            <div className="p-2 bg-destructive/10 rounded text-sm text-destructive">
              {pipeline.last_error}
            </div>
          )}

          {/* Step 1 Pre-Run Settings: Ratio + Quality selection - visible for pending OR rejected state */}
          {((isPending && !isRunning && currentStep === 1) || (isStepRejected && currentStep === 1)) && (
            <div className="p-3 bg-muted/30 rounded-lg border border-muted space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Pre-Run Settings</Label>
                <span className="text-xs text-muted-foreground">Configure before starting Step 1</span>
              </div>
              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground whitespace-nowrap">Aspect Ratio</Label>
                  <Select value={localRatio} onValueChange={setLocalRatio}>
                    <SelectTrigger className="w-28 h-8 text-xs">
                      <div className="flex items-center gap-1.5">
                        <AspectRatioPreview ratio={localRatio} size="sm" selected />
                        <span>{localRatio}</span>
                      </div>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1:1"><AspectRatioSelectItemContent value="1:1" showLabel={false} /></SelectItem>
                      <SelectItem value="4:3"><AspectRatioSelectItemContent value="4:3" showLabel={false} /></SelectItem>
                      <SelectItem value="16:9"><AspectRatioSelectItemContent value="16:9" showLabel={false} /></SelectItem>
                      <SelectItem value="2:1"><AspectRatioSelectItemContent value="2:1" showLabel={false} /></SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground whitespace-nowrap">Output Quality</Label>
                  <Select value={localQuality} onValueChange={setLocalQuality}>
                    <SelectTrigger className="w-20 h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1K">1K</SelectItem>
                      <SelectItem value="2K">2K</SelectItem>
                      <SelectItem value="4K">4K</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}

          {/* Ratio + Quality + Output Count selectors - visible before Steps 2, 3, 4, OR when step is REJECTED (allows adjustments before retry) */}
          {((isPending && !isRunning && currentStep >= 2) || (isStepRejected && currentStep >= 2)) && (
            <div className="flex items-center gap-4 p-3 bg-muted/30 rounded-lg flex-wrap">
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground whitespace-nowrap">Aspect Ratio</Label>
                <Select value={localRatio} onValueChange={setLocalRatio}>
                  <SelectTrigger className="w-28 h-8 text-xs">
                    <div className="flex items-center gap-1.5">
                      <AspectRatioPreview ratio={localRatio} size="sm" selected />
                      <span>{localRatio}</span>
                    </div>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1:1"><AspectRatioSelectItemContent value="1:1" showLabel={false} /></SelectItem>
                    <SelectItem value="4:3"><AspectRatioSelectItemContent value="4:3" showLabel={false} /></SelectItem>
                    <SelectItem value="16:9"><AspectRatioSelectItemContent value="16:9" showLabel={false} /></SelectItem>
                    <SelectItem value="2:1"><AspectRatioSelectItemContent value="2:1" showLabel={false} /></SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground whitespace-nowrap">Output Quality</Label>
                <Select value={localQuality} onValueChange={setLocalQuality}>
                  <SelectTrigger className="w-20 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1K">1K</SelectItem>
                    <SelectItem value="2K">2K</SelectItem>
                    <SelectItem value="4K">4K</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {/* Number of Outputs selector - for Steps 2, 3, 4 */}
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground whitespace-nowrap">Outputs</Label>
                <Select value={outputCount.toString()} onValueChange={(v) => setOutputCount(parseInt(v))}>
                  <SelectTrigger className="w-14 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1</SelectItem>
                    <SelectItem value="2">2</SelectItem>
                    <SelectItem value="3">3</SelectItem>
                    <SelectItem value="4">4</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <span className="text-xs text-muted-foreground">for Step {currentStep}</span>
            </div>
          )}

          {/* Step 2 Design References UI - ONLY visible for Step 2 */}
          {currentStep === 2 && isPending && !isRunning && (
            <Step2DesignReferences
              pipelineId={pipeline.id}
              projectId={pipeline.project_id}
              references={step2Refs}
              onReferencesChange={setStep2Refs}
              isUploading={isUploadingRefs}
              onUploadStart={() => setIsUploadingRefs(true)}
              onUploadEnd={() => setIsUploadingRefs(false)}
              isLocked={step2SuggestionsActive}
              lockedReason="Clear AI suggestions to use design references"
            />
          )}

          {/* Action buttons with settings badges */}
          <div className="flex items-center gap-2 flex-wrap">
            {isPending && !isRunning && (
              <>
                <Button
                  size="sm"
                  onClick={() => {
                    // Update settings if changed before starting any step
                    if (onUpdateSettings && (localQuality !== pipeline.output_resolution || localRatio !== pipeline.aspect_ratio)) {
                      onUpdateSettings(pipeline.id, localQuality, localRatio).then(() => {
                        handleStartStep();
                      });
                    } else {
                      handleStartStep();
                    }
                  }}
                  disabled={isStarting}
                >
                  {isStarting ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4 mr-1" />
                  )}
                  Run Step {currentStep}
                </Button>
                
                {/* Skip to Step 3 button - only visible for Step 2 */}
                {currentStep === 2 && onSkipToStep && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={handleSkipToNextStep}
                    disabled={isSkipping}
                    title="Skip Step 2 and proceed directly to Step 3 using Step 1 output"
                  >
                    {isSkipping ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <SkipForward className="h-4 w-4 mr-1" />
                    )}
                    Skip to Step 3
                  </Button>
                )}
                
                {/* Settings badges next to Start button */}
                <div className="flex items-center gap-1.5">
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0.5 flex items-center gap-1">
                    <AspectRatioPreview ratio={localRatio} size="sm" />
                    {localRatio}
                  </Badge>
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0.5">
                    {localQuality}
                  </Badge>
                  {currentStep >= 2 && outputCount > 1 && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0.5">
                      ×{outputCount}
                    </Badge>
                  )}
                </div>
              </>
            )}

            {/* Try Again button - shown when failed OR has rejected output */}
            {canRetry && !isRunning && (
              <AlertDialog open={tryAgainConfirmOpen} onOpenChange={setTryAgainConfirmOpen}>
                <AlertDialogTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-amber-500 text-amber-600 hover:bg-amber-500/10"
                    disabled={isRetrying || isStarting}
                  >
                    {isRetrying ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4 mr-1" />
                    )}
                    Try Again
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle className="flex items-center gap-2">
                      <RefreshCw className="h-5 w-5 text-amber-500" />
                      Re-run Step {currentStep}?
                    </AlertDialogTitle>
                    <AlertDialogDescription className="space-y-2">
                      <p>This will create a new attempt for Step {currentStep} using the same settings:</p>
                      <ul className="list-disc list-inside text-sm text-muted-foreground">
                        <li>Aspect Ratio: {localRatio}</li>
                        <li>Output Quality: {localQuality}</li>
                      </ul>
                      <p className="text-sm">Previous attempts will be preserved in the step history.</p>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-amber-500 text-white hover:bg-amber-600"
                      onClick={(e) => {
                        e.preventDefault();
                        handleTryAgain();
                      }}
                      disabled={isRetrying}
                    >
                      {isRetrying ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Retrying...
                        </>
                      ) : (
                        "Run Again"
                      )}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}

            {isWaitingApproval && (
              <>
                <Button
                  size="sm"
                  variant="default"
                  className="bg-green-600 hover:bg-green-700"
                  onClick={() => handleReviewAction("approved")}
                >
                  <ThumbsUp className="h-4 w-4 mr-1" />
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive border-destructive hover:bg-destructive/10"
                  onClick={() => handleReviewAction("rejected")}
                >
                  <ThumbsDown className="h-4 w-4 mr-1" />
                  Reject
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    const stepMatch = pipeline.status.match(/step(\d)/);
                    const step = stepMatch ? parseInt(stepMatch[1]) : 1;
                    loadCompareImages(step);
                  }}
                  disabled={loadingCompare}
                >
                  {loadingCompare ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <Eye className="h-4 w-4 mr-1" />
                  )}
                  Compare
                </Button>
                {/* Skip to Next Step - available for any step when it has valid output */}
                {canSkipToNextStep && onSkipToStep && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={handleSkipToNextStep}
                    disabled={isSkipping}
                    title={`Approve Step ${currentStep} and proceed to Step ${currentStep + 1}`}
                  >
                    {isSkipping ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <SkipForward className="h-4 w-4 mr-1" />
                    )}
                    Skip to Step {currentStep + 1}
                  </Button>
                )}
              </>
            )}

            {/* Go Back to Previous Step button */}
            {canGoBack && onGoBackToStep && (
              <AlertDialog open={goBackDialogOpen} onOpenChange={setGoBackDialogOpen}>
                <AlertDialogTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-amber-600 hover:text-amber-700 hover:bg-amber-500/10"
                    disabled={isGoingBack || isLocalGoingBack}
                  >
                    {(isGoingBack || isLocalGoingBack) ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <ArrowLeft className="h-4 w-4 mr-1" />
                    )}
                    Back to Step {currentStep - 1}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle className="flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5 text-amber-500" />
                      Go Back to Step {currentStep - 1}?
                    </AlertDialogTitle>
                    <AlertDialogDescription className="space-y-2">
                      <p>This will <strong className="text-destructive">permanently delete</strong> all outputs from Step {currentStep - 1} onwards:</p>
                      <ul className="list-disc list-inside text-sm text-muted-foreground">
                        {Array.from({ length: 5 - currentStep }, (_, i) => currentStep + i).filter(s => s <= 4).map(step => (
                          <li key={step}>Step {step} outputs will be removed</li>
                        ))}
                        <li key="creations">Affected outputs will be removed from Creations</li>
                      </ul>
                      <p className="text-sm text-destructive font-medium">This action cannot be undone.</p>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={isLocalGoingBack}>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-amber-500 text-white hover:bg-amber-600"
                      onClick={(e) => {
                        e.preventDefault();
                        handleGoBack();
                      }}
                      disabled={isLocalGoingBack}
                    >
                      {isLocalGoingBack ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Going Back...
                        </>
                      ) : (
                        <>
                          <ArrowLeft className="h-4 w-4 mr-2" />
                          Go Back
                        </>
                      )}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}

            {/* Use as Panorama button - shown when pipeline is completed */}
            {pipeline.status === "completed" && onAttachToPanoramas && (
              <Button
                size="sm"
                variant="outline"
                className="border-primary text-primary hover:bg-primary/10"
                onClick={() => {
                  // Get the final step output (step 5 if available, else step 3)
                  const finalOutputId = getStepOutputId(5) || getStepOutputId(3);
                  if (finalOutputId) {
                    onAttachToPanoramas(pipeline.id, finalOutputId);
                  }
                }}
                disabled={isAttaching}
              >
                {isAttaching ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <ImagePlus className="h-4 w-4 mr-1" />
                )}
                Use as Panorama
              </Button>
            )}

            {/* Terminal button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setTerminalOpen(!terminalOpen)}
            >
              <Terminal className="h-4 w-4 mr-1" />
              {terminalOpen ? "Hide Log" : "View Log"}
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? (
                <>
                  <ChevronUp className="h-4 w-4 mr-1" />
                  Hide Details
                </>
              ) : (
                <>
                  <ChevronDown className="h-4 w-4 mr-1" />
                  View Details
                </>
              )}
            </Button>

            {/* Start Over button */}
            {onResetPipeline && pipeline.status !== "completed" && (
              <AlertDialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    disabled={isResetting || isLocalResetting}
                  >
                    {(isResetting || isLocalResetting) ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <RotateCcw className="h-4 w-4 mr-1" />
                    )}
                    Start Over
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle className="flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5 text-destructive" />
                      Reset Pipeline?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      This will delete all current pipeline progress and outputs. The original floor plan will be kept. You will start fresh from Step 1.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={isLocalResetting}>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={async (e) => {
                        e.preventDefault();
                        if (isLocalResetting) return; // Guard against duplicate clicks
                        
                        setIsLocalResetting(true);
                        try {
                          await onResetPipeline(pipeline.id);
                          // Reset local state after successful reset
                          setLocalQuality("2K");
                          setLocalRatio("16:9");
                          setExpanded(false);
                          setTerminalOpen(false);
                          toast({ title: "Pipeline reset complete" });
                          // Close dialog after success
                          setResetDialogOpen(false);
                        } catch (error) {
                          console.error("Failed to reset pipeline:", error);
                          toast({ 
                            title: "Reset failed", 
                            description: error instanceof Error ? error.message : "Unknown error",
                            variant: "destructive" 
                          });
                        } finally {
                          setIsLocalResetting(false);
                        }
                      }}
                      disabled={isLocalResetting}
                    >
                      {isLocalResetting ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Resetting...
                        </>
                      ) : (
                        "Yes, Reset Pipeline"
                      )}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}

            {/* Delete Pipeline button */}
            {onDeletePipeline && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    disabled={isDeleting}
                  >
                    {isDeleting ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4 mr-1" />
                    )}
                    Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle className="flex items-center gap-2">
                      <Trash2 className="h-5 w-5 text-destructive" />
                      Delete Pipeline?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently delete this pipeline and all its outputs, events, and reviews. This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={async (e) => {
                        e.preventDefault();
                        console.log(`[Pipeline] Deleting pipeline: ${pipeline.id}`);
                        try {
                          await onDeletePipeline(pipeline.id);
                        } catch (error) {
                          console.error("Failed to delete pipeline:", error);
                        }
                      }}
                      disabled={isDeleting}
                    >
                      {isDeleting ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Deleting...
                        </>
                      ) : (
                        "Yes, Delete Pipeline"
                      )}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>

          {/* Pipeline Terminal */}
          <FloorPlanPipelineTerminal
            pipelineId={pipeline.id}
            isOpen={terminalOpen}
            stepFilter={terminalStepFilter}
          />

          {/* Step Outputs Section */}
          <PipelineStepOutputs
            pipelineId={pipeline.id}
            floorPlanUploadId={pipeline.floor_plan_upload_id}
            stepOutputs={(pipeline.step_outputs as Record<string, any>) || {}}
            currentStep={currentStep}
            onUpdateStepSettings={(stepNumber, quality, ratio) => {
              if (onUpdateSettings) {
                onUpdateSettings(pipeline.id, quality, ratio);
              }
            }}
          />

          {/* Expanded details */}
          {expanded && (
            <div className="border-t border-border pt-3 mt-3 space-y-3">
              {/* Step details */}
              {[1, 2, 3, 4, 5].map((step) => {
                const outputId = getStepOutputId(step);
                const qa = getStepQA(step);
                const stepReviews = reviews?.filter(r => r.step_number === step) || [];
                const isCurrentStep = currentStep === step;
                const isStepComplete = currentStep > step || (isCurrentStep && isWaitingApproval);
                
                return (
                  <div key={step} className={`p-3 rounded-lg ${isCurrentStep ? "bg-muted/50" : "bg-muted/20"}`}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-sm">Step {step}: {STEP_NAMES[step - 1]}</span>
                      <div className="flex items-center gap-2">
                        {qa.decision && (
                          <Badge className={qa.decision === "approved" ? "bg-green-500/20 text-green-400" : "bg-yellow-500/20 text-yellow-400"}>
                            {qa.decision === "approved" ? <ThumbsUp className="h-3 w-3 mr-1" /> : <ThumbsDown className="h-3 w-3 mr-1" />}
                            QA {qa.decision}
                          </Badge>
                        )}
                        {outputId && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2"
                            onClick={() => loadCompareImages(step)}
                            disabled={loadingCompare}
                          >
                            <Eye className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </div>
                    
                    {qa.reason && (
                      <p className="text-xs text-muted-foreground mb-2">{qa.reason}</p>
                    )}
                    
                    {stepReviews.length > 0 && (
                      <div className="space-y-1">
                        {stepReviews.map((review) => (
                          <div key={review.id} className={`text-xs px-2 py-1 rounded ${review.decision === "approved" ? "bg-green-500/10" : "bg-destructive/10"}`}>
                            <span className="font-medium">{review.decision}</span>
                            {review.notes && <span className="ml-2 text-muted-foreground">{review.notes}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Event log */}
              {events && events.length > 0 && (
                <div className="space-y-1">
                  <Label className="text-xs">Pipeline Log</Label>
                  <ScrollArea className="h-32 w-full rounded border border-border bg-black/50 p-2">
                    <div className="font-mono text-xs space-y-0.5">
                      {events.map((event) => (
                        <div key={event.id} className="flex gap-2">
                          <span className="text-muted-foreground">
                            {format(new Date(event.ts), "HH:mm:ss")}
                          </span>
                          <span className={`
                            ${event.type.includes("error") || event.type.includes("failed") ? "text-destructive" : ""}
                            ${event.type.includes("complete") ? "text-green-400" : ""}
                            ${event.type.includes("start") ? "text-blue-400" : ""}
                          `}>
                            [{event.type}]
                          </span>
                          <span className="text-foreground">{event.message}</span>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Compare Dialog */}
      <Dialog open={compareOpen} onOpenChange={setCompareOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              Step {compareStep} - Before / After
            </DialogTitle>
          </DialogHeader>
          {beforeUrl && afterUrl ? (
            <BeforeAfterSlider
              beforeImage={beforeUrl}
              afterImage={afterUrl}
              beforeLabel={compareStep === 1 ? "Floor Plan" : `Step ${compareStep! - 1} Output`}
              afterLabel={`Step ${compareStep} Output`}
            />
          ) : (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Camera Position Dialog for Step 4 */}
      <Dialog open={cameraDialogOpen} onOpenChange={setCameraDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5" />
              Camera Position for 360° Panorama
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Camera Position</Label>
              <Input
                placeholder="e.g., center of living room rug, near kitchen counter"
                value={cameraPosition}
                onChange={(e) => setCameraPosition(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Describe exact location in the room</p>
            </div>
            <div className="space-y-2">
              <Label>Forward Direction (0° yaw)</Label>
              <Input
                placeholder="e.g., facing sofa and coffee table, toward dining table"
                value={forwardDirection}
                onChange={(e) => setForwardDirection(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Describe what the camera should face by default</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCameraDialogOpen(false)}>Cancel</Button>
            <Button 
              onClick={handleCameraSubmit}
              disabled={!cameraPosition.trim() || !forwardDirection.trim() || isStarting}
            >
              {isStarting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
              Start Panorama Generation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Review Dialog */}
      <Dialog open={reviewDialogOpen} onOpenChange={setReviewDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pendingDecision === "approved" ? "Approve Step" : "Reject Step"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{pendingDecision === "rejected" ? "Rejection Reason (required)" : "Notes (optional)"}</Label>
              <Textarea
                placeholder={pendingDecision === "rejected" 
                  ? "Describe what's wrong and how it should be fixed..."
                  : "Add any notes about this decision..."
                }
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.target.value)}
              />
              {pendingDecision === "rejected" && (
                <p className="text-xs text-muted-foreground">
                  AI will generate an improved prompt based on your feedback
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewDialogOpen(false)}>Cancel</Button>
            <Button 
              onClick={handleSubmitReview}
              variant={pendingDecision === "approved" ? "default" : "destructive"}
              disabled={pendingDecision === "rejected" && !reviewNotes.trim()}
            >
              {isOptimizing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Generating improved prompt...
                </>
              ) : (
                pendingDecision === "approved" ? "Confirm Approval" : "Reject & Generate New Prompt"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Confirmation Dialog - Re-render vs Skip & Approve */}
      <Dialog open={rejectConfirmDialogOpen} onOpenChange={setRejectConfirmDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Reject Output
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Do you want to send this step back to re-render using the previous Ratio and Quality settings?
            </p>
            <div className="p-3 bg-muted/50 rounded-lg">
              <Label className="text-xs text-muted-foreground mb-1 block">Your rejection reason:</Label>
              <p className="text-sm">{reviewNotes}</p>
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setRejectConfirmDialogOpen(false)} disabled={isRerendering}>
              Cancel
            </Button>
            <Button 
              variant="secondary" 
              onClick={handleSkipAndApprove}
              disabled={isRerendering}
            >
              {isRerendering ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Check className="h-4 w-4 mr-2" />
              )}
              Skip & Approve
            </Button>
            <Button 
              variant="default"
              onClick={handleRejectRerender}
              disabled={isRerendering || isOptimizing}
            >
              {isRerendering || isOptimizing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Re-render
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Improved Prompt Dialog */}
      <Dialog open={improvedPromptDialogOpen} onOpenChange={setImprovedPromptDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wand2 className="h-5 w-5 text-primary" />
              AI-Generated Improved Prompt
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="p-4 bg-muted/50 rounded-lg">
              <Label className="text-xs text-muted-foreground mb-2 block">Rejection Reason</Label>
              <p className="text-sm">{reviewNotes}</p>
            </div>
            <div className="space-y-2">
              <Label>Improved Prompt</Label>
              <Textarea
                value={improvedPrompt || ""}
                onChange={(e) => setImprovedPrompt(e.target.value)}
                className="min-h-[150px]"
              />
              <p className="text-xs text-muted-foreground">
                You can edit this prompt before applying it to retry the step
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setImprovedPromptDialogOpen(false);
              setImprovedPrompt(null);
              setPendingRejectionStep(null);
            }}>
              Cancel
            </Button>
            <Button onClick={handleApplyImprovedPrompt}>
              <Check className="h-4 w-4 mr-2" />
              Apply & Retry Step
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Step 2 Reference Selection Modal */}
      <Step2ReferenceSelectionModal
        isOpen={refSelectionModalOpen}
        onClose={() => setRefSelectionModalOpen(false)}
        references={step2Refs}
        onContinue={handleStep2WithRefs}
        onRunWithoutRefs={handleStep2WithoutRefs}
      />
    </>
  );
});

export const FloorPlanPipelineCard = FloorPlanPipelineCardInner;
