import React, { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Copy, Check, XCircle, CheckCircle2, Info, FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { QAVerdict } from "@/hooks/useFloorplanStepAttempt";
import { StructuredQAExplanation, type QAExplanationData } from "./StructuredQAExplanation";

interface QAReport {
  score?: number;
  pass?: boolean;
  issues?: Array<{ description?: string } | string>;
  visual_observations?: string;
  structural_notes?: string;
  camera_fidelity_notes?: string;
  reason?: string;
  summary?: string;
  // NEW: Structured explanation
  qa_explanation?: QAExplanationData;
}

interface AssetInfo {
  id: string;
  uploadId?: string;
  resolution?: { width: number; height: number };
  fileSize?: number;
  model?: string;
  attemptIndex?: number;
  /** Full prompt sent to the model (must be unmodified, untruncated) */
  promptFinalSentToModel?: string;
  qaReport?: QAReport | unknown;
  qaStatus?: string;
  /** Single authoritative QA verdict for the UI */
  qaVerdict?: QAVerdict;
  /** Raw per-image QA reason text (preferred for rejected state) */
  qaReasonText?: string | null;
  /** Structured QA explanation (NEW) */
  qaExplanation?: QAExplanationData | null;
}

interface QADetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  asset: AssetInfo;
  beforeUploadId?: string;
  stepNumber: number;
}

