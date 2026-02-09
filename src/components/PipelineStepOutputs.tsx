import { useState, useEffect, useRef, useCallback, memo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { BeforeAfterSlider } from "@/components/BeforeAfterSlider";
import { AspectRatioPreview, AspectRatioSelectItemContent } from "@/components/AspectRatioPreview";
import { useStorage } from "@/hooks/useStorage";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Eye, ThumbsUp, ThumbsDown, Image as ImageIcon, Maximize2, X, FileText, Copy, Check } from "lucide-react";
interface SingleOutput {
  output_upload_id: string;
  qa_decision?: string;
  qa_reason?: string;
  prompt_used?: string;
  camera_angle?: string;
  approval_status?: string;
  variation_index?: number;
}

interface StepOutput {
  output_upload_id?: string; // Single output (backward compat)
  outputs?: SingleOutput[]; // Multi-output array
  qa_decision?: string;
  qa_reason?: string;
  aspect_ratio?: string;
  output_quality?: string;
  used_preset_ids?: string[];
  last_preset_id?: string;
  design_ref_upload_ids?: string[];
  style_transfer_applied?: boolean;
  prompt_used?: string;
  camera_angle?: string;
  camera_position?: string;
  forward_direction?: string;
  style_title?: string;
  output_count?: number;
}

interface PipelineStepOutputsProps {
  pipelineId: string;
  floorPlanUploadId: string;
  stepOutputs: Record<string, StepOutput>;
  currentStep: number;
  onUpdateStepSettings?: (stepNumber: number, outputResolution: string, aspectRatio: string) => void;
}

const STEP_NAMES = [
  "2D → Top-Down 3D",
  "Style Interior",
  "Camera-Angle Render",
  "360° Panorama"
];

