# Memory: pipeline/camera-b-template-enforcement
Updated: 2026-01-30

Camera B prompt composition now **ALWAYS** uses the stored Opposite-View Template and **NEVER** falls back to a generic room-based prompt.

## Root Cause of Previous Bug
When `first_render_upload_id` was not passed to `run-space-render`, but Camera A output existed in DB, the system would:
1. Pass the dependency gate (correctly verified Camera A output exists)
2. But then fall through to the Kind A branch (generic room prompt) because `first_render_upload_id` was null
3. This produced room-first prompts like "Generate a photorealistic interior render for Dining Room" for Camera B

## Implemented Fix
1. **Auto-resolve Camera A output**: If `first_render_upload_id` is not provided but Camera A has output in DB, automatically fetch and use it (`resolvedCameraAOutputId`)
2. **Hard gate validation**: Camera B is blocked with `CAMERA_B_ANCHOR_MISSING` if no Camera A output can be resolved
3. **Strict branching**: Prompt building uses `resolvedCameraAOutputId` for the Camera B path condition
4. **Fallback safety net**: An unreachable else clause returns `CAMERA_B_TEMPLATE_VIOLATION` if Camera B somehow reaches prompt building without anchor

## Camera B Prompt Requirements (Non-Negotiable)
- Uses `getOppositeViewTemplate()` from database
- Instantiates with: `camera_position`, `yaw_opposite`, `floor_plan`, `image_A`, `constraints`, `space_name`, `space_type`
- Always includes Camera A output as **first** and **primary** visual anchor
- Never uses `RENDER_PROMPT_TEMPLATE_A` (the generic room prompt)

## Validation for QA
Camera B outputs that look like standalone room renders (not anchored to A) should be auto-rejected with reason: "Camera B not anchored to Camera A"
