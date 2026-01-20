import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import { useEffect } from "react";

type RenderJob = Tables<"render_jobs">;
type RenderJobInsert = TablesInsert<"render_jobs">;
type RenderJobUpdate = TablesUpdate<"render_jobs">;

export function useRenderJobs(projectId: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const jobsQuery = useQuery({
    queryKey: ["render_jobs", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("render_jobs")
        .select(`
          *,
          panorama:uploads!render_jobs_panorama_upload_id_fkey(*),
          output:uploads!render_jobs_output_upload_id_fkey(*)
        `)
        .eq("project_id", projectId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!user && !!projectId
  });

  // Subscribe to realtime updates for render jobs (progress tracking)
  // Debounce invalidation to avoid excessive refetches
  useEffect(() => {
    if (!projectId || !user) return;

    let debounceTimeout: ReturnType<typeof setTimeout> | null = null;
    
    const channel = supabase
      .channel(`render_jobs_${projectId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'render_jobs',
          filter: `project_id=eq.${projectId}`
        },
        () => {
          // Debounce: only invalidate after 500ms of no updates
          if (debounceTimeout) clearTimeout(debounceTimeout);
          debounceTimeout = setTimeout(() => {
            queryClient.invalidateQueries({ queryKey: ["render_jobs", projectId] });
          }, 500);
        }
      )
      .subscribe();

    return () => {
      if (debounceTimeout) clearTimeout(debounceTimeout);
      supabase.removeChannel(channel);
    };
  }, [projectId, user, queryClient]);

  const createJob = useMutation({
    mutationFn: async ({ 
      panoramaUploadId, 
      changeRequest,
      designRefUploadIds = [],
      basePrompt,
      styleProfile,
      outputResolution
    }: { 
      panoramaUploadId: string; 
      changeRequest: string;
      designRefUploadIds?: string[];
      basePrompt?: string;
      styleProfile?: Record<string, unknown>;
      outputResolution?: string;
    }) => {
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("render_jobs")
        .insert({
          project_id: projectId,
          owner_id: user.id,
          panorama_upload_id: panoramaUploadId,
          change_request: changeRequest,
          design_ref_upload_ids: designRefUploadIds,
          base_prompt: basePrompt,
          style_profile: styleProfile,
          output_resolution: outputResolution?.toUpperCase() || "2K"
        } as RenderJobInsert)
        .select()
        .single();

      if (error) throw error;
      return data as RenderJob;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["render_jobs", projectId] });
    }
  });

  const updateJob = useMutation({
    mutationFn: async ({ id, ...updates }: { id: string } & RenderJobUpdate) => {
      const { data, error } = await supabase
        .from("render_jobs")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data as RenderJob;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["render_jobs", projectId] });
    }
  });

  const startJob = useMutation({
    mutationFn: async (jobId: string) => {
      const { data, error } = await supabase.functions.invoke("start-render-job", {
        body: { job_id: jobId }
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["render_jobs", projectId] });
    }
  });

  const deleteJob = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("render_jobs").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["render_jobs", projectId] });
    }
  });

  // Re-render a job (reset to queued status with optional new change request)
  const reRenderJob = useMutation({
    mutationFn: async ({ id, newChangeRequest }: { id: string; newChangeRequest?: string }) => {
      const updates: RenderJobUpdate = {
        status: "queued",
        attempts: 0,
        last_error: null,
        output_upload_id: null
      };
      
      if (newChangeRequest) {
        updates.change_request = newChangeRequest;
      }

      const { data, error } = await supabase
        .from("render_jobs")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data as RenderJob;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["render_jobs", projectId] });
    }
  });

  return {
    jobs: jobsQuery.data ?? [],
    isLoading: jobsQuery.isLoading,
    error: jobsQuery.error,
    createJob,
    updateJob,
    startJob,
    deleteJob,
    reRenderJob
  };
}
