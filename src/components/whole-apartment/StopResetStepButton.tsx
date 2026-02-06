import { memo, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { RotateCcw, Loader2, StopCircle, AlertTriangle } from "lucide-react";

export interface StopResetStepButtonProps {
  /** Step number (0-7) */
  stepNumber: number;
  /** Step name for display */
  stepName: string;
  /** Whether the step is currently running (shows "Stop" instead of "Reset") */
  isRunning?: boolean;
  /** Whether a reset/stop is in progress */
  isPending?: boolean;
  /** Called when user confirms reset */
  onReset: (stepNumber: number) => void;
  /** Disabled state (e.g., during other mutations) */
  disabled?: boolean;
  /** Compact mode - icon only with tooltip */
  compact?: boolean;
  /** List of downstream step names that will be affected */
  affectedSteps?: string[];
}

const STEP_NAMES: Record<number, string> = {
  0: "Space Analysis",
  1: "Top-Down 3D",
  2: "Style",
  3: "Detect Spaces",
  4: "Camera Planning",
  5: "Renders",
  6: "Panoramas",
  7: "Final 360 Merge",
};

/**
 * StopResetStepButton - A button that stops/resets a specific pipeline step.
 * 
 * - If the step is running, shows "Stop & Reset" to cancel and clear
 * - If the step is idle/pending, shows "Reset Step" to clear any existing state
 * - Always shows confirmation dialog before proceeding
 * - Displays which downstream steps will be affected
 */
export const StopResetStepButton = memo(function StopResetStepButton({
  stepNumber,
  stepName,
  isRunning = false,
  isPending = false,
  onReset,
  disabled = false,
  compact = false,
  affectedSteps,
}: StopResetStepButtonProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  // Calculate affected steps (current step and all downstream)
  const getAffectedStepsList = useCallback(() => {
    if (affectedSteps && affectedSteps.length > 0) {
      return affectedSteps;
    }
    const affected: string[] = [];
    for (let i = stepNumber; i <= 7; i++) {
      affected.push(`Step ${i}: ${STEP_NAMES[i]}`);
    }
    return affected;
  }, [affectedSteps, stepNumber]);

  const handleConfirm = useCallback(() => {
    setDialogOpen(false);
    onReset(stepNumber);
  }, [onReset, stepNumber]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent collapsible panel from toggling
    setDialogOpen(true);
  }, []);

  const buttonLabel = isRunning ? "Stop & Reset" : "Reset Step";
  const Icon = isRunning ? StopCircle : RotateCcw;
  const affectedStepsList = getAffectedStepsList();

  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size={compact ? "icon" : "sm"}
              onClick={handleClick}
              disabled={disabled || isPending}
              className={compact ? "h-7 w-7" : "h-7 px-2 text-xs"}
            >
              {isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Icon className={`h-3.5 w-3.5 ${isRunning ? "text-destructive" : "text-muted-foreground"}`} />
              )}
              {!compact && (
                <span className={`ml-1 ${isRunning ? "text-destructive" : "text-muted-foreground"}`}>
                  {isPending ? "Resetting..." : buttonLabel}
                </span>
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p>{isRunning ? "Stop running job and reset step" : "Reset this step and start fresh"}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* Confirmation Dialog */}
      <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              {isRunning ? "Stop & Reset" : "Reset"} Step {stepNumber}: {stepName}?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              {isRunning && (
                <p>
                  This will <strong>stop the currently running job</strong> and clear all outputs for this step.
                </p>
              )}
              <p>
                This will permanently delete all outputs and progress for this
                step and all downstream steps.
              </p>
              <div className="bg-destructive/10 border border-destructive/20 rounded-md p-3">
                <p className="text-sm font-medium text-destructive mb-2">
                  The following will be cleared:
                </p>
                <ul className="text-sm text-muted-foreground space-y-1 max-h-32 overflow-y-auto">
                  {affectedStepsList.map((step, idx) => (
                    <li key={idx} className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-destructive flex-shrink-0" />
                      {step}
                    </li>
                  ))}
                </ul>
              </div>
              <p className="text-sm font-medium">
                This action cannot be undone.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={(e) => e.stopPropagation()}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.stopPropagation();
                handleConfirm();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Resetting...
                </>
              ) : (
                <>
                  <Icon className="h-4 w-4 mr-2" />
                  {isRunning ? "Stop & Reset" : "Reset Step"}
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
});

export default StopResetStepButton;
