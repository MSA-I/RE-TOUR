import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useEffect } from "react";

export interface JobAttempt {
  id: string;
  job_id: string;
  owner_id: string;
  attempt_number: number;
  nano_prompt_used: string | null;
  qa_decision: string | null;
  qa_reason: string | null;
  output_upload_id: string | null;
  created_at: string;
  output?: {
    id: string;
    bucket: string;
    path: string;
  } | null;
}

export function useJobAttempts(jobId: string | null) {
  const { user } = useAuth();

  const query = useQuery({
    queryKey: ["job_attempts", jobId],
    queryFn: async () => {
      if (!jobId) return [];

      const { data, error } = await supabase
        .from("render_job_attempts")
        .select(`
          *,
          output:uploads!render_job_attempts_output_upload_id_fkey(id, bucket, path)
        `)
        .eq("job_id", jobId)
        .order("attempt_number", { ascending: true });

      if (error) throw error;
      return data as JobAttempt[];
    },
    enabled: !!user && !!jobId
  });

  // Subscribe to realtime updates
  useEffect(() => {
    if (!jobId || !user) return;

    const channel = supabase
      .channel(`job_attempts_${jobId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'render_job_attempts',
          filter: `job_id=eq.${jobId}`
        },
        () => {
          query.refetch();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [jobId, user, query]);

  return {
    attempts: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error
  };
}