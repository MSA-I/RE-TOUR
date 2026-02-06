# Memory: pipeline/per-space-rendering-gating
Updated: now

The "Start Render for this Space" button for each space now has decoupled gating logic. It is enabled if Step 2 is complete and the space has at least one camera marker (or existing render records), regardless of whether reference images are selected. Reference images are optional and do not block rendering. The system automatically handles Camera A's completion and then enqueues Camera B (anchored to Camera A's output) without blocking the per-space render flow. CRITICAL: Both frontend (`SpaceRenderControls.tsx`) and backend (`run-single-space-renders`) must include `"planned"` in their STARTABLE_STATUSES array, as this is the initial status set by `confirm-camera-plan`.
