import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface QAJudgeResult {
  id: string;
  pipeline_id: string;
  project_id: string;
  step_number: number;
  sub_step: string | null;
  output_id: string | null;
  attempt_index: number;
  pass: boolean;
  score: number | null;
  confidence: number | null;
  reasons: string[];
  violated_rules: string[];
  full_result: Record<string, unknown>;
  judge_model: string;
  prompt_name: string | null;
  prompt_version: string | null;
  ab_bucket: string | null;
  processing_time_ms: number | null;
  created_at: string;
}

/**
 * Fetch all QA judge results for a specific pipeline step
 */
export function useQAJudgeResults(
  pipelineId: string | undefined,
  stepNumber: number | undefined,
  subStep?: string | null
) {
  return useQuery({
    queryKey: ["qa-judge-results", pipelineId, stepNumber, subStep],
    queryFn: async (): Promise<QAJudgeResult[]> => {
      if (!pipelineId || stepNumber === undefined) return [];

      let query = supabase
        .from("qa_judge_results")
        .select("*")
        .eq("pipeline_id", pipelineId)
        .eq("step_number", stepNumber)
        .order("attempt_index", { ascending: true });

      if (subStep !== undefined) {
        query = query.eq("sub_step", subStep);
      }

      const { data, error } = await query;

      if (error) {
        console.error("[useQAJudgeResults] Error:", error);
        throw error;
      }

      return (data || []) as QAJudgeResult[];
    },
    enabled: !!pipelineId && stepNumber !== undefined,
    staleTime: 10_000, // 10 seconds
  });
}

/**
 * Fetch the latest QA judge result for a specific output
 */
export function useLatestQAJudgeResult(outputId: string | undefined) {
  return useQuery({
    queryKey: ["qa-judge-result-latest", outputId],
    queryFn: async (): Promise<QAJudgeResult | null> => {
      if (!outputId) return null;

      const { data, error } = await supabase
        .from("qa_judge_results")
        .select("*")
        .eq("output_id", outputId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error("[useLatestQAJudgeResult] Error:", error);
        throw error;
      }

      return data as QAJudgeResult | null;
    },
    enabled: !!outputId,
    staleTime: 10_000,
  });
}

/**
 * Fetch QA judge results summary for a pipeline (pass rate, attempt counts)
 */
export function useQAJudgeSummary(pipelineId: string | undefined) {
  return useQuery({
    queryKey: ["qa-judge-summary", pipelineId],
    queryFn: async () => {
      if (!pipelineId) return null;

      const { data, error } = await supabase
        .from("qa_judge_results")
        .select("step_number, pass, attempt_index, ab_bucket")
        .eq("pipeline_id", pipelineId);

      if (error) {
        console.error("[useQAJudgeSummary] Error:", error);
        throw error;
      }

      // Compute summary stats
      const results = data || [];
      const summary = {
        totalAttempts: results.length,
        passCount: results.filter((r) => r.pass).length,
        failCount: results.filter((r) => !r.pass).length,
        passRate: results.length > 0
          ? (results.filter((r) => r.pass).length / results.length) * 100
          : 0,
        byStep: {} as Record<number, { attempts: number; passes: number; fails: number }>,
        byBucket: {} as Record<string, { attempts: number; passes: number }>,
      };

      // Group by step
      for (const result of results) {
        if (!summary.byStep[result.step_number]) {
          summary.byStep[result.step_number] = { attempts: 0, passes: 0, fails: 0 };
        }
        summary.byStep[result.step_number].attempts++;
        if (result.pass) {
          summary.byStep[result.step_number].passes++;
        } else {
          summary.byStep[result.step_number].fails++;
        }

        // Group by A/B bucket
        if (result.ab_bucket) {
          if (!summary.byBucket[result.ab_bucket]) {
            summary.byBucket[result.ab_bucket] = { attempts: 0, passes: 0 };
          }
          summary.byBucket[result.ab_bucket].attempts++;
          if (result.pass) {
            summary.byBucket[result.ab_bucket].passes++;
          }
        }
      }

      return summary;
    },
    enabled: !!pipelineId,
    staleTime: 30_000, // 30 seconds
  });
}
