import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { QACategoryKey } from "@/components/whole-apartment/QAFeedbackDialog";

// Types for QA learning context
export interface QAPolicyRule {
  id: string;
  scopeLevel: "global" | "project" | "step";
  stepId: number | null;
  category: string;
  ruleText: string;
  supportCount: number;
}

export interface QASimilarCase {
  id: string;
  stepId: number;
  category: string;
  userDecision: "approved" | "rejected";
  userReasonShort: string;
  qaOriginalStatus: string;
  outcomeType: "false_reject" | "false_approve" | "confirmed_correct";
  contextSummary: string;
}

export interface QACalibrationStats {
  stepId: number;
  category: string;
  falseRejectCount: number;
  falseApproveCount: number;
  confirmedCorrectCount: number;
}

export interface QAAttemptFeedbackSignal {
  id: string;
  stepId: number;
  category: string;
  qaDecision: "approved" | "rejected";
  userVote: "like" | "dislike";
  userComment: string | null;
  contextSummary: string;
}

export interface QAAttemptFeedbackSignals {
  likedCases: QAAttemptFeedbackSignal[];
  dislikedCases: QAAttemptFeedbackSignal[];
  voteCounts: Record<string, { likes: number; dislikes: number }>;
}

export interface QALearningContext {
  policyRules: QAPolicyRule[];
  similarCases: QASimilarCase[];
  calibrationStats: QACalibrationStats[];
  attemptFeedbackSignals?: QAAttemptFeedbackSignals;
}

interface StoreQAFeedbackParams {
  projectId: string;
  pipelineId: string;
  stepId: number;
  attemptNumber: number;
  imageId: string | null;
  userDecision: "approved" | "rejected";
  userCategory: QACategoryKey;
  userReasonShort: string;
  qaOriginalStatus: "approved" | "rejected" | "pending" | null;
  qaOriginalReasons: unknown[];
  contextSnapshot: Record<string, unknown>;
  qaWasWrong: boolean;
}

/**
 * Hook for storing QA feedback from manual approvals/rejections
 */
export function useStoreQAFeedback() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: StoreQAFeedbackParams) => {
      const { data, error } = await supabase.functions.invoke("store-qa-feedback", {
        body: params,
      });

      if (error) {
        console.error("[useStoreQAFeedback] Error:", error);
        throw error;
      }

      return data;
    },
    onSuccess: (data, variables) => {
      // Invalidate related queries
      queryClient.invalidateQueries({
        queryKey: ["qa-learning-context", variables.pipelineId],
      });
      
      // Show toast only for policy rule creation
      if (data?.policyRuleCreated) {
        toast({
          title: "Learning from your feedback",
          description: data.policyRuleStatus === "pending" 
            ? "A new rule candidate has been created. It will activate after more confirmations."
            : "Your feedback strengthened an existing rule.",
        });
      }
    },
    onError: (error) => {
      console.error("[useStoreQAFeedback] Mutation error:", error);
      toast({
        title: "Failed to save feedback",
        description: "Your approval was processed but feedback couldn't be saved for learning.",
        variant: "destructive",
      });
    },
  });
}

/**
 * Hook for fetching QA learning context (policy rules, similar cases, calibration)
 */
export function useQALearningContext(
  projectId: string | null,
  pipelineId: string | null,
  stepId: number | null,
  options: { enabled?: boolean } = {}
) {
  return useQuery({
    queryKey: ["qa-learning-context", pipelineId, stepId],
    queryFn: async (): Promise<QALearningContext> => {
      if (!projectId || !pipelineId || stepId === null) {
        return { policyRules: [], similarCases: [], calibrationStats: [] };
      }

      const { data, error } = await supabase.functions.invoke("get-qa-learning-context", {
        body: {
          projectId,
          pipelineId,
          stepId,
        },
      });

      if (error) {
        console.error("[useQALearningContext] Error:", error);
        throw error;
      }

      return {
        policyRules: data?.policyRules || [],
        similarCases: data?.similarCases || [],
        calibrationStats: data?.calibrationStats || [],
        attemptFeedbackSignals: data?.attemptFeedbackSignals || undefined,
      };
    },
    enabled: options.enabled !== false && !!projectId && !!pipelineId && stepId !== null,
    staleTime: 60_000, // 1 minute
    refetchOnWindowFocus: false,
  });
}

