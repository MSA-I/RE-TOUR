import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface ComposePromptParams {
  changeRequest: string;
  stylePrompt?: string;
  includeStyle: boolean;
}

interface ComposePromptResult {
  composed_prompt: string;
  detected_template: string | null;
}

export function usePromptComposer() {
  const composePrompt = useMutation({
    mutationFn: async ({ changeRequest, stylePrompt, includeStyle }: ComposePromptParams): Promise<ComposePromptResult> => {
      const { data, error } = await supabase.functions.invoke("compose-final-prompt", {
        body: {
          change_request: changeRequest,
          style_prompt: stylePrompt,
          include_style: includeStyle
        }
      });

      if (error) throw error;
      if (data.error) throw new Error(data.error);
      
      return data;
    }
  });

  return {
    composePrompt,
    isComposing: composePrompt.isPending
  };
}
