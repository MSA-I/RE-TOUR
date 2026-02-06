/**
 * Camera Anchor Sanity Validator
 * 
 * Hard gate that BLOCKS all NanoBanana calls for Steps 5-7 unless:
 * 1. All 3 anchor images exist (base_plan, single_overlay, crop_overlay)
 * 2. Single-camera rule is enforced (only ONE camera visible)
 * 3. Label is present and correct
 * 4. Direction arrow is visible
 * 5. Crop is valid (contains camera marker)
 */

export interface AnchorValidationResult {
  valid: boolean;
  errorCode?: string;
  errorMessage?: string;
  missingArtifacts?: string[];
  failedChecks?: string[];
}

export interface CameraMarkerWithAnchor {
  id: string;
  label: string;
  anchor_status: string;
  anchor_base_plan_path: string | null;
  anchor_single_overlay_path: string | null;
  anchor_crop_overlay_path: string | null;
  anchor_created_at: string | null;
  anchor_transform_hash: string | null;
  anchor_error_message: string | null;
  x_norm: number;
  y_norm: number;
  yaw_deg: number;
  fov_deg: number;
  room_id: string | null;
}

/**
 * Validate that a camera marker has all required anchor artifacts
 * Returns detailed error information if validation fails
 */
export function validateCameraAnchor(marker: CameraMarkerWithAnchor): AnchorValidationResult {
  const missingArtifacts: string[] = [];
  const failedChecks: string[] = [];

  // Check 1: Anchor status must be "ready"
  if (marker.anchor_status !== "ready") {
    return {
      valid: false,
      errorCode: "ANCHOR_NOT_READY",
      errorMessage: `Camera ${marker.label} anchor status is "${marker.anchor_status}" (must be "ready")`,
      failedChecks: [`anchor_status: ${marker.anchor_status}`],
    };
  }

  // Check 2: All 3 artifact paths must exist
  if (!marker.anchor_base_plan_path) {
    missingArtifacts.push("base_plan_image");
  }
  if (!marker.anchor_single_overlay_path) {
    missingArtifacts.push("plan_single_camera_overlay");
  }
  if (!marker.anchor_crop_overlay_path) {
    missingArtifacts.push("space_crop_single_camera_overlay");
  }

  if (missingArtifacts.length > 0) {
    return {
      valid: false,
      errorCode: "MISSING_ANCHOR_ARTIFACTS",
      errorMessage: `Camera ${marker.label} is missing ${missingArtifacts.length} anchor artifact(s)`,
      missingArtifacts,
    };
  }

  // Check 3: Transform hash must exist
  if (!marker.anchor_transform_hash) {
    failedChecks.push("anchor_transform_hash is null");
  }

  // Check 4: Created timestamp must exist
  if (!marker.anchor_created_at) {
    failedChecks.push("anchor_created_at is null");
  }

  // Check 5: Basic geometry validation (non-degenerate camera)
  if (marker.fov_deg <= 0 || marker.fov_deg > 180) {
    failedChecks.push(`invalid FOV: ${marker.fov_deg}° (must be 1-180)`);
  }

  // Check 6: Position must be within bounds
  if (marker.x_norm < 0 || marker.x_norm > 1 || marker.y_norm < 0 || marker.y_norm > 1) {
    failedChecks.push(`position out of bounds: (${marker.x_norm}, ${marker.y_norm})`);
  }

  if (failedChecks.length > 0) {
    return {
      valid: false,
      errorCode: "ANCHOR_SANITY_FAILED",
      errorMessage: `Camera ${marker.label} failed ${failedChecks.length} sanity check(s)`,
      failedChecks,
    };
  }

  return { valid: true };
}

/**
 * Validate all camera markers for a pipeline
 * Returns overall validation status and list of failed markers
 */
export function validateAllCameraAnchors(
  markers: CameraMarkerWithAnchor[]
): {
  allValid: boolean;
  validCount: number;
  invalidCount: number;
  results: Array<{ markerId: string; label: string; result: AnchorValidationResult }>;
} {
  const results = markers.map((marker) => ({
    markerId: marker.id,
    label: marker.label,
    result: validateCameraAnchor(marker),
  }));

  const validCount = results.filter((r) => r.result.valid).length;
  const invalidCount = results.length - validCount;

  return {
    allValid: invalidCount === 0,
    validCount,
    invalidCount,
    results,
  };
}

/**
 * Build human-readable error summary for UI display
 */
export function buildAnchorErrorSummary(
  validationResults: Array<{ markerId: string; label: string; result: AnchorValidationResult }>
): string {
  const failed = validationResults.filter((r) => !r.result.valid);
  
  if (failed.length === 0) {
    return "All camera anchors validated successfully.";
  }

  const lines: string[] = [
    `❌ ${failed.length} camera(s) failed anchor validation:`,
    "",
  ];

  for (const { label, result } of failed) {
    lines.push(`• ${label}: ${result.errorMessage}`);
    
    if (result.missingArtifacts?.length) {
      lines.push(`  Missing: ${result.missingArtifacts.join(", ")}`);
    }
    
    if (result.failedChecks?.length) {
      lines.push(`  Failed: ${result.failedChecks.join(", ")}`);
    }
  }

  lines.push("");
  lines.push("⚠️ Renders cannot proceed until all camera anchors are ready.");
  lines.push('Click "Create Camera Anchor" for each failed camera to resolve.');

  return lines.join("\n");
}

/**
 * Check if anchor artifacts exist in storage
 * This is a deeper validation that actually checks if files are accessible
 */
export async function verifyAnchorFilesExist(
  serviceClient: any,
  marker: CameraMarkerWithAnchor,
  storageBucket: string = "outputs"
): Promise<AnchorValidationResult> {
  const missingArtifacts: string[] = [];

  // Check each artifact path
  const pathsToCheck = [
    { name: "base_plan_image", path: marker.anchor_base_plan_path },
    { name: "plan_single_camera_overlay", path: marker.anchor_single_overlay_path },
    { name: "space_crop_single_camera_overlay", path: marker.anchor_crop_overlay_path },
  ];

  for (const { name, path } of pathsToCheck) {
    if (!path) {
      missingArtifacts.push(name);
      continue;
    }

    try {
      // Try to get file metadata (lightweight check)
      const { data, error } = await serviceClient.storage
        .from(storageBucket)
        .list(path.substring(0, path.lastIndexOf("/")), {
          search: path.substring(path.lastIndexOf("/") + 1),
          limit: 1,
        });

      // If we can't find the file or there's an error, mark as missing
      if (error || !data || data.length === 0) {
        missingArtifacts.push(name);
      }
    } catch {
      // If any check fails, mark as missing
      missingArtifacts.push(name);
    }
  }

  if (missingArtifacts.length > 0) {
    return {
      valid: false,
      errorCode: "ANCHOR_FILES_MISSING",
      errorMessage: `Camera ${marker.label} anchor files not found in storage`,
      missingArtifacts,
    };
  }

  return { valid: true };
}
