import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Reference image structure for per-space selection
 */
export interface AvailableReferenceImage {
  id: string;           // render output_upload_id
  path: string;         // storage path for signed URL
  label: string;        // e.g., "Living Room - Camera A"
  spaceId: string;      // source space ID
  spaceName: string;    // source space name
  kind: "A" | "B";      // camera type
}

/**
 * Fetches all approved Step 4+ render outputs that can be used as style references.
 * Only returns renders that are locked_approved with a valid output.
 */
export function useAvailableReferenceImages(pipelineId: string | undefined) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["available-reference-images", pipelineId],
    queryFn: async (): Promise<AvailableReferenceImage[]> => {
      if (!pipelineId) return [];

      // Fetch approved renders with space and upload info
      const { data: renders, error } = await supabase
        .from("floorplan_space_renders")
        .select(`
          id,
          kind,
          output_upload_id,
          space_id,
          space:floorplan_pipeline_spaces!inner(
            id,
            name
          ),
          output:uploads!floorplan_space_renders_output_upload_id_fkey(
            id,
            path
          )
        `)
        .eq("pipeline_id", pipelineId)
        .eq("locked_approved", true)
        .not("output_upload_id", "is", null)
        .order("created_at", { ascending: true });

      if (error) {
        console.error("[useAvailableReferenceImages] Error:", error);
        throw error;
      }

      if (!renders || renders.length === 0) {
        return [];
      }

      // Map to reference image structure
      return renders
        .filter(r => r.output && r.space)
        .map(r => ({
          id: r.output_upload_id!,
          path: (r.output as { path: string })?.path || "",
          label: `${(r.space as { name: string })?.name || "Unknown"} - Camera ${r.kind}`,
          spaceId: r.space_id,
          spaceName: (r.space as { name: string })?.name || "Unknown",
          kind: r.kind as "A" | "B",
        }));
    },
    enabled: !!pipelineId && !!user,
    staleTime: 10000, // 10s cache - references don't change often
    refetchOnWindowFocus: false,
  });
}
