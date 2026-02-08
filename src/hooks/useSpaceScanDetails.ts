import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { PanoramaPointScanResult, EmbeddedCameraContext } from "./useCameraScan";

// ============= Types =============

export interface CameraForSpace {
  camera_id: string;
  label: string;
  slot: "A" | "B";
  panorama_point_id: string;
  panorama_point_label: string;
  x_norm: number;
  y_norm: number;
  yaw_deg: number;
  fov_deg: number;
  facing_summary: string;
  warnings: string[];
  prompt_hints: string[];
  confidence: number;
}

export interface SpaceScanSummary {
  space_id: string;
  space_name: string;
  space_type: string;
  source: "analysis" | "manual";
  confidence: number;
  cameras: CameraForSpace[];
  space_warnings: string[];
  expected_outputs: string;
}

/** Input image reference for a prompt */
export interface PromptInputImage {
  type: "camera_screenshot" | "step2_plan" | "camera_a_output";
  label: string;
  upload_id?: string;
  storage_path?: string;
  description: string;
}

export interface PromptPreview {
  space_id: string;
  camera_slot: "A" | "B";
  render_id: string;
  camera_marker_id: string | null;
  camera_label: string | null;
  final_prompt_text: string;
  status: string;
  input_images: PromptInputImage[];
  provider: string;
  model: string;
  aspect_ratio: string;
  quality: string;
  seed?: string;
  num_outputs: number;
  constraints: string[];
}

export interface SpacePromptPreviews {
  render_a?: PromptPreview;
  render_b?: PromptPreview;
}

// ============= Hook =============

