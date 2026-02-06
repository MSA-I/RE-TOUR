import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type FeedbackCategory =
  | "furniture_scale"
  | "extra_furniture"
  | "structural_change"
  | "flooring_mismatch"
  | "other";

export interface AttemptFeedbackData {
  projectId: string;
  pipelineId: string;
  stepId: number;
  attemptNumber: number;
  imageId: string | null;
  qaDecision: "approved" | "rejected";
  qaReasons: unknown[];
  userVote: "like" | "dislike";
  userCategory: FeedbackCategory;
  userCommentShort: string;
  contextSnapshot: Record<string, unknown>;
}

interface ExistingFeedback {
  id: string;
  user_vote: "like" | "dislike";
  user_category: FeedbackCategory;
  user_comment_short: string | null;
}

/**
 * Hook to manage QA attempt feedback (like/dislike votes)
 */
export function useQAAttemptFeedback(pipelineId: string, stepId: number) {
  const queryClient = useQueryClient();

  // Fetch existing feedback for this pipeline/step
  const { data: existingFeedback, isLoading: isLoadingFeedback } = useQuery({
    queryKey: ["qa-attempt-feedback", pipelineId, stepId],
    queryFn: async (): Promise<Map<string, ExistingFeedback>> => {
      const { data, error } = await supabase
        .from("qa_attempt_feedback")
        .select("id, attempt_number, image_id, user_vote, user_category, user_comment_short")
        .eq("pipeline_id", pipelineId)
        .eq("step_id", stepId);

      if (error) {
        console.error("[useQAAttemptFeedback] Error fetching feedback:", error);
        throw error;
      }

      // Create a map keyed by "attemptNumber_imageId" for easy lookup
      const feedbackMap = new Map<string, ExistingFeedback>();
      for (const row of data || []) {
        const key = `${row.attempt_number}_${row.image_id || "null"}`;
        feedbackMap.set(key, {
          id: row.id,
          user_vote: row.user_vote as "like" | "dislike",
          user_category: row.user_category as FeedbackCategory,
          user_comment_short: row.user_comment_short,
        });
      }

      return feedbackMap;
    },
    enabled: !!pipelineId && stepId >= 0,
    staleTime: 30_000,
  });

  // Submit feedback mutation
  const submitFeedbackMutation = useMutation({
    mutationFn: async (data: AttemptFeedbackData) => {
      const { data: result, error } = await supabase.functions.invoke(
        "store-qa-attempt-feedback",
        { body: data }
      );

      if (error) throw error;
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["qa-attempt-feedback", pipelineId, stepId],
      });
      toast.success("Feedback saved — helps improve future QA!");
    },
    onError: (error) => {
      console.error("[useQAAttemptFeedback] Submit error:", error);
      toast.error("Failed to save feedback. Please try again.");
    },
  });

  /**
   * Get existing feedback for a specific attempt
   */
  const getExistingFeedback = (
    attemptNumber: number,
    imageId: string | null
  ): ExistingFeedback | null => {
    if (!existingFeedback) return null;
    const key = `${attemptNumber}_${imageId || "null"}`;
    return existingFeedback.get(key) || null;
  };

  /**
   * Check if an attempt already has feedback
   */
  const hasFeedback = (attemptNumber: number, imageId: string | null): boolean => {
    return getExistingFeedback(attemptNumber, imageId) !== null;
  };

  return {
    existingFeedback,
    isLoadingFeedback,
    getExistingFeedback,
    hasFeedback,
    submitFeedback: submitFeedbackMutation.mutate,
    isSubmitting: submitFeedbackMutation.isPending,
  };
}