/**
 * Hook for building the context snapshot from current pipeline state
 */
export function useBuildContextSnapshot(pipeline: {
  id: string;
  step_outputs?: Record<string, unknown>;
  global_style_bible?: Record<string, unknown>;
  aspect_ratio?: string;
} | null) {
  return {
    buildSnapshot: (stepId: number): Record<string, unknown> => {
      if (!pipeline) return {};

      const stepOutputs = pipeline.step_outputs || {};
      const currentStepOutput = stepOutputs[`step${stepId}`] as Record<string, unknown> | undefined;

      return {
        step_id: stepId,
        pipeline_id: pipeline.id,
        aspect_ratio: pipeline.aspect_ratio,
        has_style_bible: !!pipeline.global_style_bible,
        step_output_summary: currentStepOutput ? {
          has_output: !!currentStepOutput.output_upload_id,
          qa_status: currentStepOutput.qa_status,
          model: currentStepOutput.model,
        } : null,
        // Compact summary - don't include full data
        timestamp: new Date().toISOString(),
      };
    },
  };
}

/**
 * Utility to format learning context for injection into QA prompt
 */
export function formatLearningContextForPrompt(context: QALearningContext): string {
  const sections: string[] = [];

  // Policy rules section
  if (context.policyRules.length > 0) {
    sections.push("ACTIVE_POLICY_RULES:");
    context.policyRules.forEach((rule, i) => {
      sections.push(`${i + 1}. [${rule.category}] ${rule.ruleText} (confirmed ${rule.supportCount}x)`);
    });
  }

  // Similar cases section
  if (context.similarCases.length > 0) {
    sections.push("\nSIMILAR_PAST_CASES:");
    context.similarCases.forEach((c, i) => {
      const outcome = c.outcomeType === "false_reject" 
        ? "USER_APPROVED (QA was wrong)" 
        : c.outcomeType === "false_approve"
        ? "USER_REJECTED (QA was wrong)"
        : "CONFIRMED";
      sections.push(`${i + 1}. [${c.category}] ${c.userReasonShort} → ${outcome}`);
    });
  }

  // Calibration stats section
  if (context.calibrationStats.length > 0) {
    sections.push("\nCALIBRATION_STATS:");
    context.calibrationStats.forEach((stat) => {
      const total = stat.falseRejectCount + stat.falseApproveCount + stat.confirmedCorrectCount;
      if (total > 0) {
        const falseRejectRate = ((stat.falseRejectCount / total) * 100).toFixed(0);
        sections.push(
          `- ${stat.category}: ${falseRejectRate}% false reject rate (n=${total})`
        );
      }
    });
  }

  // Attempt feedback signals section (Like/Dislike)
  if (context.attemptFeedbackSignals) {
    const { likedCases, dislikedCases, voteCounts } = context.attemptFeedbackSignals;
    
    // Vote counts per category
    const voteEntries = Object.entries(voteCounts);
    if (voteEntries.length > 0) {
      sections.push("\nATTEMPT_VOTE_COUNTS:");
      voteEntries.forEach(([category, counts]) => {
        sections.push(`- ${category}: ${counts.likes} 👍, ${counts.dislikes} 👎`);
      });
    }
    
    // Examples where users said QA was correct (liked)
    if (likedCases.length > 0) {
      sections.push("\nEXAMPLES_WHERE_QA_WAS_CORRECT:");
      likedCases.forEach((c, i) => {
        const comment = c.userComment ? ` — "${c.userComment}"` : "";
        sections.push(`${i + 1}. [${c.category}] QA ${c.qaDecision}${comment}`);
      });
    }
    
    // Examples where users said QA was wrong (disliked)
    if (dislikedCases.length > 0) {
      sections.push("\nEXAMPLES_WHERE_QA_WAS_WRONG:");
      dislikedCases.forEach((c, i) => {
        const comment = c.userComment ? ` — "${c.userComment}"` : "";
        sections.push(`${i + 1}. [${c.category}] QA ${c.qaDecision}${comment}`);
      });
    }
  }

  return sections.join("\n");
}
