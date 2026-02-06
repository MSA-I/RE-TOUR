import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface DeletePipelineRunResult {
  success: boolean;
  deleted_run_id: string;
  deleted_outputs_count: number;
  deleted_storage_objects_count: number;
  deleted_events_count: number;
  deleted_reviews_count: number;
  deleted_attempts_count: number;
  deleted_spaces_count: number;
  deleted_renders_count: number;
  deleted_panoramas_count: number;
  deleted_final360_count: number;
  deleted_camera_markers_count: number;
  warnings: string[];
  error?: string;
}

export function useDeletePipelineRun(projectId?: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ 
      pipelineId, 
      forceDeleteRunning = false 
    }: { 
      pipelineId: string; 
      forceDeleteRunning?: boolean;
    }): Promise<DeletePipelineRunResult> => {
      const { data, error } = await supabase.functions.invoke("delete-pipeline-run", {
        body: { 
          pipeline_id: pipelineId,
          force_delete_running: forceDeleteRunning,
        },
      });

      if (error) {
        throw new Error(error.message || "Failed to delete pipeline run");
      }

      if (!data?.success) {
        throw new Error(data?.error || "Failed to delete pipeline run");
      }

      return data as DeletePipelineRunResult;
    },
    onSuccess: (data) => {
      // Invalidate relevant queries
      if (projectId) {
        queryClient.invalidateQueries({ queryKey: ["floorplan-pipelines", projectId] });
        queryClient.invalidateQueries({ queryKey: ["creations", projectId] });
      }
      queryClient.invalidateQueries({ queryKey: ["creations"] });

      const totalDeleted = 
        data.deleted_outputs_count + 
        data.deleted_renders_count + 
        data.deleted_panoramas_count + 
        data.deleted_final360_count;

      toast({
        title: "Pipeline run deleted",
        description: `Removed ${totalDeleted} images and ${data.deleted_storage_objects_count} storage files.`,
      });

      if (data.warnings && data.warnings.length > 0) {
        console.warn("[useDeletePipelineRun] Warnings:", data.warnings);
      }
    },
    onError: (error) => {
      toast({
        title: "Failed to delete pipeline run",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    },
  });
}
