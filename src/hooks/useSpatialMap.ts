import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

// ============= Types =============

export interface DetectedRoom {
  id: string;           // New format uses 'id'
  room_id?: string;     // Legacy format uses 'room_id'
  type: "room" | "zone" | string;
  name: string;
  label?: string;
  bounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  center?: { x: number; y: number };
  area_sqm?: number;
  suggested_cameras?: number;
  confidence: number;
}

export interface RoomAdjacency {
  from: string;
  to: string;
  connection_type: "door" | "opening" | "archway" | "pass_through" | "unknown";
  confidence?: number;
}

export interface RoomLock {
  room_id: string;
  must_include?: string[];
  must_not_include?: string[];
  scale_notes?: string;
}

export interface VisibilityHint {
  room_id: string;
  hints: string[];
}

export interface LocksJson {
  furniture_locks?: RoomLock[];
  visibility_hints?: VisibilityHint[];
  scale_locked?: boolean;
  geometry_locked?: boolean;
}

export interface SpatialMap {
  id: string;
  pipeline_id: string;
  owner_id: string;
  version: number;
  rooms: DetectedRoom[];
  adjacency_graph: RoomAdjacency[];
  locks_json: LocksJson;
  raw_analysis?: string;
  created_at: string;
  updated_at: string;
}

// Helper to get room ID (handles both old and new formats)
export function getRoomId(room: DetectedRoom): string {
  return room.id || room.room_id || "unknown";
}

// Helper to get room display name (canonical name)
export function getRoomDisplayName(room: DetectedRoom): string {
  return room.label || room.name?.replace(/_/g, " ") || "Unknown Room";
}

// Helper to get canonical room name by ID from a rooms array
export function getCanonicalRoomName(roomId: string, rooms: DetectedRoom[]): string | null {
  const room = rooms.find(r => getRoomId(r) === roomId);
  return room ? getRoomDisplayName(room) : null;
}

// Build a lookup map from room IDs to canonical names
export function buildRoomNameLookup(rooms: DetectedRoom[]): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const room of rooms) {
    const id = getRoomId(room);
    const name = getRoomDisplayName(room);
    lookup.set(id, name);
  }
  return lookup;
}

// ============= Hook =============

export function useSpatialMap(pipelineId: string | undefined) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const spatialMapQuery = useQuery({
    queryKey: ["spatial-map", pipelineId],
    queryFn: async () => {
      if (!pipelineId) return null;

      const { data, error } = await supabase
        .from("pipeline_spatial_maps")
        .select("*")
        .eq("pipeline_id", pipelineId)
        .maybeSingle();

      if (error) throw error;
      
      if (data) {
        return {
          ...data,
          rooms: (data.rooms as unknown as DetectedRoom[]) || [],
          adjacency_graph: (data.adjacency_graph as unknown as RoomAdjacency[]) || [],
          locks_json: (data.locks_json as unknown as LocksJson) || {},
          version: data.version ?? 1,
        } as SpatialMap;
      }
      
      return null;
    },
    enabled: !!pipelineId && !!user,
    staleTime: 30000,
  });

  const runSpatialDecomposition = useMutation({
    mutationFn: async ({ 
      pipelineId, 
      floorPlanUploadId 
    }: { 
      pipelineId: string; 
      floorPlanUploadId: string;
    }) => {
      const { data, error } = await supabase.functions.invoke("run-spatial-decomposition", {
        body: { pipeline_id: pipelineId, floor_plan_upload_id: floorPlanUploadId },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["spatial-map", pipelineId] });
      queryClient.invalidateQueries({ queryKey: ["floorplan-pipelines"] });
    },
  });

  const updateSpatialMap = useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string;
      updates: Partial<Pick<SpatialMap, "rooms" | "adjacency_graph" | "locks_json" | "version">>;
    }) => {
      // Cast to Json-compatible types for Supabase
      const updatePayload: Record<string, unknown> = {
        version: updates.version ?? (spatialMapQuery.data?.version ?? 0) + 1,
      };
      if (updates.rooms) updatePayload.rooms = updates.rooms as unknown;
      if (updates.adjacency_graph) updatePayload.adjacency_graph = updates.adjacency_graph as unknown;
      if (updates.locks_json) updatePayload.locks_json = updates.locks_json as unknown;

      const { data, error } = await supabase
        .from("pipeline_spatial_maps")
        .update(updatePayload)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["spatial-map", pipelineId] });
    },
  });

  // Build room name lookup map
  const roomNameLookup = useMemo(() => {
    const rooms = spatialMapQuery.data?.rooms || [];
    return buildRoomNameLookup(rooms);
  }, [spatialMapQuery.data?.rooms]);

  // Helper function to get canonical room name
  const getCanonicalName = (roomId: string): string | null => {
    return roomNameLookup.get(roomId) || null;
  };

  return {
    spatialMap: spatialMapQuery.data,
    isLoading: spatialMapQuery.isLoading,
    error: spatialMapQuery.error,
    runSpatialDecomposition,
    updateSpatialMap,
    roomNameLookup,
    getCanonicalName,
  };
}
