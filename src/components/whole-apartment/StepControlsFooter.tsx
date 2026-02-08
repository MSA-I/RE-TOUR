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
import { RotateCcw, ChevronLeft, Loader2, StopCircle, AlertTriangle } from "lucide-react";

export interface StepControlsFooterProps {
  /** Step number (0-7) */
  stepNumber: number;
  /** Step name for display */
  stepName: string;
  /** Whether the step is currently running */
  isRunning?: boolean;
  /** Whether reset is in progress */
  isResetPending?: boolean;
  /** Whether rollback is in progress */
  isRollbackPending?: boolean;
  /** Called when user confirms reset */
  onReset: (stepNumber: number) => void;
  /** Called when user confirms rollback (go back to previous step) */
  onRollback?: (stepNumber: number) => void;
  /** Disabled state (e.g., during other mutations) */
  disabled?: boolean;
  /** Hide reset button (for completed/approved steps if not desired) */
  hideReset?: boolean;
  /** Hide rollback button (for step 0 since can't go back further) */
  hideRollback?: boolean;
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
 * StepControlsFooter - Footer controls for pipeline steps.
 * Shows both "Reset This Step" and "Back to Previous Step" buttons.
 * Visible at the end of each step panel in ALL states (running, completed, approved, etc.)
 */
export const StepControlsFooter = memo(function StepControlsFooter({
  stepNumber,
  stepName,
  isRunning = false,
  isResetPending = false,
  isRollbackPending = false,
  onReset,
  onRollback,
  disabled = false,
  hideReset = false,
  hideRollback = false,
}: StepControlsFooterProps) {
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [rollbackDialogOpen, setRollbackDialogOpen] = useState(false);

  const canRollback = stepNumber > 0 && onRollback && !hideRollback;
  const previousStepName = stepNumber > 0 ? STEP_NAMES[stepNumber - 1] : null;
  const isPending = isResetPending || isRollbackPending;

  // Calculate which steps will be affected by reset (current + all downstream)
  const getAffectedStepsList = useCallback(() => {
    const affected: string[] = [];
    for (let i = stepNumber; i <= 7; i++) {
      affected.push(`Step ${i}: ${STEP_NAMES[i]}`);
    }
    return affected;
  }, [stepNumber]);

  const handleResetConfirm = useCallback(() => {
    setResetDialogOpen(false);
    onReset(stepNumber);
  }, [onReset, stepNumber]);

  const handleRollbackConfirm = useCallback(() => {
    setRollbackDialogOpen(false);
    onRollback?.(stepNumber);
  }, [onRollback, stepNumber]);

  const affectedStepsList = getAffectedStepsList();
  const ResetIcon = isRunning ? StopCircle : RotateCcw;
  const resetLabel = isRunning ? "Stop & Reset Step" : "Reset This Step";

  // Don't render if both buttons are hidden
  if (hideReset && !canRollback) {
    return null;
  }

  return (
    <>
      <div className="flex items-center justify-between gap-2 pt-3 mt-3 border-t border-border/30">
        {/* Left: Back to Previous Step */}
        <div>
          {canRollback && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRollbackDialogOpen(true)}
              disabled={disabled || isPending}
              className="text-muted-foreground hover:text-foreground"
            >
              {isRollbackPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <ChevronLeft className="h-4 w-4 mr-1" />
              )}
              Back to Step {stepNumber - 1}
            </Button>
          )}
        </div>

        {/* Right: Reset This Step */}
        <div>
          {!hideReset && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setResetDialogOpen(true)}
              disabled={disabled || isPending}
              className={isRunning ? "text-destructive hover:text-destructive" : "text-muted-foreground hover:text-foreground"}
            >
              {isResetPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <ResetIcon className="h-4 w-4 mr-2" />
              )}
              {resetLabel}
            </Button>
          )}
        </div>
      </div>

      {/* Reset Confirmation Dialog */}
      <AlertDialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <AlertDialogContent>
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
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleResetConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isResetPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Resetting...
                </>
              ) : (
                <>
                  <ResetIcon className="h-4 w-4 mr-2" />
                  {resetLabel}
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Rollback Confirmation Dialog */}
      <AlertDialog open={rollbackDialogOpen} onOpenChange={setRollbackDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ChevronLeft className="h-5 w-5 text-primary" />
              Go Back to Step {stepNumber - 1}: {previousStepName}?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>
                This will rewind the pipeline to the previous step. The current
                step's outputs and all downstream steps will be cleared.
              </p>
              <div className="bg-muted border border-border rounded-md p-3 space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium">From:</span>
                  <span>
                    Step {stepNumber}: {stepName}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm text-primary">
                  <span className="font-medium">To:</span>
                  <span>
                    Step {stepNumber - 1}: {previousStepName}
                  </span>
                </div>
              </div>
              <div className="bg-destructive/10 border border-destructive/20 rounded-md p-3">
                <p className="text-sm font-medium text-destructive mb-2">
                  The following will be cleared:
                </p>
                <ul className="text-sm text-muted-foreground space-y-1">
                  {affectedStepsList.map((step, idx) => (
                    <li key={idx} className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-destructive flex-shrink-0" />
                      {step}
                    </li>
                  ))}
                </ul>
              </div>
              <p className="text-sm text-muted-foreground">
                Step {stepNumber - 1} will remain in its completed state. You
                can re-run or modify it from there.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRollbackConfirm}>
              {isRollbackPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Going Back...
                </>
              ) : (
                <>
                  <ChevronLeft className="h-4 w-4 mr-2" />
                  Go Back to Step {stepNumber - 1}
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
});

export default StepControlsFooter;
