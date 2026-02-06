import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

// ============= Types =============

export interface CameraPlanningSpace {
  id: string;
  name: string;
  space_type: string;
  type: "room" | "zone";
  confidence: number;
  include_in_generation: boolean;
  is_excluded: boolean;
  is_custom: boolean;  // true if user-created
}

// ============= Hook =============

/**
 * Hook to manage spaces for Camera Planning.
 * 
 * Uses floorplan_pipeline_spaces (Step 3) as the single source of truth.
 * This ensures Camera Planning shows the EXACT same spaces as the "Spaces" panel.
 * 
 * Also provides ability to create custom spaces that don't exist in auto-detection.
 */
export function useCameraPlanningSpaces(pipelineId: string | undefined) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Fetch spaces from floorplan_pipeline_spaces (Step 3 - same source as Spaces panel)
  const spacesQuery = useQuery({
    queryKey: ["camera-planning-spaces", pipelineId],
    queryFn: async () => {
      if (!pipelineId || !user) return [];

      const { data, error } = await supabase
        .from("floorplan_pipeline_spaces")
        .select("id, name, space_type, include_in_generation, is_excluded, confidence")
        .eq("pipeline_id", pipelineId)
        .order("name", { ascending: true });

      if (error) throw error;

      // Transform to CameraPlanningSpace format
      return (data || []).map((space): CameraPlanningSpace => {
        const isStorage = /storage|closet|pantry|utility|wardrobe/i.test(space.space_type || "");
        return {
          id: space.id,
          name: space.name,
          space_type: space.space_type,
          type: isStorage ? "zone" : "room",
          confidence: space.confidence ?? 0.9,
          include_in_generation: space.include_in_generation ?? true,
          is_excluded: space.is_excluded ?? false,
          is_custom: space.space_type === "custom",  // Mark user-created spaces
        };
      });
    },
    enabled: !!pipelineId && !!user,
    staleTime: 15000,
  });

  // Create a custom space (for rooms not detected by AI)
  const createCustomSpace = useMutation({
    mutationFn: async ({ name, spaceType }: { name: string; spaceType?: string }) => {
      if (!pipelineId || !user) throw new Error("No pipeline or user");

      // Check if a space with this name already exists
      const existing = spacesQuery.data?.find(
        (s) => s.name.toLowerCase() === name.toLowerCase()
      );
      if (existing) {
        throw new Error(`A space named "${name}" already exists`);
      }

      const { data, error } = await supabase
        .from("floorplan_pipeline_spaces")
        .insert({
          pipeline_id: pipelineId,
          owner_id: user.id,
          name: name.trim(),
          space_type: spaceType || "custom",
          status: "pending",
          include_in_generation: true,
          is_excluded: false,
          confidence: 1.0,  // User-defined = 100% confidence
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["camera-planning-spaces", pipelineId] });
      queryClient.invalidateQueries({ queryKey: ["whole-apartment-spaces", pipelineId] });
      toast({
        title: "Custom Space Created",
        description: `"${data.name}" is now available for camera binding.`,
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to Create Space",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  // Delete a custom space
  const deleteCustomSpace = useMutation({
    mutationFn: async (spaceId: string) => {
      if (!pipelineId || !user) throw new Error("No pipeline or user");

      // Only allow deleting custom spaces
      const space = spacesQuery.data?.find((s) => s.id === spaceId);
      if (!space?.is_custom) {
        throw new Error("Only custom spaces can be deleted");
      }

      const { error } = await supabase
        .from("floorplan_pipeline_spaces")
        .delete()
        .eq("id", spaceId)
        .eq("pipeline_id", pipelineId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["camera-planning-spaces", pipelineId] });
      queryClient.invalidateQueries({ queryKey: ["whole-apartment-spaces", pipelineId] });
      toast({
        title: "Space Deleted",
        description: "Custom space has been removed.",
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to Delete Space",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  // Computed: Active spaces (for binding dropdown)
  const activeSpaces = useMemo(() => {
    return (spacesQuery.data || [])
      .filter((s) => s.include_in_generation && !s.is_excluded)
      .sort((a, b) => {
        // Rooms first, then zones
        if (a.type === "room" && b.type !== "room") return -1;
        if (a.type !== "room" && b.type === "room") return 1;
        // Higher confidence first
        if (b.confidence !== a.confidence) return b.confidence - a.confidence;
        // Alphabetical
        return a.name.localeCompare(b.name);
      });
  }, [spacesQuery.data]);

  // All spaces (including excluded, for reference)
  const allSpaces = useMemo(() => {
    return (spacesQuery.data || []).sort((a, b) => a.name.localeCompare(b.name));
  }, [spacesQuery.data]);

  // Build room name lookup map
  const roomNameLookup = useMemo(() => {
    const lookup = new Map<string, string>();
    for (const space of spacesQuery.data || []) {
      lookup.set(space.id, space.name);
    }
    return lookup;
  }, [spacesQuery.data]);

  return {
    // Data
    spaces: spacesQuery.data || [],
    activeSpaces,
    allSpaces,
    roomNameLookup,
    
    // Loading state
    isLoading: spacesQuery.isLoading,
    error: spacesQuery.error,
    
    // Actions
    createCustomSpace,
    deleteCustomSpace,
    
    // Helpers
    getSpaceName: (spaceId: string) => roomNameLookup.get(spaceId) || null,
    hasCustomSpaces: (spacesQuery.data || []).some((s) => s.is_custom),
  };
}
