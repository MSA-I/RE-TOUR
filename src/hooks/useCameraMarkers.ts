import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

// ============= Types =============

/**
 * A Panorama Point represents a single position with TWO embedded cameras:
 * - Camera A: faces yaw_deg direction
 * - Camera B (Mirror): faces (yaw_deg + 180) % 360 direction
 * Both cameras share the same x_norm, y_norm, fov_deg, and room binding.
 */
export interface PanoramaPoint {
  id: string;
  pipeline_id: string;
  owner_id: string;
  x_norm: number;
  y_norm: number;
  yaw_deg: number; // Camera A yaw
  fov_deg: number;
  label: string;
  room_id: string | null;
  sort_order: number;
  marker_type: string;
  mirror_enabled: boolean;
  created_at: string;
  updated_at: string;
}

/** Derived camera from a panorama point */
export interface DerivedCamera {
  camera_id: string; // `${point_id}:A` or `${point_id}:B`
  panorama_point_id: string;
  camera_slot: "A" | "B";
  x_norm: number;
  y_norm: number;
  yaw_deg: number;
  fov_deg: number;
  label: string;
  room_id: string | null;
  room_name: string | null;
}

// Legacy alias for backward compatibility
export type CameraMarker = PanoramaPoint;

export interface CreatePanoramaPointInput {
  x_norm: number;
  y_norm: number;
  yaw_deg?: number;
  fov_deg?: number;
  label: string;
  room_id?: string | null;
}

export interface UpdatePanoramaPointInput {
  id: string;
  x_norm?: number;
  y_norm?: number;
  yaw_deg?: number;
  fov_deg?: number;
  label?: string;
  room_id?: string | null;
  sort_order?: number;
}

// ============= Utility Functions =============

/**
 * Derive two cameras from a panorama point.
 * Camera A = yaw_deg, Camera B = (yaw_deg + 180) % 360
 */
export function deriveCamerasFromPoint(
  point: PanoramaPoint,
  roomName: string | null = null
): [DerivedCamera, DerivedCamera] {
  const baseProps = {
    panorama_point_id: point.id,
    x_norm: point.x_norm,
    y_norm: point.y_norm,
    fov_deg: point.fov_deg,
    room_id: point.room_id,
    room_name: roomName,
  };

  const cameraA: DerivedCamera = {
    ...baseProps,
    camera_id: `${point.id}:A`,
    camera_slot: "A",
    yaw_deg: point.yaw_deg,
    label: `${point.label} (A)`,
  };

  const cameraB: DerivedCamera = {
    ...baseProps,
    camera_id: `${point.id}:B`,
    camera_slot: "B",
    yaw_deg: (point.yaw_deg + 180) % 360,
    label: `${point.label} (B)`,
  };

  return [cameraA, cameraB];
}

// ============= Hook =============

