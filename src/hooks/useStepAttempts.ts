import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// QA Reason codes from pipeline-schemas.ts
export type QAReasonCode = 
  | "INVALID_INPUT"
  | "MISSING_SPACE"
  | "DUPLICATED_OBJECTS"
  | "GEOMETRY_DISTORTION"
  | "WRONG_ROOM_TYPE"
  | "LOW_CONFIDENCE"
  | "AMBIGUOUS_CLASSIFICATION"
  | "SCALE_MISMATCH"
  | "FURNITURE_MISMATCH"
  | "STYLE_INCONSISTENCY"
  | "WALL_RECTIFICATION"
  | "MISSING_FURNISHINGS"
  | "RESOLUTION_MISMATCH"
  | "SEAM_ARTIFACTS"
  | "COLOR_INCONSISTENCY"
  | "PERSPECTIVE_ERROR"
  | "SCHEMA_INVALID"
  | "API_ERROR"
  | "TIMEOUT"
  | "UNKNOWN";

export type QAConfidence = "low" | "medium" | "high";

export interface QAReason {
  code: QAReasonCode;
  description: string;
}

export interface StepAttempt {
  id: string;
  pipeline_id: string;
  step_number: number;
  attempt_index: number;
  output_upload_id: string | null;
  qa_status: "pending" | "approved" | "rejected" | "error";
  qa_reason_short: string | null;
  qa_reason_full: string | null;
  qa_result_json: {
    status?: "PASS" | "FAIL";
    reason_short?: string;
    reasons?: QAReason[];
    evidence?: Array<{ observation: string; location?: string; confidence?: number }>;
    severity?: "low" | "medium" | "high" | "critical";
    retry_suggestion?: { type: string; instruction: string; priority?: number };
    confidence_score?: number;
    // Legacy fields
    decision?: string;
    reason?: string;
    geometry_check?: string;
    scale_check?: string;
    furniture_check?: string;
    [key: string]: unknown;
  };
  prompt_used: string | null;
  model_used: string | null;
  created_at: string;
  image_url: string | null;
  // Computed fields for UI
  rejection_category: QAReasonCode | null;
  confidence: QAConfidence;
}

interface UseStepAttemptsOptions {
  pipelineId: string;
  stepNumber: number;
  enabled?: boolean;
}

export function useStepAttempts({
  pipelineId,
  stepNumber,
  enabled = true,
}: UseStepAttemptsOptions) {
  return useQuery({
    queryKey: ["pipeline-step-attempts", pipelineId, stepNumber],
    queryFn: async (): Promise<StepAttempt[]> => {
      const { data, error } = await supabase.functions.invoke(
        "get-pipeline-step-attempts",
        {
          body: {
            pipeline_id: pipelineId,
            step_number: stepNumber,
          },
        }
      );

      if (error) {
        console.error("[useStepAttempts] Error fetching attempts:", error);
        throw error;
      }

      // Process attempts to extract structured fields
      return (data?.attempts || []).map((attempt: StepAttempt) => {
        const qa = attempt.qa_result_json || {};
        
        // Extract primary rejection category
        let rejection_category: QAReasonCode | null = null;
        if (qa.reasons && Array.isArray(qa.reasons) && qa.reasons.length > 0) {
          rejection_category = qa.reasons[0].code as QAReasonCode;
        } else if (qa.geometry_check === "failed") {
          rejection_category = "GEOMETRY_DISTORTION";
        } else if (qa.scale_check === "failed") {
          rejection_category = "SCALE_MISMATCH";
        } else if (qa.furniture_check === "failed") {
          rejection_category = "FURNITURE_MISMATCH";
        }
        
        // Extract confidence level
        let confidence: QAConfidence = "medium";
        if (typeof qa.confidence_score === "number") {
          if (qa.confidence_score >= 0.8) confidence = "high";
          else if (qa.confidence_score < 0.5) confidence = "low";
        }
        
        return {
          ...attempt,
          rejection_category,
          confidence,
        };
      });
    },
    enabled: enabled && !!pipelineId && stepNumber >= 0,
    staleTime: 10_000, // 10 seconds - more frequent updates during retries
    refetchInterval: enabled ? 5_000 : false, // Poll every 5s when enabled
    refetchOnWindowFocus: true,
  });
}
