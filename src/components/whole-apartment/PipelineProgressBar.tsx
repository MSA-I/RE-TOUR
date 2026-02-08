import { memo, useMemo } from "react";
import { cn } from "@/lib/utils";

/**
 * 6-Stage Pipeline Progress Bar
 * 
 * Progress advances ONLY on approval, not on running/queued states.
 * 
 * Stage mapping:
 * - Stage 0: AI Space Analysis complete        → 0%
 * - Stage 1: Step 1 approved (Top-Down 3D)    → 20%
 * - Stage 2: Step 2 approved (Styled Top-Down) → 40%
 * - Stage 3: Step 3 approved (Camera renders)  → 60%
 * - Stage 4: Step 4 approved (Panoramas)       → 80%
 * - Stage 5: All approved (Pipeline complete)  → 100%
 */

export interface PipelineProgressBarProps {
  /** Current pipeline phase from whole_apartment_phase */
  phase: string;
  /** Current step (0-6) derived from phase */
  currentStep: number;
  /** Whether step 1 has been manually approved */
  step1Approved: boolean;
  /** Whether step 2 has been manually approved */
  step2Approved: boolean;
  /** Whether step 3 (detect spaces) is complete */
  step3Complete: boolean;
  /** Number of spaces detected */
  spacesCount: number;
  /** Number of renders approved (out of spacesCount * 2) */
  rendersApproved: number;
  /** Number of panoramas approved (out of spacesCount * 2) */
  panoramasApproved: number;
  /** Number of final 360s approved (out of spacesCount) */
  final360sApproved: number;
  /** Custom class name */
  className?: string;
}

// Milestones at which progress snaps to
const MILESTONES = {
  ANALYSIS_COMPLETE: 0,
  STEP1_APPROVED: 20,
  STEP2_APPROVED: 40,
  STEP3_COMPLETE: 50, // Intermediate milestone for space detection
  RENDERS_APPROVED: 60,
  PANORAMAS_APPROVED: 80,
  COMPLETE: 100,
};

/**
 * Determine if the pipeline is currently "running" (should show animation)
 */
function isRunningPhase(phase: string): boolean {
  return phase.includes("running") || 
         phase === "detecting_spaces" ||
         phase === "renders_in_progress" ||
         phase === "panoramas_in_progress" ||
         phase === "merging_in_progress";
}

/**
 * Determine if awaiting human approval
 */
function isReviewPhase(phase: string): boolean {
  return phase.includes("review");
}

