import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface GlobalQAResult {
  id: string;
  pipeline_id: string;
  owner_id: string;
  room_pair: string[];
  consistency_decision: "approved" | "inconsistent" | "pending";
  inconsistency_type?: "wall_mismatch" | "opening_mismatch" | "material_mismatch" | "lighting_mismatch";
  inconsistency_details?: string;
  rerender_triggered: boolean;
  created_at: string;
}

export function useGlobalQA(pipelineId: string | undefined) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const globalQAQuery = useQuery({
    queryKey: ["global-qa", pipelineId],
    queryFn: async () => {
      if (!pipelineId) return [];

      const { data, error } = await supabase
        .from("global_qa_results")
        .select("*")
        .eq("pipeline_id", pipelineId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as GlobalQAResult[];
    },
    enabled: !!pipelineId && !!user,
    staleTime: 30000,
  });

  // Run global QA check
  const runGlobalQA = useMutation({
    mutationFn: async ({ pipelineId }: { pipelineId: string }) => {
      const { data, error } = await supabase.functions.invoke("run-global-qa", {
        body: { pipeline_id: pipelineId },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["global-qa", pipelineId] });
    },
  });

  // Trigger localized rerender for inconsistent rooms
  const triggerRerender = useMutation({
    mutationFn: async ({ 
      qaResultId, 
      roomId 
    }: { 
      qaResultId: string; 
      roomId: string;
    }) => {
      const { data, error } = await supabase.functions.invoke("trigger-room-rerender", {
        body: { qa_result_id: qaResultId, room_id: roomId },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["global-qa", pipelineId] });
      queryClient.invalidateQueries({ queryKey: ["room-sub-pipelines", pipelineId] });
    },
  });

  // Aggregate stats
  const stats = {
    total: globalQAQuery.data?.length || 0,
    approved: globalQAQuery.data?.filter(r => r.consistency_decision === "approved").length || 0,
    inconsistent: globalQAQuery.data?.filter(r => r.consistency_decision === "inconsistent").length || 0,
    pending: globalQAQuery.data?.filter(r => r.consistency_decision === "pending").length || 0,
    rerendersPending: globalQAQuery.data?.filter(r => 
      r.consistency_decision === "inconsistent" && !r.rerender_triggered
    ).length || 0,
  };

  return {
    qaResults: globalQAQuery.data || [],
    isLoading: globalQAQuery.isLoading,
    error: globalQAQuery.error,
    stats,
    runGlobalQA,
    triggerRerender,
  };
}
