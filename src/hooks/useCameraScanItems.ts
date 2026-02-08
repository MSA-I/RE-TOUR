import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Camera Scan Item - stored per-marker results with crops and label detection
 */
export interface CameraScanItem {
  id: string;
  scan_id: string;
  marker_id: string;
  owner_id: string;
  
  // OCR/Label detection
  detected_room_label: string | null;
  detected_label_confidence: number;
  detected_label_bbox_norm: { x: number; y: number; w: number; h: number } | null;
  
  // Crop asset
  crop_storage_path: string | null;
  crop_public_url: string | null;
  crop_width: number | null;
  crop_height: number | null;
  crop_expires_at: string | null;
  
  // Prompt hints
  prompt_hint_text: string | null;
  
  is_temporary: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Hook to fetch scan items (crops + label detections) for a pipeline's latest scan
 */
export function useCameraScanItems(pipelineId: string | undefined, scanId?: string | null) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // First get the latest scan ID if not provided
  const latestScanQuery = useQuery({
    queryKey: ["latest-camera-scan-id", pipelineId],
    queryFn: async () => {
      if (!pipelineId || !user) return null;

      const { data, error } = await supabase
        .from("pipeline_camera_scans")
        .select("id")
        .eq("pipeline_id", pipelineId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      return data?.id || null;
    },
    enabled: !!pipelineId && !!user && !scanId,
  });

  const effectiveScanId = scanId || latestScanQuery.data;

  // Fetch scan items for the scan
  const itemsQuery = useQuery({
    queryKey: ["camera-scan-items", effectiveScanId],
    queryFn: async () => {
      if (!effectiveScanId || !user) return [];

      const { data, error } = await supabase
        .from("pipeline_camera_scan_items")
        .select("*")
        .eq("scan_id", effectiveScanId)
        .order("created_at", { ascending: true });

      if (error) throw error;
      
      return (data || []).map(item => ({
        id: item.id,
        scan_id: item.scan_id,
        marker_id: item.marker_id,
        owner_id: item.owner_id,
        detected_room_label: item.detected_room_label,
        detected_label_confidence: Number(item.detected_label_confidence) || 0,
        detected_label_bbox_norm: item.detected_label_bbox_norm as CameraScanItem["detected_label_bbox_norm"],
        crop_storage_path: item.crop_storage_path,
        crop_public_url: item.crop_public_url,
        crop_width: item.crop_width,
        crop_height: item.crop_height,
        crop_expires_at: item.crop_expires_at,
        prompt_hint_text: item.prompt_hint_text,
        is_temporary: item.is_temporary ?? true,
        created_at: item.created_at,
        updated_at: item.updated_at,
      })) as CameraScanItem[];
    },
    enabled: !!effectiveScanId && !!user,
  });

  // Build a lookup map by marker ID
  const itemsByMarkerId = new Map<string, CameraScanItem>();
  for (const item of itemsQuery.data || []) {
    itemsByMarkerId.set(item.marker_id, item);
  }

  // Get item for a specific marker
  const getItemForMarker = (markerId: string): CameraScanItem | undefined => {
    return itemsByMarkerId.get(markerId);
  };

  // Get crop URL for a specific marker
  const getCropUrlForMarker = (markerId: string): string | null => {
    const item = itemsByMarkerId.get(markerId);
    if (!item?.crop_public_url) return null;
    
    // Check if expired
    if (item.crop_expires_at) {
      const expiresAt = new Date(item.crop_expires_at);
      if (expiresAt < new Date()) {
        console.warn(`[useCameraScanItems] Crop for marker ${markerId} has expired`);
        return null;
      }
    }
    
    return item.crop_public_url;
  };

  // Invalidate items when scan changes
  const invalidateItems = () => {
    queryClient.invalidateQueries({ queryKey: ["camera-scan-items", effectiveScanId] });
    queryClient.invalidateQueries({ queryKey: ["latest-camera-scan-id", pipelineId] });
  };

  return {
    items: itemsQuery.data || [],
    isLoading: latestScanQuery.isLoading || itemsQuery.isLoading,
    error: latestScanQuery.error || itemsQuery.error,
    
    // Helpers
    getItemForMarker,
    getCropUrlForMarker,
    itemsByMarkerId,
    
    // Actions
    invalidateItems,
    
    // Computed
    hasCrops: (itemsQuery.data || []).some(i => !!i.crop_public_url),
    hasLabels: (itemsQuery.data || []).some(i => !!i.detected_room_label),
    totalCrops: (itemsQuery.data || []).filter(i => !!i.crop_public_url).length,
    totalLabels: (itemsQuery.data || []).filter(i => !!i.detected_room_label).length,
  };
}
