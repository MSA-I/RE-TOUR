import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { TablesInsert } from "@/integrations/supabase/types";

type JobReviewInsert = TablesInsert<"job_reviews">;

export function useJobReviews(projectId: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const createReview = useMutation({
    mutationFn: async ({ 
      jobId, 
      decision, 
      notes 
    }: { 
      jobId: string; 
      decision: "approved" | "rejected";
      notes?: string;
    }) => {
      if (!user) throw new Error("Not authenticated");

      // Create review
      const { error: reviewError } = await supabase
        .from("job_reviews")
        .insert({
          job_id: jobId,
          owner_id: user.id,
          decision,
          notes
        } as JobReviewInsert);

      if (reviewError) throw reviewError;

      // Update job status
      const { error: jobError } = await supabase
        .from("render_jobs")
        .update({ status: decision })
        .eq("id", jobId);

      if (jobError) throw jobError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["render_jobs", projectId] });
    }
  });

  return { createReview };
}
