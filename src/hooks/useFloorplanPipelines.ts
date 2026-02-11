import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

export interface FloorplanPipeline {
  id: string;
  project_id: string;
  owner_id: string;
  floor_plan_upload_id: string;
  status: string;
  current_step: number;
  step_outputs: Record<string, any>;
  last_error: string | null;
  camera_position: string | null;
  forward_direction: string | null;
  output_resolution: string | null;
  aspect_ratio: string | null;
  created_at: string;
  updated_at: string;
  // Whole Apartment Pipeline fields
  pipeline_mode: string | null;
  whole_apartment_phase: string | null;
  architecture_version: string | null;
  global_phase: string | null;
  global_3d_render_id: string | null;
  global_style_bible: Record<string, any> | null;
  floor_plan?: {
    id: string;
    original_filename: string | null;
    bucket: string;
    path: string;
  };
  // Pause/Resume control fields
  is_enabled: boolean;
  run_state: "active" | "paused" | "completed" | "failed" | "cancelled";
  paused_at: string | null;
  resumed_at: string | null;
  pause_reason: string | null;
}

export interface PipelineEvent {
  id: string;
  pipeline_id: string;
  owner_id: string;
  step_number: number;
  ts: string;
  type: string;
  message: string;
  progress_int: number;
}

export interface PipelineReview {
  id: string;
  pipeline_id: string;
  owner_id: string;
  step_number: number;
  decision: "approved" | "rejected";
  notes: string | null;
  created_at: string;
}

