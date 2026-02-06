import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export interface ResetCropResult {
  success: boolean;
  message: string;
  deleted_files: number;
  updated_items: number;
  marker_id: string;
  marker_label: string;
  new_anchor_status: string;
  errors?: string[];
}

/**
 * Hook to reset (delete) a camera point's crop screenshot.
 * After reset, the crop is permanently deleted and cannot be used in renders.
 */
export function useResetCameraPointCrop(pipelineId: string | undefined) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const resetCrop = useMutation({
    mutationFn: async ({ 
      markerId, 
      scanId 
    }: { 
      markerId: string; 
      scanId?: string;
    }): Promise<ResetCropResult> => {
      if (!pipelineId) throw new Error("No pipeline ID");

      const { data, error } = await supabase.functions.invoke("reset-camera-point-crop", {
        body: { 
          pipeline_id: pipelineId, 
          marker_id: markerId,
          scan_id: scanId,
        },
      });

      if (error) throw error;
      if (!data?.success && data?.errors?.length > 0) {
        throw new Error(data.errors.join("; "));
      }

      return data as ResetCropResult;
    },
    onSuccess: (data) => {
      // Invalidate all related queries to refresh UI
      queryClient.invalidateQueries({ queryKey: ["camera-markers", pipelineId] });
      queryClient.invalidateQueries({ queryKey: ["camera-scan-items"] });
      queryClient.invalidateQueries({ queryKey: ["latest-camera-scan-id", pipelineId] });
      queryClient.invalidateQueries({ queryKey: ["camera-scan", pipelineId] });
      queryClient.invalidateQueries({ queryKey: ["camera-scan-status", pipelineId] });
      
      toast({
        title: "Screenshot Reset",
        description: `Cleared crop for ${data.marker_label}. Take a new screenshot when ready.`,
      });
    },
    onError: (error) => {
      toast({
        title: "Reset Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  return {
    resetCrop,
    isResetting: resetCrop.isPending,
  };
}
