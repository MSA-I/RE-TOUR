import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useEffect } from "react";

export interface ImageEditJob {
  id: string;
  owner_id: string;
  project_id: string;
  source_upload_id: string;
  output_upload_id: string | null;
  change_description: string;
  aspect_ratio: string;
  output_quality: string;
  status: "queued" | "running" | "completed" | "failed";
  progress_int: number;
  progress_message: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  source_upload?: {
    id: string;
    bucket: string;
    path: string;
    original_filename: string | null;
  };
  output_upload?: {
    id: string;
    bucket: string;
    path: string;
    original_filename: string | null;
  } | null;
}

export interface ImageEditJobEvent {
  id: string;
  job_id: string;
  owner_id: string;
  type: string;
  message: string;
  progress_int: number;
  ts: string;
}

export function useImageEditJobs(projectId: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const jobsQuery = useQuery({
    queryKey: ["image_edit_jobs", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("image_edit_jobs")
        .select(`
          *,
          source_upload:uploads!image_edit_jobs_source_upload_id_fkey(*),
          output_upload:uploads!image_edit_jobs_output_upload_id_fkey(*)
        `)
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as ImageEditJob[];
    },
    enabled: !!user && !!projectId
  });

  // Subscribe to realtime updates
  useEffect(() => {
    if (!projectId || !user) return;

    let debounceTimeout: ReturnType<typeof setTimeout> | null = null;

    const channel = supabase
      .channel(`image_edit_jobs_${projectId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "image_edit_jobs",
          filter: `project_id=eq.${projectId}`
        },
        () => {
          if (debounceTimeout) clearTimeout(debounceTimeout);
          debounceTimeout = setTimeout(() => {
            queryClient.invalidateQueries({ queryKey: ["image_edit_jobs", projectId] });
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
      sourceUploadId,
      changeDescription,
      refUploadIds = []
    }: {
      sourceUploadId: string;
      changeDescription: string;
      refUploadIds?: string[];
    }) => {
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("image_edit_jobs")
        .insert({
          project_id: projectId,
          owner_id: user.id,
          source_upload_id: sourceUploadId,
          change_description: changeDescription,
          status: "queued"
        })
        .select()
        .single();

      if (error) throw error;
      return data as ImageEditJob;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["image_edit_jobs", projectId] });
    }
  });

  const startJob = useMutation({
    mutationFn: async (jobId: string) => {
      const { data, error } = await supabase.functions.invoke("start-image-edit-job", {
        body: { job_id: jobId }
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["image_edit_jobs", projectId] });
    }
  });

  const deleteJob = useMutation({
    mutationFn: async (jobId: string) => {
      const { error } = await supabase
        .from("image_edit_jobs")
        .delete()
        .eq("id", jobId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["image_edit_jobs", projectId] });
    }
  });

  // Start Over - Reset job to queued and clear outputs
  const startOverJob = useMutation({
    mutationFn: async (jobId: string) => {
      if (!user) throw new Error("Not authenticated");
      
      // Clear output and reset status
      const { error } = await supabase
        .from("image_edit_jobs")
        .update({
          status: "queued",
          output_upload_id: null,
          progress_int: 0,
          progress_message: null,
          last_error: null,
          updated_at: new Date().toISOString()
        })
        .eq("id", jobId)
        .eq("owner_id", user.id);
      
      if (error) throw error;
      
      // Delete old events
      await supabase
        .from("image_edit_job_events")
        .delete()
        .eq("job_id", jobId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["image_edit_jobs", projectId] });
      queryClient.invalidateQueries({ queryKey: ["image_edit_job_events"] });
    }
  });

  // Retry - Re-run same job (only for failed jobs)
  const retryJob = useMutation({
    mutationFn: async (jobId: string) => {
      if (!user) throw new Error("Not authenticated");
      
      // Reset to queued
      const { error } = await supabase
        .from("image_edit_jobs")
        .update({
          status: "queued",
          progress_int: 0,
          progress_message: null,
          last_error: null,
          updated_at: new Date().toISOString()
        })
        .eq("id", jobId)
        .eq("owner_id", user.id);
      
      if (error) throw error;
      
      // Start the job immediately
      const { data, error: startError } = await supabase.functions.invoke("start-image-edit-job", {
        body: { job_id: jobId }
      });
      
      if (startError) throw startError;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["image_edit_jobs", projectId] });
    }
  });

  return {
    jobs: jobsQuery.data ?? [],
    isLoading: jobsQuery.isLoading,
    error: jobsQuery.error,
    createJob,
    startJob,
    deleteJob,
    startOverJob,
    retryJob
  };
}

export function useImageEditJobEvents(jobId: string | null) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const eventsQuery = useQuery({
    queryKey: ["image_edit_job_events", jobId],
    queryFn: async () => {
      if (!jobId) return [];
      const { data, error } = await supabase
        .from("image_edit_job_events")
        .select("*")
        .eq("job_id", jobId)
        .order("ts", { ascending: true });
      if (error) throw error;
      return data as ImageEditJobEvent[];
    },
    enabled: !!user && !!jobId
  });

  // Subscribe to realtime events
  useEffect(() => {
    if (!jobId || !user) return;

    const channel = supabase
      .channel(`image_edit_job_events_${jobId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "image_edit_job_events",
          filter: `job_id=eq.${jobId}`
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["image_edit_job_events", jobId] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [jobId, user, queryClient]);

  return {
    events: eventsQuery.data ?? [],
    isLoading: eventsQuery.isLoading
  };
}
