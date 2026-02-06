import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface ProjectWithCounts {
  id: string;
  name: string;
  status: string;
  created_at: string;
  owner_id: string;
  style_profile: Record<string, unknown> | null;
  completed_jobs_count: number;
  failed_jobs_count: number;
  active_jobs_count: number;
  completed_filenames: string[];
  failed_filenames: string[];
  last_job_updated_at: string;
}

export function useProjectsWithCounts() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["projects_with_counts", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_projects_with_job_counts");

      if (error) throw error;
      
      return (data || []).map((row: any) => ({
        id: row.id,
        name: row.name,
        status: row.status,
        created_at: row.created_at,
        owner_id: row.owner_id,
        style_profile: row.style_profile,
        completed_jobs_count: Number(row.completed_jobs_count) || 0,
        failed_jobs_count: Number(row.failed_jobs_count) || 0,
        active_jobs_count: Number(row.active_jobs_count) || 0,
        completed_filenames: row.completed_filenames || [],
        failed_filenames: row.failed_filenames || [],
        last_job_updated_at: row.last_job_updated_at || row.created_at,
      })) as ProjectWithCounts[];
    },
    enabled: !!user
  });
}
