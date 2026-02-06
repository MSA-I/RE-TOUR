import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface ChangeSuggestion {
  id: string;
  category: string;
  title: string;
  prompt: string;
  is_generated: boolean;
  created_at: string;
}

export function useChangeSuggestions(suggestionContext?: string) {
  const [suggestions, setSuggestions] = useState<ChangeSuggestion[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const { toast } = useToast();

  const fetchSuggestions = useCallback(async (category?: string, search?: string) => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("get-change-suggestions", {
        body: { category, search, context: suggestionContext },
      });

      if (error) throw error;

      setSuggestions(data.suggestions || []);
      setCategories(data.categories || []);
    } catch (error) {
      console.error("Failed to fetch suggestions:", error);
      toast({
        title: "Failed to load suggestions",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast, suggestionContext]);

  const generateMore = useCallback(async (category?: string) => {
    setIsGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("get-change-suggestions", {
        body: { category, generate_more: true },
      });

      if (error) throw error;

      setSuggestions(data.suggestions || []);
      if (data.generated_count) {
        toast({
          title: `Generated ${data.generated_count} new suggestions`,
        });
      }
    } catch (error) {
      console.error("Failed to generate suggestions:", error);
      toast({
        title: "Failed to generate suggestions",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  }, [toast]);

  const getSurprise = useCallback(async (): Promise<ChangeSuggestion | null> => {
    try {
      const { data, error } = await supabase.functions.invoke("get-change-suggestions", {
        body: { surprise_me: true },
      });

      if (error) throw error;

      if (data.suggestions && data.suggestions.length > 0) {
        return data.suggestions[0];
      }
      return null;
    } catch (error) {
      console.error("Failed to get surprise suggestion:", error);
      toast({
        title: "Failed to get suggestion",
        variant: "destructive",
      });
      return null;
    }
  }, [toast]);

  return {
    suggestions,
    categories,
    isLoading,
    isGenerating,
    fetchSuggestions,
    generateMore,
    getSurprise,
  };
}