export function useSpaceScanDetails(pipelineId: string | undefined) {
  const { user } = useAuth();

  // Fetch the latest scan results
  const scanQuery = useQuery({
    queryKey: ["camera-scan-details", pipelineId],
    queryFn: async () => {
      if (!pipelineId || !user) return null;

      const { data, error } = await supabase
        .from("pipeline_camera_scans")
        .select("*")
        .eq("pipeline_id", pipelineId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
    enabled: !!pipelineId && !!user,
  });

  // Fetch spaces for this pipeline
  const spacesQuery = useQuery({
    queryKey: ["pipeline-spaces-for-scan", pipelineId],
    queryFn: async () => {
      if (!pipelineId || !user) return [];

      const { data, error } = await supabase
        .from("floorplan_pipeline_spaces")
        .select("id, name, space_type, confidence, is_excluded, include_in_generation")
        .eq("pipeline_id", pipelineId)
        .eq("is_excluded", false);

      if (error) throw error;
      return data || [];
    },
    enabled: !!pipelineId && !!user,
  });

  // Fetch camera markers to determine source (analysis vs manual)
  const markersQuery = useQuery({
    queryKey: ["camera-markers-for-scan", pipelineId],
    queryFn: async () => {
      if (!pipelineId || !user) return [];

      const { data, error } = await supabase
        .from("pipeline_camera_markers")
        .select("id, label, room_id, x_norm, y_norm, yaw_deg, fov_deg, anchor_crop_overlay_path, anchor_single_overlay_path")
        .eq("pipeline_id", pipelineId)
        .order("sort_order");

      if (error) throw error;
      return data || [];
    },
    enabled: !!pipelineId && !!user,
  });

  // Fetch pipeline for prompt generation params and Step 2 upload
  const pipelineQuery = useQuery({
    queryKey: ["pipeline-for-prompt-preview", pipelineId],
    queryFn: async () => {
      if (!pipelineId || !user) return null;

      const { data, error } = await supabase
        .from("floorplan_pipelines")
        .select("aspect_ratio, output_resolution, quality_post_step4, global_style_bible, step_outputs")
        .eq("id", pipelineId)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: !!pipelineId && !!user,
  });

  // NEW: Fetch actual stored prompts from floorplan_space_renders
  // IMPORTANT: Only fetch renders with camera_marker_id (full prompts), not placeholders
  const rendersQuery = useQuery({
    queryKey: ["space-renders-for-prompts", pipelineId],
    queryFn: async () => {
      if (!pipelineId || !user) return [];

      const { data, error } = await supabase
        .from("floorplan_space_renders")
        .select("id, space_id, kind, status, prompt_text, camera_marker_id, camera_label, ratio, quality, model")
        .eq("pipeline_id", pipelineId)
        .not("camera_marker_id", "is", null) // CRITICAL: Exclude placeholder records
        .order("created_at", { ascending: true });

      if (error) throw error;
      return data || [];
    },
    enabled: !!pipelineId && !!user,
  });

  // Build per-space scan summaries
  const spaceScanSummaries = useMemo<SpaceScanSummary[]>(() => {
    const scan = scanQuery.data;
    const spaces = spacesQuery.data || [];
    const markers = markersQuery.data || [];
    
    if (!scan?.results_json || !Array.isArray(scan.results_json)) {
      // No scan results yet
      return spaces.map((space) => ({
        space_id: space.id,
        space_name: space.name,
        space_type: space.space_type,
        source: (space.confidence === 1.0 ? "manual" : "analysis") as "analysis" | "manual",
        confidence: Number(space.confidence) || 0.95,
        cameras: [],
        space_warnings: [],
        expected_outputs: "Camera scan not run yet",
      }));
    }

    const scanResults = scan.results_json as unknown as PanoramaPointScanResult[];
    
    // Group cameras by bound room
    const camerasByRoom = new Map<string, CameraForSpace[]>();
    const warningsByRoom = new Map<string, string[]>();

    for (const point of scanResults) {
      const roomId = point.room_validation?.bound_room_id;
      if (!roomId) continue;

      if (!camerasByRoom.has(roomId)) {
        camerasByRoom.set(roomId, []);
        warningsByRoom.set(roomId, []);
      }

      const cameras = camerasByRoom.get(roomId)!;
      const warnings = warningsByRoom.get(roomId)!;

      // Add Camera A
      const camA = point.embedded_cameras[0];
      if (camA) {
        cameras.push({
          camera_id: `${point.panorama_point_id}_A`,
          label: `${point.panorama_point_label} (A)`,
          slot: "A",
          panorama_point_id: point.panorama_point_id,
          panorama_point_label: point.panorama_point_label,
          x_norm: point.normalized_position.x_norm,
          y_norm: point.normalized_position.y_norm,
          yaw_deg: camA.yaw_deg,
          fov_deg: point.fov_deg,
          facing_summary: camA.direction_context.primary_view_target,
          warnings: camA.warnings,
          prompt_hints: camA.prompt_hints,
          confidence: point.room_validation.confidence,
        });
        warnings.push(...camA.warnings);
      }

      // Add Camera B
      const camB = point.embedded_cameras[1];
      if (camB) {
        cameras.push({
          camera_id: `${point.panorama_point_id}_B`,
          label: `${point.panorama_point_label} (B)`,
          slot: "B",
          panorama_point_id: point.panorama_point_id,
          panorama_point_label: point.panorama_point_label,
          x_norm: point.normalized_position.x_norm,
          y_norm: point.normalized_position.y_norm,
          yaw_deg: camB.yaw_deg,
          fov_deg: point.fov_deg,
          facing_summary: camB.direction_context.primary_view_target,
          warnings: camB.warnings,
          prompt_hints: camB.prompt_hints,
          confidence: point.room_validation.confidence,
        });
        warnings.push(...camB.warnings);
      }
    }

    // Build summaries for each space
    return spaces.map((space) => {
      const cameras = camerasByRoom.get(space.id) || [];
      const spaceWarnings = [...new Set(warningsByRoom.get(space.id) || [])];
      
      // Determine source based on confidence (manual = 1.0)
      const isManual = Number(space.confidence) === 1.0;

      // Calculate expected outputs
      let expectedOutputs = "";
      if (cameras.length === 0) {
        expectedOutputs = "No cameras bound to this space";
      } else {
        const cameraACount = cameras.filter(c => c.slot === "A").length;
        const cameraBCount = cameras.filter(c => c.slot === "B").length;
        expectedOutputs = `${cameraACount} Render A view(s), ${cameraBCount} Render B view(s) → ${cameraACount + cameraBCount} panorama(s) → 1 merged 360°`;
      }

      return {
        space_id: space.id,
        space_name: space.name,
        space_type: space.space_type,
        source: isManual ? "manual" as const : "analysis" as const,
        confidence: Number(space.confidence) || 0.95,
        cameras,
        space_warnings: spaceWarnings,
        expected_outputs: expectedOutputs,
      };
    });
  }, [scanQuery.data, spacesQuery.data, markersQuery.data]);

  // NEW: Build prompt previews for a specific space from ACTUAL DATABASE DATA
  const getPromptPreviewsForSpace = (spaceId: string): SpacePromptPreviews => {
    const renders = rendersQuery.data || [];
    const markers = markersQuery.data || [];
    const pipeline = pipelineQuery.data;
    
    // Get renders for this space
    const spaceRenders = renders.filter(r => r.space_id === spaceId);
    const renderA = spaceRenders.find(r => r.kind === "A");
    const renderB = spaceRenders.find(r => r.kind === "B");
    
    if (!pipeline) {
      return {};
    }

    // Extract Step 2 upload ID from step_outputs
    const stepOutputs = pipeline.step_outputs as Record<string, unknown> | null;
    const step2UploadId = (stepOutputs?.step_2 as { upload_id?: string })?.upload_id || null;

    const constraints = [
      "Scale-lock: Preserve furniture sizes from floor plan",
      "No hallucinations: Only render rooms visible in plan",
      "Adjacency rules: Respect room connectivity graph",
    ];

    const buildPromptFromRender = (render: typeof renderA, slot: "A" | "B"): PromptPreview | undefined => {
      if (!render) return undefined;
      
      // CRITICAL: Validate prompt is not a short placeholder
      const promptText = render.prompt_text || "";
      if (promptText.length < 100) {
        // This is likely a placeholder prompt - don't display it
        console.warn(`[useSpaceScanDetails] Short prompt detected for ${slot}: "${promptText.slice(0, 50)}..."`);
        return undefined;
      }

      // Get the marker for this render
      const marker = markers.find(m => m.id === render.camera_marker_id);
      
      // Build input images list
      const inputImages: PromptInputImage[] = [];

      if (slot === "A") {
        // Camera A: Screenshot + Step 2 plan
        if (marker?.anchor_crop_overlay_path) {
          inputImages.push({
            type: "camera_screenshot",
            label: "Camera A Screenshot",
            storage_path: marker.anchor_crop_overlay_path,
            description: "Cropped screenshot showing camera position with arrow overlay",
          });
        }
        if (step2UploadId) {
          inputImages.push({
            type: "step2_plan",
            label: "Step 2 Styled Plan",
            upload_id: step2UploadId,
            description: "Styled floor plan from Step 2 (style reference)",
          });
        }
      } else {
        // Camera B: Screenshot + Camera A output + Step 2 plan
        if (marker?.anchor_crop_overlay_path) {
          inputImages.push({
            type: "camera_screenshot",
            label: "Camera B Screenshot",
            storage_path: marker.anchor_crop_overlay_path,
            description: "Cropped screenshot showing camera B position (opposite direction)",
          });
        }
        // Camera A output would be available at runtime (not pre-known)
        inputImages.push({
          type: "camera_a_output",
          label: "Camera A Output (Runtime)",
          description: "Generated render from Camera A (required for visual consistency)",
        });
        if (step2UploadId) {
          inputImages.push({
            type: "step2_plan",
            label: "Step 2 Styled Plan",
            upload_id: step2UploadId,
            description: "Styled floor plan from Step 2 (style reference)",
          });
        }
      }

      return {
        space_id: spaceId,
        render_id: render.id,
        camera_slot: slot,
        camera_marker_id: render.camera_marker_id,
        camera_label: render.camera_label,
        final_prompt_text: render.prompt_text,
        status: render.status,
        input_images: inputImages,
        provider: "NanoBanana",
        model: render.model || "nano-banana-v1",
        aspect_ratio: render.ratio || pipeline.aspect_ratio || "16:9",
        quality: render.quality || pipeline.quality_post_step4 || "2K",
        num_outputs: 1,
        constraints,
      };
    };

    return {
      render_a: buildPromptFromRender(renderA, "A"),
      render_b: buildPromptFromRender(renderB, "B"),
    };
  };

  // Get summary for a specific space
  const getScanSummaryForSpace = (spaceId: string): SpaceScanSummary | undefined => {
    return spaceScanSummaries.find(s => s.space_id === spaceId);
  };

  // Computed: check if any prompts are generated (stored in DB)
  const hasGeneratedPrompts = useMemo(() => {
    const renders = rendersQuery.data || [];
    return renders.some(r => r.prompt_text && r.prompt_text.length > 0);
  }, [rendersQuery.data]);

  return {
    // Data
    spaceScanSummaries,
    scanStatus: scanQuery.data?.status || "not_run",
    scanCreatedAt: scanQuery.data?.created_at,
    
    // Loading
    isLoading: scanQuery.isLoading || spacesQuery.isLoading || markersQuery.isLoading || rendersQuery.isLoading,
    
    // Helpers
    getScanSummaryForSpace,
    getPromptPreviewsForSpace,
    
    // Computed
    hasScanResults: !!scanQuery.data?.results_json,
    hasGeneratedPrompts,
  };
}
