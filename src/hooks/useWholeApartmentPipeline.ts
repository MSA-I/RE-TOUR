import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useEffect, useRef, useMemo } from "react";
import type { Json } from "@/integrations/supabase/types";
import { useToast } from "@/hooks/use-toast";

// ============= Types =============

export interface SpaceRender {
  id: string;
  space_id: string;
  pipeline_id: string;
  owner_id: string;
  kind: "A" | "B";
  status: string;
  output_upload_id: string | null;
  prompt_text: string | null;
  ratio: string;
  quality: string;
  model: string | null;
  attempt_index: number;
  attempt_count: number;
  locked_approved: boolean;
  qa_status: string;
  qa_report: Record<string, unknown> | null;
  structured_qa_result: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  // Camera context fields
  camera_marker_id?: string | null;
  camera_label?: string | null;
  final_composed_prompt?: string | null;
  adjacency_context?: Record<string, unknown> | null;
}

export interface SpacePanorama {
  id: string;
  space_id: string;
  pipeline_id: string;
  source_render_id: string | null;
  owner_id: string;
  kind: "A" | "B";
  status: string;
  output_upload_id: string | null;
  prompt_text: string | null;
  ratio: string;
  quality: string;
  model: string | null;
  attempt_index: number;
  attempt_count: number;
  locked_approved: boolean;
  qa_status: string;
  qa_report: Record<string, unknown> | null;
  structured_qa_result: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface SpaceFinal360 {
  id: string;
  space_id: string;
  pipeline_id: string;
  panorama_a_id: string | null;
  panorama_b_id: string | null;
  owner_id: string;
  status: string;
  output_upload_id: string | null;
  merge_instructions: string | null;
  model: string | null;
  attempt_index: number;
  attempt_count: number;
  locked_approved: boolean;
  qa_status: string;
  qa_report: Record<string, unknown> | null;
  structured_qa_result: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface PipelineSpace {
  id: string;
  pipeline_id: string;
  owner_id: string;
  name: string;
  space_type: string;
  confidence: number;
  bounds_note: string | null;
  status: string;
  render_a_status: string;
  render_b_status: string;
  panorama_a_status: string;
  panorama_b_status: string;
  final_360_status: string;
  created_at: string;
  updated_at: string;
  // Exclusion fields
  is_excluded?: boolean;
  include_in_generation?: boolean;
  excluded_reason?: string | null;
  excluded_at?: string | null;
  // Per-space reference images (Step 4+ outputs)
  reference_image_ids?: string[];
  // Joined data
  renders?: SpaceRender[];
  panoramas?: SpacePanorama[];
  final360?: SpaceFinal360 | null;
}

export interface WholeApartmentPipeline {
  id: string;
  project_id: string;
  owner_id: string;
  floor_plan_upload_id: string;
  pipeline_mode: string;
  whole_apartment_phase: string;
  status: string;
  output_resolution: string;
  aspect_ratio: string;
  global_style_bible: Record<string, unknown> | null;
  global_3d_render_id: string | null;
  step_outputs: Record<string, unknown>;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

// ============= Pipeline Phase Constants =============

export const WHOLE_APARTMENT_PHASES = {
  upload: "upload",
  space_analysis_pending: "space_analysis_pending",
  space_analysis_running: "space_analysis_running",
  space_analysis_complete: "space_analysis_complete",
  top_down_3d_pending: "top_down_3d_pending",
  top_down_3d_running: "top_down_3d_running",
  top_down_3d_review: "top_down_3d_review",
  style_pending: "style_pending",
  style_running: "style_running",
  style_review: "style_review",
  // Step 3 (Internal) = Space Scan (Spec Step 0.2)
  detect_spaces_pending: "detect_spaces_pending",
  detecting_spaces: "detecting_spaces",
  spaces_detected: "spaces_detected",
  // Step 4 (Internal) = Camera Intent (Spec Step 3 - decision-only layer)
  camera_intent_pending: "camera_intent_pending",
  camera_intent_confirmed: "camera_intent_confirmed",
  // Step 5 (Internal) = Prompt Templates + NanoBanana (Spec Step 4)
  prompt_templates_pending: "prompt_templates_pending",
  prompt_templates_confirmed: "prompt_templates_confirmed",
  // Step 6 (Internal) = Outputs + QA (Spec Step 5)
  outputs_pending: "outputs_pending",
  outputs_in_progress: "outputs_in_progress",
  outputs_review: "outputs_review",
  // Step 7 (Internal) = Future Steps (Spec Steps 6-9)
  panoramas_pending: "panoramas_pending",
  panoramas_in_progress: "panoramas_in_progress",
  panoramas_review: "panoramas_review",
  // Step 8 (Internal) = Final Approval (Spec Step 10)
  merging_pending: "merging_pending",
  merging_in_progress: "merging_in_progress",
  merging_review: "merging_review",
  completed: "completed",
  failed: "failed",
} as const;

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PHASE → STEP CONTRACT (AUTHORITATIVE)
 * ═══════════════════════════════════════════════════════════════════════════
 */
export const PHASE_STEP_MAP: Record<string, number> = {
  // Step 0 (Internal) = Input Analysis (Spec: Step 0)
  upload: 0,
  space_analysis_pending: 0,
  space_analysis_running: 0,
  space_analysis_complete: 0,

  // Step 1 (Internal) = Realistic 2D Plan (Spec: Step 1)
  top_down_3d_pending: 1,
  top_down_3d_running: 1,
  top_down_3d_review: 1,

  // Step 2 (Internal) = Style Application (Spec: Step 2)
  style_pending: 2,
  style_running: 2,
  style_review: 2,

  // Step 3 (Internal) = Space Scan (Spec: Step 0.2 - detect spaces)
  detect_spaces_pending: 3,
  detecting_spaces: 3,
  spaces_detected: 3,

  // Step 4 (Internal) = Camera Intent (Spec: Step 3 - decision-only layer)
  camera_intent_pending: 4,
  camera_intent_confirmed: 4,

  // Step 5 (Internal) = Prompt Templates + NanoBanana (Spec: Step 4)
  prompt_templates_pending: 5,
  prompt_templates_confirmed: 5,

  // Step 6 (Internal) = Outputs + QA (Spec: Step 5)
  outputs_pending: 6,
  outputs_in_progress: 6,
  outputs_review: 6,

  // Step 7+ (Internal) = Future Steps (Spec: Steps 6-9)
  panoramas_pending: 7,
  panoramas_in_progress: 7,
  panoramas_review: 7,

  // Step 8 (Internal) = Final Approval (Spec: Step 10)
  merging_pending: 8,
  merging_in_progress: 8,
  merging_review: 8,
  completed: 8,

  // Terminal/Error
  failed: 0,
};

export const LEGAL_PHASE_TRANSITIONS: Record<string, string> = {
  // Step 0 → Step 1
  "space_analysis_complete": "top_down_3d_pending",
  // Step 1 → Step 2
  "top_down_3d_review": "style_pending",
  // Step 2 → Step 3 (Space Scan)
  "style_review": "detect_spaces_pending",
  // Step 3 → Step 4 (Camera Intent)
  "spaces_detected": "camera_intent_pending",
  // Step 4 → Step 5 (Prompt Templates)
  "camera_intent_confirmed": "prompt_templates_pending",
  // Step 5 → Step 6 (Outputs + QA)
  "prompt_templates_confirmed": "outputs_pending",
  // Step 6 → Step 7 (Future / Panoramas)
  "outputs_review": "panoramas_pending",
  // Step 7 → Step 8 (Final Approval)
  "panoramas_review": "merging_pending",
  "merging_review": "completed",
};

export const WHOLE_APARTMENT_STEP_NAMES = [
  "Input Analysis (0.1 + 0.2)",    // Step 0
  "Realistic 2D Plan",              // Step 1
  "Style Application",              // Step 2
  "Space Scan",                      // Step 3 (Internal, maps to Spec 0.2)
  "Camera Intent (Decision-Only)",  // Step 4 (Spec Step 3)
  "Prompt Templates + NanoBanana",  // Step 5 (NEW - Spec Step 4)
  "Outputs + QA",                   // Step 6 (Spec Step 5)
  "Future Capabilities",            // Step 7 (Spec Steps 6-9 placeholder)
  "Final Approval",                 // Step 8 (Spec Step 10)
];

export const STEP_BADGES: Record<number, string | null> = {
  0: null,
  1: null,
  2: null,
  3: null,
  4: "Decision-Only",
  5: null,
  6: null,
  7: "Future",
  8: null,
};

export const LOCKED_PIPELINE_DISPLAY = [
  { stepNum: "0.1", label: "Design Ref", internalStep: 0, futurePhase: false, optional: true },
  { stepNum: "0.2", label: "Space Scan", internalStep: 3, futurePhase: false },
  { stepNum: "1", label: "2D Plan", internalStep: 1, futurePhase: false },
  { stepNum: "2", label: "Style", internalStep: 2, futurePhase: false },
  { stepNum: "3", label: "Camera Intent", internalStep: 4, futurePhase: false },
  { stepNum: "4", label: "Prompts+Gen", internalStep: 5, futurePhase: false },
  { stepNum: "5", label: "Outputs+QA", internalStep: 6, futurePhase: false },
  { stepNum: "6-9", label: "Future", internalStep: 7, futurePhase: true },
  { stepNum: "10", label: "Approval", internalStep: 8, futurePhase: false },
];

// ============= Main Hook =============

export function useWholeApartmentPipeline(pipelineId: string | undefined) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const subscriptionRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Fetch spaces with all related data
  const spacesQuery = useQuery({
    queryKey: ["whole-apartment-spaces", pipelineId],
    queryFn: async () => {
      if (!pipelineId) return [];

      // Fetch spaces
      const { data: spaces, error: spacesError } = await supabase
        .from("floorplan_pipeline_spaces")
        .select("*")
        .eq("pipeline_id", pipelineId)
        .order("name", { ascending: true });

      if (spacesError) throw spacesError;
      if (!spaces || spaces.length === 0) return [];

      // Fetch renders for all spaces
      const { data: renders } = await supabase
        .from("floorplan_space_renders")
        .select("*")
        .eq("pipeline_id", pipelineId);

      // Fetch panoramas for all spaces
      const { data: panoramas } = await supabase
        .from("floorplan_space_panoramas")
        .select("*")
        .eq("pipeline_id", pipelineId);

      // Fetch final360s for all spaces
      const { data: final360s } = await supabase
        .from("floorplan_space_final360")
        .select("*")
        .eq("pipeline_id", pipelineId);

      // Map data to spaces
      return spaces.map(space => ({
        ...space,
        renders: (renders || []).filter(r => r.space_id === space.id) as SpaceRender[],
        panoramas: (panoramas || []).filter(p => p.space_id === space.id) as SpacePanorama[],
        final360: (final360s || []).find(f => f.space_id === space.id) as SpaceFinal360 | null,
      })) as PipelineSpace[];
    },
    enabled: !!pipelineId && !!user,
    staleTime: 2000, // Reduced to 2s for faster updates during active generation
    refetchInterval: (query) => {
      // Auto-refetch every 5s if any render is in "generating" or "running" state
      const spaces = query.state.data as PipelineSpace[] | undefined;
      const hasActiveGeneration = spaces?.some(s =>
        s.renders?.some(r => ["generating", "running", "retrying"].includes(r.status)) ||
        s.panoramas?.some(p => ["generating", "running", "retrying"].includes(p.status)) ||
        (s.final360 && ["generating", "running", "retrying"].includes(s.final360.status))
      );
      return hasActiveGeneration ? 5000 : false;
    },
  });

  // Calculate progress based on active (non-excluded) spaces only
  const progress = spacesQuery.data?.length ? (() => {
    // Only count non-excluded spaces toward progress
    const activeSpaces = spacesQuery.data.filter(
      s => !s.is_excluded && s.include_in_generation !== false
    );
    let totalAssets = activeSpaces.length * 5; // 2 renders + 2 panoramas + 1 final360 per space
    let completedAssets = 0;

    for (const space of activeSpaces) {
      if (space.renders?.find(r => r.kind === "A")?.locked_approved) completedAssets++;
      if (space.renders?.find(r => r.kind === "B")?.locked_approved) completedAssets++;
      if (space.panoramas?.find(p => p.kind === "A")?.locked_approved) completedAssets++;
      if (space.panoramas?.find(p => p.kind === "B")?.locked_approved) completedAssets++;
      if (space.final360?.locked_approved) completedAssets++;
    }

    return totalAssets > 0 ? Math.round((completedAssets / totalAssets) * 100) : 0;
  })() : 0;

  // Real-time subscription for space updates with immediate invalidation for renders/panoramas
  useEffect(() => {
    if (!pipelineId || !user) return;

    if (subscriptionRef.current) {
      subscriptionRef.current.unsubscribe();
    }

    // Track pending invalidations to debounce
    let pendingInvalidation: ReturnType<typeof setTimeout> | null = null;
    const invalidateNow = () => {
      if (pendingInvalidation) clearTimeout(pendingInvalidation);
      queryClient.invalidateQueries({ queryKey: ["whole-apartment-spaces", pipelineId] });
      queryClient.invalidateQueries({ queryKey: ["camera-planning-spaces", pipelineId] });
    };
    const invalidateDebounced = (delayMs = 200) => {
      if (pendingInvalidation) clearTimeout(pendingInvalidation);
      pendingInvalidation = setTimeout(invalidateNow, delayMs);
    };

    const channel = supabase
      .channel(`whole-apartment-${pipelineId}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "floorplan_pipeline_spaces",
        filter: `pipeline_id=eq.${pipelineId}`,
      }, () => {
        invalidateDebounced(300);
      })
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "floorplan_space_renders",
        filter: `pipeline_id=eq.${pipelineId}`,
      }, (payload) => {
        // Immediate invalidation for status changes or output completion
        const newStatus = (payload.new as { status?: string })?.status;
        if (newStatus === "needs_review" || newStatus === "approved" || newStatus === "failed") {
          invalidateNow();
        } else {
          invalidateDebounced(100); // Fast debounce for running status
        }
      })
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "floorplan_space_panoramas",
        filter: `pipeline_id=eq.${pipelineId}`,
      }, (payload) => {
        const newStatus = (payload.new as { status?: string })?.status;
        if (newStatus === "needs_review" || newStatus === "approved" || newStatus === "failed") {
          invalidateNow();
        } else {
          invalidateDebounced(100);
        }
      })
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "floorplan_space_final360",
        filter: `pipeline_id=eq.${pipelineId}`,
      }, (payload) => {
        const newStatus = (payload.new as { status?: string })?.status;
        if (newStatus === "needs_review" || newStatus === "approved" || newStatus === "failed") {
          invalidateNow();
        } else {
          invalidateDebounced(100);
        }
      })
      .subscribe();

    subscriptionRef.current = channel;

    return () => {
      if (pendingInvalidation) clearTimeout(pendingInvalidation);
      channel.unsubscribe();
    };
  }, [pipelineId, user, queryClient]);

  // ============= Mutations =============

  // Run Space Analysis (Step 0)
  // NOTE: This mutation ONLY calls run-space-analysis. No phase-based redirection.
  const runSpaceAnalysis = useMutation({
    mutationFn: async ({ pipelineId }: { pipelineId: string }) => {
      console.log("[SPACE_ANALYSIS_START] Invoking run-space-analysis");
      const { data, error } = await supabase.functions.invoke("run-space-analysis", {
        body: { pipeline_id: pipelineId },
      });
      if (error) {
        console.error("[SPACE_ANALYSIS_START] Edge function error:", error);
        throw error;
      }
      if (data?.error) {
        console.error("[SPACE_ANALYSIS_START] Backend returned error:", data.error);
        throw new Error(data.error);
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["floorplan-pipelines"] });
    },
    onError: (error) => {
      queryClient.invalidateQueries({ queryKey: ["floorplan-pipelines"] });
      console.error("[SPACE_ANALYSIS_START] Error:", error);
    },
  });

  // Run Step 1: Top-Down 3D
  // If phase is space_analysis_complete, first advance to top_down_3d_pending, then run.
  // This ensures the phase contract is respected.
  const runTopDown3D = useMutation({
    mutationFn: async ({ pipelineId }: { pipelineId: string }) => {
      // First check current phase
      const { data: pipelineMeta, error: metaError } = await supabase
        .from("floorplan_pipelines")
        .select("whole_apartment_phase")
        .eq("id", pipelineId)
        .maybeSingle();

      if (metaError) throw metaError;
      if (!pipelineMeta) throw new Error("Pipeline not found");

      const currentPhase = pipelineMeta.whole_apartment_phase ?? "upload";
      console.log(`[TOP_DOWN_3D_START] Current phase: ${currentPhase}`);

      // If phase is space_analysis_complete, need to advance first
      if (currentPhase === "space_analysis_complete") {
        console.log("[TOP_DOWN_3D_START] Phase is space_analysis_complete, calling continue-pipeline-step first");
        const { data: continueData, error: continueError } = await supabase.functions.invoke("continue-pipeline-step", {
          body: { pipeline_id: pipelineId, from_step: 0, from_phase: "space_analysis_complete" },
        });
        if (continueError) {
          console.error("[TOP_DOWN_3D_START] continue-pipeline-step error:", continueError);
          throw continueError;
        }
        if (continueData?.error) {
          console.error("[TOP_DOWN_3D_START] continue-pipeline-step returned error:", continueData.error);
          throw new Error(continueData.error);
        }
        console.log("[TOP_DOWN_3D_START] Phase advanced to top_down_3d_pending");
      }

      // Now run the actual step
      console.log("[TOP_DOWN_3D_START] Invoking run-pipeline-step for Step 1");
      const { data, error } = await supabase.functions.invoke("run-pipeline-step", {
        body: { pipeline_id: pipelineId, step_number: 1, whole_apartment_mode: true },
      });
      if (error) {
        console.error("[TOP_DOWN_3D_START] Edge function error:", error);
        throw error;
      }
      if (data?.error) {
        console.error("[TOP_DOWN_3D_START] Backend returned error:", data.error);
        throw new Error(data.error);
      }
      console.log("[TOP_DOWN_3D_START] ✓ Step 1 started successfully");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["floorplan-pipelines"] });
      toast({
        title: "Step 1 Started",
        description: "Generating realistic 2D floor plan...",
      });
    },
    onError: (error) => {
      queryClient.invalidateQueries({ queryKey: ["floorplan-pipelines"] });
      console.error("[TOP_DOWN_3D_START] Error:", error);

      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      toast({
        title: "Failed to start Step 1",
        description: errorMessage,
        variant: "destructive",
        duration: 10000
      });
    },
  });

  // Run Step 2: Style Top-Down
  // If phase is top_down_3d_review (approved), first advance to style_pending, then run.
  const runStyleTopDown = useMutation({
    mutationFn: async ({
      pipelineId,
      designRefUploadIds
    }: {
      pipelineId: string;
      designRefUploadIds?: string[];
    }) => {
      // First check current phase
      const { data: pipelineMeta, error: metaError } = await supabase
        .from("floorplan_pipelines")
        .select("whole_apartment_phase")
        .eq("id", pipelineId)
        .maybeSingle();

      if (metaError) throw metaError;
      if (!pipelineMeta) throw new Error("Pipeline not found");

      const currentPhase = pipelineMeta.whole_apartment_phase ?? "upload";
      console.log(`[STYLE_START] Current phase: ${currentPhase}`);

      // If phase is top_down_3d_review (step 1 approved), need to advance first
      if (currentPhase === "top_down_3d_review") {
        console.log("[STYLE_START] Phase is top_down_3d_review, calling continue-pipeline-step first");
        const { data: continueData, error: continueError } = await supabase.functions.invoke("continue-pipeline-step", {
          body: { pipeline_id: pipelineId, from_step: 1, from_phase: "top_down_3d_review" },
        });
        if (continueError) {
          console.error("[STYLE_START] continue-pipeline-step error:", continueError);
          throw continueError;
        }
        if (continueData?.error) {
          console.error("[STYLE_START] continue-pipeline-step returned error:", continueData.error);
          throw new Error(continueData.error);
        }
        console.log("[STYLE_START] Phase advanced to style_pending");
      }

      // Now run the actual step
      console.log("[STYLE_START] Invoking run-pipeline-step for Step 2");
      const { data, error } = await supabase.functions.invoke("run-pipeline-step", {
        body: {
          pipeline_id: pipelineId,
          step_number: 2,
          whole_apartment_mode: true,
          design_ref_upload_ids: designRefUploadIds,
        },
      });
      if (error) {
        console.error("[STYLE_START] Edge function error:", error);
        throw error;
      }
      if (data?.error) {
        console.error("[STYLE_START] Backend returned error:", data.error);
        throw new Error(data.error);
      }
      console.log("[STYLE_START] ✓ Step 2 started successfully");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["floorplan-pipelines"] });
      toast({
        title: "Step 2 Started",
        description: "Applying style to floor plan...",
      });
    },
    onError: (error) => {
      queryClient.invalidateQueries({ queryKey: ["floorplan-pipelines"] });
      console.error("[STYLE_START] Error:", error);

      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      toast({
        title: "Failed to start Step 2",
        description: errorMessage,
        variant: "destructive",
        duration: 10000
      });
    },
  });

  // Run Step 3: Detect Spaces
  // NOTE: If in style_review, first advance to detect_spaces_pending via continue-pipeline-step
  const runDetectSpaces = useMutation({
    mutationFn: async ({
      pipelineId,
      styledImageUploadId
    }: {
      pipelineId: string;
      styledImageUploadId: string;
    }) => {
      // First check current phase
      const { data: pipelineMeta, error: metaError } = await supabase
        .from("floorplan_pipelines")
        .select("whole_apartment_phase")
        .eq("id", pipelineId)
        .maybeSingle();

      if (metaError) throw metaError;
      if (!pipelineMeta) throw new Error("Pipeline not found");

      const currentPhase = pipelineMeta.whole_apartment_phase ?? "upload";
      console.log(`[DETECT_SPACES_START] Current phase: ${currentPhase}`);

      // If phase is style_review, need to advance to detect_spaces_pending first
      if (currentPhase === "style_review") {
        console.log("[DETECT_SPACES_START] Phase is style_review, calling continue-pipeline-step first");
        const { data: continueData, error: continueError } = await supabase.functions.invoke("continue-pipeline-step", {
          body: { pipeline_id: pipelineId, from_step: 2, from_phase: "style_review" },
        });
        if (continueError) {
          console.error("[DETECT_SPACES_START] continue-pipeline-step error:", continueError);
          throw continueError;
        }
        if (continueData?.error) {
          console.error("[DETECT_SPACES_START] continue-pipeline-step returned error:", continueData.error);
          throw new Error(continueData.error);
        }
        console.log("[DETECT_SPACES_START] Phase advanced to detect_spaces_pending");
      }

      // Now run the actual detect spaces
      console.log("[DETECT_SPACES_START] Invoking run-detect-spaces");
      const { data, error } = await supabase.functions.invoke("run-detect-spaces", {
        body: { pipeline_id: pipelineId, styled_image_upload_id: styledImageUploadId },
      });

      if (error) throw error;

      // Handle already_running response gracefully
      if (data?.already_running) {
        console.log("[runDetectSpaces] Already running, waiting for completion...");
        return { ...data, _feedbackType: "already_running" };
      }

      // Handle idempotent already_existed case (spaces already detected)
      if (data?.already_existed) {
        console.log("[runDetectSpaces] Spaces already exist, returning existing data");
        return { ...data, _feedbackType: "already_existed" };
      }

      return { ...data, _feedbackType: "success" };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["whole-apartment-spaces", pipelineId] });
      queryClient.invalidateQueries({ queryKey: ["floorplan-pipelines"] });

      toast({
        title: "Space Detection Complete",
        description: "Detected spaces from floor plan",
      });

      // Return data for component-level toast handling
      return data;
    },
    onError: (error) => {
      queryClient.invalidateQueries({ queryKey: ["floorplan-pipelines"] });
      console.error("[runDetectSpaces] Error:", error);

      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      toast({
        title: "Failed to detect spaces",
        description: errorMessage,
        variant: "destructive",
        duration: 10000
      });
    },
  });

  // Retry Step 3: Detect Spaces (safe, idempotent retry)
  const retryDetectSpaces = useMutation({
    mutationFn: async ({ pipelineId }: { pipelineId: string }) => {
      const { data, error } = await supabase.functions.invoke("retry-pipeline-step", {
        body: { pipeline_id: pipelineId, step_number: 3 },
      });

      if (error) throw error;

      // Handle already_running response
      if (data?.already_running) {
        console.log("[retryDetectSpaces] Step 3 is actively running");
        return data;
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whole-apartment-spaces", pipelineId] });
      queryClient.invalidateQueries({ queryKey: ["floorplan-pipelines"] });
    },
    onError: (error) => {
      queryClient.invalidateQueries({ queryKey: ["floorplan-pipelines"] });
      console.error("[retryDetectSpaces] Error:", error);
    },
  });

  // Save Camera Intents - Step 4 (Decision-Only)
  const saveCameraIntents = useMutation({
    mutationFn: async ({ pipelineId, styledImageUploadId }: {
      pipelineId: string;
      styledImageUploadId: string;
    }) => {
      const { data, error } = await supabase.functions.invoke("save-camera-intents", {
        body: { pipeline_id: pipelineId, styled_image_upload_id: styledImageUploadId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["floorplan-pipelines"] });
      toast({ title: "Camera Intents Generated", description: "Review suggestions for each space" });
    },
  });

  // Compose Final Prompts - Step 5 (Templates + NanoBanana)
  const composeFinalPrompts = useMutation({
    mutationFn: async ({ pipelineId, selectedIntentIds }: {
      pipelineId: string;
      selectedIntentIds: string[];
    }) => {
      const { data, error } = await supabase.functions.invoke("compose-final-prompts", {
        body: { pipeline_id: pipelineId, selected_intent_ids: selectedIntentIds },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["floorplan-pipelines"] });
      toast({ title: "Prompts Finalized", description: "Starting image generation..." });
    },
  });

  // Run Render for a Space (A or B)
  const runSpaceRender = useMutation({
    mutationFn: async ({
      renderId,
      styledImageUploadId,
      customPrompt,
    }: {
      renderId: string;
      styledImageUploadId: string;
      customPrompt?: string;
    }) => {
      const { data, error } = await supabase.functions.invoke("run-space-render", {
        body: {
          render_id: renderId,
          styled_image_upload_id: styledImageUploadId,
          custom_prompt: customPrompt,
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whole-apartment-spaces", pipelineId] });
    },
  });

  // Run Panorama for a Space (A or B)
  const runSpacePanorama = useMutation({
    mutationFn: async ({
      panoramaId,
      sourceRenderId,
    }: {
      panoramaId: string;
      sourceRenderId: string;
    }) => {
      const { data, error } = await supabase.functions.invoke("run-space-panorama", {
        body: { panorama_id: panoramaId, source_render_id: sourceRenderId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whole-apartment-spaces", pipelineId] });
    },
  });

  // Run Final 360 Merge for a Space
  const runMerge360 = useMutation({
    mutationFn: async ({
      final360Id,
      panoramaAId,
      panoramaBId,
      mergeInstructions,
    }: {
      final360Id: string;
      panoramaAId: string;
      panoramaBId: string;
      mergeInstructions?: string;
    }) => {
      const { data, error } = await supabase.functions.invoke("run-merge-360", {
        body: {
          final360_id: final360Id,
          panorama_a_id: panoramaAId,
          panorama_b_id: panoramaBId,
          merge_instructions: mergeInstructions,
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whole-apartment-spaces", pipelineId] });
    },
  });

  // ============= Approval Mutations (LOCKING) =============

  // Approve a Render (locks it - IMMUTABLE after this)
  const approveRender = useMutation({
    mutationFn: async ({ renderId }: { renderId: string }) => {
      const { error } = await supabase
        .from("floorplan_space_renders")
        .update({
          locked_approved: true,
          status: "approved",
          qa_status: "approved",
        })
        .eq("id", renderId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whole-apartment-spaces", pipelineId] });
    },
  });

  // Reject a Render AND trigger automatic retry via backend
  const rejectRender = useMutation({
    mutationFn: async ({ renderId, notes, isPostApprovalReject }: { renderId: string; notes?: string; isPostApprovalReject?: boolean }) => {
      // Call the reject-and-retry edge function which handles:
      // 1. Persisting the rejection with notes
      // 2. Incrementing attempt_count
      // 3. Triggering a new render job with modified parameters
      // OR for post-approval rejects: triggering an inpaint/edit job
      const { data, error } = await supabase.functions.invoke("run-reject-and-retry", {
        body: {
          asset_type: "render",
          asset_id: renderId,
          rejection_notes: notes,
          is_post_approval_reject: isPostApprovalReject,
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["whole-apartment-spaces", pipelineId] });
      if (data?.blocked_for_human) {
        console.log("[rejectRender] Max attempts reached, requires manual review");
      }
      if (data?.inpaint_triggered) {
        console.log("[rejectRender] Inpaint/edit job triggered");
      }
    },
  });

  // Retry a rejected/failed Render (creates new attempt)
  const retryRender = useMutation({
    mutationFn: async ({ renderId, styledImageUploadId }: { renderId: string; styledImageUploadId: string }) => {
      // First reset the render status
      await supabase
        .from("floorplan_space_renders")
        .update({
          status: "pending",
          qa_status: "pending",
          output_upload_id: null,
        })
        .eq("id", renderId);

      // Then trigger a new generation
      const { data, error } = await supabase.functions.invoke("run-space-render", {
        body: { render_id: renderId, styled_image_upload_id: styledImageUploadId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whole-apartment-spaces", pipelineId] });
    },
  });

  // Approve a Panorama (locks it - IMMUTABLE after this)
  const approvePanorama = useMutation({
    mutationFn: async ({ panoramaId }: { panoramaId: string }) => {
      const { error } = await supabase
        .from("floorplan_space_panoramas")
        .update({
          locked_approved: true,
          status: "approved",
          qa_status: "approved",
        })
        .eq("id", panoramaId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whole-apartment-spaces", pipelineId] });
    },
  });

  // Reject a Panorama AND trigger automatic retry via backend
  const rejectPanorama = useMutation({
    mutationFn: async ({ panoramaId, notes }: { panoramaId: string; notes?: string }) => {
      const { data, error } = await supabase.functions.invoke("run-reject-and-retry", {
        body: {
          asset_type: "panorama",
          asset_id: panoramaId,
          rejection_notes: notes,
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["whole-apartment-spaces", pipelineId] });
      if (data?.blocked_for_human) {
        console.log("[rejectPanorama] Max attempts reached, requires manual review");
      }
    },
  });

  // Retry a rejected/failed Panorama
  const retryPanorama = useMutation({
    mutationFn: async ({ panoramaId }: { panoramaId: string }) => {
      // Get the panorama to find source render
      const { data: panorama } = await supabase
        .from("floorplan_space_panoramas")
        .select("source_render_id")
        .eq("id", panoramaId)
        .single();

      if (!panorama?.source_render_id) throw new Error("No source render found");

      // Reset status
      await supabase
        .from("floorplan_space_panoramas")
        .update({
          status: "pending",
          qa_status: "pending",
          output_upload_id: null,
        })
        .eq("id", panoramaId);

      // Trigger regeneration
      const { data, error } = await supabase.functions.invoke("run-space-panorama", {
        body: { panorama_id: panoramaId, source_render_id: panorama.source_render_id },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whole-apartment-spaces", pipelineId] });
    },
  });

  // Approve a Final 360 (locks it - IMMUTABLE after this)
  const approveFinal360 = useMutation({
    mutationFn: async ({ final360Id }: { final360Id: string }) => {
      const { error } = await supabase
        .from("floorplan_space_final360")
        .update({
          locked_approved: true,
          status: "approved",
          qa_status: "approved",
        })
        .eq("id", final360Id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whole-apartment-spaces", pipelineId] });
    },
  });

  // Reject a Final 360 AND trigger automatic retry via backend
  const rejectFinal360 = useMutation({
    mutationFn: async ({ final360Id, notes }: { final360Id: string; notes?: string }) => {
      const { data, error } = await supabase.functions.invoke("run-reject-and-retry", {
        body: {
          asset_type: "final360",
          asset_id: final360Id,
          rejection_notes: notes,
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["whole-apartment-spaces", pipelineId] });
      if (data?.blocked_for_human) {
        console.log("[rejectFinal360] Max attempts reached, requires manual review");
      }
    },
  });

  // Retry a rejected/failed Final 360
  const retryFinal360 = useMutation({
    mutationFn: async ({ final360Id }: { final360Id: string }) => {
      // Get the final360 to find panorama IDs
      const { data: final360 } = await supabase
        .from("floorplan_space_final360")
        .select("panorama_a_id, panorama_b_id")
        .eq("id", final360Id)
        .single();

      if (!final360?.panorama_a_id || !final360?.panorama_b_id) {
        throw new Error("No panorama IDs found");
      }

      // Reset status
      await supabase
        .from("floorplan_space_final360")
        .update({
          status: "pending",
          qa_status: "pending",
          output_upload_id: null,
        })
        .eq("id", final360Id);

      // Trigger regeneration
      const { data, error } = await supabase.functions.invoke("run-merge-360", {
        body: {
          final360_id: final360Id,
          panorama_a_id: final360.panorama_a_id,
          panorama_b_id: final360.panorama_b_id,
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whole-apartment-spaces", pipelineId] });
    },
  });

  // ============= Batch/Advance Pipeline Mutations =============

  // Advance pipeline to the next step (orchestrator call)
  const advancePipeline = useMutation({
    mutationFn: async ({
      pipelineId,
      fromStep,
      styledImageUploadId,
    }: {
      pipelineId: string;
      fromStep: number;
      styledImageUploadId?: string;
    }) => {
      const { data, error } = await supabase.functions.invoke("run-advance-pipeline", {
        body: {
          pipeline_id: pipelineId,
          from_step: fromStep,
          styled_image_upload_id: styledImageUploadId,
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whole-apartment-spaces", pipelineId] });
      queryClient.invalidateQueries({ queryKey: ["floorplan-pipelines"] });
    },
  });

  // Start batch renders for all active spaces
  // Start batch outputs for all queued final_prompts
  const runBatchOutputs = useMutation({
    mutationFn: async ({
      pipelineId,
      styledImageUploadId,
    }: {
      pipelineId: string;
      styledImageUploadId: string;
    }) => {
      const { data, error } = await supabase.functions.invoke("run-batch-space-outputs", {
        body: { pipeline_id: pipelineId, styled_image_upload_id: styledImageUploadId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whole-apartment-spaces", pipelineId] });
      queryClient.invalidateQueries({ queryKey: ["floorplan-pipelines"] });
      queryClient.invalidateQueries({ queryKey: ["final-prompts", pipelineId] });
    },
  });

  // Start batch panoramas for all spaces with approved renders
  const runBatchPanoramas = useMutation({
    mutationFn: async ({ pipelineId }: { pipelineId: string }) => {
      const { data, error } = await supabase.functions.invoke("run-batch-space-panoramas", {
        body: { pipeline_id: pipelineId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whole-apartment-spaces", pipelineId] });
      queryClient.invalidateQueries({ queryKey: ["floorplan-pipelines"] });
    },
  });

  // Start batch merges for all spaces with approved panoramas
  // Step 7 Quality UI Gate: merge_quality parameter is passed from the pre-run settings
  const runBatchMerges = useMutation({
    mutationFn: async ({
      pipelineId,
      mergeQuality
    }: {
      pipelineId: string;
      mergeQuality?: "2K" | "4K";
    }) => {
      const { data, error } = await supabase.functions.invoke("run-batch-space-merges", {
        body: {
          pipeline_id: pipelineId,
          merge_quality: mergeQuality,
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whole-apartment-spaces", pipelineId] });
      queryClient.invalidateQueries({ queryKey: ["floorplan-pipelines"] });
    },
  });

  // ============= Pipeline Management Mutations =============

  // Delete Pipeline and all child entities
  const deletePipeline = useMutation({
    mutationFn: async ({ pipelineId }: { pipelineId: string }) => {
      // Delete all child entities first (in order to avoid FK violations)
      // 1. Delete final360s
      const { error: final360Error } = await supabase
        .from("floorplan_space_final360")
        .delete()
        .eq("pipeline_id", pipelineId);
      if (final360Error) console.warn("Error deleting final360s:", final360Error);

      // 2. Delete panoramas
      const { error: panoramaError } = await supabase
        .from("floorplan_space_panoramas")
        .delete()
        .eq("pipeline_id", pipelineId);
      if (panoramaError) console.warn("Error deleting panoramas:", panoramaError);

      // 3. Delete renders
      const { error: renderError } = await supabase
        .from("floorplan_space_renders")
        .delete()
        .eq("pipeline_id", pipelineId);
      if (renderError) console.warn("Error deleting renders:", renderError);

      // 4. Delete spaces
      const { error: spacesError } = await supabase
        .from("floorplan_pipeline_spaces")
        .delete()
        .eq("pipeline_id", pipelineId);
      if (spacesError) console.warn("Error deleting spaces:", spacesError);

      // 5. Delete pipeline events
      const { error: eventsError } = await supabase
        .from("floorplan_pipeline_events")
        .delete()
        .eq("pipeline_id", pipelineId);
      if (eventsError) console.warn("Error deleting events:", eventsError);

      // 6. Delete pipeline reviews
      const { error: reviewsError } = await supabase
        .from("floorplan_pipeline_reviews")
        .delete()
        .eq("pipeline_id", pipelineId);
      if (reviewsError) console.warn("Error deleting reviews:", reviewsError);

      // 7. Delete global QA results
      const { error: qaError } = await supabase
        .from("global_qa_results")
        .delete()
        .eq("pipeline_id", pipelineId);
      if (qaError) console.warn("Error deleting QA results:", qaError);

      // 8. Delete spatial maps
      const { error: spatialError } = await supabase
        .from("pipeline_spatial_maps")
        .delete()
        .eq("pipeline_id", pipelineId);
      if (spatialError) console.warn("Error deleting spatial maps:", spatialError);

      // 9. Finally delete the pipeline itself
      const { error: pipelineError } = await supabase
        .from("floorplan_pipelines")
        .delete()
        .eq("id", pipelineId);
      if (pipelineError) throw pipelineError;

      return { success: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["floorplan-pipelines"] });
      queryClient.invalidateQueries({ queryKey: ["whole-apartment-spaces", pipelineId] });
    },
  });

  // Restart Pipeline - reset to Step 1 but keep original inputs
  const restartPipeline = useMutation({
    mutationFn: async ({ pipelineId }: { pipelineId: string }) => {
      // Use backend reset so we can also delete storage objects and uploads/attempts
      const { data, error } = await supabase.functions.invoke("reset-floorplan-pipeline", {
        body: { pipeline_id: pipelineId },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { success: boolean };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["floorplan-pipelines"] });
      queryClient.invalidateQueries({ queryKey: ["whole-apartment-spaces", pipelineId] });
    },
  });

  // Calculate detailed progress info for display (only active spaces)
  const progressDetails = useMemo(() => {
    const allSpaces = spacesQuery.data || [];
    // Filter to only active (non-excluded) spaces
    const activeSpaces = allSpaces.filter(
      s => !s.is_excluded && s.include_in_generation !== false
    );
    const totalSpaces = activeSpaces.length;
    const excludedCount = allSpaces.length - activeSpaces.length;
    let completedSpaces = 0;
    let rendersCompleted = 0;
    let panoramasCompleted = 0;
    let final360sCompleted = 0;
    let totalRendersNeeded = totalSpaces * 2;
    let totalPanoramasNeeded = totalSpaces * 2;
    let totalFinal360sNeeded = totalSpaces;

    for (const space of activeSpaces) {
      const renderAApproved = space.renders?.find(r => r.kind === "A")?.locked_approved;
      const renderBApproved = space.renders?.find(r => r.kind === "B")?.locked_approved;
      const panoAApproved = space.panoramas?.find(p => p.kind === "A")?.locked_approved;
      const panoBApproved = space.panoramas?.find(p => p.kind === "B")?.locked_approved;
      const final360Approved = space.final360?.locked_approved;

      if (renderAApproved) rendersCompleted++;
      if (renderBApproved) rendersCompleted++;
      if (panoAApproved) panoramasCompleted++;
      if (panoBApproved) panoramasCompleted++;
      if (final360Approved) {
        final360sCompleted++;
        completedSpaces++;
      }
    }

    return {
      totalSpaces,
      excludedCount,
      allSpacesCount: allSpaces.length,
      completedSpaces,
      rendersCompleted,
      totalRendersNeeded,
      panoramasCompleted,
      totalPanoramasNeeded,
      final360sCompleted,
      totalFinal360sNeeded,
    };
  }, [spacesQuery.data]);

  // ═══════════════════════════════════════════════════════════════════════════
  // QUALITY POLICY: Update quality for Steps 4+
  // ═══════════════════════════════════════════════════════════════════════════
  const updateQualityPostStep4 = useMutation({
    mutationFn: async ({ pipelineId, quality }: { pipelineId: string; quality: string }) => {
      const { error } = await supabase
        .from("floorplan_pipelines")
        .update({ quality_post_step4: quality })
        .eq("id", pipelineId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["floorplan-pipelines"] });
    },
  });

  // Lock ratio after pipeline starts
  const lockRatio = useMutation({
    mutationFn: async ({ pipelineId }: { pipelineId: string }) => {
      const { error } = await supabase
        .from("floorplan_pipelines")
        .update({ ratio_locked: true })
        .eq("id", pipelineId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["floorplan-pipelines"] });
    },
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SPACE EXCLUSION: Exclude/delete a space from generation
  // ═══════════════════════════════════════════════════════════════════════════
  const excludeSpace = useMutation({
    mutationFn: async ({
      spaceId,
      reason = "Manually excluded by user"
    }: {
      spaceId: string;
      reason?: string;
    }) => {
      // 1. Mark space as excluded
      const { error: spaceError } = await supabase
        .from("floorplan_pipeline_spaces")
        .update({
          is_excluded: true,
          include_in_generation: false,
          excluded_reason: reason,
          excluded_at: new Date().toISOString(),
          status: "excluded",
        })
        .eq("id", spaceId);

      if (spaceError) throw spaceError;

      // 2. Cancel/skip any pending renders for this space
      const { error: renderError } = await supabase
        .from("floorplan_space_renders")
        .update({ status: "skipped" })
        .eq("space_id", spaceId)
        .in("status", ["pending", "planned"]);

      if (renderError) console.warn("Failed to skip renders:", renderError);

      // 3. Cancel/skip any pending panoramas for this space
      const { error: panoError } = await supabase
        .from("floorplan_space_panoramas")
        .update({ status: "skipped" })
        .eq("space_id", spaceId)
        .in("status", ["pending", "planned"]);

      if (panoError) console.warn("Failed to skip panoramas:", panoError);

      // 4. Cancel/skip any pending final360 for this space
      const { error: final360Error } = await supabase
        .from("floorplan_space_final360")
        .update({ status: "skipped" })
        .eq("space_id", spaceId)
        .in("status", ["pending", "planned"]);

      if (final360Error) console.warn("Failed to skip final360:", final360Error);

      return { success: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whole-apartment-spaces", pipelineId] });
    },
  });

  // Restore an excluded space back to generation
  const restoreSpace = useMutation({
    mutationFn: async ({ spaceId }: { spaceId: string }) => {
      const { error } = await supabase
        .from("floorplan_pipeline_spaces")
        .update({
          is_excluded: false,
          include_in_generation: true,
          excluded_reason: null,
          excluded_at: null,
          status: "pending",
        })
        .eq("id", spaceId);

      if (error) throw error;
      return { success: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whole-apartment-spaces", pipelineId] });
    },
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PER-SPACE RENDER CONTROL
  // ═══════════════════════════════════════════════════════════════════════════

  // Run renders for a SINGLE space only (not batch)
  const runSingleSpaceRenders = useMutation({
    mutationFn: async ({
      pipelineId,
      spaceId,
      styledImageUploadId,
      referenceImageIds = [],
    }: {
      pipelineId: string;
      spaceId: string;
      styledImageUploadId: string;
      referenceImageIds?: string[];
    }) => {
      // DEBUG: Log start
      console.log("[runSingleSpaceRenders] space_render_start_click", { pipelineId, spaceId, styledImageUploadId, referenceImageIds });
      console.log("[runSingleSpaceRenders] space_render_api_called: run-single-space-renders");

      const { data, error } = await supabase.functions.invoke("run-single-space-renders", {
        body: {
          pipeline_id: pipelineId,
          space_id: spaceId,
          styled_image_upload_id: styledImageUploadId,
          reference_image_ids: referenceImageIds,
        },
      });

      // DEBUG: Log response
      console.log("[runSingleSpaceRenders] space_render_api_response", { data, error });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      // Check if early exit occurred
      if (data?.already_complete) {
        console.log("[runSingleSpaceRenders] EARLY EXIT detected - no renders ran", data.debug);
      }

      return data;
    },
    onSuccess: (data) => {
      console.log("[runSingleSpaceRenders] Mutation SUCCESS", data);
      queryClient.invalidateQueries({ queryKey: ["whole-apartment-spaces", pipelineId] });
    },
    onError: (error) => {
      console.error("[runSingleSpaceRenders] Mutation FAILED", error);
    },
  });

  // Update per-space reference images
  const updateSpaceReferences = useMutation({
    mutationFn: async ({
      spaceId,
      referenceImageIds,
    }: {
      spaceId: string;
      referenceImageIds: string[];
    }) => {
      const { error } = await supabase
        .from("floorplan_pipeline_spaces")
        .update({ reference_image_ids: referenceImageIds })
        .eq("id", spaceId);
      if (error) throw error;
      return { success: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whole-apartment-spaces", pipelineId] });
    },
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 1-3 AUTO-RETRY: Manual approval after retry exhaustion
  // ═══════════════════════════════════════════════════════════════════════════
  const manualApproveAfterRetryExhaustion = useMutation({
    mutationFn: async ({
      pipelineId,
      stepNumber,
      outputUploadId,
    }: {
      pipelineId: string;
      stepNumber: number;
      outputUploadId?: string;
    }) => {
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase.functions.invoke(
        "approve-pipeline-step-manually",
        {
          body: {
            pipeline_id: pipelineId,
            step_number: stepNumber,
            output_upload_id: outputUploadId ?? null,
            decision: "APPROVED",
          },
        },
      );

      if (error) throw error;
      if (!data?.pipeline) {
        throw new Error("Manual approval succeeded but no pipeline was returned");
      }

      return data as { pipeline: unknown; next_allowed_actions?: unknown };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["floorplan-pipelines"] });
      queryClient.invalidateQueries({ queryKey: ["whole-apartment-spaces", pipelineId] });
      // These are best-effort; components using them may have their own keys.
      queryClient.invalidateQueries({ queryKey: ["floorplan-pipeline-events"] });
      queryClient.invalidateQueries({ queryKey: ["floorplan-pipeline-reviews"] });
    },
  });

  // Reject step after retry exhaustion (stop pipeline)
  const rejectAfterRetryExhaustion = useMutation({
    mutationFn: async ({ pipelineId, stepNumber }: { pipelineId: string; stepNumber: number }) => {
      if (!user) throw new Error("Not authenticated");

      console.log(`[REJECT_STOP_PIPELINE] Rejecting step ${stepNumber} for pipeline ${pipelineId}`);

      const { error } = await supabase
        .from("floorplan_pipelines")
        .update({
          status: "failed",
          whole_apartment_phase: "failed", // CRITICAL: Update SSOT for state machine
          last_error: `Step ${stepNumber} rejected after 5 failed QA attempts`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", pipelineId)
        .eq("owner_id", user.id);

      if (error) {
        console.error(`[REJECT_STOP_PIPELINE] Failed:`, error);
        throw error;
      }

      console.log(`[REJECT_STOP_PIPELINE] Successfully stopped pipeline at step ${stepNumber}`);
      return { success: true, stepNumber };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["floorplan-pipelines"] });
    },
  });

  // Restart a specific step (authoritative backend reset)
  // This calls the restart-pipeline-step edge function which:
  // 1. Increments reset_counter for race-safety
  // 2. Deletes ALL outputs, events, reviews, attempts for this step and downstream
  // 3. Resets pipeline state to pending
  // 4. Optionally auto-starts the step (only for steps 1-3)
  const restartStep = useMutation({
    mutationFn: async ({
      pipelineId,
      stepNumber,
      autoStart = false
    }: {
      pipelineId: string;
      stepNumber: number;
      autoStart?: boolean;
    }) => {
      if (!user) throw new Error("Not authenticated");

      console.log(`[RESTART_STEP] Calling restart-pipeline-step edge function for step ${stepNumber}, autoStart=${autoStart}`);

      const { data, error } = await supabase.functions.invoke("restart-pipeline-step", {
        body: {
          pipeline_id: pipelineId,
          step_number: stepNumber,
          auto_start: autoStart,
        },
      });

      if (error) {
        console.error(`[RESTART_STEP] Edge function error:`, error);
        throw new Error(error.message || "Failed to restart step");
      }

      if (data?.error) {
        console.error(`[RESTART_STEP] Backend error:`, data.error);
        throw new Error(data.error);
      }

      console.log(`[RESTART_STEP] Success:`, data);
      return {
        success: true,
        stepNumber,
        deletedUploads: data?.deleted_uploads || 0,
        resetCounter: data?.reset_counter,
        autoStarted: data?.auto_started || false,
      };
    },
    onSuccess: (data) => {
      console.log(`[RESTART_STEP] Step ${data.stepNumber} restarted, deleted ${data.deletedUploads} outputs, autoStarted=${data.autoStarted}`);
      // Invalidate all relevant queries to clear UI cache
      queryClient.invalidateQueries({ queryKey: ["floorplan-pipelines"] });
      queryClient.invalidateQueries({ queryKey: ["step-attempts"] });
      queryClient.invalidateQueries({ queryKey: ["pipeline-events"] });
      queryClient.invalidateQueries({ queryKey: ["whole-apartment-spaces"] });
    },
    onError: (error) => {
      console.error("[RESTART_STEP] Error:", error);
    },
  });

  // Rollback to previous step (rewind pipeline one step backward)
  // This calls the rollback-to-previous-step edge function which:
  // 1. Resets the current step (clears outputs, jobs, events)
  // 2. Moves the pipeline pointer back to the previous step
  // 3. Leaves the previous step in its completed/approved state
  const rollbackToPreviousStep = useMutation({
    mutationFn: async ({
      pipelineId,
      currentStepNumber
    }: {
      pipelineId: string;
      currentStepNumber: number;
    }) => {
      if (!user) throw new Error("Not authenticated");

      if (currentStepNumber < 1) {
        throw new Error("Cannot rollback from Step 0");
      }

      console.log(`[ROLLBACK_STEP] Calling rollback-to-previous-step for step ${currentStepNumber}`);

      const { data, error } = await supabase.functions.invoke("rollback-to-previous-step", {
        body: {
          pipeline_id: pipelineId,
          current_step_number: currentStepNumber,
        },
      });

      if (error) {
        console.error(`[ROLLBACK_STEP] Edge function error:`, error);
        throw new Error(error.message || "Failed to rollback step");
      }

      if (data?.error) {
        console.error(`[ROLLBACK_STEP] Backend error:`, data.error);
        throw new Error(data.error);
      }

      console.log(`[ROLLBACK_STEP] Success:`, data);
      return {
        success: true,
        fromStep: data?.from_step || currentStepNumber,
        toStep: data?.to_step || currentStepNumber - 1,
        deletedUploads: data?.deleted_uploads || 0,
        resetCounter: data?.reset_counter,
        targetPhase: data?.target_phase,
      };
    },
    onSuccess: (data) => {
      console.log(`[ROLLBACK_STEP] Rolled back from step ${data.fromStep} to step ${data.toStep}, deleted ${data.deletedUploads} outputs`);
      // Invalidate all relevant queries to clear UI cache
      queryClient.invalidateQueries({ queryKey: ["floorplan-pipelines"] });
      queryClient.invalidateQueries({ queryKey: ["step-attempts"] });
      queryClient.invalidateQueries({ queryKey: ["pipeline-events"] });
      queryClient.invalidateQueries({ queryKey: ["whole-apartment-spaces"] });
      queryClient.invalidateQueries({ queryKey: ["camera-markers"] });
    },
    onError: (error) => {
      console.error("[ROLLBACK_STEP] Error:", error);
    },
  });

  // Toggle pipeline enabled state (pause/resume)
  const togglePipelineEnabled = useMutation({
    mutationFn: async ({
      pipelineId,
      enabled,
      pauseReason
    }: {
      pipelineId: string;
      enabled: boolean;
      pauseReason?: string;
    }) => {
      if (!user) throw new Error("Not authenticated");

      const updateData: Record<string, unknown> = {
        is_enabled: enabled,
        run_state: enabled ? "active" : "paused",
        updated_at: new Date().toISOString(),
      };

      if (enabled) {
        updateData.resumed_at = new Date().toISOString();
        updateData.pause_reason = null;
      } else {
        updateData.paused_at = new Date().toISOString();
        updateData.pause_reason = pauseReason || null;
      }

      const { error } = await supabase
        .from("floorplan_pipelines")
        .update(updateData)
        .eq("id", pipelineId)
        .eq("owner_id", user.id);

      if (error) throw error;
      return { pipelineId, enabled };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["floorplan-pipelines"] });
      queryClient.invalidateQueries({ queryKey: ["whole-apartment-spaces", pipelineId] });
    },
    onError: (error) => {
      console.error("[togglePipelineEnabled] Error:", error);
    },
  });

  // ============= Continue to Next Step (Pure State Transition) =============
  // This mutation ONLY advances the phase - it NEVER triggers AI work
  const continueToStep = useMutation({
    mutationFn: async ({
      pipelineId,
      fromStep,
      fromPhase,
    }: {
      pipelineId: string;
      fromStep: number;
      fromPhase: string;
    }) => {
      if (!user) throw new Error("Not authenticated");

      console.log(`[continueToStep] Requesting transition from phase=${fromPhase} step=${fromStep}`);

      const { data, error } = await supabase.functions.invoke("continue-pipeline-step", {
        body: {
          pipeline_id: pipelineId,
          from_step: fromStep,
          from_phase: fromPhase,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (!data?.pipeline) throw new Error("No pipeline returned from transition");

      return data;
    },
    onSuccess: (data) => {
      console.log(`[continueToStep] Success: ${data.transition?.from_phase} → ${data.transition?.to_phase}`);
      queryClient.invalidateQueries({ queryKey: ["floorplan-pipelines"] });
      queryClient.invalidateQueries({ queryKey: ["whole-apartment-spaces", pipelineId] });
    },
    onError: (error) => {
      console.error("[continueToStep] Error:", error);
      // Invalidate to show current state
      queryClient.invalidateQueries({ queryKey: ["floorplan-pipelines"] });
    },
  });

  // ============= Recover Pipeline State (Manual Recovery) =============
  const recoverPipelineState = useMutation({
    mutationFn: async ({ pipelineId }: { pipelineId: string }) => {
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase.rpc("recover_pipeline_state", {
        p_pipeline_id: pipelineId,
        p_owner_id: user.id,
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["floorplan-pipelines"] });
      queryClient.invalidateQueries({ queryKey: ["whole-apartment-spaces", pipelineId] });
    },
    onError: (error) => {
      console.error("[recoverPipelineState] Error:", error);
    },
  });

  return {
    spaces: spacesQuery.data,
    isLoadingSpaces: spacesQuery.isLoading,
    progress,
    progressDetails,
    // Step mutations
    runSpaceAnalysis,
    runTopDown3D,
    runStyleTopDown,
    runDetectSpaces,
    retryDetectSpaces,
    runSpaceRender,
    runSpacePanorama,
    runMerge360,
    // Batch mutations (Step 4-6 parallel processing)
    advancePipeline,
    saveCameraIntents,
    composeFinalPrompts,
    runBatchOutputs,
    runBatchPanoramas,
    runBatchMerges,
    // Per-space control
    runSingleSpaceRenders,
    updateSpaceReferences,
    // Approval mutations
    approveRender,
    rejectRender,
    retryRender,
    approvePanorama,
    rejectPanorama,
    retryPanorama,
    approveFinal360,
    rejectFinal360,
    retryFinal360,
    // Pipeline management
    deletePipeline,
    restartPipeline,
    togglePipelineEnabled,
    // Quality policy
    updateQualityPostStep4,
    lockRatio,
    // Space exclusion
    excludeSpace,
    restoreSpace,
    // Step management (reset + rollback)
    restartStep,
    rollbackToPreviousStep,
    manualApproveAfterRetryExhaustion,
    rejectAfterRetryExhaustion,
    // State transitions (pure, no AI)
    continueToStep,
    recoverPipelineState,
  };
}
