import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface PipelineSuggestion {
  id: string;
  step_number: number;
  category: string;
  title: string;
  prompt: string;
  is_generated: boolean;
}

export function usePipelineSuggestions(stepNumber: number) {
  const [suggestions, setSuggestions] = useState<PipelineSuggestion[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const { toast } = useToast();

  const fetchSuggestions = useCallback(async (category?: string) => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("get-pipeline-suggestions", {
        body: { step_number: stepNumber, category }
      });

      if (error) throw error;

      setSuggestions(data.suggestions || []);
      setCategories(data.categories || []);
    } catch (error) {
      console.error("Failed to fetch suggestions:", error);
    } finally {
      setIsLoading(false);
    }
  }, [stepNumber]);

  const generateMore = useCallback(async (category?: string) => {
    setIsGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("get-pipeline-suggestions", {
        body: { step_number: stepNumber, category, generate_more: true }
      });

      if (error) throw error;

      setSuggestions(data.suggestions || []);
      setCategories(data.categories || []);
      
      if (data.generated_count) {
        toast({ title: `Generated ${data.generated_count} new suggestions` });
      }
    } catch (error) {
      console.error("Failed to generate suggestions:", error);
      toast({
        title: "Failed to generate suggestions",
        variant: "destructive"
      });
    } finally {
      setIsGenerating(false);
    }
  }, [stepNumber, toast]);

  return {
    suggestions,
    categories,
    isLoading,
    isGenerating,
    fetchSuggestions,
    generateMore
  };
}