function PipelineStepOutputsComponent({
  pipelineId,
  floorPlanUploadId,
  stepOutputs,
  currentStep,
  onUpdateStepSettings
}: PipelineStepOutputsProps) {
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [loadingImages, setLoadingImages] = useState<Set<string>>(new Set());
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareStep, setCompareStep] = useState<number | null>(null);
  const [beforeUrl, setBeforeUrl] = useState<string>("");
  const [afterUrl, setAfterUrl] = useState<string>("");
  const [stepSettings, setStepSettings] = useState<Record<number, { quality: string; ratio: string }>>({});
  // Focused image viewer state (single image, not compare)
  const [focusedImageUrl, setFocusedImageUrl] = useState<string | null>(null);
  const [focusedStep, setFocusedStep] = useState<number | null>(null);
  // Prompt copy state
  const [copiedPrompt, setCopiedPrompt] = useState<number | null>(null);

  const { getSignedViewUrl } = useStorage();

  // Track what we've already loaded to prevent re-fetching
  const loadedIdsRef = useRef<Set<string>>(new Set());
  const loadingRef = useRef<Set<string>>(new Set());
  const isMountedRef = useRef(true);

  // Collect all IDs that need loading
  const getUploadIdsToLoad = useCallback(() => {
    const ids: string[] = [floorPlanUploadId];
    for (const [stepKey, output] of Object.entries(stepOutputs)) {
      if (output?.output_upload_id) {
        ids.push(output.output_upload_id);
      }
      // Multi-output support
      if (output?.outputs && Array.isArray(output.outputs)) {
        for (const o of output.outputs) {
          if (o?.output_upload_id) {
            ids.push(o.output_upload_id);
          }
        }
      }
    }
    return ids;
  }, [floorPlanUploadId, stepOutputs]);

  // Load a single image
  const loadImage = useCallback(async (uploadId: string) => {
    // Skip if already loaded or currently loading
    if (loadedIdsRef.current.has(uploadId) || loadingRef.current.has(uploadId)) {
      return;
    }

    loadingRef.current.add(uploadId);
    setLoadingImages(prev => new Set(prev).add(uploadId));

    try {
      const { data: upload } = await supabase
        .from("uploads")
        .select("bucket, path")
        .eq("id", uploadId)
        .is("deleted_at", null)
        .single();

      if (upload && isMountedRef.current) {
        const result = await getSignedViewUrl(upload.bucket, upload.path);
        if (result.signedUrl && isMountedRef.current) {
          loadedIdsRef.current.add(uploadId);
          setImageUrls(prev => ({ ...prev, [uploadId]: result.signedUrl }));
        }
      }
    } catch (error) {
      console.error(`Failed to load image ${uploadId}:`, error);
    } finally {
      loadingRef.current.delete(uploadId);
      if (isMountedRef.current) {
        setLoadingImages(prev => {
          const next = new Set(prev);
          next.delete(uploadId);
          return next;
        });
      }
    }
  }, [getSignedViewUrl]);

  // Load images when stepOutputs change - but only new ones
  useEffect(() => {
    isMountedRef.current = true;

    const idsToLoad = getUploadIdsToLoad();
    // Filter to only IDs not yet loaded
    const newIds = idsToLoad.filter(id => !loadedIdsRef.current.has(id));

    // Load new IDs with small stagger to avoid overwhelming backend
    newIds.forEach((id, index) => {
      setTimeout(() => {
        if (isMountedRef.current) {
          loadImage(id);
        }
      }, index * 100); // 100ms stagger
    });

    return () => {
      isMountedRef.current = false;
    };
  }, [getUploadIdsToLoad, loadImage]);

  const handleCompare = async (step: number) => {
    setCompareStep(step);

    // Get before and after images
    let beforeId: string;
    const afterId = stepOutputs[`step${step}`]?.output_upload_id;

    if (step === 1) {
      beforeId = floorPlanUploadId;
    } else {
      const prevOutput = stepOutputs[`step${step - 1}`];
      beforeId = prevOutput?.output_upload_id || floorPlanUploadId;
    }

    const before = imageUrls[beforeId];
    const after = afterId ? imageUrls[afterId] : undefined;

    if (before && after) {
      setBeforeUrl(before);
      setAfterUrl(after);
      setCompareOpen(true);
    }
  };

  // Steps that produce outputs - include all 4 steps, handle both single and multi-output formats
  const completedSteps = [1, 2, 3, 4].filter(step => {
    const output = stepOutputs[`step${step}`];
    return output?.output_upload_id || (output?.outputs && output.outputs.length > 0);
  });

  if (completedSteps.length === 0) {
    return null;
  }

  // Render a single output card (used for both single and multi-output)
  const renderOutputCard = (
    step: number,
    output: SingleOutput,
    outputIndex: number,
    isMultiOutput: boolean,
    stepData: StepOutput
  ) => {
    const imageUrl = output.output_upload_id ? imageUrls[output.output_upload_id] : null;
    const isLoading = output.output_upload_id ? loadingImages.has(output.output_upload_id) : false;
    const qaDecision = output.qa_decision || output.approval_status;
    const isRejected = qaDecision === "rejected";
    const isApproved = qaDecision === "approved";

    return (
      <Card
        key={`${step}-${outputIndex}`}
        className={`overflow-hidden flex flex-col ${isRejected ? "border-red-500/50" : isApproved ? "border-green-500/30" : ""}`}
      >
        <CardHeader className="p-3 pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm truncate">
              {STEP_NAMES[step - 1]}
              {isMultiOutput && <span className="text-muted-foreground ml-1">#{outputIndex + 1}</span>}
            </CardTitle>
            {qaDecision && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="shrink-0">
                      {isApproved ? (
                        <ThumbsUp className="h-4 w-4 text-green-500" />
                      ) : (
                        <ThumbsDown className="h-4 w-4 text-red-500" />
                      )}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {isApproved ? "QA Approved" : "QA Rejected"}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
          {/* Ratio + Quality metadata */}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {stepData?.aspect_ratio && (
              <Badge variant="outline" className="text-[10px] flex items-center gap-1 px-1.5">
                <AspectRatioPreview ratio={stepData.aspect_ratio} size="sm" />
                <span>{stepData.aspect_ratio}</span>
              </Badge>
            )}
            {stepData?.output_quality && (
              <Badge variant="outline" className="text-[10px]">
                {stepData.output_quality}
              </Badge>
            )}
            {/* Camera angle for multi-output Step 3 */}
            {output.camera_angle && (
              <Badge variant="secondary" className="text-[10px]">
                {output.camera_angle}
              </Badge>
            )}
            {/* Step 2 Style indicator */}
            {step === 2 && stepData?.style_title && (
              <Badge className="bg-primary/20 text-primary text-[10px]">
                Style: {stepData.style_title}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-3 pt-0 space-y-3 flex-1 flex flex-col">
          {/* Image preview with expand button */}
          <div className="aspect-video bg-muted rounded-lg overflow-hidden flex items-center justify-center relative group">
            {isLoading ? (
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            ) : imageUrl ? (
              <>
                <img
                  src={imageUrl}
                  alt={`Step ${step} output ${outputIndex + 1}`}
                  className="w-full h-full object-cover"
                  loading="lazy"
                  decoding="async"
                />
                {/* Expand button */}
                <Button
                  size="icon"
                  variant="secondary"
                  className="absolute top-2 right-2 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => {
                    setFocusedImageUrl(imageUrl);
                    setFocusedStep(step);
                  }}
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                </Button>
              </>
            ) : (
              <ImageIcon className="h-8 w-8 text-muted-foreground" />
            )}
          </div>

          {/* Compact action buttons for viewing details in modals */}
          <div className="flex items-center gap-1 flex-wrap">
            {/* Prompt button - show for all outputs that have a prompt */}
            {output.prompt_used && (
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2">
                    <FileText className="h-3 w-3 mr-1" />
                    Prompt
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>Step {step} Output {outputIndex + 1} - Prompt Used</DialogTitle>
                  </DialogHeader>
                  <div className="relative p-3 bg-muted/50 rounded max-h-80 overflow-y-auto">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="absolute top-2 right-2 h-6 w-6"
                      onClick={() => {
                        navigator.clipboard.writeText(output.prompt_used || "");
                        setCopiedPrompt(step * 10 + outputIndex);
                        setTimeout(() => setCopiedPrompt(null), 2000);
                      }}
                    >
                      {copiedPrompt === step * 10 + outputIndex ? (
                        <Check className="h-3.5 w-3.5 text-green-500" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </Button>
                    <pre className="whitespace-pre-wrap font-mono text-xs text-muted-foreground pr-8">
                      {output.prompt_used}
                    </pre>
                    {output.camera_angle && (
                      <Badge variant="outline" className="mt-3 text-xs">
                        Camera: {output.camera_angle}
                      </Badge>
                    )}
                  </div>
                </DialogContent>
              </Dialog>
            )}
            {/* Rejection reason button - show for rejected outputs with a reason */}
            {isRejected && output.qa_reason && (
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2 text-red-500 hover:text-red-600">
                    <ThumbsDown className="h-3 w-3 mr-1" />
                    Reason
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle className="text-red-500 flex items-center gap-2">
                      <ThumbsDown className="h-4 w-4" />
                      QA Rejection Reason
                    </DialogTitle>
                  </DialogHeader>
                  <p className="text-sm text-muted-foreground">{output.qa_reason}</p>
                </DialogContent>
              </Dialog>
            )}
          </div>

          {/* Compare button - pushed to bottom (only for first output or single output) */}
          {outputIndex === 0 && (
            <div className="mt-auto">
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={() => handleCompare(step)}
              >
                <Eye className="h-3 w-3 mr-1" />
                Compare
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <>
      <div className="space-y-3">
        <Label className="text-sm font-medium">Step Outputs</Label>
        {/* Grid with no extra gaps - cards align cleanly */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 auto-rows-fr">
          {completedSteps.flatMap((step) => {
            const stepData = stepOutputs[`step${step}`];

            // Multi-output format (Steps 2, 3, 4 can have arrays)
            if (stepData?.outputs && Array.isArray(stepData.outputs) && stepData.outputs.length > 0) {
              return stepData.outputs.map((output: SingleOutput, idx: number) =>
                renderOutputCard(step, output, idx, true, stepData)
              );
            }

            // Single-output format (backward compat)
            if (stepData?.output_upload_id) {
              const singleOutput: SingleOutput = {
                output_upload_id: stepData.output_upload_id,
                qa_decision: stepData.qa_decision,
                qa_reason: stepData.qa_reason,
                prompt_used: stepData.prompt_used,
                camera_angle: stepData.camera_angle,
                variation_index: 0
              };
              return [renderOutputCard(step, singleOutput, 0, false, stepData)];
            }

            return [];
          })}
        </div>
      </div>

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

      {/* Focused Image Viewer - single image, full size */}
      <Dialog open={!!focusedImageUrl} onOpenChange={(open) => !open && setFocusedImageUrl(null)}>
        <DialogContent className="max-w-5xl max-h-[90vh] p-0 overflow-hidden">
          <DialogHeader className="absolute top-0 left-0 right-0 z-10 bg-gradient-to-b from-black/60 to-transparent p-4">
            <DialogTitle className="text-white">
              {focusedStep ? `${STEP_NAMES[focusedStep - 1]} - Output` : "Image"}
            </DialogTitle>
          </DialogHeader>
          <button
            onClick={() => setFocusedImageUrl(null)}
            className="absolute top-4 right-4 z-10 p-2 rounded-full bg-black/40 hover:bg-black/60 text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
          {focusedImageUrl && (
            <div className="w-full h-full flex items-center justify-center bg-black">
              <img
                src={focusedImageUrl}
                alt="Full size output"
                className="max-w-full max-h-[90vh] object-contain"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export const PipelineStepOutputs = memo(PipelineStepOutputsComponent);