function formatResolution(width: number, height: number): string {
  return `${width} × ${height}`;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

export function QADetailsDialog({
  open,
  onOpenChange,
  title,
  asset,
  beforeUploadId,
  stepNumber,
}: QADetailsDialogProps) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const qaReport = asset.qaReport as QAReport | undefined;
  const promptText = asset.promptFinalSentToModel || "";

  const qaVerdict: QAVerdict = asset.qaVerdict || "PENDING";

  const handleCopyPrompt = async () => {
    if (!promptText) return;
    
    try {
      await navigator.clipboard.writeText(promptText);
      setCopied(true);
      toast({
        title: "Copied",
        description: "Full prompt copied to clipboard",
      });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        title: "Copy failed",
        description: "Could not copy to clipboard",
        variant: "destructive",
      });
    }
  };

  // Get structured QA explanation (prefer from qaReport.qa_explanation, then asset.qaExplanation)
  const structuredExplanation: QAExplanationData | null = useMemo(() => {
    // First check if qaReport has the new structured format
    if (qaReport?.qa_explanation) {
      return qaReport.qa_explanation;
    }
    
    // Then check asset-level explanation
    if (asset.qaExplanation) {
      return asset.qaExplanation;
    }
    
    // Build a fallback from legacy data
    if (qaReport) {
      const legacyExplanation: QAExplanationData = {
        verdict: qaVerdict === "APPROVED" ? "approved" : qaVerdict === "REJECTED" ? "rejected" : "pending",
        confidence: qaReport.score ? qaReport.score / 100 : 0.5,
        summary: qaReport.summary || qaReport.reason || asset.qaReasonText || "See details below",
        architecture_checks: qaReport.structural_notes ? [{
          check: "Structure",
          result: "pass",
          evidence: qaReport.structural_notes,
        }] : undefined,
        materials_checks: qaReport.visual_observations ? [{
          check: "Visual quality",
          result: "pass",
          evidence: typeof qaReport.visual_observations === "string" 
            ? qaReport.visual_observations 
            : "Visual checks performed",
        }] : undefined,
        furniture_checks: undefined,
        scale_and_layout: undefined,
        artifacts_and_ai_issues: qaReport.camera_fidelity_notes ? [{
          check: "Camera fidelity",
          result: "pass",
          evidence: qaReport.camera_fidelity_notes,
        }] : undefined,
        rejection_reasons: qaVerdict === "REJECTED" && asset.qaReasonText 
          ? [asset.qaReasonText] 
          : undefined,
      };
      return legacyExplanation;
    }
    
    return null;
  }, [qaReport, asset.qaExplanation, asset.qaReasonText, qaVerdict]);

  const qaScore = qaReport?.score;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{title} Details</DialogTitle>
          <DialogDescription>
            Full QA traceability and prompt visibility
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="overview" className="flex-1 flex flex-col min-h-0">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="overview" className="gap-2">
              <Info className="w-4 h-4" />
              Overview / QA Summary
            </TabsTrigger>
            <TabsTrigger value="prompt" className="gap-2">
              <FileText className="w-4 h-4" />
              Full Prompt
            </TabsTrigger>
          </TabsList>

          {/* Overview / QA Summary Tab */}
          <TabsContent value="overview" className="flex-1 overflow-hidden mt-4">
            <ScrollArea className="h-[400px] pr-4">
              <div className="space-y-6">
                {/* QA Decision */}
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold flex items-center gap-2">
                    QA Decision
                    <Badge
                      variant={
                        qaVerdict === "APPROVED"
                          ? "default"
                          : qaVerdict === "REJECTED"
                            ? "destructive"
                            : "outline"
                      }
                    >
                      {qaVerdict}
                    </Badge>
                  </h4>
                  
                  {qaScore !== undefined && (
                    <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg">
                      <span className="text-muted-foreground text-sm">QA Score</span>
                      <span className="font-mono text-lg font-semibold">{qaScore}/100</span>
                    </div>
                  )}
                </div>

                {/* Structured QA Explanation (NEW) */}
                {qaVerdict !== "PENDING" && (
                  <StructuredQAExplanation explanation={structuredExplanation} />
                )}

                {/* Quality Metadata */}
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold">Quality Metadata</h4>
                  <div className="grid grid-cols-2 gap-2">
                    {asset.resolution && (
                      <div className="flex justify-between p-3 bg-muted/30 rounded-lg">
                        <span className="text-muted-foreground text-sm">Resolution</span>
                        <span className="font-mono text-sm">
                          {formatResolution(asset.resolution.width, asset.resolution.height)}
                        </span>
                      </div>
                    )}
                    {asset.fileSize && (
                      <div className="flex justify-between p-3 bg-muted/30 rounded-lg">
                        <span className="text-muted-foreground text-sm">File Size</span>
                        <span className="font-mono text-sm">{formatBytes(asset.fileSize)}</span>
                      </div>
                    )}
                    {asset.model && (
                      <div className="flex justify-between p-3 bg-muted/30 rounded-lg col-span-2">
                        <span className="text-muted-foreground text-sm">Model</span>
                        <span className="font-mono text-xs">{asset.model}</span>
                      </div>
                    )}
                    {asset.attemptIndex !== undefined && asset.attemptIndex > 0 && (
                      <div className="flex justify-between p-3 bg-muted/30 rounded-lg">
                        <span className="text-muted-foreground text-sm">Attempt</span>
                        <span className="font-mono">#{asset.attemptIndex}</span>
                      </div>
                    )}
                    <div className="flex justify-between p-3 bg-muted/30 rounded-lg">
                      <span className="text-muted-foreground text-sm">Step</span>
                      <span className="font-mono">Step {stepNumber}</span>
                    </div>
                  </div>
                </div>

                {/* Traceability */}
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold">Traceability</h4>
                  <div className="space-y-2">
                    <div className="flex justify-between p-3 bg-muted/30 rounded-lg">
                      <span className="text-muted-foreground text-sm">Asset ID</span>
                      <span className="font-mono text-xs">{asset.id}</span>
                    </div>
                    {asset.uploadId && (
                      <div className="flex justify-between p-3 bg-muted/30 rounded-lg">
                        <span className="text-muted-foreground text-sm">Upload ID</span>
                        <span className="font-mono text-xs">{asset.uploadId}</span>
                      </div>
                    )}
                    {beforeUploadId && (
                      <div className="flex justify-between p-3 bg-muted/30 rounded-lg">
                        <span className="text-muted-foreground text-sm">Source ID</span>
                        <span className="font-mono text-xs">{beforeUploadId}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </ScrollArea>
          </TabsContent>

          {/* Full Prompt Tab */}
          <TabsContent value="prompt" className="flex-1 overflow-hidden mt-4">
            <div className="flex flex-col h-[400px]">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold">
                  Final Prompt Sent to Model
                </h4>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleCopyPrompt}
                  disabled={!promptText}
                  className="gap-2"
                >
                  {copied ? (
                    <>
                      <Check className="w-4 h-4" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      Copy Full Prompt
                    </>
                  )}
                </Button>
              </div>

              {promptText ? (
                <ScrollArea className="flex-1 border rounded-lg bg-muted/20">
                  <pre className="p-4 text-sm font-mono whitespace-pre-wrap leading-relaxed">
                    {promptText}
                  </pre>
                </ScrollArea>
              ) : (
                <div className="flex-1 flex items-center justify-center border rounded-lg bg-muted/10">
                  <div className="text-center text-muted-foreground">
                    <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No prompt data available</p>
                    <p className="text-xs mt-1">
                      This generation may be missing traceability data
                    </p>
                  </div>
                </div>
              )}

              {!promptText && (
                <div className="mt-3 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                  <p className="text-xs text-destructive-foreground">
                    ⚠️ Warning: This output is non-debuggable. The exact prompt sent to the model is not available.
                  </p>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
