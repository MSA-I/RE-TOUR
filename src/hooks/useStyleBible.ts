import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface StyleProfileResult {
  prompt: string;
  profile?: Record<string, any>;
  per_reference_notes?: Array<{ ref_id: string; contribution: string }>;
  detected_spaces?: string[];
  generated_at: string;
  used_ref_ids: string[];
  panorama_upload_id?: string;
}

export function useStyleBible(projectId: string) {
  const queryClient = useQueryClient();

  const generateStyleBible = useMutation({
    mutationFn: async ({ selectedRefIds, panoramaUploadId }: { selectedRefIds?: string[]; panoramaUploadId?: string }) => {
      const { data, error } = await supabase.functions.invoke("generate-style-bible", {
        body: { 
          project_id: projectId,
          selected_ref_ids: selectedRefIds,
          panorama_upload_id: panoramaUploadId
        }
      });

      if (error) throw error;
      if (data.error) throw new Error(data.error);
      
      return {
        styleProfile: data.style_profile as StyleProfileResult,
        unifiedPrompt: data.unified_style_prompt as string,
        perReferenceNotes: data.per_reference_notes as Array<{ ref_id: string; contribution: string }>
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
    }
  });

  return {
    generateStyleBible,
    isGenerating: generateStyleBible.isPending
  };
}