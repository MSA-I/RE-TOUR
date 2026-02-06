import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

// ============= Types =============

/** Embedded camera context within a panorama point scan result */
export interface EmbeddedCameraContext {
  camera_slot: "A" | "B";
  yaw_deg: number;
  direction_context: {
    primary_view_target: string;
    likely_visible_adjacent_rooms: Array<{ room_id: string; room_name: string; confidence: number }>;
    likely_visible_openings: Array<{ type: string; side: string; confidence: number }>;
  };
  prompt_hints: string[];
  warnings: string[];
}

/** Scan result for a single panorama point (contains 2 embedded cameras) */
export interface PanoramaPointScanResult {
  panorama_point_id: string;
  panorama_point_label: string;
  normalized_position: { x_norm: number; y_norm: number };
  fov_deg: number;
  room_validation: {
    bound_room_id: string | null;
    ai_room_id: string | null;
    match: boolean;
    confidence: number;
  };
  embedded_cameras: [EmbeddedCameraContext, EmbeddedCameraContext]; // Always A and B
  global_rules: {
    forbid_new_rooms: boolean;
    forbid_new_openings: boolean;
    allowed_adjacent_rooms: string[];
  };
}

// Legacy type for backward compatibility
export interface CameraScanResult {
  camera_id: string;
  camera_label: string;
  normalized_position: { x_norm: number; y_norm: number };
  room_validation: {
    bound_room_id: string | null;
    ai_room_id: string | null;
    match: boolean;
    confidence: number;
  };
  direction_context: {
    yaw_deg: number;
    fov_deg: number;
    primary_view_target: string;
    likely_visible_adjacent_rooms: Array<{ room_id: string; room_name: string; confidence: number }>;
    likely_visible_openings: Array<{ type: string; side: string; confidence: number }>;
  };
  safety_rules: {
    forbid_new_rooms: boolean;
    forbid_new_openings: boolean;
    allowed_adjacent_rooms: string[];
  };
  prompt_hints: string[];
  warnings: string[];
}

export interface CameraScan {
  id: string;
  pipeline_id: string;
  owner_id: string;
  status: "running" | "completed" | "failed";
  model_used: string | null;
  results_json: PanoramaPointScanResult[] | null;
  version_hash: string;
  created_at: string;
  updated_at: string;
}

export type CameraScanStatus = "needs_scan" | "running" | "completed" | "failed";

// ============= Hook =============

export function useCameraScan(pipelineId: string | undefined) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Fetch latest scan for this pipeline
  const scanQuery = useQuery({
    queryKey: ["camera-scan", pipelineId],
    queryFn: async () => {
      if (!pipelineId || !user) return null;

      const { data, error } = await supabase
        .from("pipeline_camera_scans")
        .select("*")
        .eq("pipeline_id", pipelineId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;
      
      // Cast the data with proper type handling
      return {
        id: data.id,
        pipeline_id: data.pipeline_id,
        owner_id: data.owner_id,
        status: data.status as "running" | "completed" | "failed",
        model_used: data.model_used,
        results_json: (Array.isArray(data.results_json) ? data.results_json : null) as unknown as PanoramaPointScanResult[] | null,
        version_hash: data.version_hash,
        created_at: data.created_at,
        updated_at: data.updated_at,
      } as CameraScan;
    },
    enabled: !!pipelineId && !!user,
  });

  // Fetch pipeline scan status
  const statusQuery = useQuery({
    queryKey: ["camera-scan-status", pipelineId],
    queryFn: async () => {
      if (!pipelineId || !user) return null;

      const { data, error } = await supabase
        .from("floorplan_pipelines")
        .select("camera_scan_status, camera_scan_updated_at")
        .eq("id", pipelineId)
        .single();

      if (error) throw error;
      return {
        status: (data?.camera_scan_status || "needs_scan") as CameraScanStatus,
        updatedAt: data?.camera_scan_updated_at,
      };
    },
    enabled: !!pipelineId && !!user,
  });

  // Run camera scan
  const runScan = useMutation({
    mutationFn: async () => {
      if (!pipelineId) throw new Error("No pipeline");

      const { data, error } = await supabase.functions.invoke("run-camera-scan", {
        body: { pipeline_id: pipelineId },
      });

      if (error) throw error;
      if (!data?.success) {
        throw new Error(data?.error || "Scan failed");
      }

      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["camera-scan", pipelineId] });
      queryClient.invalidateQueries({ queryKey: ["camera-scan-status", pipelineId] });
      queryClient.invalidateQueries({ queryKey: ["pipeline", pipelineId] });
      toast({
        title: "Camera Scan Complete",
        description: `Analyzed ${data.results?.length || 0} panorama points (${(data.results?.length || 0) * 2} cameras)`,
      });
    },
    onError: (error) => {
      queryClient.invalidateQueries({ queryKey: ["camera-scan-status", pipelineId] });
      toast({
        title: "Camera Scan Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  // Invalidate scan (when markers change)
  const invalidateScan = useMutation({
    mutationFn: async () => {
      if (!pipelineId) throw new Error("No pipeline");

      const { error } = await supabase
        .from("floorplan_pipelines")
        .update({
          camera_scan_status: "needs_scan",
          camera_scan_updated_at: new Date().toISOString(),
        })
        .eq("id", pipelineId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["camera-scan-status", pipelineId] });
      queryClient.invalidateQueries({ queryKey: ["pipeline", pipelineId] });
    },
  });

  // Get scan result for a specific panorama point
  const getPanoramaPointResult = (pointId: string): PanoramaPointScanResult | undefined => {
    const results = scanQuery.data?.results_json;
    if (!results) return undefined;
    return results.find((r) => r.panorama_point_id === pointId);
  };

  // Get embedded camera context for a specific camera (A or B)
  const getCameraContext = (
    pointId: string,
    slot: "A" | "B"
  ): EmbeddedCameraContext | undefined => {
    const pointResult = getPanoramaPointResult(pointId);
    if (!pointResult) return undefined;
    return pointResult.embedded_cameras.find((c) => c.camera_slot === slot);
  };

  return {
    // Latest scan
    scan: scanQuery.data,
    scanStatus: statusQuery.data?.status || "needs_scan",
    scanUpdatedAt: statusQuery.data?.updatedAt,
    isLoadingScan: scanQuery.isLoading || statusQuery.isLoading,
    
    // Actions
    runScan,
    invalidateScan,
    isScanning: runScan.isPending,
    
    // Helpers
    getPanoramaPointResult,
    getCameraContext,
    scanResults: scanQuery.data?.results_json || [],
    
    // Computed
    canContinueToStep3: statusQuery.data?.status === "completed",
  };
}
