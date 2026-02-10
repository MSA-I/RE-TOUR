import { useEffect, useState } from "react";
import { useSupabaseClient } from "@/integrations/supabase/client";

interface ConstraintStackDepth {
  total: number;
  byLevel: {
    system: number;
    critical: number;
    body: number;
  };
}

/**
 * Hook to fetch the constraint stack depth for a given step.
 * Shows how many learned constraints are active at each escalation level.
 */
export function useConstraintStackDepth(stepId: number | null) {
  const supabase = useSupabaseClient();
  const [depth, setDepth] = useState<ConstraintStackDepth | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!stepId) {
      setDepth(null);
      return;
    }

    const fetchDepth = async () => {
      setLoading(true);
      setError(null);

      try {
        const { data, error: fetchError } = await supabase.functions.invoke(
          "get-constraint-stack-depth",
          {
            body: { stepId },
          }
        );

        if (fetchError) {
          throw fetchError;
        }

        setDepth(data as ConstraintStackDepth);
      } catch (err) {
        console.error("[useConstraintStackDepth] Error fetching depth:", err);
        setError(err instanceof Error ? err.message : "Failed to fetch constraint depth");
      } finally {
        setLoading(false);
      }
    };

    fetchDepth();
  }, [stepId, supabase]);

  return { depth, loading, error };
}
