# Memory: features/camera-screenshot-single-source-of-truth
Updated: now

## Problem Solved

Camera Planning had inconsistent screenshot/crop status between:
- **Panorama Points panel**: Showed checkmark (from `anchor_status = "ready"` in `pipeline_camera_markers`)
- **AI Scan Results panel**: Showed "missing crops" (from empty `pipeline_camera_scan_items` table)

This caused user confusion and blocked pipeline progression.

## Solution: Single Source of Truth

The **marker's `anchor_status` field** in `pipeline_camera_markers` table is now the single source of truth for whether screenshots/crops exist.

### Implementation Details

1. **`CameraScanResultsPanel`** now receives `markers` prop with anchor status
2. **`markerHasCrop()` helper** checks `anchor_status === "ready"` first, falls back to scan items
3. **`CropThumbnail`** component accepts `hasAnchorReady` prop and shows green checkmark even without displayable URL
4. **`totalCrops` count** uses `markerHasCrop()` to ensure consistency with Panorama Points panel

### Key Rule

Both panels now use the same logic:
- If `marker.anchor_status === "ready"` → crop exists ✓
- If `marker.anchor_status !== "ready"` AND no scan item crop → missing

### Database Tables Involved

- `pipeline_camera_markers.anchor_status` - PRIMARY source of truth
- `pipeline_camera_markers.anchor_crop_overlay_path` - Storage path for crop
- `pipeline_camera_scan_items.crop_public_url` - SECONDARY (signed URL cache)

### What This Prevents

- No more false "missing crops" warnings when anchors are ready
- No more pipeline blocking due to stale `pipeline_camera_scan_items` data
- Consistent UI across both panels