export function useFloorplanPipelines(projectId: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const pipelinesQuery = useQuery({
    queryKey: ["floorplan-pipelines", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("floorplan_pipelines")
        .select(`
          *,
          floor_plan:uploads!floorplan_pipelines_floor_plan_upload_id_fkey(id, original_filename, bucket, path, deleted_at)
        `)
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      // Filter out pipelines where the source floor plan has been deleted
      return (data || []).filter((p: any) => !p.floor_plan || !p.floor_plan.deleted_at) as FloorplanPipeline[];
    },
    enabled: !!user && !!projectId
  });

  const createPipeline = useMutation({
    mutationFn: async ({
      floorPlanUploadId,
      outputResolution = "2K",
      aspectRatio = "16:9",
      startFromStep = 1,
      inputUploadId,
      attachSource, // NEW: track if created from Creations attach
      pipelineMode = "legacy" // NEW: pipeline mode
    }: {
      floorPlanUploadId: string;
      outputResolution?: string;
      aspectRatio?: string;
      startFromStep?: number;
      inputUploadId?: string; // For starting from a specific step with an existing image
      attachSource?: { type: "creations_attach"; sourceImageId: string }; // NEW
      pipelineMode?: "legacy" | "whole_apartment"; // NEW
    }) => {
      if (!user) throw new Error("Not authenticated");

      // Build step_outputs if starting from a later step
      let stepOutputs: Record<string, any> = {};

      // NEW: Track attach origin metadata
      if (attachSource) {
        stepOutputs._attach_origin = {
          source: attachSource.type,
          source_image_id: attachSource.sourceImageId,
          attached_at: new Date().toISOString()
        };
      }

      if (startFromStep > 1 && inputUploadId) {
        // Mark previous steps as "skipped" with the provided input as their output
        for (let s = 1; s < startFromStep; s++) {
          stepOutputs[`step${s}`] = {
            output_upload_id: inputUploadId,
            qa_decision: "approved",
            qa_reason: attachSource
              ? "Attached from Creations"
              : "Skipped - using imported image from Creations"
          };
        }
      }

      // Determine initial status and phase based on mode
      const isWholeApartment = pipelineMode === "whole_apartment";
      const initialStatus = isWholeApartment ? "step1_pending" : `step${startFromStep}_pending`;
      const initialPhase = isWholeApartment ? "upload" : null;
      // For whole_apartment mode: phase "upload" expects step 0
      const initialStep = isWholeApartment ? 0 : startFromStep;

      const { data, error } = await supabase
        .from("floorplan_pipelines")
        .insert({
          project_id: projectId,
          owner_id: user.id,
          floor_plan_upload_id: floorPlanUploadId,
          status: initialStatus,
          current_step: initialStep,
          output_resolution: outputResolution,
          aspect_ratio: aspectRatio,
          step_outputs: Object.keys(stepOutputs).length > 0 ? stepOutputs : null,
          pipeline_mode: pipelineMode,
          whole_apartment_phase: initialPhase
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["floorplan-pipelines", projectId] });
      const startStep = variables.startFromStep || 1;
      const isAttached = !!variables.attachSource;
      toast({
        title: isAttached
          ? `Pipeline created from attached image (Step ${startStep})`
          : startStep > 1
            ? `Pipeline created starting from Step ${startStep}`
            : "Pipeline created"
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to create pipeline",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
    }
  });

  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * PHASE → EDGE FUNCTION ROUTING MAP (SSOT)
   * ═══════════════════════════════════════════════════════════════════════════
   * 
   * Routes based on whole_apartment_phase (single source of truth).
   * DO NOT route based on current_step alone - it may be out of sync.
   * 
   * If a phase is not in this map, it falls through to run-pipeline-step.
   */
  const PHASE_TO_FUNCTION: Record<string, string> = {
    // Step 0: Space Analysis phases → run-space-analysis
    "upload": "run-space-analysis",
    "space_analysis_pending": "run-space-analysis",
    "space_analysis_running": "run-space-analysis", // Already running, but route correctly
    "space_analysis_complete": "run-space-analysis", // Re-run if needed

    // Step 4: Detect Spaces phases → run-detect-spaces
    "detect_spaces_pending": "run-detect-spaces",
    "detecting_spaces": "run-detect-spaces",
    "spaces_detected": "run-detect-spaces",

    // Steps 1, 2, 3, 5, 6, 7 use run-pipeline-step (default fallback)
  };

  const startStep = useMutation({
    mutationFn: async ({
      pipelineId,
      cameraPosition,
      forwardDirection,
      designRefUploadIds,
      styleTitle,
      outputCount = 1,
      isAutoRerender = false,
      autoRerenderAttempt = 0,
      step3PresetId,
      step3CustomPrompt
    }: {
      pipelineId: string;
      cameraPosition?: string;
      forwardDirection?: string;
      designRefUploadIds?: string[];
      styleTitle?: string;
      outputCount?: number;
      isAutoRerender?: boolean;
      autoRerenderAttempt?: number;
      step3PresetId?: string;
      step3CustomPrompt?: string;
    }): Promise<any> => {
      // ─────────────────────────────────────────────────────────────────────
      // PHASE-BASED ROUTING (SSOT = whole_apartment_phase)
      // ─────────────────────────────────────────────────────────────────────
      const { data: pipelineMeta, error: pipelineMetaErr } = await supabase
        .from("floorplan_pipelines")
        .select("current_step, whole_apartment_phase")
        .eq("id", pipelineId)
        .maybeSingle();

      if (pipelineMetaErr) throw pipelineMetaErr;
      if (!pipelineMeta) throw new Error("Pipeline not found");

      const currentStep = pipelineMeta.current_step ?? 1;
      const phase = pipelineMeta.whole_apartment_phase ?? "upload";

      // Determine target function from phase map
      const targetFunction = PHASE_TO_FUNCTION[phase] ?? "run-pipeline-step";

      // Log routing decision for debugging
      console.log(`[startStep] Routing decision: phase="${phase}", currentStep=${currentStep}, targetFunction="${targetFunction}"`);

      // ─────────────────────────────────────────────────────────────────────
      // ROUTE TO CORRECT EDGE FUNCTION
      // ─────────────────────────────────────────────────────────────────────

      if (targetFunction === "run-space-analysis") {
        console.log(`[startStep] Invoking run-space-analysis for phase="${phase}"`);
        const { data, error } = await supabase.functions.invoke("run-space-analysis", {
          body: { pipeline_id: pipelineId },
        });
        if (error) {
          console.error(`[startStep] run-space-analysis error:`, error);
          throw error;
        }
        if (data?.error) {
          console.error(`[startStep] run-space-analysis returned error:`, data.error);
          throw new Error(data.error);
        }
        return data;
      }

      if (targetFunction === "run-detect-spaces") {
        console.log(`[startStep] Invoking run-detect-spaces for phase="${phase}"`);
        const { data, error } = await supabase.functions.invoke("run-detect-spaces", {
          body: { pipeline_id: pipelineId },
        });
        if (error) {
          console.error(`[startStep] run-detect-spaces error:`, error);
          throw error;
        }
        if (data?.error) {
          console.error(`[startStep] run-detect-spaces returned error:`, data.error);
          throw new Error(data.error);
        }
        return data;
      }

      // Default: run-pipeline-step for Steps 1, 2, 3, 5, 6, 7
      console.log(`[startStep] Invoking run-pipeline-step for phase="${phase}", step=${currentStep}`);
      const { data, error } = await supabase.functions.invoke("run-pipeline-step", {
        body: {
          pipeline_id: pipelineId,
          camera_position: cameraPosition,
          forward_direction: forwardDirection,
          design_ref_upload_ids: designRefUploadIds,
          style_title: styleTitle,
          output_count: outputCount,
          auto_rerender_attempt: autoRerenderAttempt,
          step_3_preset_id: step3PresetId,
          step_3_custom_prompt: step3CustomPrompt,
        },
      });

      if (error) {
        console.error(`[startStep] run-pipeline-step error:`, error);
        throw error;
      }
      if (data?.error) {
        console.error(`[startStep] run-pipeline-step returned error:`, data.error);
        throw new Error(data.error);
      }

      // Handle QA auto-rerender loop response
      if (data?.autoRerender === true) {
        console.log(`[Pipeline] QA auto-rerender triggered: attempt ${data.attempt}/${data.maxAttempts}`);

        toast({
          title: `Auto-rerender in progress (${data.attempt}/${data.maxAttempts})`,
          description: `QA rejected: ${data.qaReason?.slice(0, 80)}...`,
        });

        await new Promise(r => setTimeout(r, 1500));

        return startStep.mutateAsync({
          pipelineId,
          cameraPosition: data.camera_position,
          forwardDirection: data.forward_direction,
          designRefUploadIds,
          styleTitle,
          isAutoRerender: true,
          autoRerenderAttempt: data.attempt
        });
      }

      return data;
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["floorplan-pipelines", projectId] });

      if (data?.autoRerender !== true) {
        if (variables.isAutoRerender) {
          toast({ title: "Auto-rerender completed successfully!" });
        }
      }
    },
    onError: (error) => {
      // Surface the actual error message to the user
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error(`[startStep] Error surfaced to user:`, errorMessage);
      toast({
        title: "Failed to start step",
        description: errorMessage,
        variant: "destructive"
      });
    }
  });

  const approveStep = useMutation({
    mutationFn: async ({
      pipelineId,
      stepNumber,
      notes
    }: {
      pipelineId: string;
      stepNumber: number;
      notes?: string;
    }) => {
      if (!user) throw new Error("Not authenticated");

      // Insert review
      const { error: reviewError } = await supabase
        .from("floorplan_pipeline_reviews")
        .insert({
          pipeline_id: pipelineId,
          owner_id: user.id,
          step_number: stepNumber,
          decision: "approved",
          notes
        });

      if (reviewError) throw reviewError;

      // Update pipeline to next step (4 steps total)
      const nextStep = stepNumber + 1;
      const nextStatus = nextStep > 4 ? "completed" : `step${nextStep}_pending`;
      console.log(`[Pipeline] approveStep: step ${stepNumber} → next step ${nextStep}, status: ${nextStatus}`);

      const { error: updateError } = await supabase
        .from("floorplan_pipelines")
        .update({
          status: nextStatus,
          current_step: nextStep > 4 ? 4 : nextStep,
          updated_at: new Date().toISOString()
        })
        .eq("id", pipelineId);

      if (updateError) throw updateError;

      return { nextStep, nextStatus };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["floorplan-pipelines", projectId] });
      toast({
        title: data.nextStatus === "completed"
          ? "Pipeline completed!"
          : `Step approved - Ready for step ${data.nextStep}`
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to approve step",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
    }
  });

  const rejectStep = useMutation({
    mutationFn: async ({
      pipelineId,
      stepNumber,
      notes,
      autoRerender = true // New: auto-trigger rerender after rejection
    }: {
      pipelineId: string;
      stepNumber: number;
      notes?: string;
      autoRerender?: boolean;
    }) => {
      if (!user) throw new Error("Not authenticated");

      // Get pipeline info for notification and to preserve the rejected output
      const { data: pipeline, error: pipelineErr } = await supabase
        .from("floorplan_pipelines")
        .select("project_id, step_outputs, output_resolution, aspect_ratio")
        .eq("id", pipelineId)
        .single();

      if (pipelineErr) throw pipelineErr;

      // Insert review
      const { error: reviewError } = await supabase
        .from("floorplan_pipeline_reviews")
        .insert({
          pipeline_id: pipelineId,
          owner_id: user.id,
          step_number: stepNumber,
          decision: "rejected",
          notes
        });

      if (reviewError) throw reviewError;

      // Update the step_outputs to mark this as rejected (but KEEP the output_upload_id)
      const currentOutputs = (pipeline?.step_outputs || {}) as Record<string, any>;
      const stepKey = `step${stepNumber}`;

      // Track rejection history for Step 3 camera strategy
      const existingRejections = currentOutputs[stepKey]?.rejection_history || [];
      const updatedOutputs = {
        ...currentOutputs,
        [stepKey]: {
          ...currentOutputs[stepKey],
          qa_decision: "rejected",
          qa_reason: notes || "Rejected by user",
          rejection_history: [
            ...existingRejections,
            {
              reason: notes,
              rejected_at: new Date().toISOString(),
              output_upload_id: currentOutputs[stepKey]?.output_upload_id
            }
          ]
        }
      };

      // Reset to step pending (allow re-run) but KEEP the rejected output visible
      const { error: updateError } = await supabase
        .from("floorplan_pipelines")
        .update({
          status: `step${stepNumber}_pending`,
          step_outputs: updatedOutputs,
          updated_at: new Date().toISOString()
        })
        .eq("id", pipelineId);

      if (updateError) throw updateError;

      // Create rejection notification
      if (pipeline?.project_id) {
        await supabase.from("notifications").insert({
          owner_id: user.id,
          project_id: pipeline.project_id,
          type: "pipeline_rejected",
          title: `Pipeline Step ${stepNumber} Rejected`,
          message: notes || "Step was rejected and needs to be re-run",
          target_route: `/projects/${pipeline.project_id}`,
          target_params: { tab: "floorplan-jobs", pipelineId: pipelineId }
        });
      }

      console.log(`[Pipeline] rejectStep: step ${stepNumber} rejected, autoRerender=${autoRerender}`);

      return {
        pipelineId,
        stepNumber,
        autoRerender,
        outputResolution: pipeline?.output_resolution,
        aspectRatio: pipeline?.aspect_ratio
      };
    },
    onSuccess: async (data) => {
      queryClient.invalidateQueries({ queryKey: ["floorplan-pipelines", projectId] });

      // Auto-trigger rerender if enabled (with same Ratio/Quality)
      if (data.autoRerender) {
        toast({ title: "Step rejected - Starting auto re-render with same settings..." });

        // Trigger the step to re-run automatically
        try {
          await startStep.mutateAsync({ pipelineId: data.pipelineId });
        } catch (error) {
          console.error("Auto-rerender failed:", error);
          toast({
            title: "Auto re-render failed",
            description: "You can manually click 'Run Step' to retry.",
            variant: "destructive"
          });
        }
      } else {
        toast({ title: "Step rejected - You can re-run this step" });
      }
    },
    onError: (error) => {
      toast({
        title: "Failed to reject step",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
    }
  });

  const attachToPanoramas = useMutation({
    mutationFn: async ({ pipelineId, outputUploadId }: { pipelineId: string; outputUploadId: string }) => {
      const { data, error } = await supabase.functions.invoke("attach-pipeline-output", {
        body: { pipeline_id: pipelineId, output_upload_id: outputUploadId }
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["uploads", projectId] });
      toast({
        title: "Attached to Panorama Uploads",
        description: "The pipeline output has been added to your panoramas"
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to attach",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
    }
  });

  const updateSettings = useMutation({
    mutationFn: async ({
      pipelineId,
      outputResolution,
      aspectRatio
    }: {
      pipelineId: string;
      outputResolution: string;
      aspectRatio: string;
    }) => {
      const { error } = await supabase
        .from("floorplan_pipelines")
        .update({
          output_resolution: outputResolution,
          aspect_ratio: aspectRatio,
          updated_at: new Date().toISOString()
        })
        .eq("id", pipelineId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["floorplan-pipelines", projectId] });
    },
    onError: (error) => {
      toast({
        title: "Failed to update settings",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
    }
  });

  const resetPipeline = useMutation({
    mutationFn: async ({ pipelineId }: { pipelineId: string }) => {
      // Retry logic with exponential backoff for transient errors
      let lastError: Error | null = null;
      const maxRetries = 2;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const { data, error } = await supabase.functions.invoke("reset-floorplan-pipeline", {
            body: { pipeline_id: pipelineId }
          });

          if (error) {
            // Check for transient errors
            const isTransient = error.message?.includes('503') ||
              error.message?.includes('BOOT_ERROR');
            if (isTransient && attempt < maxRetries) {
              await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
              lastError = error;
              continue;
            }
            throw error;
          }
          if (data?.error) throw new Error(data.error);
          return data;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          if (attempt < maxRetries) {
            await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
          }
        }
      }

      throw lastError || new Error("Failed to reset pipeline");
    },
    onSuccess: (data) => {
      // Force immediate refetch to update UI
      queryClient.invalidateQueries({ queryKey: ["floorplan-pipelines", projectId] });
      queryClient.invalidateQueries({ queryKey: ["pipeline-events"] });
      queryClient.invalidateQueries({ queryKey: ["pipeline-reviews"] });
      toast({
        title: "Pipeline reset",
        description: "Ready to start Step 1."
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to reset pipeline",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
    }
  });

  const deletePipeline = useMutation({
    mutationFn: async ({ pipelineId }: { pipelineId: string }) => {
      if (!user) throw new Error("Not authenticated");

      console.log(`[Pipeline Delete] Starting deletion of pipeline: ${pipelineId}`);
      console.log(`[Pipeline Delete] IMPORTANT: Creations assets will be PRESERVED`);

      // Delete pipeline events first
      const { error: eventsError } = await supabase
        .from("floorplan_pipeline_events")
        .delete()
        .eq("pipeline_id", pipelineId);

      if (eventsError) {
        console.warn(`[Pipeline Delete] Events deletion warning:`, eventsError);
      } else {
        console.log(`[Pipeline Delete] Deleted pipeline events`);
      }

      // Delete pipeline reviews
      const { error: reviewsError } = await supabase
        .from("floorplan_pipeline_reviews")
        .delete()
        .eq("pipeline_id", pipelineId);

      if (reviewsError) {
        console.warn(`[Pipeline Delete] Reviews deletion warning:`, reviewsError);
      } else {
        console.log(`[Pipeline Delete] Deleted pipeline reviews`);
      }

      // Delete the pipeline itself (output uploads are PRESERVED for Creations)
      const { error } = await supabase
        .from("floorplan_pipelines")
        .delete()
        .eq("id", pipelineId)
        .eq("owner_id", user.id);

      if (error) throw error;

      console.log(`[Pipeline Delete] Pipeline ${pipelineId} deleted - Creations assets preserved`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["floorplan-pipelines", projectId] });
      toast({ title: "Pipeline deleted" });
    },
    onError: (error) => {
      toast({
        title: "Failed to delete pipeline",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
    }
  });

  // Skip to a specific step (e.g., user satisfied with Step 2, skip directly to Step 3)
  const skipToStep = useMutation({
    mutationFn: async ({ pipelineId, targetStep }: { pipelineId: string; targetStep: number }) => {
      if (!user) throw new Error("Not authenticated");

      // Get the current pipeline to mark previous step as skipped
      const { data: pipeline, error: pipelineErr } = await supabase
        .from("floorplan_pipelines")
        .select("current_step, step_outputs")
        .eq("id", pipelineId)
        .single();

      if (pipelineErr) throw pipelineErr;

      const currentStep = pipeline?.current_step || 1;
      if (targetStep <= currentStep) {
        throw new Error("Cannot skip to a previous or current step");
      }

      // Update step outputs to mark current step as "skipped forward"
      const stepOutputs = (pipeline?.step_outputs || {}) as Record<string, any>;
      stepOutputs[`step${currentStep}`] = {
        ...stepOutputs[`step${currentStep}`],
        skipped_forward: true,
        skipped_at: new Date().toISOString()
      };

      // Update pipeline to target step
      const { error: updateError } = await supabase
        .from("floorplan_pipelines")
        .update({
          status: `step${targetStep}_pending`,
          current_step: targetStep,
          step_outputs: stepOutputs,
          updated_at: new Date().toISOString()
        })
        .eq("id", pipelineId);

      if (updateError) throw updateError;

      // Insert review for skipped step
      await supabase.from("floorplan_pipeline_reviews").insert({
        pipeline_id: pipelineId,
        owner_id: user.id,
        step_number: currentStep,
        decision: "approved",
        notes: `Skipped forward to Step ${targetStep}`
      });

      return { pipelineId, targetStep };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["floorplan-pipelines", projectId] });
      toast({ title: `Skipped to Step ${data.targetStep}` });
    },
    onError: (error) => {
      toast({
        title: "Failed to skip step",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
    }
  });

  // Go back to a previous step (destructive - deletes all outputs after that step)
  const goBackToStep = useMutation({
    mutationFn: async ({ pipelineId, targetStep }: { pipelineId: string; targetStep: number }) => {
      if (!user) throw new Error("Not authenticated");
      if (targetStep < 1) throw new Error("Cannot go back before Step 1");

      // Get the current pipeline
      const { data: pipeline, error: pipelineErr } = await supabase
        .from("floorplan_pipelines")
        .select("current_step, step_outputs")
        .eq("id", pipelineId)
        .single();

      if (pipelineErr) throw pipelineErr;

      const currentStep = pipeline?.current_step || 1;
      if (targetStep >= currentStep) {
        throw new Error("Cannot go back to current or future step");
      }

      const stepOutputs = (pipeline?.step_outputs || {}) as Record<string, any>;
      const outputsToDelete: string[] = [];

      // Collect all output upload IDs to delete (from targetStep onwards)
      for (let step = targetStep; step <= 4; step++) {
        const stepData = stepOutputs[`step${step}`];
        if (stepData?.output_upload_id) {
          outputsToDelete.push(stepData.output_upload_id);
        }
        // Handle batch outputs
        if (stepData?.batch_outputs && Array.isArray(stepData.batch_outputs)) {
          for (const batch of stepData.batch_outputs) {
            if (batch.output_upload_id) {
              outputsToDelete.push(batch.output_upload_id);
            }
          }
        }
        // Clear the step output
        delete stepOutputs[`step${step}`];
      }

      console.log(`[Pipeline GoBack] Preserving ${outputsToDelete.length} outputs from steps ${targetStep}-4 for Creations`);

      // Delete reviews for steps >= targetStep
      await supabase
        .from("floorplan_pipeline_reviews")
        .delete()
        .eq("pipeline_id", pipelineId)
        .gte("step_number", targetStep);

      // Delete events for steps >= targetStep
      await supabase
        .from("floorplan_pipeline_events")
        .delete()
        .eq("pipeline_id", pipelineId)
        .gte("step_number", targetStep);

      // Update pipeline to target step
      const { error: updateError } = await supabase
        .from("floorplan_pipelines")
        .update({
          status: `step${targetStep}_pending`,
          current_step: targetStep,
          step_outputs: stepOutputs,
          last_error: null,
          updated_at: new Date().toISOString()
        })
        .eq("id", pipelineId);

      if (updateError) throw updateError;

      return { pipelineId, targetStep, preservedCount: outputsToDelete.length };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["floorplan-pipelines", projectId] });
      queryClient.invalidateQueries({ queryKey: ["pipeline-events"] });
      queryClient.invalidateQueries({ queryKey: ["pipeline-reviews"] });
      queryClient.invalidateQueries({ queryKey: ["creations", projectId] });
      toast({
        title: `Returned to Step ${data.targetStep}`,
        description: `${data.preservedCount} output(s) preserved in Creations`
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to go back",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
    }
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
      queryClient.invalidateQueries({ queryKey: ["floorplan-pipelines", projectId] });
      toast({
        title: data.enabled ? "Pipeline resumed" : "Pipeline paused",
        description: data.enabled
          ? "Jobs will now continue processing"
          : "No new jobs will be created"
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to update pipeline state",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
    }
  });

  return {
    pipelines: pipelinesQuery.data || [],
    isLoading: pipelinesQuery.isLoading,
    createPipeline,
    startStep,
    approveStep,
    rejectStep,
    skipToStep,
    goBackToStep,
    attachToPanoramas,
    updateSettings,
    resetPipeline,
    deletePipeline,
    togglePipelineEnabled
  };
}

export function usePipelineEvents(pipelineId: string | null) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["pipeline-events", pipelineId],
    queryFn: async () => {
      if (!pipelineId) return [];

      const { data, error } = await supabase
        .from("floorplan_pipeline_events")
        .select("*")
        .eq("pipeline_id", pipelineId)
        .order("ts", { ascending: true });

      if (error) throw error;
      return data as PipelineEvent[];
    },
    enabled: !!user && !!pipelineId
  });
}

export function usePipelineReviews(pipelineId: string | null) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["pipeline-reviews", pipelineId],
    queryFn: async () => {
      if (!pipelineId) return [];

      const { data, error } = await supabase
        .from("floorplan_pipeline_reviews")
        .select("*")
        .eq("pipeline_id", pipelineId)
        .order("created_at", { ascending: true });

      if (error) throw error;
      return data as PipelineReview[];
    },
    enabled: !!user && !!pipelineId
  });
}
