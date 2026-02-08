import { memo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  MoreVertical,
  RotateCcw,
  ChevronLeft,
  Loader2,
  AlertTriangle,
} from "lucide-react";

interface StepControlsDropdownProps {
  /** Current step number (0-7) */
  stepNumber: number;
  /** Step name for display */
  stepName: string;
  /** Whether reset is in progress */
  isResetPending: boolean;
  /** Whether rollback is in progress */
  isRollbackPending: boolean;
  /** Called when user confirms reset */
  onResetStep: (stepNumber: number) => void;
  /** Called when user confirms rollback (only available for steps > 0) */
  onRollbackStep?: (currentStepNumber: number) => void;
  /** Whether any mutation is pending (disables all actions) */
  disabled?: boolean;
  /** List of downstream step names that will be affected by reset */
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

export const StepControlsDropdown = memo(function StepControlsDropdown({
  stepNumber,
  stepName,
  isResetPending,
  isRollbackPending,
  onResetStep,
  onRollbackStep,
  disabled = false,
  affectedSteps,
}: StepControlsDropdownProps) {
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [rollbackDialogOpen, setRollbackDialogOpen] = useState(false);

  const canRollback = stepNumber > 0 && onRollbackStep;
  const previousStepName = stepNumber > 0 ? STEP_NAMES[stepNumber - 1] : null;

  // Calculate which steps will be affected by reset
  const getAffectedStepsList = () => {
    if (affectedSteps && affectedSteps.length > 0) {
      return affectedSteps;
    }
    const affected: string[] = [];
    for (let i = stepNumber; i <= 7; i++) {
      affected.push(`Step ${i}: ${STEP_NAMES[i]}`);
    }
    return affected;
  };

  const handleResetConfirm = () => {
    setResetDialogOpen(false);
    onResetStep(stepNumber);
  };

  const handleRollbackConfirm = () => {
    setRollbackDialogOpen(false);
    onRollbackStep?.(stepNumber);
  };

  const isPending = isResetPending || isRollbackPending;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={disabled || isPending}
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <MoreVertical className="h-4 w-4" />
            )}
            <span className="sr-only">Step controls</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {/* Reset Step */}
          <DropdownMenuItem
            onClick={() => setResetDialogOpen(true)}
            disabled={isResetPending}
            className="text-destructive focus:text-destructive"
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Reset Step {stepNumber}
          </DropdownMenuItem>

          {/* Go Back to Previous Step */}
          {canRollback && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setRollbackDialogOpen(true)}
                disabled={isRollbackPending}
              >
                <ChevronLeft className="h-4 w-4 mr-2" />
                Back to Step {stepNumber - 1}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Reset Confirmation Dialog */}
      <AlertDialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Reset Step {stepNumber}: {stepName}?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>
                This will permanently delete all outputs and progress for this
                step and all downstream steps.
              </p>
              <div className="bg-destructive/10 border border-destructive/20 rounded-md p-3">
                <p className="text-sm font-medium text-destructive mb-2">
                  The following will be cleared:
                </p>
                <ul className="text-sm text-muted-foreground space-y-1">
                  {getAffectedStepsList().map((step, idx) => (
                    <li key={idx} className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-destructive" />
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
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Reset Step
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
                step's outputs will be cleared.
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
                  Go Back
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
});

export default StepControlsDropdown;
