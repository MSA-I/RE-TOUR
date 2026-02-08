import { memo } from "react";
import { Button } from "@/components/ui/button";
import { ChevronRight, Loader2, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface ContinueToNextStepButtonProps {
  /** The step number that was just approved (1, 2, 3, etc.) */
  fromStep: number;
  /** The next step number to continue to */
  toStep: number;
  /** Whether the step is approved and ready to continue */
  isApproved: boolean;
  /** Current pipeline step number */
  currentPipelineStep: number;
  /** Whether the next step is already running or has output */
  nextStepHasStarted?: boolean;
  /** Handler for continue action */
  onContinue: () => void;
  /** Is the action in progress */
  isLoading?: boolean;
  /** Disabled state */
  disabled?: boolean;
  /** Custom label override */
  label?: string;
  /** Size variant */
  size?: "sm" | "default" | "lg";
  /** Style variant */
  variant?: "default" | "outline" | "secondary";
  /** Additional className */
  className?: string;
}

/**
 * A dedicated Continue button component that provides consistent, reliable
 * progression between pipeline steps.
 * 
 * CRITICAL RULES:
 * 1. ALWAYS visible when step is approved AND pipeline hasn't advanced past next step
 * 2. NEVER auto-hides based on ambiguous state
 * 3. User MUST always have a way to manually progress
 */
export const ContinueToNextStepButton = memo(function ContinueToNextStepButton({
  fromStep,
  toStep,
  isApproved,
  currentPipelineStep,
  nextStepHasStarted = false,
  onContinue,
  isLoading = false,
  disabled = false,
  label,
  size = "sm",
  variant = "default",
  className,
}: ContinueToNextStepButtonProps) {
  // Generate default label based on step numbers
  const stepLabels: Record<number, string> = {
    2: "Continue to Step 2",
    3: "Continue to Camera Planning",
    4: "Continue to Detect Spaces",
    5: "Start Renders",
    6: "Start Panoramas",
    7: "Start Final Merge",
  };
  const displayLabel = label || stepLabels[toStep] || `Continue to Step ${toStep}`;

  // CRITICAL: Determine visibility with fail-safe logic
  // Button should be visible when:
  // 1. The current step is approved (isApproved = true)
  // 2. AND the pipeline current step hasn't advanced significantly past this step
  // 3. OR we're in a state where the next step hasn't started yet
  
  // The button should ALWAYS be visible if approved and currentPipelineStep <= toStep
  // This prevents dead-end states where approval happens but Continue disappears
  const pipelineHasNotAdvancedPast = currentPipelineStep <= toStep;
  
  // Hard fallback: If step is approved but next step not started, ALWAYS show
  const shouldShowFallback = isApproved && !nextStepHasStarted && pipelineHasNotAdvancedPast;
  
  // Primary condition: Step approved and we're at or before the "from" step
  const shouldShowPrimary = isApproved && currentPipelineStep <= fromStep + 1;
  
  // Final visibility: Either primary or fallback condition
  const shouldShow = shouldShowPrimary || shouldShowFallback;

  if (!shouldShow) {
    return null;
  }

  return (
    <Button
      size={size}
      variant={variant}
      onClick={onContinue}
      disabled={disabled || isLoading}
      className={cn("gap-1.5", className)}
    >
      {isLoading ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        <ArrowRight className="w-4 h-4" />
      )}
      {displayLabel}
    </Button>
  );
});

export default ContinueToNextStepButton;
