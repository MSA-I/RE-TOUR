import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useEffect } from "react";

export interface BatchJob {
  id: string;
  project_id: string;
  owner_id: string;
  change_request: string;
  base_prompt: string | null;
  style_profile: Record<string, unknown> | null;
  output_resolution: string;
  status: string;
  progress_int: number;
  total_items: number;
  completed_items: number;
  failed_items: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface BatchJobItem {
  id: string;
  batch_job_id: string;
  panorama_upload_id: string;
  render_job_id: string | null;
  output_upload_id: string | null;
  owner_id: string;
  status: string;
  last_error: string | null;
  created_at: string;
  qa_decision: string | null;
  qa_reason: string | null;
  attempt_number: number | null;
  panorama?: {
    id: string;
    original_filename: string;
  };
}

export function useBatchJobs(projectId: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const batchJobsQuery = useQuery({
    queryKey: ["batch_jobs", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("batch_jobs")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as BatchJob[];
    },
    enabled: !!user && !!projectId
  });

  // Real-time subscription for batch jobs - debounced
  useEffect(() => {
    if (!projectId || !user) return;

    let debounceTimeout: ReturnType<typeof setTimeout> | null = null;

    const channel = supabase
      .channel(`batch_jobs_${projectId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "batch_jobs",
          filter: `project_id=eq.${projectId}`
        },
        () => {
          if (debounceTimeout) clearTimeout(debounceTimeout);
          debounceTimeout = setTimeout(() => {
            queryClient.invalidateQueries({ queryKey: ["batch_jobs", projectId] });
          }, 500);
        }
      )
      .subscribe();

    return () => {
      if (debounceTimeout) clearTimeout(debounceTimeout);
      supabase.removeChannel(channel);
    };
  }, [projectId, user, queryClient]);

  const createBatchJob = useMutation({
    mutationFn: async ({
      panoramaUploadIds,
      changeRequest,
      basePrompt,
      styleProfile,
      outputResolution
    }: {
      panoramaUploadIds: string[];
      changeRequest: string;
      basePrompt?: string;
      styleProfile?: Record<string, unknown>;
      outputResolution?: string;
    }) => {
      if (!user) throw new Error("Not authenticated");

      // Enforce limits: 1-20 panoramas per batch
      if (panoramaUploadIds.length === 0) throw new Error("At least 1 panorama is required");
      if (panoramaUploadIds.length > 20) throw new Error("Maximum 20 panoramas per batch");

      // Create the batch job
      const { data: batchJob, error: batchError } = await supabase
        .from("batch_jobs")
        .insert({
          project_id: projectId,
          owner_id: user.id,
          change_request: changeRequest,
          base_prompt: basePrompt || null,
          style_profile: styleProfile || null,
          output_resolution: outputResolution?.toUpperCase() || "2K",
          total_items: panoramaUploadIds.length,
          status: "queued"
        } as any)
        .select()
        .single();

      if (batchError) throw batchError;

      // Create batch job items
      const items = panoramaUploadIds.map(panoramaId => ({
        batch_job_id: batchJob.id,
        panorama_upload_id: panoramaId,
        owner_id: user.id,
        status: "queued"
      } as any));

      const { error: itemsError } = await supabase
        .from("batch_jobs_items")
        .insert(items);

      if (itemsError) throw itemsError;

      return batchJob as BatchJob;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["batch_jobs", projectId] });
    }
  });

  const startBatchJob = useMutation({
    mutationFn: async (batchJobId: string) => {
      const { data, error } = await supabase.functions.invoke("start-batch-job", {
        body: { batch_job_id: batchJobId }
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["batch_jobs", projectId] });
    }
  });

  return {
    batchJobs: batchJobsQuery.data ?? [],
    isLoading: batchJobsQuery.isLoading,
    error: batchJobsQuery.error,
    createBatchJob,
    startBatchJob
  };
}

export function useBatchJobItems(batchJobId: string | null) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const itemsQuery = useQuery({
    queryKey: ["batch_job_items", batchJobId],
    queryFn: async () => {
      if (!batchJobId) return [];

      const { data, error } = await supabase
        .from("batch_jobs_items")
        .select(`
          *,
          panorama:uploads!batch_jobs_items_panorama_upload_id_fkey(id, original_filename, deleted_at)
        `)
        .eq("batch_job_id", batchJobId)
        .order("created_at", { ascending: true });

      if (error) throw error;
      // Filter out items where the source panorama has been deleted
      return (data || []).filter((item: any) => !item.panorama || !item.panorama.deleted_at) as BatchJobItem[];
    },
    enabled: !!user && !!batchJobId
  });

  // Real-time subscription for batch job items - debounced
  useEffect(() => {
    if (!batchJobId || !user) return;

    let debounceTimeout: ReturnType<typeof setTimeout> | null = null;

    const channel = supabase
      .channel(`batch_job_items_${batchJobId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "batch_jobs_items",
          filter: `batch_job_id=eq.${batchJobId}`
        },
        () => {
          if (debounceTimeout) clearTimeout(debounceTimeout);
          debounceTimeout = setTimeout(() => {
            queryClient.invalidateQueries({ queryKey: ["batch_job_items", batchJobId] });
          }, 500);
        }
      )
      .subscribe();

    return () => {
      if (debounceTimeout) clearTimeout(debounceTimeout);
      supabase.removeChannel(channel);
    };
  }, [batchJobId, user, queryClient]);

  return {
    items: itemsQuery.data ?? [],
    isLoading: itemsQuery.isLoading,
    error: itemsQuery.error
  };
}
