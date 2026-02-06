# Memory: features/camera-screenshot-crop-pipeline
Updated: now

The Camera Planning step implements a FULL FLOOR PLAN overlay with SINGLE MARKER per camera point.

## Asset Pipeline (Updated)

For each camera marker (panorama point):
1. **Anchor Metadata** (from `create-camera-anchor`):
   - `anchor_base_plan_path`: Reference to Step 2 styled plan
   - `anchor_single_overlay_path`: Reference for this camera's context
   - `anchor_crop_overlay_path`: FULL FLOOR PLAN with single marker overlay

2. **Full Plan Overlay Image** (from `create-camera-anchor`):
   - **FULL floor plan image at native resolution (NO CROPPING)**
   - Single Camera A marker (blue arrow) drawn at exact marker position
   - **NO other markers visible** - only the selected camera point
   - **NO Camera B marker** - same overlay used for both A and B renders
   - Stored in `temp/camera-planning/{pipeline_id}/{scan_id}/{marker_id}.png`

## Overlay Generation Logic

```typescript
// Full floor plan with single marker overlay
const markerPixelX = marker.x_norm * imageWidth;
const markerPixelY = marker.y_norm * imageHeight;

// Clone full image - NO CROPPING
const overlayImage = sourceImage.clone();

// Draw ONLY Camera A marker (blue arrow) at exact position
drawSingleMarkerOnFullPlan(overlayImage, marker, markerPixelX, markerPixelY);
```

## UI Display

- Each marker row shows a full-plan thumbnail preview (if available)
- Compact status badges show `X/Y anchors` and `X/Y overlays` readiness
- CameraAnchorButton shows combined anchor + overlay status
- Click thumbnail to view enlarged overlay with single marker visible

## One Overlay Per Point (Reused for A+B)

- Each panorama point represents TWO cameras (A primary, B mirrored at +180°)
- Only ONE overlay image is generated per point showing ONLY Camera A marker
- The SAME overlay is used for both Camera A and Camera B renders
- Camera A arrow: primary direction (yaw_deg) - blue
- Camera B does NOT have its own marker in the overlay

## Render Validation

`run-space-render` validates before generating:
1. Anchor status must be "ready"
2. Overlay image must exist (crop_public_url not null)
3. Logs the complete image bundle being sent to Nano Banana

## Image Bundle Sent to AI

For each render, the prompt includes:
1. `BASE PLAN` - Step 2 styled floor plan (clean reference)
2. `FULL PLAN OVERLAY` - Complete floor plan with ONLY the selected camera marker visible
3. Final prompt containing camera_name, yaw_deg, fov_deg, and instructions
