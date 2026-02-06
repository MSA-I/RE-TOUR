# Memory: pipeline/camera-ab-sequential-dependency
Updated: 2026-01-30

The render pipeline now enforces a **strict A→B sequential dependency** for camera generation. Each panorama point produces two cameras (A and B), but Camera B is **always anchored to Camera A's output**:

## Execution Flow
1. **Camera A generates FIRST** using:
   - Step 2 styled plan image
   - Camera anchor screenshots (plan + crop + overlay)
   - Numeric camera data (x_norm, y_norm, yaw_deg, fov_deg)

2. **Camera B generates SECOND** using:
   - Camera A's output image as **PRIMARY visual anchor** (mandatory)
   - Same Step 2 styled plan
   - Camera anchor screenshots for B direction
   - Explicit prompt stating: "Generate the 180° opposite view of this EXACT room"

## Hard Rules
- Camera B **CANNOT** run without Camera A's output
- If Camera A fails → Camera B is **BLOCKED** (status: "blocked")
- Camera B retry reuses Camera A's existing output
- A and B are processed **sequentially per space** (never in parallel)

## State Tracking
- `floorplan_space_renders.status = "blocked"` if B attempted without A
- `qa_report.requires_camera_a = true` for blocked B renders
- Batch-renders groups by space_id and processes A→B strictly

## QA Verification
- Same-space continuity between A and B
- Opposite direction correctness (180° difference)
- No unrelated geometry or room type changes
- Floor-plan consistency with adjacency graph