export function useCameraMarkers(pipelineId: string | undefined) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Fetch all panorama points for this pipeline
  const markersQuery = useQuery({
    queryKey: ["camera-markers", pipelineId],
    queryFn: async () => {
      if (!pipelineId || !user) return [];

      const { data, error } = await supabase
        .from("pipeline_camera_markers")
        .select("*")
        .eq("pipeline_id", pipelineId)
        .order("sort_order", { ascending: true });

      if (error) throw error;
      return (data || []) as PanoramaPoint[];
    },
    enabled: !!pipelineId && !!user,
  });

  // Create a new panorama point
  const createMarker = useMutation({
    mutationFn: async (input: CreatePanoramaPointInput) => {
      if (!pipelineId || !user) throw new Error("No pipeline or user");

      // Get current max sort_order
      const currentMarkers = markersQuery.data || [];
      const maxSortOrder = currentMarkers.reduce(
        (max, m) => Math.max(max, m.sort_order),
        -1
      );

      const { data, error } = await supabase
        .from("pipeline_camera_markers")
        .insert({
          pipeline_id: pipelineId,
          owner_id: user.id,
          x_norm: input.x_norm,
          y_norm: input.y_norm,
          yaw_deg: input.yaw_deg ?? 0,
          fov_deg: input.fov_deg ?? 80,
          label: input.label,
          room_id: input.room_id ?? null,
          sort_order: maxSortOrder + 1,
          marker_type: "panorama_point",
          mirror_enabled: true,
        })
        .select()
        .single();

      if (error) throw error;
      return data as PanoramaPoint;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["camera-markers", pipelineId] });
    },
    onError: (error) => {
      toast({
        title: "Failed to add panorama point",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Update a panorama point
  const updateMarker = useMutation({
    mutationFn: async (input: UpdatePanoramaPointInput) => {
      const { id, ...updates } = input;

      const { data, error } = await supabase
        .from("pipeline_camera_markers")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data as PanoramaPoint;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["camera-markers", pipelineId] });
    },
    onError: (error) => {
      toast({
        title: "Failed to update panorama point",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Delete a panorama point
  const deleteMarker = useMutation({
    mutationFn: async (markerId: string) => {
      const { error } = await supabase
        .from("pipeline_camera_markers")
        .delete()
        .eq("id", markerId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["camera-markers", pipelineId] });
    },
    onError: (error) => {
      toast({
        title: "Failed to delete panorama point",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Duplicate a panorama point
  const duplicateMarker = useMutation({
    mutationFn: async (markerId: string) => {
      if (!pipelineId || !user) throw new Error("No pipeline or user");

      const marker = markersQuery.data?.find((m) => m.id === markerId);
      if (!marker) throw new Error("Panorama point not found");

      const currentMarkers = markersQuery.data || [];
      const maxSortOrder = currentMarkers.reduce(
        (max, m) => Math.max(max, m.sort_order),
        -1
      );

      // Generate new label with incremented suffix
      const baseLabelMatch = marker.label.match(/^(.+?)(?:_(\d+))?$/);
      const baseLabel = baseLabelMatch?.[1] || marker.label;
      const existingLabels = currentMarkers.map((m) => m.label);
      let newLabel = `${baseLabel}_copy`;
      let counter = 1;
      while (existingLabels.includes(newLabel)) {
        newLabel = `${baseLabel}_copy_${counter}`;
        counter++;
      }

      const { data, error } = await supabase
        .from("pipeline_camera_markers")
        .insert({
          pipeline_id: pipelineId,
          owner_id: user.id,
          x_norm: Math.min(1, marker.x_norm + 0.05), // Offset slightly
          y_norm: Math.min(1, marker.y_norm + 0.05),
          yaw_deg: marker.yaw_deg,
          fov_deg: marker.fov_deg,
          label: newLabel,
          room_id: marker.room_id,
          sort_order: maxSortOrder + 1,
          marker_type: "panorama_point",
          mirror_enabled: true,
        })
        .select()
        .single();

      if (error) throw error;
      return data as PanoramaPoint;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["camera-markers", pipelineId] });
    },
    onError: (error) => {
      toast({
        title: "Failed to duplicate panorama point",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Reorder panorama points
  const reorderMarkers = useMutation({
    mutationFn: async (orderedIds: string[]) => {
      // Update sort_order for each marker
      const updates = orderedIds.map((id, index) => ({
        id,
        sort_order: index,
      }));

      for (const update of updates) {
        const { error } = await supabase
          .from("pipeline_camera_markers")
          .update({ sort_order: update.sort_order })
          .eq("id", update.id);

        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["camera-markers", pipelineId] });
    },
    onError: (error) => {
      toast({
        title: "Failed to reorder panorama points",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Confirm camera plan (via edge function for backend-owned transition)
  const confirmCameraPlan = useMutation({
    mutationFn: async () => {
      if (!pipelineId) throw new Error("No pipeline");

      // Client-side guards (backend validates too)
      const markers = markersQuery.data || [];
      if (markers.length === 0) {
        throw new Error("At least one panorama point is required");
      }
      
      // Validate all panorama points have room bindings
      const unboundMarkers = markers.filter((m) => !m.room_id);
      if (unboundMarkers.length > 0) {
        throw new Error(
          `${unboundMarkers.length} panorama point(s) need a room assigned: ${unboundMarkers.map((m) => m.label).join(", ")}`
        );
      }

      const { data, error } = await supabase.functions.invoke("confirm-camera-plan", {
        body: { pipeline_id: pipelineId },
      });

      if (error) throw error;
      if (!data?.success) {
        throw new Error(data?.error || "Failed to confirm camera plan");
      }

      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["pipeline", pipelineId] });
      queryClient.invalidateQueries({ queryKey: ["floorplan-pipelines"] });
      queryClient.invalidateQueries({ queryKey: ["whole-apartment-spaces", pipelineId] });
      // CRITICAL: Also invalidate render queries so prompt previews refresh
      queryClient.invalidateQueries({ queryKey: ["space-renders-for-prompts", pipelineId] });
      queryClient.invalidateQueries({ queryKey: ["pipeline-spaces-for-scan", pipelineId] });
      
      const promptsCreated = data?.prompts_generated || 0;
      const promptsUpdated = data?.prompts_updated || 0;
      const totalPrompts = promptsCreated + promptsUpdated;
      const errors = data?.prompt_errors || 0;
      
      toast({
        title: "Camera Plan Confirmed",
        description: errors > 0 
          ? `${data?.marker_count || 0} markers processed, ${totalPrompts} prompts ready. ${errors} errors occurred.`
          : `${data?.marker_count || 0} markers processed, ${totalPrompts} prompts ready in Spaces.`,
        variant: errors > 0 ? "destructive" : "default",
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to confirm camera plan",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  // Generate default label based on existing panorama points
  const generateLabel = (prefix: string = "Pano"): string => {
    const markers = markersQuery.data || [];
    const existingLabels = markers.map((m) => m.label);
    let counter = 1;
    let label = `${prefix}_${String(counter).padStart(2, "0")}`;
    while (existingLabels.includes(label)) {
      counter++;
      label = `${prefix}_${String(counter).padStart(2, "0")}`;
    }
    return label;
  };

  // Get all derived cameras from all panorama points
  const getAllDerivedCameras = (roomNameMap?: Map<string, string>): DerivedCamera[] => {
    const points = markersQuery.data || [];
    return points.flatMap((point) => {
      const roomName = roomNameMap?.get(point.room_id || "") || null;
      return deriveCamerasFromPoint(point, roomName);
    });
  };

  return {
    // Panorama points (the primary data)
    markers: markersQuery.data || [],
    panoramaPoints: markersQuery.data || [],
    isLoading: markersQuery.isLoading,
    isError: markersQuery.isError,
    error: markersQuery.error,
    
    // Mutations
    createMarker,
    updateMarker,
    deleteMarker,
    duplicateMarker,
    reorderMarkers,
    confirmCameraPlan,
    
    // Utilities
    generateLabel,
    getAllDerivedCameras,
    deriveCamerasFromPoint,
    
    // State
    isConfirming: confirmCameraPlan.isPending,
  };
}
