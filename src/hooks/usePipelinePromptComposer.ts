import { useState, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface SelectedSuggestion {
  id: string;
  title: string;
  prompt: string;
}

interface ComposeResult {
  ok: boolean;
  chosen_template_name?: string;
  composed_prompt?: string;
  short_merge_summary?: string;
  step_number?: number;
  error_code?: string;
  error_message?: string;
}

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;
const CLIENT_TIMEOUT_MS = 30000; // 30 second client-side timeout

// Helper to delay
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Helper to invoke with exponential backoff retry
async function invokeWithRetry(
  fnName: string,
  body: Record<string, unknown>,
  maxRetries: number = MAX_RETRIES
): Promise<{ data: ComposeResult | null; error: Error | null }> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const { data, error } = await supabase.functions.invoke(fnName, { body });
      
      if (error) {
        // Check if it's a transient error (503, 504, network)
        const isTransient = error.message?.includes('503') || 
                           error.message?.includes('504') ||
                           error.message?.includes('BOOT_ERROR') ||
                           error.message?.includes('network');
        
        if (isTransient && attempt < maxRetries) {
          console.log(`Transient error on attempt ${attempt + 1}, retrying in ${RETRY_DELAY_MS * (attempt + 1)}ms...`);
          await delay(RETRY_DELAY_MS * (attempt + 1)); // Exponential backoff
          lastError = error;
          continue;
        }
        throw error;
      }
      
      return { data: data as ComposeResult, error: null };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      
      if (attempt < maxRetries) {
        console.log(`Error on attempt ${attempt + 1}, retrying...`);
        await delay(RETRY_DELAY_MS * (attempt + 1));
      }
    }
  }
  
  return { data: null, error: lastError };
}

export function usePipelinePromptComposer() {
  const [isComposing, setIsComposing] = useState(false);
  const { toast } = useToast();
  const abortControllerRef = useRef<AbortController | null>(null);

  const composePrompt = useCallback(async ({
    stepNumber,
    selectedSuggestions,
    userPromptText
  }: {
    stepNumber: number;
    selectedSuggestions: SelectedSuggestion[];
    userPromptText: string;
  }): Promise<ComposeResult | null> => {
    // Cancel any existing request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    
    setIsComposing(true);
    
    // Client-side timeout
    const timeoutId = setTimeout(() => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    }, CLIENT_TIMEOUT_MS);
    
    try {
      const { data, error } = await invokeWithRetry("compose-pipeline-prompt", {
        step_number: stepNumber,
        selected_suggestions: selectedSuggestions.map(s => ({ title: s.title, prompt: s.prompt })),
        user_prompt_text: userPromptText
      });

      clearTimeout(timeoutId);

      if (error) throw error;
      
      // Check for ok: false response
      if (data && !data.ok) {
        const errorMsg = data.error_message || "Failed to compose prompt";
        console.error("Compose prompt failed:", data.error_code, errorMsg);
        toast({
          title: "Failed to compose prompt",
          description: errorMsg,
          variant: "destructive"
        });
        return null;
      }

      return data;
    } catch (error) {
      clearTimeout(timeoutId);
      
      const isAborted = error instanceof Error && error.name === 'AbortError';
      const errorMessage = isAborted 
        ? "Request timed out. Please try again."
        : (error instanceof Error ? error.message : "Unknown error");
      
      console.error("Failed to compose prompt:", error);
      toast({
        title: "Failed to compose prompt",
        description: errorMessage,
        variant: "destructive"
      });
      return null;
    } finally {
      setIsComposing(false);
      abortControllerRef.current = null;
    }
  }, [toast]);

  // Cancel function to abort ongoing request
  const cancelCompose = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsComposing(false);
  }, []);

  return {
    isComposing,
    composePrompt,
    cancelCompose
  };
}
