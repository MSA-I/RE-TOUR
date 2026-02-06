import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

interface VirtualTourJob {
  id: string;
  owner_id: string;
  project_id: string;
  status: "draft" | "processing" | "preview_ready" | "completed" | "failed";
  input_asset_ids: string[];
  input_type: "upload" | "attach" | "mixed";
  max_items: number;
  preview_url: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export function useVirtualTourJobs(projectId: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ["virtual-tour-jobs", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("virtual_tour_jobs")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as VirtualTourJob[];
    },
    enabled: !!user && !!projectId
  });

  const createJob = useMutation({
    mutationFn: async (params: {
      inputAssetIds: string[];
      inputType: "upload" | "attach" | "mixed";
    }) => {
      if (!user) throw new Error("Not authenticated");

      // Validate max 100 items
      if (params.inputAssetIds.length > 100) {
        throw new Error("Maximum 100 images allowed per virtual tour");
      }

      const { data, error } = await supabase
        .from("virtual_tour_jobs")
        .insert({
          owner_id: user.id,
          project_id: projectId,
          input_asset_ids: params.inputAssetIds,
          input_type: params.inputType,
          status: "draft"
        })
        .select()
        .single();

      if (error) throw error;

      // Create notification
      await supabase.from("notifications").insert({
        owner_id: user.id,
        project_id: projectId,
        type: "virtual_tour_created",
        title: "Virtual Tour Created",
        message: `New virtual tour job with ${params.inputAssetIds.length} images`,
        target_route: `/projects/${projectId}`,
        target_params: { tab: "virtual-tour", jobId: data.id }
      });

      return data as VirtualTourJob;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["virtual-tour-jobs", projectId] });
      toast({ title: "Virtual Tour job created" });
    },
    onError: (error) => {
      toast({ 
        title: "Failed to create job", 
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive" 
      });
    }
  });

  const startProcessing = useMutation({
    mutationFn: async (jobId: string) => {
      if (!user) throw new Error("Not authenticated");

      // For MVP, immediately set to preview_ready (simulating processing)
      const { error } = await supabase
        .from("virtual_tour_jobs")
        .update({ status: "preview_ready", updated_at: new Date().toISOString() })
        .eq("id", jobId)
        .eq("owner_id", user.id);

      if (error) throw error;

      // Create notification
      await supabase.from("notifications").insert({
        owner_id: user.id,
        project_id: projectId,
        type: "virtual_tour_preview_ready",
        title: "Virtual Tour Preview Ready",
        message: "Your tour preview is ready for review",
        target_route: `/projects/${projectId}`,
        target_params: { tab: "virtual-tour", jobId }
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["virtual-tour-jobs", projectId] });
      toast({ title: "Preview ready" });
    }
  });

  const completeJob = useMutation({
    mutationFn: async (jobId: string) => {
      if (!user) throw new Error("Not authenticated");

      const { error } = await supabase
        .from("virtual_tour_jobs")
        .update({ status: "completed", updated_at: new Date().toISOString() })
        .eq("id", jobId)
        .eq("owner_id", user.id);

      if (error) throw error;

      // Create notification
      await supabase.from("notifications").insert({
        owner_id: user.id,
        project_id: projectId,
        type: "virtual_tour_completed",
        title: "Virtual Tour Completed",
        message: "Your virtual tour has been finalized",
        target_route: `/projects/${projectId}`,
        target_params: { tab: "virtual-tour", jobId }
      });

      // Also update project status to completed
      await supabase
        .from("projects")
        .update({ status: "completed" })
        .eq("id", projectId)
        .eq("owner_id", user.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["virtual-tour-jobs", projectId] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast({ title: "Virtual Tour completed!", description: "Project marked as complete" });
    }
  });

  const deleteJob = useMutation({
    mutationFn: async (jobId: string) => {
      if (!user) throw new Error("Not authenticated");

      const { error } = await supabase
        .from("virtual_tour_jobs")
        .delete()
        .eq("id", jobId)
        .eq("owner_id", user.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["virtual-tour-jobs", projectId] });
      toast({ title: "Virtual Tour job deleted" });
    }
  });

  return {
    jobs,
    isLoading,
    createJob,
    startProcessing,
    completeJob,
    deleteJob
  };
}
