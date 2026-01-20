import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface JobFeedItem {
  job_type: "panorama_job" | "batch_item" | "floorplan_step";
  job_id: string;
  project_id: string;
  project_name: string;
  source_filename: string;
  status: string;
  updated_at: string;
  output_upload_id: string | null;
  last_error: string | null;
  deep_link_route: string;
  step_number: number | null;
}

export type JobStatusFilter = "draft" | "active" | "completed" | "failed";

export function useJobFeed(statusFilter?: JobStatusFilter) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["job_feed", user?.id, statusFilter],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_job_feed", {
        status_filter: statusFilter || null
      });

      if (error) throw error;
      
      return (data || []) as JobFeedItem[];
    },
    enabled: !!user
  });
}