export const PipelineProgressBar = memo(function PipelineProgressBar({
  phase,
  currentStep,
  step1Approved,
  step2Approved,
  step3Complete,
  spacesCount,
  rendersApproved,
  panoramasApproved,
  final360sApproved,
  className,
}: PipelineProgressBarProps) {
  
  const { baseProgress, animatedProgress, isAnimating, milestone } = useMemo(() => {
    // Calculate base progress from approved milestones ONLY
    let base = 0;
    let currentMilestone = "Analysis";
    
    // Step 1 approved → 20%
    if (step1Approved) {
      base = MILESTONES.STEP1_APPROVED;
      currentMilestone = "Step 1 Approved";
    }
    
    // Step 2 approved → 40%
    if (step2Approved) {
      base = MILESTONES.STEP2_APPROVED;
      currentMilestone = "Step 2 Approved";
    }
    
    // Step 3 (detect spaces) complete → 50%
    if (step3Complete && spacesCount > 0) {
      base = MILESTONES.STEP3_COMPLETE;
      currentMilestone = "Spaces Detected";
    }
    
    // Calculate render progress (50-60%)
    if (spacesCount > 0) {
      const totalRendersNeeded = spacesCount * 2;
      if (rendersApproved > 0) {
        const renderProgress = (rendersApproved / totalRendersNeeded) * 10; // 10% span for renders
        base = Math.max(base, MILESTONES.STEP3_COMPLETE + renderProgress);
        currentMilestone = `Renders ${rendersApproved}/${totalRendersNeeded}`;
      }
      if (rendersApproved === totalRendersNeeded) {
        base = MILESTONES.RENDERS_APPROVED;
        currentMilestone = "All Renders Approved";
      }
    }
    
    // Calculate panorama progress (60-80%)
    if (spacesCount > 0) {
      const totalPanoramasNeeded = spacesCount * 2;
      if (panoramasApproved > 0 && rendersApproved === spacesCount * 2) {
        const panoramaProgress = (panoramasApproved / totalPanoramasNeeded) * 20; // 20% span for panoramas
        base = Math.max(base, MILESTONES.RENDERS_APPROVED + panoramaProgress);
        currentMilestone = `Panoramas ${panoramasApproved}/${totalPanoramasNeeded}`;
      }
      if (panoramasApproved === totalPanoramasNeeded) {
        base = MILESTONES.PANORAMAS_APPROVED;
        currentMilestone = "All Panoramas Approved";
      }
    }
    
    // Calculate final 360 progress (80-100%)
    if (spacesCount > 0 && final360sApproved > 0) {
      const final360Progress = (final360sApproved / spacesCount) * 20; // 20% span for final 360s
      base = Math.max(base, MILESTONES.PANORAMAS_APPROVED + final360Progress);
      currentMilestone = `Final 360s ${final360sApproved}/${spacesCount}`;
    }
    
    // Pipeline complete
    if (phase === "completed" || (spacesCount > 0 && final360sApproved === spacesCount)) {
      base = MILESTONES.COMPLETE;
      currentMilestone = "Complete";
    }
    
    // Calculate animated progress (subtle animation within current segment while running)
    const isRunning = isRunningPhase(phase);
    const isReview = isReviewPhase(phase);
    
    // Determine the next milestone cap for animation
    let nextMilestone = 0;
    if (!step1Approved) nextMilestone = MILESTONES.STEP1_APPROVED;
    else if (!step2Approved) nextMilestone = MILESTONES.STEP2_APPROVED;
    else if (!step3Complete) nextMilestone = MILESTONES.STEP3_COMPLETE;
    else if (spacesCount > 0 && rendersApproved < spacesCount * 2) nextMilestone = MILESTONES.RENDERS_APPROVED;
    else if (spacesCount > 0 && panoramasApproved < spacesCount * 2) nextMilestone = MILESTONES.PANORAMAS_APPROVED;
    else nextMilestone = MILESTONES.COMPLETE;
    
    // Only animate when running, and NEVER cross the next milestone
    let animated = base;
    if (isRunning && base < nextMilestone) {
      // Add a small visual "activity" within the current segment
      // Max 80% of the way to the next milestone while running
      const segmentSize = nextMilestone - base;
      animated = base + segmentSize * 0.5; // Stay at 50% within segment
    }
    
    return {
      baseProgress: base,
      animatedProgress: animated,
      isAnimating: isRunning,
      isAwaiting: isReview,
      milestone: currentMilestone,
    };
  }, [phase, currentStep, step1Approved, step2Approved, step3Complete, spacesCount, rendersApproved, panoramasApproved, final360sApproved]);

  return (
    <div className={cn("w-full space-y-1", className)}>
      {/* Progress bar container */}
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-secondary">
        {/* Base approved progress (solid) */}
        <div
          className="absolute inset-y-0 left-0 bg-primary transition-all duration-500 ease-out"
          style={{ width: `${baseProgress}%` }}
        />
        
        {/* Animated progress overlay (when running) */}
        {isAnimating && animatedProgress > baseProgress && (
          <div
            className="absolute inset-y-0 left-0 transition-all duration-1000 ease-in-out"
            style={{ width: `${animatedProgress}%` }}
          >
            {/* Animated stripes overlay */}
            <div 
              className="absolute inset-0 bg-gradient-to-r from-primary via-primary/70 to-primary animate-shimmer"
              style={{
                backgroundSize: "200% 100%",
              }}
            />
          </div>
        )}
        
        {/* Milestone markers */}
        <div className="absolute inset-0 flex">
          {[20, 40, 50, 60, 80].map((pos) => (
            <div
              key={pos}
              className={cn(
                "absolute top-0 bottom-0 w-px",
                baseProgress >= pos ? "bg-primary-foreground/30" : "bg-muted-foreground/20"
              )}
              style={{ left: `${pos}%` }}
            />
          ))}
        </div>
      </div>
      
      {/* Progress text */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="font-mono">{Math.round(baseProgress)}%</span>
        <span className={cn(
          "transition-colors duration-300",
          isAnimating && "text-primary"
        )}>
          {milestone}
        </span>
      </div>
    </div>
  );
});

// Add shimmer animation to tailwind in index.css or use inline styles
// This component expects the shimmer animation to be defined
