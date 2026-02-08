import { memo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Bug, ChevronDown, ChevronRight, AlertTriangle, RotateCcw } from "lucide-react";
import { validatePipelineState, type PipelineForValidation } from "@/lib/pipelineStateValidator";

interface PipelineDebugPanelProps {
  pipelineId: string;
  currentStep: number;
  phase: string;
  status: string;
  step1ManualApproved: boolean;
  step2ManualApproved: boolean;
  stepRetryState?: Record<string, unknown>;
  stepOutputs?: Record<string, unknown>;
  lastAction?: string;
  // New: state integrity tracking
  lastStateIntegrityFix?: { at: string; reason: string } | null;
  // New: recovery handler
  onRecover?: () => void;
  isRecovering?: boolean;
  // Camera planning visibility
  cameraMarkerCount?: number;
  cameraPlanConfirmedAt?: string | null;
}

/**
 * Debug panel for pipeline state visibility.
 * Shows current_step, phase, status, approval states, and illegal state warnings.
 * 
 * NOTE: This panel is visible in production for project owners until the 
 * pipeline is proven stable (per recovery plan).
 */
export const PipelineDebugPanel = memo(function PipelineDebugPanel({
  pipelineId,
  currentStep,
  phase,
  status,
  step1ManualApproved,
  step2ManualApproved,
  stepRetryState,
  stepOutputs,
  lastAction,
  lastStateIntegrityFix,
  onRecover,
  isRecovering,
  cameraMarkerCount,
  cameraPlanConfirmedAt,
}: PipelineDebugPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  
  // NOTE: DEV-only restriction REMOVED per recovery plan
  // Keep visible in production until pipeline stability is proven

  const step1RetryStatus = (stepRetryState as Record<string, { status?: string }>)?.["step_1"]?.status || "none";
  const step2RetryStatus = (stepRetryState as Record<string, { status?: string }>)?.["step_2"]?.status || "none";
  
  // Extract output_upload_ids for visibility
  const step1OutputId = (stepOutputs as Record<string, { output_upload_id?: string }>)?.step1?.output_upload_id;
  const step2OutputId = (stepOutputs as Record<string, { output_upload_id?: string }>)?.step2?.output_upload_id;
  
  // Validate state
  const pipelineForValidation: PipelineForValidation = {
    id: pipelineId,
    whole_apartment_phase: phase,
    current_step: currentStep,
    step_outputs: stepOutputs as PipelineForValidation["step_outputs"],
    step_retry_state: stepRetryState as PipelineForValidation["step_retry_state"],
    status,
  };
  const validation = validatePipelineState(pipelineForValidation);
  
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-xs text-muted-foreground hover:text-foreground"
        >
          {isOpen ? (
            <ChevronDown className="w-3 h-3 mr-1" />
          ) : (
            <ChevronRight className="w-3 h-3 mr-1" />
          )}
          <Bug className="w-3 h-3 mr-1" />
          Debug Info
          {!validation.isValid && (
            <Badge variant="destructive" className="ml-2 text-[10px] px-1 py-0">
              {validation.illegalStates.length} issues
            </Badge>
          )}
          {lastStateIntegrityFix && (
            <Badge variant="outline" className="ml-1 text-[10px] px-1 py-0 border-orange-500/50 text-orange-400">
              Auto-fixed
            </Badge>
          )}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="p-3 mt-1 rounded-lg border border-border/50 bg-muted/20 text-xs font-mono space-y-2">
          {/* Illegal State Warnings */}
          {!validation.isValid && (
            <div className="border border-destructive/50 rounded p-2 bg-destructive/5 space-y-1.5">
              <p className="text-xs font-bold text-destructive flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                Illegal State Detected
              </p>
              {validation.illegalStates.map((issue, i) => (
                <div key={i} className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <Badge 
                      variant={issue.severity === "critical" ? "destructive" : "outline"}
                      className="text-[10px] px-1 py-0 mr-1"
                    >
                      {issue.severity}
                    </Badge>
                    <span className="text-muted-foreground">{issue.message}</span>
                  </div>
                  {issue.recovery && onRecover && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={onRecover}
                      disabled={isRecovering}
                      className="h-5 text-[10px] px-2"
                    >
                      {isRecovering ? (
                        <RotateCcw className="w-3 h-3 animate-spin" />
                      ) : (
                        "Recover"
                      )}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
          
          {/* State Integrity Auto-Correction Warning */}
          {lastStateIntegrityFix && (
            <div className="border border-orange-500/50 rounded p-2 bg-orange-500/5">
              <p className="text-xs font-bold text-orange-400 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                State Auto-Corrected
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {lastStateIntegrityFix.reason}
              </p>
              <p className="text-[10px] text-muted-foreground/60">
                {new Date(lastStateIntegrityFix.at).toLocaleString()}
              </p>
            </div>
          )}

          {/* Core State Variables */}
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span>
              <span className="text-muted-foreground">pipeline_id: </span>
              <span className="text-foreground">{pipelineId.slice(0, 8)}…</span>
            </span>
            <span>
              <span className="text-muted-foreground">current_step: </span>
              <Badge variant="outline" className="text-xs px-1 py-0">{currentStep}</Badge>
            </span>
          </div>
          
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span>
              <span className="text-muted-foreground">phase: </span>
              <Badge variant="secondary" className="text-xs px-1 py-0">{phase}</Badge>
            </span>
            <span>
              <span className="text-muted-foreground">status: </span>
              <Badge variant="secondary" className="text-xs px-1 py-0">{status}</Badge>
            </span>
          </div>
          
          {/* Approval States */}
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span>
              <span className="text-muted-foreground">step1_approved: </span>
              <Badge 
                variant={step1ManualApproved ? "default" : "outline"} 
                className="text-xs px-1 py-0"
              >
                {step1ManualApproved ? "✓" : "✗"}
              </Badge>
            </span>
            <span>
              <span className="text-muted-foreground">step2_approved: </span>
              <Badge 
                variant={step2ManualApproved ? "default" : "outline"} 
                className="text-xs px-1 py-0"
              >
                {step2ManualApproved ? "✓" : "✗"}
              </Badge>
            </span>
          </div>
          
          {/* Retry States */}
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span>
              <span className="text-muted-foreground">step1_retry: </span>
              <Badge 
                variant={step1RetryStatus === "blocked_for_human" ? "destructive" : "outline"} 
                className="text-xs px-1 py-0"
              >
                {step1RetryStatus}
              </Badge>
            </span>
            <span>
              <span className="text-muted-foreground">step2_retry: </span>
              <Badge 
                variant={step2RetryStatus === "blocked_for_human" ? "destructive" : "outline"} 
                className="text-xs px-1 py-0"
              >
                {step2RetryStatus}
              </Badge>
            </span>
          </div>
          
          {/* Output Upload IDs for debugging */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border/30 pt-1.5 mt-1.5">
            <span>
              <span className="text-muted-foreground">step1_output: </span>
              <span className="text-foreground">
                {step1OutputId ? step1OutputId.slice(0, 8) + "…" : "null"}
              </span>
            </span>
            <span>
              <span className="text-muted-foreground">step2_output: </span>
              <span className="text-foreground">
                {step2OutputId ? step2OutputId.slice(0, 8) + "…" : "null"}
              </span>
            </span>
          </div>
          
          {/* Camera Planning State */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border/30 pt-1.5 mt-1.5">
            <span>
              <span className="text-muted-foreground">camera_markers: </span>
              <Badge 
                variant={cameraMarkerCount && cameraMarkerCount > 0 ? "default" : "outline"} 
                className="text-xs px-1 py-0"
              >
                {cameraMarkerCount ?? 0}
              </Badge>
            </span>
            <span>
              <span className="text-muted-foreground">camera_confirmed: </span>
              <span className="text-foreground">
                {cameraPlanConfirmedAt 
                  ? new Date(cameraPlanConfirmedAt).toLocaleString() 
                  : "null"}
              </span>
            </span>
          </div>
          
          {lastAction && (
            <div className="border-t border-border/30 pt-1.5 mt-1.5">
              <span className="text-muted-foreground">last_action: </span>
              <span className="text-foreground">{lastAction}</span>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
});
