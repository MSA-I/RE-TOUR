import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type QAVerdict = "APPROVED" | "REJECTED" | "PENDING";

export interface FloorplanStepAttemptTrace {
  prompt_final_sent_to_model: string | null;
  qa_status: string | null;
  qa_reason_full: string | null;
  qa_reason_short: string | null;
  model_used: string | null;
  created_at: string;
}

function toVerdict(qaStatus: string | null | undefined): QAVerdict {
  const v = (qaStatus || "").toLowerCase();
  if (["approved", "pass", "qa_pass"].includes(v)) return "APPROVED";
  if (["rejected", "fail", "qa_fail"].includes(v)) return "REJECTED";
  return "PENDING";
}

export function useFloorplanStepAttemptTrace(params: {
  pipelineId: string | null | undefined;
  stepNumber: number | null | undefined;
  outputUploadId?: string | null;
  enabled?: boolean;
}) {
  const { user } = useAuth();
  const { pipelineId, stepNumber, outputUploadId, enabled } = params;

  return useQuery({
    queryKey: ["floorplan_step_attempt_trace", pipelineId, stepNumber, outputUploadId],
    enabled: !!user && !!pipelineId && stepNumber !== null && stepNumber !== undefined && !!enabled,
    queryFn: async (): Promise<{ verdict: QAVerdict; trace: FloorplanStepAttemptTrace | null }> => {
      if (!pipelineId || stepNumber === null || stepNumber === undefined) {
        return { verdict: "PENDING", trace: null };
      }

      let q = supabase
        .from("floorplan_pipeline_step_attempts")
        .select("created_at, qa_status, qa_reason_full, qa_reason_short, prompt_used, model_used, output_upload_id")
        .eq("pipeline_id", pipelineId)
        .eq("step_number", stepNumber)
        .order("created_at", { ascending: false })
        .limit(10);

      if (outputUploadId) {
        q = q.eq("output_upload_id", outputUploadId);
      }

      const { data, error } = await q;
      if (error) throw error;

      const row = data?.[0];
      const trace: FloorplanStepAttemptTrace | null = row
        ? {
            created_at: row.created_at,
            qa_status: row.qa_status,
            qa_reason_full: row.qa_reason_full,
            qa_reason_short: row.qa_reason_short,
            model_used: row.model_used,
            // IMPORTANT: this is the full prompt as stored on the attempt row (NOT the truncated step_outputs preview)
            prompt_final_sent_to_model: row.prompt_used ?? null,
          }
        : null;

      const verdict = toVerdict(trace?.qa_status);
      return { verdict, trace };
    },
  });
}
