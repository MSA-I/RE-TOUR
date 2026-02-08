import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useEffect, useRef } from "react";

export interface CameraRender {
  upload_id: string;
  camera_preset: string;
  prompt_used?: string;
  qa_decision?: "approved" | "rejected" | "pending";
  qa_reason?: string;
  created_at: string;
}

export interface RoomSubPipeline {
  id: string;
  pipeline_id: string;
  owner_id: string;
  room_id: string;
  room_type: string;
  room_label?: string;
  bounds?: Record<string, unknown>;
  status: "pending" | "generating_cameras" | "cameras_review" | "generating_panorama" | "completed" | "failed";
  camera_renders: CameraRender[];
  panorama_upload_id?: string;
  panorama_qa_decision?: string;
  panorama_qa_reason?: string;
  created_at: string;
  updated_at: string;
}

export interface RoomSubPipelineEvent {
  id: string;
  room_sub_pipeline_id: string;
  owner_id: string;
  step_type: string;
  progress_int: number;
  ts: string;
  type: string;
  message: string;
}

export function useRoomSubPipelines(pipelineId: string | undefined) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const subscriptionRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Fetch all room sub-pipelines for a parent pipeline
  const roomSubPipelinesQuery = useQuery({
    queryKey: ["room-sub-pipelines", pipelineId],
    queryFn: async () => {
      if (!pipelineId) return [];

      const { data, error } = await supabase
        .from("room_sub_pipelines")
        .select("*")
        .eq("pipeline_id", pipelineId)
        .order("room_id", { ascending: true });

      if (error) throw error;
      
      return (data || []).map(row => ({
        ...row,
        camera_renders: (row.camera_renders as unknown as CameraRender[]) || [],
      })) as RoomSubPipeline[];
    },
    enabled: !!pipelineId && !!user,
    staleTime: 30000,
  });

  // Real-time subscription for room sub-pipeline updates
  useEffect(() => {
    if (!pipelineId || !user) return;

    // Clean up existing subscription
    if (subscriptionRef.current) {
      subscriptionRef.current.unsubscribe();
    }

    const channel = supabase
      .channel(`room-sub-pipelines-${pipelineId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "room_sub_pipelines",
          filter: `pipeline_id=eq.${pipelineId}`,
        },
        () => {
          // Debounce invalidation
          setTimeout(() => {
            queryClient.invalidateQueries({ queryKey: ["room-sub-pipelines", pipelineId] });
          }, 500);
        }
      )
      .subscribe();

    subscriptionRef.current = channel;

    return () => {
      channel.unsubscribe();
    };
  }, [pipelineId, user, queryClient]);

  // Start camera generation for a room
  const startRoomCameras = useMutation({
    mutationFn: async ({ roomSubPipelineId }: { roomSubPipelineId: string }) => {
      const { data, error } = await supabase.functions.invoke("run-room-camera-batch", {
        body: { room_sub_pipeline_id: roomSubPipelineId },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["room-sub-pipelines", pipelineId] });
    },
  });

  // Start panorama generation for a room
  const startRoomPanorama = useMutation({
    mutationFn: async ({ roomSubPipelineId }: { roomSubPipelineId: string }) => {
      const { data, error } = await supabase.functions.invoke("run-room-panorama", {
        body: { room_sub_pipeline_id: roomSubPipelineId },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["room-sub-pipelines", pipelineId] });
    },
  });

  // Approve/reject a camera render
  const reviewCameraRender = useMutation({
    mutationFn: async ({ 
      roomSubPipelineId, 
      uploadId, 
      decision, 
      reason 
    }: { 
      roomSubPipelineId: string; 
      uploadId: string; 
      decision: "approved" | "rejected";
      reason?: string;
    }) => {
      // Get current room sub-pipeline
      const { data: room, error: fetchError } = await supabase
        .from("room_sub_pipelines")
        .select("camera_renders")
        .eq("id", roomSubPipelineId)
        .single();

      if (fetchError) throw fetchError;

      const renders = (room.camera_renders as unknown as CameraRender[]) || [];
      const updatedRenders = renders.map(r => 
        r.upload_id === uploadId 
          ? { ...r, qa_decision: decision, qa_reason: reason }
          : r
      );

      const { error: updateError } = await supabase
        .from("room_sub_pipelines")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update({ camera_renders: updatedRenders as any })
        .eq("id", roomSubPipelineId);

      if (updateError) throw updateError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["room-sub-pipelines", pipelineId] });
    },
  });

  // Get aggregate stats
  const stats = {
    total: roomSubPipelinesQuery.data?.length || 0,
    pending: roomSubPipelinesQuery.data?.filter(r => r.status === "pending").length || 0,
    inProgress: roomSubPipelinesQuery.data?.filter(r => 
      ["generating_cameras", "cameras_review", "generating_panorama"].includes(r.status)
    ).length || 0,
    completed: roomSubPipelinesQuery.data?.filter(r => r.status === "completed").length || 0,
    failed: roomSubPipelinesQuery.data?.filter(r => r.status === "failed").length || 0,
  };

  return {
    roomSubPipelines: roomSubPipelinesQuery.data || [],
    isLoading: roomSubPipelinesQuery.isLoading,
    error: roomSubPipelinesQuery.error,
    stats,
    startRoomCameras,
    startRoomPanorama,
    reviewCameraRender,
    refetch: roomSubPipelinesQuery.refetch,
  };
}

export function useRoomSubPipelineEvents(roomSubPipelineId: string | undefined) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["room-sub-pipeline-events", roomSubPipelineId],
    queryFn: async () => {
      if (!roomSubPipelineId) return [];

      const { data, error } = await supabase
        .from("room_sub_pipeline_events")
        .select("*")
        .eq("room_sub_pipeline_id", roomSubPipelineId)
        .order("ts", { ascending: true });

      if (error) throw error;
      return data as RoomSubPipelineEvent[];
    },
    enabled: !!roomSubPipelineId && !!user,
    staleTime: 5000,
  });
}
