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
    rejectionReason
  }: {
    stepNumber: number;
    previousPrompt: string;
    rejectionReason: string;
  }): Promise<string | null> => {
    setIsOptimizing(true);
    try {
      const { data, error } = await supabase.functions.invoke("optimize-pipeline-prompt", {
        body: { 
          step_number: stepNumber, 
          previous_prompt: previousPrompt,
          rejection_reason: rejectionReason,
          mode: "improve_after_rejection"
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

  return {
    isOptimizing,
    optimizePrompt,
    improveAfterRejection
  };
}
