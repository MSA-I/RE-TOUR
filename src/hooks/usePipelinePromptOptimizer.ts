import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface OptimizeResult {
  optimized_prompt: string;
  step_number: number;
  mode: string;
}

export function usePipelinePromptOptimizer() {
  const [isOptimizing, setIsOptimizing] = useState(false);
  const { toast } = useToast();

  const optimizePrompt = useCallback(async ({
    stepNumber,
    suggestionPrompt,
    userAdditions
  }: {
    stepNumber: number;
    suggestionPrompt?: string;
    userAdditions?: string;
  }): Promise<string | null> => {
    setIsOptimizing(true);
    try {
      const { data, error } = await supabase.functions.invoke("optimize-pipeline-prompt", {
        body: { 
          step_number: stepNumber, 
          suggestion_prompt: suggestionPrompt,
          user_additions: userAdditions,
          mode: "merge"
        }
      });

      if (error) throw error;

      return (data as OptimizeResult).optimized_prompt;
    } catch (error) {
      console.error("Failed to optimize prompt:", error);
      toast({
        title: "Failed to optimize prompt",
        variant: "destructive"
      });
      return null;
    } finally {
      setIsOptimizing(false);
    }
  }, [toast]);

  const improveAfterRejection = useCallback(async ({
    stepNumber,
    previousPrompt,
    rejectionReason,
    rejectionCategory,
    rejectionAnalysis,
    qaFeedback
  }: {
    stepNumber: number;
    previousPrompt: string;
    rejectionReason: string;
    rejectionCategory?: string;
    rejectionAnalysis?: {
      failure_categories: string[];
      root_cause_summary: string;
      constraints_to_add: string[];
      constraints_to_remove: string[];
    };
    /** NEW: QA feedback signal from user scoring */
    qaFeedback?: {
      user_score?: number;
      user_comment?: string;
      last_qa_reason_text?: string;
      last_qa_decision?: "approved" | "rejected";
    };
  }): Promise<string | null> => {
    setIsOptimizing(true);
    try {
      const { data, error } = await supabase.functions.invoke("optimize-pipeline-prompt", {
        body: { 
          step_number: stepNumber, 
          previous_prompt: previousPrompt,
          rejection_reason: rejectionReason,
          rejection_category: rejectionCategory || rejectionAnalysis?.failure_categories?.[0],
          rejection_analysis: rejectionAnalysis,
          mode: "improve_after_rejection",
          // NEW: Pass QA feedback for learning
          qa_feedback: qaFeedback
        }
      });

      if (error) throw error;

      return (data as OptimizeResult).optimized_prompt;
    } catch (error) {
      console.error("Failed to improve prompt:", error);
      toast({
        title: "Failed to generate improved prompt",
        variant: "destructive"
      });
      return null;
    } finally {
      setIsOptimizing(false);
    }
  }, [toast]);

  /**
   * Analyze a rejection to understand root cause (for learning loop)
   */
  const analyzeRejection = useCallback(async ({
    assetType,
    assetId,
    stepNumber,
    rejectReason,
    previousPrompt
  }: {
    assetType: string;
    assetId: string;
    stepNumber: number;
    rejectReason: string;
    previousPrompt?: string;
  }) => {
    try {
      const { data, error } = await supabase.functions.invoke("analyze-rejection", {
        body: {
          asset_type: assetType,
          asset_id: assetId,
          step_number: stepNumber,
          reject_reason: rejectReason,
          previous_prompt: previousPrompt
        }
      });

      if (error) throw error;
      return data?.analysis;
    } catch (error) {
      console.error("Failed to analyze rejection:", error);
      return null;
    }
  }, []);

  return {
    isOptimizing,
    optimizePrompt,
    improveAfterRejection,
    analyzeRejection
  };
}
