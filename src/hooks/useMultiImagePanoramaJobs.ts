import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useEffect, useState } from "react";

export interface MultiImagePanoramaJob {
  id: string;
  owner_id: string;
  project_id: string;
  status: "pending" | "running" | "completed" | "failed";
  input_upload_ids: string[];
  output_upload_id: string | null;
  camera_position: string | null;
  forward_direction: string | null;
  output_resolution: string | null;
  aspect_ratio: string | null;
  progress_int: number | null;
  progress_message: string | null;
  last_error: string | null;
  prompt_used: string | null;
  created_at: string;
  updated_at: string;
}

export interface MultiImagePanoramaEvent {
  id: string;
  job_id: string;
  owner_id: string;
  type: string;
  message: string;
  progress_int: number;
  ts: string;
}

export function useMultiImagePanoramaJobs(projectId: string) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch all jobs for this project
  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ["multi-image-panorama-jobs", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("multi_image_panorama_jobs")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data || []) as MultiImagePanoramaJob[];
    },
    enabled: !!user && !!projectId,
  });

  // Create a new job
  const createJob = useMutation({
    mutationFn: async ({
      inputUploadIds,
      cameraPosition,
      forwardDirection,
      outputResolution = "2K",
      aspectRatio = "2:1",
    }: {
      inputUploadIds: string[];
      cameraPosition?: string;
      forwardDirection?: string;
      outputResolution?: string;
      aspectRatio?: string;
    }) => {
      if (!user) throw new Error("Not authenticated");
      if (inputUploadIds.length < 2) throw new Error("At least 2 images required");

      const { data, error } = await supabase
        .from("multi_image_panorama_jobs")
        .insert({
          owner_id: user.id,
          project_id: projectId,
          input_upload_ids: inputUploadIds,
          camera_position: cameraPosition || "center of the main living space at eye-level",
          forward_direction: forwardDirection || "toward the primary focal point",
          output_resolution: outputResolution,
          aspect_ratio: aspectRatio,
          status: "pending",
        })
        .select()
        .single();

      if (error) throw error;
      return data as MultiImagePanoramaJob;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["multi-image-panorama-jobs", projectId] });
    },
  });

  // Start a job (invoke edge function)
  const startJob = useMutation({
    mutationFn: async (jobId: string) => {
      const { data, error } = await supabase.functions.invoke("run-multi-image-panorama", {
        body: { job_id: jobId },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["multi-image-panorama-jobs", projectId] });
    },
    onError: (error) => {
      toast({
        title: "Failed to start panorama generation",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  // Delete a job
  const deleteJob = useMutation({
    mutationFn: async (jobId: string) => {
      const { error } = await supabase
        .from("multi_image_panorama_jobs")
        .delete()
        .eq("id", jobId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["multi-image-panorama-jobs", projectId] });
      toast({ title: "Job deleted" });
    },
  });

  return {
    jobs,
    isLoading,
    createJob,
    startJob,
    deleteJob,
  };
}

// Hook for real-time events
export function useMultiImagePanoramaEvents(jobId: string | null) {
  const [events, setEvents] = useState<MultiImagePanoramaEvent[]>([]);

  useEffect(() => {
    if (!jobId) {
      setEvents([]);
      return;
    }

    // Fetch initial events
    const fetchEvents = async () => {
      const { data } = await supabase
        .from("multi_image_panorama_events")
        .select("*")
        .eq("job_id", jobId)
        .order("ts", { ascending: true });

      if (data) setEvents(data as MultiImagePanoramaEvent[]);
    };

    fetchEvents();

    // Subscribe to new events
    const channel = supabase
      .channel(`multi-panorama-events-${jobId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "multi_image_panorama_events",
          filter: `job_id=eq.${jobId}`,
        },
        (payload) => {
          setEvents((prev) => [...prev, payload.new as MultiImagePanoramaEvent]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [jobId]);

  return events;
}
