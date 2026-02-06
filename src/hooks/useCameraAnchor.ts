import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export type CameraAnchorStatus = 
  | "not_created" 
  | "generating" 
  | "ready" 
  | "failed" 
  | "outdated";

export interface CameraAnchorData {
  anchor_status: CameraAnchorStatus;
  anchor_base_plan_path: string | null;
  anchor_single_overlay_path: string | null;
  anchor_crop_overlay_path: string | null;
  anchor_created_at: string | null;
  anchor_transform_hash: string | null;
  anchor_error_message: string | null;
}

export interface AnchorCreationResult {
  success: boolean;
  scan_id?: string;
  markers_processed?: number;
  anchors_created?: number;
  crops_generated?: number;
  results?: Array<{
    marker_id: string;
    marker_label: string;
    anchor_status: string;
    crop_url: string | null;
    error?: string;
  }>;
  error?: string;
}

export function useCameraAnchor(pipelineId: string | undefined) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Create anchor for a single camera marker (also generates crop)
  const createAnchor = useMutation({
    mutationFn: async (
      input: string | { markerId: string; debugOverlay?: boolean }
    ): Promise<AnchorCreationResult> => {
      if (!pipelineId) throw new Error("No pipeline ID");

      const markerId = typeof input === "string" ? input : input.markerId;
      const debugOverlay = typeof input === "string" ? false : !!input.debugOverlay;

      const { data, error } = await supabase.functions.invoke("create-camera-anchor", {
        body: {
          marker_id: markerId,
          pipeline_id: pipelineId,
          debug_overlay: debugOverlay,
        },
      });

      if (error) throw error;
      if (!data?.success) {
        throw new Error(data?.error || "Failed to create camera anchor");
      }

      return data as AnchorCreationResult;
    },
    onSuccess: (data) => {
      // Invalidate both markers and scan items since anchors now create crops
      queryClient.invalidateQueries({ queryKey: ["camera-markers", pipelineId] });
      queryClient.invalidateQueries({ queryKey: ["camera-scan-items"] });
      queryClient.invalidateQueries({ queryKey: ["latest-camera-scan-id", pipelineId] });
      queryClient.invalidateQueries({ queryKey: ["camera-scan", pipelineId] });
      queryClient.invalidateQueries({ queryKey: ["camera-scan-status", pipelineId] });
      
      const result = data.results?.[0];
      const hasCrop = result?.crop_url ? " with crop" : "";
      toast({
        title: "Anchor Created",
        description: `Camera anchor ready for ${result?.marker_label}${hasCrop}`,
      });
    },
    onError: (error) => {
      toast({
        title: "Anchor Creation Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  // Create anchors for all markers that need them (also generates crops)
  const createAllAnchors = useMutation({
    mutationFn: async (
      input?: { markerIds?: string[]; debugOverlay?: boolean }
    ): Promise<AnchorCreationResult> => {
      if (!pipelineId) throw new Error("No pipeline ID");

      const debugOverlay = !!input?.debugOverlay;

      const { data, error } = await supabase.functions.invoke("create-camera-anchor", {
        body: { 
          pipeline_id: pipelineId,
          create_all: true,
          debug_overlay: debugOverlay,
        },
      });

      if (error) throw error;
      if (!data?.success) {
        throw new Error(data?.error || "Failed to create camera anchors");
      }

      return data as AnchorCreationResult;
    },
    onSuccess: (data) => {
      // Invalidate all related queries
      queryClient.invalidateQueries({ queryKey: ["camera-markers", pipelineId] });
      queryClient.invalidateQueries({ queryKey: ["camera-scan-items"] });
      queryClient.invalidateQueries({ queryKey: ["latest-camera-scan-id", pipelineId] });
      queryClient.invalidateQueries({ queryKey: ["camera-scan", pipelineId] });
      queryClient.invalidateQueries({ queryKey: ["camera-scan-status", pipelineId] });
      
      const failed = data.results?.filter(r => r.anchor_status === "failed").length || 0;
      const cropsGenerated = data.crops_generated || 0;
      
      if (failed === 0) {
        toast({
          title: "All Anchors Created",
          description: `${data.anchors_created} anchors with ${cropsGenerated} crops ready`,
        });
      } else {
        toast({
          title: "Some Anchors Failed",
          description: `Created ${data.anchors_created}, failed ${failed}`,
          variant: "destructive",
        });
      }
    },
    onError: (error) => {
      toast({
        title: "Batch Anchor Creation Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  // Helper to check if all markers have ready anchors
  const allAnchorsReady = (markers: Array<{ anchor_status?: string }>) => {
    if (markers.length === 0) return false;
    return markers.every((m) => m.anchor_status === "ready");
  };

  // Get markers that need anchor creation
  const getMarkersNeedingAnchors = (markers: Array<{ id: string; anchor_status?: string }>) => {
    return markers.filter((m) => 
      !m.anchor_status || 
      m.anchor_status === "not_created" || 
      m.anchor_status === "failed" || 
      m.anchor_status === "outdated"
    );
  };

  // Get status summary for UI
  const getAnchorStatusSummary = (markers: Array<{ anchor_status?: string }>) => {
    const counts = {
      not_created: 0,
      generating: 0,
      ready: 0,
      failed: 0,
      outdated: 0,
    };

    for (const m of markers) {
      const status = (m.anchor_status || "not_created") as CameraAnchorStatus;
      counts[status]++;
    }

    return counts;
  };

  return {
    createAnchor,
    createAllAnchors,
    allAnchorsReady,
    getMarkersNeedingAnchors,
    getAnchorStatusSummary,
    isCreatingAnchor: createAnchor.isPending,
    isCreatingAllAnchors: createAllAnchors.isPending,
  };
}
